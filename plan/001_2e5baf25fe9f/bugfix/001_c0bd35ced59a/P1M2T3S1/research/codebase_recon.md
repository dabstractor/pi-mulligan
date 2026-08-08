# Codebase Recon — P1.M2.T3.S1 (`captureHideEntryIds` + integrate into `resolvePreview`)

**Scope:** EDIT `src/tools/rewind.ts` (add a module-local `captureHideEntryIds` helper; thread `hideEntryIds`
through `resolvePreview` → `rewindExecute` step-7 payload → `RewindDetails`; add `type SessionEntry` to the Pi
import) + APPEND a `hideEntryIds` describe block to `test/tools/rewind.test.ts`. **No other file touched.** This is
the **PRODUCER** half of the permanent-hiding fix; the RESOLVER (`resolvePinnedHide`, P1.M2.T2.S1) and the DISPATCH
(`filterPipeline`, P1.M2.T4) are separate.

---

## 1. Dependency state (VERIFIED LIVE — all three upstream pieces have LANDED)

| Upstream piece | Plan item | On-disk state | Evidence |
|---|---|---|---|
| `hideEntryIds?: string[]` on `RewindMarker` / `RewindMarkerInput` | P1.M2.T1.S1 (Complete) | **PRESENT** | `src/markers.ts:74` (`hideEntryIds?: string[]`); `RewindMarkerInput = Omit<RewindMarker,…>` auto-propagates it |
| `hideEntryIds?: string[]` on `RewindMarkerLike` | P1.M2.T1.S1 (Complete) | **PRESENT** | `src/transforms.ts` (RewindMarkerLike) |
| `resolvePinnedHide(messages, branchEntries, hideEntryIds): number[]` | P1.M2.T2.S1 (Implementing → landed) | **PRESENT** | `src/transforms.ts:625` (`export function resolvePinnedHide`) |

