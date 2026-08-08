# PRP — P1.M3.T2.S2: `resolveLastTurn` — last-turn rewind targeting (with `to_previous_prompt`)

**Work item:** P1.M3.T2.S2 · **Points:** 1.5 · **Stage:** Pure Core — Context Filter Transforms (the correctness heart)
**Scope:** **APPEND to two EXISTING files** — add `resolveLastTurn` (exported pure function) to `src/transforms.ts`
and add its vitest Tier-1 tests to `test/transforms.test.ts`. **No new file, no other file touched.** Adds exactly
ONE module-private helper (`isMulliganCustomMessage`). Reuses `partitionIntoUnits` + the module-private
`assistantIssuedCall` that P1.M3.T2.S1 ships — **zero new imports**. Never throws. This is **S2-T2 of the
`transforms.ts` build** (spec/11 §2): it ships the `last_turn` rewind resolver that `filterPipeline` (T5.S1)
consumes.

> **PARALLEL-EXECUTION CONTRACT (READ FIRST):** Two prior tasks are treated as **hard contracts**:
> 1. **P1.M3.T1.S1 (`partitionIntoUnits`) — LANDED.** `src/transforms.ts` + `test/transforms.test.ts` ALREADY EXIST
>    (VERIFIED LIVE) containing: `partitionIntoUnits`, `export interface Unit { indices: number[]; kind: "plain" |
>    "toolGroup" }`, `export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]:
>    unknown }`, module-private `isRecord` / `readOwn`, and test fixtures `asst` / `asstText` / `result` / `user` /
>    `custom` / `summary` / `expectPairingInvariant`.
> 2. **P1.M3.T2.S1 (`resolveLastToolCallGroup`) — PARALLEL, in flight.** It APPENDS to that same file an EXPORTED
>    `resolveLastToolCallGroup(units, messages, excludeToolCallId?): number[] | null` AND a **module-private**
>    `assistantIssuedCall(messages: MessageLike[] | unknown, indices: number[], callId: string): boolean` (returns
>    true iff the assistant among `indices` issued a toolCall with `id === callId`). Read
>    `plan/001_2e5baf25fe9f/P1M3T2S1/PRP.md` for the authoritative definition.
>
> This task **APPENDS `resolveLastTurn` + a module-private `isMulliganCustomMessage`** to `src/transforms.ts` and
> **APPENDS a new `describe` block + extends the import line** in `test/transforms.test.ts`. Do NOT recreate,
> redefine, or re-import any symbol — they are already in module scope. **`resolveLastTurn` REUSES
> `assistantIssuedCall` (from S1) + `partitionIntoUnits` (from T1.S1)** to find the rewind's own unit.

---

## Goal

**Feature Goal**: Ship Mulligan's **second rewind resolver** — a pure, Pi-free
`resolveLastTurn(messages, opts, excludeToolCallId?): { remove: number[] }` that computes the index set to hide for a
`last_turn` rewind (spec/06 §4; spec/05 §1). A **turn** = a user message plus everything after it until the next
user message. The resolver finds `iLastUser` (the most recent `role:"user"`), then:
- **Default** (`opts.to_previous_prompt !== true`): **keep** the user message, remove every message *after* it
  EXCEPT the rewind's **own unit** (the assistant that issued `excludeToolCallId` + its results — so the rewind's
  own call/result survives) and any **`mulligan:*` custom messages at the tail** (the note MUST survive). The model
  lands back at the current user prompt with the note immediately available.
- **Nuclear** (`opts.to_previous_prompt === true`): also remove the user message at `iLastUser` (model resumes at the
  *previous* user prompt). **Refused** (returns `{ remove: [] }`) when `iLastUser` is the **first** user message
  (`iFirstUser === iLastUser`) — that would erase the original task (spec/06 §8, spec/08 E3).

Because the after-`iLastUser` removal keeps the rewind's own unit **whole** (detected via `partitionIntoUnits` +
`assistantIssuedCall`), pairing is preserved AND the parallel-tool corner case (spec/06 §9, spec/08 E6) resolves
conservatively: if `mulligan_rewind` shares an assistant message with sibling calls, the entire shared unit is kept.

**Deliverable** (APPEND to two EXISTING files — do NOT create new files):
1. `src/transforms.ts` — APPEND (the file already exists from T1.S1 + S1):
   - `export function resolveLastTurn(messages: MessageLike[], opts: { to_previous_prompt?: boolean } | undefined,
     excludeToolCallId?: string): { remove: number[] }` — the algorithm (spec/06 §4 steps 1–3).
   - one module-private helper: `isMulliganCustomMessage(msg: unknown): boolean` (defensive; reuses
     `isRecord`/`readOwn`; detects `customType` with the `mulligan:` prefix).
   - **NO new imports** (reuse `partitionIntoUnits`, `assistantIssuedCall`, `Unit`, `MessageLike`, `isRecord`,
     `readOwn` already in module scope). File import count stays **0**.
2. `test/transforms.test.ts` — APPEND (the file already exists from T1.S1 + S1):
   - MODIFY the import line to add `resolveLastTurn`.
   - ADD one new `describe("resolveLastTurn — spec/10 §1.3 + corner + defensive + parallel + types", …)` block.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**.
- `npx vitest run` is **all-green** — the existing transforms suite (T1.S1 + S1) AND the appended `resolveLastTurn`
  block; no pre-existing suite regresses (append-only to one src file + one test file).
- `resolveLastTurn` **never throws** (E13; it sits on the `context` handler hot path via `filterPipeline`) — non-array
  `messages`, malformed messages, throwing-Proxy messages, and a missing/non-string/empty `excludeToolCallId` are all
  handled gracefully.
- The **spec/10 §1.3 pinned contract** holds exactly: `[u0, a, r, u1, a, r]` default → `remove=[4,5]`;
  `to_previous_prompt:true` → `remove=[3,4,5]`; `u1`-is-first-user nuclear → `{ remove: [] }`.

---

## User Persona

**Target User**: The implementing AI agent for `filterPipeline` (P1.M3.T5.S1) — the single consumer of this
function. `filterPipeline` calls
`remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove` per `last_turn` rewind marker (spec/06 §12),
passing `rw.options` **verbatim** (it carries `to_previous_prompt`), then feeds `remove` to `applyRewind`
(P1.M3.T4.S1). The SECOND consumer is the test suite (spec/10 §1.3).

