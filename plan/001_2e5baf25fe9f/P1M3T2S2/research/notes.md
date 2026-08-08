# Research Notes — P1.M3.T2.S2 `resolveLastTurn`

> Supporting notes for `plan/001_2e5baf25fe9f/P1M3T2S2/PRP.md`. Keep the PRP as the authoritative spec; this file
> records the resolution of every open detail so the PRP's decisions are traceable.

## 0. Verified live state (run before writing the PRP)

- `src/transforms.ts` EXISTS and exports `partitionIntoUnits`, `Unit`, `MessageLike`; module-private `isRecord`,
  `readOwn`, `ToolCallContent`, `ContentBlock`. (T1.S1 has LANDED — the file is real, not hypothetical.)
- `test/transforms.test.ts` EXISTS with fixtures `asst(...callIds)`, `asstText(text)`, `result(toolCallId)`,
  `user(text)`, `custom(customType)`, `summary(units)`, `expectPairingInvariant(messages, units)`.
- `resolveLastToolCallGroup` / `assistantIssuedCall` are NOT yet in the file (S1 = parallel sibling, in flight).
  Both are referenced only in the file's docstring comments (lines ~15, ~25) as "later P1.M3 subtasks".
- `npx tsc --noEmit -p tsconfig.json` → exit 0. `npx vitest run` → 7 files, 246 tests, all green.
- NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only). The gate is `tsc` + `vitest`.
- tsconfig: `strict`, `noImplicitAny`, NO `noUnusedParameters`/`noUnusedLocals`.

## 1. The spec algorithm (spec/06-context-filter.md §4 — verbatim source of truth)

Signature + algorithm (steps 1–4) reproduced in the PRP. The decisive rules:
- A **turn** = a user message + everything after it until the next user message. `iLastUser` = last `role:"user"`.
- **Default** (`to_previous_prompt !== true`): keep the user message; remove every index `j > iLastUser` EXCEPT
  (a) the rewind's own unit (assistant that issued `excludeToolCallId` + its results) and (b) any `mulligan:*`
  custom messages at the tail. `remove = { j : j > iLastUser AND j ∉ rewindOwnUnit AND not mulligan:* }`.
- **Nuclear** (`to_previous_prompt === true`): also remove `iLastUser`. Refused if `iLastUser === iFirstUser`.
- Pairing note (§4 pt 4): removal operates via `partitionIntoUnits` → removed assistant+results stay paired.

## 2. Design decisions (D1–D9) — each resolves an open detail

### D1 — opts field name is `to_previous_prompt` (snake_case), NOT `toPreviousPrompt`
- **Contract** (item_description §2): `opts: { to_previous_prompt?: boolean }` — snake_case, authoritative.
- **Data model** (spec/04 §3 `RewindMarker.options`): `{ to_previous_prompt?: boolean; protect?: string[] }` — snake_case.
- **filterPipeline** (spec/06 §12): `resolveLastTurn(m, rw.options, rw.excludeToolCallId)` — passes `rw.options`
  VERBATIM. So the function MUST read the snake_case field or it never sees nuclear mode.
- spec/06 §4's signature writes `toPreviousPrompt` — that is a **spec typo**; the contract + data model +
  pipeline all agree on snake_case. The function reads `opts?.to_previous_prompt === true`.

### D2 — resolveLastTurn takes `messages` (NOT `units`) and calls partitionIntoUnits internally
- spec/06 §4 + the contract signature: `resolveLastTurn(messages, opts, excludeToolCallId)`. Contrast
  `resolveLastToolCallGroup(units, messages, excludeToolCallId)` (S1) which takes pre-partitioned units.
- Reason: the rewindOwnUnit must be found by partitioning, and the contract pins the messages-first signature.
- So `resolveLastTurn` REUSES `partitionIntoUnits` (in scope) once, internally.

### D3 — rewindOwnUnit detection REUSES S1's module-private `assistantIssuedCall`
- S1's PRP (contract) ships `function assistantIssuedCall(messages, indices, callId): boolean` (module-private).
- For each `toolGroup` unit, `assistantIssuedCall(messages, unit.indices, excludeToolCallId)` → true iff that
  unit's assistant issued the rewind's own call. Collect that unit's `indices` into `rewindOwnIndices` (a Set).
- This is DRY (no re-implementation) and matches the append-reuse convention both PRPs follow.

