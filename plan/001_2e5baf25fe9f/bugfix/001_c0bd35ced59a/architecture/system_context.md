# System Context: pi-mulligan Rewind Hiding Bugfix

## 1. What pi-mulligan Is

pi-mulligan is a Pi coding-agent extension that implements **permanent soft-delete rewind** —
the ability for an agent to "shed" recent context it produced by mistake (a bloated tool result,
or a whole wrong-direction turn) and leave itself a note so it can try again with a clean view.
The hidden content disappears from the model's view **permanently** (it stays on disk for the human).

## 2. The Three Critical Bugs (Shared Root Cause)

All three bugs share one root cause: **rewind markers store RELATIVE specs that `filterPipeline`
re-resolves against the constantly-growing message list on EVERY context fire.** Relative targeting
is stable only across a STATIC session, but the session changes the moment the agent resumes work
after a rewind — the normal, intended usage pattern ("rewind, then resume work").

### BUG-001: last_tool_call_group — not permanent
- **Location**: `src/transforms.ts:223` (`resolveLastToolCallGroup`) + `src/transforms.ts:969` (`filterPipeline`)
- **Symptom**: After a rewind, the hidden content leaks back into view as soon as the agent makes any
  new tool call. The new (legitimate) work gets hidden instead.
- **Root cause**: `resolveLastToolCallGroup` returns "the most recent non-excluded toolGroup" — a
  moving target. As soon as the agent makes a new tool call, the newest toolGroup becomes "the most
  recent," re-targeting the rewind onto the NEW work and un-hiding the original mistake.

### BUG-002: last_turn — infinite loop
- **Location**: `src/transforms.ts:319` (`resolveLastTurn`) + `src/transforms.ts:969` (`filterPipeline`)
- **Symptom**: The agent's own "redo" work (produced after the rewind) is hidden on every inference,
  trapping it in an infinite loop (29+ fires stuck at n=4). Cross-turn: old turn content leaks back
  when a new user message arrives.
- **Root cause**: `resolveLastTurn` removes everything after the last user message. New work produced
  after the rewind is after the last user message → immediately hidden from the agent's next inference.

### BUG-003: checkpoint — silently non-functional
- **Location**: `src/markers.ts:333` (`setCheckpoint` labels `getLeafId()`) + `src/transforms.ts:450` (`resolveCheckpoint`)
- **Symptom**: Checkpoint rewinds hide nothing in real sessions. The tool reports "0 messages will be hidden."
- **Root cause**: `setCheckpoint` labels `getLeafId()` which returns a transient in-progress entry at
  tool-execute time. `resolveCheckpoint`'s entry→message walk maps this transient entry to the LAST
  message index → `remove = indices > iTarget` is always empty.
- **Secondary issue**: Even if the label were fixed, a checkpoint target on an assistant message with
  toolCalls would keep the assistant but remove its toolResult → orphaned toolCall → model API rejection.

## 3. Codebase Architecture (Key Files)

### Pure tier (Pi-free, fully unit-tested)
- **`src/transforms.ts`** (1027 lines): The PURE correctness heart. Defines `partitionIntoUnits`,
  `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`, `applyRewind`, `applyShrink`,
  `filterPipeline`, `stableSortBySeq`, `protectedOk`. **ZERO imports** — not Pi, not config, not log.
  Every function is pure, defensive, and never throws (E13 fail-open discipline).
- **`src/tokens.ts`**, **`src/ledger.ts`**, **`src/notes.ts`**: Pure sibling modules.

### Pi integration tier
- **`src/markers.ts`** (339 lines): Pi-coupled persistence wrappers. `appendRewindMarker`,
  `appendShrinkMarker`, `appendTurnMetric`, `leaveNote`, `setCheckpoint`. Each wraps `pi.appendEntry`
  / `pi.sendMessage` / `pi.setLabel` with try/catch → never throws.
- **`src/filter.ts`** (253 lines): The `context` event handler. Reads markers fresh, delegates to
  `filterPipeline`, injects nudges, caches the filtered view for audit. FAIL-OPEN (entire body is
  try/catch → pass-through).
- **`src/tools/rewind.ts`**: The `mulligan_rewind` agent-callable tool. Validation-owning adapter.
  Builds a read-only preview via `resolvePreview` (snapshot → resolvers → ledger → K estimate).
- **`src/tools/checkpoint.ts`**: The `mulligan_checkpoint` tool. Name-validation + delegates to
  `setCheckpoint`.
- **`src/index.ts`**: Extension factory. Wires tools + event handlers.

