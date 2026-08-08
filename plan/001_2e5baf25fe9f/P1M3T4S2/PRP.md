# PRP — P1.M3.T4.S2: `resolveShrinkTarget` + `applyShrink` (three matcher strategies)

**Work item:** P1.M3.T4.S2 · **Points:** 1.5 · **Stage:** Pure Core — Context Filter Transforms (the correctness heart)
**Scope:** **APPEND THREE exported symbols (the `ShrinkTarget` type + `resolveShrinkTarget` + `applyShrink`) + one
module-private helper (`stringifyContent`) to the EXISTING `src/transforms.ts`** and **APPEND ONE `describe` block
(+ a three-token import edit) to the EXISTING `test/transforms.test.ts`.** **No new file, no other file touched.**
Adds **ZERO imports** (`grep -c '^import' src/transforms.ts` → stays **0** — the module is Pi-free). Reuses the
in-scope `MessageLike` + `ContentBlock` + module-private `isRecord`/`readOwn` only. This is **T4.S2 of the
`transforms.ts` build** (spec/11 §2 Step 3): it ships the pure **content-substitution** transforms — the SHRINK
half of `filterPipeline` (T5.S1), which calls `messages = applyShrinkSafe(messages, m)` per shrink marker
(spec/06 §1 L24, §12). It is the **SHRINK sibling** of `applyRewind` (T4.S1, the REWIND half, landing in parallel).

