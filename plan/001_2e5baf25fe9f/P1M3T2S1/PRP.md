# PRP — P1.M3.T2.S1: `resolveLastToolCallGroup` — last-toolGroup rewind targeting

**Work item:** P1.M3.T2.S1 · **Points:** 1 · **Stage:** Pure Core — Context Filter Transforms (the correctness heart)
**Scope:** **APPEND to two EXISTING files** — add `resolveLastToolCallGroup` (exported pure function) to
`src/transforms.ts` and add its vitest Tier-1 tests to `test/transforms.test.ts`. **No new file, no other file
touched.** Zero new imports (reuse the `Unit` / `MessageLike` interfaces + the module-private `isRecord` / `readOwn`
that P1.M3.T1.S1 defined in this same file). Never throws. This is **S2-T1 of the `transforms.ts` build** (spec/11 §2):
it ships the first rewind-*resolver* that `filterPipeline` (T5.S1) consumes.

> **PARALLEL-EXECUTION CONTRACT (READ FIRST):** P1.M3.T1.S1 (`partitionIntoUnits`) is being implemented **in
> parallel** and is treated as a **hard contract**. By the time THIS task runs, `src/transforms.ts` + `test/
> transforms.test.ts` ALREADY EXIST (T1.S1 lands first) containing: `partitionIntoUnits`, `export interface Unit
> { indices: number[]; kind: "plain" | "toolGroup" }`, `export interface MessageLike { role?: string; content?:
> string | ContentBlock[]; [key: string]: unknown }`, and module-private `isRecord` / `readOwn`. This task **APPENDS
> `resolveLastToolCallGroup` + a module-private `assistantIssuedCall` helper** to that file and **APPENDS a new
> `describe` block + modifies the import line** in that test file. Do NOT recreate, redefine, or import any of those
> symbols — they are already in module scope. Read `plan/001_2e5baf25fe9f/P1M3T1S1/PRP.md` for the authoritative
> definitions you are building on.

---

## Goal

**Feature Goal**: Ship Mulligan's **first rewind resolver** — a pure, Pi-free `resolveLastToolCallGroup(units,
messages, excludeToolCallId?)` that finds the **most recent `toolGroup` unit**, *excluding* the unit whose assistant
message issued the rewind's own `toolCall` (`excludeToolCallId`). This is the targeting primitive behind the
`last_tool_call_group` granularity (spec/05 §1; spec/06 §3): when the agent calls `mulligan_rewind`, that call is
*itself* a `toolGroup` (the assistant message carrying the `mulligan_rewind` toolCall + its result); without
exclusion, "last tool-call group" would resolve to **the rewind itself**. The resolver walks units end→backward,
skips `plain` units, skips any `toolGroup` whose assistant issued `excludeToolCallId`, and returns the first
non-skipped `toolGroup`'s `indices` (or `null`). Because it returns a *unit's* indices, the later `applyRewind`
(T4.S1) removes the assistant call **and all its results together** → pairing is preserved by construction (api_veri
fication.md §6.4).

**Deliverable** (APPEND to two EXISTING files — do NOT create new files):
1. `src/transforms.ts` — APPEND (the file already exists from T1.S1):
   - `export function resolveLastToolCallGroup(units: Unit[], messages: MessageLike[], excludeToolCallId?: string):
     number[] | null` — the algorithm (spec/06 §3 steps 1–5).
   - one module-private helper: `assistantIssuedCall(messages, indices, callId): boolean` (defensive; never throws;
     reuses `isRecord`/`readOwn`).
   - **NO new imports** (reuse `Unit`, `MessageLike`, `isRecord`, `readOwn` already in module scope). File import
     count stays **0** (foundation-tier pure, like `tokens.ts`/`ledger.ts`).
2. `test/transforms.test.ts` — APPEND (the file already exists from T1.S1):
   - MODIFY the import line to add `resolveLastToolCallGroup`.
   - ADD one new `describe("resolveLastToolCallGroup …")` block covering spec/10 §1.2 pinned cases + corner +
     defensive + parallel-tool + types.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (the appended code + tests type-sound under `strict`).
- `npx vitest run` is **all-green** — the existing `transforms` suite (T1.S1's tests) **AND** the appended
  `resolveLastToolCallGroup` block; no pre-existing suite regresses (this task is append-only to one src file + one
  test file; it cannot regress `tokens`/`ledger`/`notes`/`config`/`log`/`runtime`).
- `resolveLastToolCallGroup` **never throws** (E13; it sits on the `context` handler hot path via `filterPipeline`) —
  non-array `units`, malformed messages, throwing-Proxy messages, and a missing/non-string/empty
  `excludeToolCallId` are all handled gracefully.
- The **spec/10 §1.2 pinned contract** holds exactly: `[u, a(A), r(A), a(B), r(B)]` with no exclude → `[3,4]`;
  exclude `"B"` → `[1,2]`; no toolGroup → `null`.

---

## User Persona

**Target User**: The implementing AI agent for `filterPipeline` (P1.M3.T5.S1) — the single consumer of this
function. `filterPipeline` calls `resolveLastToolCallGroup(units, m, rw.excludeToolCallId)` per `last_tool_call_group`
rewind marker (spec/06 §12) and feeds the returned `number[] | null` to `applyRewind` (P1.M3.T4.S1). The SECOND
consumer is the test suite (spec/10 §1.2).

**Use Case**: On a `last_tool_call_group` rewind, the agent issued `mulligan_rewind(...)` — a toolCall whose own
`toolGroup` is the most recent one in the message list. The resolver must skip that self-toolGroup and target the
*previous* tool interaction (the actual mistake). It returns that unit's indices so `applyRewind` removes the
assistant call + all its results together → the model never sees an orphaned `toolCall`/`toolResult`.

**User Journey**:
1. `mulligan_rewind` executes → persists a marker with `excludeToolCallId = <the rewind toolCall's id>` (spec/05 §1).
2. Next inference → `context` handler → `filterPipeline` → `const units = partitionIntoUnits(m)` (T1.S1).
3. For the rewind marker: `remove = resolveLastToolCallGroup(units, m, rw.excludeToolCallId) ?? []` → the prior
   toolGroup's indices (the rewind's own toolGroup is skipped).
