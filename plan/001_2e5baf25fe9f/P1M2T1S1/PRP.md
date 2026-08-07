# PRP — P1.M2.T1.S1: `estimateTokens(messages, model?)` with confidence flag (`src/tokens.ts` + `test/tokens.test.ts`)

**Work item:** P1.M2.T1.S1 · **Points:** 1 · **Stage:** Pure Helper Library → Token Estimation Helpers
**Scope:** **CREATE** two new files only — `src/tokens.ts` (the `estimateTokens` pure helper) and `test/tokens.test.ts`
(its unit suite).
**Do NOT modify** `src/index.ts`, `src/config.ts`, `src/log.ts`, `src/runtime.ts`, or anything else (see *Scope decision*).

---

## Goal

**Feature Goal**: Ship Mulligan's **approximate, no-tokenizer token estimator** as a **self-contained,
deterministic, Pi-free, import-free, side-effect-free** pure function `estimateTokens(messages, model?)` in
`src/tokens.ts`. It stringifies each message's content (a plain string OR an array of content blocks: `text`,
`thinking`, `toolCall`, `image`), sums the character lengths, divides by **`CHARS_PER_TOKEN = 4`** (the standard
English-text rule of thumb), and returns `{ tokens, confidence }`. It is the single token primitive consumed by
the filter turn-metric, the audit tool, and the drift nudge.

**Deliverable** (two new files):
1. `src/tokens.ts` exporting:
   - `const CHARS_PER_TOKEN = 4` — the heuristic ratio (exported for transparency + S2/test reuse).
   - `type TokenConfidence = "low" | "medium" | "high"` — structurally identical to `config.ts`'s `EstimateConfidence`.
   - `interface TokenEstimate { tokens: number; confidence: TokenConfidence }`.
   - `interface MessageLike` + module-local content-block types — minimal structural shapes matching the verified Pi
     message shapes (`architecture/api_verification.md` §6).
   - `function estimateTokens(messages: MessageLike[] | null | undefined, model?: unknown): TokenEstimate`.
2. `test/tokens.test.ts` — a vitest suite asserting empty→0, monotonicity (longer `<` ; add-message `≥`),
   the `CHARS_PER_TOKEN` division, a **stable snapshot**, **every message role** handled (user string/blocks,
   assistant text+thinking+toolCall, toolResult, custom string/blocks), image/base64 contribution,
   **defensive (never throws)** behavior, the unused-but-accepted `model?` param, and exported types.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (the new module + test are type-sound under `strict`).
- `npx vitest run` is **all-green** — the new `tokens` suite **and** the pre-existing `config`/`log` suites (and
  `runtime` once P1.M1.T4S1 lands — this is a pure, import-free module; it cannot regress them).
- `src/tokens.ts` has **zero imports** — no Pi, no config, no log, no runtime (`grep -cE '^import|^from' src/tokens.ts`
  → **0**). It is foundation-tier and fully unit-testable in isolation.
- **Monotonic** in input length, **empty → 0**, **deterministic** (same input ⇒ same output across runs).
- **Never throws** — a malformed message (missing content, throwing Proxy trap, circular `arguments`) estimates to ≥0.

---

## User Persona

**Target User**: The implementing AI agents for **every token-aware downstream module**:
- `tools/audit.ts` (P1.M5.T4S1): calls `estimateTokens([msg]).tokens` per message to build the per-message
  size breakdown + total (spec/05 §4 behavior step 2). Reads `config.audit.estimateConfidence` to set the
  REPORTED confidence label (the consumer-side override seam — see *Why a default + consumer override*).
- `nudges.ts` (P1.M6.T2.S1): uses `estimateTokens` for the `turn_end` token delta vs
  `config.nudges.driftThresholdTokens` (spec/03 §3.3, spec/04 §5).
- `filter.ts` (P1.M4.T2): the turn metric indirectly depends on this primitive (spec/06 §7 caching + spec/04 §5).

**Use Case**: A handler builds a message list and asks "roughly how many tokens is this?" —
`const { tokens, confidence } = estimateTokens(messages);`. For a single message's size:
`const t = estimateTokens([message]).tokens;`. No Pi session, no model, no tokenizer — just a fast char heuristic.

**User Journey**:
1. The audit tool reads the cached `lastFiltered` (runtime.ts) or falls back to `buildContextEntries()`.
2. It calls `estimateTokens([msg])` for each message, sorts desc, renders "Top messages by size".
3. It computes the total via `estimateTokens(filtered).tokens` and labels it `confidence: config.audit.estimateConfidence`.
4. The agent sees "9,412 toolResult read src/big.log ⚠" and decides to `mulligan_shrink` it.

**Pain Points Addressed**: Mulligan needs an **honest, monotonic** token proxy that reflects *what the model
actually sees* (the filtered view), NOT `ctx.getContextUsage()` (D5 — that counts hidden messages). A char-count
heuristic is the right tool: model-agnostic, zero-dep, O(n), and accurate enough for "is this result bloated?"
/ "did this turn drift?" decisions. The `confidence` flag is the honesty mechanism (`spec/01` §7).

---

## Why

- **Unblocks three downstream modules.** `estimateTokens` is read by `tools/audit.ts`, `nudges.ts`, and the
  filter turn-metric (5+ later subtasks). Shipping it now (foundation tier, spec/11 §2 Step 2, alongside
  `ledger.ts`/`notes.ts`) lets those tasks focus on their own logic.
- **Model-agnostic by construction.** A tokenizer library (tiktoken, etc.) is model-specific (OpenAI BPE ≠
  Claude/Gemini encodings) and is **explicitly forbidden** (`spec/01` §7, `spec/03` §2.3,
  `architecture/external_deps.md` line 114). A char heuristic works for every model and needs no dep.
- **Right level of accuracy for advisory use.** Every Mulligan use of tokens (audit display, drift threshold,
  bloat flag) needs a **monotonic, stable, cheap** proxy — not a billing-exact count. `spec/01` §7 + `spec/04`
  §5 + `spec/05` §4 all confirm estimates are reported AS estimates with a confidence flag.
- **Foundation-tier & import-free (like `config.ts` / `log.ts` / `runtime.ts`).** `tokens.ts` imports **nothing**.
  This keeps it a pure, fast, deterministic, isolated unit-test target and honors the work-item contract
  ("internal pure helper"). No config↔tokens coupling, no Pi handle.

---

## What

Create `src/tokens.ts` (exact content in *Implementation Blueprint → Task 1*) and `test/tokens.test.ts` (exact
content in *Task 2*). The module:

- Holds **no** module-scoped mutable state (unlike config/log/runtime) — it is a pure function over its input.
- `CHARS_PER_TOKEN = 4` (exported module constant — the English-text rule of thumb; see research).
- `estimateTokens(messages, model?)`: validates the input is an array (else `[]`), sums `messageCharLength(msg)`
  over each message, returns `{ tokens: Math.ceil(chars / CHARS_PER_TOKEN), confidence: "medium" }`.
- `messageCharLength` / `blockCharLength` / defensive helpers are **module-private** (not exported); they never
  throw (fail-open like `log.ts`).
- Exports `estimateTokens`, `CHARS_PER_TOKEN`, `TokenConfidence`, `TokenEstimate`, `MessageLike`.

This subtask does **NOT**: touch `index.ts`/`config.ts`/`log.ts`/`runtime.ts`; implement `resultBytes` /
`approxTokens` (that is **P1.M2.T1.S2** — it appends to `src/tokens.ts` next); import config to read the
confidence (the override is the consumer's job — see below); use `model?` for anything in v1 (reserved for
future model-specific calibration); or persist/log anything (pure).

### Success Criteria

- [ ] `src/tokens.ts` is **created** and exports exactly `estimateTokens`, `CHARS_PER_TOKEN`, `TokenConfidence`,
      `TokenEstimate`, `MessageLike`.
- [ ] `test/tokens.test.ts` is **created** and is all-green.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (with the new files).
- [ ] `npx vitest run` is all-green (new `tokens` suite **and** pre-existing suites).
- [ ] `src/tokens.ts` has **zero imports** (`grep -cE '^import|^from' src/tokens.ts` → 0).
- [ ] `estimateTokens([])` → `{ tokens: 0, confidence: "medium" }`; `estimateTokens(null)`/`undefined` → 0.
- [ ] **Monotonic**: a longer single message estimates strictly **more** tokens; adding a message **never
      decreases** the estimate.
- [ ] A known controlled-length string yields a **stable** inline-snapshot (e.g. `"a".repeat(44)` → `11`).
- [ ] Division honors `CHARS_PER_TOKEN`: 40 chars → 10; 41 chars → 11 (ceil).
- [ ] Every role is handled: user(string), user(text+image blocks), assistant(text+thinking+toolCall),
      toolResult(text), custom(string), custom(text block); a mixed list sums across roles.
- [ ] Image base64 data is counted (deliberate overestimate; monotonic).
- [ ] **Never throws** on: missing content, null content, unknown block type, non-record block element, non-array
      content, circular `toolCall.arguments`, a throwing Proxy accessor.
- [ ] `model?` is accepted (incl. an object and `undefined`) and does **not** change the v1 estimate.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `src/tokens.ts` and `test/tokens.test.ts` content is given verbatim below
> (Task 1 / Task 2). The message/content-block shapes are quoted from the verified
> `architecture/api_verification.md` §6.1/§6.2. The `CHARS_PER_TOKEN = 4` constant is grounded in the cited
> OpenAI rule of thumb (research/external_best_practices.md). The test convention (vitest, `../src/tokens.js`
> import, `describe`/`it`/`expectTypeOf`) is reproduced from the live `test/config.test.ts`. The two non-obvious
> decisions — *why local structural types instead of importing Pi's `AgentMessage`* and *why a default
> confidence instead of reading config* — are documented with verified evidence. No prior knowledge beyond
> "the foundation modules (`config.ts`/`log.ts`/`runtime.ts`) exist and pass `tsc`/`vitest`" is required.

### Scope decision (READ BEFORE CODING)

- **Do NOT modify `src/index.ts` / `config.ts` / `log.ts` / `runtime.ts`.** `tokens.ts` is a new foundation file.
- **Do NOT implement `resultBytes` / `approxTokens`.** That is **P1.M2.T1.S2** (the sibling subtask that appends
  to this same file next). S1 owns `estimateTokens` + `CHARS_PER_TOKEN` + the structural types only.
- **Do NOT import config.ts** to read the confidence. `tokens.ts` is import-free; the confidence override is the
  audit tool's (consumer's) job (see *Why a default + consumer override*).