> **PARALLEL-EXECUTION CONTRACT (READ FIRST):** Treat the four earlier pure-core tasks + `applyRewind` (T4.S1) as
> **hard contracts that have LANDED** (verified live this session — `src/transforms.ts` is 533 lines, import count
> **0**, `tsc` exit 0, `vitest` 84 transforms tests / 371 full-suite tests green). Concretely, when THIS task runs:
> 1. **`src/transforms.ts`** already contains `partitionIntoUnits`, `Unit`, `MessageLike`, `ContentBlock`, the
>    module-private `isRecord`/`readOwn`/`assistantIssuedCall`/`isMulliganCustomMessage`/`entryMessageYield`/
>    `isContextProducingType`, `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`, AND (from T4.S1)
>    `applyRewind` at the tail.
> 2. **`test/transforms.test.ts`** import line already includes `applyRewind` (T4.S1's one-token edit) — the
>    fixtures `asst`/`asstText`/`result`/`user`/`custom`/`summary` + `expectPairingInvariant` are all defined.
>
> This task **APPENDS** `ShrinkTarget` + `resolveShrinkTarget` + `applyShrink` (+ module-private `stringifyContent`)
> to the END of `src/transforms.ts` (after `applyRewind`) and **APPENDS a `describe("applyShrink …")` block** to the
> END of `test/transforms.test.ts` (+ three-token import edit: `applyShrink`, `resolveShrinkTarget`, `type ShrinkTarget`).
> Do NOT recreate, redefine, or re-import any symbol — `MessageLike`/`ContentBlock`/`isRecord`/`readOwn` are already
> in module scope.

> **THE ONE LOAD-BEARING FACT (read before coding):** spec/06 §5 defines the shrink algorithm verbatim:
> `resolveShrinkTarget(messages, target)` returns a message index or null via ONE of THREE matcher strategies
> (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`); `applyShrink` calls it, and on a match
> returns `{messages.map((m,j) => j===i ? {...orig, content:[{type:"text",text:replacement}]} : m)}` — the spread
> PRESERVES every field (role/toolCallId/toolName/isError/customType/…), so a toolResult keeps its `toolCallId`
> (pairing untouched — spec/06 §5:145) and a non-toolResult keeps its `role` (spec/08 E19). On null → return
> `messages` **unchanged (same reference)** — the documented no-op (spec/06 §5:133; "shrink after rewind removed
> the target → no-op", spec/06 §5:143). The spec's §5:136-138 ternary has **IDENTICAL branches** (only the comment
> differs) → written as ONE spread expression here (DRY). Full proof + citations: §"Known Gotchas" + `research/verification.md`.

---

## Goal

**Feature Goal**: Ship the **pure content-substitution transforms** for Mulligan's shrink application —
`resolveShrinkTarget(messages, target): number | null` (three matcher strategies) and `applyShrink(messages, marker):
MessageLike[]` (spec/06-context-filter.md §5; spec/04-data-model.md §4). `resolveShrinkTarget` resolves a
`ShrinkTarget` to a single message index, LIVE against the current messages each inference (compaction-robust);
`applyShrink` substitutes the matched message's `content` with a compact replacement while PRESERVING
role/toolCallId/toolName/isError (and every other field), so the model API stays valid (tool-pairing untouched).
They are the SHRINK half of `filterPipeline` (P1.M3.T5.S1): per shrink marker, `m = applyShrink(m, marker)`.
No match → `messages` **unchanged (same reference)** — the idempotent no-op. Multiple shrinks same target → applied
in seq order, last wins (spec/08 E17) — achieved naturally by sequential re-resolution (each `applyShrink` re-resolves
against the current list; `by_tool_call_id` is stable because the spread preserved `toolCallId`).

**Deliverable** (APPEND to two EXISTING files — do NOT create new files):
1. `src/transforms.ts` — APPEND (file already exists, 533 lines, 0 imports): the EXPORTED `ShrinkTarget` type (a
   LOCAL structural declaration — see GOTCHA #1), the EXPORTED `resolveShrinkTarget`, the EXPORTED `applyShrink`,
   and ONE module-private helper `stringifyContent`. **NO new imports** (reuse the in-scope `MessageLike` +
   `ContentBlock` + `isRecord`/`readOwn`). File import count stays **0**.
2. `test/transforms.test.ts` — APPEND (file already exists, 84 tests green): MODIFY the import line to add
   `applyShrink`, `resolveShrinkTarget`, `type ShrinkTarget`, and ADD one new
   `describe("applyShrink — spec/10 §1.5 PINNED contract + three matchers + defensive + composition", …)` block.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**.
- `npx vitest run` is **all-green** — the existing transforms suite AND the appended `applyShrink` block; no
  pre-existing suite regresses (append-only to one src file + one test file).
- `resolveShrinkTarget` + `applyShrink` **never throw** (E13; they sit on the `context` handler hot path via
  `filterPipeline`) — non-array `messages`, non-record `target`/`marker`, missing/empty/non-string discriminator
  values, and throwing-Proxy message elements (including the MATCHED message's `{...orig}` spread) are all handled
  gracefully.
- **The three matchers resolve correctly** (spec/06 §5 L126-128): `by_tool_call_id` → first toolResult with
  `toolCallId === id`; `by_tool_name`+`occurrence` → last (default) / first toolResult with `toolName === name`;
  `by_content_includes` → first message (any role) whose stringified content includes the substring.
- **The preservation contract** holds (spec/10 §1.5 bullet 1; spec/06 §5:137): on a `by_tool_call_id` match, the
  matched toolResult's `content` is replaced AND `role`/`toolCallId`/`toolName`/`isError` are preserved (pairing intact).
- **The no-op contract** holds (spec/10 §1.5 bullet 2; spec/06 §5:133): no match returns the **same** array
  reference (`toBe`); a non-record marker likewise returns `messages` unchanged.
- **The last-wins contract** holds (spec/10 §1.5 bullet 3; spec/08 E17): two shrinks same `by_tool_call_id` target,
  applied in sequence → the second replacement is what survives.

---

## User Persona

**Target User**: The implementing AI agent for `filterPipeline` (P1.M3.T5.S1) — the **single pure-tier consumer**.
Per shrink marker (spec/06 §1 L24 / §12), after `stableSortBySeq` orders shrinks oldest-first and the rewind pass
has run, `filterPipeline` calls `m = applyShrink(m, marker)` once per shrink. The SECOND consumer is the test suite
(this PRP). (`filter.ts` in P1.M4.T2 wraps this pure `applyShrink` in `applyShrinkSafe` — the try/catch fail-open
wrapper; the PURE function this task exports is `applyShrink`.)

**Use Case**: The agent called `mulligan_shrink({target:{by_tool_call_id:"call_42"}, replacement:"[3 files read]"})`
after a `read` tool returned a 12 KB dump. The marker persists. Next inference → `context` handler →
`filterPipeline` → `resolveShrinkTarget(m, {by_tool_call_id:"call_42"})` returns the toolResult's index →
`applyShrink` substitutes its content with `"[3 files read]"` while preserving `toolCallId:"call_42"` → the model
sees the compact summary; pairing is untouched (the assistant call that issued `call_42` is still paired).

**User Journey**:
1. A shrink marker is read by `readMarkers(ctx)` (P1.M4.T2) into `markers.shrinks`.
2. `filterPipeline` iterates shrinks oldest-first (after rewinds): `for (const m of stableSortBySeq(markers.shrinks))`.
3. `m = applyShrink(m, m_marker)` — **this function** — resolves the target against the CURRENT (already-rewound) `m`,
   and on a match substitutes the content (preserving all other fields); on no match, `m` passes through unchanged.
4. Nudges run next; the final `m` is cached as `rt.lastFiltered` for `mulligan_audit`.

**Pain Points Addressed**: The agent bloated its context with a huge tool result it no longer needs verbatim.
`resolveShrinkTarget` finds that one message by a stable handle (`by_tool_call_id`), a tool name
(`by_tool_name`+`occurrence`), or a content signature (`by_content_includes`); `applyShrink` swaps its content for a
compact replacement — permanently, across reload and `/resume` — without orphaning its tool-pair (the `toolCallId`
survives) and without touching any other message. The whole thing is a pure, total, one-purpose function pair so the
pipeline composes shrinks with rewinds by repeated `m = applyShrink(m, marker)`.

---

## Why

- **Unblocks shrink application end-to-end (at the pure tier).** `applyShrink` is the substitution half of the shrink
  operation (spec/06 §5; spec/04 §4). Shipping it now (pure-core, unit-testable in isolation) lets T5.S1 focus on
  pipeline composition + protected-message checks + marker iteration, not on the mechanics of safe content substitution.
- **Pairing safety by field-preservation.** The model API rejects an orphaned `toolCall`/`toolResult`
  (`api_verification.md §6.4`). Because `applyShrink` spreads `{...orig}` and only overrides `content`, a toolResult
  KEEPS its `toolCallId` — its assistant call remains paired. Shrink never removes a message and never orphans either
  side of a pair (spec/06 §5:145 "Pairing: shrink preserves toolCallId/role, so pairing is untouched. Safe.").
- **Compaction-robustness by re-resolution.** `resolveShrinkTarget` resolves against the CURRENT `event.messages`
  each fire (spec/04 §4). If compaction already summarized/removed the targeted message, the shrink no-ops this fire
  and silently retries next fire (spec/06 §5:133) — no stale-index bookkeeping, no crash.
- **Pure-core tier & unit-testable in isolation.** Adds **NO new imports** (reuses `MessageLike`/`ContentBlock`/
  `isRecord`/`readOwn` already in `transforms.ts`). Pure, deterministic, side-effect-free, covered by fast unit tests
  with no Pi, no model, no session (spec/10 §1; spec/03 §7).

---

## What

APPEND `ShrinkTarget` + `resolveShrinkTarget` + `applyShrink` (+ module-private `stringifyContent`) to
`src/transforms.ts`, and APPEND an `applyShrink` test block (+ three-token import edit) to `test/transforms.test.ts`.

`ShrinkTarget` (LOCAL structural declaration — see GOTCHA #1):
- A discriminated union, **structurally identical** to `markers.ts`'s export: `{by_tool_call_id: string}` |
  `{by_tool_name: string; occurrence:"last"|"first"}` | `{by_content_includes: string}`. EXPORTED.

`resolveShrinkTarget(messages, target): number | null`:
- **Defensive:** non-array `messages` → null; non-record `target` → null.
- **Variant selection:** the FIRST present non-empty-string discriminator key decides (check `by_tool_call_id` →
  `by_tool_name` → `by_content_includes`, in that order); a target with no recognizable discriminator → null.
- **`by_tool_call_id`:** `id = target.by_tool_call_id`; if not a non-empty string → null. Scan messages; return the
  index of the FIRST message with `role==="toolResult"` AND `toolCallId===id` (else null). (`toolCallId` is unique →
  at most one match; first-match is deterministic.)
- **`by_tool_name` + `occurrence`:** `name = target.by_tool_name`; if not a non-empty string → null.
  `wantFirst = target.occurrence === "first"` (anything else, incl. missing → last — GOTCHA #6). Scan messages;
  among those with `role==="toolResult"` AND `toolName===name`: if `wantFirst`, return the FIRST match immediately;
  else track the LAST match and return it (null if none).
- **`by_content_includes`:** `needle = target.by_content_includes`; if not a string → null. Scan messages; return
  the index of the FIRST message (ANY role) whose `stringifyContent(content)` includes `needle` (else null).

`applyShrink(messages, marker): MessageLike[]` (`marker: {target: ShrinkTarget; replacement: string}`):
- **Defensive:** non-array `messages` → `[]` (mirrors `applyRewind`/`partitionIntoUnits`); non-record `marker` →
  return `messages` unchanged (same ref).
- `i = resolveShrinkTarget(messages, marker.target)` (read via `readOwn` for throwing-Proxy safety). If `i === null`
  OR out of range → return `messages` **unchanged (same reference)** — the no-op (spec/06 §5:133).
- `orig = messages[i]`; `text = typeof marker.replacement === "string" ? marker.replacement : ""`;
  `newContent = [{type:"text", text}]`.
- Read `role = readOwn(orig, "role")` FIRST (safe). Build the replacement:
  - primary: `replacement = {...orig, content: newContent}` — preserves EVERY field (role/toolCallId/toolName/
    isError/customType/…); wrapped in **try/catch** (E13 — a throwing-Proxy `orig` could make the spread throw).
  - fallback (catch): `replacement = { role: typeof role === "string" ? role : undefined, content: newContent }` —
    minimal, never-throws, preserves role (the E19 guarantee); only fires on pathological Proxy inputs.
- `return messages.map((m, j) => (j === i ? replacement : m))` — a NEW array with index `i` replaced; non-matched
  elements copied BY REFERENCE (never read/spread → throwing-Proxy-safe).

`stringifyContent(content): string` (module-private):
- string → verbatim; array → `JSON.stringify` (wrapped in try/catch → "" on throwing-Proxy/circular); else → "".

This subtask does **NOT**: implement `filterPipeline`/`applyShrinkSafe`/`protectedOk`/`stableSortBySeq`/`readMarkers`
(later P1.M3/P1.M4 subtasks); import anything (the file is foundation-tier pure); redefine
`MessageLike`/`Unit`/`ContentBlock`/`isRecord`/`readOwn`/`partitionIntoUnits`/`resolveLastToolCallGroup`/
`resolveLastTurn`/`resolveCheckpoint`/`applyRewind` (reuse them); take `config` or `ctx` or a real `ShrinkMarker`
(purity — `applyShrink` is a pure function of `(messages, marker)`); call `protectedOk` (that is `filterPipeline`'s
defense-in-depth — shrinks don't remove protected messages anyway, they substitute content); remove or delete any
message (shrinks SUBSTITUTE content only); mutate `messages`; or import `ShrinkTarget`/`ShrinkMarker` from `markers.ts`
(breaks the Pi-free invariant — declare `ShrinkTarget` locally, GOTCHA #1).

### Success Criteria

- [ ] `src/transforms.ts` EXPORTS `ShrinkTarget` (type), `resolveShrinkTarget`, `applyShrink` and has **NO new
      imports** (`grep -c '^import' src/transforms.ts` → **0**); one new module-private `stringifyContent`.
- [ ] `test/transforms.test.ts` has a new `describe("applyShrink …")` block; the import line now includes
      `applyShrink`, `resolveShrinkTarget`, `type ShrinkTarget`; the whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **spec/10 §1.5 bullet 1:** `by_tool_call_id` match → `content` is `[{type:"text",text:<replacement>}]` AND
      `role`/`toolCallId`/`toolName`/`isError` are unchanged (pairing intact).
- [ ] **spec/10 §1.5 bullet 2:** no match → input UNCHANGED — **SAME reference** (`toBe(msgs)`).
- [ ] **spec/10 §1.5 bullet 3:** two shrinks same `by_tool_call_id` target, applied in sequence → the SECOND
      replacement survives (last wins — spec/08 E17).
- [ ] **`by_tool_name` + `occurrence:"last"`** → the LAST toolResult with that `toolName` is substituted; the earlier
      ones untouched. **`occurrence:"first"`** → the FIRST.
- [ ] **`by_content_includes`** → the FIRST message (any role) whose stringified content includes the substring;
      matching a non-toolResult (user/assistant/custom) substitutes content but PRESERVES `role` (spec/08 E19).
- [ ] **Defensive / never throws (E13):** non-array `messages` → `[]`; non-record `marker`/`target` → no-op (same
      ref); missing/empty/non-string discriminator → no-op; a throwing-Proxy message (matched or not) never crashes.
- [ ] **Purity:** `applyShrink` never mutates its `messages` input.
- [ ] **Signatures exact:** `resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null` and
      `applyShrink(messages: MessageLike[], marker: { target: ShrinkTarget; replacement: string }): MessageLike[]`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `ShrinkTarget` + `resolveShrinkTarget` + `applyShrink` + `stringifyContent`
> to APPEND are given verbatim below (Task 1), and the exact tests + import edit are given verbatim (Task 2). The
> algorithm is spec-pinned (spec/06 §5 L119-145 — quoted in full in the JSDoc + research/verification.md §2); the
> three pinned tests are spec/10 §1.5; last-wins is spec/08 E17; non-toolResult role-preservation is spec/08 E19;
> the no-op same-ref rule is the spec's own `if (i === null) return messages;` (§5:133) + the `applyRewind`
> precedent (T4.S1). The throwing-Proxy spread fallback is the only non-obvious bit — it is motivated + specified
> in GOTCHA #5. The only prerequisite is that the four earlier P1.M3 tasks + `applyRewind` (T4.S1) have landed
> their symbols in `src/transforms.ts` (the parallel-execution contract — verified live). No prior knowledge beyond
> "this APPENDS pure symbols to the existing transforms module and APPENDS their tests" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/transforms.ts` — it ALREADY EXISTS (533 lines, 0 imports; `applyRewind` lands at the tail via
  T4.S1).** Ship `ShrinkTarget` (exported type, declared LOCALLY — GOTCHA #1), `resolveShrinkTarget` (exported),
  `applyShrink` (exported), and ONE module-private `stringifyContent`. REUSE the in-scope `MessageLike` +
  `ContentBlock` + `isRecord`/`readOwn` — do NOT redefine or re-import them. Later P1.M3 subtasks (`filterPipeline`)
  APPEND further to this same file.
- **APPEND to `test/transforms.test.ts` — it ALREADY EXISTS (84 tests green).** Add ONE new `describe` block +
  MODIFY the import line (three tokens). Reuse the fixture helpers already defined: `asst`, `asstText`, `result`,
  `user`, `custom`. Do NOT redefine any fixture or helper.

### Documentation & References

```yaml
# MUST READ — the shrink algorithm (the authoritative contract, quoted in full in the JSDoc)
- url: spec/06-context-filter.md §5 (L119-145)
  why: §5 L124-128 = the three resolveShrinkTarget matcher strategies verbatim; §5 L131-140 = the applyShrink body
       verbatim (note the IDENTICAL ternary branches → one spread expression); §5 L133 = the no-op `return messages`;
       §5 L143 = multiple-shrinks-last-wins + shrink-after-rewind no-op; §5 L145 = pairing preserved (toolCallId kept).
  critical: "§5:136-138 ternary branches are IDENTICAL ({...orig, content:[...]} both) — only the comment differs.
       Write it as ONE spread expression (DRY). The spread preserves toolCallId → pairing untouched; preserves role
       → E19 non-toolResult messages keep their role."

# MUST READ — the tier-1 test contract for THIS function (verbatim)
- url: spec/10-testing.md §1.5 (L32-35)
  why: The 3 pinned bullets: (1) by_tool_call_id match → content replaced + role/toolCallId/toolName/isError
       preserved; (2) no match → input unchanged (no-op); (3) two shrinks same target, seq order → last wins.
  critical: "Bullet 2 says 'input unchanged' — a CONTENT-equality phrasing. Returning the SAME reference is the
       strict reading + the applyShrink §5:133 precedent; assert with `toBe(msgs)` (matches the applyRewind T4.S1
       strengthening). Safe for rt.lastFiltered/mulligan_audit (content consumers)."

# MUST READ — the ShrinkTarget union + matching semantics (compaction-robustness, last-wins)
- url: spec/04-data-model.md §4 (L142-167)
  why: The canonical ShrinkTarget discriminated union (by_tool_call_id | by_tool_name+occurrence | by_content_includes)
       + ShrinkMarker shape (target, replacement). §4 L167: "targets resolve against the CURRENT event.messages each
       inference (compaction-robust)… last wins… no-op if nothing matches (silently retried)."
  critical: "markers.ts ALREADY exports this ShrinkTarget — but transforms.ts must NOT import it (Pi-free). Declare a
       LOCAL structural ShrinkTarget (identical shape) — GOTCHA #1. A real markers.ts ShrinkMarker.target assigns in
       with NO cast."

# MUST READ — edge cases E17 (last-wins) + E19 (non-toolResult keeps role) + E13 (never throws)
- url: spec/08-edge-cases.md §E17, §E19, §E13
  why: E17 = two shrinks same target → seq order, last wins (deterministic). E19 = by_content_includes matching a
       user/assistant/custom message → applyShrink replaces content but PRESERVES role. E13 = every transform must
       be total / never throw (context-handler hot path via filterPipeline).
  critical: "Last-wins needs NO special code in applyShrink — it falls out of sequential re-resolution (each applyShrink
       re-resolves against the current list; by_tool_call_id is stable because the spread preserved toolCallId) — D4.
       E13 + the {...orig} spread: a non-empty-target throwing-Proxy orig makes the spread throw → wrap in try/catch
       with a minimal {role,content} fallback — GOTCHA #5."

# REFERENCE — where applyShrink sits in the pipeline (do NOT reimplement the wrapper)
- url: spec/06-context-filter.md §1 (L9-42) + §12
  why: §1 L24 = `messages = applyShrinkSafe(messages, m)` per shrink marker (oldest-first, AFTER rewinds). §12 = the
       pipeline pseudocode. `applyShrinkSafe` is filter.ts's (P1.M4.T2) try/catch fail-open WRAPPER; the PURE fn this
       task exports is `applyShrink`.
  gotcha: "Export `applyShrink`, NOT `applyShrinkSafe`. filterPipeline (T5.S1) / filter.ts writes `m = applyShrink(m,
       marker)` (or the safe wrapper). (Same wrapper/pure split as applyRewind/applyRewindSafe in T4.S1.)"

# REFERENCE — the Pi-free module convention + MessageLike/ContentBlock (the input types)
- file: src/transforms.ts L49-58 (MessageLike) + ContentBlock type alias + L1-30 (file-header DESIGN notes)
  why: transforms.ts is Pi-FREE (0 imports) — every function uses the LOCAL structural `MessageLike[]` (a real Pi
       AgentMessage[] assigns in with no cast) + the LOCAL `ContentBlock` type. applyShrink's `newContent` is typed
       `ContentBlock[]`. Adds 0 imports.
  gotcha: "Do NOT import AgentMessage/ShrinkTarget/ShrinkMarker from Pi or markers.ts — that breaks the Pi-free
       invariant and the `grep -c '^import' → 0` gate. Declare ShrinkTarget LOCALLY (GOTCHA #1); use the structural
       `{target, replacement}` marker type (GOTCHA #2)."

# REFERENCE — the sibling applyRewind (T4.S1) precedent for the no-op same-ref + non-array→[] conventions
- file: src/transforms.ts (applyRewind, APPENDED by T4.S1)
  why: applyRewind established: non-array messages → []; empty/no-op remove → return messages SAME ref (the applyShrink
       §5:133 precedent). applyShrink MIRRORS both conventions for consistency.
  pattern: "Guard `if (!Array.isArray(messages)) return [];` first; then `if (i === null) return messages;` (same ref)."
```

### Current Codebase tree (relevant slice)

```bash
src/
  transforms.ts        # EXISTS (533 lines, 0 imports) — MessageLike, Unit, ContentBlock, partitionIntoUnits,
                       #   resolveLastToolCallGroup, resolveLastTurn, BranchEntry, resolveCheckpoint + module-private
                       #   isRecord/readOwn/assistantIssuedCall/isMulliganCustomMessage/entryMessageYield/isContextProducingType,
                       #   + applyRewind (APPENDED by T4.S1, parallel).
                       #   ← APPEND ShrinkTarget + resolveShrinkTarget + applyShrink + stringifyContent AT THE END
                       #     (after applyRewind). 0 new imports.
  markers.ts           # EXISTS — ALREADY exports ShrinkTarget + ShrinkMarker (persistence layer, Pi-coupled). DO NOT
                       #   import from here into transforms.ts (Pi-free). The LOCAL transforms.ts ShrinkTarget is
                       #   structurally identical (a real markers.ts ShrinkMarker assigns in with no cast).
test/
  transforms.test.ts   # EXISTS (84 tests green) — import L2 has partitionIntoUnits…resolveCheckpoint[+applyRewind from
                       #   T4.S1]…type Unit/MessageLike/BranchEntry; fixtures asst/asstText/result/user/custom +
                       #   expectPairingInvariant.
                       #   ← APPEND applyShrink describe block + EDIT import line (add applyShrink, resolveShrinkTarget,
                       #     type ShrinkTarget).
spec/
  06-context-filter.md # §5 = the shrink algorithm (verbatim); §1 L24 = the pipeline call site; §12 = pipeline pseudocode
  10-testing.md        # §1.5 = applyShrink tier-1 tests (3 bullets)
  08-edge-cases.md     # E13 (never throws) + E17 (last-wins) + E19 (non-toolResult keeps role)
  04-data-model.md     # §4 = ShrinkTarget union + ShrinkMarker + matching semantics
plan/001_2e5baf25fe9f/P1M3T4S2/research/verification.md  # THIS ITEM's research (gates, gotchas, spec extracts, live-state proof)
```

### Desired Codebase tree with files to be added/modified

```bash
src/transforms.ts        # MODIFY (append): + ShrinkTarget (exported type, local), + resolveShrinkTarget (exported),
                         #   + applyShrink (exported), + stringifyContent (module-private). 0 new imports.
test/transforms.test.ts  # MODIFY (append + three-token edit): + describe("applyShrink …") block;
                         #   import line += applyShrink, resolveShrinkTarget, type ShrinkTarget
# NO new files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — Declare ShrinkTarget LOCALLY in transforms.ts; do NOT import it from markers.ts. markers.ts already
//   exports ShrinkTarget, BUT markers.ts imports Pi (ExtensionAPI/ExtensionContext). Importing ShrinkTarget from
//   markers.ts into transforms.ts would make `grep -c '^import'` > 0, BREAKING the Pi-free invariant that all four
//   landed siblings + the foundational JSDoc enforce. Declare a LOCAL structural ShrinkTarget (identical shape). A
//   real markers.ts ShrinkMarker.target assigns to it with NO cast. This is EXACTLY the MessageLike convention
//   (transforms.ts defines its OWN local structural MessageLike instead of importing AgentMessage from Pi).

// GOTCHA #2 — applyShrink's marker param is a STRUCTURAL {target: ShrinkTarget; replacement: string}, NOT ShrinkMarker.
//   Using the full ShrinkMarker would require importing from markers.ts (breaks Pi-free — see #1). The structural type
//   names ONLY the two fields applyShrink reads. A real ShrinkMarker (target+replacement+id+seq+ts+reason+kind+schema+v)
//   assigns in with NO cast — excess-property checks do not apply to non-literal object assignments, so filterPipeline
//   passing a real ShrinkMarker is type-safe. Read marker fields via readOwn (throwing-Proxy safety); cast target with
//   `as ShrinkTarget` (resolveShrinkTarget re-validates isRecord internally).

// GOTCHA #3 — use MessageLike[] + ContentBlock, NOT AgentMessage[]. transforms.ts is Pi-FREE (0 imports — verified).
//   applyShrink's newContent is typed ContentBlock[] (the LOCAL type already in module scope). The task prose's
//   "AgentMessage[]" is the external-facing name; a real Pi AgentMessage[] assigns into MessageLike[] with no cast.

// GOTCHA #4 — empty/no-match → return messages UNCHANGED (SAME REFERENCE), not a fresh copy. spec/10 §1.5 bullet 2 says
//   "input unchanged" (content wording). Same-reference is the strict reading AND the spec's own pattern: applyShrink
//   does `if (i === null) return messages;` (spec/06 §5:133). It matches the applyRewind precedent (T4.S1: empty remove
//   → same ref). Assert with `expect(applyShrink(m, {target:{by_tool_call_id:"nope"}, replacement:"x"})).toBe(m)`.
//   Non-array messages → [] (NOT same-ref — a non-array input is invalid; mirrors applyRewind/partitionIntoUnits).

// GOTCHA #5 — applyShrink is the FIRST transform that CLONES a message ({...orig}). A throwing-Proxy orig with a
//   non-empty target + throwing get-trap makes {...orig} throw → would break E13 (never throws; context-handler hot
//   path). GUARD: read `role = readOwn(orig, "role")` FIRST (safe), then wrap `{...orig, content: newContent}` in
//   try/catch; on catch, build a minimal `{role: <read role>, content: newContent}` (never throws, preserves role →
//   the E19 guarantee). The fallback only fires on pathological Proxy inputs that never occur with real Pi messages;
//   its sole purpose is fail-open (never break the turn). The suite's existing throwing-Proxy fixtures use
//   `new Proxy({}, {get(){throw}})` (empty target → 0 own keys → spread reads nothing → no throw) so the PRIMARY path
//   already handles them; the try/catch belt-and-suspenders covers non-empty-target throwing-Proxies too.

// GOTCHA #6 — by_tool_name occurrence default = "last" (defensive). The ShrinkTarget type REQUIRES occurrence, but
//   readOwn returns unknown. Rule: `wantFirst = occurrence === "first"`; anything else (missing/invalid/"middle") →
//   LAST (the spec's primary example + the "most-recent bloated result" intent). Deterministic. Real markers always
//   carry a valid occurrence; this default only matters for malformed inputs.

// GOTCHA #7 — "last wins" (E17) needs NO special code in applyShrink. It falls out of sequential re-resolution: the
//   pipeline calls applyShrink once per shrink marker in seq order (spec/06 §1); each call re-resolves against the
//   CURRENT messages. For by_tool_call_id (the canonical "same target"), the first shrink's spread PRESERVED toolCallId,
//   so the second shrink matches the SAME message again and overwrites its content → last replacement survives. The
//   unit test verifies this by chaining two applyShrink calls. (For by_content_includes, "same target" = same substring;
//   if the first replacement removed the substring, the second legitimately no-ops — also correct.)

// GOTCHA #8 — by_content_includes stringification = JSON.stringify for array content (spec §5 "stringified content").
//   A toolResult's content is [{type:"text",text:"…"}]; JSON.stringify makes the text searchable (includes "ENOSPC").
//   String content → verbatim. Module-private stringifyContent wraps JSON.stringify in try/catch → "" on
//   throwing-Proxy/circular. Do NOT hand-roll a text-extractor — JSON.stringify is deterministic + sufficient.

// GOTCHA #9 — by_content_includes matches ANY role (not just toolResult). spec/06 §5 L128 "first message whose
//   stringified content includes the substring" + spec/08 E19 (matches a user/assistant/custom message → replaces
//   content, PRESERVES role). The {...orig} spread already preserves role for all messages, so E19 is satisfied for
//   free. Do NOT add a role guard to by_content_includes.

// GOTCHA #10 — Export `applyShrink`, NOT `applyShrinkSafe`. spec/06 §1 pipeline pseudocode writes `applyShrinkSafe`
//   (the filter.ts WRAPPER, P1.M4.T2, that try/catch + fail-opens). The canonical PURE name (spec/06 §5, §10 §1.5,
//   this task) is `applyShrink`. (Same wrapper/pure split as applyRewind/applyRewindSafe in T4.S1.)

// GOTCHA #11 — the matched message's {...orig} spread + content override is uniform for ALL roles (the spec §5:136-138
//   ternary branches are IDENTICAL). Do NOT branch on role. ONE expression: `{...orig, content: newContent}`. The
//   spread preserves role/toolCallId/toolName/isError/customType/… → pairing intact (toolResult keeps toolCallId) +
//   role preserved (E19). Branching would be dead code.

// GOTCHA #12 — non-matched messages are copied BY REFERENCE via .map (never read/spread). So a throwing-Proxy element
//   at a DIFFERENT index is harmless (it is only ever placed into the result array by reference). Only the MATCHED
//   message gets spread — and that is the try/catch fallback case (GOTCHA #5).
```

---

## Implementation Blueprint

### Data models and structure

ONE new EXPORTED type (`ShrinkTarget`) + ONE module-private helper (`stringifyContent`). `ShrinkTarget` is a local
structural declaration (GOTCHA #1) — no imports. `resolveShrinkTarget` + `applyShrink` reuse the EXPORTED `MessageLike`
+ the LOCAL `ContentBlock` + the module-private `isRecord`/`readOwn` already in scope.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: APPEND ShrinkTarget + resolveShrinkTarget + applyShrink + stringifyContent to src/transforms.ts
  - IMPLEMENT: `export type ShrinkTarget = …` (LOCAL structural union — GOTCHA #1; verbatim below).
  - IMPLEMENT: `export function resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null`
      (the three matcher strategies; verbatim code below).
  - IMPLEMENT: `export function applyShrink(messages: MessageLike[], marker: { target: ShrinkTarget; replacement:
      string }): MessageLike[]` (verbatim code below; the {...orig} spread is wrapped in try/catch — GOTCHA #5).
  - IMPLEMENT: `function stringifyContent(content: unknown): string` (module-private; verbatim below).
  - REUSE (do NOT redefine/import): MessageLike, ContentBlock, isRecord, readOwn — already in module scope.
  - NAMING: ShrinkTarget (exported type), resolveShrinkTarget + applyShrink (exported fns), stringifyContent
      (module-private), messages/target/marker params.
  - PLACEMENT: append at the END of src/transforms.ts (after applyRewind, the T4.S1 tail).
  - VERIFY: `grep -c '^import' src/transforms.ts` → 0 (no new imports).

Task 2: APPEND applyShrink tests + EDIT the import line in test/transforms.test.ts
  - EDIT import line (L2): insert `applyShrink, resolveShrinkTarget,` after `applyRewind,` and append
      `, type ShrinkTarget` after `type BranchEntry`. Target result line:
      `import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, applyRewind,
      applyShrink, resolveShrinkTarget, type Unit, type MessageLike, type BranchEntry, type ShrinkTarget } from
      "../src/transforms.js";`
      (If applyRewind is not yet present because T4.S1 hasn't merged, just ensure all SEVEN named symbols +
      the FOUR types are present in the destructure; intra-line order is immaterial.)
  - ADD: `describe("applyShrink — spec/10 §1.5 PINNED contract + three matchers + defensive + composition", …)`
      with the verbatim tests below (the 3 pinned bullets + the three matchers + E19 non-toolResult + defensive +
      throwing-Proxy + last-wins composition + purity + types).
  - REUSE (do NOT redefine): fixtures asst/asstText/result/user/custom (all already defined in the test file).
  - FOLLOW pattern: the existing describe blocks' style (spec-section pinning in the title, one it() per case).
  - COVERAGE: spec/10 §1.5 (3 bullets) + three matcher strategies + E19 + E13 + E17 last-wins + purity + types.
  - PLACEMENT: append at the END of test/transforms.test.ts.

Task 3: VALIDATE (no code)
  - RUN: `npx tsc --noEmit -p tsconfig.json` → exit 0.
  - RUN: `npx vitest run test/transforms.test.ts` → all green (existing 84 + new block).
  - RUN: `npx vitest run` → all green, no regression in any suite (371+ tests across 9 files).
  - RUN: `grep -c '^import' src/transforms.ts` → 0.
```

### Implementation Patterns & Key Details

```typescript
// ───────────── APPEND TO src/transforms.ts (verbatim) ─────────────
// APPEND AFTER applyRewind (the T4.S1 tail). REUSE MessageLike + ContentBlock + isRecord + readOwn (in scope).
// ZERO new imports (the file is Pi-free; `grep -c '^import'` stays 0).

/**
 * ShrinkTarget — how a shrink identifies the message whose content to substitute (spec/04-data-model.md §4;
 * spec/06-context-filter.md §5). Discriminated union; resolveShrinkTarget resolves it LIVE each inference against
 * the current event.messages (compaction-robust — spec/04 §4 "targets resolve against the current messages each
 * inference"). STRUCTURALLY IDENTICAL to markers.ts's ShrinkTarget (a real markers.ts ShrinkTarget / ShrinkMarker.target
 * assigns in with NO cast) — declared LOCALLY here so transforms.ts stays Pi-FREE (0 imports; it must NOT import from
 * markers.ts, which pulls in Pi). This mirrors the MessageLike convention (a local structural type, not AgentMessage).
 * EXPORTED so the shrink tool (P1.M5.T2), filterPipeline (T5.S1), and tests share one shape at the pure tier.
 */
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };

/**
 * resolveShrinkTarget — resolve a ShrinkTarget to a single message index, LIVE against the current messages
 * (spec/06-context-filter.md §5; spec/04-data-model.md §4). Returns the matched index or null (no match → the
 * shrink no-ops this fire and retries next fire — compaction-robust; spec/06 §5:133, spec/04 §4).
 *
 * MATCHER STRATEGIES (spec/06 §5 L126-128):
 *   - by_tool_call_id: return the index of the FIRST toolResult message whose `toolCallId === id` (toolCallId is
 *     unique → at most one), else null.
 *   - by_tool_name + occurrence: among toolResult messages whose `toolName === name`, return the LAST index
 *     (occurrence:"last", the default for any non-"first" value — GOTCHA #6) or the FIRST index (occurrence:"first"),
 *     else null.
 *   - by_content_includes: return the index of the FIRST message (ANY role — spec/08 E19) whose stringified `content`
 *     includes the substring (stringifyContent: string→verbatim, array→JSON.stringify), else null.
 *
 * The FIRST present non-empty-string discriminator key decides the variant (by_tool_call_id → by_tool_name →
 * by_content_includes); a target with no recognizable discriminator, or a non-string/empty id/name, resolves to null.
 *
 * Pure + defensive: a non-array `messages` → null; a non-record `target` → null; malformed messages, throwing-Proxy
 * messages, and non-string/empty discriminator values are all handled gracefully — NEVER throws (E13; context-handler
 * hot path via filterPipeline T5.S1). Every field read goes through the module-private isRecord/readOwn.
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → null
 * @param target the ShrinkTarget (discriminated union); non-record → null
 * @returns the matched message index, or null when nothing matches
 */
export function resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null {
  if (!Array.isArray(messages)) return null;
  if (!isRecord(target)) return null;

  // by_tool_call_id: first toolResult whose toolCallId === id (unique → at most one).
  const callId = readOwn(target, "by_tool_call_id");
  if (typeof callId === "string" && callId.length > 0) {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!isRecord(m) || readOwn(m, "role") !== "toolResult") continue;
      if (readOwn(m, "toolCallId") === callId) return i;
    }
    return null;
  }

  // by_tool_name + occurrence: among toolResults with toolName === name, last (default) or first index.
  const name = readOwn(target, "by_tool_name");
  if (typeof name === "string" && name.length > 0) {
    const wantFirst = readOwn(target, "occurrence") === "first"; // anything else (incl. missing) → last (GOTCHA #6)
    let found = -1;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!isRecord(m) || readOwn(m, "role") !== "toolResult") continue;
      if (readOwn(m, "toolName") === name) {
        if (wantFirst) return i; // first match wins immediately
        found = i;               // keep scanning → last match wins
      }
    }
    return found === -1 ? null : found;
  }

  // by_content_includes: first message (ANY role — E19) whose stringified content includes the substring.
  const needle = readOwn(target, "by_content_includes");
  if (typeof needle === "string") {
    for (let i = 0; i < messages.length; i++) {
      if (stringifyContent(readOwn(messages[i], "content")).includes(needle)) return i;
    }
    return null;
  }

  return null; // no recognizable discriminator key
}

/**
 * applyShrink — substitute the matched message's content with a compact replacement (spec/06-context-filter.md §5).
 * The replacement PERSISTS for as long as the marker exists (permanent soft substitution). SHRINKS DO NOT REMOVE
 * MESSAGES — they replace content, preserving role/toolCallId/toolName/isError (and every other field via the
 * spread) so the model API stays valid: a toolResult KEEPS its toolCallId → its assistant call stays paired
 * (spec/06 §5:145 "pairing untouched"); a non-toolResult keeps its role (spec/08 E19).
 *
 * ALGORITHM (spec/06 §5 L131-140):
 *   1. i = resolveShrinkTarget(messages, marker.target). null (or out of range) → return messages UNCHANGED (SAME
 *      reference) — the documented no-op (spec/06 §5:133). This is ALSO the "shrink-after-rewind-removed-target"
 *      no-op (spec/06 §5:143) and the compaction-removed-target no-op (spec/04 §4 — retried next fire).
 *   2. replacement = { ...orig, content: [{ type:"text", text: replacement }] }. The spread preserves EVERY other
 *      field (role, toolCallId, toolName, isError, customType, …). The spec's §5:136-138 ternary has IDENTICAL
 *      branches (both spread orig + override content — only the comment differs); written as ONE expression here
 *      (DRY — GOTCHA #11). Wrapped in try/catch: a throwing-Proxy orig could make {...orig} throw → minimal fallback
 *      {role, content} (never throws, preserves role — E13 + E19 — GOTCHA #5).
 *   3. Return a NEW array with index i replaced (messages.map). Non-matched elements copied BY REFERENCE (never
 *      read/spread → throwing-Proxy-safe — GOTCHA #12).
 *
 * COMPOSITION (spec/06 §5:143, spec/08 E17): "Multiple shrinks same target → applied in seq order, last wins." This
 * is achieved NATURALLY by sequential application — NO special last-wins code (GOTCHA #7): each applyShrink
 * re-resolves against the CURRENT messages (the second call sees the already-shrunk message), matches it again
 * (by_tool_call_id is stable — the spread preserved toolCallId), and overwrites its content → last replacement wins.
 *
 * CONTRACT (spec/06 §1 pipeline, `messages = applyShrinkSafe(messages, m)`; filterPipeline T5.S1 calls THIS fn):
 *   - INPUT: `messages` (a real Pi AgentMessage[] assigns in with no cast via MessageLike[]), `marker`
 *     ({target: ShrinkTarget, replacement: string} — a real markers.ts ShrinkMarker assigns in with NO cast; only the
 *     two fields applyShrink reads are in the structural type — GOTCHA #2). NO import from markers.ts (Pi-free).
 *   - NO MATCH (resolve returns null, marker is a non-record, or messages is a non-array) → messages UNCHANGED
 *     (SAME reference) for the null/marker paths; non-array messages → [] (defensive, mirrors applyRewind/
 *     partitionIntoUnits — GOTCHA #4).
 *
 * Pure + defensive + TOTAL: non-array messages → []; non-record marker → messages unchanged; no match → messages
 * unchanged (same ref); a throwing-Proxy MATCHED message → the {...orig} spread is try/caught with a minimal fallback
 * → NEVER throws (E13). Side-effect-free (never mutates `messages`). NO new imports (reuses MessageLike + ContentBlock
 * + isRecord/readOwn already in module scope; `grep -c '^import' src/transforms.ts` stays 0).
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param marker { target: ShrinkTarget; replacement: string } (a real ShrinkMarker assigns in with no cast)
 * @returns a NEW array with the matched message's content substituted; the SAME array reference on a no-op
 */
export function applyShrink(
  messages: MessageLike[],
  marker: { target: ShrinkTarget; replacement: string },
): MessageLike[] {
  // Defensive: non-array messages → [] (mirrors applyRewind/partitionIntoUnits); non-record marker → no-op (same ref).
  if (!Array.isArray(messages)) return [];
  if (!isRecord(marker)) return messages;

  // Resolve the target (read marker.target via readOwn for throwing-Proxy safety; cast — resolveShrinkTarget
  // re-validates isRecord). null/out-of-range → no-op, SAME reference (spec/06 §5:133).
  const i = resolveShrinkTarget(messages, readOwn(marker, "target") as ShrinkTarget);
  if (i === null || i < 0 || i >= messages.length) return messages;

  const orig = messages[i];
  const rep = readOwn(marker, "replacement");
  const text = typeof rep === "string" ? rep : "";
  const newContent: ContentBlock[] = [{ type: "text", text }];

  // Clone orig's fields via spread + override content. {...orig} preserves role/toolCallId/toolName/isError/customType/…
  // → pairing intact (toolResult keeps toolCallId — spec/06 §5:145) + role preserved (spec/08 E19). The spec §5 ternary
  // has identical branches → ONE expression (GOTCHA #11). try/catch: a throwing-Proxy orig could make {...orig} throw
  // → minimal fallback preserves the safely-read role (E13 + E19 — GOTCHA #5).
  const role = readOwn(orig, "role");
  let replacement: MessageLike;
  try {
    replacement = { ...(orig as MessageLike), content: newContent };
  } catch {
    replacement = { role: typeof role === "string" ? role : undefined, content: newContent };
  }

  // New array with index i replaced; other elements copied BY REFERENCE (never read → throwing-Proxy-safe — GOTCHA #12).
  return messages.map((m, j) => (j === i ? replacement : m));
}

/**
 * Module-private: stringify a message's `content` for by_content_includes substring search (spec/06 §5 L128
 * "stringified content"). A string content → verbatim; an array content (content blocks) → JSON.stringify (so `text`
 * fields are searchable, e.g. `[{"type":"text","text":"ENOSPC at /disk"}]` includes "ENOSPC"); anything else
 * (undefined / throwing-Proxy / circular) → "". Wrapped in try/catch → never throws (JSON.stringify of a
 * throwing-Proxy/circular value returns "" via the catch). NOT exported.
 */
function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return "";
    }
  }
  return "";
}
```

```typescript
// ───────────── APPEND TO test/transforms.test.ts (verbatim) ─────────────
// (Also EDIT L2 import — see Task 2.) REUSE the existing fixtures: asst, asstText, result, user, custom.
// Do NOT redefine any fixture or helper. A local textOf() helper is defined inside the describe for readable content
// assertions (the existing fixtures' content is {type:"text",text:"…"}[] or a string).

