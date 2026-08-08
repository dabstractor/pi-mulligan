# Pi Session Entry Model — Architecture Notes (for bugfix plan)

Scope: the append-only entry tree inside `@earendil-works/pi-coding-agent` (the Pi runtime) and how
`pi-mulligan` consumes it (`markers.ts`, `transforms.ts`). All answers below are grounded in the
exact file:line references; line numbers are for the *installed* dist build.

---

## Files Retrieved

1. `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js` (lines 1-320, 650-870, 895-990, 1020-1080) — the entire session tree: `_appendEntry`, `getLeafId`, `getBranch`, `buildContextEntries`, `buildSessionPath`, `sessionEntryToContextMessages`, `appendLabelChange`, `branch`.
2. `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts` (full) — `SessionEntry` union, `SessionManager` interface, `ReadonlySessionManager` pick.
3. `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` (lines 1-470) — `ExtensionContext.sessionManager`, `ExtensionAPI.appendEntry/setLabel/sendMessage`.
4. `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` (lines 355-400, 1860-1880) — message persistence on `message_end`, `appendEntry`/`setLabel` runtime wiring.
5. `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js` (lines 260-290) — `pi.*` → `runtime.*` synchronous delegation.
6. `src/markers.ts` (full) — `appendRewindMarker`, `appendShrinkMarker`, `appendTurnMetric`, `setCheckpoint`, `leaveNote` and the leaf-capture idiom.
7. `src/transforms.ts` (lines 430-530, 950-1030) — `resolveCheckpoint`, `entryMessageYield`, `filterPipeline`.

---

## Direct answers to the KEY QUESTIONS

### Q1 — What does `getLeafId()` return DURING a tool's `execute()`? Is it a transient in-progress entry?

**No transient/in-progress entry exists. The leaf is always a fully-committed entry.**

Persistence of user/assistant/toolResult messages happens **only** on the `message_end` event
(`agent-session.js:368-378`):

```js
if (event.type === "message_end") {
    if (event.message.role === "custom") {
        this.sessionManager.appendCustomMessageEntry(...);
    } else if (event.message.role === "user" || "assistant" || "toolResult") {
        this.sessionManager.appendMessage(event.message);   // line 378
    }
}
```

So the turn lifecycle is strictly ordered:

1. assistant message **streams** → on `message_end` it is `appendMessage`-committed (becomes a stable `SessionMessageEntry`). No entry exists during streaming.
2. **only then** tools run via `execute()`. At this instant `leafId` already points at the committed assistant message entry.
3. after the whole tool **batch** finishes, a single `toolResult` message is emitted and committed on its `message_end`.

Consequently, when a tool (e.g. `mulligan_rewind`) calls `ctx.sessionManager.getLeafId()`, it gets the
**last committed entry** — the assistant message, or a custom/label entry appended earlier in the same
batch. There is never a half-written "in-progress toolResult" entry to mistake it for.

### Q2 — How does `getBranch()` order entries (leaf→root or root→leaf)?

**It collects leaf→root, then `.reverse()`s, so the RETURNED array is root→leaf (chronological).**

`session-manager.js` `getBranch(fromId?)` (the instance method):

```js
getBranch(fromId) {
    const path = [];
    const startId = fromId ?? this.leafId;
    let current = startId ? this.byId.get(startId) : undefined;
    while (current) {
        path.push(current);                                  // push leaf first
        current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    path.reverse();                                          // → root→leaf
    return path;
}
```

**GOTCHA (critical for pi-mulligan):** `src/transforms.ts` `resolveCheckpoint` (line ~460) iterates
`branchEntries` assuming **leaf→root** order — it searches for "the FIRST (most-recent, leaf→root)
LabelEntry". But the value passed in is the **return** of `getBranch()`, which is **root→leaf**. So
that loop actually finds the **oldest** matching label on the branch, not the most-recent one. The
doc-comment says leaf→root but the data is root→leaf. See "Open question / risk" below.