4. `applyRewind` removes those indices gap-closed → the model resumes at the note, pairing intact.

**Pain Points Addressed**: Without the exclusion, "rewind the last tool call group" would always target the
rewind's *own* call → an infinite self-rewind / the mistake never sheds. `excludeToolCallId` is the surgical skip
that makes `last_tool_call_group` target the **completed work before the current turn** (spec/08 E2).

---

## Why

- **Unblocks the `last_tool_call_group` rewind path end-to-end (at the pure tier).** `resolveLastToolCallGroup` is
  the targeting half of the surgical rewind (spec/06 §3 + spec/05 §1). `filterPipeline` (T5.S1) wires it; `applyRewind`
  (T4.S1) consumes its output. Shipping it now (pure-core, unit-testable in isolation) lets T5.S1 focus on pipeline
  composition + protected-message checks, not targeting logic.
- **The exclusion rule is the core correctness invariant for this granularity.** spec/06 §3 + spec/08 E2 prescribe
  EXACTLY why + how the rewind's own call is excluded. The rule *also* resolves the parallel-tool edge case
  conservatively (spec/06 §9, spec/08 E6): if `mulligan_rewind` shares an assistant message with sibling calls, the
  whole shared toolGroup is skipped → the previous toolGroup becomes the target (pairing-safe, never an orphan). The
  algorithm is fully spec-pinned — there are NO open design questions, only implementation.
- **Pure-core tier & unit-testable in isolation.** `resolveLastToolCallGroup` adds NO new imports (it reuses
  `Unit`/`MessageLike`/`isRecord`/`readOwn` already in `transforms.ts`). It is a pure, deterministic, side-effect-free
  function covered by fast unit tests with no Pi, no model, no session (spec/10 §1; spec/03 §7).

---

## What

APPEND `resolveLastToolCallGroup` (+ a module-private `assistantIssuedCall`) to `src/transforms.ts`, and APPEND a
`resolveLastToolCallGroup` test block (+ a one-line import edit) to `test/transforms.test.ts`.

`resolveLastToolCallGroup`:

- **Accepts** `units: Unit[]` (from `partitionIntoUnits`), `messages: MessageLike[]` (for reading assistant toolCall
  ids via `readOwn`), and `excludeToolCallId?: string` (the rewind's own toolCall id — `undefined`/empty/non-string
  means "never skip"). Returns `number[] | null`.
- **Algorithm** (spec/06 §3, steps 1–5; verbatim code in the Blueprint):
  1. If `units` is not an array → return `null` (defensive).
  2. Iterate `units` from the **last index backward** to `0`.
  3. Skip non-`toolGroup` units (skip `plain` units + any malformed record).
  4. For each `toolGroup`: if `excludeToolCallId` is a non-empty string AND that unit's assistant message issued a
     toolCall with `id === excludeToolCallId` → **skip** (the rewind's own toolGroup; or a parallel-shared message
     — spec/06 §9 / spec/08 E6).
  5. The first non-skipped `toolGroup` from the end → return its `unit.indices`.
  6. If the loop exhausts with no toolGroup → return `null` (nothing to rewind → `applyRewind` no-ops → spec/08 E8).

This subtask does **NOT**: implement `applyRewind`/`resolveLastTurn`/`resolveCheckpoint`/`applyShrink`/`filterPipeline`
(later P1.M3 subtasks APPEND to this same file); import anything (the file is already foundation-tier pure); redefine
`Unit`/`MessageLike`/`isRecord`/`readOwn` (reuse them); mutate `units`/`messages`; or change the `Unit` shape.

### Success Criteria

- [ ] `src/transforms.ts` has an EXPORTED `resolveLastToolCallGroup(units: Unit[], messages: MessageLike[],
      excludeToolCallId?: string): number[] | null` + a module-private `assistantIssuedCall`, and **NO new imports**
      (`grep -c '^import' src/transforms.ts` still → 0).
- [ ] `test/transforms.test.ts` has a new `describe("resolveLastToolCallGroup …")` block; the import line now includes
      `resolveLastToolCallGroup`; the whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **spec/10 §1.2 — no-exclude:** `[user, asst("A"), result("A"), asst("B"), result("B")]` → returns the B
      toolGroup's indices `[3,4]`.
