# Spec Extracts — P1.M3.T1.S1 `partitionIntoUnits`

Authoritative excerpts (verbatim / near-verbatim) from the spec + verified API doc. These are the load-bearing
sources the PRP cites. The PRP is self-contained, but this file preserves the exact wording for the implementer.

---

## 1. spec/06-context-filter.md §2 — "Pairing: the cardinal rule" (THE algorithm)

> The model API rejects a request that contains a `toolCall` without its matching `toolResult`, or vice versa.
> **Every transform MUST preserve pairing.** The primitive that enforces this is `partitionIntoUnits`:

```ts
// Returns, for the message array, the set of "units" where a unit is either:
//   - a single non-tool message, OR
//   - an assistant message that contains toolCalls, grouped WITH every toolResult
//     whose toolCallId appears in that assistant message.
interface Unit { indices: number[]; kind: "plain" | "toolGroup"; }
function partitionIntoUnits(messages: AgentMessage[]): Unit[]
```

> Algorithm:
> 1. Walk messages; build `toolCallId → assistantIndex` from every `AssistantMessage`'s `toolCall` blocks.
> 2. Build `toolCallId → resultIndex` from every `ToolResultMessage` (`role:"toolResult"`, `.toolCallId`).
> 3. A `toolGroup` unit = the assistant message at `assistantIndex` plus all `resultIndex` whose `toolCallId` maps
>    to that assistant. (An assistant may have several toolCalls; all their results join the same unit.)
> 4. Any message not in a toolGroup is a `plain` unit (single index).
> 5. Units are ordered by their minimum index.

> **Critical corner cases:**
> - A `toolResult` whose `toolCallId` has **no** matching assistant (orphan) … Treat it as its own `plain` unit
>   (do not delete it speculatively …). The safe rule: **if you cannot confirm both sides of a pair, hide neither.**
> - An assistant with toolCalls whose results haven't arrived yet (mid-turn … be defensive): treat as a toolGroup
>   unit containing just the assistant; hiding it is allowed only if no partial results exist for it.
>
> All removal operations in Mulligan operate on **units**, never raw indices. This guarantees pairing by construction.

---

## 2. spec/10-testing.md §1.1 — `partitionIntoUnits` (pairing) — the EXACT unit tests

> - `[user, assistant(1 toolCall), result, assistant(text)]` → 3 units (the assistant+result is one toolGroup, the
>   text assistant is plain, user is plain).
> - Orphan result (no matching toolCall) → its own plain unit; never merged.
> - Assistant with 3 toolCalls + 3 results → one toolGroup unit with 4 indices.
> - **Invariant test:** for every toolGroup unit, every result index's `toolCallId` is in the assistant's toolCall
>   ids, and vice versa.

Also relevant (spec/10 §3, optional property tests):
> - **Pairing invariant (property):** for any random message list and any sequence of rewind/shrink markers, the
>   filtered output never contains an orphan `toolCall` or `toolResult`. Quickcheck-style.

(This subtask ships the primitive; the property test over the FULL pipeline is P1.M3.T5/filterPipeline.)

---

## 3. spec/08-edge-cases.md E1 — Orphaned `toolResult` (no matching `toolCall`)

> - **Situation:** `event.messages` contains a `ToolResultMessage` whose `toolCallId` has no preceding
>   `AssistantMessage` toolCall. Can occur transiently during streaming, after partial compaction, or with custom tools.
> - **Risk:** hiding one side breaks the API; the model request errors.
> - **Behavior:** `partitionIntoUnits` treats an orphan result as its own `plain` unit. **A rewind never removes a
>   unit unless both sides of every pair within it are confirmed present.** If unsure, hide neither. Log at debug.

---

## 4. api_verification.md §6.4 — Tool Pairing Invariant (verified against Pi 0.84.x .d.ts)

> `AssistantMessage.content[]` contains `ToolCall` blocks with `.id`.
> `ToolResultMessage.toolCallId` equals that `.id`.
> **The model API rejects a request that orphans either side.**
> Every filter transform MUST preserve pairing.

### 4.1 Verified message shapes (api_verification.md §6.1/§6.2)

```ts
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  // ...plus: api, provider, model, usage, stopReason, timestamp
}
interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  usage?: Usage;
  isError: boolean;
  timestamp: number;
}
interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; }
```

The full `AgentMessage` union (spec/01 §5 / api_verification §6):
`UserMessage | AssistantMessage | ToolResultMessage | BashExecutionMessage | CustomMessage |
BranchSummaryMessage | CompactionSummaryMessage`. **The real `AgentMessage` type lives in
`@earendil-works/pi-agent-core`, which is NOT resolvable from a pure-helper module** (confirmed in tokens.ts +
ledger.ts: not hoisted, not re-exported). → partitionIntoUnits uses a LOCAL structural `MessageLike` (a real
`AgentMessage[]` assigns in with NO cast). This is the established sibling pattern (tokens.ts, ledger.ts).

---

## 5. spec/11-build-order.md §1 + §2 Step 3 — file ownership + tier

> `transforms.ts   // PURE: partitionIntoUnits, resolve*, applyRewind, applyShrink, filterPipeline`
> …
> ### Step 3 — Pure core: `transforms.ts` (2–3 h — the bulk)
> - Implement `partitionIntoUnits`, `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`,
>   `applyRewind`, `applyShrink`, `filterPipeline` exactly per `@06-context-filter.md`.
> - **Verify:** Tier-1 §1.1–1.5 and §1.9 … pass. Add the property tests (§3): pairing invariant, idempotency,
>   monotonic shrinkage. **This is the most important step; do not proceed until the pairing invariant holds on
>   randomized inputs.**

→ THIS subtask (P1.M3.T1.S1) ships ONLY `partitionIntoUnits` + `Unit` + the local `MessageLike`. It CREATES
`src/transforms.ts` (the file does not exist yet) and `test/transforms.test.ts`. The sibling resolve*/apply*/pipeline
functions are LATER P1.M3 subtasks that APPEND to this file and reuse `Unit`/`MessageLike` + the module-private
`isRecord`/`readOwn` defined here.

## 6. spec/03-architecture.md §7 — naming note

spec/03 §7 line 180 lists the older name `findToolCallPairs`. spec/06 §2 (the authoritative, detailed spec) +
the work item canonicalize it as **`partitionIntoUnits`** with the `Unit` interface. Implement the spec/06 name
(`partitionIntoUnits`); spec/03's `findToolCallPairs` is a stale alias.

---

## 7. Consumer contract (who calls partitionIntoUnits)

Per spec/06 §1 (the `context` handler) + §12 (filterPipeline pseudocode) + spec/03 §104:

```ts
const units = partitionIntoUnits(m);   // spec/06 §12 — called ONCE per filter fire, BEFORE the rewind loop
for (const rw of stableSortBySeq(markers.rewinds)) {
  // resolveLastToolCallGroup(units, m, rw.excludeToolCallId) → uses `units`  (P1.M3.T2.S1)
  // resolveLastTurn(m, rw.options, rw.excludeToolCallId) → partitions internally (P1.M3.T2.S2)
  // ...
  m = removeIndices(m, remove);         // applyRewind — unit-aware gap-closing (P1.M3.T4.S1)
}
```

So `partitionIntoUnits` is consumed by: **filterPipeline** (P1.M3.T5), **resolveLastToolCallGroup** (P1.M3.T2.S1,
takes `units: Unit[]`), and **applyRewind** (P1.M3.T4.S1, "unit-aware"). Its return type `Unit` is therefore a
shared type across the whole P1.M3 module — EXPORT it.