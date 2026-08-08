# Design Decisions — P1.M3.T1.S1 `partitionIntoUnits`

Resolves every spec-open detail so the implementer makes ZERO judgement calls. Read alongside the PRP GOTCHAs.

---

## D1. Foundation-tier, Pi-FREE, zero imports (sibling of tokens.ts / ledger.ts)

transforms.ts is the PURE-CORE tier (spec/11 §1: "PURE: …"). `partitionIntoUnits` imports NOTHING — not Pi, not
config, not log, not runtime, NOT even tokens.ts/ledger.ts. It defines its OWN local structural `MessageLike`
(mirror of ledger.ts's `MessageLike`, itself modeled on tokens.ts's) and its OWN module-private `isRecord`/`readOwn`
(each pure module keeps its own copy — the established convention in tokens.ts, ledger.ts, notes.ts; avoids any
circular dependency and keeps each module independently unit-testable).

**Why not reuse tokens.ts's `MessageLike`?** Each sibling defines its own structural view of the same `AgentMessage`
union; that is the proven pattern (tokens.ts AND ledger.ts each define `MessageLike` independently). The two views
never interact directly — `filter.ts` (P1.M4) passes one real `AgentMessage[]` to BOTH `estimateTokens` and
`partitionIntoUnits`, and structural typing makes it assignable to each local `MessageLike[]` with no cast. DRY here
would create an inter-module coupling the spec deliberately avoids at this tier.

---

## D2. Local `MessageLike` — exported, structural, minimal

```ts
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;   // covers toolCallId (read via readOwn), toolName, customType, etc.
}
```

`partitionIntoUnits` inspects ONLY: `role` (→ "assistant" / "toolResult"), assistant `content[]` for toolCall blocks
(reading each block's `.id`), and toolResult `.toolCallId`. The index signature covers `toolCallId` (and lets unknown
/future roles flow through as plain units — forward-compat). A real Pi `AgentMessage[]` assigns in with NO cast.

**Exported** (matching tokens.ts/ledger.ts which both export `MessageLike`): tests construct typed fixtures, and the
later sibling resolve*/apply* functions (P1.M3.T2/T3/T4/T5) reuse it as their shared input type.

---

## D3. The `Unit` interface — EXACT spec shape, exported

```ts
export interface Unit { indices: number[]; kind: "plain" | "toolGroup"; }
```

(spec/06 §2 canonical shape — do NOT rename `indices`/`kind`, do NOT add fields. Downstream resolve*/apply* depend
on it.) `indices` is **sorted ascending**; `plain.indices` always has length exactly 1; `toolGroup.indices[0]` is the
assistant (in well-formed input — see D8 for the defensive case). Units are ordered by `indices[0]` (min index).

---

## D4. The algorithm — steps (a)–(e) (spec/06 §2), implemented join-style for safety

The spec lists building `callToResult` as a separate map (step b). I implement steps (b)+(c) as a single JOIN that
groups ALL result indices by their paired assistant into `Map<assistantIndex, number[]>`. This is faithful to
spec/06 §2 step 3 ("all resultIndex whose toolCallId maps to that assistant") AND strictly safer for the pathological
duplicate-callId case (D7): every result sharing a callId is grouped with the assistant, so removing the toolGroup
can never leave an orphan result.

1. **(a)** `callToAssistant: Map<toolCallId, assistantIndex>` — from every assistant message's toolCall blocks
   (only blocks whose `.id` is a NON-EMPTY string are pairable; missing/non-string/empty ids are ignored).
2. **(b)+(c)** `assistantToResults: Map<assistantIndex, number[]>` — for every toolResult whose `.toolCallId` is a
   non-empty string AND appears in `callToAssistant`, push its index into that assistant's bucket. Results whose
   callId is NOT in `callToAssistant` are SKIPPED here → they fall through to plain units in (d) (orphan, spec/08 E1).
3. **toolGroup build** — for each DISTINCT assistantIndex in `callToAssistant.values()` (deduped via an `assigned`
   set, since one assistant with N calls appears N times): `indices = sorted([assistantIndex, ...results])`,
   `kind:"toolGroup"`. Mark every index `assigned`.
4. **(d) plain** — every index NOT in `assigned` → `{indices:[i], kind:"plain"}`. This is where orphan results,
   user messages, text-only assistants, and custom messages land.
5. **(e) order** — sort units by `indices[0]`.

**Dedup of `callToAssistant.values()`**: one assistant issuing 3 toolCalls yields the index `i` three times in
`.values()`. The first iteration creates the toolGroup + marks `assigned`; the next two hit `assigned.has(i) →
continue`. Correct: ONE toolGroup per assistant (all its results join it), not three.

---

## D5. "Assistant with toolCalls but no results yet" → toolGroup of just the assistant (spec/06 §2 corner case)

Because the toolGroup set = distinct values of `callToAssistant` (assistants that issued ≥1 pairable call), an
assistant whose results have not arrived is STILL in that set → it forms a toolGroup `{indices:[i]}` (results bucket
empty). This matches spec/06 §2: "treat as a toolGroup unit containing just the assistant." Verified by a dedicated
test. (It should not appear in a finalized `context` event, but the function is defensive/total regardless.)

---

## D6. Orphan result → its own plain unit (spec/08 E1, spec/06 §2 corner case)