So when MY task runs, `RewindMarkerInput` ALREADY has the typed optional `hideEntryIds` field → I can populate
`data.hideEntryIds` in the payload WITHOUT a cast for that field (the existing `checkpoint` field still needs the
`as RewindMarkerInput` cast because `checkpoint` is NOT in the frozen type — see GOTCHA #1).

**Baseline:** `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → **18 files / 676 tests green**
(rewind.test.ts = 40 tests).

---

## 2. What the spec/design pins (verbatim sources)

### 2.1 fix_design.md §Change 2 — captureHideEntryIds (THE authoritative algorithm)
```
entries = ctx.sessionManager.buildContextEntries()  // compaction-aware snapshot
messages = entries.flatMap(sessionEntryToContextMessages)
remove = resolveByGranularity(messages, ...)        // message indices (EXISTING code, unchanged)
// map remove indices → entry ids
hideEntryIds = []
cursor = 0
for each entry in entries:
  yield = sessionEntryToContextMessages(entry).length  // typically 1
  if any index in [cursor, cursor+yield) is in remove set:
    hideEntryIds.push(entry.id)
  cursor += yield
return hideEntryIds
```
**Key property (fix_design §Change 2):** "The removal set is resolved ONCE at creation time against the CURRENT
snapshot — the correct session state. The entry IDs are then stable forever." → permanent hiding.

### 2.2 item_description §LOGIC (the pinned helper signature + algorithm)
`captureHideEntryIds(entries, remove)` walks entries with a cursor; for each entry whose message index is in the
remove set, captures `entry.id`. The item's exact pseudocode:
```js
let cursor = 0; const ids = [];
for (const e of entries) {
  const yield = sessionEntryToContextMessages(e).length;
  for (let j = cursor; j < cursor + yield; j++) {
    if (remove.includes(j)) { if (e.id) ids.push(e.id); break; }
  }
  cursor += yield;
}
return ids;
```
("Each entry produces exactly 1 message (verified: message/custom_message/branch_summary → yield 1).")

### 2.3 item_description §OUTPUT / §DOCS
- "Every new rewind marker has hideEntryIds populated with the stable entry IDs of the messages to hide. The K
  preview still works (unchanged). Old code paths (ledger, mutation warning) are unaffected."
- "[Mode A] Update resolvePreview and rewindExecute JSDoc to document hideEntryIds capture. This rides WITH the work."
- "Update RewindDetails interface to include hideEntryIds for audit."
- "Test: mock ctx.sessionManager.buildContextEntries to return entries with known IDs; verify the marker persisted
  via appendEntry includes hideEntryIds matching the removed messages' entry IDs."

---

## 3. The current `resolvePreview` (src/tools/rewind.ts — VERIFIED, ~lines 290–308)

```ts
function resolvePreview(
  ctx: ExtensionContext,
  params: RewindArgs,
  toolCallId: string,
): { ledger: FileLedger; k: number } {
  const entries = ctx.sessionManager.buildContextEntries(); // snapshot, compaction-aware
  const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];

  let remove: number[];
  if (params.granularity === "last_tool_call_group") {
    const units = partitionIntoUnits(messages);
    remove = resolveLastToolCallGroup(units, messages, toolCallId) ?? [];
  } else if (params.granularity === "last_turn") {
    remove = resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove;
  } else {
    const branchEntries = ctx.sessionManager.getBranch() as BranchEntry[];
    remove = resolveCheckpoint(messages, branchEntries, params.checkpoint ?? "", toolCallId)?.remove ?? [];
  }
  const ledger = extractFileLedger(messages, remove);
  return { ledger, k: remove.length };
}
```
**The fix's seam:** `entries` (buildContextEntries output) + `remove` (resolved indices) are BOTH already in scope
here. `captureHideEntryIds(entries, remove)` is computed from the SAME two values. The `messages` array was built by
`entries.flatMap(sessionEntryToContextMessages)`, so the index→entry mapping is EXACT BY CONSTRUCTION (the cursor
walk with `sessionEntryToContextMessages(e).length` reproduces the flatMap).

## 4. The current `rewindExecute` step-5/7 region (src/tools/rewind.ts — VERIFIED)

```ts
// step 5 (best-effort preview):
let ledger: FileLedger;
let k: number;
try {
  ({ ledger, k } = resolvePreview(ctx, params, toolCallId));
} catch {
  ledger = emptyLedger();
  k = 0;
}
// ... step 6 render ...
// step 7 (persist):
const payload = {
  granularity,
  options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
  excludeToolCallId: toolCallId,
  note: params.note,
  ledger,
  checkpoint: params.checkpoint, // GOTCHA #1: persists even when undefined (cast below)
};
const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);
// step 9 (return):
return { content: [{ type: "text", text }], details: { granularity, k, ledger, markerId } };
```
**Integration:** destructure `hideEntryIds` from resolvePreview; default `hideEntryIds = []` in the catch (snapshot
failure → E13/E8 best-effort); add `hideEntryIds` to the payload (typed now — no cast needed for it); add it to
`details` for audit.

## 5. The wrapper spread (src/markers.ts:166 — VERIFIED, DO NOT TOUCH)

```ts
const entry: RewindMarker = { ...data, schema:"pi-mulligan", v:1, kind:"rewind", id: randomUUID(), seq, ts: Date.now() };
pi.appendEntry("mulligan:rewind", entry);
```
`{ ...data }` spreads EVERY field in `data` (RewindMarkerInput) into the persisted entry. Once `hideEntryIds` is in
the payload object AND `RewindMarkerInput` has the field (it does — P1.M2.T1.S1), the wrapper persists it with NO
edit to `appendRewindMarker`. (The `checkpoint` precedent already rides this exact mechanism.)

---

## 6. Pi type facts (VERIFIED against /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist)

- `session-manager.d.ts:17` — `interface SessionEntryBase { type: string; id: string; parentId: string|null; timestamp: string; }`.
  → **EVERY `SessionEntry` has `id: string` (required, stable UUID).** `e.id` is directly accessible + typed `string`.
- `session-manager.d.ts:105` — `type SessionEntry = SessionMessageEntry | ThinkingLevelChangeEntry | … | LabelEntry | SessionInfoEntry`.
- `session-manager.d.ts:160` — `buildContextEntries(entries, leafId?, byId?): SessionEntry[]` (the standalone fn);
  `:266` — `buildContextEntries(): SessionEntry[]` (the method on SessionManager → what `ctx.sessionManager.buildContextEntries()` returns).
- `session-manager.d.ts:151` — `sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[]`.
- `index.d.ts:19` — `SessionEntry` IS exported (`export { type SessionEntry, … }`).
→ **Type the `captureHideEntryIds` entries param as `SessionEntry[]`** by adding `type SessionEntry` to rewind.ts's
  existing Pi import block (rewind.ts is NOT Pi-free — it already imports from Pi; no zero-imports gate here).

## 7. Test conventions (test/tools/rewind.test.ts — VERIFIED, 40 tests)

- vitest; hand-rolled `makePi()` / `makeCtx()` fakes (NO `vi.fn()`); `.js` import paths; `expectTypeOf`.
- `beforeEach/afterEach` → `clearAll()` + `setConfig(undefined)` (nextSeq mutates shared runtime map; config cache resets).
- `makeCtx({ contextEntries })` scripts `buildContextEntries()` → returns those entries; the REAL
  `sessionEntryToContextMessages` flattens them to messages inside `resolvePreview`.
- **`msgEntry(message)` uses a RANDOM id** (`e-${Math.random()…}`). For `hideEntryIds` tests I need DETERMINISTIC,
  known ids → ADD a `msgEntryId(id, message)` helper (do NOT mutate the existing `msgEntry` — other tests rely on it).
- The persisted marker is asserted via `(appended[0].data as RewindMarker).<field>`; `appended[0].data` IS the entry
  object that went through `{ ...data, … }` → so `hideEntryIds` appears on it directly.
- Result `details` is asserted via `res.details.<field>`.

## 8. Producer ↔ Resolver alignment (why captureHideEntryIds is correct by construction)

- **At capture time (THIS task):** `messages = entries.flatMap(sessionEntryToContextMessages)`; `remove` = resolved
  indices INTO `messages`; `captureHideEntryIds(entries, remove)` walks the SAME `entries` reproducing the flatMap
  (cursor += sessionEntryToContextMessages(e).length). So entry `e` ↔ messages[cursor..cursor+yield) EXACTLY. The
  captured `e.id` is the stable id of the entry that produced the removed message(s).
- **At filter time (resolvePinnedHide, P1.M2.T2 — landed):** walks `getBranch()` (root→leaf) against
  `event.messages` with `entryMessageYield` (1 for message/custom_message/branch_summary); matches by id. Entry ids
  are stable Pi UUIDs; buildContextEntries() and getBranch() surface the same entries in root→leaf order → the
  captured ids ARE found. (Compaction divergence → resolvePinnedHide refuses [] — the resolver's safety, not the
  producer's.) **My task's job is ONLY to capture the right ids at creation time.**

## 9. Design decisions (the K=0 / snapshot-failure edge cases)

- **`hideEntryIds` is ALWAYS set on new markers** (the contract: "Every new rewind marker has hideEntryIds
  populated"). For `remove=[]` (K=0) it is `[]`; for snapshot failure (catch) it is `[]`. The DISPATCH (P1.M2.T4)
  treats `Array.isArray(hideEntryIds) && hideEntryIds.length > 0` as "use pinned path"; `[]`/undefined → legacy
  relative fallback. For K=0 / snapshot-failure rewinds there was nothing to hide at creation time, so legacy
  fallback is acceptable (the core BUG-001/002 fix applies to the COMMON K>0 case where hideEntryIds is non-empty).
  This is the dispatch's concern (T4), NOT mine — I just persist what `captureHideEntryIds` returns.
- **`captureHideEntryIds` does NOT need its own try/catch.** It is called inside `resolvePreview`, which is inside
  `rewindExecute`'s try/catch → any throw (e.g. `sessionEntryToContextMessages` on a malformed entry) propagates to
  the catch → `hideEntryIds=[]` + emptyLedger + K=0 + the rewind STILL proceeds (E13/E8). Per-entry try/catch would
  RISK misaligning the cursor (a throwing entry that actually yields messages would shift the mapping) — AVOID it.
- **Light input guard only:** `if (!Array.isArray(entries) || !Array.isArray(remove)) return [];` (cheap, clear).
  Read `e.id` directly (typed `string`); guard with `if (e.id)` (empty-string safety, matches the item pseudocode).

## 10. Parallel-task boundary (do NOT collide)

- **P1.M2.T2.S1 (resolvePinnedHide)** — landed in `src/transforms.ts` (line 625). MY task does NOT touch
  transforms.ts. The resolver consumes `hideEntryIds` as a plain param — no dependency on the producer at the fn level.
- **P1.M2.T4.S1 (filterPipeline dispatch)** — NOT landed (Planned). MY task does NOT touch it. The dispatch will read
  `readOwn(rw, "hideEntryIds")` off the persisted marker; my task ENSURES that field is populated.
- **P1.M2.T1.S1 (data model)** — landed. `RewindMarkerInput.hideEntryIds` exists. My payload edit is type-safe.
- MY edits are CONFINED to `src/tools/rewind.ts` + `test/tools/rewind.test.ts`. No collision with any other in-flight task.