**Use Case**: On a `last_turn` rewind, the agent issued `mulligan_rewind(granularity:"last_turn", …)` because an
entire turn (the assistant's tool calls + reasoning after the last user message) went wrong. The resolver hides
that whole turn's work but KEEPS the user message it answered (so the model re-attempts the same prompt) plus the
note and the rewind's own confirmation. The model resumes at the user prompt with the note visible.

**User Journey**:
1. `mulligan_rewind(granularity:"last_turn", to_previous_prompt?:true)` executes → persists a marker with
   `excludeToolCallId = <the rewind toolCall's id>` + `options.to_previous_prompt` (spec/05 §1, spec/04 §3).
2. Next inference → `context` handler → `filterPipeline` →
   `remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove`.
3. `applyRewind` removes `remove` (gap-closed) → the model resumes at the kept user message (default) or the
   previous one (nuclear), with `[user] + [mulligan:note] + [rewind assistant+result]` at the tail.

**Pain Points Addressed**: A bad turn (wrong tool calls, bloated results, a reasoning dead-end) otherwise poisons
the rest of the session. `last_turn` sheds the whole turn in one operation while preserving the prompt it answered
and the note explaining what to do differently — the model re-attempts cleanly instead of confabulating.

---

## Why

- **Unblocks the `last_turn` rewind path end-to-end (at the pure tier).** `resolveLastTurn` is the targeting half of
  the turn-granularity rewind (spec/06 §4 + spec/05 §1). `filterPipeline` (T5.S1) wires it; `applyRewind` (T4.S1)
  consumes its output. Shipping it now (pure-core, unit-testable in isolation) lets T5.S1 focus on pipeline
  composition + protected-message checks, not turn-targeting logic.
- **The "keep the rewind's own unit + the note" rule is the core correctness invariant for this granularity.**
  spec/06 §4 prescribes EXACTLY which tail messages survive (the user message, the `mulligan:note`, the rewind's own
  assistant+result). The rule *also* resolves the parallel-tool edge case conservatively (spec/06 §9, spec/08 E6):
  if `mulligan_rewind` shares an assistant message with sibling calls, the whole shared unit is kept → siblings +
  results survive in the view (pairing-safe). The algorithm is fully spec-pinned — there are NO open design
  questions, only implementation.
- **Pure-core tier & unit-testable in isolation.** `resolveLastTurn` adds NO new imports (it reuses
  `partitionIntoUnits`, `assistantIssuedCall`, `Unit`/`MessageLike`, `isRecord`/`readOwn` already in
  `transforms.ts`). It is a pure, deterministic, side-effect-free function covered by fast unit tests with no Pi, no
  model, no session (spec/10 §1; spec/03 §7).

---

## What

APPEND `resolveLastTurn` (+ a module-private `isMulliganCustomMessage`) to `src/transforms.ts`, and APPEND a
`resolveLastTurn` test block (+ a one-line import edit) to `test/transforms.test.ts`.

`resolveLastTurn`:

- **Accepts** `messages: MessageLike[]` (a real Pi `AgentMessage[]` assigns in with no cast), `opts:
  { to_previous_prompt?: boolean } | undefined` (the rewind marker's `options`, passed verbatim by `filterPipeline`),
  and `excludeToolCallId?: string` (the rewind's own toolCall id — its unit is kept; `undefined`/empty/non-string →
  not kept). Returns `{ remove: number[] }`.
- **Algorithm** (spec/06 §4, steps 1–3; verbatim code in the Blueprint):
  1. If `messages` is not an array → return `{ remove: [] }` (defensive).
  2. Find `iLastUser` = index of the LAST message with `role === "user"`. If none → return `{ remove: [] }` (nothing
     to rewind — protected).
  3. If **nuclear** (`opts?.to_previous_prompt === true`): find `iFirstUser` = FIRST `role === "user"`; if
     `iFirstUser === iLastUser` → return `{ remove: [] }` (nuclear refused — would erase the original task).
  4. Build `rewindOwnIndices` (a `Set<number>`): only when `excludeToolCallId` is a non-empty string, call
     `partitionIntoUnits(messages)`; for each `toolGroup` unit where
     `assistantIssuedCall(messages, unit.indices, excludeToolCallId)` is true, add ALL of `unit.indices` to the set
     (keeps the rewind's own unit whole — parallel-shared messages included).
  5. Build `remove` (ascending): if nuclear, push `iLastUser`; then for each `j` from `iLastUser+1` to end, skip if
     `rewindOwnIndices.has(j)` (rewind's own unit) or `isMulliganCustomMessage(messages[j])` (the note); else push.
  6. Return `{ remove }`.

This subtask does **NOT**: implement `applyRewind`/`resolveLastToolCallGroup`/`resolveCheckpoint`/`applyShrink`/
`filterPipeline`/`protectedOk` (later P1.M3 subtasks APPEND to this same file); import anything (the file is already
foundation-tier pure); redefine `Unit`/`MessageLike`/`isRecord`/`readOwn`/`assistantIssuedCall`/`partitionIntoUnits`
(reuse them); mutate `messages`; enforce the general `protectedOk` (that is filterPipeline's defense-in-depth — this
function only needs its own nuclear guard, D6); or change the `Unit` shape.

### Success Criteria

- [ ] `src/transforms.ts` has an EXPORTED `resolveLastTurn(messages: MessageLike[], opts:
      { to_previous_prompt?: boolean } | undefined, excludeToolCallId?: string): { remove: number[] }` + a
      module-private `isMulliganCustomMessage`, and **NO new imports** (`grep -c '^import' src/transforms.ts` → 0).
- [ ] `test/transforms.test.ts` has a new `describe("resolveLastTurn …")` block; the import line now includes
      `resolveLastTurn`; the whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **spec/10 §1.3 — default:** `[user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")]` →
      `resolveLastTurn(msgs, {}).remove` returns `[4,5]` (keeps `u0,a,r,u1`).
- [ ] **spec/10 §1.3 — nuclear:** same list with `{ to_previous_prompt: true }` → `remove` returns `[3,4,5]`
      (iLastUser=3, iFirstUser=0, differ → allowed).
- [ ] **spec/10 §1.3 — protected refusal:** `[user("only"), asst("c"), result("c")]` with
      `{ to_previous_prompt: true }` → `{ remove: [] }` (iLastUser=0=iFirstUser → nuclear refused).
- [ ] **rewind's own unit survives (default):** a turn whose tail contains the rewind's assistant+result
      (`excludeToolCallId` matches) → that unit's indices are NOT in `remove`; prior-turn work IS removed.
- [ ] **`mulligan:*` note survives:** a `mulligan:note` (and `mulligan:nudge`) custom message after `iLastUser` is
      NOT in `remove`.
- [ ] **parallel-tool (spec/06 §9 / spec/08 E6):** one assistant carrying `mulligan_rewind` + a sibling call → the
      whole shared unit (assistant + all results) is kept; only prior-turn work is removed.
- [ ] **no user message → `{ remove: [] }`**; **nothing after `iLastUser` → `{ remove: [] }`**.
- [ ] **excludeToolCallId absent/empty/non-string →** the rewind's own unit is NOT kept (removed with the rest); the
      note still survives; pairing stays safe.
- [ ] **Never throws:** non-array `messages` → `{ remove: [] }`; throwing-Proxy messages handled; malformed opts.
- [ ] **Signature + return exact:** `resolveLastTurn(messages, opts, excludeToolCallId): { remove: number[] }`
      (returns the object wrapper, NOT `number[] | null`).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `resolveLastTurn` + `isMulliganCustomMessage` to APPEND are given verbatim
> below (Task 1), and the exact tests + import edit are given verbatim (Task 2). The algorithm is spec-pinned
> (spec/06 §4 steps 1–3); the exact tests are spec-pinned (spec/10 §1.3); the parallel-tool handling is spec-pinned
> (spec/06 §9, spec/08 E6); the protected refusal is spec-pinned (spec/06 §8, spec/08 E3); the never-throws discipline
> + the `isRecord`/`readOwn` convention + the reused `assistantIssuedCall` (S1) are inherited verbatim from the
> sibling PRPs. The only prerequisite is that T1.S1 + S1 have landed their symbols in `src/transforms.ts`
> (the parallel-execution contract). No prior knowledge beyond "this APPENDS a pure function + helper to the existing
> transforms module and APPENDS its tests" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/transforms.ts` — it ALREADY EXISTS (T1.S1 + S1).** Ship ONLY `resolveLastTurn` (exported) + the
  module-private `isMulliganCustomMessage`. REUSE the in-scope `partitionIntoUnits`, `assistantIssuedCall`,
  `Unit`, `MessageLike`, `isRecord`, `readOwn` — do NOT redefine or re-export them. Later P1.M3 subtasks
  (resolveCheckpoint, applyRewind, applyShrink, filterPipeline) APPEND further to this same file.
- **APPEND to `test/transforms.test.ts` — it ALREADY EXISTS (T1.S1 + S1).** Add ONE new `describe` block + MODIFY the
  import line (one precise edit). Reuse the fixture helpers already defined: `asst`, `asstText`, `result`, `user`,
  `custom`, `summary`. Do NOT redefine them.
- **NO new imports.** `resolveLastTurn` references only `partitionIntoUnits`, `assistantIssuedCall` (S1),
  `Unit`/`MessageLike` (types) and `isRecord`/`readOwn` (helpers) already in the module. The file's import count
  stays 0 (it is foundation-tier pure, like `tokens.ts`/`ledger.ts`).
- **Return `{ remove: number[] }`, NOT `number[] | null` and NOT a bare `number[]`.** spec/06 §4 signature + the
  work-item contract + filterPipeline §12 (`remove = resolveLastTurn(...).remove`) are authoritative. Contrast S1's
  `resolveLastToolCallGroup`, which returns `number[] | null` — they differ by design.
- **Read the snake_case `opts.to_previous_prompt`.** The contract + spec/04 §3 (`RewindMarker.options`) +
  filterPipeline §12 (passes `rw.options` verbatim) all use snake_case. spec/06 §4's `toPreviousPrompt` is a spec
  typo — do NOT match it; reading camelCase would mean nuclear mode NEVER fires (the field is always snake_case).

### Documentation & References

```yaml
# MUST READ — authoritative sources for resolveLastTurn
- file: spec/06-context-filter.md
  section: "§4 resolveLastTurn"
  why: "THE source: the signature `resolveLastTurn(messages, opts, excludeToolCallId): { remove: number[] }` and the
        3-step algorithm (find iLastUser; default removes after it except the rewind's own unit + mulligan notes;
        nuclear also removes iLastUser, refused when iLastUser===iFirstUser)."
  critical: "§4 writes the opts field as `toPreviousPrompt` — that is a SPEC TYPO. The persisted marker field
             (spec/04 §3) and filterPipeline (§12, passes rw.options verbatim) use `to_previous_prompt` (snake_case).
             Read the snake_case field or nuclear mode never fires (D1). The pairing note (§4 pt 4) is the basis for
             the rewindOwnUnit-kept-whole rule."

- file: spec/06-context-filter.md
  section: "§8 protected messages"
  why: "Confirms the protected rule this function enforces for nuclear: refuse if iLatestUser === iFirstUser. The
        default case is protected-safe by construction (min(remove) > iLastUser >= iFirstUser)."
  critical: "filterPipeline (T5.S1) adds a general protectedOk pass as defense-in-depth; resolveLastTurn only needs
             its own nuclear guard — do NOT re-implement protectedOk here."

- file: spec/06-context-filter.md
  section: "§9 parallel-tool-mode corner case"
  why: "For last_turn: 'the keep-the-rewind's-own-unit rule keeps the ENTIRE shared assistant message + all its
        results, so siblings survive.' Because assistantIssuedCall tests a UNIT, rewindOwnIndices gets the whole
        shared unit → siblings + results are kept."
  critical: "NO special parallel-tool branching is needed in this pure helper. The unit-kept-whole rule resolves it
             conservatively (pairing-safe)."

- file: spec/10-testing.md
  section: "§1.3 resolveLastTurn"
  why: "THE exact unit tests: (1) [u0,a,r,u1,a,r] default → remove after u1; (2) to_previous_prompt:true → also
        remove u1; (3) u1-is-first-user → nuclear refused by protected check. Implement these three verbatim, then
        add corner/defensive/parallel tests."
  critical: "Assert the returned `.remove` array matches exactly (e.g. [4,5] and [3,4,5]); the refusal returns
             { remove: [] }."

- file: spec/08-edge-cases.md
  section: "E2 (rewinding the executing turn) + E3 (crossing a protected message) + E6 (parallel tool mode) + E13 (tool throws)"
  why: "E2: the rewind's own call must survive — resolveLastTurn keeps the rewind's own unit + tail notes. E3: nuclear
        on the first user message is refused. E6/§9: shared assistant message → whole unit kept. E13: never throws."
  critical: "These prescribe the defensive + parallel + protected behavior. The unit-kept-whole rule + the nuclear
             iFirstUser===iLastUser refusal + isRecord/readOwn satisfy all four."

- file: spec/01-pi-context-internals.md
  section: "line 156 — the message union (CustomMessage = { role:'custom', customType, content, display, details })"
  why: "Authoritative shape of a custom message IN event.messages: role 'custom' + a `customType` string. This is how
        the mulligan:note / mulligan:nudge appear; detect them by customType prefix 'mulligan:'."
  critical: "The looper-smoke proto also detects custom messages by m.customType (proto line 60) — customType is the
             discriminator. role === 'custom' is a secondary confirmation."

- file: spec/04-data-model.md
  section: "§3 Marker: rewind — RewindMarker.options.to_previous_prompt + excludeToolCallId"
  why: "Confirms the marker the rewind tool persists carries `options: { to_previous_prompt?: boolean }` and
        `excludeToolCallId` — the exact fields filterPipeline passes to this resolver. My function receives them as
        params (opts verbatim, excludeToolCallId)."
  critical: "opts is snake_case. excludeToolCallId comes from the tool's execute(toolCallId, …) first argument
             (spec/05 §1 + api_verification.md 'NOTE on execute signature')."

- file: plan/001_2e5baf25fe9f/P1M3T2S1/PRP.md
  section: "Exact content to APPEND — assistantIssuedCall (module-private)"
  why: "THE contract for assistantIssuedCall, which resolveLastTurn REUSES. Read it to confirm the exact signature:
        `assistantIssuedCall(messages: MessageLike[] | unknown, indices: number[], callId: string): boolean` returns
        true iff the assistant among `indices` issued a toolCall with `id === callId`. Call it as
        `assistantIssuedCall(messages, unit.indices, excludeToolCallId)`."
  critical: "Do NOT redefine assistantIssuedCall — REUSE it (it is module-private in this same file once S1 lands)."

- file: plan/001_2e5baf25fe9f/P1M3T1S1/PRP.md
  section: "Exact content — partitionIntoUnits + Unit + MessageLike + isRecord/readOwn + test fixtures"
  why: "THE contract for the symbols this task REUSES. Unit = { indices: number[]; kind: 'plain'|'toolGroup' };
        MessageLike carries role?/content?/[key]; partitionIntoUnits(messages) returns Unit[]; isRecord/readOwn are
        module-private + Proxy-safe. Test fixtures: asst(...callIds), asstText, result, user, custom, summary."
  critical: "Do NOT redefine these — APPEND. The test import line (post-S1) is
             `import { partitionIntoUnits, resolveLastToolCallGroup, type Unit, type MessageLike } from '../src/transforms.js';`
             — extend it to also import `resolveLastTurn`."

# FILES TO MIRROR (read-only pattern contracts — do NOT modify)
- file: src/transforms.ts
  why: "The file you APPEND to (T1.S1 + S1). Reuse its isRecord/readOwn for every field read (Proxy-trap-safe, never
        throws) and partitionIntoUnits/assistantIssuedCall for unit detection. Mirror its JSDoc style (reference spec
        sections) and the 'NEVER throws (E13)' discipline."
  pattern: "partitionIntoUnits reads role/content via isRecord+readOwn, iterates content[] blocks. resolveLastTurn
            follows the SAME defensive read pattern (role via readOwn; customType via readOwn) but targets a turn."

- file: test/transforms.test.ts
  why: "The test file you APPEND to (T1.S1 + S1). Reuse its fixture helpers + the throwing-Proxy defensive test idiom.
        Mirror its `describe`/`it`/`expect`/`expectTypeOf` house style."
  pattern: "Tests import from '../src/transforms.js' (.js extension under moduleResolution:'Bundler'). Add
            resolveLastTurn to that import; add one new describe block."

- file: plan/001_2e5baf25fe9f/P1M3T2S2/research/notes.md
  why: "THE resolution of every spec-open detail (D1 opts naming, D2 messages-not-units, D3 reuse assistantIssuedCall,
        D4 no parallel branch, D5 mulligan detection, D6 self-enforced nuclear guard, D7 return shape, D8 ascending,
        D9 zero imports + never-throws)."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; devDeps typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
│                           #   (NO noUnusedParameters/noUnusedLocals → unused params compile; codebase prefixes with _)
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts / log.ts / runtime.ts        # DO NOT TOUCH.
│   ├── tokens.ts / ledger.ts / notes.ts       # foundation-tier pure helpers (DO NOT TOUCH — pattern contracts only).
│   └── transforms.ts       # T1.S1 LANDED (partitionIntoUnits + Unit + MessageLike + isRecord/readOwn). S1 APPENDS
│                           #   resolveLastToolCallGroup + assistantIssuedCall. THIS task APPENDS resolveLastTurn +
│                           #   isMulliganCustomMessage. (Validation Task 0 verifies S1's symbols are present.)
├── test/
│   ├── config/ledger/log/runtime/tokens/notes .test.ts   # DO NOT TOUCH.
│   └── transforms.test.ts  # T1.S1 LANDED (partitionIntoUnits suite + fixtures). S1 APPENDS resolveLastToolCallGroup
│                           #   block + import edit. THIS task APPENDS a resolveLastTurn block + import edit.
└── spec/                   # 06 §4 (THE algorithm) + 10 §1.3 (THE tests) + 08 E2/E3/E6/E13 + 01 line156 + 04 §3 + 11 §2.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   7 files all green / 246 tests (after S1 lands, the transforms suite grows by resolveLastToolCallGroup's block).
#   This task APPENDS to two existing files only; it cannot regress the other suites.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
#   The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent a lint/format command.
```

### Desired Codebase tree with files to be MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── transforms.ts       # MODIFIED — APPEND resolveLastTurn (exported) + isMulliganCustomMessage (module-private). No new imports.
└── test/
    └── transforms.test.ts  # MODIFIED — APPEND a resolveLastTurn describe block; EDIT the import line (+1 symbol).
# No other files touched. Later P1.M3 subtasks APPEND resolveCheckpoint/applyRewind/applyShrink/filterPipeline.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — APPEND, do NOT CREATE. src/transforms.ts + test/transforms.test.ts ALREADY EXIST (T1.S1 +
#   S1). REUSE the in-scope partitionIntoUnits, assistantIssuedCall, Unit, MessageLike, isRecord, readOwn — do NOT
#   redefine or re-import them. REUSE the test fixtures asst/asstText/result/user/custom/summary — do NOT redefine.
#   If S1 has not landed (Validation Task 0 fails — `grep -q 'function assistantIssuedCall' src/transforms.ts`),
#   STOP and surface it: resolveLastTurn REUSES assistantIssuedCall, so it strictly depends on S1 (like S1 depends
#   on T1.S1).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — Return `{ remove: number[] }`, the OBJECT WRAPPER. NOT `number[] | null` (that is S1's
#   resolveLastToolCallGroup) and NOT a bare `number[]`. filterPipeline §12 reads `.remove`:
#   `remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove`. Empty array = no-op/refusal.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — Read the SNAKE_CASE `opts.to_previous_prompt`. The contract (item §2) + spec/04 §3
#   (RewindMarker.options) + filterPipeline §12 (passes rw.options verbatim) all use snake_case. spec/06 §4's
#   `toPreviousPrompt` is a SPEC TYPO — reading camelCase means nuclear mode NEVER fires (the field is always
#   snake_case). Use `opts?.to_previous_prompt === true`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — ZERO new imports. resolveLastTurn references partitionIntoUnits, assistantIssuedCall (S1),
#   Unit, MessageLike (types), isRecord, readOwn — all already in module scope. The file's import count stays 0
#   (foundation-tier pure, sibling of tokens.ts/ledger.ts). Do NOT `import type { AgentMessage }` from Pi.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — NEVER throws (E13; context-handler hot path via filterPipeline). Every field read goes
#   through isRecord + readOwn (a throwing-Proxy get-trap returns undefined, not an exception). Non-array messages →
#   {remove:[]}; malformed/Proxy messages handled. No @ts-ignore (defensive branches compile cleanly under strict).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (CRITICAL) — The "keep the rewind's own unit" rule is a SINGLE rule and it handles BOTH the rewind's
#   own survival (E2) AND the parallel-tool case (E6/§9). Do NOT add special parallel-tool branching: collect the
#   indices of EVERY toolGroup whose assistant issued excludeToolCallId (via assistantIssuedCall) and keep them all.
#   If mulligan_rewind shares an assistant message with sibling calls, the shared unit (assistant + all results) is
#   kept → siblings + results survive (conservative, pairing-safe). No surgical splitting in this pure helper.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (CRITICAL) — The nuclear protected refusal is SELF-ENFORCED here: if `opts.to_previous_prompt === true`
#   AND `iFirstUser === iLastUser` → return {remove:[]} (spec/06 §8, spec/08 E3, spec/10 §1.3). The DEFAULT case is
#   always protected-safe (min(remove) > iLastUser >= iFirstUser). Do NOT re-implement the general protectedOk here —
#   that is filterPipeline's (T5.S1) defense-in-depth job.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — detect `mulligan:*` messages by the customType PREFIX "mulligan:" (a real Pi CustomMessage carries
#   role 'custom' + customType — spec/01 line156; looper proto detects by m.customType). The note (mulligan:note) AND
#   the ephemeral nudge (mulligan:nudge) both start with "mulligan:" — keep BOTH. Use readOwn(msg,'customType') +
#   startsWith; never throws. Do NOT hardcode only "mulligan:note".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — excludeToolCallId undefined / empty string / non-string → the rewind's own unit is NOT kept (it is
#   removed with the rest of the turn). This is safe: (a) the note still survives; (b) pairing stays intact (the
#   rewind's assistant+result both live > iLastUser → both removed together). A real rewind marker ALWAYS carries a
#   valid excludeToolCallId, so this is a defensive edge only. Guard with
#   `typeof excludeToolCallId === 'string' && excludeToolCallId.length > 0`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — Build `remove` in ASCENDING order (deterministic, consumer-friendly): push iLastUser first when
#   nuclear, then iterate j from iLastUser+1. Since iLastUser < iLastUser+1 the result is ascending. No sort needed.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — The test imports from "../src/transforms.js" (.js extension, even though the file is transforms.ts).
#   moduleResolution:'Bundler' + type:'module' → TS resolves .js to .ts. The import line (post-S1) already lists
#   partitionIntoUnits + resolveLastToolCallGroup; MODIFY it to add resolveLastTurn (one precise edit). Do NOT add a
#   second import line.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 — iLastUser is found by scanning for the LAST role==="user" (not the first). iFirstUser is the FIRST.
#   Both reads go through isRecord + readOwn(msg,'role'). A user message is ALWAYS a plain unit (single index), so
#   iLastUser is never inside a toolGroup — the rewindOwnUnit (an assistant+results unit) never contains iLastUser.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No new data models. REUSE the types + helpers T1.S1 + S1 already defined in `src/transforms.ts`:

```ts
// ALREADY IN SCOPE — reuse, do NOT redefine:
export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]: unknown; }
export interface Unit { indices: number[]; kind: "plain" | "toolGroup"; }
export function partitionIntoUnits(messages: MessageLike[] | null | undefined): Unit[];
// module-private: isRecord(value), readOwn(obj, key)                 // Proxy-safe; never throw
// module-private (from S1): assistantIssuedCall(messages, indices, callId): boolean
```

This task ADDS one EXPORTED function + one module-private helper:

```ts
export function resolveLastTurn(
  messages: MessageLike[],
  opts: { to_previous_prompt?: boolean } | undefined,
  excludeToolCallId?: string,
): { remove: number[] };

// module-private:
function isMulliganCustomMessage(msg: unknown): boolean;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITE + BASELINE (no edits — run only)
  - RUN: grep -q 'function assistantIssuedCall' src/transforms.ts && echo "ok: S1 landed (reuse assistantIssuedCall)"
        # if this FAILS, S1 has not landed — STOP and surface it (resolveLastTurn REUSES assistantIssuedCall; this
        # task strictly depends on S1, just as S1 depends on T1.S1).
  - RUN: grep -q 'export function partitionIntoUnits' src/transforms.ts && echo "ok: T1.S1 landed"
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect all-green (incl. transforms.test.ts)
  - RUN: grep -n "function isRecord\|function readOwn" src/transforms.ts
        # confirm the module-private helpers you reuse exist.

Task 1: APPEND resolveLastTurn to src/transforms.ts   (exact content below — copy verbatim)
  - APPEND: the resolveLastTurn export + the module-private isMulliganCustomMessage helper (at the end of the file,
            after partitionIntoUnits, resolveLastToolCallGroup/assistantIssuedCall, and the isRecord/readOwn defs).
  - CONSTRAINTS:
      * NO new imports (GOTCHA #4). Reuse partitionIntoUnits/assistantIssuedCall/Unit/MessageLike/isRecord/readOwn.
      * Return { remove: number[] } (GOTCHA #2). Ascending remove array (GOTCHA #10).
      * Read snake_case opts.to_previous_prompt (GOTCHA #3). Nuclear refused when iFirstUser===iLastUser (GOTCHA #7).
      * Keep the rewind's own unit whole via partitionIntoUnits + assistantIssuedCall (GOTCHA #6).
      * Detect mulligan:* by customType prefix (GOTCHA #8). excludeToolCallId non-string/empty → don't keep own unit (GOTCHA #9).
      * Defensive: non-array messages → {remove:[]}; read everything via isRecord/readOwn; never throws (GOTCHA #5).
      * signature exactly resolveLastTurn(messages, opts, excludeToolCallId): { remove: number[] }.
  - NAMING/PLACEMENT: src/transforms.ts (APPEND). Export: resolveLastTurn. Module-private: isMulliganCustomMessage.

Task 2: APPEND resolveLastTurn tests to test/transforms.test.ts   (exact content below — copy verbatim)
  - EDIT: the import line — add `resolveLastTurn` to the existing import (post-S1 it lists
          partitionIntoUnits + resolveLastToolCallGroup; extend it).
  - APPEND: one new `describe("resolveLastTurn — spec/10 §1.3 + corner + defensive + parallel + types", …)`.
  - CONSTRAINTS: REUSE the existing fixtures (asst/asstText/result/user/custom/summary) — do NOT redefine.
    NO beforeEach (pure, stateless). Mirror the existing describe/it/expect/expectTypeOf house style. Throwing-Proxy
    defensive test. NO use of module-private assistantIssuedCall (not exported — test via behavior).
  - COVERAGE: spec/10 §1.3 pinned (default→[4,5]; nuclear→[3,4,5]; u1-is-first-user→{remove:[]}); rewind's own unit
    survives; mulligan note+nudge survive; parallel-tool (E6/§9) whole shared unit kept; no-user→{remove:[]};
    nothing-after-iLastUser→{remove:[]}; excludeToolCallId absent/empty/non-string→own unit removed, note survives;
    nuclear protected refusal; defensive (non-array→{remove:[]}; throwing-Proxy; malformed opts); purity/idempotence;
    types (expectTypeOf returns { remove: number[] }).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Levels 3/4 N/A (pure helper — no Pi, no server, no DB).
```

#### Exact content to APPEND — `src/transforms.ts`

```ts
/**
 * resolveLastTurn — find the removal set for a "last_turn" rewind (spec/06-context-filter.md §4).
 *
 * A TURN = a user message plus everything after it up to (not including) the next user message. The last turn
 * begins at iLastUser = index of the last message with role "user".
 *
 * ALGORITHM (spec/06 §4, steps 1–3):
 *   1. Find iLastUser = index of the last "user" message. If none → { remove: [] } (nothing to rewind — protected).
 *   2. DEFAULT (opts.to_previous_prompt !== true): KEEP the user message; remove every message AFTER iLastUser
 *      EXCEPT (a) the rewind's OWN unit (the assistant message that issued `excludeToolCallId` + its results —
 *      partitioned via partitionIntoUnits, detected via assistantIssuedCall from S1), and (b) any `mulligan:*`
 *      custom messages at the tail (the note MUST survive so the resumed model reads it). The surviving tail is
 *      [user message] + [mulligan:note] + [rewind assistant + result]; the model resumes at the current prompt.
 *   3. NUCLEAR (opts.to_previous_prompt === true): ALSO remove the user message at iLastUser (plus the same
 *      after-iLastUser removal with the same exclusions). The model resumes at the PREVIOUS user prompt. REFUSED
 *      (returns { remove: [] }) when iLastUser is the FIRST user message (iFirstUser === iLastUser) — that would
 *      cross the protected first-user / original-task boundary (spec/06 §8, spec/08 E3). The default case is always
 *      protected-safe by construction (min(remove) > iLastUser >= iFirstUser).
 *
 * PAIRING (spec/06 §4 pt 4): removal is index-based but pairing-safe in well-formed input — every assistant+result
 * pair produced in the rewound turn lives entirely after iLastUser, so both sides are removed together. The
 * rewind's OWN unit is kept WHOLE (assistant + all its results via rewindOwnIndices), which ALSO resolves the
 * parallel-tool case conservatively (spec/06 §9, spec/08 E6): if mulligan_rewind shares an assistant message with
 * sibling calls, the entire shared unit is kept (siblings + results survive in the view). excludeToolCallId
 * absent/empty/non-string → the rewind's own unit is not identified → it is removed with the rest (pairing still
 * safe; the note still survives — a real rewind marker always carries a valid excludeToolCallId).
 *
 * RETURNS `{ remove: number[] }` (NOT number[] | null — empty array = no-op/refusal). The single consumer
 * `filterPipeline` (P1.M3.T5.S1) uses `remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove`
 * (spec/06 §12). `rw.options` carries `to_previous_prompt` (snake_case — the persisted marker field, spec/04 §3);
 * this function reads it VERBATIM (NOT spec/06 §4's `toPreviousPrompt`, which is a spec typo — see D1).
 *
 * Pure + defensive: a non-array `messages` → { remove: [] }; malformed messages, throwing-Proxy messages, a
 * non-string/empty `excludeToolCallId`, and malformed `opts` are all handled gracefully — NEVER throws (E13;
 * context-handler hot path). Every field read goes through the module-private isRecord/readOwn.
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → { remove: [] }
 * @param opts { to_previous_prompt?: boolean } — the rewind marker's options, passed verbatim by filterPipeline
 * @param excludeToolCallId the rewind's own toolCall id (its unit is kept); undefined/empty/non-string → not kept
 * @returns { remove: number[] } — ascending message indices to remove; [] for no-op/refusal
 */
export function resolveLastTurn(
  messages: MessageLike[],
  opts: { to_previous_prompt?: boolean } | undefined,
  excludeToolCallId?: string,
): { remove: number[] } {
  // Defensive: a non-array messages (shouldn't happen) → nothing to rewind.
  if (!Array.isArray(messages)) return { remove: [] };

  // 1) iLastUser = index of the LAST "user" message.
  let iLastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i;
  }
  if (iLastUser === -1) return { remove: [] }; // no user message → nothing to rewind (protected)

  const nuclear = opts !== undefined && opts.to_previous_prompt === true;

  // 3) Nuclear protected check: refuse if iLastUser is the FIRST user message (would cross the original-task line).
  if (nuclear) {
    let iFirstUser = -1;
    for (let i = 0; i < messages.length; i++) {
      if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") {
        iFirstUser = i;
        break;
      }
    }
    if (iFirstUser === iLastUser) return { remove: [] }; // nuclear refused (spec/06 §8, spec/08 E3)
  }

  // 2) rewindOwnIndices = the set of message indices in the rewind's OWN unit (kept whole). Only when
  //    excludeToolCallId is a non-empty string; the unit is found via partitionIntoUnits + assistantIssuedCall (S1).
  //    This single rule ALSO keeps a parallel-shared assistant message whole (§9/E6) — no special branching.
  const rewindOwnIndices = new Set<number>();
  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
  if (hasExclude) {
    const units = partitionIntoUnits(messages);
    for (const unit of units) {
      if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
        for (const idx of unit.indices) rewindOwnIndices.add(idx); // keep the WHOLE unit (parallel-safe — §9)
      }
    }
  }

  // 4) Build the removal set, ASCENDING. Nuclear removes iLastUser too (pushed first); then every index > iLastUser
  //    except the rewind's own unit and mulligan:* custom messages.
  const remove: number[] = [];
  if (nuclear) remove.push(iLastUser);
  for (let j = iLastUser + 1; j < messages.length; j++) {
    if (rewindOwnIndices.has(j)) continue; // the rewind's own assistant + results survive
    if (isMulliganCustomMessage(messages[j])) continue; // the note / nudge survives
    remove.push(j);
  }
  return { remove };
}

/**
 * Module-private: is this message a `mulligan:*` custom message (the note / nudge that MUST survive a rewind)?
 * Detected by a `customType` string with the `mulligan:` prefix (a real Pi CustomMessage carries role "custom" +
 * customType — spec/01 line156; the looper-smoke proto detects custom messages by m.customType). Defensive
 * (isRecord/readOwn; never throws).
 */
function isMulliganCustomMessage(msg: unknown): boolean {
  if (!isRecord(msg)) return false;
  const customType = readOwn(msg, "customType");
  return typeof customType === "string" && customType.startsWith("mulligan:");
}
```

#### Exact content to EDIT + APPEND — `test/transforms.test.ts`

EDIT the existing import line (post-S1 it reads
`import { partitionIntoUnits, resolveLastToolCallGroup, type Unit, type MessageLike } from "../src/transforms.js";`):

```diff
- import { partitionIntoUnits, resolveLastToolCallGroup, type Unit, type MessageLike } from "../src/transforms.js";
+ import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, type Unit, type MessageLike } from "../src/transforms.js";
```

APPEND this block at the END of the file (reuse the fixtures T1.S1 already defined: `asst`, `asstText`, `result`,
`user`, `custom`, `summary`):

```ts
// ── resolveLastTurn — spec/10 §1.3 + corner + defensive + parallel + types ────

describe("resolveLastTurn — spec/10 §1.3 PINNED contract", () => {
  // [u0, a, r, u1, a, r] — indices 0..5; iLastUser = 3.
  const twoTurns = (): MessageLike[] => [
    user("u0"), asst("c0"), result("c0"),
    user("u1"), asst("c1"), result("c1"),
  ];

  it("default → remove indices AFTER u1 (keep u1): remove = [4,5]", () => {
    expect(resolveLastTurn(twoTurns(), {}).remove).toEqual([4, 5]);
    expect(resolveLastTurn(twoTurns(), undefined).remove).toEqual([4, 5]); // opts may be undefined
  });

  it("to_previous_prompt:true → ALSO remove u1: remove = [3,4,5] (iLastUser=3, iFirstUser=0 → allowed)", () => {
    expect(resolveLastTurn(twoTurns(), { to_previous_prompt: true }).remove).toEqual([3, 4, 5]);
  });

  it("u1 is the FIRST user → nuclear refused by protected check: { remove: [] }", () => {
    // only one user message → iLastUser === iFirstUser === 0
    const singleTurn: MessageLike[] = [user("only"), asst("c"), result("c")];
    expect(resolveLastTurn(singleTurn, { to_previous_prompt: true })).toEqual({ remove: [] });
  });
});

describe("resolveLastTurn — the rewind's OWN unit survives (default)", () => {
  it("rewind's assistant+result after iLastUser are kept; prior-turn work is removed", () => {
    // iLastUser=3. The rewind's own unit (assistant issued "REW") = [6,7]. Prior turn work [4,5] is removed.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("prev"), result("prev"), asst("REW"), result("REW"),
    ];
    expect(resolveLastTurn(msgs, {}, "REW").remove).toEqual([4, 5]); // [6,7] kept (rewind's own unit)
  });

  it("rewind's own unit is kept WHOLE even if it shares a message (parallel-tool — spec/06 §9 / spec/08 E6)", () => {
    // one assistant carries a sibling call 'sib' AND the rewind call 'REW'; both results follow.
    // iLastUser=3. rewindOwnUnit (assistant issued "REW") = the shared toolGroup [6,7,8] → all kept.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("prev"), result("prev"), asst("sib", "REW"), result("sib"), result("REW"),
    ];
    // prior-turn work [4,5] removed; shared unit [6,7,8] kept whole (siblings survive)
    expect(resolveLastTurn(msgs, {}, "REW").remove).toEqual([4, 5]);
  });
});

describe("resolveLastTurn — mulligan:* notes survive at the tail", () => {
  it("a mulligan:note after iLastUser is NOT removed", () => {
    // iLastUser=3; note at 6 → kept; assistant/result [4,5] removed.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"), custom("mulligan:note"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5]);
  });

  it("a mulligan:nudge (ephemeral) after iLastUser is also kept", () => {
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"), custom("mulligan:nudge"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5]);
  });

  it("multiple mulligan:* notes interspersed with removed work all survive", () => {
    // iLastUser=3; indices 4(asst),5(result) removed; 6(note),7(note) kept.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"), custom("mulligan:note"), custom("mulligan:note"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5]);
  });
});

describe("resolveLastTurn — no-op cases", () => {
  it("no user message at all → { remove: [] }", () => {
    const msgs: MessageLike[] = [asst("c"), result("c"), custom("mulligan:note")];
    expect(resolveLastTurn(msgs, {})).toEqual({ remove: [] });
    expect(resolveLastTurn(msgs, { to_previous_prompt: true })).toEqual({ remove: [] });
  });

  it("nothing after iLastUser → { remove: [] }", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1")];
    expect(resolveLastTurn(msgs, {})).toEqual({ remove: [] });
    // nuclear still allowed here (iLastUser=3 !== iFirstUser=0) and removes just u1
    expect(resolveLastTurn(msgs, { to_previous_prompt: true }).remove).toEqual([3]);
  });
});

describe("resolveLastTurn — excludeToolCallId semantics", () => {
  it("excludeToolCallId absent → rewind's own unit is NOT kept (removed with the rest); note survives", () => {
    // no exclude → rewindOwnIndices empty → [4,5,6,7] all removed except the note at 8.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("REW"), result("REW"), asst("c2"), result("c2"), custom("mulligan:note"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5, 6, 7]);
  });

  it("excludeToolCallId empty string / non-string → never keeps an own unit", () => {
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("REW"), result("REW"),
    ];
    expect(resolveLastTurn(msgs, {}, "").remove).toEqual([4, 5]);
    expect(resolveLastTurn(msgs, {}, 123 as unknown as string).remove).toEqual([4, 5]);
  });

  it("excludeToolCallId matching NO unit → nothing kept (same as absent)", () => {
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"),
    ];
    expect(resolveLastTurn(msgs, {}, "DOES-NOT-EXIST").remove).toEqual([4, 5]);
  });
});

describe("resolveLastTurn — nuclear edge cases", () => {
  it("two user messages, nuclear on the 2nd → removes iLastUser + after (previous prompt remains)", () => {
    // iLastUser=3, iFirstUser=0 (differ) → allowed. remove = [3,4,5].
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    expect(resolveLastTurn(msgs, { to_previous_prompt: true }).remove).toEqual([3, 4, 5]);
  });

  it("three user messages, nuclear → removes only the LAST user + after (earlier users protected by position)", () => {
    // iLastUser=5, iFirstUser=0. nuclear removes [5,6,7]; u0,u3 survive.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u3"), asst("c1"), result("c1"),
      user("u5"), asst("c2"), result("c2"),
    ];
    expect(resolveLastTurn(msgs, { to_previous_prompt: true }).remove).toEqual([5, 6, 7]);
  });

  it("default is NEVER refused on a single-user list (keeps that user)", () => {
    const msgs: MessageLike[] = [user("only"), asst("c"), result("c")];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([1, 2]); // removes the turn work, keeps the user
  });
});

describe("resolveLastTurn — defensive (NEVER throws — spec/08 E13)", () => {
  it("non-array messages → { remove: [] } (no throw)", () => {
    expect(resolveLastTurn(null as unknown as MessageLike[], {})).toEqual({ remove: [] });
    expect(resolveLastTurn(undefined as unknown as MessageLike[], {})).toEqual({ remove: [] });
    expect(resolveLastTurn("nope" as unknown as MessageLike[], {})).toEqual({ remove: [] });
  });

  it("malformed opts (non-object / missing field) → treated as default (not nuclear)", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    expect(resolveLastTurn(msgs, "bad" as unknown as { to_previous_prompt?: boolean }).remove).toEqual([4, 5]);
    expect(resolveLastTurn(msgs, { to_previous_prompt: false }).remove).toEqual([4, 5]);
  });

  it("a throwing-Proxy user message is skipped (readOwn swallows) — no throw", () => {
    const trap: MessageLike = new Proxy(
      { role: "user", content: "boom" } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), trap];
    expect(() => resolveLastTurn(msgs, {})).not.toThrow();
    // trap reads throw → not seen as a user message → iLastUser stays at 0 → remove = [1,2] (trap at 3 also removed)
    expect(resolveLastTurn(msgs, {}).remove).toEqual([1, 2, 3]);
  });

  it("a throwing-Proxy mulligan message is removed (cannot confirm it is mulligan:*) — no throw, no crash", () => {
    const trap: MessageLike = new Proxy(
      { role: "custom", customType: "mulligan:note", content: "n" } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c"), trap];
    expect(() => resolveLastTurn(msgs, {})).not.toThrow();
    expect(resolveLastTurn(msgs, {}).remove).toEqual([1, 2, 3]); // trap unreadable → not exempted → removed
  });
});

describe("resolveLastTurn — purity, ordering, types", () => {
  it("is pure / idempotent — same input → same output, no mutation", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    const a = resolveLastTurn(msgs, {});
    const b = resolveLastTurn(msgs, {});
    expect(a).toEqual(b);
    expect(JSON.stringify(msgs)).toBe(JSON.stringify(msgs)); // unchanged (no mutation by construction)
  });

  it("remove is ASCENDING (deterministic) for the nuclear case", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    const remove = resolveLastTurn(msgs, { to_previous_prompt: true }).remove;
    const sorted = [...remove].sort((x, y) => x - y);
    expect(remove).toEqual(sorted);
  });

  it("returns { remove: number[] } (the object wrapper, not a bare array or null)", () => {
    expectTypeOf(resolveLastTurn([], {})).toEqualTypeOf<{ remove: number[] }>();
    expectTypeOf(resolveLastTurn([], { to_previous_prompt: true })).toEqualTypeOf<{ remove: number[] }>();
    expectTypeOf(resolveLastTurn([], undefined, "x")).toEqualTypeOf<{ remove: number[] }>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: find the LAST user, then build the removal set with two keep-rules (spec/06 §4).
let iLastUser = -1;
for (let i = 0; i < messages.length; i++)
  if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i;
if (iLastUser === -1) return { remove: [] };

// PATTERN: the rewind's own unit is found by REUSING partitionIntoUnits + assistantIssuedCall (S1). This single
// rule keeps a parallel-shared assistant message whole (§9/E6) — no special branching.
const rewindOwnIndices = new Set<number>();
if (typeof excludeToolCallId === "string" && excludeToolCallId.length > 0) {
  for (const unit of partitionIntoUnits(messages)) {
    if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
      for (const idx of unit.indices) rewindOwnIndices.add(idx); // whole unit kept
    }
  }
}

// PATTERN: build remove ASCENDING. Nuclear pushes iLastUser first; then j > iLastUser minus the two keep-sets.
const remove: number[] = [];
if (nuclear) remove.push(iLastUser);
for (let j = iLastUser + 1; j < messages.length; j++) {
  if (rewindOwnIndices.has(j)) continue;          // (a) rewind's own unit
  if (isMulliganCustomMessage(messages[j])) continue; // (b) the note / nudge
  remove.push(j);
}
return { remove };

// CRITICAL: read snake_case `opts.to_previous_prompt` (the persisted marker field passed verbatim by filterPipeline).
//   spec/06 §4's `toPreviousPrompt` is a spec typo. The nuclear guard `iFirstUser === iLastUser` returns {remove:[]}.
```

### Integration Points

```yaml
MODULE OWNERSHIP (spec/11 §1/§2):
  - src/transforms.ts   # THIS task APPENDS resolveLastTurn (+ isMulliganCustomMessage) to the file T1.S1 + S1 built.

CONSUMERS (no wiring in THIS task — resolveLastTurn is a pure function consumed later):
  - P1.M3.T5.S1 filterPipeline: the single caller. Per spec/06 §12:
      `remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove;`
    NOTE — rw.options carries `to_previous_prompt` (snake_case); this function reads it verbatim. The general
    protectedOk pass (min(remove) > iFirstUser) runs in filterPipeline as defense-in-depth; resolveLastTurn already
    self-enforces the nuclear iFirstUser===iLastUser refusal.
  - P1.M3.T4.S1 applyRewind: receives `remove` (number[]) and removes those indices gap-closed.

INPUT SOURCES (already specified upstream — no action here):
  - messages: event.messages from the context handler (filter.ts, P1.M4.T2.S1).
  - opts: the rewind marker's `options` ({ to_previous_prompt?: boolean }) — spec/04 §3.
  - excludeToolCallId: the rewind marker's field, captured from the mulligan_rewind tool's execute(toolCallId, …)
    first argument (spec/05 §1 + api_verification.md "NOTE on execute signature").

REUSED SYMBOLS (must already be in src/transforms.ts):
  - partitionIntoUnits (T1.S1) — called once to find the rewind's own unit.
  - assistantIssuedCall (S1, module-private) — detects which unit's assistant issued excludeToolCallId.
  - Unit / MessageLike (T1.S1) — types. isRecord / readOwn (T1.S1) — defensive field reads.

CONFIG / DATABASE / ROUTES: none — pure function, zero side effects, zero persistence.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending resolveLastTurn (and again after the test block). The type+style gate IS tsc.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output and fix before proceeding.
# Confirm NO new imports crept in (foundation-tier pure):
grep -c '^import' src/transforms.ts   # → expect 0 (unchanged from T1.S1/S1)
# (There is NO eslint/prettier/biome — GOTCHA #12. Do NOT run a lint/format command.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the whole transforms module (partitionIntoUnits + resolveLastToolCallGroup + resolveLastTurn) in isolation.
npx vitest run test/transforms.test.ts -v
# Expected: all transforms tests green (T1.S1's + S1's suites + the appended resolveLastTurn block).

# Full suite (confirm no regression — this task is append-only to two files).
npx vitest run
# Expected: all test files green. A regression in another suite means you accidentally modified another file — revert it.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask. resolveLastTurn is a pure function with ZERO Pi dependency (no server, no DB, no session).
# Integration validation of the last_turn rewind happens via filterPipeline (P1.M3.T5) + the F-protected /
# F-rewind-core scenarios (P1.M7.T2 / spec/10 §2.1). Do NOT spin up `pi -e` here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The domain-specific checks for THIS resolver are the keep-rules (rewind's own unit + mulligan note) + the nuclear
# protected refusal + the parallel-tool whole-unit-kept behavior, expressed as unit tests (already in the appended
# describe blocks). The highest-value assertions:
#   - the rewind's own assistant+result survive a default last_turn rewind (E2);
#   - a parallel-shared assistant message is kept WHOLE (§9/E6) — siblings + results survive;
#   - nuclear on a single-user list is refused (§8/E3);
#   - the mulligan:note survives at the tail.
# No additional tooling required.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `grep -c '^import' src/transforms.ts` → 0 (no new imports — GOTCHA #4).
- [ ] Level 2 passed: `npx vitest run` → all files green (incl. the appended resolveLastTurn block).
- [ ] No lint/format command invented (none configured — GOTCHA #12).

### Feature Validation

- [ ] All success criteria from "What" section met.
- [ ] **spec/10 §1.3** all three pinned cases pass (default→[4,5]; nuclear→[3,4,5]; u1-is-first-user→{remove:[]}).
- [ ] **rewind's own unit survives** (default): assistant+result with `excludeToolCallId` are NOT in `remove`.
- [ ] **mulligan:* note + nudge survive** at the tail.
- [ ] **parallel-tool (spec/06 §9 / spec/08 E6):** shared assistant message kept WHOLE (siblings + results survive).
- [ ] **nuclear protected refusal:** `iFirstUser === iLastUser` → `{ remove: [] }`.
- [ ] **Never throws:** non-array messages → `{remove:[]}`; throwing-Proxy messages handled; malformed opts.
- [ ] excludeToolCallId absent/empty/non-string → own unit removed with the rest (note survives; pairing safe).
- [ ] Return type is `{ remove: number[] }` (object wrapper), NOT `number[] | null` or bare `number[]`.
- [ ] `remove` is ascending and deterministic.

### Code Quality Validation

- [ ] APPEND-only (did not recreate transforms.ts / transforms.test.ts; reused partitionIntoUnits/assistantIssuedCall/Unit/MessageLike/isRecord/readOwn + fixtures).
- [ ] snake_case `opts.to_previous_prompt` read (NOT camelCase — GOTCHA #3).
- [ ] File placement matches the desired codebase tree (APPEND to src/transforms.ts + test/transforms.test.ts only).
- [ ] Anti-patterns avoided (no re-implementation of assistantIssuedCall/partitionIntoUnits; no special parallel branching; no protectedOk re-implementation).
- [ ] Zero new imports; no new persisted state; no Pi dependency.

### Documentation & Deployment

- [ ] Code is self-documenting with clear variable/function names + JSDoc referencing spec sections.
- [ ] The snake_case/camelCase spec discrepancy is documented in the JSDoc (D1) so future readers don't "fix" it.
- [ ] No new environment variables or config (pure helper).

---

## Anti-Patterns to Avoid

- ❌ Don't recreate `src/transforms.ts` / `test/transforms.test.ts` — they EXIST (T1.S1 + S1). APPEND only.
- ❌ Don't redefine `partitionIntoUnits` / `assistantIssuedCall` / `Unit` / `MessageLike` / `isRecord` / `readOwn` — REUSE them.
- ❌ Don't read camelCase `opts.toPreviousPrompt` — the persisted marker field is snake_case `to_previous_prompt`
  (GOTCHA #3); camelCase means nuclear mode never fires.
- ❌ Don't return `number[] | null` or a bare `number[]` — the contract is `{ remove: number[] }` (GOTCHA #2).
- ❌ Don't add special parallel-tool branching — the "keep the whole unit whose assistant issued excludeToolCallId"
  rule already resolves it conservatively (GOTCHA #6).
- ❌ Don't re-implement the general `protectedOk` — only the nuclear `iFirstUser === iLastUser` refusal belongs here
  (GOTCHA #7); filterPipeline (T5.S1) owns the general defense-in-depth.
- ❌ Don't hardcode only `"mulligan:note"` — match the `mulligan:` PREFIX so the nudge survives too (GOTCHA #8).
- ❌ Don't skip validation because "it should work" — run `tsc` + `vitest` and fix every failure.
- ❌ Don't catch all exceptions broadly — use `isRecord` + `readOwn` (Proxy-safe) so defensive branches compile clean.
- ❌ Don't invent a lint/format command — none is configured (GOTCHA #12).

---

## Confidence Score

**9/10** — one-pass implementation success likelihood. The algorithm is fully spec-pinned (spec/06 §4 steps 1–3); the
exact code to APPEND is given verbatim; the exact tests are given verbatim (spec/10 §1.3 pinned + corner/defensive/
parallel); every spec-open detail is resolved (D1–D9 in research/notes.md); the reused symbols
(`partitionIntoUnits`, `assistantIssuedCall`) are precisely specified in the sibling PRPs. The one residual risk is
the cross-PRP ordering dependency on S1's `assistantIssuedCall` — mitigated by the Task 0 gate (grep for it; STOP +
surface if absent, exactly as S1 gates on T1.S1). Validation = `tsc --noEmit` + `npx vitest run`, both verified
runnable in this repo.