describe("applyShrink — spec/10 §1.5 PINNED contract + three matchers + defensive + composition", () => {
  /** Read the first text block's text from a shrunk message (content is [{type:"text",text}] after applyShrink). */
  const textOf = (m: MessageLike): string => {
    const c = m.content;
    if (Array.isArray(c) && c.length > 0) {
      const first = c[0] as { text?: unknown };
      return typeof first.text === "string" ? first.text : "";
    }
    return "";
  };

  it("spec/10 §1.5 bullet 1 — by_tool_call_id match → content replaced, role/toolCallId/toolName/isError PRESERVED", () => {
    const bloated: MessageLike = {
      ...result("call-A"), toolName: "grep", isError: false, content: [{ type: "text", text: "BLOATED OUTPUT" }],
    };
    const msgs: MessageLike[] = [user("u"), asst("call-A"), bloated];
    const out = applyShrink(msgs, { target: { by_tool_call_id: "call-A" }, replacement: "[shrunk]" });
    expect(out).toHaveLength(3);
    expect(textOf(out[2])).toBe("[shrunk]");        // content replaced
    expect(out[2].role).toBe("toolResult");         // preserved
    expect(out[2].toolCallId).toBe("call-A");       // preserved → pairing untouched (spec/06 §5:145)
    expect(out[2].toolName).toBe("grep");           // preserved
    expect(out[2].isError).toBe(false);             // preserved
    expect(out[0]).toBe(msgs[0]);                   // others untouched (by reference)
    expect(out[1]).toBe(msgs[1]);
  });

  it("spec/10 §1.5 bullet 2 — no match → input UNCHANGED — SAME reference (no-op; spec/06 §5:133)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    // Intentional strengthening: spec says "input unchanged" (content); same-ref is the strict reading + the §5:133
    // precedent (and the applyRewind T4.S1 convention).
    expect(applyShrink(msgs, { target: { by_tool_call_id: "nope" }, replacement: "x" })).toBe(msgs);
    expect(applyShrink(msgs, { target: { by_tool_name: "absent", occurrence: "last" }, replacement: "x" })).toBe(msgs);
    expect(applyShrink(msgs, { target: { by_content_includes: "not-present-anywhere" }, replacement: "x" })).toBe(msgs);
  });

  it("spec/10 §1.5 bullet 3 — two shrinks same target, seq order → LAST wins (spec/08 E17)", () => {
    const msgs: MessageLike[] = [
      user("u"), asst("c"), { ...result("c"), content: [{ type: "text", text: "BIG" }] },
    ];
    // Sequential application: the first shrink preserves toolCallId "c", so the second re-matches the same message.
    const once = applyShrink(msgs, { target: { by_tool_call_id: "c" }, replacement: "first" });
    expect(textOf(once[2])).toBe("first");
    const twice = applyShrink(once, { target: { by_tool_call_id: "c" }, replacement: "second" });
    expect(textOf(twice[2])).toBe("second");        // last wins
    expect(twice[2].toolCallId).toBe("c");          // still paired after both substitutions
  });

  it("by_tool_name + occurrence 'last' (default) → LAST matching toolResult substituted; earlier ones untouched", () => {
    const r1: MessageLike = { ...result("c1"), toolName: "grep", content: [{ type: "text", text: "r1" }] };
    const r2: MessageLike = { ...result("c2"), toolName: "grep", content: [{ type: "text", text: "r2" }] };
    const other: MessageLike = { ...result("c3"), toolName: "read", content: [{ type: "text", text: "ro" }] };
    const msgs: MessageLike[] = [user("u"), asst("c1"), r1, asst("c2"), r2, asst("c3"), other];
    const out = applyShrink(msgs, { target: { by_tool_name: "grep", occurrence: "last" }, replacement: "L" });
    expect(textOf(out[4])).toBe("L");               // the LAST grep result (index 4)
    expect(textOf(out[2])).toBe("r1");              // the FIRST grep result untouched
    expect(textOf(out[6])).toBe("ro");              // the non-grep result untouched
  });

  it("by_tool_name + occurrence 'first' → FIRST matching toolResult substituted", () => {
    const r1: MessageLike = { ...result("c1"), toolName: "grep", content: [{ type: "text", text: "r1" }] };
    const r2: MessageLike = { ...result("c2"), toolName: "grep", content: [{ type: "text", text: "r2" }] };
    const msgs: MessageLike[] = [user("u"), asst("c1"), r1, asst("c2"), r2];
    const out = applyShrink(msgs, { target: { by_tool_name: "grep", occurrence: "first" }, replacement: "F" });
    expect(textOf(out[2])).toBe("F");               // the FIRST grep result (index 2)
    expect(textOf(out[4])).toBe("r2");              // the LAST grep result untouched
  });

  it("by_content_includes → FIRST message (any role) whose stringified content includes the substring", () => {
    const big: MessageLike = { ...result("c"), content: [{ type: "text", text: "error: ENOSPC at /disk" }] };
    const msgs: MessageLike[] = [user("hello"), asst("c"), big];
    const out = applyShrink(msgs, { target: { by_content_includes: "ENOSPC" }, replacement: "[err]" });
    expect(textOf(out[2])).toBe("[err]");           // the toolResult at index 2 matched
    expect(out[2].role).toBe("toolResult");
  });

  it("spec/08 E19 — by_content_includes matches a NON-toolResult (user) → content replaced, role PRESERVED", () => {
    const msgs: MessageLike[] = [user("find this token please"), asst("c"), result("c")];
    const out = applyShrink(msgs, { target: { by_content_includes: "token" }, replacement: "[redacted]" });
    expect(textOf(out[0])).toBe("[redacted]");      // the user message at index 0 matched
    expect(out[0].role).toBe("user");               // role PRESERVED (E19) — not turned into a toolResult
  });

  it("resolveShrinkTarget direct: returns the matched index (number) or null per matcher", () => {
    const msgs: MessageLike[] = [
      user("u"), asst("c1"), { ...result("c1"), toolName: "grep" }, asst("c2"),
      { ...result("c2"), toolName: "grep" },
    ];
    expect(resolveShrinkTarget(msgs, { by_tool_call_id: "c2" })).toBe(4);
    expect(resolveShrinkTarget(msgs, { by_tool_call_id: "absent" })).toBeNull();
    expect(resolveShrinkTarget(msgs, { by_tool_name: "grep", occurrence: "first" })).toBe(2);
    expect(resolveShrinkTarget(msgs, { by_tool_name: "grep", occurrence: "last" })).toBe(4);
    expect(resolveShrinkTarget(msgs, { by_tool_name: "absent", occurrence: "last" })).toBeNull();
    expect(resolveShrinkTarget(msgs, { by_content_includes: "u" })).toBe(0); // user("u") stringified includes "u"
  });

  it("defensive: non-array messages → []; non-record marker → unchanged (same ref); malformed target → no-op", () => {
    expect(applyShrink(null as unknown as MessageLike[], { target: { by_tool_call_id: "x" }, replacement: "r" })).toEqual([]);
    const msgs: MessageLike[] = [user("u")];
    expect(applyShrink(msgs, null as unknown as { target: ShrinkTarget; replacement: string })).toBe(msgs);
    // No discriminator key → no match → unchanged (same ref).
    expect(applyShrink(msgs, { target: {} as ShrinkTarget, replacement: "r" })).toBe(msgs);
    // resolveShrinkTarget defensive: non-array messages → null; non-record target → null; empty id/name → null.
    expect(resolveShrinkTarget(null as unknown as MessageLike[], { by_tool_call_id: "x" })).toBeNull();
    expect(resolveShrinkTarget(msgs, null as unknown as ShrinkTarget)).toBeNull();
    expect(resolveShrinkTarget(msgs, { by_tool_call_id: "" } as ShrinkTarget)).toBeNull();
    expect(resolveShrinkTarget(msgs, { by_tool_name: "", occurrence: "last" } as ShrinkTarget)).toBeNull();
  });

  it("spec/08 E13 — NEVER throws: throwing-Proxy messages never crash resolveShrinkTarget or applyShrink", () => {
    // A throwing-Proxy with a NON-EMPTY target + throwing get-trap (the hard case for {...orig} spread): the
    // spread enumerates the target's keys [role,content] and calls get → throws → the try/catch fallback fires.
    // (Standard form — same as the existing suite's resolveCheckpoint throwing-Proxy fixtures.)
    const trap = new Proxy(
      { role: "user", content: "bloated" } as MessageLike,
      { get() { throw new Error("trap"); } },
    );
    // resolveShrinkTarget never throws on it (all reads via readOwn; stringifyContent catches JSON.stringify throws).
    expect(() => resolveShrinkTarget([trap], { by_content_includes: "" })).not.toThrow();
    // applyShrink where a throwing-Proxy is PRESENT but NOT matched → copied by reference via .map, never read.
    const msgs1: MessageLike[] = [user("keep"), trap];
    expect(() => applyShrink(msgs1, { target: { by_content_includes: "keep" }, replacement: "r" })).not.toThrow();
    // applyShrink where the throwing-Proxy IS matched (empty needle matches empty stringified content) → spread is
    // try/caught → minimal fallback → never throws, content replaced.
    expect(() => applyShrink([trap], { target: { by_content_includes: "" }, replacement: "r" })).not.toThrow();
    const out = applyShrink([trap], { target: { by_content_includes: "" }, replacement: "r" });
    expect(out).toHaveLength(1);
    expect(textOf(out[0])).toBe("r");               // fallback still replaced content (role read safely before spread)
  });

  it("purity: never mutates the input array (map returns a new array; no-op returns the same unmuted ref)", () => {
    const bloated: MessageLike = { ...result("c"), content: [{ type: "text", text: "BIG" }] };
    const msgs: MessageLike[] = [user("u"), asst("c"), bloated];
    const snapshot = msgs.map((m) => ({ ...m }));
    applyShrink(msgs, { target: { by_tool_call_id: "c" }, replacement: "x" });
    applyShrink(msgs, { target: { by_tool_call_id: "nope" }, replacement: "x" }); // no-op
    expect(msgs).toHaveLength(3);                    // input untouched
    expect(msgs[2]).toBe(bloated);                   // input element reference untouched
    expect((msgs[2].content as { text: string }[])[0].text).toBe("BIG"); // input content not mutated
    expect(msgs.map((m) => m.role)).toEqual(snapshot.map((m) => m.role));
  });

  it("returns MessageLike[] (resolveShrinkTarget returns number | null)", () => {
    expectTypeOf(applyShrink([], { target: { by_tool_call_id: "x" }, replacement: "r" })).toEqualTypeOf<MessageLike[]>();
    expectTypeOf(applyShrink([user("u")], { target: { by_tool_call_id: "x" }, replacement: "r" })).toEqualTypeOf<MessageLike[]>();
    expectTypeOf(resolveShrinkTarget([], { by_tool_call_id: "x" })).toEqualTypeOf<number | null>();
  });
});
```

### Integration Points

```yaml
MODULE (src/transforms.ts):
  - append: "export type ShrinkTarget + export function resolveShrinkTarget + export function applyShrink + function
    stringifyContent (module-private) at END of file (after applyRewind, the T4.S1 tail)"
  - imports: "ZERO new imports (reuse MessageLike + ContentBlock + isRecord/readOwn in module scope); grep -c '^import' → 0"

