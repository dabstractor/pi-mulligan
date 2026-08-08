# Research notes — P1.M3.T3.S1: `resolveCheckpoint` (entry→message mapping)

Pure helper appended to `src/transforms.ts` (+ tests appended to `test/transforms.test.ts`). This note
captures the **verified** Pi reality that the algorithm must respect — above all the **compaction
discrepancy** between spec/06 §6 and the installed Pi types/runtime.

---

## 1. The contract (item description) — authoritative for THIS task

`resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?): { remove: number[] } | null`

- `messages: AgentMessage[]` (reuse `MessageLike[]`).
- `branchEntries: SessionEntry[]` from `getBranch()`, **leaf→root**, must reverse to **root→leaf**.
- `checkpointName: string`; `excludeToolCallId?: string`.
- **PURE**: take the data as params (NOT `ctx`). Define a minimal `SessionEntry`-like type locally.
- Algorithm in spec/06 §6 (the ONLY place Mulligan maps entries↔messages).
- Find `LabelEntry` with `label === "mulligan:checkpoint:<name>"`; its `targetId` is the checkpointed entry.
- Build ctxEntries = reversed branchEntries filtered to context-producing types
  (`message`, `custom_message`, `compaction`, `branch_summary`).
- Walk ctxEntries in parallel with messages, advancing message cursor by each entry's message-yield
  (message→1, custom_message→1, compaction→1+retainedTail.length, branch_summary→1). Stop at the
  checkpoint entry → cursor is `iTarget`. Remove all messages with index `> iTarget`, with the same
  tail-exclusion rules as `resolveLastTurn` (keep the rewind's own unit + `mulligan:` notes).
- **If mapping can't be determined (e.g. compaction entry lacks `retainedTail`), REFUSE SAFELY (return
  null) and log — never guess.**
- Consumed by `filterPipeline` (P1.M3.T5.S1). The actual entry data is passed in by `filter.ts`
  (P1.M4.T2.S1) reading `ctx.sessionManager.getBranch()`.

`filterPipeline` (spec/06 §12 pseudocode) consumes it as: `const res = resolveCheckpoint(m, ctx, rw.checkpoint); remove = res ? res.remove : [];`.
(Our real signature replaces `ctx` with `(branchEntries, checkpointName)`; `filter.ts` supplies the data.)

---

## 2. ★ CRITICAL: the compaction discrepancy (spec §6 vs installed Pi)

spec/06 §6 says compaction yields `1 + retainedTail.length` messages, and "if a compaction entry lacks
`retainedTail`, refuse safely." **The installed Pi has NO `retainedTail` field anywhere:**

`node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts` (lines 36–58):
```ts
export interface CompactionEntry<T = unknown> extends SessionEntryBase {
    type: "compaction";
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: T;
    usage?: Usage;
    fromHook?: boolean;
}   // ← NO retainedTail
export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
    type: "branch_summary";
    fromId: string;
    summary: string;
    details?: T; usage?: Usage; fromHook?: boolean;
}
```

Verified runtime yield — `sessionEntryToContextMessages` (session-manager.js L166–187):
```js
if (entry.type === "message")        return [message];                                  // 1
if (entry.type === "custom_message") return [createCustomMessage(...)];                 // 1
if (entry.type === "branch_summary" && entry.summary) return [createBranchSummaryMessage(...)]; // 1
if (entry.type === "compaction")     return [createCompactionSummaryMessage(entry.summary,...)]; // 1
return [];   // custom, label, thinking_level_change, model_change, session_info → 0
```

**So in real Pi, EVERY context-producing entry type yields EXACTLY 1 message.** The "retained tail" the
spec imagines are NOT inline on the compaction entry — they are SEPARATE kept entries that appear after
the compaction entry on the branch (kept via `firstKeptEntryId`).

### 2a. Why this still forces a REFUSE on compaction (not "just use yield=1")

`getBranch()` returns the **RAW** leaf→root path — **NOT** compaction-aware (verified: `getBranch`
@session-manager.js L943 delegates to `buildSessionPath` @L124, a plain parent-walk with NO compaction
filter). But `event.messages` (what the model sees) is built from the **compaction-aware**
`buildContextEntries(...).flatMap(sessionEntryToContextMessages)` (@L198–230):
`buildContextEntries` REPLACES the summarized head with `[compactionEntry, ...keptEntries(starting at
firstKeptEntryId), ...entriesAfterCompaction]` — the pre-compaction entries are **dropped**.