A toolResult whose `.toolCallId` matches no assistant is skipped in step (b)+(c) (no `callToAssistant` entry) → its
index is never `assigned` → it becomes a plain unit in (d). **Never merged, never deleted speculatively.** This is
the spec/08 E1 + spec/06 §2 "if you cannot confirm both sides of a pair, hide neither" rule made structural.
Verified by a dedicated test.

---

## D7. Duplicate / pathological callIds — deterministic, orphan-safe

- **Two assistant calls with the same id** (shouldn't happen): `callToAssistant.set(id, i)` → LAST assistant wins.
  The earlier assistant (no surviving pairable id, assuming that was its only call) is NOT in the toolGroup set →
  plain unit. Deterministic.
- **Two toolResults with the same callId** (shouldn't happen): the JOIN groups BOTH into the assistant's bucket
  (D4) → both join the SAME toolGroup → removing it hides both together. **No orphan possible.** (This is why D4
  uses a `number[]` per assistant rather than a 1:1 map.)
- **Result appearing BEFORE its assistant** (malformed ordering): the JOIN still works (it reads the actual index),
  and the ascending sort places indices correctly. Robust.

These are non-issues for well-formed Pi contexts (the API enforces 1:1 call↔result per turn), but the function stays
total + deterministic regardless.

---

## D8. "Plain" definition — everything NOT in a toolGroup

Plain units = {user messages} ∪ {text-only / toolCall-less assistants} ∪ {custom messages (mulligan:note,
mulligan:nudge)} ∪ {bashExecution / branchSummary / compactionSummary} ∪ {orphan toolResults} ∪ {any unknown role}.
`plain.indices` is ALWAYS exactly `[i]` (length 1) — a plain unit never spans multiple messages.

Note: a toolResult whose callId is valid BUT whose assistant message had only malformed (no-id) toolCalls → the
result's callId isn't in `callToAssistant` → orphan → plain. Correct (we can't confirm the pair; hide neither → both
stay, each as its own unit). Documented; covered by a defensive test.

---

## D9. Defensive / never-throws (E13; context-handler hot path)

`partitionIntoUnits` sits on the `context` handler's hot path (called once per filter fire, spec/06 §12). It MUST
never throw:
- `null`/`undefined`/non-array `messages` → `[]`.
- Non-record messages, non-array assistant `content`, non-record blocks, blocks missing `type`/`id`, non-string or
  empty-string ids → skipped (contribute nothing to the maps).
- A throwing-Proxy message/block → `readOwn` swallows the get-trap throw → treated as missing → graceful.
- Out-of-range is impossible (we iterate `0..list.length`).

`isRecord` (object, non-null, non-array) + `readOwn` (try/catch around the property read) are the exact helpers
tokens.ts/ledger.ts/notes.ts use. Mirror them verbatim. No `@ts-ignore` (the defensive branches compile cleanly
under `strict`; some are type-level-unreachable but still execute at runtime for a type-violating caller).

---

## D10. Signature — accepts `MessageLike[] | null | undefined`

```ts
export function partitionIntoUnits(messages: MessageLike[] | null | undefined): Unit[]
```

Matches the sibling convention (`extractFileLedger(messages: MessageLike[] | null | undefined, …)`,
`estimateTokens(messages: MessageLike[] | null | undefined, …)`) and the E13 fail-open discipline: a `null`/`undefined`
input (e.g. a transiently-empty `event.messages`) → `[]` rather than a throw. A real `AgentMessage[]` is assignable
to `MessageLike[]` with no cast.

---

## D11. Test strategy (spec/10 §1.1 + defensive + types)

Mirror `test/tokens.test.ts` + `test/ledger.test.ts`:
- `import { partitionIntoUnits, type Unit, type MessageLike } from "../src/transforms.js"` (the `.js` extension is
  the house convention under `moduleResolution:"Bundler"` + `type:"module"`).
- NO `beforeEach` (pure, stateless module).
- Fixture helpers: `asst(...callIds)`, `asstText(text)`, `result(toolCallId)`, `user(text)`, `custom(customType)`.
- **spec/10 §1.1 PINNED cases** (the load-bearing tests): the 4-message → 3-units case; orphan → own plain unit;
  3-calls + 3-results → one toolGroup of 4 indices; the invariant test (forward: every result in a toolGroup matches
  the assistant's call ids; reverse: every call has a result — asserted in the fully-paired 3+3 case).
- **Corner cases**: assistant-with-calls-no-results-yet → toolGroup [i]; empty/null/undefined/non-array → [];
  parallel mode (1 assistant, 2 calls, 2 results → one toolGroup); multiple separate groups; interleaved ordering;
  custom/user/text-assistant → plain.
- **Defensive / never-throws**: malformed blocks, missing/non-string/empty ids, throwing-Proxy message, duplicate
  callIds (orphan-safe), result-before-assistant.
- **Ordering/determinism**: units ordered by `indices[0]`; toolGroup indices ascending; idempotent
  (`partitionIntoUnits(messages)` is pure).
- **Types** (`expectTypeOf`): returns `Unit[]`; `Unit` shape `{indices:number[]; kind:"plain"|"toolGroup"}`;
  `MessageLike` accepts real-ish Pi shapes.

---

## D12. Validation gate (no lint/format configured)

`devDependencies` = typescript + vitest + @types/node ONLY. The gate is:
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (TS `strict` IS the type+style gate).
- `npx vitest run` → all green (baseline 6 files / 216 tests → grows by +1 file (transforms.test.ts) + N tests).
Do NOT invent a lint/format command — it will fail "command not found".