TEST (test/transforms.test.ts):
  - edit import L2: "add `applyShrink, resolveShrinkTarget,` (after applyRewind) and `, type ShrinkTarget` (after type BranchEntry)"
  - append: "describe('applyShrink — spec/10 §1.5 PINNED contract + three matchers + defensive + composition', …) at END of file"

DOWNSTREAM CONSUMER (NOT this task — P1.M3.T5.S1 filterPipeline / P1.M4.T2 filter.ts):
  - call site: "messages = applyShrink(messages, marker);  // per shrink marker, oldest-first, AFTER rewinds (spec/06 §1 L24)"
  - wrapper:   "filter.ts wraps this in applyShrinkSafe (try/catch fail-open) — the PURE fn is applyShrink (GOTCHA #10)"
  - note: "filterPipeline passes a real markers.ts ShrinkMarker; it assigns into the structural {target, replacement} param
    with NO cast (GOTCHA #2). resolveShrinkTarget re-resolves each fire against the CURRENT messages (compaction-robust)."
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending the symbols — fix before proceeding
npx tsc --noEmit -p tsconfig.json   # Type check the whole project (the symbols are in src/transforms.ts)
# Expected: exit 0 (no errors). If errors exist, READ the output and fix before proceeding.

# Pi-free invariant (the module's foundational constraint)
grep -c '^import' src/transforms.ts
# Expected: 0. If >0, you accidentally imported something (e.g. ShrinkTarget/ShrinkMarker from markers.ts) — remove it;
# declare ShrinkTarget LOCALLY (GOTCHA #1) and use the structural {target, replacement} marker type (GOTCHA #2).
```

> This project has NO linter/formatter configured (no eslint/ruff/prettier in package.json) — the gates are
> `tsc` (type check) + `vitest` (tests) + the `grep -c '^import' → 0` Pi-free invariant. Do NOT invent lint commands.

### Level 2: Unit Tests (Component Validation)

```bash
# Test applyShrink / resolveShrinkTarget (and the whole transforms suite — append-only, so no regression)
npx vitest run test/transforms.test.ts
# Expected: ALL green (the existing 84 tests + the new applyShrink block). If failing, debug root cause and fix.

# Full test suite (no regression in any other suite — ledger/tokens/notes/config/log/runtime/markers/tools)
npx vitest run
# Expected: all green (371+ tests across 9 files).
```

### Level 3: Integration Testing (System Validation)

```bash
# applyShrink / resolveShrinkTarget are PURE helpers with NO Pi dependency, so there is no service to start / endpoint.
# Their "integration" is their composition — already covered by the spec/10 §1.5 bullet-3 test (two sequential
# applyShrink calls on the same target → last wins) and the three-matcher tests.

# (Optional) sanity-build the project to confirm the dist compiles (the extension entry is src/index.ts):
npx tsc -p tsconfig.json
# Expected: dist/ builds cleanly (exit 0). This is NOT required for this task (pure-helper), but confirms no
# breakage downstream.

# Expected: pure helpers compile + all tests green. No service/endpoint/MCP/database integration for this item.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Pairing-invariant spot check (the cardinal rule — spec/06 §5:145, api_verification.md §6.4): shrink a toolResult by
# by_tool_call_id, then assert the result KEEPS its toolCallId (so its assistant call stays paired) AND its role.
npx vitest run test/transforms.test.ts -t "by_tool_call_id match → content replaced, role/toolCallId/toolName/isError PRESERVED"
# Expected: 1 test passed.

# Last-wins spot check (spec/08 E17): two shrinks same target, seq order → last wins:
npx vitest run test/transforms.test.ts -t "two shrinks same target, seq order → LAST wins"
# Expected: 1 test passed.

# Never-throws spot check (spec/08 E13): throwing-Proxy messages never crash resolve/apply:
npx vitest run test/transforms.test.ts -t "NEVER throws: throwing-Proxy messages"
# Expected: 1 test passed.

# Expected: pairing intact, last-wins, never-throws. (No perf/security/load gates for a 1.5-pt pure helper.)
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed successfully
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npx vitest run` is all-green (no regression; new applyShrink block passes)
- [ ] `grep -c '^import' src/transforms.ts` → **0** (Pi-free invariant preserved)

### Feature Validation

- [ ] All success criteria from "What" section met
- [ ] spec/10 §1.5 bullet 1 (by_tool_call_id: content replaced + role/toolCallId/toolName/isError preserved) — test green
- [ ] spec/10 §1.5 bullet 2 (no match → unchanged, same ref) — test green
- [ ] spec/10 §1.5 bullet 3 (two shrinks same target → last wins) — test green
- [ ] Three matcher strategies (by_tool_call_id / by_tool_name+occurrence / by_content_includes) — tests green
- [ ] spec/08 E19 (by_content_includes on a non-toolResult preserves role) — test green
- [ ] Defensive cases (non-array messages/marker, malformed target, throwing-Proxy) never throw — tests green

### Code Quality Validation

- [ ] Follows existing codebase patterns (pure, defensive, total, JSDoc-pinned to spec sections — mirrors the siblings)
- [ ] File placement matches the desired tree (append to src/transforms.ts + test/transforms.test.ts; no new files)
- [ ] Anti-patterns avoided (see below)
- [ ] ZERO new imports (reuses MessageLike/ContentBlock/isRecord/readOwn; declares ShrinkTarget LOCALLY — does not
      import AgentMessage/ShrinkTarget/ShrinkMarker from Pi or markers.ts)
- [ ] applyShrink substitutes content only — does NOT reimplement filterPipeline/protectedOk/applyShrinkSafe logic

### Documentation & Deployment

- [ ] Code is self-documenting (JSDoc pins spec/06 §5 + spec/04 §4 + spec/08 E13/E17/E19 + the applyShrink §5:133 precedent)
- [ ] The `applyShrink` vs `applyShrinkSafe` naming divergence is documented in JSDoc (prevents a future implementer
      from "fixing" the name — GOTCHA #10)
- [ ] The LOCAL ShrinkTarget vs markers.ts ShrinkTarget decision is documented (GOTCHA #1) — prevents a future
      implementer from "DRY-ing" it into an import that breaks Pi-free
- [ ] No new environment variables or config (pure helper)

---

## Anti-Patterns to Avoid

- ❌ Don't import `ShrinkTarget`/`ShrinkMarker` from `markers.ts` (or `AgentMessage` from Pi) — it breaks the Pi-free
  invariant and the `grep -c '^import' → 0` gate. Declare `ShrinkTarget` LOCALLY (structurally identical); use the
  structural `{target, replacement}` marker type (GOTCHA #1, #2).
- ❌ Don't branch on `role` inside applyShrink's replacement construction — the spec §5:136-138 ternary branches are
  IDENTICAL; write ONE `{...orig, content}` expression (GOTCHA #11). Branching is dead code.
- ❌ Don't return a fresh copy on a no-match — return the SAME reference (`if (i === null) return messages;` — spec/06
  §5:133; the applyRewind T4.S1 precedent). A fresh copy would still pass content checks but breaks the intentional
  `toBe(msgs)` strengthening.
- ❌ Don't add a `role` guard to `by_content_includes` — it matches ANY role (spec/06 §5 L128; spec/08 E19); the spread
  already preserves role for non-toolResults.
- ❌ Don't hand-roll a text-extractor for `by_content_includes` — `JSON.stringify` the array content is deterministic +
  sufficient (GOTCHA #8). Hand-rolling risks inconsistency + throws.
- ❌ Don't add special "last wins" logic inside `applyShrink` — it falls out of sequential re-resolution (GOTCHA #7);
  the pipeline (not this function) applies shrinks in seq order.
- ❌ Don't leave the `{...orig}` spread unguarded — a throwing-Proxy `orig` could throw (E13). Wrap in try/catch with a
  minimal `{role, content}` fallback (GOTCHA #5). Reading `role` via `readOwn` BEFORE the spread is the key.
- ❌ Don't name it `applyShrinkSafe` (the spec/06 §1 pipeline pseudocode wrapper name) — the canonical/exported PURE name
  is `applyShrink` (GOTCHA #10). `applyShrinkSafe` is filter.ts's (P1.M4.T2) try/catch wrapper.
- ❌ Don't call `protectedOk`/`partitionIntoUnits`/a resolver INSIDE applyShrink — shrinks substitute content only; they
  never remove messages or cross protected boundaries. `protectedOk` is `filterPipeline`'s rewind-only concern.
- ❌ Don't skip the throwing-Proxy test — it PROVES applyShrink never throws on the MATCHED message's spread (the
  try/catch fallback), which is this function's distinctive safety property vs the index-only `applyRewind`.