- **Do NOT import the `AgentMessage` alias from `runtime.ts`.** It is an opaque `Record<string, unknown>` there,
  which gives `tokens.ts` nothing for content introspection. Define local structural types instead (GOTCHA #1).

### Why a default + consumer override (the one design subtlety — read this)

The work-item contract says *"Return confidence 'medium' by default (configurable via audit config)"* and pins
the signature to `estimateTokens(messages, model?)` — **no config parameter**. Two facts are in tension:

1. `estimateTokens` is a **pure, import-free** foundation helper (no config import allowed).
2. The confidence is supposed to be **configurable via `config.audit.estimateConfidence`**.

**Resolution (the only faithful reading):** `estimateTokens` returns `confidence: "medium"` (its default). The
**audit tool** (P1.M5.T4S1, the primary consumer) reads `config.audit.estimateConfidence` and **overrides** the
reported confidence when rendering the report (e.g.
`{ ...estimateTokens(filtered), confidence: config.audit.estimateConfidence }`). This keeps `tokens.ts` pure
while making the label genuinely user-configurable at the seam where config is available. `model?` is accepted
but **unused in v1** (reserved for future model-specific calibration — the heuristic is model-agnostic today).

### Documentation & References

```yaml
# MUST READ — authoritative sources for this module
- file: spec/03-architecture.md
  section: "§2.3 Pure helpers"
  why: "THE source of the estimateTokens contract: 'estimateTokens(messages, model?) — character/structure-based
        estimate with a confidence flag.' Confirms it is a PURE helper unit-testable without Pi (line 193)."
  critical: "estimateTokens is grouped with ledger/notes/transforms as pure helpers — it imports nothing."

- file: spec/01-pi-context-internals.md
  section: "§7 getContextUsage — 'Estimate fuzziness'"
  why: "'per-message estimates are approximate, more so with images and tool schemas. Mulligan reports estimates
        AS estimates, with a confidence flag.' This is WHY a char heuristic + confidence flag is correct, and WHY
        audit must NOT use ctx.getContextUsage() (D5)."
  critical: "Images/base64 are the fuzziest — the confidence flag carries that honesty; counting base64 length is
        a deliberate, documented overestimate."

- file: spec/04-data-model.md
  section: "§7 Configuration → audit.estimateConfidence: 'low'|'medium'|'high' (default 'medium')"
  why: "Defines the confidence union + default 'medium'. tokens.ts defines a STRUCTURALLY IDENTICAL local
        TokenConfidence (no import) so audit can mix values with no cast."

- file: spec/05-tools.md
  section: "§4 mulligan_audit → Behavior step 2 ('estimateTokens per message; sort desc')"
  why: "THE consumer: audit calls estimateTokens([msg]).tokens per message and estimateTokens(filtered).tokens for
        the total, then labels with config.audit.estimateConfidence (the consumer-side override seam)."

- file: spec/10-testing.md
  section: "§1.7 estimateTokens"
  why: "THE test contract: 'Monotonic in input length; empty → 0; confidence flag present. A known string yields a
        stable estimate (snapshot test).' Every assertion in test/tokens.test.ts traces to this."

- file: spec/11-build-order.md
  section: "§1 Repository layout ('tokens.ts // PURE: estimateTokens, resultBytes, approxTokens') + §2 Step 2"
  why: "Confirms src/tokens.ts + test/tokens.test.ts are the file targets, and that S1=estimateTokens while
        S2=resultBytes+approxTokens (BOTH append to the same file; S1 creates it)."
  critical: "S1 MUST NOT stub resultBytes/approxTokens — leave them entirely to S2."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§6 AgentMessage Union + §6.1 Message Types + §6.2 Content Blocks"
  why: "VERIFIED Pi shapes to mirror in the local structural types: user/assistant/toolResult/custom content
        variants and the TextContent/ThinkingContent/ImageContent/ToolCall block shapes."
  critical: "ToolCall.arguments is Record<string,any> → JSON.stringify can throw on circular refs/BigInt → MUST be
        wrapped (fail-open). The real Pi AgentMessage is NOT importable (see P1M1T4S1 PRP GOTCHA #1)."

- file: plan/001_2e5baf25fe9f/architecture/external_deps.md
  section: "line 114: 'Any tokenizer library (tokens are estimated via character-count heuristic)'"
  why: "Hard rule: NO tokenizer dependency. The char heuristic is mandatory, not a shortcut."

- url: https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
  why: "OpenAI's official rule of thumb: '1 token ≈ 4 characters' for English. Grounds CHARS_PER_TOKEN = 4."
  critical: "It is an APPROXIMATION (non-English/code/base64 skew it) — hence the mandatory confidence flag."

- file: src/config.ts            # READ-ONLY sibling — owns the canonical EstimateConfidence (frozen by spec)
  why: "config.ts exports type EstimateConfidence = 'low'|'medium'|'high' (line 15) + MulliganConfig.audit.
        estimateConfidence (default 'medium'). tokens.ts defines a STRUCTURALLY IDENTICAL local TokenConfidence
        (no import) — assignable to/from config's type with no cast. tokens.ts must NOT import config."
  pattern: "Mirror the Pi-free / module-constant / fail-open discipline. Do NOT mirror config's module-scoped
        mutable cache (tokens.ts has none)."

- file: src/log.ts               # READ-ONLY sibling — the fail-open pattern to mirror
  why: "log.ts wraps the risky op (appendFileSync/JSON.stringify) in try/catch and NEVER throws. tokens.ts mirrors
        this for JSON.stringify(toolCall.arguments) (circular/BigInt → TypeError) and Proxy-trap-throwing
        property reads — a malformed message must estimate to ≥0, never crash the filter/audit/nudge hot path."

- file: test/config.test.ts      # the test convention to mirror
  why: "Establishes: vitest; import from '../src/<file>.js' (note .js for ESM+Bundler); top-level describe/it;
        expectTypeOf for type-level assertions."
  pattern: "Mirror its import style + describe/it structure. NO beforeEach needed (tokens.ts has no module state)."

- file: plan/001_2e5baf25fe9f/P1M1T4S1/PRP.md   # the parallel foundation PRP — read-only contract
  why: "Established that the real Pi AgentMessage is NOT importable (GOTCHA #1) and the foundation-module
        import-free discipline. tokens.ts follows the SAME local-types + import-free approach but needs RICHER
        structural types (content blocks) because it introspects, unlike runtime.ts's opaque alias."

- file: plan/001_2e5baf25fe9f/P1M2T1S1/research/codebase_recon.md
  why: "First-hand recon: exact file targets, the S1/S2 split (S1 owns estimateTokens only), verified message/
        block shapes, the 'configurable via audit config' consumer-override resolution, baseline tsc/vitest state."
- file: plan/001_2e5baf25fe9f/P1M2T1S1/research/external_best_practices.md
  why: "Grounds CHARS_PER_TOKEN=4 (OpenAI), sum-then-divide (not per-block ceil), Math.ceil choice, monotonicity
        invariant, fail-open stringify, and the controlled-length snapshot test technique."

# AUTHORITATIVE estimateTokens contract (implement EXACTLY this):
#   estimateTokens(messages: MessageLike[] | null | undefined, model?: unknown): TokenEstimate
#   interface TokenEstimate { tokens: number; confidence: TokenConfidence }   // confidence = "low"|"medium"|"high"
#   - CHARS_PER_TOKEN = 4 (English rule of thumb; OpenAI)
#   - tokens = Math.ceil(sumOf(stringified content char lengths) / CHARS_PER_TOKEN)
#   - monotonic in input length; empty → 0; deterministic; NEVER throws
#   - confidence defaults to "medium"; the audit TOOL overrides via config.audit.estimateConfidence (pure fn)
#   - model? is unknown and UNUSED in v1 (forward-compat; reserved for model-specific calibration)
```

### Current Codebase tree (state at this subtask's start — verified live)

```bash
pi-mulligan/
├── package.json            # type:'module'; main:'src/index.ts'; pi.extensions:['./src/index.ts'];
│                           # devDeps: typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
├── node_modules/@earendil-works/
│   └── pi-coding-agent     # ONLY this is hoisted; pi-agent-core is NOT → Pi AgentMessage type UNIMPORTABLE
├── src/
│   ├── index.ts            # S2-era no-op stub. DO NOT TOUCH.
│   ├── config.ts           # S1+S2 present (MulliganConfig, EstimateConfidence, getConfig/...). Pi-free. Read-only.
│   ├── log.ts              # present (JSONL logger, fail-open). Pi-free. Read-only.
│   └── runtime.ts          # in-flight (P1.M1.T4S1): per-session map + local opaque AgentMessage alias. Read-only.
├── test/
│   ├── config.test.ts      # the test convention to mirror (vitest, '../src/config.js', describe/it/expectTypeOf)
│   ├── log.test.ts         # the fail-open + beforeEach-reset convention
│   ├── runtime.test.ts     # in-flight (P1.M1.T4S1); independent of tokens.ts
│   └── integration/        # empty
└── spec/                   # 12-doc spec (read-only); 03 §2.3 + 01 §7 + 04 §7 + 05 §4 + 10 §1.7 are authoritative
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0;
#   `npx vitest run` → config + log green (runtime suite has 1 in-flight failure from P1.M1.T4S1 — NOT my concern;
#   tokens.ts is pure + independent and cannot affect it). No vitest config file → defaults + tsconfig.include.
```

### Desired Codebase tree with files to be added (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── tokens.ts           # NEW — estimateTokens + CHARS_PER_TOKEN + TokenConfidence/TokenEstimate/MessageLike.
│                           #       ZERO imports. Pure, deterministic, never-throws.
└── test/
    └── tokens.test.ts      # NEW — vitest suite (empty/monotonic/snapshot/roles/image/defensive/model/types)
# No other files are created or modified. resultBytes/approxTokens are LEFT OUT (P1.M2.T1.S2 appends them next).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — The real Pi AgentMessage union is NOT importable, AND runtime.ts's alias is too opaque.
# pi-agent-core is not hoisted (only pi-coding-agent is) and isn't re-exported (confirmed by the P1M1T4S1 PRP).
# runtime.ts defines type AgentMessage = Record<string, unknown> — fine for STORAGE, but tokens.ts INTROSPECTS
# content blocks, so it needs a RICHER shape. SOLUTION: tokens.ts defines its OWN local structural types
# (MessageLike + a ContentBlock union) matching api_verification.md §6.2. A real Pi AgentMessage[] is assignable
# to MessageLike[] with no cast (structural typing). tokens.ts imports NOTHING.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 — tokens.ts imports NOTHING. Foundation-tier (spec/11 §2 Step 2 groups it with ledger/notes).
# No Pi, no config, no log, no runtime. Grep gate: `grep -cE '^import|^from' src/tokens.ts` → 0. This keeps it a
# pure, deterministic, isolated unit-test target and honors the contract ("internal pure helper").
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — estimateTokens MUST NEVER THROW. It runs on the context/turn_end hot path. A malformed message
# (missing content, null content, a throwing Proxy get-trap, non-record block element, non-array content) must
# contribute ≥0 chars, not crash. Mirror log.ts's fail-open: wrap JSON.stringify(toolCall.arguments) (circular
# refs/BigInt → TypeError) and property reads (Proxy trap → throw) in try/catch. Tests assert this directly.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — Image base64 data is counted at face value (data.length / 4). This is a DELIBERATE OVERESTIMATE:
# a screenshot's base64 is huge but vision tokens are small. Counting it keeps the estimate MONOTONIC + simple;
# the confidence flag ("medium" default) carries the honesty (spec/01 §7: "more so with images"). Do NOT special-
# case images to a fixed token number — that would break monotonicity for differing image sizes.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — Sum char lengths FIRST, then divide ONCE (Math.ceil(totalChars / 4)). Do NOT ceil per-block then
# sum — that inflates small messages (every tiny block rounds up to 1 token). The contract ("Sum character
# lengths, divide by ~4") mandates total-then-divide. Per-message estimates come for free via estimateTokens([msg]).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — Use Math.ceil, NOT floor. ceil gives: empty(0 chars)→0, non-empty(≥1 char)→≥1 token (intuitive —
# "empty→0" is unique to truly empty input), and is a CONSERVATIVE overestimate (safer for drift/threshold
# detection — fires the nudge slightly early rather than late). floor would make 1–3 char messages estimate to 0.
# ceil is monotonic non-decreasing in chars, so monotonicity holds. Tests pin: 40 chars→10, 41 chars→11.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — confidence is returned by estimateTokens as "medium" (DEFAULT), but it is NOT read from config here
# (pure fn). The audit TOOL (consumer) overrides it with config.audit.estimateConfidence at render time. Do NOT
# add a config param to estimateTokens — the signature is FIXED at (messages, model?). model? is unknown + unused
# in v1 (reserved for future model-specific calibration). This is the ONLY faithful reading of the contract.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — S1 owns ONLY estimateTokens + CHARS_PER_TOKEN + the structural types. Do NOT stub/own resultBytes
# or approxTokens — those are P1.M2.T1.S2 (the sibling that appends to this same file next). Leaving them out is
# required, not optional.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — The snapshot test (spec/10 §1.7) must be DETERMINISTIC. Use a controlled-length string
# ("a".repeat(44) → 44 chars → ceil(44/4)=11) rather than hand-counting a prose phrase, so the inline snapshot
# value is exact and self-evident. Do NOT use toMatchSnapshot() (writes a file) — use toMatchInlineSnapshot().
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// Content blocks (api_verification.md §6.2) — minimal, structural. Module-local (not exported); callers pass
// opaque message objects and never construct these directly.
interface TextContent      { type: "text";     text: string }
interface ThinkingContent  { type: "thinking"; thinking: string }
interface ImageContent     { type: "image";    data: string; mimeType: string }   // data = base64
interface ToolCallContent  { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCallContent;

// Minimal structural message shape (§6.1/§6.3). Any Pi AgentMessage variant satisfies this. EXPORTED so tests +
// consumers can type a message list without importing the unresolvable Pi union.
interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

// Structurally identical to config.ts's EstimateConfidence ("low"|"medium"|"high", frozen by spec). No import.
type TokenConfidence = "low" | "medium" | "high";

interface TokenEstimate {
  tokens: number;          // non-negative integer (Math.ceil(chars/4))
  confidence: TokenConfidence;   // "medium" default; audit tool overrides via config.audit.estimateConfidence
}

export const CHARS_PER_TOKEN = 4;   // OpenAI English rule of thumb; see research/external_best_practices.md
```

No Pi types, no config types, no log types, no runtime types — the module is self-contained and import-free.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json            # expect exit 0
  - RUN: npx vitest run                                # config+log green (runtime's in-flight failure is NOT ours)
  - RUN: test ! -f src/tokens.ts && echo "ok: src/tokens.ts absent"   # we are CREATING, not clobbering

Task 1: CREATE src/tokens.ts   (exact content below — copy verbatim)
  - IMPLEMENT: content-block interfaces, MessageLike, TokenConfidence, TokenEstimate, CHARS_PER_TOKEN,
    DEFAULT_TOKEN_CONFIDENCE, estimateTokens, + module-private messageCharLength/blockCharLength/readOwn/
    isRecord/stringLength/safeStringify.
  - FOLLOW pattern: the Pi-free / fail-open (try/catch) style of src/log.ts + the module-constant style of
    src/config.ts. NO module-scoped mutable state (unlike config/log/runtime).
  - CONSTRAINTS:
      * ZERO imports (GOTCHA #2). No Pi, no config, no log, no runtime. grep gate = 0.
      * Sum-then-divide with Math.ceil (GOTCHA #5/#6). CHARS_PER_TOKEN = 4.
      * NEVER throws — JSON.stringify(arguments) + property reads wrapped in try/catch (GOTCHA #3).
      * Image data counted at face value (deliberate overestimate; GOTCHA #4).
      * confidence = "medium" default; model? unused in v1 (GOTCHA #7).
      * DO NOT add resultBytes/approxTokens (GOTCHA #8 — P1.M2.T1.S2 owns them).
  - NAMING/PLACEMENT: file at repo-root src/tokens.ts; exports are the 5 names in Success Criteria.

Task 2: CREATE test/tokens.test.ts   (exact content below — copy verbatim)
  - IMPLEMENT: vitest suite mirroring test/config.test.ts conventions. NO beforeEach (no module state).
  - COVERAGE (each group a describe): spec/10 §1.7 contract (empty→0; null/undef→0; monotonic longer<; monotonic
    add≥; confidence present + 'medium'; stable inline snapshot); CHARS_PER_TOKEN division (40→10, 41→11; const=4);
    every role (user string; user text+image blocks; assistant text+thinking+toolCall; toolResult; custom string;
    custom block; mixed-list sum); defensive/never-throws (no content; null content; unknown block type;
    non-record block element; non-array content; circular arguments; throwing accessor); model? (object + undef
    unchanged); types (return shape; TokenEstimate; MessageLike structural).
  - SNAPSHOT: use toMatchInlineSnapshot with a controlled-length string (GOTCHA #9).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + zero-imports grep gate) and Level 2 (vitest). Levels 3/4 are N/A (pure module, no Pi runtime).
```

#### Exact content to CREATE — `src/tokens.ts` (Task 1 — copy verbatim)

```ts
/**
 * Token estimation helpers — Mulligan's approximate, no-tokenizer token accounting.
 * spec/03-architecture.md §2.3 (pure helpers), spec/01-pi-context-internals.md §7 (estimate fuzziness +
 *   confidence flag), spec/04-data-model.md §7 (EstimateConfidence), spec/11-build-order.md §1 (tokens.ts),
 *   spec/10-testing.md §1.7 (estimateTokens test tier), spec/05-tools.md §4 (audit consumes estimateTokens).
 *
 * DESIGN (read GOTCHA #1–#9 in the PRP):
 * - Foundation-tier and Pi-FREE. Imports NOTHING — not Pi, not config, not log, not runtime. It is a pure,
 *   deterministic, side-effect-free function fully unit-testable in isolation; it honors the work-item contract
 *   ("internal pure helper") and is the consumer of NO other module.
 * - NO tokenizer library (spec/01 §7, spec/03 §2.3, external_deps.md line 114). Tokens are estimated via a
 *   character-count heuristic: ~4 chars ≈ 1 token for English text (OpenAI rule of thumb; see research). This is
 *   intentionally approximate; callers receive a TokenConfidence flag to convey how approximate.
 * - Monotonic in input length, empty → 0, deterministic, and NEVER throws — a malformed message (missing content,
 *   a throwing Proxy trap, circular toolCall.arguments) estimates to ≥0, so it can never crash the
 *   context/turn_end/audit hot path (mirrors log.ts's fail-open discipline).
 *
 * NOTE: P1.M2.T1.S2 (resultBytes + approxTokens) APPENDS to this file next. This module owns estimateTokens +
 * CHARS_PER_TOKEN + the structural types ONLY (GOTCHA #8).
 */

// ── local structural types (api_verification.md §6.1/§6.2) ───────────────────
// The real Pi AgentMessage union lives in @earendil-works/pi-agent-core, which is NOT resolvable here (not
// hoisted; not re-exported — confirmed by the P1.M1.T4S1 PRP GOTCHA #1). estimateTokens INTROSPECTS content
// blocks, so it needs a richer structural shape than runtime.ts's opaque Record<string, unknown> alias. These
// local types match the verified Pi shapes; they are STRUCTURAL — a real Pi AgentMessage[] is assignable to
// MessageLike[] with NO cast.

/** Text content block (user / assistant / toolResult / custom). */
interface TextContent {
  type: "text";
  text: string;
}
/** Thinking content block (assistant only). */
interface ThinkingContent {
  type: "thinking";
  thinking: string;
}
/** Image content block — `data` is base64 (counted at face value; a deliberate overestimate — GOTCHA #4). */
interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
/** Tool call block (assistant only) — the substance is name + arguments (id omitted as overhead). */
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
/** Any content block across the message roles. */
type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCallContent;

/**
 * Minimal structural message shape for estimation. Any Pi AgentMessage variant (user / assistant / toolResult /
 * custom / bashExecution / branchSummary / compactionSummary) satisfies this: each carries a `content` that is
 * either a plain string or an array of content blocks (api_verification.md §6.1/§6.3). Unknown roles and
 * unsupported content shapes are estimated defensively (GOTCHA #3) — estimation NEVER throws.
 */
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

/**
 * Confidence label reported alongside a token estimate — conveys HOW APPROXIMATE the number is, given the
 * estimation method (character heuristic, not a real tokenizer) and content mix (text vs images/tool schemas).
 * spec/04 §7 + spec/09 §2 (config.audit.estimateConfidence), spec/01 §7 ("reports estimates as estimates").
 *
 * Structurally identical to config.ts's EstimateConfidence, so the audit tool can mix values from the two modules
 * with no cast. estimateTokens returns the DEFAULT ("medium"); the audit TOOL overrides it with
 * config.audit.estimateConfidence when rendering (the pure-fn ↔ consumer seam — see PRP GOTCHA #7).
 */
export type TokenConfidence = "low" | "medium" | "high";

/** Result of estimateTokens. */
export interface TokenEstimate {
  /** Non-negative integer token estimate (Math.ceil(totalChars / CHARS_PER_TOKEN)). */
  tokens: number;
  /** Honesty label; defaults to "medium". The audit tool overrides via config.audit.estimateConfidence. */
  confidence: TokenConfidence;
}

/**
 * CHARS_PER_TOKEN — the character-count heuristic ratio. ~4 characters of English text ≈ 1 token (OpenAI rule of
 * thumb; verified in research/external_best_practices.md). EXPORTED so P1.M2.T1.S2 (resultBytes/approxTokens) and
 * tests can reference the same ratio transparently.
 */
export const CHARS_PER_TOKEN = 4;

/** The confidence estimateTokens returns by default (spec/04 §7, spec/09 §2). The audit config is the user knob. */
const DEFAULT_TOKEN_CONFIDENCE: TokenConfidence = "medium";

/**
 * estimateTokens — approximate the in-context token cost of a message list via a character-count heuristic.
 *
 * spec/03-architecture.md §2.3, spec/05-tools.md §4 (audit), spec/06-context-filter.md (turn metric), spec/10
 * §1.7. For each message it stringifies the content (a plain string OR an array of content blocks: text, thinking,
 * toolCall name+arguments, image base64 data), sums the character lengths, and returns
 * Math.ceil(totalChars / CHARS_PER_TOKEN). Monotonic in input length; an empty list → 0. Deterministic. NEVER
 * throws (GOTCHA #3).
 *
 * The estimate is intentionally approximate (no tokenizer; images/tool schemas are fuzzier — spec/01 §7). The
 * returned `confidence` ("medium" default) conveys that; the audit TOOL tunes the REPORTED label via
 * config.audit.estimateConfidence (GOTCHA #7). The `model` parameter is accepted for forward-compatible,
 * model-specific calibration but is NOT used in v1 (the heuristic is model-agnostic).
 *
 * @param messages the message list (a single message is estimated via estimateTokens([msg]))
 * @param model OPTIONAL model descriptor (v1: unused; reserved for future model-specific calibration)
 * @returns { tokens, confidence } — tokens is a non-negative integer; confidence defaults to "medium"
 */
export function estimateTokens(
  messages: MessageLike[] | null | undefined,
  _model?: unknown,
): TokenEstimate {
  const list = Array.isArray(messages) ? messages : [];
  let chars = 0;
  for (const msg of list) {
    chars += messageCharLength(msg);
  }
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
  return { tokens, confidence: DEFAULT_TOKEN_CONFIDENCE };
}

/**
 * messageCharLength — the character length of one message's stringified content. Pure + defensive: a message with
 * no content / non-array blocks / a throwing accessor contributes ≥0 and never throws (GOTCHA #3). Module-local
 * (not exported); callers use estimateTokens([msg]) for per-message estimates (GOTCHA #5: divide once, at the top).
 */
function messageCharLength(msg: MessageLike): number {
  const content = readOwn(msg, "content");
  if (typeof content === "string") {
    return content.length;
  }
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content) {
      n += blockCharLength(block);
    }
    return n;
  }
  return 0; // content absent / null / unsupported shape → contributes nothing (defensive)
}

/** Character length of a single content block (defensive — never throws). */
function blockCharLength(block: unknown): number {
  if (!isRecord(block)) return 0;
  const type = readOwn(block, "type");
  switch (type) {
    case "text":
      return stringLength(readOwn(block, "text"));
    case "thinking":
      return stringLength(readOwn(block, "thinking"));
    case "toolCall": {
      // substance = name + JSON(arguments); the id is overhead and omitted. arguments may be circular/BigInt →
      // safeStringify swallows the TypeError (GOTCHA #3).
      const name = stringLength(readOwn(block, "name"));
      const args = safeStringLength(readOwn(block, "arguments"));
      return name + args;
    }
    case "image":
      // base64 data counted at face value → an OVERESTIMATE of image token cost (a screenshot's base64 is huge but
      // vision tokens are small). Counting it keeps the estimate monotonic + simple; the confidence flag carries
      // the honesty (spec/01 §7). See GOTCHA #4.
      return stringLength(readOwn(block, "data"));
    default:
      return 0; // unknown block type → contributes nothing (forward-compat, defensive)
  }
}

// ── module-private defensive helpers (never throw — GOTCHA #3) ───────────────

/** True for plain records (and Object.create(null)); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable. */
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/** Length of a value when it is a string; 0 otherwise (content fields may be missing/mistyped). */
function stringLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

/** Length of JSON.stringify(value); 0 if value is not stringifiable (circular refs / BigInt → TypeError). */
function safeStringLength(value: unknown): number {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s.length : 0;
  } catch {
    return 0;
  }
}
```

#### Exact content to CREATE — `test/tokens.test.ts` (Task 2 — copy verbatim)

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  estimateTokens,
  CHARS_PER_TOKEN,
  type TokenEstimate,
  type TokenConfidence,
  type MessageLike,
} from "../src/tokens.js";

// No beforeEach needed: tokens.ts has NO module-scoped mutable state (unlike config/log/runtime).

describe("estimateTokens — spec/10 §1.7 contract (empty / monotonic / confidence / snapshot)", () => {
  it("empty message list → 0 tokens", () => {
    expect(estimateTokens([]).tokens).toBe(0);
  });

  it("null / undefined input → 0 tokens (defensive)", () => {
    expect(estimateTokens(null).tokens).toBe(0);
    expect(estimateTokens(undefined).tokens).toBe(0);
  });

  it("is monotonic in input length — a longer single message estimates strictly MORE (spec/10 §1.7)", () => {
    const short: MessageLike[] = [{ role: "user", content: "x".repeat(40) }];
    const long: MessageLike[] = [{ role: "user", content: "x".repeat(400) }];
    expect(estimateTokens(short).tokens).toBeLessThan(estimateTokens(long).tokens);
  });

  it("is monotonic — adding a message NEVER decreases the estimate", () => {
    const one: MessageLike[] = [{ role: "user", content: "hello world" }];
    const two: MessageLike[] = [
      ...one,
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ];
    expect(estimateTokens(two).tokens).toBeGreaterThanOrEqual(estimateTokens(one).tokens);
  });

  it("reports a confidence flag (default 'medium')", () => {
    const r = estimateTokens([{ role: "user", content: "hi" }] as MessageLike[]);
    expect(r.confidence).toBe("medium");
    expect(["low", "medium", "high"]).toContain(r.confidence);
  });

  it("a known controlled-length string yields a stable estimate (inline snapshot — spec/10 §1.7, GOTCHA #9)", () => {
    const known: MessageLike[] = [{ role: "user", content: "a".repeat(44) }]; // exactly 44 chars
    expect(estimateTokens(known).tokens).toMatchInlineSnapshot(`11`); // ceil(44 / 4)
  });
});

describe("estimateTokens — chars-per-token heuristic (~4 chars ≈ 1 token)", () => {
  it("divides total stringified char length by CHARS_PER_TOKEN=4 with ceil (GOTCHA #5/#6)", () => {
    const forty: MessageLike[] = [{ role: "user", content: "a".repeat(40) }]; // 40/4 = 10
    expect(estimateTokens(forty).tokens).toBe(10);
    const fortyOne: MessageLike[] = [{ role: "user", content: "a".repeat(41) }]; // ceil(41/4) = 11
    expect(estimateTokens(fortyOne).tokens).toBe(11);
  });

  it("CHARS_PER_TOKEN is exported and equals 4", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });
});