Therefore, for a branch that has compacted, the **raw** `getBranch()` contains EXTRA pre-compaction
entries that have **no** counterpart in `event.messages`. The entry↔message walk would be **offset by
that count** → a wrong `iTarget`. The spec §6 "refuse when indeterminate" rule is exactly right:
**encountering a compaction entry on the root→target walk makes the mapping indeterminate → REFUSE
(return null).** (Compaction *after* the checkpoint is never walked, because we stop at target — that
case stays aligned and is fine.)

This is the single most important correctness decision for this PRP. It is both spec-faithful (refuse
safely, never guess) and reality-correct (getBranch + compaction genuinely cannot align).

---

## 3. Entry type facts (verified from session-manager.d.ts)

```ts
interface SessionEntryBase { type: string; id: string; parentId: string | null; timestamp: string; }
interface LabelEntry extends SessionEntryBase { type: "label"; targetId: string; label: string | undefined; }
interface CustomMessageEntry { type: "custom_message"; customType: string; content; details?; display: boolean; }
interface CustomEntry { type: "custom"; customType: string; data?: unknown; }   // NOT in context (markers)
```
- `pi.setLabel(leafId, "mulligan:checkpoint:<name>")` → appends a `LabelEntry` whose `targetId === leafId`
  and `label === "mulligan:checkpoint:<name>"` (via `appendLabelChange(targetId, label)`).
- `mulligan:*` markers are `custom` entries → type "custom" → **filtered OUT** of ctxEntries (yield 0).
  They never disturb the walk. ✓
- The `LabelEntry` itself is type "label" → filtered out of ctxEntries too. We find it by scanning
  `branchEntries` (leaf→root, take first/most-recent match) for `type==="label" && label===prefix+name`.

### message-yield table (resolveCheckpoint uses)
| entry.type     | yield | note |
|----------------|-------|------|
| message        | 1     | |
| custom_message | 1     | the `mulligan:note` lives here (kept by tail-exclusion) |
| branch_summary | 1     | abandoned-branch summary; 1:1 with messages — SAFE |
| compaction     | **REFUSE** | raw getBranch misaligns; spec §6 "refuse if no retainedTail" |
| (all others)   | 0 / filtered out | label, custom, thinking_level_change, model_change, session_info |

---

## 4. Reusable symbols already in `src/transforms.ts` (module scope — NO new imports)

Verified by reading the file. resolveCheckpoint is APPENDED to the same module, so it reuses:
- `partitionIntoUnits(messages): Unit[]` (exported) — for the rewind's-own-unit detection.
- `assistantIssuedCall(messages, indices, callId): boolean` (**module-private**) — did this toolGroup's
  assistant issue `excludeToolCallId`? (reused verbatim by resolveLastTurn).
- `isMulliganCustomMessage(msg): boolean` (**module-private**) — `customType` startsWith `"mulligan:"`.
- `isRecord(value)` / `readOwn(obj, key)` (**module-private**) — defensive reads, never throw.
- `Unit`, `MessageLike` (exported types).

**File stays at 0 imports** (`grep -c '^import' src/transforms.ts` → 0). resolveCheckpoint adds:
- one EXPORTED type `BranchEntry` (minimal structural `SessionEntry`-like; a real `SessionEntry[]`
  assigns in with no cast) — mirrors how `MessageLike`/`Unit` are the shared structural input types.
- the EXPORTED `resolveCheckpoint` function.
- module-private helpers `entryMessageYield` + `isContextProducing` (or inline).

## 5. Test surface (verified)

- `test/transforms.test.ts` exists (732 lines). Import line (L2):
  `import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, type Unit, type MessageLike } from "../src/transforms.js";`
  → **EDIT** to add `resolveCheckpoint, type BranchEntry`.
- Existing fixture builders reusable: `asst`, `asstText`, `result`, `user`, `custom`, `summary`. For
  entries we add a tiny local `entry(...)`/`label(...)` builder (entries are NOT messages — a different
  shape), so the synthetic branch is hand-built and the `messages` array is built in parallel to match
  the 1:1 correspondence.
- Commands: `npx vitest run` (full), `npx vitest run test/transforms.test.ts` (this suite),
  `npx tsc --noEmit -p tsconfig.json` (types). package.json `"test": "vitest run"`.

## 6. Out of scope (deferred to later P1.M3 subtasks — do NOT implement here)
- `applyRewind` (T4.S1), `resolveShrinkTarget`/`applyShrink` (T4.S2), `filterPipeline`/`stableSortBySeq`/
  `protectedOk` (T5.S1). filterPipeline applies `protectedOk` as defense-in-depth — resolveCheckpoint
  itself takes NO config and does NOT enforce protectedRoles (matches resolveLastTurn's split; the
  contract's INPUT/LOGIC sections list no config param). E18 (protected) is filterPipeline's job.