The free function `buildSessionPath` (used internally by `buildContextEntries`/`buildSessionContext`)
does the identical leaf→root-then-reverse walk (`session-manager.js:124-148`).

### Q3 — Can we distinguish a "stable" message entry (has real content) from a "transient" one (in-progress)?

**There is no transient entry type.** Every appended entry is immediately durable (`_appendEntry`
pushes to `fileEntries`, indexes in `byId`, sets `leafId`, and calls `_persist` synchronously —
`session-manager.js:754-759`):

```js
_appendEntry(entry) {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this._persist(entry);
}
```

So "stable" is the only state. The only way to know an entry "has real content" is by its `type`:

- Context-producing (yield ≥1 LLM message): `message`, `custom_message`, `branch_summary`, `compaction`.
- State/display only (yield 0 messages): `custom`, `label`, `thinking_level_change`, `model_change`, `session_info`.

(See Q4.) For a `message` entry, content is the `entry.message` object; `sessionEntryToContextMessages`
normalizes null content on user/assistant/toolResult roles to `[]` (`session-manager.js` ~line 140-150).

### Q4 — Does each context-producing entry yield exactly 1 message via `sessionEntryToContextMessages`?

**Yes — every context-producing entry yields exactly 1 `AgentMessage`.** Verified from
`session-manager.js` `sessionEntryToContextMessages` (lines ~135-185):

| entry.type        | yield | notes |
|-------------------|-------|-------|
| `message`         | 1     | `entry.message` (null content → `{...message, content: []}` for user/assistant/toolResult) |
| `custom_message`  | 1     | `createCustomMessage(customType, content, display, details, timestamp)` |
| `branch_summary`  | 1     | only if `entry.summary` is truthy; else `[]` |
| `compaction`      | 1     | `createCompactionSummaryMessage(summary, tokensBefore, timestamp)` |
| all others        | 0     | `custom`, `label`, `thinking_level_change`, `model_change`, `session_info` → `[]` |

This is what `buildSessionContext` relies on: `.flatMap(sessionEntryToContextMessages)`
(`session-manager.js:236`). `src/transforms.ts` mirrors this in `entryMessageYield` (line ~515):
`message`/`custom_message`/`branch_summary` → 1; compaction → **-1 (indeterminate)**; everything
else → -1. The compaction -1 is intentional: a compaction on a RAW `getBranch` path misaligns with
the compaction-aware `event.messages`, so the filter refuses rather than guesses (see `resolveCheckpoint`
line ~500).

### Q5 — What is the parentId chain? Can we walk from leaf to find the last stable entry?

**Yes.** Every `SessionEntry` has `parentId: string | null` (`session-manager.d.ts` `SessionEntryBase`).
Root entry has `parentId === null`. Walking leaf→root is just:

```js
let current = byId.get(leafId);
while (current) { /* visit */ current = current.parentId ? byId.get(current.parentId) : undefined; }
```

This is literally `getBranch()` (Q2) without the final `.reverse()`. Because there are no transient
entries (Q3), "the last stable entry" = "the leaf" (or, if the leaf is a state-only type you want to
skip, walk backward until you hit a context-producing type). `getLeafEntry()` returns
`leafId ? byId.get(leafId) : undefined`.

---

## Key code: SessionEntry shape & the tree

`session-manager.d.ts`:

```ts
interface SessionEntryBase { type: string; id: string; parentId: string | null; timestamp: string; }
type SessionEntry =
  | SessionMessageEntry            // type "message";        message: AgentMessage
  | ThinkingLevelChangeEntry       // type "thinking_level_change"; thinkingLevel
  | ModelChangeEntry               // type "model_change";   provider, modelId
  | CompactionEntry<T>             // type "compaction";     summary, firstKeptEntryId, tokensBefore, details?, usage?, fromHook?
  | BranchSummaryEntry<T>          // type "branch_summary"; fromId, summary, details?, usage?, fromHook?
  | CustomEntry<T>                 // type "custom";         customType, data?     ← NOT in LLM context
  | CustomMessageEntry<T>          // type "custom_message"; customType, content, details?, display  ← IN LLM context
  | LabelEntry                     // type "label";          targetId, label?      ← NOT in context
  | SessionInfoEntry;              // type "session_info";   name?
```