describe("estimateTokens — handles every message role (api_verification.md §6)", () => {
  it("user message with a plain string content", () => {
    const msgs: MessageLike[] = [{ role: "user", content: "abcd" }]; // 4 chars → 1 token
    expect(estimateTokens(msgs).tokens).toBe(1);
  });

  it("user message with content blocks (text + image) — image base64 counted (GOTCHA #4)", () => {
    const msgs: MessageLike[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "abcd" },                                  // 4
          { type: "image", data: "abcdefgh", mimeType: "image/png" },      // 8
        ],
      },
    ];
    expect(estimateTokens(msgs).tokens).toBe(3); // ceil((4+8)/4) = 3
  });

  it("assistant message with text + thinking + toolCall", () => {
    const msgs: MessageLike[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "abcd" },                                              // 4
          { type: "thinking", thinking: "efgh" },                                      // 4
          { type: "toolCall", id: "1", name: "read", arguments: { path: "a" } },       // name(4)+JSON args(12)=16
        ],
      },
    ];
    expect(estimateTokens(msgs).tokens).toBe(6); // ceil((4+4+16)/4) = 6
  });

  it("toolResult message with text blocks", () => {
    const msgs: MessageLike[] = [
      {
        role: "toolResult", toolCallId: "1", toolName: "read", isError: false,
        content: [{ type: "text", text: "abcdefgh" }], // 8
      },
    ];
    expect(estimateTokens(msgs).tokens).toBe(2); // ceil(8/4) = 2
  });

  it("custom message with plain string content", () => {
    const msgs: MessageLike[] = [
      { role: "custom", customType: "mulligan:note", content: "abcdefgh", display: true },
    ];
    expect(estimateTokens(msgs).tokens).toBe(2); // ceil(8/4) = 2
  });

  it("custom message with content blocks", () => {
    const msgs: MessageLike[] = [
      {
        role: "custom", customType: "mulligan:nudge", display: false,
        content: [{ type: "text", text: "abcd" }],
      },
    ];
    expect(estimateTokens(msgs).tokens).toBe(1); // ceil(4/4) = 1
  });

  it("a mix of roles sums correctly across the whole list (GOTCHA #5: divide once at the top)", () => {
    const msgs: MessageLike[] = [
      { role: "user", content: "abcd" },                                  // 4
      { role: "assistant", content: [{ type: "text", text: "efgh" }] },   // 4
      { role: "toolResult", content: [{ type: "text", text: "ijkl" }] },  // 4
    ];
    expect(estimateTokens(msgs).tokens).toBe(3); // ceil(12/4) = 3
  });
});

