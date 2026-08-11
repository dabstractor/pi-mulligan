# External Dependencies & API Constraints

## Pi Coding Agent API (@earendil-works/pi-coding-agent v0.84.1)

pi-mulligan is a Pi extension. It hooks into the Pi agent lifecycle via the
`ExtensionAPI` (passed to the extension factory) and `ExtensionContext` (passed to
each handler/tool call).

### Key Pi Interfaces Used

| Pi Interface | Used In | Purpose |
|---|---|---|
| `ExtensionAPI.on(event, handler)` | nudges.ts, filter.ts | Register context/tool_result/turn_end/session_start handlers |
| `ExtensionAPI.appendEntry(customType, data)` | markers.ts | Persist custom entries (markers, metrics, cancels) — NOT in LLM context |
| `ExtensionAPI.registerTool(toolDef)` | tools/*.ts | Register agent-callable tools |
| `ExtensionContext.sessionManager.getSessionId()` | everywhere | Read session ID FRESH each call (C12) |
| `ExtensionContext.sessionManager.getEntries()` | markers.ts, tools/*.ts | Read raw session entries FRESH (append-only) |
| `ExtensionContext.sessionManager.getBranch()` | markers.ts | Raw branch path (root→leaf, includes ALL entries incl. compacted-away + compaction) |
| `ExtensionContext.sessionManager.getLeafId()` | markers.ts | Latest entry ID (for marker-to-entry correlation) |
| `ExtensionContext.sessionManager.getLabel(id)` | tools/rewind.ts | Latest-wins label resolution (checkpoint existence check) |
| `ExtensionContext.getContextUsage()` | filter.ts, nudges.ts | `{ tokens?, contextWindow? }` — model context stats |
| `ContextEvent` | filter.ts | `{ messages: AgentMessage[] }` — compaction-aware message list the model sees |
| `TurnEndEvent` | nudges.ts | `{ turnIndex, message, toolResults }` — NO messages field |
| `ToolResultEvent` | nudges.ts | `{ toolCallId, toolName, content, isError }` |

### Critical Distinction: getBranch() vs event.messages

- **`getBranch()`** returns the RAW entry path (root→leaf). It includes:
  - `message` entries (every message ever appended)
  - `custom` entries (markers, metrics, cancels — NOT in LLM context)
  - `custom_message` entries (notes — IN LLM context)
  - `compaction` entries (compaction events — carry summary metadata)
  - `label` entries (checkpoints)
  - `branch_summary` entries
  - Entries that were COMPACTED AWAY are still present on the raw branch.

- **`event.messages`** (from the `context` event) is COMPACTION-AWARE:
  - Compact-away head messages are REPLACED by a single compaction summary message.
  - The retained tail maps 1:1 to the branch entries AFTER the last compaction.
  - Custom entries (markers/metrics) are NOT present (they're `custom`, not `custom_message`).

This distinction is the root of BUG-002: resolvePinnedHide walks getBranch() (raw) and
can't align with event.messages (compaction-aware) past a compaction boundary.

### CompactionEntry Shape (installed Pi v0.84.1)
The installed Pi CompactionEntry has:
- `type: "compaction"`
- `id: string`
- NO `retainedTail` field (spec/06 §6 assumed one — it does not exist in installed Pi)
- NO `firstKeptEntryId` field (the BranchEntry type comment mentions it speculatively)

Because there is no retainedTail, the exact set of compacted-away messages cannot be
determined from the compaction entry alone. This is why the code treats compaction as
"indeterminate" (entryMessageYield returns -1). The BUG-002 fix avoids needing this data
by walking ONLY the retained tail (entries after the last compaction), which maps directly
to the tail of event.messages.

### SessionEntry Shape
```
type SessionEntry = {
  type: "message" | "custom" | "custom_message" | "compaction" | "label" | "branch_summary" | ...
  id: string
  parentId?: string | null
  timestamp?: string
  // type-specific fields:
  message?: { role, content, ... }     // for type:"message"
  customType?: string                   // for type:"custom" / "custom_message"
  data?: Record<string, unknown>        // for type:"custom" (the marker payload)
  label?: string                        // for type:"label"
  targetId?: string                     // for type:"label"
  summary?: string                      // for type:"compaction"
  ...
}
```

### typebox (v1.3.11)
Used only in tool definitions (tools/*.ts) for parameter schemas (`Type.Object`,
`Type.String`, etc.). Not used in the foundation tier.

### vitest (v1)
Test framework. Tests are co-located in `test/`. Run via `npm test` (vitest run).
All 955 tests pass at baseline.

## No External Network Dependencies
pi-mulligan makes ZERO network calls. All logic is local (file reads, session entry
reads, in-memory transforms). No mocking of external services is needed for any subtask.