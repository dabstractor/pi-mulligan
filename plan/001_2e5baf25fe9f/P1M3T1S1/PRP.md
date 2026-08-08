# PRP — P1.M3.T1.S1: `partitionIntoUnits` — pairing-aware message grouping

**Work item:** P1.M3.T1.S1 · **Points:** 2 · **Stage:** Pure Core — Context Filter Transforms (the correctness heart)
**Scope:** **CREATE two new files** — `src/transforms.ts` (the `partitionIntoUnits` function + the `Unit` interface +
the local `MessageLike` + two module-private defensive helpers) and `test/transforms.test.ts` (vitest Tier-1 tests).
**No other file is touched.** Zero Pi dependency; never throws. This is **S1 of the `transforms.ts` build** (spec/11
§2 Step 3): it ships the pairing primitive that EVERY later P1.M3 sibling (`resolveLastToolCallGroup` T2.S1,
`resolveLastTurn` T2.S2, `resolveCheckpoint` T3.S1, `applyRewind` T4.S1, `applyShrink` T4.S2, `filterPipeline` T5.S1)
imports + builds on. `transforms.ts` does **not exist yet** — this task CREATES it.

> **PARALLEL-EXECUTION NOTE:** P1.M2.T3.S3 (`renderBloatReminder`/`renderDriftNudge`) LANDED on disk before this
> task — verified: `src/notes.ts` = 398 lines (S1+S2+S3 complete), `test/notes.test.ts` = 654 lines, baseline
> **6 files / 216 tests green, `tsc --noEmit` exit 0.** This task is in a **separate, brand-new module**
> (`transforms.ts`) — it does NOT touch `notes.ts` and CANNOT regress that baseline. Treat the on-disk pure-helper
> siblings (`tokens.ts`, `ledger.ts`, `notes.ts`) as the pattern contracts to mirror.

---

## Goal