### D4 — parallel-tool case (spec/06 §9 / spec/08 E6) needs NO special branch
- §9 for `last_turn`: "the 'keep the rewind's own unit' rule keeps the ENTIRE shared assistant message + all its
  results, so siblings survive in the view." Because `assistantIssuedCall` tests a UNIT (which contains the shared
  assistant + all sibling results), `rewindOwnIndices` gets the WHOLE shared unit → siblings + results are kept.
  Conservative + pairing-safe by construction. No surgical splitting in this pure helper.

### D5 — `mulligan:*` detection = `customType` string starting with `"mulligan:"`
- spec/01 line 156: a Pi `CustomMessage` in `event.messages` = `{ role:"custom", customType, content, display,
  details }`. The looper-smoke proto detects custom messages by `m.customType === "..."` (proto line 60) — i.e.
  customType is the discriminator, not role.
- The note (`mulligan:note`) and the ephemeral nudge (`mulligan:nudge`) both carry a `mulligan:`-prefixed
  customType. So `isMulliganCustomMessage(msg)` = `isRecord(msg)` AND `typeof readOwn(msg,"customType")==="string"`
  AND `customType.startsWith("mulligan:")`. Robust; never throws.

### D6 — resolveLastTurn enforces the nuclear protected check ITSELF (returns {remove:[]} on refusal)
- Contract §3 LOGIC: "Refuse if iLastUser is the first user message (protected)." + spec/10 §1.3: "u1 is first
  user → to_previous_prompt refused by protected check."
- The refusal manifests as `{ remove: [] }` (no-op), matching filterPipeline §12's `remove = resolveLastTurn(...).remove`
  (it reads `.remove`, so the function always returns the object wrapper).
- The DEFAULT case is protected-safe by construction: `min(remove) > iLastUser >= iFirstUser` always. filterPipeline
  (T5.S1) adds a general `protectedOk` defense-in-depth pass; resolveLastTurn only needs its own nuclear guard.

### D7 — return shape is `{ remove: number[] }`, NEVER null (contrast S1's `number[] | null`)
- Contract §4 OUTPUT: "Exported resolveLastTurn function returning {remove: number[]}." Empty array = no-op/refusal.
- filterPipeline §12: `remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove` — accesses `.remove`.

### D8 — `remove` is built in ASCENDING order (deterministic, consumer-friendly)
- Nuclear: push `iLastUser` first, then iterate `j = iLastUser+1 .. end`. Since `iLastUser < iLastUser+1`, the
  result is ascending. No sort needed; deterministic across runs.

### D9 — ZERO new imports; NEVER throws (E13)
- Reuses `partitionIntoUnits`, `assistantIssuedCall` (S1), `Unit`/`MessageLike` (types), `isRecord`/`readOwn`.
  File import count stays 0 (foundation-tier pure). Adds ONE module-private helper `isMulliganCustomMessage`.
- Non-array messages → `{remove:[]}`; throwing-Proxy messages → readOwn swallows; never throws.

## 3. Pairing safety analysis (why index-based removal is safe here)

Concern: resolveLastTurn removes by raw index, not by unit — could it orphan a toolCall/toolResult?
- **Well-formed input (the only kind Pi produces):** an assistant always precedes its results, and a turn's
  assistant+results all live at indices `> iLastUser`. Removing every index `> iLastUser` removes BOTH sides of
  every pair in the turn → no orphan. (spec/06 §4 pt 4.)
- **The rewind's own unit** is kept WHOLE (assistant + all results via rewindOwnIndices) → never orphaned, and the
  parallel-shared-message case is covered (D4).
- **The only theoretical orphan** = a result at index `< iLastUser` whose assistant is `> iLastUser` (malformed
  order). This cannot occur in a finalized `context` event (spec/06 §2 corner cases). Out of scope; documented.

## 4. spec/10 §1.3 pinned tests (faithful translation)

Input shape `[u0, a, r, u1, a, r]` → built as `[user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"),
result("c1")]` (indices 0..5).
- **default:** iLastUser=3 → `remove = [4,5]` (keep u0,a,r,u1).
- **to_previous_prompt:true:** iLastUser=3, iFirstUser=0 (differ) → nuclear allowed → `remove = [3,4,5]`.
- **u1 is first user (separate input `[user("only"), asst("c"), result("c")]`):** iLastUser=0=iFirstUser → nuclear
  refused → `{ remove: [] }`.

## 5. Reused symbols (do NOT redefine — APPEND only)

From T1.S1 (LANDED): `partitionIntoUnits`, `Unit`, `MessageLike`, `isRecord`, `readOwn`.
From S1 (parallel contract): `assistantIssuedCall(messages, indices, callId)` — module-private.
Test fixtures (T1.S1): `asst`, `asstText`, `result`, `user`, `custom`, `summary`, `expectPairingInvariant`.