- [ ] **spec/10 §1.2 — exclude:** same list with `excludeToolCallId = "B"` → returns the A toolGroup's indices
      `[1,2]` (skips the rewind's own B toolGroup).
- [ ] **spec/10 §1.2 — no toolGroup:** a list with only `plain` units → `null`.
- [ ] **excludeToolCallId matches NO unit** → returns the last toolGroup (the rewind's own call id not present →
      nothing skipped).
- [ ] **only ONE toolGroup and exclude matches it** → `null` (the only toolGroup is the rewind's own; nothing left).
- [ ] **parallel-tool (spec/06 §9 / spec/08 E6):** one assistant carrying `mulligan_rewind` + a sibling call → that
      toolGroup is skipped, the *previous* toolGroup is returned.
- [ ] **Never throws:** non-array `units` → `null`; malformed messages / throwing-Proxy assistant → no exclude match
      → returns the toolGroup; missing/non-string/empty `excludeToolCallId` → never skips.
- [ ] **Signature exact:** `resolveLastToolCallGroup(units: Unit[], messages: MessageLike[], excludeToolCallId?:
      string): number[] | null` (returns `unit.indices`, not a `Unit` object).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `resolveLastToolCallGroup` + `assistantIssuedCall` to APPEND are given verbatim
> below (Task 1), and the exact tests + import edit are given verbatim (Task 2). The algorithm is spec-pinned
> (spec/06 §3 steps 1–5); the exact tests are spec-pinned (spec/10 §1.2); the parallel-tool handling is spec-pinned
> (spec/06 §9, spec/08 E6); the never-throws discipline + the `isRecord`/`readOwn` convention are inherited verbatim
> from T1.S1's `transforms.ts` (the authoritative sibling definition). The only prerequisite is that T1.S1 has landed
> `src/transforms.ts` + `test/transforms.test.ts` (the parallel-execution contract). No prior knowledge beyond "this
> APPENDS a pure function + helper to the existing transforms module and APPENDS its tests" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/transforms.ts` — it ALREADY EXISTS (T1.S1).** Ship ONLY `resolveLastToolCallGroup` (exported) +
  the module-private `assistantIssuedCall`. REUSE the in-scope `Unit`, `MessageLike`, `isRecord`, `readOwn` — do NOT
  redefine or re-export them. Later P1.M3 subtasks (resolveLastTurn, resolveCheckpoint, applyRewind, applyShrink,
  filterPipeline) APPEND further to this same file.
- **APPEND to `test/transforms.test.ts` — it ALREADY EXISTS (T1.S1).** Add ONE new `describe` block + MODIFY the
  import line (one precise edit). Reuse the fixture helpers T1.S1 already defined: `asst`, `asstText`, `result`,
  `user`, `custom`, `summary`, `expectPairingInvariant`. Do NOT redefine them.
- **NO new imports.** `resolveLastToolCallGroup` references only `Unit`, `MessageLike` (types) and `isRecord`,
  `readOwn` (helpers) already in the module. The file's import count stays 0 (it is foundation-tier pure, like
  `tokens.ts`/`ledger.ts`).
- **Return `number[] | null`, NOT `Unit | null`.** spec/06 §3 signature + the work-item contract are authoritative.
  (spec/06 §12's `u ? u.indices : []` pseudocode is reference-only and inconsistent; the later `filterPipeline` (T5.S1)
  adapts to `?? []` — see Integration Points.)
- **Do NOT handle the parallel-tool case specially.** The single rule "skip a toolGroup whose assistant issued
  `excludeToolCallId`" already resolves it conservatively (spec/06 §9 / spec/08 E6): the shared toolGroup is skipped,
  the previous toolGroup becomes the target. Pairing stays safe. No surgical splitting in this pure helper.

### Documentation & References

```yaml
# MUST READ — authoritative sources for resolveLastToolCallGroup
- file: spec/06-context-filter.md
  section: "§3 resolveLastToolCallGroup"
  why: "THE source: the signature `resolveLastToolCallGroup(units, messages, excludeToolCallId?): number[] | null`
        and the 5-step algorithm (iterate end→backward, skip plain, skip the unit whose assistant issued
        excludeToolCallId, return the first non-skipped toolGroup's indices, else null)."
  critical: "Return type is `number[] | null` (the unit's indices). §12's pseudocode treats it as a Unit — that is
             reference-only; T5.S1's filterPipeline adapts to `?? []`. The exclude rule is WHY the function exists:
             without it, 'last tool-call group' resolves to the rewind itself."

- file: spec/10-testing.md
  section: "§1.2 resolveLastToolCallGroup"
  why: "THE exact unit tests: (1) [u, a(A), r(A), a(B), r(B)] no exclude → a(B)+r(B) unit; (2) exclude='B' → a(A)+r(A)
        unit; (3) no toolGroup → null. Implement these three verbatim, then add corner/defensive/parallel tests."
  critical: "Assert the returned indices match the resolved toolGroup's indices EXACTLY (e.g. [3,4] and [1,2]), not a
             deep-equal to a Unit object. The return is `number[]`."

- file: spec/08-edge-cases.md
  section: "E2 (rewinding the executing turn) + E6 (parallel tool mode) + E8 (marker targets nothing)"
  why: "E2: the rewind's own call must be excluded — the resolver does this via excludeToolCallId, no special case.
        E6/§9: mulligan_rewind + sibling calls in one assistant message → the shared toolGroup is skipped, the previous
        toolGroup is targeted (conservative, pairing-safe). E8: nothing matches → null → applyRewind no-ops."
  critical: "These three prescribe the defensive + parallel behavior. The simple exclude rule satisfies all three."

- file: plan/001_2e5baf25fe9f/P1M3T1S1/PRP.md
  section: "Exact content to CREATE — src/transforms.ts (Unit/MessageLike/isRecord/readOwn/partitionIntoUnits) +
            test/transforms.test.ts (fixture helpers asst/asstText/result/user/custom + summary + expectPairingInvariant)"
  why: "THE contract for the symbols this task REUSES. Read it to confirm the exact shapes: Unit = { indices:
        number[]; kind: 'plain'|'toolGroup' }; MessageLike carries role?/content?/[key]; isRecord(value) + readOwn(obj,
        key) are module-private + Proxy-safe. The fixture helpers + the import line in the test file are defined here."
  critical: "Do NOT redefine these — APPEND. The test import line is `import { partitionIntoUnits, type Unit, type
             MessageLike } from '../src/transforms.js';` — extend it to also import `resolveLastToolCallGroup`."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§6.4 (tool-pairing invariant) + §6.1/§6.2 (ToolCall block shape) + 'NOTE on execute signature'"
  why: "Confirms why this returns a UNIT's indices (removing a toolGroup keeps pairing intact) and where
        excludeToolCallId comes from: the tool's `execute(toolCallId, params, …)` FIRST argument is persisted on the
        rewind marker as `excludeToolCallId`."
  critical: "ToolCall block = { type:'toolCall', id, name, arguments }. The id comparison `block.id === excludeToolCallId`
             is the whole skip test. The model API rejects an orphaned toolCall/toolResult — returning unit indices is
             what keeps pairing intact downstream."

- file: spec/05-tools.md
  section: "§1 mulligan_rewind (behavior step 6 + the marker shape `excludeToolCallId: toolCallId`)"
  why: "Confirms the marker the rewind tool persists carries `excludeToolCallId: toolCallId` — the exact field
        filterPipeline passes to this resolver. My function just receives it as a param."

# FILES TO MIRROR (read-only pattern contracts — do NOT modify)
- file: src/transforms.ts
  why: "The file you APPEND to (created by T1.S1). Reuse its isRecord/readOwn for every field read (Proxy-trap-safe,
        never throws). Mirror its JSDoc style (reference spec sections) and the 'NEVER throws (E13)' discipline."
  pattern: "partitionIntoUnits reads role/content via isRecord+readOwn, iterates content[] blocks, checks
            readOwn(block,'type')==='toolCall' and validates the id. resolveLastToolCallGroup follows the SAME
            defensive read pattern but targets instead of groups."

- file: test/transforms.test.ts
  why: "The test file you APPEND to (created by T1.S1). Reuse its fixture helpers + the throwing-Proxy defensive test
        idiom. Mirror its `describe`/`it`/`expect`/`expectTypeOf` house style."
  pattern: "Tests import from '../src/transforms.js' (.js extension under moduleResolution:'Bundler'). Add
            resolveLastToolCallGroup to that import; add one new describe block."

- file: plan/001_2e5baf25fe9f/P1M3T2S1/research/notes.md
  why: "THE resolution of every spec-open detail (D1 return type, D2 append-not-create, D3 excludeToolCallId source,
        D4 single-rule parallel handling, D5 defensive, D6 find-assistant, D7 return reference, D8 test reuse)."
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
│   ├── tokens.ts / ledger.ts / notes.ts  # foundation-tier pure helpers (DO NOT TOUCH — pattern contracts only).
│   └── transforms.ts       # CREATED BY T1.S1 (partitionIntoUnits + Unit + MessageLike + isRecord/readOwn). APPEND HERE.
│                           #   (if T1.S1 has NOT landed yet, STOP — this task depends on it; see Validation Task 0.)
├── test/
│   ├── config/ledger/log/runtime/tokens/notes .test.ts   # DO NOT TOUCH.
│   └── transforms.test.ts  # CREATED BY T1.S1 (partitionIntoUnits suite + fixtures). APPEND a block + edit the import.
└── spec/                   # 06 §3 (THE algorithm) + 10 §1.2 (THE tests) + 08 E2/E6/E8 + 05 §1 (marker field) + 11 §2.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   7 files all green (T1.S1 added transforms.test.ts to the prior 6 files / 216 tests). This task APPENDS to two
#   existing files only; it cannot regress the other suites.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
#   The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent a lint/format command.
```

### Desired Codebase tree with files to be MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── transforms.ts       # MODIFIED — APPEND resolveLastToolCallGroup (exported) + assistantIssuedCall (module-private). No new imports.
└── test/
    └── transforms.test.ts  # MODIFIED — APPEND a resolveLastToolCallGroup describe block; EDIT the import line (+1 symbol).
# No other files touched. Later P1.M3 subtasks APPEND resolveLastTurn/resolveCheckpoint/applyRewind/applyShrink/filterPipeline.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — APPEND, do NOT CREATE. src/transforms.ts + test/transforms.test.ts ALREADY EXIST (T1.S1).
#   REUSE the in-scope Unit, MessageLike, isRecord, readOwn — do NOT redefine or re-import them. REUSE the test
#   fixtures asst/asstText/result/user/custom/summary/expectPairingInvariant — do NOT redefine them. If T1.S1 has not
#   landed (the files are absent), STOP and surface it — this task strictly depends on T1.S1 (Validation Task 0 gate).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — Return `number[] | null`, NOT `Unit | null`. spec/06 §3 signature + the work-item contract
#   are authoritative. spec/06 §12's `u ? u.indices : []` pseudocode treats the return as a Unit — it is
#   reference-only and INCONSISTENT. The later filterPipeline (T5.S1) adapts to `remove = resolveLastToolCallGroup(...) ?? []`.
#   Do NOT change the signature to return a Unit to "match §12" — T5.S1 adapts, not this function.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — ZERO new imports. resolveLastToolCallGroup references only Unit, MessageLike (types) and
#   isRecord, readOwn (helpers) already in module scope. The file's import count stays 0 (foundation-tier pure,
#   sibling of tokens.ts/ledger.ts). Do NOT `import type { AgentMessage }` from Pi (not resolvable at this tier).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — NEVER throws (E13; context-handler hot path via filterPipeline). Every field read goes
#   through isRecord + readOwn (a throwing-Proxy get-trap returns undefined, not an exception). Non-array units → null.
#   Malformed messages / missing ids → no exclude match → the toolGroup is returned (fail-safe, never an orphan).
#   No @ts-ignore (defensive branches compile cleanly under strict — mirror partitionIntoUnits).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — The exclude rule is a SINGLE rule and it handles BOTH E2 (rewind's own call) AND the
#   parallel-tool case (E6/§9). Do NOT add special parallel-tool branching: "skip a toolGroup whose assistant message
#   issued a toolCall with id === excludeToolCallId" is correct + pairing-safe for both. If mulligan_rewind shares an
#   assistant message with sibling calls, the shared toolGroup is skipped → the previous toolGroup is the target
#   (conservative). No surgical splitting in this pure helper.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — Find the assistant DEFENSIVELY among a toolGroup's indices (by role === 'assistant' + array content),
#   and check ALL its toolCall blocks (parallel mode = one assistant, several calls). partitionIntoUnits guarantees
#   exactly one assistant per toolGroup (at indices[0]), but scanning is robust to malformed input. If no assistant is
#   found (malformed), there can be no excludeToolCallId match → do NOT skip (return the toolGroup).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — excludeToolCallId undefined / empty string / non-string → NEVER skip. The strict `===` already
#   guarantees this (a valid id is a non-empty string; `undefined === 'x'` is false), but guard explicitly
#   (`typeof excludeToolCallId === 'string' && excludeToolCallId.length > 0`) to document intent + short-circuit.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — Return the unit's `indices` reference (NOT a copy). It is a read-only view; downstream applyRewind
#   (T4.S1) builds a new array and never mutates the input indices. A defensive copy is unnecessary overhead on a
#   path resolved once per rewind marker per filter fire. (If you prefer, a `[...unit.indices]` copy is harmless but
#   not required.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — The test imports from "../src/transforms.js" (.js extension, even though the file is transforms.ts).
#   moduleResolution:'Bundler' + type:'module' → TS resolves .js to .ts. MODIFY the existing import line to add
#   resolveLastToolCallGroup (one precise edit). Do NOT add a second import line.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No new data models. REUSE the types + helpers T1.S1 already defined in `src/transforms.ts`:

```ts
// ALREADY IN SCOPE (T1.S1) — reuse, do NOT redefine:
export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]: unknown; }
export interface Unit { indices: number[]; kind: "plain" | "toolGroup"; }
// module-private: isRecord(value), readOwn(obj, key)   // Proxy-safe; never throw
```

This task ADDS one EXPORTED function + one module-private helper:

```ts
export function resolveLastToolCallGroup(
  units: Unit[], messages: MessageLike[], excludeToolCallId?: string,
): number[] | null;

// module-private:
function assistantIssuedCall(messages: MessageLike[] | unknown, indices: number[], callId: string): boolean;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITE + BASELINE (no edits — run only)
  - RUN: test -f src/transforms.ts && test -f test/transforms.test.ts && echo "ok: T1.S1 landed (APPEND)" 
        # if this FAILS, T1.S1 has not landed — STOP and surface it (this task strictly depends on it).
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect all-green (incl. transforms.test.ts)
  - RUN: grep -n "interface Unit" src/transforms.ts && grep -n "function isRecord\|function readOwn" src/transforms.ts
        # confirm the symbols you reuse exist + are module-private helpers.

Task 1: APPEND resolveLastToolCallGroup to src/transforms.ts   (exact content below — copy verbatim)
  - APPEND: the resolveLastToolCallGroup export + the module-private assistantIssuedCall helper (at the end of the file,
            after partitionIntoUnits and the isRecord/readOwn definitions).
  - CONSTRAINTS:
      * NO new imports (GOTCHA #3). Reuse Unit/MessageLike/isRecord/readOwn.
      * Return number[] | null (GOTCHA #2). Return unit.indices reference (GOTCHA #8).
      * Iterate units end→backward; skip non-toolGroup; skip toolGroup whose assistant issued excludeToolCallId (GOTCHA #5/#6).
      * Defensive: non-array units → null; read everything via isRecord/readOwn; never throws (GOTCHA #4).
      * excludeToolCallId non-string/empty → never skip (GOTCHA #7).
      * signature exactly resolveLastToolCallGroup(units: Unit[], messages: MessageLike[], excludeToolCallId?: string): number[] | null.
  - NAMING/PLACEMENT: src/transforms.ts (APPEND). Export: resolveLastToolCallGroup. Module-private: assistantIssuedCall.

Task 2: APPEND resolveLastToolCallGroup tests to test/transforms.test.ts   (exact content below — copy verbatim)
  - EDIT: the import line — add `resolveLastToolCallGroup` to the existing `import { partitionIntoUnits, … } from "../src/transforms.js"`.
  - APPEND: one new `describe("resolveLastToolCallGroup — spec/10 §1.2 + corner + defensive + parallel + types", …)`.
  - CONSTRAINTS: REUSE the existing fixtures (asst/asstText/result/user/custom/summary/expectPairingInvariant) — do NOT redefine.
    NO beforeEach (pure, stateless). Mirror the existing describe/it/expect/expectTypeOf house style. Throwing-Proxy defensive test.
  - COVERAGE: spec/10 §1.2 pinned (no-exclude→[3,4]; exclude='B'→[1,2]; no toolGroup→null); exclude-matches-no-unit→last toolGroup;
    only-one-toolGroup-and-exclude-matches→null; parallel-tool (E6/§9)→skips shared, returns previous; exclude is undefined/empty/
    non-string→never skips; defensive (non-array units→null; throwing-Proxy assistant→no match→returned; malformed messages);
    plain-only list→null; purity/idempotence; types (expectTypeOf returns number[] | null).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Levels 3/4 N/A (pure helper — no Pi, no server, no DB).
```

#### Exact content to APPEND — `src/transforms.ts`

```ts
/**
 * resolveLastToolCallGroup — find the most recent toolGroup unit, EXCLUDING the unit whose
 * assistant message issued the rewind's own toolCall (spec/06-context-filter.md §3).
 *
 * ALGORITHM (spec/06 §3, steps 1–5):
 *   1. Iterate `units` from the END backward to index 0.
 *   2. Skip any `plain` unit (and any malformed record) — they carry no tool calls.
 *   3. For each `toolGroup`, if `excludeToolCallId` is a non-empty string AND that unit's assistant
 *      message issued a toolCall with `id === excludeToolCallId` → SKIP it. That is the rewind's OWN
 *      toolGroup (the assistant message carrying the `mulligan_rewind` toolCall + its result); without
 *      exclusion "last tool-call group" would resolve to the rewind itself (spec/08 E2). The SAME rule
 *      resolves the parallel-tool case conservatively (spec/06 §9, spec/08 E6): if `mulligan_rewind`
 *      shares an assistant message with sibling calls, that whole shared toolGroup is skipped and the
 *      PREVIOUS toolGroup becomes the target (pairing-safe, never an orphan).
 *   4. The first non-skipped toolGroup from the end is the target → return its `indices`.
 *   5. If the loop exhausts with no toolGroup → return `null` (nothing to rewind → applyRewind no-ops → spec/08 E8).
 *
 * WHY exclude: when the agent calls `mulligan_rewind`, that call is itself a toolGroup. The rewind marker
 * carries `excludeToolCallId` (captured from the tool's `execute(toolCallId, params, …)` first argument —
 * spec/05 §1 + api_verification.md "NOTE on execute signature") precisely so the filter can skip it.
 *
 * RETURNS `number[] | null` — the resolved toolGroup's `indices` (NOT a Unit object). The single consumer
 * `filterPipeline` (P1.M3.T5.S1) uses `remove = resolveLastToolCallGroup(units, m, rw.excludeToolCallId) ?? []`
 * (spec/06 §12 pseudocode `u ? u.indices : []` is reference-only and inconsistent with this signature).
 * Returning a unit's indices is what lets `applyRewind` remove the assistant call AND all its results
 * together → the model API never sees an orphaned toolCall/toolResult (api_verification.md §6.4).
 *
 * Pure + defensive: a non-array `units` → null; malformed messages, throwing-Proxy messages, and a
 * non-string/empty `excludeToolCallId` (→ never skip) are all handled gracefully — NEVER throws (E13;
 * context-handler hot path). Every field read goes through the module-private isRecord/readOwn.
 *
 * @param units the partitioned units (from partitionIntoUnits); walked end→start
 * @param messages the message list (for reading assistant toolCall ids, via readOwn)
 * @param excludeToolCallId the rewind's own toolCall id to skip; undefined/empty/non-string → never skip
 * @returns the resolved toolGroup's indices, or null when nothing matches
 */
export function resolveLastToolCallGroup(
  units: Unit[],
  messages: MessageLike[],
  excludeToolCallId?: string,
): number[] | null {
  // Defensive: a non-array units (shouldn't happen) → nothing resolvable.
  if (!Array.isArray(units)) return null;

  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;

  // 1) Walk units from the last to the first.
  for (let k = units.length - 1; k >= 0; k--) {
    const unit = units[k];
    // 2) Skip plain units (+ malformed records). Only toolGroups are candidates.
    if (!isRecord(unit) || unit.kind !== "toolGroup" || !Array.isArray(unit.indices)) continue;

    // 3) If exclusion is active, skip this toolGroup when its assistant issued the rewind's own call
    //    (the rewind's own toolGroup, or a parallel-shared message — spec/06 §9 / spec/08 E6).
    if (hasExclude && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
      continue;
    }

    // 4) First non-skipped toolGroup from the end → return its indices (read-only reference; applyRewind copies).
    return unit.indices;
  }

  // 5) No toolGroup found → nothing to rewind (applyRewind no-ops; spec/08 E8).
  return null;
}

/**
 * Module-private: did the assistant message within this toolGroup issue a toolCall whose id === callId?
 * Defensive (isRecord/readOwn; never throws). `indices` is a toolGroup's member indices (assistant + results).
 * Scans ALL assistant members and ALL their toolCall blocks so a parallel-tool assistant (one message, several
 * calls) is handled (spec/06 §9). Returns false if `messages` is malformed, no assistant is present, or no match.
 */
function assistantIssuedCall(
  messages: MessageLike[] | unknown,
  indices: number[],
  callId: string,
): boolean {
  if (!Array.isArray(messages)) return false;
  for (const i of indices) {
    const msg = messages[i];
    if (!isRecord(msg) || readOwn(msg, "role") !== "assistant") continue;
    const content = readOwn(msg, "content");
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || readOwn(block, "type") !== "toolCall") continue;
      if (readOwn(block, "id") === callId) return true; // this assistant issued the excluded call
    }
  }
  return false;
}
```

#### Exact content to EDIT + APPEND — `test/transforms.test.ts`

EDIT the existing import line (T1.S1 wrote `import { partitionIntoUnits, type Unit, type MessageLike } from "../src/transforms.js";`):

```diff
- import { partitionIntoUnits, type Unit, type MessageLike } from "../src/transforms.js";
+ import { partitionIntoUnits, resolveLastToolCallGroup, type Unit, type MessageLike } from "../src/transforms.js";
```

APPEND this block at the END of the file (reuse the fixtures T1.S1 already defined: `asst`, `asstText`, `result`, `user`, `custom`, `summary`):

```ts
// ── resolveLastToolCallGroup — spec/10 §1.2 + corner + defensive + parallel + types ────

describe("resolveLastToolCallGroup — spec/10 §1.2 PINNED contract", () => {
  it("no exclude → returns the LAST toolGroup's indices (a(B)+r(B))", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2 | toolGroup:3:2");
    expect(resolveLastToolCallGroup(units, msgs)).toEqual([3, 4]); // the a(B)+r(B) toolGroup
  });

  it("excludeToolCallId='B' → returns the a(A)+r(A) toolGroup's indices (skips the rewind's own)", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, "B")).toEqual([1, 2]); // the a(A)+r(A) toolGroup
  });

  it("no toolGroup at all → null", () => {
    const msgs: MessageLike[] = [user("u"), asstText("thinking"), custom("mulligan:note")];
    const units = partitionIntoUnits(msgs);
    expect(units.every((u) => u.kind === "plain")).toBe(true);
    expect(resolveLastToolCallGroup(units, msgs)).toBeNull();
  });
});

describe("resolveLastToolCallGroup — exclude semantics", () => {
  it("excludeToolCallId matching NO unit → returns the last toolGroup (nothing skipped)", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, "DOES-NOT-EXIST")).toEqual([3, 4]);
  });

  it("only ONE toolGroup and exclude matches it → null (the only toolGroup was the rewind's own)", () => {
    const msgs: MessageLike[] = [user("u"), asst("only"), result("only")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2");
    expect(resolveLastToolCallGroup(units, msgs, "only")).toBeNull();
  });

  it("excludeToolCallId is undefined → never skips (same as no exclude)", () => {
    const msgs: MessageLike[] = [asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, undefined)).toEqual([2, 3]);
  });

  it("excludeToolCallId is empty string / non-string → never skips", () => {
    const msgs: MessageLike[] = [asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, "")).toEqual([2, 3]);
    expect(resolveLastToolCallGroup(units, msgs, 123 as unknown as string)).toEqual([2, 3]);
  });

  it("skips EVERY toolGroup whose assistant issued the exclude id, landing on an earlier one", () => {
    // three toolGroups: X(0,1), Y(2,3), Z(4,5); exclude 'Z' → returns Y([2,3])
    const msgs: MessageLike[] = [asst("X"), result("X"), asst("Y"), result("Y"), asst("Z"), result("Z")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:2:2 | toolGroup:4:2");
    expect(resolveLastToolCallGroup(units, msgs, "Z")).toEqual([2, 3]);
  });
});

describe("resolveLastToolCallGroup — parallel-tool mode (spec/06 §9 / spec/08 E6)", () => {
  it("rewind shares an assistant message with a sibling call → that toolGroup is skipped, previous returned", () => {
    // one assistant carries call 'X' AND the rewind call 'REW' (parallel execution) + both results
    const msgs: MessageLike[] = [
      asst("prev"),
      result("prev"),
      asst("X", "REW"), // shared assistant message
      result("X"),
      result("REW"),
    ];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:2:3"); // shared message is ONE toolGroup of 3 indices
    // exclude the rewind's own call 'REW' → the shared toolGroup [2,3,4] is skipped → previous [0,1] returned
    expect(resolveLastToolCallGroup(units, msgs, "REW")).toEqual([0, 1]);
  });

  it("only the shared toolGroup exists → exclude it → null", () => {
    const msgs: MessageLike[] = [asst("A", "REW"), result("A"), result("REW")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:3");
    expect(resolveLastToolCallGroup(units, msgs, "REW")).toBeNull();
  });
});

describe("resolveLastToolCallGroup — defensive (NEVER throws — spec/08 E13)", () => {
  it("non-array units → null (no throw)", () => {
    expect(resolveLastToolCallGroup(null as unknown as Unit[], [])).toBeNull();
    expect(resolveLastToolCallGroup(undefined as unknown as Unit[], [])).toBeNull();
    expect(resolveLastToolCallGroup("nope" as unknown as Unit[], [])).toBeNull();
  });

  it("a toolGroup whose assistant is a throwing-Proxy → no match → returned (fail-safe, no throw)", () => {
    // the rewind's own call id 'self' is NOT readable (every read throws) → cannot match → unit is returned
    const trap: MessageLike = new Proxy(
      { role: "assistant", content: [{ type: "toolCall", id: "self", name: "mulligan_rewind", arguments: {} }] } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [asst("real"), result("real"), trap, result("self")];
    const units = partitionIntoUnits(msgs); // trap reads throw → treated as non-assistant → may land as plain/toolGroup
    expect(() => resolveLastToolCallGroup(units, msgs, "self")).not.toThrow();
    // 'self' can never be confirmed issued → the toolGroup 'real' (or the last confirmable toolGroup) is returned
    expect(resolveLastToolCallGroup(units, msgs, "self")).not.toBeNull();
  });

  it("malformed messages array (non-array) → exclude never matches → returns last toolGroup", () => {
    const msgs = "garbage" as unknown as MessageLike[];
    const units: Unit[] = [
      { indices: [0, 1], kind: "toolGroup" },
      { indices: [2, 3], kind: "toolGroup" },
    ];
    expect(resolveLastToolCallGroup(units, msgs, "whatever")).toEqual([2, 3]);
  });

  it("a malformed unit record in the list is skipped, not crashing", () => {
    const msgs: MessageLike[] = [asst("A"), result("A")];
    const units = [
      null,
      { kind: "toolGroup" }, // no indices
      { indices: [0, 1], kind: "toolGroup" },
    ] as unknown as Unit[];
    expect(() => resolveLastToolCallGroup(units, msgs)).not.toThrow();
    expect(resolveLastToolCallGroup(units, msgs)).toEqual([0, 1]);
  });
});

describe("resolveLastToolCallGroup — ordering, purity, types", () => {
  it("plain units interspersed between toolGroups are skipped", () => {
    const msgs: MessageLike[] = [asst("A"), result("A"), asstText("chat"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | plain:2:1 | toolGroup:3:2");
    expect(resolveLastToolCallGroup(units, msgs)).toEqual([3, 4]);
  });

  it("is pure / idempotent — same input → same output, no mutation", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    const a = resolveLastToolCallGroup(units, msgs, "B");
    const b = resolveLastToolCallGroup(units, msgs, "B");
    expect(a).toEqual(b);
    expect(JSON.stringify(units)).toBe(JSON.stringify(partitionIntoUnits(msgs))); // units unchanged
  });

  it("returns the unit's indices reference (the exact indices array)", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A")];
    const units = partitionIntoUnits(msgs);
    const toolGroup = units.find((u) => u.kind === "toolGroup")!;
    expect(resolveLastToolCallGroup(units, msgs)).toBe(toolGroup.indices); // same array reference (read-only)
  });

  it("returns number[] | null", () => {
    expectTypeOf(resolveLastToolCallGroup([], [])).toEqualTypeOf<number[] | null>();
    expectTypeOf(resolveLastToolCallGroup([], [], "x")).toEqualTypeOf<number[] | null>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: walk units end→backward; the FIRST non-skipped toolGroup wins (spec/06 §3).
for (let k = units.length - 1; k >= 0; k--) {
  const unit = units[k];
  if (!isRecord(unit) || unit.kind !== "toolGroup" || !Array.isArray(unit.indices)) continue; // skip plain + malformed
  if (hasExclude && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) continue; // skip rewind's own
  return unit.indices; // first non-skipped toolGroup from the end
}
return null;

// PATTERN: the exclude test reuses isRecord/readOwn (Proxy-safe) — NEVER throws (E13). It scans the assistant's
// toolCall blocks; the simple `block.id === excludeToolCallId` is the WHOLE skip decision. This single rule covers
// both the rewind's-own-call case (E2) AND the parallel-shared-message case (E6/§9) — no special branching.

// CRITICAL: return `number[] | null` (the unit's indices), NOT `Unit | null`. filterPipeline (T5.S1) adapts to `?? []`.
```

### Integration Points

```yaml
MODULE OWNERSHIP (spec/11 §1/§2):
  - src/transforms.ts   # THIS task APPENDS resolveLastToolCallGroup (+ assistantIssuedCall) to the file T1.S1 created.

CONSUMERS (no wiring in THIS task — resolveLastToolCallGroup is a pure function consumed later):
  - P1.M3.T5.S1 filterPipeline: the single caller. NOTE — adapt spec/06 §12 pseudocode to the authoritative return type:
      `const remove = resolveLastToolCallGroup(units, m, rw.excludeToolCallId) ?? [];`
    (spec/06 §12's `const u = …; remove = u ? u.indices : [];` treats the return as a Unit — reference-only; this
    function returns number[] | null per spec/06 §3 + the work-item contract.)
  - P1.M3.T4.S1 applyRewind: receives the resolved `number[]` and removes those indices gap-closed (unit-aware).

INPUT SOURCES (already specified upstream — no action here):
  - units:  produced by partitionIntoUnits (T1.S1), called once per filter fire (spec/06 §12).
  - messages: event.messages from the context handler (filter.ts, P1.M4.T2.S1).
  - excludeToolCallId: the rewind marker's field, captured from the mulligan_rewind tool's execute(toolCallId, …)
    first argument (spec/05 §1 + api_verification.md "NOTE on execute signature").

CONFIG / DATABASE / ROUTES: none — pure function, zero side effects, zero persistence.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending resolveLastToolCallGroup (and again after the test block). The type+style gate IS tsc.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output and fix before proceeding.
# Confirm NO new imports crept in (foundation-tier pure):
grep -c '^import' src/transforms.ts   # → expect 0 (unchanged from T1.S1)
# (There is NO eslint/prettier/biome — GOTCHA #10. Do NOT run a lint/format command.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the whole transforms module (partitionIntoUnits + resolveLastToolCallGroup) in isolation.
npx vitest run test/transforms.test.ts -v
# Expected: all transforms tests green (T1.S1's suite + the appended resolveLastToolCallGroup block).

# Full suite (confirm no regression — this task is append-only to two files).
npx vitest run
# Expected: all test files green. A regression in another suite means you accidentally modified another file — revert it.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask. resolveLastToolCallGroup is a pure function with ZERO Pi dependency (no server, no DB, no session).
# Integration validation of the last_tool_call_group rewind happens via filterPipeline (P1.M3.T5) + the F-rewind-core
# scenario (P1.M7.T2 / spec/10 §2.1). Do NOT spin up `pi -e` here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The domain-specific check for THIS resolver is the EXCLUDE correctness + pairing safety, expressed as unit tests
# (already in the appended describe blocks). The parallel-tool case (spec/06 §9 / spec/08 E6) is the highest-value
# assertion: confirm a shared assistant message carrying mulligan_rewind + a sibling call is skipped, and the
# previous toolGroup is returned (pairing stays intact downstream). No additional tooling required.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `grep -c '^import' src/transforms.ts` → 0 (no new imports — GOTCHA #3).
- [ ] Level 2 passed: `npx vitest run` → all files green (incl. the appended resolveLastToolCallGroup block).
- [ ] No lint/format command invented (none configured — GOTCHA #10).

### Feature Validation

- [ ] All success criteria from "What" section met.
- [ ] **spec/10 §1.2** all three pinned cases pass (no-exclude→[3,4]; exclude='B'→[1,2]; no toolGroup→null).
- [ ] exclude-matches-no-unit → last toolGroup; only-one-toolGroup-and-exclude-matches → null.
- [ ] **parallel-tool (spec/06 §9 / spec/08 E6):** shared assistant message skipped → previous toolGroup returned.
- [ ] **Never throws:** non-array units → null; throwing-Proxy assistant → no match → returned; malformed messages.
- [ ] excludeToolCallId undefined/empty/non-string → never skips.
- [ ] Return type is `number[] | null` (the unit's indices reference), NOT a Unit object.

### Code Quality Validation

- [ ] APPEND-only (did not recreate transforms.ts / transforms.test.ts; reused Unit/MessageLike/isRecord/readOwn + fixtures).
- [ ] Follows existing module patterns (isRecord/readOwn defensive reads; JSDoc references spec sections; never throws).
- [ ] Anti-patterns avoided (no Unit-object return to "match §12"; no Pi import; no special parallel-tool branching).
- [ ] No regression in any other suite (`npx vitest run` all-green).

### Documentation & Deployment

- [ ] Code is self-documenting (clear names; JSDoc on the export referencing spec/06 §3, spec/08 E2/E6/E8, api_verification §6.4).
- [ ] No new env vars / config (pure function, no config surface).

---

## Anti-Patterns to Avoid

- ❌ Don't CREATE `transforms.ts` / `transforms.test.ts` — they exist (T1.S1). APPEND only (GOTCHA #1).
- ❌ Don't redefine `Unit` / `MessageLike` / `isRecord` / `readOwn` / the test fixtures — reuse them (GOTCHA #1).
- ❌ Don't add ANY import — the file stays foundation-tier pure (import count 0) (GOTCHA #3).
- ❌ Don't return a `Unit` object — return `number[] | null` (the unit's indices). T5.S1's filterPipeline adapts to `?? []` (GOTCHA #2).
- ❌ Don't add special parallel-tool branching — the single "skip if assistant issued excludeToolCallId" rule covers it (GOTCHA #5).
- ❌ Don't read message fields with raw `.`/`[]` access — go through `isRecord` + `readOwn` (Proxy-safe, never throws) (GOTCHA #4).
- ❌ Don't implement `applyRewind` / `resolveLastTurn` / `resolveCheckpoint` / `applyShrink` / `filterPipeline` here (later P1.M3 subtasks APPEND).
- ❌ Don't skip validation because "it should work" — run tsc + vitest after appending each artifact.
- ❌ Don't invent a lint/format command (none configured — GOTCHA #10).
- ❌ Don't widen the signature beyond `resolveLastToolCallGroup(units: Unit[], messages: MessageLike[], excludeToolCallId?: string): number[] | null`.

---

## Confidence Score: 9/10

One-pass success is highly likely: the algorithm is spec-pinned (spec/06 §3 steps 1–5), the exact tests are
spec-pinned (spec/10 §1.2), the parallel-tool behavior is spec-pinned (spec/06 §9 / spec/08 E6), the `isRecord`/
`readOwn` defensive pattern is inherited verbatim from T1.S1's `transforms.ts`, and the implementation + tests are
given VERBATIM above. The only residual risk is the **T1.S1 dependency**: this task APPENDS to `src/transforms.ts` +
`test/transforms.test.ts`, which T1.S1 creates in parallel. Task 0's prerequisite gate (`test -f src/transforms.ts &&
test -f test/transforms.test.ts`) catches the not-yet-landed case explicitly. The -1 accounts for that dependency +
the inherent chance of a subtle fixture-name drift if T1.S1 renames a fixture (mitigated: the PRP lists the exact
fixture names from T1.S1's verbatim test code).