describe("estimateTokens — defensive (NEVER throws — GOTCHA #3)", () => {
  it("a message with no content contributes 0", () => {
    expect(estimateTokens([{ role: "user" }] as MessageLike[]).tokens).toBe(0);
  });

  it("a message with null content contributes 0", () => {
    expect(estimateTokens([{ role: "user", content: null }] as MessageLike[]).tokens).toBe(0);
  });

  it("an unknown content-block type contributes 0 (forward-compat)", () => {
    const msgs: MessageLike[] = [
      { role: "user", content: [{ type: "mystery", payload: "ignored" }] },
    ];
    expect(estimateTokens(msgs).tokens).toBe(0);
  });

  it("does not throw on a malformed block array (non-record elements)", () => {
    const msgs: MessageLike[] = [{ role: "user", content: [null, 42, "raw", undefined] as unknown as never[] }];
    expect(() => estimateTokens(msgs)).not.toThrow();
    expect(estimateTokens(msgs).tokens).toBe(0);
  });

  it("does not throw on non-array, non-string content (defensive)", () => {
    const msgs: MessageLike[] = [{ role: "user", content: 12345 as unknown as string }];
    expect(() => estimateTokens(msgs)).not.toThrow();
    expect(estimateTokens(msgs).tokens).toBe(0);
  });

  it("toolCall with circular arguments is sized without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws on this → safeStringLength swallows → 0
    const msgs: MessageLike[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "1", name: "x", arguments: circular }],
      },
    ];
    expect(() => estimateTokens(msgs)).not.toThrow();
    expect(estimateTokens(msgs).tokens).toBe(1); // name "x" = 1 char → ceil(1/4) = 1
  });

  it("does not throw on a throwing Proxy accessor (fail-open like log.ts)", () => {
    const trap: MessageLike = new Proxy(
      { role: "user", content: "abcd" } as MessageLike,
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => estimateTokens([trap])).not.toThrow();
    // every property read throws → 0 chars → 0 tokens
    expect(estimateTokens([trap]).tokens).toBe(0);
  });
});