`ReadonlySessionManager` (what extensions get via `ctx.sessionManager`) exposes only read methods:
`getCwd | getSessionDir | getSessionId | getSessionFile | getLeafId | getLeafEntry | getEntry |
getLabel | getBranch | buildContextEntries | getHeader | getEntries | getTree | getSessionName`.

**Writes are NOT on `ctx.sessionManager`** — they go through `pi` (the `ExtensionAPI`):
`pi.appendEntry` → `sessionManager.appendCustomEntry`; `pi.setLabel` → `sessionManager.appendLabelChange`;
`pi.sendMessage` → `sessionManager.appendCustomMessageEntry`. Confirmed at `agent-session.js:1864-1879`.

---

## Key code: labels / `targetId` (relevant to checkpoints)

`appendLabelChange(targetId, label)` (`session-manager.js:915-940`):
- A `LabelEntry` is itself an entry in the tree with `parentId: this.leafId`. Its own `id` ≠ `targetId`.
- `targetId` is the entry being labeled (resolved against `byId`).
- The label is set in a SEPARATE map `labelsById: Map<targetId, label>` and `labelTimestampsById`.
- Appending the label **advances `leafId`** to the label entry's own id (NOT to `targetId`).

Implication for `setCheckpoint` (`src/markers.ts`): it calls `pi.setLabel(leafId, "mulligan:checkpoint:name")`.
This appends a `LabelEntry` whose `targetId = leafId` (the checkpoint tool runs at the live leaf), then
leafId moves to the new label entry. So immediately after `setCheckpoint`, `getLeafId()` returns the
**label entry's** id, not the labeled message. `resolveCheckpoint` (`transforms.ts`) correctly reads
`entry.targetId` from the `LabelEntry`, not `entry.id`.

---

## Key code: leaf-capture idiom (markers.ts)

`appendRewindMarker` / `appendShrinkMarker` / `appendTurnMetric` (src/markers.ts) all do:

```js
pi.appendEntry("mulligan:rewind", entry);          // sync: _appendEntry sets leafId = marker.id
return ctx.sessionManager.getLeafId();             // → the just-appended MARKER's entry id
```

Because `pi.appendEntry` → `runtime.appendEntry` → `sessionManager.appendCustomEntry` is **synchronous**
(loader.js:271, agent-session.js:1864, session-manager.js `_appendEntry`), `getLeafId()` called on the
very next line reliably returns the **marker's own id** (constraint C7 / GOTCHA #5). There is no async
gap, no other entry can interleave on the same tick.

`appendRewindMarker` returns this id; `leaveNote` then appends an in-context `mulligan:note`
CustomMessage (which again advances leafId past the marker). The marker id is correlated to the note
via `details.rewindId`.

---

## Key code: resolveCheckpoint & filterPipeline (transforms.ts)

`resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?)` (lines ~445-530):
- Finds the matching `mulligan:checkpoint:<name>` label in `branchEntries` and reads its `targetId`.
- Reverses `branchEntries` to **root→leaf** and filters to context-producing types.
- Walks `ctxEntries` in parallel with `messages`, summing `entryMessageYield` (1 each) until it hits
  the `targetId`; `iTarget = last message index of that entry`. Any compaction (yield -1) on the walked
  range → return `null` (refuse — RAW getBranch vs compaction-aware messages mismatch).
- Returns `{ remove: number[] }` = indices > iTarget, minus the rewind's own tool-call unit and any
  `mulligan:*` notes.

`filterPipeline(messages, markers, config, branchEntries?)` (lines ~990-1030):
- Applies rewinds oldest-first (by `seq`), each re-resolving against the current shrunk `messages`;
  checkpoint granularity calls `resolveCheckpoint(m, branchEntries, cpName, excludeId)`.