### Key types
- **`RewindMarker`** (markers.ts): `{ schema, v:1, kind:"rewind", id, granularity, options, excludeToolCallId, seq, note, ledger, ts }`.
  NOTE: `checkpoint` field is NOT in the type but IS persisted at runtime (GOTCHA #1 in rewind.ts).
- **`RewindMarkerLike`** (transforms.ts:790): The structural slice `filterPipeline` READS.
  `{ seq, granularity, options?, excludeToolCallId?, checkpoint? }`.
- **`BranchEntry`** (transforms.ts): `{ type, id, parentId?, targetId?, label?, ... }`.
- **`Unit`** (transforms.ts): `{ indices: number[], kind: "plain" | "toolGroup" }`.
- **`MessageLike`** (transforms.ts): `{ role?, content?, [key: string]: unknown }`.

## 4. The filterPipeline Data Flow

```
contextHandler (filter.ts)
  ├── readMarkers(ctx)           → { rewinds, shrinks, metric }  (fresh each fire)
  ├── ctx.sessionManager.getBranch()  → BranchEntry[] (leaf→root order)
  ├── filterPipeline(messages, markers, config, branchEntries)  → filtered messages
  │     ├── 1) REWINDS oldest-first (stableSortBySeq):
  │     │     for each rw:
  │     │       resolve removal set by granularity against CURRENT m
  │     │       (last_tool_call_group → resolveLastToolCallGroup)
  │     │       (last_turn → resolveLastTurn)
  │     │       (checkpoint → resolveCheckpoint)
  │     │       protectedOk check → applyRewind (gap-closing removal)
  │     ├── 2) SHRINKS oldest-first: applyShrink per marker
  │     └── 3) return filtered array
  ├── injectNudge (if applicable)
  ├── cache for audit
  └── return { messages }
```

## 5. Pi Session Manager API (Key Methods)

From `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js`:

- **`getLeafId()`** (line 883): Returns `this.leafId` — the id of the current leaf entry.
  During tool execution, this is a TRANSIENT in-progress entry (the root cause of BUG-003).
- **`getBranch(fromId?)`** (line 943): Walks from `fromId ?? this.leafId` to root via `parentId`,
  then `.reverse()` → returns **root→leaf order**. Includes ALL entry types (messages, labels,
  compaction, etc.).
- **`buildContextEntries(entries, leafId, byId)`** (line 198): Handles compaction — returns the
  path but truncates everything before the most recent compaction's `firstKeptEntryId`.
- **`sessionEntryToContextMessages(entry)`**: Maps a session entry to LLM messages.
  - `type: "message"` → 1 message (has `.message` with `role`/`content`)
  - `type: "custom_message"` → 1 message
  - `type: "branch_summary"` / `"compaction"` → 1 message (summary)
  - `type: "label"`, `"custom"`, `"thinking_level_change"`, etc. → 0 messages
- **`appendLabelChange(targetId, label)`** (line ~900): Creates a `LabelEntry` with
  `{ type:"label", targetId, label, parentId: this.leafId }`. The label entry ITSELF becomes the
  new leaf. The `targetId` points to the entry being labeled.
- **`_appendEntry(entry)`**: Sets `this.leafId = entry.id` and stores in `this.byId`.

### Entry Structure
```typescript
interface SessionEntry {
  type: "message" | "custom_message" | "compaction" | "label" | "custom" | ...;
  id: string;
  parentId: string | null;
  timestamp: string;
  // message entries:
  message?: { role: string; content: ...; };
  // label entries:
  targetId?: string;
  label?: string;
  // compaction entries:
  summary?: string;
  firstKeptEntryId?: string;
}
```

### The Transient Entry Problem (BUG-003)
At tool-execute time, Pi has appended entries for the assistant message + the tool call. The current
leaf is either:
- The toolResult entry (if results are appended before execute), OR
- A transient in-progress entry (an entry of `type: "message"` with no real `.message.role`/`.message.content`).

When `setCheckpoint` calls `getLeafId()`, it labels this transient entry. `resolveCheckpoint`'s walk
counts it as a context-producing entry (type "message" → yield 1), but since it sits at the leaf-most
position, the walk maps it to the LAST message index → empty removal set.

## 6. The Idempotency Assumption (spec/06 §11) — Why It's Wrong

spec/06 line 232 states:
> "re-firing the filter on the same session reproduces the same result (markers resolve against the
> same session each time until the session changes). No double-removal because removed messages are
> absent from subsequent passes within the same fire, and **across fires the session is unchanged
> between user prompts**."

The bolded clause is the flawed assumption. Within a turn, after the agent calls a tool:
1. The agent calls `mulligan_rewind` → marker persisted, note left.
2. The agent makes a NEW tool call (the "redo") → Pi appends new entries to the session.
3. The `context` event fires again (before the next LLM call).
4. `filterPipeline` re-resolves the marker against the NOW-GROWN message list.
5. The relative spec ("last tool group" / "last turn") targets the WRONG content.

The session DOES change within a turn after a tool call. This is the root of BUG-001 and BUG-002.