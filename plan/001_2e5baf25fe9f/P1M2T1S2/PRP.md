# PRP — P1.M2.T1.S2: `resultBytes(content)` + `approxTokens(bytes)` (append to `src/tokens.ts` + `test/tokens.test.ts`)

**Work item:** P1.M2.T1.S2 · **Points:** 0.5 · **Stage:** Pure Helper Library → Token Estimation Helpers
**Scope:** **APPEND-ONLY to two files** that the parallel sibling **P1.M2.T1.S1** creates — `src/tokens.ts`
(append `resultBytes` + `approxTokens` + `ResultContentBlock` + `stringByteLength`) and `test/tokens.test.ts`
(edit the import line + append two `describe` blocks). **No new files. No other file is touched.**

---

## Goal

**Feature Goal**: Ship Mulligan's **byte-level result-size measurer** and its **byte→token converter** as two
**self-contained, deterministic, Pi-free, import-free, side-effect-free** pure helpers appended to the existing
`src/tokens.ts` (created by P1.M2.T1.S1). `resultBytes(content)` sums the UTF-8 byte length of every `text`
block plus the char (=byte) length of every `image` block's base64 `data`, using `Buffer.byteLength(text, "utf8")`
for text (multibyte-correct) and `block.data?.length ?? 0` for images (base64 is ASCII). `approxTokens(bytes)`
returns `Math.ceil(bytes / CHARS_PER_TOKEN)` (reusing S1's exported `CHARS_PER_TOKEN = 4`). Together they are the
**bloat-detection primitive**: the `tool_result` nudge handler (P1.M6.T1.S1) calls
`resultBytes(event.content)` and compares against `config.nudges.bloatThresholdBytes` (8192 default), then stores
`approxTokens(bytes)` in the persisted `TurnMetric.bloatHits[].approxTokens` (spec/04 §5).

**Deliverable** (append-only edits to two existing files):
1. `src/tokens.ts` — append (end-of-file, clearly delimited):
   - `export interface ResultContentBlock { type: string; text?: string; data?: string; [key: string]: unknown }`
   - `export function resultBytes(content: ResultContentBlock[] | null | undefined): number`
   - `export function approxTokens(bytes: number): number`
   - `function stringByteLength(value: unknown): number` (module-private; UTF-8 byte length via `Buffer`)
   - REUSES S1's existing module-private `isRecord`, `readOwn`, `stringLength` (same module scope; hoisted).
   - REUSES S1's exported `CHARS_PER_TOKEN` in `approxTokens`.
2. `test/tokens.test.ts` — edit the existing import (add the 3 new names) + append two `describe` blocks
   (`resultBytes`, `approxTokens`) covering: empty→0, null/undef/non-array→0, ASCII byte count, **UTF-8
   multibyte byte count** (proves byte≠char), image base64 length, missing fields→0, unknown type→0, mixed
   text+image sum, real `(TextContent|ImageContent)[]` shape, defensive never-throws; approxTokens 0/ceil/
   8192→2048 (the spec's "8 KB ≈ 2k tokens" equivalence)/negative→0/NaN→0/Infinity→0; end-to-end composition.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (the appended helpers + tests are type-sound under `strict`).
- `npx vitest run` is **all-green** — the new `resultBytes`/`approxTokens` cases **AND** S1's `estimateTokens`
  cases **AND** the pre-existing `config`/`log`/`runtime` suites.
- `src/tokens.ts` still has **zero imports** (`grep -cE '^import|^from' src/tokens.ts` → **0**). `Buffer` is a
  Node **global** (no import line); S2 adds none.
- `resultBytes` is **exact** (deterministic integer, NOT an estimate): `resultBytes([])`→0; ASCII `"abc"`→3;
  UTF-8 `"café"`→**5** (not 4); image `"abcdefgh"`→8; `bloatThresholdBytes`-class input sums correctly.
- `approxTokens` is **exact**: `approxTokens(0)`→0; `approxTokens(8192)`→**2048** (reproduces spec/07 "8 KB ≈ 2k
  tokens"); `approxTokens(41)`→11 (ceil); negatives/NaN/Infinity→0 (defensive).
- Both **never throw** (defensive on null/non-array/non-record/Proxy-trap inputs) — they sit on the hot path.

---

## User Persona

**Target User**: The implementing AI agent for the **bloated-result nudge** (P1.M6.T1.S1) and the **turn-metric**
(P1.M6.T2.S1 / spec/04 §5), plus `tools/audit.ts` (P1.M5.T4.S1) which may surface bloat in token terms.
- `nudges.ts` tool_result handler (P1.M6.T1.S1) calls, verbatim from spec/07 §1:
  ```ts
  const bytes = resultBytes(event.content);
  if (bytes < config.nudges.bloatThresholdBytes) return;        // 8192 default — measured in BYTES
  const reminder = renderBloatReminder(event.toolName, bytes, config.nudges.bloatThresholdBytes);
  recordBloatHit(ctx, event.toolName, approxTokens(bytes));     // stored in TurnMetric.bloatHits[].approxTokens
  ```

**Use Case**: A `tool_result` fires with a large content array. The handler asks two cheap questions:
(1) "How many BYTES is this in-context?" → `resultBytes(content)`; (2) "Roughly how many TOKENS is that for the
metric/audit display?" → `approxTokens(bytes)`. No Pi session, no tokenizer — just `Buffer.byteLength` + division.

**User Journey**:
1. Agent runs `read("src/big.log")` → a 30 KB text result lands in `tool_result`.
2. The nudge handler calls `resultBytes(event.content)` → ~30720 bytes (> 8192 threshold).
3. It appends the bloat reminder to the result content, and records `approxTokens(30720) = 7680` into the
   turn-metric `bloatHits` (so the per-turn drift nudge can aggregate).
4. The agent sees the reminder, decides to `mulligan_shrink` the result → bloat resolved.

**Pain Points Addressed**: The bloat threshold (spec/07 §1) is **deliberately in BYTES of in-context text**, NOT
model tokens ("we don't tokenize here — keep it cheap and deterministic"). So Mulligan needs a byte-accurate
measurer that handles **UTF-8 multibyte text** (a 16 KB CJK log must NOT read as ~6 KB chars and slip under the
threshold). `approxTokens` then converts that byte count to a rough token figure for the metric/audit display,
using the same ~4 ratio as `estimateTokens` (reusing `CHARS_PER_TOKEN`).

---

## Why

- **Unblocks the bloated-result nudge (P1.M6.T1.S1) and the turn-metric (P1.M6.T2.S1).** These two helpers are
  the entire measurement core of Nudge A (spec/07 §1). Shipping them now (foundation tier, alongside
  `estimateTokens`) lets the nudge task focus on the Pi `tool_result`/`turn_end` glue, not arithmetic.
- **Byte-accurate by mandate.** spec/07 §1 is explicit: the threshold is "in **bytes of the in-context text
  representation** (sum of `.text` lengths across content blocks, **UTF-8 byte length**). Not model tokens."
  `Buffer.byteLength(text, "utf8")` is the correct multibyte-aware implementation (char count `.length` would
  undercount non-ASCII results and let bloat slip through — see research).
- **The "8 KB ≈ 2k tokens" equivalence is the spec's own calibration.** spec/07 §1: "Default
  `bloatThresholdBytes = 8192` (8 KB **≈ 2k tokens** in-context)." `approxTokens(8192) = Math.ceil(8192/4) = 2048`
  reproduces that equivalence **exactly** — strong confirmation that `bytes / CHARS_PER_TOKEN` (4) is the intended
  formula, and that `approxTokens` should reuse S1's `CHARS_PER_TOKEN`, not invent a new constant.
- **Foundation-tier & import-free (like the rest of `tokens.ts`).** S2 adds **no imports** — `Buffer` and `Math`
  are globals/builtins. It reuses S1's defensive helpers (`isRecord`/`readOwn`/`stringLength`) since they live in
  the same module scope. This keeps the file a pure, fast, deterministic, isolated unit-test target.

---

## What

APPEND to the existing `src/tokens.ts` (created by P1.M2.T1.S1) and `test/tokens.test.ts`. The additions:

- `ResultContentBlock` — a deliberately **loose** structural type (`{ type: string; text?: string; data?: string;
  [key: string]: unknown }`) broad enough that a real Pi `tool_result` `content` `(TextContent | ImageContent)[]`
  assigns in with no cast, but capturing exactly the three fields `resultBytes` reads.
- `resultBytes(content)` — sums UTF-8 **byte** length across blocks:
  - non-array content (null/undefined/string/number) → **0** (defensive);
  - for each **record** block: `type === "text"` → `Buffer.byteLength(text, "utf8")` (via `stringByteLength`);
    `type === "image"` → `data?.length ?? 0` (base64 is ASCII → char length == byte length; via `stringLength`);
    any other `type` → 0 (forward-compat); non-record element → skipped.
  - **never throws** (reuses S1's `readOwn`, which swallows Proxy-trap throws).
- `approxTokens(bytes)` — `Math.ceil(bytes / CHARS_PER_TOKEN)`; defensive guard returns **0** for
  non-finite or negative input (NaN/±Infinity/negative are nonsense token counts). Reuses S1's `CHARS_PER_TOKEN`.
- `stringByteLength(value)` — module-private; `typeof v === "string" ? Buffer.byteLength(v, "utf8") : 0`.

This subtask does **NOT**: touch `index.ts`/`config.ts`/`log.ts`/`runtime.ts`; modify S1's `estimateTokens` or its
types (append-only); implement the `tool_result`/`turn_end` handlers (that is P1.M6.T1.S1/P1.M6.T2.S1); import
anything (Buffer is a global); or define a redundant `BYTES_PER_TOKEN` (reuses `CHARS_PER_TOKEN`).

### Success Criteria

- [ ] `resultBytes` and `approxTokens` are **appended** to `src/tokens.ts` (file still has zero imports).
- [ ] `ResultContentBlock` is exported and accepts real `(TextContent | ImageContent)[]` shapes (structural).
- [ ] The two new `describe` blocks are **appended** to `test/tokens.test.ts` (import line edited to include the
      3 new names); all-green.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (with the appended code).
- [ ] `npx vitest run` is all-green (resultBytes + approxTokens + S1 estimateTokens + config/log/runtime).
- [ ] `grep -cE '^import|^from' src/tokens.ts` → **0** (Buffer is a global; S2 adds no import).
- [ ] `resultBytes([])` → 0; `resultBytes(null)`/`undefined` → 0; non-array → 0.
- [ ] `resultBytes([{type:"text",text:"abc"}])` → **3**; `resultBytes([{type:"text",text:"café"}])` → **5**
      (UTF-8 multibyte — proves byte≠char counting); empty text → 0.
- [ ] `resultBytes([{type:"image",data:"abcdefgh",mimeType:"image/png"}])` → **8** (base64 `.length`).
- [ ] `resultBytes([{type:"image"}])` (no data) → 0; unknown `type` → 0; non-record element → skipped → 0.
- [ ] `resultBytes` mixes text+image and sums; never throws on a throwing-Proxy block (fail-open).
- [ ] `approxTokens(0)` → 0; `approxTokens(40)` → 10; `approxTokens(41)` → 11 (ceil).
- [ ] `approxTokens(8192)` → **2048** (the spec/07 "8 KB ≈ 2k tokens" equivalence — load-bearing assertion).
- [ ] `approxTokens(-100)`/`NaN`/`Infinity` → 0 (defensive).
- [ ] End-to-end: `approxTokens(resultBytes([{type:"text",text:"a".repeat(8000)}]))` → **2000**.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact code to append is given verbatim below (Task 1) and the exact test
> additions (Task 2), including the precise edit to the existing import line. The tool_result `content` shape is
> quoted from `architecture/api_verification.md` §7.2. The text/image byte-counting asymmetry and the `bytes/4`
> formula are grounded in spec/07 §1 + the spec's own "8 KB ≈ 2k tokens" calibration. The only non-obvious
> dependencies — that S1's module-private helpers are reusable in the same file scope, and that `Buffer` is a
> global that needs no import — are documented with evidence. No prior knowledge beyond "S1 created
> `src/tokens.ts` + `test/tokens.test.ts` with `estimateTokens`/`CHARS_PER_TOKEN`/defensive helpers" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/tokens.ts` — do NOT recreate it.** S1 (P1.M2.T1.S1) creates the file with `estimateTokens`,
  `CHARS_PER_TOKEN`, the structural types, and the module-private defensive helpers. S2 adds a **clearly
  delimited end-of-file section**. JS/TS hoists function declarations, so the appended `resultBytes` can call
  S1's earlier `isRecord`/`readOwn`/`stringLength` with no ordering issue.
- **APPEND to `test/tokens.test.ts` — do NOT recreate it.** S1 owns it. S2 (1) edits the existing multi-line
  import to add `resultBytes`, `approxTokens`, `type ResultContentBlock`, and (2) appends two `describe` blocks
  at EOF. Do not touch S1's existing `describe` blocks.
- **Do NOT import `Buffer`.** It is a Node global (declared by `@types/node`; `tsconfig` has `types:["node"]`).
  `import { Buffer } from "node:buffer"` is unnecessary AND would break the tokens.ts **zero-imports gate**
  (S1 GOTCHA #2). Just use `Buffer.byteLength(...)`.
- **Do NOT define a separate `BYTES_PER_TOKEN`.** Reuse S1's exported `CHARS_PER_TOKEN = 4` (the S1 PRP exports it
  "for S2/test reuse"; `approxTokens(8192)=2048` reproduces spec/07's "8 KB ≈ 2k tokens"). One canonical "4".
- **Do NOT modify S1's `estimateTokens`, `CHARS_PER_TOKEN`, or any S1 type.** Append-only. S2 ADDS exports.
- **Do NOT implement the `tool_result` handler.** That is P1.M6.T1.S1. S2 ships only the two pure helpers it calls.

### The byte-counting asymmetry — read this (it is the crux of the contract)

The work-item contract pins an **asymmetric** measurement (item_description §LOGIC):
- **text block**  → `Buffer.byteLength(block.text, "utf8")` — proper UTF-8 **byte** length (multibyte-aware).
- **image block** → `block.data?.length ?? 0`              — **char** length of the base64 string.

WHY: tool-result **text** can contain multibyte UTF-8 (emoji, accents, CJK) where bytes > chars — so it MUST use
`Buffer.byteLength`. Image `data` is **base64** (pure ASCII: `A–Z a–z 0–9 + / =`) where char length == byte length
exactly — so `.length` suffices and is what the contract pins. **Do not "normalize" the image case to
`Buffer.byteLength`** — both give the same number for ASCII, but match the contract verbatim to avoid drift. And
**do not use `.length` for text** — a 16 KB CJK log would read as ~6 KB chars and slip under the 8 KB threshold,
violating spec/07 §1 ("UTF-8 byte length"). S2 implements exactly this asymmetry via two helpers: `stringByteLength`
(for text) and S1's existing `stringLength` (for image `.length`).

### Documentation & References

```yaml
# MUST READ — authoritative sources for these two helpers
- file: spec/07-preventive-and-nudges.md
  section: "§1 Nudge A — bloated-result reminder (tool_result event)"
  why: "THE source of the resultBytes/approxTokens contract + the verbatim call site. 'The threshold is in BYTES
        of the in-context text representation (sum of .text lengths across content blocks, UTF-8 byte length).
        Not model tokens (we don't tokenize here).' Shows resultBytes(event.content), the bloatThresholdBytes
        compare, and recordBloatHit(ctx, toolName, approxTokens(bytes))."
  critical: "Threshold is BYTES (UTF-8), not tokens. '8192 (8 KB ≈ 2k tokens in-context)' — this single phrase
        fixes the approxTokens formula as bytes/4 (Math.ceil(8192/4)=2048)."

- file: spec/04-data-model.md
  section: "§5 Turn metric (for the nudge) → bloatHits: { toolName: string; approxTokens: number }[]"
  why: "approxTokens(bytes) output is PERSISTED into TurnMetric.bloatHits[].approxTokens. So its return shape
        (integer) is part of the data model. resultBytes stays internal (only its output drives the compare)."

- file: spec/03-architecture.md
  section: "§2.3 Pure helpers"
  why: "Groups resultBytes/approxTokens with estimateTokens as PURE helpers unit-testable without Pi (spec/10 §1)."

- file: spec/11-build-order.md
  section: "§1 layout ('tokens.ts // PURE: estimateTokens, resultBytes, approxTokens') + §2 Step 2"
  why: "Confirms all three helpers live in ONE file (src/tokens.ts): S1=estimateTokens, S2=resultBytes+approxTokens.
        S2 APPENDS to S1's file."

- file: spec/10-testing.md
  section: "§1 Tier 1 unit tests (pure helpers, no Pi) — target file tokens.ts"
  why: "The test tier: vitest, no Pi, no session. resultBytes/approxTokens are exact arithmetic (use toBe, not
        tolerance). estimateTokens §1.7 is the sibling; resultBytes/approxTokens join it."

- file: plan/001_2e5baf25fe9f/P1M2T1S1/PRP.md        # the parallel sibling PRP — read as a CONTRACT
  why: "Defines EXACTLY what src/tokens.ts + test/tokens.test.ts contain when S2 starts: estimateTokens,
        CHARS_PER_TOKEN (=4, exported 'for S2/test reuse'), TokenConfidence, TokenEstimate, MessageLike (all
        exported); TextContent/ImageContent/etc + isRecord/readOwn/stringLength/safeStringLength (module-LOCAL,
        reusable in-scope by S2). S2 appends; it does not recreate."
  critical: "S1's module-private helpers (isRecord, readOwn, stringLength) ARE reusable by S2 in the same file
        scope. S2 adds ONLY one new helper: stringByteLength (Buffer.byteLength). zero-imports gate stays green."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§7.2 tool_result Event + §6.2 Content Blocks"
  why: "VERIFIED Pi shape: ToolResultEventBase.content is (TextContent | ImageContent)[] (ALWAYS an array, never a
        plain string). TextContent={type:'text';text:string}; ImageContent={type:'image';data:string;mimeType:string}
        (data=base64). This is the input resultBytes receives."
  critical: "tool_result content is an ARRAY — but stay defensive anyway (the handler wraps in try/catch, and
        consistency with S1's defensive discipline matters)."

- file: src/config.ts            # READ-ONLY sibling — owns bloatThresholdBytes
  why: "config.nudges.bloatThresholdBytes default = 8192 (the threshold resultBytes output is compared to, in the
        DOWNSTREAM nudge handler — NOT in resultBytes itself, which is pure/threshold-agnostic). Grounds the
        approxTokens(8192)=2048 test assertion."

- file: src/log.ts               # READ-ONLY sibling — the fail-open pattern S1 mirrored and S2 continues
  why: "log.ts wraps the risky op in try/catch and NEVER throws. S1 mirrored this in tokens.ts (readOwn swallows
        Proxy-trap throws). S2's resultBytes inherits that defense by reusing readOwn — a throwing-Proxy block
        contributes 0 bytes, never crashes the tool_result metric path."

- file: test/config.test.ts      # the test convention (mirrored by S1's tokens.test.ts)
  why: "vitest; import from '../src/<file>.js'; describe/it/expect/expectTypeOf; no state → no beforeEach."

- url: https://nodejs.org/api/buffer.html#static-method-bufferbytelength-string-encoding
  why: "Node docs for Buffer.byteLength(string, encoding) — 'returns the actual byte length of a string … UTF-8'.
        Synchronous, O(n), global (no import). 'café'→5 bytes, '😀'→4 bytes."
  critical: "Buffer is a GLOBAL — do NOT import it (would break the tokens.ts zero-imports gate)."

- url: https://datatracker.ietf.org/doc/html/rfc4648#section-4
  why: "Base64 alphabet is pure ASCII (A–Z a–z 0–9 + / =) → char length == UTF-8 byte length. Justifies the
        contract's block.data?.length (not Buffer.byteLength) for the image case."

- url: https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
  why: "OpenAI rule of thumb: ~4 chars ≈ 1 token (English). For ASCII bytes==chars, so bytes/4 is the same
        heuristic on the byte count. Grounds approxTokens = Math.ceil(bytes / CHARS_PER_TOKEN)."

- file: plan/001_2e5baf25fe9f/P1M2T1S2/research/codebase_recon.md
  why: "First-hand recon: the S1↔S2 file split, the reuse of S1's module-private helpers, the byte/char asymmetry,
        Buffer-global availability, baseline tsc/vitest state, the test-import edit."
- file: plan/001_2e5baf25fe9f/P1M2T1S2/research/external_best_practices.md
  why: "Grounds Buffer.byteLength UTF-8, base64-ASCII length==bytes, bytes/4 reproducing '8 KB≈2k tokens', the
        defensive guard for NaN/±Infinity/negative, and the controlled-string test technique."

# AUTHORITATIVE resultBytes/approxTokens contract (implement EXACTLY this — append to src/tokens.ts):
#   export interface ResultContentBlock { type: string; text?: string; data?: string; [key: string]: unknown }
#   export function resultBytes(content: ResultContentBlock[] | null | undefined): number
#     // non-array → 0; for each record block: type==='text' → Buffer.byteLength(text,'utf8');
#     //                                  type==='image' → data?.length ?? 0; else → 0. NEVER throws.
#   export function approxTokens(bytes: number): number
#     // non-finite or negative → 0; else Math.ceil(bytes / CHARS_PER_TOKEN). (CHARS_PER_TOKEN reused from S1.)
#   function stringByteLength(value: unknown): number   // module-private; typeof v==='string' ? Buffer.byteLength(v,'utf8') : 0
# REUSES (module-scope, hoisted — no re-declaration): S1's isRecord, readOwn, stringLength, and exported CHARS_PER_TOKEN.
```

### Current Codebase tree (state at this subtask's start — verified live; assumes S1 landed)

```bash
pi-mulligan/
├── package.json            # type:'module'; devDeps typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
├── node_modules/@types/node/buffer.d.ts   # Buffer is a GLOBAL (declared here) — no import needed
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts           # MulliganConfig.nudges.bloatThresholdBytes=8192 (the threshold; NOT used here). Read-only.
│   ├── log.ts              # fail-open pattern S1 mirrored & S2 continues. Read-only.
│   ├── runtime.ts          # per-session map. Read-only.
│   └── tokens.ts           # ← S1 CREATED THIS (estimateTokens, CHARS_PER_TOKEN, types, isRecord/readOwn/stringLength).
│                           #   S2 APPENDS resultBytes + approxTokens + ResultContentBlock + stringByteLength.
├── test/
│   ├── config.test.ts      # test convention (vitest, '../src/<file>.js'). Read-only.
│   ├── log.test.ts         # Read-only.
│   ├── runtime.test.ts     # Read-only.
│   └── tokens.test.ts      # ← S1 CREATED THIS. S2 EDITS the import line + APPENDS two describe blocks.
└── spec/                   # 07 §1 + 04 §5 + 03 §2.3 + 11 §1/§2 + 10 §1 are authoritative for S2.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   estimateTokens+config+log green (S1's tokens suite is in by assumption). S2 is pure + append-only.
```

### Desired Codebase tree with files to be MODIFIED (THIS subtask — append-only)

```bash
pi-mulligan/
├── src/
│   └── tokens.ts           # MODIFIED (append) — +resultBytes +approxTokens +ResultContentBlock +stringByteLength.
│                           #   Still ZERO imports. Reuses S1's isRecord/readOwn/stringLength + CHARS_PER_TOKEN.
└── test/
    └── tokens.test.ts      # MODIFIED (import-line edit + append) — +resultBytes/approxTokens/ResultContentBlock
                            #   in the import; +two describe blocks at EOF. S1's blocks untouched.
# No new files. No other files touched.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — APPEND to src/tokens.ts; do NOT recreate it. S1 (P1.M2.T1.S1) owns the file: it exports
# estimateTokens, CHARS_PER_TOKEN (=4), TokenConfidence, TokenEstimate, MessageLike, and defines module-LOCAL
# isRecord, readOwn, stringLength, safeStringLength + the ContentBlock interfaces. S2 ADDS a delimited end-of-file
# section. JS/TS hoists function declarations, so an appended resultBytes CAN call S1's earlier isRecord/readOwn/
# stringLength — do NOT re-declare them (duplicate-function TS error). Reuse them. S2 adds only ONE new helper:
# stringByteLength (Buffer.byteLength UTF-8).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — Do NOT import Buffer. It is a Node GLOBAL (declared by @types/node; tsconfig types:['node']).
# Using Buffer.byteLength(...) adds NO import line, so the tokens.ts zero-imports gate
# (`grep -cE '^import|^from' src/tokens.ts` → 0, S1 GOTCHA #2) stays GREEN. `import { Buffer } from "node:buffer"`
# is unnecessary AND would break the gate. Math/JSON (S1 already uses them) and Buffer are all globals/builtins.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — The text/image byte-counting ASYMMETRY. Contract pins:
#   text block  → Buffer.byteLength(block.text, "utf8")   (UTF-8 BYTE length — multibyte-aware)
#   image block → block.data?.length ?? 0                  (CHAR length — base64 is ASCII, so == byte length)
# DO NOT swap these: .length for text would UNDERCOUNT multibyte results (a 16 KB CJK log reads ~6 KB chars → slips
# under the 8 KB threshold, violating spec/07 §1 "UTF-8 byte length"); Buffer.byteLength for image is identical to
# .length for ASCII but drifts from the contract. Implement text via stringByteLength, image via S1's stringLength.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — Reuse CHARS_PER_TOKEN (=4), do NOT add BYTES_PER_TOKEN. The S1 PRP exports CHARS_PER_TOKEN "for S2/
# test reuse"; approxTokens(8192)=2048 reproduces spec/07's "8 KB ≈ 2k tokens" EXACTLY — proof bytes/CHARS_PER_TOKEN
# is the intended formula. One canonical "4". (For ASCII bytes==chars; for non-ASCII bytes/4 overestimates tokens,
# which is fine — approxTokens is advisory, and the confidence-flag discipline from S1 carries the honesty.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — Math.ceil, NOT floor. approxTokens(1 byte) must be 1 (a non-empty result reports ≥1 token, intuitive);
# ceil is a conservative overestimate (fires the nudge slightly early rather than late) and monotonic non-decreasing.
# ceil(0/4)=0 keeps "empty→0" unique. S1 uses ceil for the same reason — S2 mirrors it.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — NEVER throw (hot path: tool_result metric + persisted turn-metric). resultBytes reuses S1's readOwn
# (swallows Proxy-trap throws) and guards non-array content → 0. approxTokens guards non-finite/negative → 0
# (Math.ceil(NaN/4)=NaN, ceil(Inf/4)=Inf, ceil(-5/4)=-1 are all nonsense token counts → coerce to 0). Buffer.byteLength
# and Math.ceil themselves never throw on valid input; the guard is for the contract-violating inputs.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — The test import edit is APPEND-friendly but requires ONE precise edit. S1's tokens.test.ts import:
#     import { estimateTokens, CHARS_PER_TOKEN, type TokenEstimate, type TokenConfidence, type MessageLike } from "../src/tokens.js";
#   S2 adds `resultBytes, approxTokens,` (values) and `type ResultContentBlock,` (type) to that SAME import. Do NOT
#   add a second `from "../src/tokens.js"` line (duplicate-import TS error). Then APPEND the two describe blocks at EOF.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — resultBytes/approxTokens are EXACT (deterministic integers), use toBe (not toBeCloseTo/tolerance).
# estimateTokens is the "approximate" sibling; these two are pure arithmetic. The UTF-8 multibyte test ("café"→5,
# NOT 4) is the load-bearing proof that byte-counting (not char-counting) is implemented.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — ResultContentBlock is deliberately LOOSE ({type:string; text?:string; data?:string; [key:string]:unknown}).
# It is broader than S1's module-local TextContent/ImageContent (which aren't exported anyway), so a real Pi
# tool_result (TextContent|ImageContent)[] assigns in with no cast, AND forward-compat unknown block types just
# contribute 0 (the [key:string]:unknown index signature accepts extra fields like mimeType). Do NOT tighten it.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// APPENDED to src/tokens.ts (end of file). Reuses S1's exported CHARS_PER_TOKEN + module-private isRecord/readOwn/stringLength.

/**
 * A content block as carried by a Pi `tool_result` (api_verification.md §7.2: content is
 * (TextContent | ImageContent)[]). resultBytes inspects ONLY `type`, `text`, `data`, so this deliberately
 * LOOSE structural shape captures exactly what it needs and is permissive enough that a real
 * (TextContent | ImageContent)[] assigns in with no cast. The index signature accepts extra fields (e.g.
 * mimeType) and keeps unknown/future block types assignable (they simply contribute 0 bytes).
 */
export interface ResultContentBlock {
  type: string;
  text?: string;   // present on text blocks
  data?: string;   // present on image blocks (base64)
  [key: string]: unknown;
}

// (approxTokens reuses S1's exported `CHARS_PER_TOKEN` — no new constant.)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE + S1 LANDED (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0 (S1's tokens.ts + test present)
  - RUN: npx vitest run test/tokens.test.ts          # expect S1's estimateTokens suite green (PROVES S1 landed)
  - RUN: grep -q 'export function estimateTokens' src/tokens.ts && echo "ok: S1 present"
  - RUN: grep -q 'export const CHARS_PER_TOKEN = 4' src/tokens.ts && echo "ok: CHARS_PER_TOKEN present (S2 reuses)"
  - RUN: test "$(grep -cE '^import|^from' src/tokens.ts)" = "0" && echo "ok: zero imports (S2 must keep this)"
  - NOTE: if S1's tokens.ts is ABSENT, STOP — S1 has not landed; S2 must run after S1.

Task 1: APPEND to src/tokens.ts   (exact content below — copy the delimited section verbatim to END of file)
  - APPEND: ResultContentBlock interface, resultBytes, approxTokens, stringByteLength.
  - REUSE (do NOT redeclare): S1's isRecord, readOwn, stringLength (module-scope, hoisted) + CHARS_PER_TOKEN.
  - CONSTRAINTS:
      * ZERO new imports (GOTCHA #2). Buffer is a global; use Buffer.byteLength directly.
      * text → Buffer.byteLength(text,'utf8'); image → data?.length ?? 0 (GOTCHA #3 asymmetry).
      * approxTokens reuses CHARS_PER_TOKEN, Math.ceil, guards non-finite/negative (GOTCHA #4/#5/#6).
      * NEVER throws — reuses readOwn; guards non-array content (GOTCHA #6).
      * APPEND-ONLY — do not touch S1's estimateTokens/CHARS_PER_TOKEN/types/helpers.
  - NAMING/PLACEMENT: a clearly delimited "// ── P1.M2.T1.S2 additions ──" section at END of src/tokens.ts.

Task 2: EDIT + APPEND to test/tokens.test.ts
  - EDIT: the existing `from "../src/tokens.js"` import — add `resultBytes, approxTokens,` and `type ResultContentBlock,`
    (GOTCHA #7 — ONE import line, no duplicate from). Do NOT touch S1's describe blocks.
  - APPEND: two describe blocks (resultBytes, approxTokens) at EOF — exact content below.
  - COVERAGE: resultBytes (empty→0; null/undef/non-array→0; ASCII bytes; UTF-8 multibyte "café"→5; empty text→0;
    image base64 length; image no-data→0; unknown type→0; non-record element→0; mixed text+image sum; real Pi shape;
    defensive Proxy never-throws). approxTokens (0→0; 40→10; 41→11 ceil; 8192→2048; negative/NaN/Infinity→0;
    monotonic). End-to-end composition. Types (ResultContentBlock accepts TextContent/ImageContent shapes).
  - NO beforeEach (resultBytes/approxTokens are pure over their args — no module state).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + zero-imports grep) and Level 2 (vitest). Levels 3/4 N/A (pure helpers, no Pi runtime).
```

#### Exact content to APPEND — `src/tokens.ts` (Task 1 — append this delimited section verbatim to END of file)

```ts
// ─────────────────────────────────────────────────────────────────────────────
// P1.M2.T1.S2 additions — byte-level result measurement + byte→token conversion.
// spec/07-preventive-and-nudges.md §1 (bloated-result reminder; threshold in BYTES of in-context text),
// spec/04-data-model.md §5 (TurnMetric.bloatHits[].approxTokens), spec/03 §2.3 (pure helpers),
// spec/11-build-order.md §1 (tokens.ts holds estimateTokens + resultBytes + approxTokens), spec/10 §1.
//
// These two helpers are the measurement core of Nudge A (P1.M6.T1.S1): the tool_result handler calls
// resultBytes(event.content), compares to config.nudges.bloatThresholdBytes (bytes), and stores
// approxTokens(bytes) in the persisted turn-metric bloatHits. They are APPENDED to S1's module and REUSE:
//   - the exported CHARS_PER_TOKEN (= 4) in approxTokens (one canonical ratio; the S1 PRP exports it for S2 reuse),
//   - the module-private isRecord / readOwn / stringLength (same module scope; hoisted — no redeclaration).
// S2 adds ZERO imports (Buffer is a Node global; Math/JSON are builtins), so the tokens.ts zero-imports gate
// (S1 GOTCHA #2) stays green. The new module-private helper stringByteLength measures UTF-8 BYTE length for the
// text case (the image case reuses stringLength because base64 is ASCII → char length == byte length — GOTCHA #3).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A content block as carried by a Pi `tool_result` (api_verification.md §7.2: `content` is
 * `(TextContent | ImageContent)[]`). `resultBytes` inspects ONLY `type`, `text`, `data`, so this deliberately
 * LOOSE structural shape captures exactly what it needs and is permissive enough that a real
 * `(TextContent | ImageContent)[]` assigns in with no cast. The index signature accepts extra fields (e.g.
 * `mimeType`) and lets unknown/future block types flow through (they simply contribute 0 bytes — forward-compat).
 *
 * This is BROADER than S1's module-local `TextContent`/`ImageContent` (which are not exported); resultBytes must
 * not over-tighten its input, because the downstream nudge handler hands it `event.content` directly.
 */
export interface ResultContentBlock {
  type: string;
  /** Present on `text` blocks. */
  text?: string;
  /** Present on `image` blocks (base64). */
  data?: string;
  [key: string]: unknown;
}

/**
 * resultBytes — the UTF-8 BYTE size of a tool_result's in-context content (spec/07 §1: "the threshold is in
 * BYTES of the in-context text representation … UTF-8 byte length").
 *
 * For each content block: a `text` block contributes `Buffer.byteLength(text, "utf8")` (multibyte-aware — a
 * 16 KB CJK log reads as 16 KB, NOT ~6 KB chars); an `image` block contributes `data?.length ?? 0` (base64 is
 * ASCII, so char length == byte length); any other `type` contributes 0. The result is a non-negative integer.
 *
 * Pure + defensive: non-array content (null/undefined/string/number) → 0; non-record block elements are skipped;
 * a throwing-Proxy block contributes 0 (reuses S1's `readOwn`, which swallows the trap). NEVER throws — it sits
 * on the tool_result hot path and feeds the persisted turn-metric.
 *
 * @param content the tool_result content array (a single block via `resultBytes([block])`)
 * @returns non-negative integer byte count
 */
export function resultBytes(content: ResultContentBlock[] | null | undefined): number {
  if (!Array.isArray(content)) {
    return 0; // absent / null / non-array (string|number|object) → 0 (defensive; tool_result content is always an array)
  }
  let bytes = 0;
  for (const block of content) {
    if (!isRecord(block)) {
      continue; // null / primitive element → skip (contributes 0)
    }
    const type = readOwn(block, "type");
    if (type === "text") {
      // TEXT → UTF-8 BYTE length. Multibyte-aware: "café"=5 bytes, NOT 4. (GOTCHA #3 — do NOT use .length here.)
      bytes += stringByteLength(readOwn(block, "text"));
    } else if (type === "image") {
      // IMAGE → base64 char length. Base64 is ASCII → char length == byte length; .length is correct + cheaper on a
      // potentially-huge blob. (GOTCHA #3 — do NOT switch to Buffer.byteLength; match the contract.)
      bytes += stringLength(readOwn(block, "data"));
    }
    // unknown type → contributes 0 (forward-compat: future block types are measured as nothing until taught).
  }
  return bytes;
}

/**
 * approxTokens — convert a byte count to an approximate token count (spec/04 §5: stored in
 * `TurnMetric.bloatHits[].approxTokens`; spec/07 §1: "8 KB ≈ 2k tokens in-context").
 *
 * Formula: `Math.ceil(bytes / CHARS_PER_TOKEN)` — reuses S1's exported `CHARS_PER_TOKEN = 4` (the OpenAI
 * "~4 chars ≈ 1 token" rule of thumb; for ASCII bytes==chars so bytes/4 is the same heuristic on the byte count).
 * `approxTokens(8192) = 2048` reproduces the spec's own "8 KB ≈ 2k tokens" equivalence EXACTLY — strong
 * confirmation this is the intended formula. `Math.ceil` (not floor) so a non-empty result reports ≥1 token.
 *
 * Defensive: non-finite (`NaN`/`±Infinity`) or negative `bytes` → 0 (Math.ceil would otherwise yield
 * `NaN`/`Infinity`/a negative — all nonsense token counts; resultBytes never yields these, but approxTokens is a
 * public helper that may be called with arbitrary input). NEVER throws.
 *
 * @param bytes a non-negative byte count (typically resultBytes(content))
 * @returns non-negative integer approximate token count
 */
export function approxTokens(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 0; // NaN / ±Infinity / negative → 0 (defensive; approxTokens is a public helper)
  }
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}

/**
 * stringByteLength — the UTF-8 BYTE length of a value when it is a string; 0 otherwise. Module-private (not
 * exported). Uses the Node global `Buffer.byteLength` (no import — GOTCHA #2). `Buffer.byteLength("café","utf8")`
 * = 5, `"😀"` = 4, `""` = 0. Mirrors S1's `stringLength` (char length) for the byte-length case (GOTCHA #3).
 */
function stringByteLength(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}
```

#### Exact edits — `test/tokens.test.ts` (Task 2)

**(2a) EDIT the existing import** — S1 created this multi-line import; add the three new names (do NOT add a
second `from "../src/tokens.js"`):

```ts
// BEFORE (S1's import — top of file):
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  estimateTokens,
  CHARS_PER_TOKEN,
  type TokenEstimate,
  type TokenConfidence,
  type MessageLike,
} from "../src/tokens.js";

// AFTER (S2 edit — add resultBytes, approxTokens, type ResultContentBlock to the SAME import):
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  estimateTokens,
  CHARS_PER_TOKEN,
  resultBytes,
  approxTokens,
  type TokenEstimate,
  type TokenConfidence,
  type MessageLike,
  type ResultContentBlock,
} from "../src/tokens.js";
```

**(2b) APPEND these two `describe` blocks** to the END of `test/tokens.test.ts` (after S1's existing blocks):

```ts
// ── P1.M2.T1.S2: resultBytes + approxTokens (spec/07 §1, spec/04 §5, spec/10 §1) ───────────────────────────────

describe("resultBytes — byte size of tool_result content (spec/07 §1: UTF-8 bytes)", () => {
  it("empty content → 0", () => {
    expect(resultBytes([])).toBe(0);
  });

  it("null / undefined content → 0 (defensive)", () => {
    expect(resultBytes(null)).toBe(0);
    expect(resultBytes(undefined)).toBe(0);
  });

  it("non-array content → 0 (defensive — a plain string or number is not a block array)", () => {
    expect(resultBytes("abcd" as unknown as ResultContentBlock[])).toBe(0);
    expect(resultBytes(12345 as unknown as ResultContentBlock[])).toBe(0);
  });

  it("a single ASCII text block yields its char count in bytes (ASCII: bytes == chars)", () => {
    expect(resultBytes([{ type: "text", text: "abc" }])).toBe(3); // 3 ASCII bytes
    expect(resultBytes([{ type: "text", text: "a".repeat(8000) }])).toBe(8000); // ~8 KB result
  });

  it("a UTF-8 MULTIBYTE text block yields its BYTE count, not char count (GOTCHA #3/#8 — load-bearing)", () => {
    // "café" = 4 CHARS but 5 UTF-8 BYTES (é = U+00E9 = 2 bytes). Proves byte≠char counting.
    expect(resultBytes([{ type: "text", text: "café" }])).toBe(5);
    // "é".repeat(4) = 4 chars, 8 bytes.
    expect(resultBytes([{ type: "text", text: "é".repeat(4) }])).toBe(8);
    // emoji: U+1F600 = 4 UTF-8 bytes.
    expect(resultBytes([{ type: "text", text: "😀" }])).toBe(4);
  });

  it("empty text → 0", () => {
    expect(resultBytes([{ type: "text", text: "" }])).toBe(0);
  });

  it("an image block contributes its base64 CHAR length (base64 is ASCII → == byte length)", () => {
    expect(resultBytes([{ type: "image", data: "abcdefgh", mimeType: "image/png" }])).toBe(8);
  });

  it("an image block with no data → 0 (defensive)", () => {
    expect(resultBytes([{ type: "image", mimeType: "image/png" }])).toBe(0);
  });

  it("an unknown block type contributes 0 (forward-compat)", () => {
    expect(resultBytes([{ type: "thinking", thinking: "abc" }])).toBe(0);
    expect(resultBytes([{ type: "toolCall", name: "read", arguments: {} }])).toBe(0);
  });

  it("a non-record block element is skipped → contributes 0 (defensive)", () => {
    expect(resultBytes([null, 42, "raw", undefined] as unknown as ResultContentBlock[])).toBe(0);
  });

  it("mixes text + image blocks and sums across the array", () => {
    const content: ResultContentBlock[] = [
      { type: "text", text: "ab" },                                    // 2
      { type: "image", data: "abcd", mimeType: "image/png" },          // 4
      { type: "text", text: "café" },                                  // 5
    ];
    expect(resultBytes(content)).toBe(11); // 2 + 4 + 5
  });

  it("accepts a real-ish Pi (TextContent | ImageContent)[] shape (structural typing)", () => {
    const content = [
      { type: "text", text: "hello world" },                          // 11
      { type: "image", data: "AAAA", mimeType: "image/jpeg" },        // 4
    ] as const;
    expect(resultBytes(content as unknown as ResultContentBlock[])).toBe(15);
  });

  it("never throws on a throwing-Proxy block (fail-open like log.ts / S1 — GOTCHA #6)", () => {
    const trap = new Proxy(
      { type: "text", text: "abcd" },
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => resultBytes([trap as unknown as ResultContentBlock])).not.toThrow();
    // every property read throws → 0 bytes
    expect(resultBytes([trap as unknown as ResultContentBlock])).toBe(0);
  });
});

describe("approxTokens — byte→token conversion (spec/04 §5, spec/07 §1 '8 KB ≈ 2k tokens')", () => {
  it("0 bytes → 0 tokens", () => {
    expect(approxTokens(0)).toBe(0);
  });

  it("divides bytes by CHARS_PER_TOKEN=4 with ceil (GOTCHA #5)", () => {
    expect(approxTokens(40)).toBe(10); // 40/4 = 10
    expect(approxTokens(41)).toBe(11); // ceil(41/4) = 11
    expect(approxTokens(1)).toBe(1);   // ceil(1/4) = 1 (non-empty → ≥1 token)
  });

  it("reproduces spec/07 §1's '8 KB ≈ 2k tokens' equivalence EXACTLY (load-bearing — GOTCHA #4)", () => {
    expect(approxTokens(8192)).toBe(2048); // the default bloatThresholdBytes → ~2k tokens
  });

  it("negative bytes → 0 (defensive — tokens can't be negative)", () => {
    expect(approxTokens(-100)).toBe(0);
    expect(approxTokens(-1)).toBe(0);
  });

  it("NaN / Infinity → 0 (defensive — nonsense token counts)", () => {
    expect(approxTokens(Number.NaN)).toBe(0);
    expect(approxTokens(Number.POSITIVE_INFINITY)).toBe(0);
    expect(approxTokens(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("is monotonic non-decreasing in bytes", () => {
    expect(approxTokens(100)).toBeLessThanOrEqual(approxTokens(200));
    expect(approxTokens(8000)).toBe(2000);
    expect(approxTokens(8001)).toBe(2001); // ceil boundary
  });

  it("composes end-to-end with resultBytes (the spec/07 §1 pipeline)", () => {
    // An 8000-byte ASCII text result → 8000 bytes → 2000 tokens.
    const bytes = resultBytes([{ type: "text", text: "a".repeat(8000) }]);
    expect(bytes).toBe(8000);
    expect(approxTokens(bytes)).toBe(2000);
  });
});

describe("types (P1.M2.T1.S2)", () => {
  it("ResultContentBlock accepts TextContent and ImageContent shapes (structural)", () => {
    const text: ResultContentBlock = { type: "text", text: "hi" };
    const image: ResultContentBlock = { type: "image", data: "AAAA", mimeType: "image/png" };
    expectTypeOf(text).toEqualTypeOf<ResultContentBlock>();
    expectTypeOf(image).toEqualTypeOf<ResultContentBlock>();
  });

  it("resultBytes returns a number; approxTokens returns a number", () => {
    expectTypeOf(resultBytes([])).toEqualTypeOf<number>();
    expectTypeOf(approxTokens(0)).toEqualTypeOf<number>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: byte-counting ASYMMETRY (GOTCHA #3). text → UTF-8 bytes; image → base64 char length (== bytes for ASCII).
export function resultBytes(content) {
  if (!Array.isArray(content)) return 0;            // defensive: tool_result content is always an array
  let bytes = 0;
  for (const block of content) {
    if (!isRecord(block)) continue;                 // reuse S1's isRecord (hoisted)
    const type = readOwn(block, "type");            // reuse S1's readOwn (Proxy-safe)
    if (type === "text")  bytes += stringByteLength(readOwn(block, "text"));   // NEW: UTF-8 byte length
    else if (type === "image") bytes += stringLength(readOwn(block, "data"));  // reuse S1's stringLength (.length)
  }
  return bytes;
}
function stringByteLength(v) { return typeof v === "string" ? Buffer.byteLength(v, "utf8") : 0; }  // Buffer is a GLOBAL

// PATTERN: reuse CHARS_PER_TOKEN + Math.ceil + defensive guard (GOTCHA #4/#5/#6).
export function approxTokens(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 0;          // NaN/±Inf/negative → 0
  return Math.ceil(bytes / CHARS_PER_TOKEN);                    // S1's exported 4; 8192 → 2048
}

// GOTCHA #1: APPEND to S1's file — reuse isRecord/readOwn/stringLength/CHARS_PER_TOKEN, redeclare NONE.
// GOTCHA #2: Buffer is a global — NO import (zero-imports gate stays green).
// GOTCHA #3: text=byteLength(utf8), image=.length; do NOT swap.
// GOTCHA #8: these are EXACT integers — test with toBe (the "café"→5 case proves byte≠char).
```

### Integration Points

```yaml
DOWNSTREAM CONSUMERS (all later subtasks — none import resultBytes/approxTokens yet):
  - nudges.ts tool_result handler (P1.M6.T1.S1): const bytes = resultBytes(event.content);
      if (bytes < config.nudges.bloatThresholdBytes) return;   // 8192 default — measured in BYTES
      recordBloatHit(ctx, event.toolName, approxTokens(bytes)); // stored in TurnMetric.bloatHits[].approxTokens
  - TurnMetric (spec/04 §5): bloatHits: { toolName: string; approxTokens: number }[] — approxTokens output shape.

NO DATABASE / NO ROUTES / NO NEW DEPS — resultBytes/approxTokens use only Buffer (global) + Math (builtin) + S1's
existing helpers. Nothing is added to package.json. No persistence, no logging, no Pi handle (pure over args).
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Task 1)

```bash
# Type-check the appended module + test (include:["src","test"] covers them):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# Scope gate — tokens.ts is STILL import-free (S1 GOTCHA #2; S2 adds none — Buffer is a global):
test "$(grep -cE '^import|^from' src/tokens.ts)" = "0"   # expect 0
# Confirm the 2 new exported functions + ResultContentBlock exist (alongside S1's 5 exports):
grep -cE 'export (function|interface) (resultBytes|approxTokens|ResultContentBlock)\b' src/tokens.ts  # expect 3
# Confirm S1's estimateTokens + CHARS_PER_TOKEN are still present (append-only — not clobbered):
grep -q 'export function estimateTokens' src/tokens.ts && grep -q 'export const CHARS_PER_TOKEN = 4' src/tokens.ts && echo "ok: S1 intact"

# Expected: tsc exit 0; all grep gates pass. If tsc errors (e.g. duplicate-function from re-declaring isRecord),
# READ the output — you likely re-declared an S1 helper instead of reusing it (GOTCHA #1).
```

### Level 2: Unit tests (run after Task 2)

```bash
# The full tokens suite (S1 estimateTokens + S2 resultBytes/approxTokens):
npx vitest run test/tokens.test.ts        # MUST be all-green

# Full suite — must NOT regress anything (pure, append-only, import-free additions):
npx vitest run                             # MUST be all-green (tokens + config + log + runtime)

# Expected: every resultBytes/approxTokens test green. If any fail, debug the ROOT CAUSE and fix — do not weaken
# asserts. Particular attention: the UTF-8 multibyte case ("café"→5, GOTCHA #3/#8), the "8 KB ≈ 2k tokens" case
# (approxTokens(8192)=2048, GOTCHA #4), and the defensive cases (non-array→0, negative/NaN/Inf→0, Proxy→0).
```

### Level 3: Integration / runtime (N/A for these pure helpers)

`resultBytes`/`approxTokens` have **no Pi dependency and no lifecycle wiring** — they are pure functions fully
covered by the Level 2 unit suite. Real integration (the `tool_result` nudge handler calling them) arrives in
**P1.M6.T1.S1**. Nothing to run here.

### Level 4: Creative / domain-specific validation (optional sanity check)

```bash
# Optional hand-proof that byte-counting is multibyte-aware and the 8 KB ≈ 2k equivalence holds:
node --input-type=module -e "
import { resultBytes, approxTokens } from './src/tokens.ts';
console.log('ascii', resultBytes([{type:'text',text:'abc'}]));                 // 3
console.log('utf8',  resultBytes([{type:'text',text:'café'}]));                // 5 (multibyte)
console.log('img',   resultBytes([{type:'image',data:'abcdefgh',mimeType:'image/png'}])); // 8
console.log('empty', resultBytes([]));                                         // 0
console.log('8kb',   approxTokens(8192));                                      // 2048
console.log('ceil',  approxTokens(41));                                        // 11
console.log('e2e',   approxTokens(resultBytes([{type:'text',text:'a'.repeat(8000)}]))); // 2000
"
# Expected: 3, 5, 8, 0, 2048, 11, 2000.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Applicable validation levels (1 + 2) completed successfully (3/4 N/A for pure helpers).
- [ ] All tests pass: `npx vitest run test/tokens.test.ts` and `npx vitest run`.
- [ ] Type-check passes: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Zero imports maintained: `grep -cE '^import|^from' src/tokens.ts` → 0.
- [ ] S1's `estimateTokens` + `CHARS_PER_TOKEN` intact (append-only — not clobbered).

### Feature Validation

- [ ] All success criteria from "What" section met (empty→0, ASCII bytes, UTF-8 multibyte bytes, image length,
      defensive, 8 KB→2k, ceil, composition).
- [ ] `resultBytes` uses `Buffer.byteLength(text, "utf8")` for text and `.length` for image (GOTCHA #3 asymmetry).
- [ ] `approxTokens` reuses `CHARS_PER_TOKEN` with `Math.ceil`; guards non-finite/negative → 0 (GOTCHA #4/#5/#6).
- [ ] Neither helper ever throws (non-array content, non-record blocks, throwing-Proxy blocks all → 0).
- [ ] `approxTokens(8192) === 2048` (reproduces spec/07 §1 "8 KB ≈ 2k tokens").
- [ ] `resultBytes([{type:"text",text:"café"}]) === 5` (proves UTF-8 byte counting, not char counting).

### Code Quality Validation

- [ ] Follows the foundation-module pattern (Pi-free, import-free, append-only, reuses S1 helpers) like config/log.
- [ ] Appended section is clearly delimited and documented (JSDoc cites spec/07 §1, spec/04 §5, GOTCHA references).
- [ ] Anti-patterns avoided (see below — no `.length` for text, no Buffer import, no floor, no throwing, no
      BYTES_PER_TOKEN, no recreating S1's file).
- [ ] No new dependencies added to package.json.

### Documentation & Deployment

- [ ] Every new export has a JSDoc block citing the spec section it implements + the relevant GOTCHA.
- [ ] The byte/char asymmetry and the CHARS_PER_TOKEN reuse are documented inline (so a future maintainer doesn't
      "fix" them). No new environment variables (none needed).

---

## Anti-Patterns to Avoid

- ❌ **Recreating `src/tokens.ts` / `test/tokens.test.ts`** — S1 owns them; S2 APPENDS (edits the test import +
  appends blocks). Recreating clobbers S1's `estimateTokens` (GOTCHA #1).
- ❌ **`import { Buffer }`** — it's a Node global; the import is unnecessary AND breaks the zero-imports gate
  (GOTCHA #2). Just use `Buffer.byteLength(...)`.
- ❌ **`.length` (char count) for TEXT** — undercounts multibyte results (a 16 KB CJK log reads ~6 KB chars → slips
  under the 8 KB threshold, violating spec/07 §1 "UTF-8 byte length"). Use `Buffer.byteLength(text, "utf8")`
  (GOTCHA #3).
- ❌ **`Buffer.byteLength` for IMAGE** — identical to `.length` for ASCII base64, but drifts from the contract.
  Match the contract: `data?.length ?? 0` (GOTCHA #3).
- ❌ **`Math.floor(bytes / 4)`** — a 1–3 byte result reports 0 tokens (breaks "non-empty → ≥1"). Use `ceil`
  (GOTCHA #5).
- ❌ **Defining a separate `BYTES_PER_TOKEN = 4`** — redundant; reuse S1's exported `CHARS_PER_TOKEN` (GOTCHA #4).
- ❌ **Re-declaring `isRecord`/`readOwn`/`stringLength`** — they exist (S1, module scope); re-declaring is a
  duplicate-function TS error. Reuse them (GOTCHA #1).
- ❌ **Throwing on malformed input** — crashes the tool_result metric path. Always fail-open (GOTCHA #6).
- ❌ **Letting `approxTokens` return `NaN`/`Infinity`/negative** — guard non-finite + negative → 0 (GOTCHA #6).
- ❌ **Adding a second `from "../src/tokens.js"` import in the test** — duplicate-import TS error; edit the
  existing one (GOTCHA #7).