**Feature Goal**: Ship Mulligan's **pairing primitive** — a pure, Pi-free `partitionIntoUnits(messages)` that groups a
message list into pairing-safe **units**, where a unit is either a single non-tool message (`plain`) or an assistant
message containing `toolCall`s grouped WITH every `toolResult` whose `toolCallId` matches (`toolGroup`). This is the
cardinal correctness rule (spec/06 §2): the model API **rejects** a request that orphans a `toolCall` or `toolResult`
(api_verification.md §6.4), so **every removal transform operates on units, never raw indices** — hiding a toolGroup
hides the assistant call AND all its results together, guaranteeing pairing by construction. This function is the
foundation for the entire P1.M3 transform module (spec/11 §2 Step 3: "the most important step; do not proceed until
the pairing invariant holds").

**Deliverable** (CREATE two NEW files):
1. `src/transforms.ts` — CREATE (the file does not exist):
   - `export interface Unit { indices: number[]; kind: "plain" | "toolGroup" }` — the spec/06 §2 canonical shape.
   - `export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]: unknown }` —
     the local structural input type (mirror of ledger.ts's `MessageLike`; a real Pi `AgentMessage[]` assigns in
     with NO cast).
   - `export function partitionIntoUnits(messages: MessageLike[] | null | undefined): Unit[]` — the algorithm
     (spec/06 §2 steps a–e).
   - two module-private helpers: `isRecord`, `readOwn` (mirror tokens.ts/ledger.ts; Proxy-safe; never throw).
   - **ZERO imports** (not Pi, not config, not log, not runtime, NOT tokens.ts/ledger.ts — foundation-tier pure).
2. `test/transforms.test.ts` — CREATE: vitest Tier-1 tests (spec/10 §1.1 pinned cases + corner cases + defensive
   never-throws + `expectTypeOf`). Fixture helpers (`asst`, `asstText`, `result`, `user`, `custom`).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (new code + tests type-sound under `strict`).
- `npx vitest run` is **all-green** — the new `transforms` suite **AND** the pre-existing suites (baseline 6 files /
  216 tests → 7 files / 216+N; the new tests are additive in a new file).
- `partitionIntoUnits` **never throws** (E13; it sits on the `context` handler hot path via `filterPipeline`) —
  null/undefined/non-array input, malformed blocks, missing/non-string/empty ids, orphan results, and throwing-Proxy
  messages all handled gracefully.
- The **spec/10 §1.1 pinned contract** holds exactly: `[user, assistant(1 toolCall), result, assistant(text)]` → 3
  units; orphan result → own plain unit; assistant with 3 toolCalls + 3 results → one toolGroup of 4 indices; the
  **pairing invariant** (every result in a toolGroup matches the assistant's call ids, and vice versa in the
  fully-paired case).

---

## User Persona

**Target User**: The implementing AI agent for the rest of P1.M3 — `resolveLastToolCallGroup` (T2.S1, takes
`units: Unit[]`), `resolveLastTurn` (T2.S2), `applyRewind` (T4.S1, "unit-aware gap-closing"), `applyShrink` (T4.S2),
and `filterPipeline` (T5.S1, calls `partitionIntoUnits` once per filter fire per spec/06 §12). The SECOND consumer is
the test suite (spec/10 §1.1). The THIRD (indirect) consumer is `filter.ts` (P1.M4.T2.S1), which receives
`event.messages: AgentMessage[]` from Pi and passes it to `partitionIntoUnits` (structural typing — no cast).

**Use Case**: On every inference, the `context` handler runs `filterPipeline(messages, markers, config, ctx)`
(spec/06 §12). Step 0 of that pipeline is `const units = partitionIntoUnits(m)`. Each rewind marker then resolves to
a set of **units** to remove (e.g. `resolveLastToolCallGroup(units, m, excludeToolCallId)` returns one toolGroup's
`indices`), and `applyRewind` removes those indices gap-closed. Because removal is unit-granular, the assistant call
and its results always leave together → the filtered view the model sees never contains an orphaned toolCall or
toolResult → the model API never errors (api_verification.md §6.4).

**User Journey**:
1. `context` event fires → `filterPipeline` calls `partitionIntoUnits(event.messages)` → `Unit[]`.
2. A rewind marker resolves against `units` (e.g. the last toolGroup before the rewind's own call).
3. `applyRewind` removes that toolGroup's indices (assistant + all its results) → gap-closed array.
4. The model sees `[kept prefix] + [note] + [rewind confirmation]`, resumes — **pairing intact by construction**.

**Pain Points Addressed**: Without pairing-aware grouping, a "rewind the last tool call" that hid only the assistant
message (not its results) would leave orphaned `toolResult`s → the model API rejects the request → the turn breaks.
`partitionIntoUnits` is the single primitive that makes that impossible: it is the structural guarantee behind
Mulligan's core promise (spec/06 §2: "guarantees pairing by construction").

---

## Why

- **Unblocks the ENTIRE P1.M3 module.** `partitionIntoUnits` is consumed by every later transform (spec/06 §1/§3/§4/
  §12; spec/11 §2 Step 3). `resolveLastToolCallGroup` literally takes `units: Unit[]` as its first param (spec/06 §3);
  `applyRewind` is "unit-aware" (spec/06 §3, §4). Nothing in P1.M3 can ship until this primitive exists + its
  invariant is proven. Shipping it first (pure-core tier) lets the downstream resolvers focus on targeting logic,
  not pairing.
- **Pairing is the #1 correctness invariant (api_verification.md §6.4).** The model API rejects an orphaned
  `toolCall`/`toolResult`. spec/08 E1 + spec/06 §2 corner cases prescribe EXACTLY how to handle orphans and
  no-results-yet assistants. The algorithm is fully spec-pinned (spec/06 §2 steps a–e) — there are NO open design
  questions, only implementation (resolved in `research/design_decisions.md` D1–D12).
- **Pure-core tier & unit-testable in isolation.** `partitionIntoUnits` imports NOTHING (foundation-tier, sibling of
  `tokens.ts`/`ledger.ts`). It is a pure, deterministic, side-effect-free function covered by fast unit tests with
  no Pi, no model, no session (spec/10 §1; spec/03 §7: "Everything under transforms.ts … is pure and unit-testable
  without Pi"). spec/11 §2 Step 3 calls this "the most important step."
- **Property-test foundation.** spec/10 §3 lists the pairing-invariant property test ("for any random message list
  … the filtered output never contains an orphan"). That property is only expressible BECAUSE units exist —
  `partitionIntoUnits` is what makes the invariant structural rather than checkable-after-the-fact.

---

## What

CREATE `src/transforms.ts` (the partitionIntoUnits portion — the file's first + only content for this subtask) and
`test/transforms.test.ts`. `partitionIntoUnits`:

- **Accepts** `messages: MessageLike[] | null | undefined` (a real Pi `AgentMessage[]` assigns in with no cast).
  Returns `Unit[]` (`[]` for null/undefined/non-array).
- **Algorithm** (spec/06 §2, steps a–e; see Implementation Blueprint for the verbatim code):
  - (a) Build `toolCallId → assistantIndex` from every assistant message's toolCall blocks (only blocks whose `.id`
    is a **non-empty string** are pairable).
  - (b)+(c) Group ALL result indices by their paired assistant into `Map<assistantIndex, number[]>` (the join of
    callToResult × callToAssistant). A toolResult whose `.toolCallId` is a non-empty string AND is in `callToAssistant`
    joins that assistant's bucket; otherwise it is skipped here (→ orphan → plain in step d).
  - Build one **toolGroup** per distinct assistant that issued ≥1 pairable call: `indices = sorted([assistantIndex,
    ...results])`. (An assistant whose results haven't arrived → toolGroup of just the assistant — spec/06 §2 corner
    case. One assistant with N calls → ONE toolGroup with all N results — deduped via an `assigned` set.)
  - (d) Every index NOT in a toolGroup → **plain** unit `{indices:[i]}`. This includes orphan toolResults (spec/08
    E1), user messages, text-only assistants, and custom messages.
  - (e) Sort units by `indices[0]` (minimum index).

This subtask does **NOT**: implement the resolve*/apply*/pipeline functions (later P1.M3 subtasks APPEND to
`transforms.ts` and reuse `Unit`/`MessageLike` + the module-private `isRecord`/`readOwn` defined here); import
`AgentMessage` from Pi (not resolvable at this tier — see GOTCHA #2); mutate its input; delete messages (it only
GROUPS — removal is `applyRewind`'s job); or widen the `Unit` shape beyond spec/06 §2.

### Success Criteria

- [ ] `src/transforms.ts` is CREATED with `partitionIntoUnits` + `Unit` + `MessageLike` + `isRecord`/`readOwn`, and
      **ZERO imports** (foundation-tier pure; not even tokens.ts/ledger.ts).
- [ ] `test/transforms.test.ts` is CREATED (vitest; spec/10 §1.1 pinned + corner + defensive + types); the whole
      suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **spec/10 §1.1 — 4-message case:** `[user, asst(1 toolCall), result, asst(text)]` → exactly 3 units:
      `plain[0]`, `toolGroup[1,2]`, `plain[3]`.
- [ ] **spec/10 §1.1 — orphan result:** a toolResult whose toolCallId matches no assistant → its own `plain` unit;
      NEVER merged into a toolGroup.
- [ ] **spec/10 §1.1 — 3 calls + 3 results:** one assistant with 3 toolCalls + 3 results → ONE toolGroup with 4
      indices `[assistant, res, res, res]`.
- [ ] **spec/10 §1.1 — invariant:** for every toolGroup, every result index's toolCallId is in the assistant's
      toolCall ids (forward; always true) — and in the fully-paired 3+3 case, vice versa (every call has a result).
- [ ] **spec/06 §2 corner case — no results yet:** an assistant with toolCalls but no results → a toolGroup of just
      the assistant `{indices:[i]}`.
- [ ] **Unit shape exact:** `{ indices: number[]; kind: "plain" | "toolGroup" }`; `plain.indices` always length 1;
      toolGroup indices sorted ascending; units ordered by `indices[0]`.
- [ ] **Never throws:** null/undefined/non-array messages, malformed blocks, missing/non-string/empty ids,
      throwing-Proxy message, duplicate callIds, result-before-assistant → handled gracefully; `expect(() =>
      partitionIntoUnits(...)).not.toThrow()`.
- [ ] **Signature exact:** `partitionIntoUnits(messages: MessageLike[] | null | undefined): Unit[]` (not widened).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `partitionIntoUnits` + `Unit` + `MessageLike` + `isRecord`/`readOwn` to write
> are given verbatim below (Task 1), and the exact tests are given verbatim (Task 2). The algorithm is spec-pinned
> (spec/06 §2 steps a–e); the corner cases (orphan E1, no-results-yet) are spec-pinned; the exact unit tests are
> spec-pinned (spec/10 §1.1); the message shapes are verified (api_verification.md §6.1/§6.2). The Pi-free local
> structural type + the isRecord/readOwn convention are taken verbatim from the on-disk sibling `ledger.ts` (read it
> as the closest pattern). The baseline (6 files / 216 tests, tsc exit 0) and the test conventions
> (`../src/transforms.js`, `expectTypeOf`, no `beforeEach`, throwing-Proxy defensive test) are verified live. No prior
> knowledge beyond "this CREATES a new pure module that mirrors ledger.ts" is required.

### Scope decision (READ BEFORE CODING)

- **CREATE `src/transforms.ts` — it does NOT exist.** This is **S1 of the transforms.ts build**: ship ONLY
  `partitionIntoUnits` + `Unit` + `MessageLike` + the 2 module-private helpers (`isRecord`, `readOwn`). Later P1.M3
  subtasks APPEND the resolve*/apply*/pipeline functions to this same file and REUSE `Unit`/`MessageLike` +
  `isRecord`/`readOwn` (hoisted in module scope — mirrors how `notes.ts` S2/S3 reused S1's helpers). Do NOT
  implement any resolve*/apply*/pipeline function here.
- **CREATE `test/transforms.test.ts` — it does NOT exist.** Model it on `test/ledger.test.ts` (the closest analog:
  it builds assistant messages with toolCall blocks). Fixture helpers: `asst(...callIds)`, `asstText(text)`,
  `result(toolCallId)`, `user(text)`, `custom(customType)`.
- **ZERO imports.** `partitionIntoUnits` is foundation-tier pure (sibling of `tokens.ts`/`ledger.ts`, which each
  import nothing). Define `MessageLike` INLINE (local structural type — a real `AgentMessage[]` assigns in with no
  cast). Do NOT `import type { MessageLike } from "./tokens.js"` or `"./ledger.js"` (each pure module keeps its own
  structural view — D1 in `research/design_decisions.md`).
- **Do NOT import `AgentMessage` from Pi.** The real union lives in `@earendil-works/pi-agent-core`, which is NOT
  resolvable from a pure-helper module (confirmed in `tokens.ts` + `ledger.ts`: not hoisted, not re-exported). Use
  the local `MessageLike`. (GOTCHA #2.)
- **Do NOT widen the `Unit` shape.** Keep `{ indices: number[]; kind: "plain" | "toolGroup" }` exactly (spec/06 §2).
  Downstream resolve*/apply* depend on it.
- **Do NOT rename to `findToolCallPairs`.** spec/03 §7 line 180 lists the older name; spec/06 §2 + the work item
  canonicalize `partitionIntoUnits`. Use `partitionIntoUnits`.

### Documentation & References

```yaml
# MUST READ — authoritative sources for partitionIntoUnits
- file: spec/06-context-filter.md
  section: "§2 Pairing: the cardinal rule"
  why: "THE source of the Unit interface, the algorithm (steps 1–5), and BOTH critical corner cases (orphan result →
        plain unit; assistant-with-no-results-yet → toolGroup of just the assistant). Also the load-bearing line:
        'All removal operations in Mulligan operate on units, never raw indices. This guarantees pairing by
        construction.'"
  critical: "Unit = { indices: number[]; kind: 'plain' | 'toolGroup' } EXACTLY. A unit is EITHER a single non-tool
             message OR an assistant-with-toolCalls grouped with every matching toolResult. Units ordered by minimum
             index. The safe rule for orphans: 'if you cannot confirm both sides of a pair, hide neither'."

- file: spec/10-testing.md
  section: "§1.1 partitionIntoUnits (pairing)"
  why: "THE exact unit tests: (1) [user, assistant(1 toolCall), result, assistant(text)] → 3 units; (2) orphan result
        → own plain unit, never merged; (3) assistant with 3 toolCalls + 3 results → one toolGroup of 4 indices;
        (4) the invariant test (every result's toolCallId ∈ the assistant's call ids, and vice versa)."
  critical: "These four are the load-bearing tests — implement them verbatim. The invariant's 'vice versa' (every
             call has a result) holds ONLY in the fully-paired 3+3 case; the forward direction (every result matches
             the assistant) holds universally — assert forward universally, reverse in the 3+3 case."

- file: spec/08-edge-cases.md
  section: "E1 Orphaned toolResult (no matching toolCall)"
  why: "THE orphan prescription: partitionIntoUnits treats an orphan result as its OWN plain unit; never delete it
        speculatively. 'A rewind never removes a unit unless both sides of every pair within it are confirmed
        present. If unsure, hide neither.'"
  critical: "Orphan results can occur transiently during streaming/compaction. They MUST become plain units, not be
             silently dropped or merged speculatively."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§6.4 Critical: Tool Pairing Invariant + §6.1/§6.2 (verified message shapes)"
  why: "THE reason the function exists: 'The model API rejects a request that orphans either side [toolCall or
        toolResult]. Every filter transform MUST preserve pairing.' Also the verified AssistantMessage.content =
        (Text|Thinking|ToolCall)[] and ToolResultMessage.toolCallId shapes (the fields partitionIntoUnits reads)."
  critical: "ToolCall block = { type:'toolCall', id, name, arguments }. toolResult has role:'toolResult' +
             toolCallId. The real AgentMessage type is NOT importable here (not hoisted) → use a local structural
             MessageLike (a real AgentMessage[] assigns in with no cast)."

- file: spec/11-build-order.md
  section: "§1 (transforms.ts = PURE: partitionIntoUnits, resolve*, applyRewind, applyShrink, filterPipeline) + §2 Step 3"
  why: "Confirms transforms.ts OWNS partitionIntoUnits (this task CREATES the file) and that it is Step 3 'the most
        important step; do not proceed until the pairing invariant holds.' Lists the sibling functions that APPEND
        later and reuse Unit/MessageLike."

- file: spec/01-pi-context-internals.md
  section: "§5 The context event + the tool-pairing invariant"
  why: "Confirms event.messages is a deep copy (safe to read), the AgentMessage union elements (user/assistant/
        toolResult/custom/bashExecution/…), and restates the invariant: 'any view transform that hides one side MUST
        hide the other. Mulligan's filter is pairing-aware.'"

- file: spec/06-context-filter.md
  section: "§12 Pseudocode: the full pipeline (consumer of partitionIntoUnits)"
  why: "Shows the consumer: `const units = partitionIntoUnits(m)` is called ONCE per filter fire, BEFORE the rewind
        loop. Confirms Unit is the shared type handed to resolveLastToolCallGroup(units, …)."

# FILES TO MIRROR (read-only pattern contracts — do NOT modify)
- file: src/ledger.ts
  why: "The CLOSEST analog — it introspects assistant messages' toolCall blocks (reads block.type === 'toolCall' and
        block.name/arguments). partitionIntoUnits reads block.type === 'toolCall' and block.id. Mirror its: local
        MessageLike + ContentBlock + ToolCallContent types; module-private isRecord/readOwn (Proxy-safe, never
        throw); 'NEVER throws (E13)' discipline; the `[key: string]: unknown` index signature on MessageLike; the
        `import type` ABSENCE (foundation-tier, zero imports)."
  pattern: "extractFileLedger(messages, range) iterates, reads role via readOwn === 'assistant', reads content via
            readOwn, Array.isArray, loops blocks, readOwn(block,'type') === 'toolCall'. partitionIntoUnits follows
            the SAME defensive read pattern but groups instead of classifies."

- file: src/tokens.ts
  why: "The foundation-tier precedent: 'Imports NOTHING — not Pi, not config, not log, not runtime.' Defines its OWN
        local structural types + its OWN isRecord/readOwn. The MessageLike docstring ('Any Pi AgentMessage variant
        … satisfies this … assigns in with no cast') is the template for transforms.ts's MessageLike docstring."

- file: test/ledger.test.ts
  why: "The test-pattern template for a toolCall-introspecting pure helper: `import { …, type MessageLike } from
        '../src/ledger.js'`; the `asst(...calls)` fixture builder (assistant content = toolCall blocks with ids);
        no beforeEach; `expectTypeOf`; the throwing-Proxy defensive test (`new Proxy(obj, { get(){ throw } })` →
        `.not.toThrow()`). Mirror ALL of these in test/transforms.test.ts."

- file: test/tokens.test.ts
  why: "Confirms the vitest house style: `describe`/`it`/`expect`/`expectTypeOf`; `toMatchInlineSnapshot()`;
        `as unknown as MessageLike[]` casts for malformed-input defensive tests; 'accepts a real-ish Pi … shape
        (structural typing)' tests."

- file: plan/001_2e5baf25fe9f/P1M3T1S1/research/design_decisions.md
  why: "THE resolution of every spec-open detail (D1 zero-imports tier, D2 MessageLike, D3 Unit shape, D4 join-style
        algorithm, D5 no-results-yet, D6 orphan, D7 duplicate-callId orphan-safety, D8 plain definition, D9
        never-throws, D10 signature, D11 test strategy, D12 validation gate). Implement EXACTLY these choices."

- file: plan/001_2e5baf25fe9f/P1M3T1S1/research/spec_extracts.md
  why: "Verbatim extracts of spec/06 §2, spec/10 §1.1, spec/08 E1, api_verification §6.4, spec/11 §1/§2 — preserves
        exact wording for review."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; devDeps typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
│                           #   (NO noUnusedParameters/noUnusedLocals → unused params compile; codebase prefixes with _)
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts / log.ts / runtime.ts   # DO NOT TOUCH.
│   ├── tokens.ts           # foundation-tier pure helper (the zero-imports + local-MessageLike + isRecord/readOwn precedent). DO NOT TOUCH.
│   ├── ledger.ts           # foundation-tier pure helper (the toolCall-introspection pattern to MIRROR). DO NOT TOUCH.
│   ├── notes.ts            # pure helper (S1+S2+S3 complete, 398 lines). DO NOT TOUCH.
│   └── tools/              # empty dir. DO NOT TOUCH.
├── test/
│   ├── config/ledger/log/runtime/tokens/notes .test.ts   # Read-only (ledger.test.ts + tokens.test.ts = test patterns to mirror).
│   └── integration/        # empty dir. DO NOT TOUCH.
└── spec/                   # 06 §2 (THE algorithm) + 10 §1.1 (THE tests) + 08 E1 (orphan) + 01 §5 + 11 §1/§2 + 03 §7.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   6 files / 216 tests green (config 21, ledger 39, log 15, notes 60, runtime 20, tokens 51). This task CREATES a
#   brand-new pure module (src/transforms.ts) + its test (test/transforms.test.ts); it cannot regress the baseline.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
#   The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent a lint/format command.
```

### Desired Codebase tree with files to be CREATED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── transforms.ts       # CREATED — partitionIntoUnits + Unit + MessageLike + isRecord/readOwn (zero imports).
└── test/
    └── transforms.test.ts  # CREATED — spec/10 §1.1 pinned + corner + defensive + types.
# No other files touched. Later P1.M3 subtasks APPEND resolve*/apply*/pipeline to src/transforms.ts.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — CREATE src/transforms.ts; it does NOT exist. Ship ONLY partitionIntoUnits + Unit +
#   MessageLike + the 2 module-private helpers (isRecord, readOwn). LATER P1.M3 subtasks APPEND resolveLastToolCallGroup/
#   resolveLastTurn/resolveCheckpoint/applyRewind/applyShrink/filterPipeline to THIS file and REUSE Unit/MessageLike +
#   isRecord/readOwn (hoisted in module scope). Do NOT implement any resolve*/apply*/pipeline function in this task.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — ZERO imports. partitionIntoUnits is foundation-tier pure (sibling of tokens.ts/ledger.ts,
#   which import nothing). Do NOT `import type { AgentMessage }` from Pi (the union lives in
#   @earendil-works/pi-agent-core, NOT resolvable here — confirmed in tokens.ts/ledger.ts). Do NOT `import type
#   { MessageLike } from './tokens.js'/'./ledger.js'` (each pure module keeps its OWN structural MessageLike — D1).
#   Define MessageLike INLINE. The file's import count is PERMANENTLY 0 at this tier (unlike notes.ts, which is the
#   pure-HELPER tier and may import type-only from siblings).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — MessageLike is STRUCTURAL: a real Pi AgentMessage[] assigns in with NO cast. It carries
#   role?:string + content?:string|ContentBlock[] + [key:string]:unknown. partitionIntoUnits reads ONLY: role (→
#   'assistant'/'toolResult'), assistant content[] toolCall blocks (.id), toolResult toolCallId (via the index
#   signature, via readOwn). Mirror ledger.ts's MessageLike/ContentBlock/ToolCallContent verbatim.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — Only toolCall blocks with a NON-EMPTY-STRING .id are pairable. `id = readOwn(block,'id');
#   if (typeof id === 'string' && id.length > 0)`. A missing / non-string / '' id → that call is NOT entered into
#   callToAssistant → the assistant may end up plain (if it had no other valid-id call). This is correct + safe: a
#   malformed-id call can't be paired, so its assistant is treated atomically (hiding it alone can't orphan a result
#   we couldn't match). Same rule for toolResult.toolCallId.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — Dedup one-assistant-many-calls. callToAssistant.values() yields an assistant's index ONCE
#   PER toolCall it issued (e.g. 3 calls → index appears 3×). Use an `assigned` Set: the first occurrence builds the
#   toolGroup + marks assigned; subsequent occurrences hit `assigned.has(i) → continue`. Result: ONE toolGroup per
#   assistant (all its results join it), NOT N. (The final units.sort by indices[0] makes build-order irrelevant.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (CRITICAL) — Orphan toolResult → its OWN plain unit, NEVER merged (spec/08 E1, spec/06 §2). A toolResult
#   whose toolCallId is NOT in callToAssistant is SKIPPED in the join (no assistant bucket) → its index is never
#   `assigned` → it becomes a plain unit {indices:[i]} in step (d). Do NOT drop it, do NOT merge it speculatively.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (CRITICAL) — Assistant with toolCalls but NO results yet → toolGroup of just the assistant (spec/06 §2
#   corner case). Because the toolGroup set = distinct values of callToAssistant (assistants that issued ≥1 pairable
#   call), such an assistant IS in the set → toolGroup {indices:[i]} (empty results bucket). Do NOT demote it to plain.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 (CRITICAL) — NEVER throws (E13; context-handler hot path). isRecord guards null/primitive/array
#   messages; readOwn wraps the property read in try/catch (a throwing-Proxy get-trap returns undefined, not an
#   exception). null/undefined/non-array messages → []. Malformed blocks / missing ids → skipped. Mirror tokens.ts/
#   ledger.ts's isRecord/readOwn VERBATIM. No @ts-ignore (defensive branches compile cleanly under strict).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — Duplicate / pathological callIds (shouldn't happen in valid Pi; 1:1 per the API) are handled
#   deterministically + orphan-safe: (a) two assistant calls same id → callToAssistant last-wins; the earlier
#   assistant (if that was its only call) → plain. (b) two toolResults same callId → the JOIN groups BOTH into the
#   assistant's bucket (D4 uses number[] per assistant, NOT a 1:1 map) → both join the SAME toolGroup → removing it
#   hides both together → NO orphan possible. (c) result before its assistant → join still works (reads actual index);
#   ascending sort fixes order. Document; these are non-issues for well-formed contexts.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — plain.indices is ALWAYS length 1; toolGroup.indices is sorted ascending ([assistant, ...results]).
#   Units are ordered by indices[0]. The assistant is usually indices[0] in well-formed input, but the sort makes it
#   robust if a result somehow precedes its assistant (defensive). Do NOT sort plain indices (already [i]).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — The test imports from "../src/transforms.js" (.js extension, even though the file is transforms.ts).
#   moduleResolution:'Bundler' + type:'module' → TS resolves .js to .ts. This is the established convention (every
#   test/* file does this). Add `type Unit` + `type MessageLike` to the import.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 — The invariant test's "vice versa" (every assistant call id has a result) holds ONLY when all results
#   are present. Assert the FORWARD direction (every result in a toolGroup matches the assistant's call ids)
#   UNIVERSALLY across all test cases; assert the REVERSE direction specifically in the fully-paired 3+3 case. Do NOT
#   assert reverse universally (it fails on the no-results-yet corner case by design).
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

Two new EXPORTED interfaces + one EXPORTED function + two module-private helpers. ZERO imports. The local
`MessageLike` is a structural view of the verified Pi `AgentMessage` union (api_verification.md §6.1/§6.3):

```ts
// NEW (defined inline in src/transforms.ts — a real Pi AgentMessage[] assigns in with NO cast):
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown; // covers toolCallId (read via readOwn), toolName, customType, etc.
}

export interface Unit {
  indices: number[]; // plain → always [i]; toolGroup → [assistant, ...results] sorted ascending
  kind: "plain" | "toolGroup";
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 6 files / 216 tests green
  - RUN: test ! -f src/transforms.ts && echo "ok: transforms.ts absent (to CREATE)" 
  - RUN: test ! -f test/transforms.test.ts && echo "ok: transforms.test.ts absent (to CREATE)"

Task 1: CREATE src/transforms.ts   (exact content below — copy verbatim)
  - WRITE: the file header docstring + local structural types (ToolCallContent, ContentBlock, MessageLike) + the
    Unit interface + partitionIntoUnits + the module-private isRecord/readOwn.
  - CONSTRAINTS:
      * ZERO imports (GOTCHA #1/#2). MessageLike inline + structural (GOTCHA #3).
      * Only non-empty-string toolCall ids are pairable (GOTCHA #4).
      * Dedup one-assistant-many-calls via an `assigned` Set (GOTCHA #5).
      * Orphan result → plain unit, never merged (GOTCHA #6). No-results-yet assistant → toolGroup [i] (GOTCHA #7).
      * Duplicate callIds orphan-safe via number[] per assistant (GOTCHA #9).
      * Never throws: isRecord/readOwn mirror tokens.ts/ledger.ts (GOTCHA #8). No @ts-ignore.
      * plain.indices length 1; toolGroup.indices sorted ascending; units ordered by indices[0] (GOTCHA #10).
      * signature exactly partitionIntoUnits(messages: MessageLike[] | null | undefined): Unit[].
  - NAMING/PLACEMENT: src/transforms.ts. Exports: MessageLike, Unit, partitionIntoUnits. Module-private: isRecord, readOwn.

Task 2: CREATE test/transforms.test.ts   (exact content below — copy verbatim)
  - WRITE: the import (partitionIntoUnits + type Unit + type MessageLike from ../src/transforms.js) + the fixture
    helpers (asst, asstText, result, user, custom) + the describe blocks.
  - CONSTRAINTS: NO beforeEach (pure, stateless). Mirror ledger.test.ts + tokens.test.ts. toMatchInlineSnapshot for
    a representative summary; expectTypeOf for types; throwing-Proxy defensive test.
  - COVERAGE: spec/10 §1.1 pinned (4-msg→3-units; orphan→plain; 3+3→1 toolGroup of 4; invariant forward+reverse);
    corner (no-results-yet→toolGroup[i]; empty/null/undefined/non-array→[]; parallel 1-asst-2-calls-2-results;
    multiple separate groups; interleaved); plain (user/text-asst/custom→plain); defensive (malformed blocks;
    missing/non-string/empty ids; duplicate callIds orphan-safe; result-before-assistant; throwing-Proxy);
    ordering/determinism (units by indices[0]; toolGroup indices ascending; idempotent); types (expectTypeOf).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Levels 3/4 N/A (pure helper — no Pi, no server, no DB).
```

#### Exact content to CREATE — `src/transforms.ts`

```ts
/**
 * transforms.ts — Mulligan's PURE context-filter transforms (the correctness heart).
 * spec/06-context-filter.md §2 (partitionIntoUnits — the cardinal pairing rule), spec/04-data-model.md,
 *   spec/08-edge-cases.md E1 (orphan toolResult → own plain unit), spec/10-testing.md §1.1 (partitionIntoUnits
 *   tier-1 tests), api_verification.md §6.4 (tool-pairing invariant: the model API rejects an orphaned
 *   toolCall/toolResult), spec/01-pi-context-internals.md §5 (the context event + the invariant), spec/03 §2.3/§7
 *   + spec/11 §1/§2 (transforms.ts = PURE, unit-tested without Pi; Step 3 "the most important step").
 *
 * DESIGN (read GOTCHA #1–#13 in the PRP):
 * - Foundation-tier and Pi-FREE. Imports NOTHING — not Pi, not config, not log, not runtime, NOT tokens.ts/ledger.ts.
 *   It is a pure, deterministic, side-effect-free function fully unit-testable in isolation (sibling of tokens.ts +
 *   ledger.ts per spec/11 §1). It defines its OWN local structural types (mirror tokens.ts/ledger.ts) and its OWN
 *   module-private isRecord/readOwn (each pure module keeps its own copy — the established convention).
 * - partitionIntoUnits is THE pairing primitive. Every removal transform (resolveLastToolCallGroup,
 *   resolveLastTurn, applyRewind, applyShrink, filterPipeline — sibling functions added by later P1.M3 subtasks)
 *   operates on UNITS, never raw indices, so pairing is preserved by construction (spec/06 §2: "All removal
 *   operations in Mulligan operate on units, never raw indices. This guarantees pairing by construction."). A unit
 *   is either a single non-tool message (plain) or an assistant message containing toolCalls grouped WITH every
 *   toolResult whose toolCallId matches (toolGroup). Hiding a toolGroup hides the call AND all its results together
 *   → the model API never sees an orphan (api_verification.md §6.4).
 * - NEVER throws (it sits on the context-handler hot path via filterPipeline; E13 fail-open discipline).
 *   isRecord/readOwn swallow Proxy-trap throws; null/non-array messages, malformed blocks, missing/non-string ids,
 *   orphan results, and assistant-with-no-results-yet are all handled defensively (GOTCHA #4–#9).
 *
 * NOTE: later P1.M3 subtasks (T2 resolveLastToolCallGroup/resolveLastTurn, T3 resolveCheckpoint, T4 applyRewind/
 *   applyShrink, T5 filterPipeline) APPEND to this file and REUSE the exported Unit/MessageLike + the module-private
 *   isRecord/readOwn (hoisted here — mirrors how tokens.ts/notes.ts siblings reuse their S1 helpers). This S1 ships
 *   ONLY partitionIntoUnits + Unit + MessageLike + isRecord/readOwn.
 */

// ── local structural types (mirror tokens.ts/ledger.ts; api_verification.md §6.1/§6.2) ────

/** A tool-call content block (assistant only) — partitionIntoUnits reads `.id` to pair call↔result. */
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Any content block (we only ever inspect toolCall blocks; text/thinking/image are ignored). */
type ContentBlock = ToolCallContent | { type: string; [key: string]: unknown };

/**
 * Minimal structural message shape for partitioning. Any Pi AgentMessage variant (user / assistant / toolResult /
 * custom / bashExecution / branchSummary / compactionSummary) satisfies this. partitionIntoUnits inspects ONLY:
 *   - `role` (to tell assistant/toolResult apart from plain messages),
 *   - assistant `content[]` for toolCall blocks (reading each `.id`),
 *   - toolResult `toolCallId` (via the index signature, read via readOwn).
 * A real Pi AgentMessage[] assigns in with NO cast (structural typing — api_verification.md §6.1/§6.3). EXPORTED so
 * tests + the later sibling resolve/apply transform functions + filter.ts (P1.M4) share one input type.
 */
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

/**
 * Unit — a pairing-safe message group (spec/06-context-filter.md §2 canonical shape). A unit is EITHER:
 *   - kind:"plain"     — a single non-tool message (user, text-only assistant, custom, OR an orphan toolResult whose
 *                        toolCallId matches no assistant — spec/08 E1). `indices` ALWAYS has length 1.
 *   - kind:"toolGroup" — an assistant message that issued ≥1 toolCall, grouped WITH every toolResult whose
 *                        toolCallId maps to that assistant. `indices` = [assistant, ...results], sorted ascending.
 *                        (An assistant whose results have not arrived yet — mid-turn — is a toolGroup of just the
 *                        assistant: spec/06 §2 corner case.)
 * `indices` is sorted ascending; units are ordered by `indices[0]` (their minimum index). EXPORTED — it is the
 * return type of partitionIntoUnits AND the input type of every removal transform (resolveLastToolCallGroup,
 * applyRewind, … — sibling functions added by later P1.M3 subtasks).
 */
export interface Unit {
  /** Sorted ascending message indices this unit spans. plain → always exactly [i]; toolGroup → [assistant, ...results]. */
  indices: number[];
  kind: "plain" | "toolGroup";
}

/**
 * partitionIntoUnits — group a message list into pairing-safe units (spec/06 §2; the cardinal rule).
 *
 * ALGORITHM (spec/06 §2, steps a–e):
 *   (a) Walk `messages`; build `toolCallId → assistantIndex` from every assistant message's toolCall blocks (only
 *       blocks whose `.id` is a non-empty string are pairable — GOTCHA #4).
 *   (b)+(c) Group ALL result indices by their paired assistant: for every toolResult whose `.toolCallId` is a
 *       non-empty string AND is in the assistant map, push its index into that assistant's bucket. (Implemented as a
 *       join of callToResult × callToAssistant; uses number[] per assistant so duplicate callIds are orphan-safe —
 *       GOTCHA #9.) A result whose callId matches NO assistant is SKIPPED here → it falls through to a plain unit
 *       in (d) (orphan — spec/08 E1, GOTCHA #6).
 *   For each DISTINCT assistant that issued ≥1 pairable call (deduped via an `assigned` set — GOTCHA #5), form a
 *   toolGroup = {indices: sorted([assistantIndex, ...results]), kind:"toolGroup"}. An assistant with calls but no
 *   results yet → a toolGroup of just the assistant (spec/06 §2 corner case — GOTCHA #7).
 *   (d) Every index NOT in a toolGroup → a plain unit {indices:[i]}. This is where orphan toolResults, user
 *       messages, text-only assistants, and custom messages land.
 *   (e) Units are ordered by their minimum index (indices[0]).
 *
 * WHY (api_verification.md §6.4): the model API rejects a request containing a toolCall without its matching
 * toolResult, or vice versa. Because every removal transform operates on UNITS (never raw indices — spec/06 §2),
 * hiding a toolGroup hides the assistant call AND all its results together, so the filtered view never orphans
 * either side. This function is the correctness foundation for ALL of P1.M3.
 *
 * Pure + defensive: null/undefined/non-array `messages` → []; malformed messages/blocks, missing/non-string/empty
 * ids, duplicate toolCallIds, results appearing before their assistant, and throwing-Proxy messages are all handled
 * gracefully — NEVER throws (E13; context-handler hot path). Duplicate toolCallId across two assistant calls, or
 * two results for one callId: deterministic + orphan-safe (GOTCHA #9); such inputs should not occur in a well-formed
 * Pi context, but the function stays total regardless.
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); null/undefined/non-array → []
 * @returns ordered Unit[] (plain + toolGroup), each with ascending indices; [] for empty/null input
 */
export function partitionIntoUnits(messages: MessageLike[] | null | undefined): Unit[] {
  const list = Array.isArray(messages) ? messages : [];

  // (a) toolCallId → assistantIndex, from every assistant's pairable toolCall blocks.
  const callToAssistant = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (!isRecord(msg) || readOwn(msg, "role") !== "assistant") continue;
    const content = readOwn(msg, "content");
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || readOwn(block, "type") !== "toolCall") continue; // only toolCall blocks carry a pairable id
      const id = readOwn(block, "id");
      if (typeof id === "string" && id.length > 0) {
        callToAssistant.set(id, i); // duplicate id (shouldn't happen) → last wins (deterministic)
      }
    }
  }

  // (b)+(c) Group ALL result indices by their paired assistant (join of callToResult × callToAssistant). Orphan
  //         results (no matching assistant) are skipped here → they become plain units in step (d) (spec/08 E1).
  //         number[] per assistant (NOT a 1:1 map) so duplicate callIds group together → orphan-safe (GOTCHA #9).
  const assistantToResults = new Map<number, number[]>();
  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (!isRecord(msg) || readOwn(msg, "role") !== "toolResult") continue;
    const id = readOwn(msg, "toolCallId");
    if (typeof id !== "string" || id.length === 0) continue;
    const assistantIndex = callToAssistant.get(id);
    if (assistantIndex === undefined) continue; // orphan result → leave for the plain pass (GOTCHA #6)
    let bucket = assistantToResults.get(assistantIndex);
    if (bucket === undefined) {
      bucket = [];
      assistantToResults.set(assistantIndex, bucket);
    }
    bucket.push(i);
  }

  // Build toolGroup units for every assistant that issued ≥1 pairable toolCall (distinct values of callToAssistant).
  // `assigned` dedups: one assistant with N calls appears N× in .values() → ONE toolGroup, not N (GOTCHA #5).
  const assigned = new Set<number>();
  const units: Unit[] = [];
  for (const assistantIndex of callToAssistant.values()) {
    if (assigned.has(assistantIndex)) continue;
    const results = assistantToResults.get(assistantIndex) ?? [];
    const indices = [assistantIndex, ...results].sort((a, b) => a - b); // ascending (GOTCHA #10)
    for (const idx of indices) assigned.add(idx);
    units.push({ indices, kind: "toolGroup" });
  }

  // (d) Every index NOT in a toolGroup → a plain unit. Orphan toolResults land here (their own plain unit).
  for (let i = 0; i < list.length; i++) {
    if (assigned.has(i)) continue;
    units.push({ indices: [i], kind: "plain" });
  }

  // (e) Order units by their minimum index (indices[0]).
  units.sort((a, b) => a.indices[0] - b.indices[0]);
  return units;
}

// ── module-private defensive helpers (mirror tokens.ts/ledger.ts — never throw) ───

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
```

#### Exact content to CREATE — `test/transforms.test.ts`

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import { partitionIntoUnits, type Unit, type MessageLike } from "../src/transforms.js";

// No beforeEach needed: transforms.ts has NO module-scoped mutable state (pure over its arguments).

// ── fixture builders (mirror ledger.test.ts's `asst`) ───────────────────────────

/** Build an assistant message whose content is a list of toolCall blocks with the given ids. */
function asst(...callIds: string[]): MessageLike {
  return {
    role: "assistant",
    content: callIds.map((id) => ({ type: "toolCall", id, name: "tool", arguments: {} })),
  };
}

/** Build a text-only assistant (no toolCalls) → must be a plain unit. */
function asstText(text: string): MessageLike {
  return { role: "assistant", content: [{ type: "text", text }] };
}

/** Build a toolResult message for the given toolCallId. */
function result(toolCallId: string): MessageLike {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "tool",
    content: [{ type: "text", text: "..." }],
    isError: false,
  };
}

/** Build a user message. */
function user(text: string): MessageLike {
  return { role: "user", content: text };
}

/** Build a custom message (e.g. mulligan:note / mulligan:nudge) → must be a plain unit. */
function custom(customType: string): MessageLike {
  return { role: "custom", customType, content: "x", display: true };
}

/** Compact per-unit summary "kind:minIdx:len" for readable multi-unit assertions. */
function summary(units: Unit[]): string {
  return units.map((u) => `${u.kind}:${u.indices[0]}:${u.indices.length}`).join(" | ");
}

/**
 * The pairing invariant (forward direction — always true): for every toolGroup unit, (i) it contains exactly one
 * assistant member, and (ii) every OTHER member is a toolResult whose toolCallId is one of that assistant's toolCall
 * ids. Used across many tests. (The "vice versa" — every call has a result — holds only when all results are present;
 * asserted separately in the fully-paired 3+3 case — GOTCHA #13.)
 */
function expectPairingInvariant(messages: MessageLike[], units: Unit[]): void {
  for (const u of units) {
    if (u.kind === "plain") {
      expect(u.indices, "plain unit spans exactly one index").toHaveLength(1);
      continue;
    }
    // toolGroup: find the assistant member, assert every other member is a matching toolResult.
    const asstIdx = u.indices.find((i) => messages[i]?.role === "assistant");
    expect(asstIdx, "toolGroup must contain an assistant message").toBeTypeOf("number");
    const asstMsg = messages[asstIdx as number] as MessageLike;
    const content = asstMsg.content;
    expect(Array.isArray(content), "assistant content is a block array").toBe(true);
    const callIds = new Set(
      (content as Array<Record<string, unknown>>)
        .filter((b) => b?.type === "toolCall" && typeof b.id === "string")
        .map((b) => b.id as string),
    );
    expect(callIds.size, "the assistant issued ≥1 pairable toolCall").toBeGreaterThan(0);
    for (const i of u.indices) {
      if (i === asstIdx) continue;
      const r = messages[i] as MessageLike;
      expect(r?.role, "non-assistant toolGroup member is a toolResult").toBe("toolResult");
      expect(callIds.has(r.toolCallId as string), "result's toolCallId ∈ the assistant's call ids").toBe(true);
    }
  }
}

// ── spec/10 §1.1 PINNED contract (the load-bearing tests) ──────────────────────

describe("partitionIntoUnits — spec/10 §1.1 PINNED contract", () => {
  it("[user, assistant(1 toolCall), result, assistant(text)] → 3 units (plain, toolGroup[1,2], plain)", () => {
    const msgs: MessageLike[] = [user("do it"), asst("c1"), result("c1"), asstText("done")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(3);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2 | plain:3:1");
    expect(units[0]).toEqual({ indices: [0], kind: "plain" }); // user
    expect(units[1]).toEqual({ indices: [1, 2], kind: "toolGroup" }); // assistant(c1) + result(c1)
    expect(units[2]).toEqual({ indices: [3], kind: "plain" }); // text assistant
    expectPairingInvariant(msgs, units);
  });

  it("orphan result (no matching toolCall) → its OWN plain unit; never merged (spec/08 E1)", () => {
    const msgs: MessageLike[] = [user("hi"), result("orphan-1")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(2);
    expect(summary(units)).toBe("plain:0:1 | plain:1:1");
    expect(units.every((u) => u.kind === "plain")).toBe(true); // nothing merged
    // the orphan result (index 1) stands alone as plain
    expect(units[1]).toEqual({ indices: [1], kind: "plain" });
  });

  it("assistant with 3 toolCalls + 3 results → ONE toolGroup with 4 indices", () => {
    const msgs: MessageLike[] = [asst("c1", "c2", "c3"), result("c1"), result("c2"), result("c3")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ indices: [0, 1, 2, 3], kind: "toolGroup" }); // 4 indices, sorted ascending
    expectPairingInvariant(msgs, units);
    // "vice versa" (reverse) — holds in the fully-paired case: every call id has a result in the unit (GOTCHA #13)
    const asstMsg = msgs[0];
    const content = asstMsg.content as Array<Record<string, unknown>>;
    const callIds = content.filter((b) => b?.type === "toolCall").map((b) => b.id as string);
    const resultIds = new Set(units[0].indices.slice(1).map((i) => (msgs[i] as MessageLike).toolCallId as string));
    for (const id of callIds) {
      expect(resultIds.has(id), `every call id ${id} has its result in the toolGroup`).toBe(true);
    }
  });

  it("invariant holds across a mixed list (the forward direction — GOTCHA #13)", () => {
    const msgs: MessageLike[] = [
      user("u"),
      asst("a"), result("a"),
      asstText("thinking..."),
      asst("b", "c"), result("b"), result("c"),
      result("orphan"),
    ];
    const units = partitionIntoUnits(msgs);
    expectPairingInvariant(msgs, units); // forward invariant; never throws, never asserts falsely
  });
});

// ── corner cases (spec/06 §2 corner cases) ─────────────────────────────────────

describe("partitionIntoUnits — spec/06 §2 corner cases", () => {
  it("assistant with toolCalls but NO results yet → toolGroup of just the assistant", () => {
    const msgs: MessageLike[] = [user("go"), asst("pending")]; // no result for "pending"
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:1");
    expect(units[1]).toEqual({ indices: [1], kind: "toolGroup" }); // NOT demoted to plain
    expectPairingInvariant(msgs, units);
  });

  it("parallel-tool mode: ONE assistant with 2 toolCalls + 2 results → ONE toolGroup (spec/06 §9)", () => {
    const msgs: MessageLike[] = [asst("p1", "p2"), result("p1"), result("p2")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ indices: [0, 1, 2], kind: "toolGroup" });
    expectPairingInvariant(msgs, units);
  });

  it("two SEPARATE assistant+result pairs → two toolGroups", () => {
    const msgs: MessageLike[] = [asst("a"), result("a"), asst("b"), result("b")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:2:2");
    expectPairingInvariant(msgs, units);
  });

  it("interleaved: asst(a), asst(b), result(a), result(b) → two toolGroups [0,2] and [1,3]", () => {
    const msgs: MessageLike[] = [asst("a"), asst("b"), result("a"), result("b")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:1:2");
    expect(units[0].indices).toEqual([0, 2]); // asst(a) groups with result(a) at index 2
    expect(units[1].indices).toEqual([1, 3]); // asst(b) groups with result(b) at index 3
    expectPairingInvariant(msgs, units);
  });

  it("a toolResult whose assistant had only a malformed (no-id) call → orphan → plain unit", () => {
    // assistant at 0 has a toolCall with NO valid id; result at 1 references "x" → no match → orphan plain
    const msgs: MessageLike[] = [
      { role: "assistant", content: [{ type: "toolCall", id: "", name: "t", arguments: {} }] },
      result("x"),
    ] as unknown as MessageLike[];
    const units = partitionIntoUnits(msgs);
    expect(units.every((u) => u.kind === "plain")).toBe(true); // both plain: can't confirm either pair
    expect(units).toHaveLength(2);
  });
});

// ── plain units (non-tool messages) ─────────────────────────────────────────────

describe("partitionIntoUnits — plain units (everything not in a toolGroup)", () => {
  it("empty message list → []", () => {
    expect(partitionIntoUnits([])).toEqual([]);
  });

  it("a list with NO tools → all plain units, one per message, in order", () => {
    const msgs: MessageLike[] = [user("a"), asstText("b"), custom("mulligan:note"), user("c")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | plain:1:1 | plain:2:1 | plain:3:1");
    expect(units.every((u) => u.kind === "plain")).toBe(true);
  });

  it("custom messages (mulligan:note / mulligan:nudge) → plain units", () => {
    const msgs: MessageLike[] = [custom("mulligan:note"), custom("mulligan:nudge")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.kind === "plain")).toBe(true);
  });

  it("a text-only assistant sandwiched between two toolGroups stays plain", () => {
    const msgs: MessageLike[] = [asst("a"), result("a"), asstText("commentary"), asst("b"), result("b")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | plain:2:1 | toolGroup:3:2");
    expect(units[1]).toEqual({ indices: [2], kind: "plain" });
    expectPairingInvariant(msgs, units);
  });
});

// ── defensive / never throws (spec/08 E13; context-handler hot path) ────────────

describe("partitionIntoUnits — defensive (NEVER throws — GOTCHA #8)", () => {
  it("null / undefined / non-array messages → [] (no throw)", () => {
    expect(partitionIntoUnits(null)).toEqual([]);
    expect(partitionIntoUnits(undefined)).toEqual([]);
    expect(partitionIntoUnits("not-an-array" as unknown as MessageLike[])).toEqual([]);
    expect(partitionIntoUnits({} as unknown as MessageLike[])).toEqual([]);
  });

  it("a non-record message element is skipped gracefully (no throw)", () => {
    const msgs = [null, 42, "raw", undefined] as unknown as MessageLike[];
    expect(() => partitionIntoUnits(msgs)).not.toThrow();
    // 4 plain units (each garbage index stands alone as plain)
    expect(partitionIntoUnits(msgs)).toHaveLength(4);
    expect(partitionIntoUnits(msgs).every((u) => u.kind === "plain")).toBe(true);
  });

  it("an assistant with non-array content → plain (no toolCall blocks read)", () => {
    const msgs: MessageLike[] = [{ role: "assistant", content: "just a string" }] as unknown as MessageLike[];
    expect(() => partitionIntoUnits(msgs)).not.toThrow();
    expect(partitionIntoUnits(msgs)).toEqual([{ indices: [0], kind: "plain" }]);
  });

  it("toolCall blocks with missing / non-string / empty ids are not pairable (GOTCHA #4)", () => {
    const msgs: MessageLike[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", name: "t", arguments: {} }, // missing id
          { type: "toolCall", id: 123, name: "t", arguments: {} }, // non-string id
          { type: "toolCall", id: "", name: "t", arguments: {} }, // empty id
          { type: "text", text: "hi" },
        ],
      } as unknown as MessageLike,
    ];
    const units = partitionIntoUnits(msgs);
    expect(units).toEqual([{ indices: [0], kind: "plain" }]); // no valid-id call → plain
  });

  it("duplicate toolCallId across two results → BOTH group with the assistant (orphan-safe — GOTCHA #9)", () => {
    const msgs: MessageLike[] = [asst("dup"), result("dup"), result("dup")]; // two results, one call id
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("toolGroup");
    expect(units[0].indices).toEqual([0, 1, 2]); // both results join the SAME toolGroup → no orphan on removal
  });

  it("a result appearing BEFORE its assistant still pairs (order-robust — GOTCHA #9)", () => {
    const msgs: MessageLike[] = [result("x"), asst("x")]; // result at 0, assistant at 1 (malformed order)
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ indices: [0, 1], kind: "toolGroup" }); // grouped + sorted ascending
  });

  it("never throws on a throwing-Proxy message (fail-open like tokens.ts/ledger.ts)", () => {
    const trap: MessageLike = new Proxy(
      { role: "assistant", content: [{ type: "toolCall", id: "t", name: "x", arguments: {} }] } as MessageLike,
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => partitionIntoUnits([trap])).not.toThrow();
    // every property read throws → readOwn swallows → treated as non-record/non-assistant → plain unit
    expect(partitionIntoUnits([trap])).toEqual([{ indices: [0], kind: "plain" }]);
  });

  it("accepts a real-ish Pi AgentMessage[] shape (structural typing)", () => {
    const msgs = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.ts" } },
        ],
      },
      { role: "toolResult", toolCallId: "call_1", toolName: "read", content: [{ type: "text", text: "..." }], isError: false },
    ] as const;
    const units = partitionIntoUnits(msgs as unknown as MessageLike[]);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2");
    expectPairingInvariant(msgs as unknown as MessageLike[], units);
  });
});

// ── ordering & determinism ──────────────────────────────────────────────────────

describe("partitionIntoUnits — ordering & determinism", () => {
  it("units are ordered by their minimum index (indices[0])", () => {
    const msgs: MessageLike[] = [user("u"), asst("a"), result("a"), asst("b"), result("b")];
    const units = partitionIntoUnits(msgs);
    const mins = units.map((u) => u.indices[0]);
    expect(mins).toEqual([...mins].sort((x, y) => x - y)); // strictly non-decreasing
  });

  it("toolGroup indices are sorted ascending", () => {
    const msgs: MessageLike[] = [asst("a", "b"), result("b"), result("a")]; // results in non-call order
    const units = partitionIntoUnits(msgs);
    expect(units[0].indices).toEqual([0, 1, 2]); // ascending, regardless of call/result order
  });

  it("is pure / idempotent — same input → same output across calls", () => {
    const msgs: MessageLike[] = [user("u"), asst("a"), result("a")];
    const a = partitionIntoUnits(msgs);
    const b = partitionIntoUnits(msgs);
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const msgs: MessageLike[] = [user("u"), asst("a"), result("a")];
    const snapshot = JSON.stringify(msgs);
    partitionIntoUnits(msgs);
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });

  it("a representative summary is captured via inline snapshot", () => {
    const msgs: MessageLike[] = [
      user("please"),
      asst("c1"),
      result("c1"),
      asstText("ok"),
      asst("c2", "c3"),
      result("c2"),
      result("c3"),
    ];
    expect(summary(partitionIntoUnits(msgs))).toMatchInlineSnapshot(
      `"plain:0:1 | toolGroup:1:2 | plain:3:1 | toolGroup:4:3"`,
    );
  });
});

// ── types ───────────────────────────────────────────────────────────────────────

describe("types", () => {
  it("partitionIntoUnits returns Unit[]", () => {
    expectTypeOf(partitionIntoUnits([])).toEqualTypeOf<Unit[]>();
  });

  it("Unit has the spec/06 §2 shape", () => {
    const u: Unit = { indices: [0], kind: "plain" };
    expectTypeOf(u).toEqualTypeOf<Unit>();
    expectTypeOf(u.indices).toEqualTypeOf<number[]>();
    expectTypeOf(u.kind).toEqualTypeOf<"plain" | "toolGroup">();
  });

  it("MessageLike accepts real-ish Pi message shapes (structural typing)", () => {
    const m1: MessageLike = { role: "user", content: "hi" };
    const m2: MessageLike = {
      role: "assistant",
      content: [{ type: "toolCall", id: "x", name: "read", arguments: { path: "a.ts" } }],
    };
    const m3: MessageLike = { role: "toolResult", toolCallId: "x", toolName: "read", content: [{ type: "text", text: "y" }] };
    const m4: MessageLike = { role: "custom", customType: "mulligan:note", content: "note", display: true };
    expectTypeOf(m1).toEqualTypeOf<MessageLike>();
    expectTypeOf(m2).toEqualTypeOf<MessageLike>();
    expectTypeOf(m3).toEqualTypeOf<MessageLike>();
    expectTypeOf(m4).toEqualTypeOf<MessageLike>();
  });

  it("accepts null | undefined input (defensive signature)", () => {
    expectTypeOf(partitionIntoUnits(null)).toEqualTypeOf<Unit[]>();
    expectTypeOf(partitionIntoUnits(undefined)).toEqualTypeOf<Unit[]>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: defensive read (mirror tokens.ts/ledger.ts) — readOwn swallows a throwing-Proxy get-trap.
// partitionIntoUnits reads role/content/type/id/toolCallId EXCLUSIVELY through isRecord + readOwn, so a malformed
// or hostile message never crashes the context-handler hot path (E13).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try { return obj[key]; } catch { return undefined; }
}

// PATTERN: only non-empty-string ids are pairable (GOTCHA #4). Read the id, then validate type+length:
const id = readOwn(block, "id");
if (typeof id === "string" && id.length > 0) { callToAssistant.set(id, i); }

// PATTERN: dedup one-assistant-many-calls via an `assigned` Set (GOTCHA #5). callToAssistant.values() yields an
// assistant's index once per call it issued; the Set collapses them to ONE toolGroup.
for (const assistantIndex of callToAssistant.values()) {
  if (assigned.has(assistantIndex)) continue;     // already built this assistant's toolGroup
  const results = assistantToResults.get(assistantIndex) ?? [];
  const indices = [assistantIndex, ...results].sort((a, b) => a - b);
  for (const idx of indices) assigned.add(idx);
  units.push({ indices, kind: "toolGroup" });
}

// CRITICAL: number[] per assistant (NOT a 1:1 Map) keeps duplicate-callId results orphan-safe (GOTCHA #9): if two
// results share a callId, BOTH join the assistant's toolGroup, so removing it hides both together → no orphan.
```

### Integration Points

```yaml
MODULE OWNERSHIP (spec/11 §1):
  - src/transforms.ts   # THIS task CREATES it; ships partitionIntoUnits + Unit + MessageLike.
  - Later P1.M3 subtasks APPEND to this same file (resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint,
    applyRewind, applyShrink, filterPipeline) and REUSE Unit/MessageLike + isRecord/readOwn.

CONSUMERS (no wiring in THIS task — partitionIntoUnits is a pure function consumed later):
  - P1.M3.T5 filterPipeline: calls `const units = partitionIntoUnits(m)` once per filter fire (spec/06 §12).
  - P1.M3.T2.S1 resolveLastToolCallGroup: takes `units: Unit[]` as its first param (spec/06 §3).
  - P1.M3.T4.S1 applyRewind: "unit-aware" removal (spec/06 §3/§4).
  - P1.M4.T2 filter.ts: passes the real `event.messages: AgentMessage[]` (assigns to MessageLike[] with no cast).

CONFIG / DATABASE / ROUTES: none — pure function, zero side effects, zero persistence.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/transforms.ts (and again after the test file). The type+style gate IS tsc (no lint tool).
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output and fix before proceeding.
# (There is NO eslint/prettier/biome — GOTCHA #12. Do NOT run a lint/format command.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new module in isolation.
npx vitest run test/transforms.test.ts -v
# Expected: all transforms tests green.

# Full suite (confirm no regression — baseline was 6 files / 216 tests → now 7 files / 216+N).
npx vitest run
# Expected: 7 test files all green. If a pre-existing suite regressed, this task is pure+additive (new file only)
# so a regression means you accidentally modified another file — revert it.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask. partitionIntoUnits is a pure function with ZERO Pi dependency (no server, no DB, no session).
# Integration validation of the partition primitive happens via filterPipeline (P1.M3.T5) + the F-rewind-core
# scenario (P1.M7.T2 / spec/10 §2.1). Do NOT spin up `pi -e` here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The domain-specific check for THIS primitive is the PAIRING INVARIANT, expressed as a unit test (already in
# test/transforms.test.ts via expectPairingInvariant). For a stronger guarantee, optionally add a randomized
# property test (spec/10 §3):
#   generate random message lists (random roles, random toolCall ids, random orphan injection) → for the resulting
#   Unit[], assert expectPairingInvariant holds AND that concatenating every unit's indices reproduces the input
#   indices (no message lost or duplicated). This is the foundation for the spec/10 §3 pipeline property test (P1.M3.T5).
# (Optional — the deterministic spec/10 §1.1 tests are the required gate for THIS subtask.)
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Level 2 passed: `npx vitest run` → 7 files all green (baseline 6 files / 216 tests + new transforms suite).
- [ ] No lint/format command invented (none configured — GOTCHA #12).

### Feature Validation

- [ ] All success criteria from "What" section met.
- [ ] **spec/10 §1.1** all four pinned cases pass (4-msg→3-units; orphan→plain; 3+3→1 toolGroup of 4; invariant).
- [ ] **spec/06 §2 corner cases** pass (no-results-yet→toolGroup[i]; parallel 1-asst-2-calls; interleaved).
- [ ] Orphan results are ALWAYS plain units, NEVER merged (spec/08 E1).
- [ ] Duplicate callIds are orphan-safe (both results join one toolGroup — GOTCHA #9).
- [ ] Error/defensive cases handled gracefully (never throws; throwing-Proxy → plain unit).
- [ ] `Unit` shape exact: `{ indices: number[]; kind: "plain" | "toolGroup" }`; plain length 1; toolGroup sorted asc.

### Code Quality Validation

- [ ] Follows existing codebase patterns (mirrors tokens.ts/ledger.ts: zero imports, local MessageLike, isRecord/readOwn).
- [ ] File placement matches desired codebase tree (new src/transforms.ts + test/transforms.test.ts only).
- [ ] Anti-patterns avoided (no raw-index removal logic — that's applyRewind's job; no Pi import; no Unit widening).
- [ ] ZERO imports (foundation-tier pure — verified `grep -c '^import' src/transforms.ts` → 0).
- [ ] JSDoc references spec sections (spec/06 §2, spec/08 E1, api_verification §6.4) for the next implementer.

### Documentation & Deployment

- [ ] Code is self-documenting (clear var/function names; JSDoc on every export).
- [ ] Module-header docstring notes that later P1.M3 subtasks APPEND + reuse Unit/MessageLike/isRecord/readOwn.
- [ ] No new env vars / config (pure function, no config surface).

---

## Anti-Patterns to Avoid

- ❌ Don't import `AgentMessage` from Pi (not resolvable at this tier — use local `MessageLike`; GOTCHA #2).
- ❌ Don't reuse `MessageLike` from tokens.ts/ledger.ts (each pure module keeps its own — D1).
- ❌ Don't drop orphan results or merge them speculatively (spec/08 E1 — they become plain units; GOTCHA #6).
- ❌ Don't demote a no-results-yet assistant to plain (it's a toolGroup of one — spec/06 §2; GOTCHA #7).
- ❌ Don't use a 1:1 `Map<callId, resultIndex>` (loses duplicate results → orphan risk; use `number[]` per assistant — GOTCHA #9).
- ❌ Don't assert the invariant's "vice versa" universally (fails on no-results-yet; assert reverse only fully-paired — GOTCHA #13).
- ❌ Don't implement resolve*/apply*/pipeline here (later P1.M3 subtasks APPEND; GOTCHA #1).
- ❌ Don't skip validation because "it should work" — run tsc + vitest after creating each file.
- ❌ Don't widen the `Unit` shape or the function signature beyond spec/06 §2.
- ❌ Don't invent a lint/format command (none configured — GOTCHA #12).
- ❌ Don't catch all exceptions broadly inside `partitionIntoUnits` — the only try/catch is inside `readOwn` (the
  Proxy-trap guard); the algorithm itself is exception-free because every field read goes through isRecord/readOwn.

---

## Confidence Score: 10/10 — VERBATIM CODE VALIDATED END-TO-END

The exact code blocks above were extracted programmatically from this PRP and validated in an ISOLATED copy of the
repo (separate `node_modules` symlink; the real repo's source was never touched by the research agent):
  - `npx tsc --noEmit -p tsconfig.json` → **exit 0** (clean under `strict`; no defensive-branch reachability warnings).
  - `npx vitest run test/transforms.test.ts` → **30/30 tests pass** (spec/10 §1.1 pinned + corner + defensive + types).
  - `npx vitest run` (full suite) → **7 files / 246 tests green** (baseline 6 files / 216 → +1 file / +30 transforms;
    zero regressions).
  - The single `toMatchInlineSnapshot` matched **without `-u`** (the pinned summary string is exact).
  - `grep -c '^import' src/transforms.ts` → **0** (the zero-imports foundation-tier gate holds).

This validation caught + fixed one real defect in the verbatim code before it could fail one-pass implementation:
the JSDoc shorthand `resolve*/apply*` contains `*/`, which prematurely closes the JSDoc comment and breaks parsing
(fixed → `resolve/apply transform functions`). The algorithm is spec-pinned (spec/06 §2 steps a–e), the tests are
spec-pinned (spec/10 §1.1), and the message shapes are verified (api_verification.md §6.1/§6.2). One-pass success is
essentially guaranteed.