- Applies shrinks oldest-first after rewinds.
- Pure, defensive, never throws; non-array → `[]`.

---

## Architecture: how the pieces connect

```
turn lifecycle (agent-session.js)
  user input ─► assistant streams ─► [message_end:assistant] appendMessage ─► leaf = assistant msg (STABLE)
                                            │
                                            ▼
                                 tool batch executes execute()
                                            │  tools may call pi.appendEntry / pi.setLabel / pi.sendMessage
                                            │  each is SYNC and advances leaf
                                            ▼
                                  [message_end:toolResult] appendMessage ─► leaf = toolResult msg (STABLE)

session tree (session-manager.js)
  byId: Map<id, entry>   leafId: string|null
  every entry: { id, parentId, type, ... }
  getBranch() / buildSessionPath(): leaf ──parentId──► root, then reverse → root→leaf

LLM context (buildSessionContext)
  buildContextEntries(): root→leaf path, with compaction-aware truncation (latest compaction + kept tail)
  .flatMap(sessionEntryToContextMessages): 1 message per context-producing entry

pi-mulligan consumption
  ctx.sessionManager (ReadonlySessionManager) ──read──► getLeafId / getBranch / getEntry / getLabel
  pi (ExtensionAPI)            ──write──► appendEntry(custom) / setLabel(label) / sendMessage(custom_message)
  markers.ts   : leaf-capture idiom (append then getLeafId, same tick)
  transforms.ts: filterPipeline over event.messages using readMarkers + getBranch() for checkpoint resolution
```

---

## Start here

`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js` — read `_appendEntry`
(line 754), `getLeafId` (line 883), `getBranch` (line 943), `buildContextEntries` (line 198), and
`sessionEntryToContextMessages` (line 135). These five define the entire contract pi-mulligan depends on.
Then `src/transforms.ts:resolveCheckpoint` (line 445) is where the bugfix attention is focused.

---

## Open questions / residual risks

1. **getBranch ordering vs transforms.ts assumption (potential bug).** `getBranch()` returns
   **root→leaf** (it reverses). `src/transforms.ts:resolveCheckpoint` comment says it consumes
   `branchEntries` as **leaf→root** ("we reverse to root→leaf internally") and its first label-search
   loop (lines ~460-470) iterates the array expecting most-recent-first. If `branchEntries` is the
   raw `getBranch()` output (root→leaf), that loop picks the **oldest** checkpoint label, not the
   newest — and the `[...branchEntries].reverse()` later double-reverses to leaf→root. This needs
   verification against the actual call site that supplies `branchEntries` to `filterPipeline`/`resolveCheckpoint`
   (the "ctx" that feeds the context-event handler). If the caller already pre-reverses to leaf→root,
   the code is consistent; if it passes `getBranch()` verbatim, there is a latent ordering bug.
   Severity: **high** if unverified — checkpoint rewinds could target the wrong label.
2. **`appendRewindMarker` return value semantics.** It returns the **marker's own** entry id
   (the just-appended CustomEntry), not the leaf that preceded it. Any caller that treats the return as
   "the leaf at rewind time" (e.g. for checkpoint correlation) is off-by-one — it should use the
   marker's recorded ledger/note, or read `getEntry(returnedId).parentId` to get the prior leaf. The
   `NoteDetails.rewindId` correlation uses this id deliberately, which is correct.
3. **Compaction refusal in checkpoint resolution.** `resolveCheckpoint` returns `null` (no-op) if any
   compaction lies between root and the checkpoint target on the RAW getBranch path. This is safe but
   means a rewind-to-checkpoint silently does nothing once compaction has occurred on that span —
   confirm this matches the intended UX.
4. **Label leaf-advance.** `setCheckpoint` via `pi.setLabel` advances `leafId` to the label entry.
   Any subsequent `getLeafId()` in the same tool batch returns the label id, not the labeled message.
   `appendRewindMarker` capturing `getLeafId()` after a prior `setCheckpoint` in the same batch would
   capture the label id — verify rewind markers are never appended after a checkpoint in the same tick.