describe("estimateTokens — model parameter (GOTCHA #7: v1-unused, forward-compat)", () => {
  it("accepts an optional model object without changing the v1 estimate", () => {
    const msgs: MessageLike[] = [{ role: "user", content: "abcd" }];
    const a = estimateTokens(msgs);
    const b = estimateTokens(msgs, { id: "claude-sonnet-4" });
    expect(b.tokens).toBe(a.tokens);
  });

  it("accepts undefined as the model argument", () => {
    const msgs: MessageLike[] = [{ role: "user", content: "abcd" }];
    expect(estimateTokens(msgs, undefined).tokens).toBe(1);
  });
});

describe("types", () => {
  it("returns { tokens: number; confidence: 'low'|'medium'|'high' }", () => {
    const r = estimateTokens([]);
    expectTypeOf(r.tokens).toEqualTypeOf<number>();
    expectTypeOf(r.confidence).toEqualTypeOf<"low" | "medium" | "high">();
  });

  it("CHARS_PER_TOKEN is a number", () => {
    expectTypeOf(CHARS_PER_TOKEN).toEqualTypeOf<number>();
  });

  it("TokenEstimate has the documented shape", () => {
    expectTypeOf<TokenEstimate>().toEqualTypeOf<{ tokens: number; confidence: "low" | "medium" | "high" }>();
  });

  it("TokenConfidence is the 3-value union", () => {
    expectTypeOf<TokenConfidence>().toEqualTypeOf<"low" | "medium" | "high">();
  });

  it("MessageLike accepts real-ish Pi message shapes (structural typing)", () => {
    const m1: MessageLike = { role: "user", content: "hi" };
    const m2: MessageLike = { role: "assistant", content: [{ type: "text", text: "hi" }] };
    expectTypeOf(m1).toEqualTypeOf<MessageLike>();
    expectTypeOf(m2).toEqualTypeOf<MessageLike>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: sum-then-divide ONCE with Math.ceil (GOTCHA #5/#6). Per-message estimates come from estimateTokens([msg]).
export function estimateTokens(messages, _model?) {
  const list = Array.isArray(messages) ? messages : [];
  let chars = 0;
  for (const msg of list) chars += messageCharLength(msg);
  return { tokens: Math.ceil(chars / CHARS_PER_TOKEN), confidence: DEFAULT_TOKEN_CONFIDENCE };
}

// PATTERN: stringify every content-bearing block (text/thinking/toolCall/image) for an honest size signal.
function blockCharLength(block) {
  switch (readOwn(block, "type")) {
    case "text":     return stringLength(readOwn(block, "text"));
    case "thinking": return stringLength(readOwn(block, "thinking"));
    case "toolCall": return stringLength(readOwn(block, "name")) + safeStringLength(readOwn(block, "arguments"));
    case "image":    return stringLength(readOwn(block, "data")); // base64, deliberate overestimate (GOTCHA #4)
    default:         return 0;
  }
}

// PATTERN: fail-open reads/stringify (mirror log.ts — GOTCHA #3). NEVER throws on the hot path.
function readOwn(obj, key)      { try { return obj[key]; } catch { return undefined; } }
function safeStringLength(v)    { try { return JSON.stringify(v)?.length ?? 0; } catch { return 0; } }

// GOTCHA #1: real Pi AgentMessage unimportable → local structural MessageLike + ContentBlock. Assignable-in, no cast.
// GOTCHA #7: confidence = "medium" default; the audit TOOL overrides via config.audit.estimateConfidence (pure fn).
```

### Integration Points

```yaml
DOWNSTREAM CONSUMERS (all later subtasks — none import tokens.ts yet):
  - tools/audit.ts (P1.M5.T4S1): const est = estimateTokens(filtered); const per = estimateTokens([msg]).tokens;
      reported confidence = config.audit.estimateConfidence (consumer override of est.confidence).
  - nudges.ts     (P1.M6.T2):   delta = estimateTokens(now).tokens - baseline;  // turn_end drift metric
  - filter.ts     (P1.M4.T2):   caches lastFiltered in runtime.ts; audit estimates over it.

SIBLING (next subtask — appends to THIS file):
  - P1.M2.T1.S2: adds resultBytes(content) + approxTokens(bytes) to src/tokens.ts. May define its own
    BYTES_PER_TOKEN (bytes ≠ chars for UTF-8). S1 leaves these OUT entirely (GOTCHA #8).

NO DATABASE / NO ROUTES / NO NEW DEPS — tokens.ts imports nothing; Math/JSON are JS builtins. Nothing is added to
package.json. No persistence, no logging, no Pi handle (C12-clean by construction — pure function over its args).
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Task 1)

```bash
# Type-check the new module + test (include:["src","test"] already covers them):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# Scope gate — tokens.ts is import-free (GOTCHA #2): no Pi, no config, no log, no runtime.
test "$(grep -cE '^import|^from' src/tokens.ts)" = "0"   # expect 0
# Confirm the 5 exports exist:
grep -cE 'export (function|const|type|interface) (estimateTokens|CHARS_PER_TOKEN|TokenConfidence|TokenEstimate|MessageLike)\b' src/tokens.ts  # expect 5

# Expected: tsc exit 0; both grep gates pass. If tsc errors, READ the output and fix before proceeding.
```

### Level 2: Unit tests (run after Task 2)

```bash
# The new tokens suite in isolation:
npx vitest run test/tokens.test.ts        # MUST be all-green

# Full suite — must NOT regress config/log (this is a pure, independent, import-free module):
npx vitest run                             # MUST be all-green (tokens + config + log; + runtime once P1.M1.T4S1 lands)

# Expected: every tokens test green. If any fail, debug the ROOT CAUSE and fix the implementation — do not weaken
# asserts. Particular attention: the spec/10 §1.7 group (monotonicity, empty→0, snapshot) and the defensive group
# (never throws on circular args / Proxy trap / malformed blocks).
```

### Level 3: Integration / runtime (N/A for this pure module)

`tokens.ts` has **no Pi dependency and no lifecycle wiring** — it is a pure function fully covered by the Level 2
unit suite. Real integration (audit/nudge/filter calling `estimateTokens`) arrives in **P1.M5.T4 / P1.M6.T2 /
P1.M4.T2**. Nothing to run here.

### Level 4: Creative / domain-specific validation (optional sanity check)

```bash
# Optional hand-proof that the heuristic divides cleanly and images are counted:
node --input-type=module -e "
import { estimateTokens } from './src/tokens.ts';
console.log('empty', estimateTokens([]).tokens);                                   // 0
console.log('40a', estimateTokens([{role:'user',content:'a'.repeat(40)}]).tokens); // 10
console.log('img', estimateTokens([{role:'user',content:[{type:'image',data:'x'.repeat(8000),mimeType:'image/png'}]}]).tokens); // 2000
"
# Expected: 0, 10, 2000 (image base64 counted at face value — deliberate overestimate; confidence stays 'medium').
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All applicable validation levels (1 + 2) completed successfully (3/4 N/A for a pure module).
- [ ] All tests pass: `npx vitest run test/tokens.test.ts` and `npx vitest run`.
- [ ] Type-check passes: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Zero imports: `grep -cE '^import|^from' src/tokens.ts` → 0.

### Feature Validation

- [ ] All success criteria from "What" section met (empty→0, monotonic, snapshot, roles, defensive, model?).
- [ ] `estimateTokens` never throws (circular args, Proxy trap, malformed blocks all covered by tests).
- [ ] `CHARS_PER_TOKEN = 4` and division uses `Math.ceil` (40→10, 41→11).
- [ ] Confidence defaults to `"medium"`; consumer-override seam documented (audit tool applies config).
- [ ] `resultBytes`/`approxTokens` are NOT present (left to P1.M2.T1.S2).

### Code Quality Validation

- [ ] Follows the foundation-module pattern (Pi-free, import-free, module constants, fail-open) like config/log.
- [ ] File placement matches the desired codebase tree (`src/tokens.ts` + `test/tokens.test.ts`).
- [ ] Anti-patterns avoided (see below — no per-block ceil, no tokenizer import, no throwing, no config import).
- [ ] No new dependencies added to package.json.

### Documentation & Deployment

- [ ] Every export has a JSDoc block citing the spec section it implements.
- [ ] The `model?` forward-compat reservation and the consumer-side confidence seam are documented inline.
- [ ] No new environment variables (none needed).

---

## Anti-Patterns to Avoid

- ❌ **Per-block `ceil` then sum** — inflates small messages. Sum first, divide once (GOTCHA #5).
- ❌ **Importing a tokenizer / `pi-agent-core`** — unresolvable here + forbidden by spec (`external_deps.md`).
- ❌ **`Math.floor`** — makes 1–3 char messages estimate to 0 (breaks "empty→0" uniqueness). Use `ceil` (GOTCHA #6).
- ❌ **Throwing on malformed input** — crashes the context/turn_end hot path. Always fail-open (GOTCHA #3).
- ❌ **Letting `model?` change v1 behavior** — reserve it for future calibration; the heuristic is model-agnostic.
- ❌ **Importing `config.ts` to read the confidence** — breaks the pure-helper tier; override at the consumer (GOTCHA #7).
- ❌ **Special-casing images to a fixed token count** — breaks monotonicity for differing image sizes; count base64 length (GOTCHA #4).
- ❌ **Stubbing `resultBytes`/`approxTokens`** — those belong to P1.M2.T1.S2; leave them out (GOTCHA #8).
- ❌ **`toMatchSnapshot()` (writes a file)** — use `toMatchInlineSnapshot()` for a deterministic, self-contained snapshot (GOTCHA #9).