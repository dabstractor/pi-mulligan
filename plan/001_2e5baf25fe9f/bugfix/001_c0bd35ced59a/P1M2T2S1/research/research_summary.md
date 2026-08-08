# Research Summary — P1.M2.T2.S1 (`resolvePinnedHide`)

First-hand findings from reading the LIVE `src/transforms.ts` (1051 lines), `test/transforms.test.ts`,
`plan/.../bugfix/.../architecture/fix_design.md §Change 3`, and the parallel PRP `P1M2T1S1/PRP.md`.
All line numbers are against the current tree (verified: `npx tsc --noEmit` exit 0; transforms.test.ts 134 green).

## TL;DR — what the implementer needs

1. **`resolvePinnedHide` GENERALIZES `resolveCheckpoint`'s entry→message walk** (transforms.ts:454–526). It reuses
   the SAME two module-private helpers — `entryMessageYield` (549) and `isContextProducingType` (557) — which are
   **hoisted function declarations**, so resolvePinnedHide can be appended anywhere in the module and call them
   with no re-declaration (would be a TS duplicate-function error otherwise).
2. **The no-reverse convention OVERRIDES fix_design.md.** fix_design.md §Change 3 step 2 says
   `[...branchEntries].reverse() // root→leaf`, but **P1.M1.T1.S1 (Complete) already fixed `resolveCheckpoint` to
   NOT reverse** — `branchEntries` from `getBranch()` is ALREADY root→leaf. See the comment at transforms.ts:416
   ("ctxEntries = branchEntries directly (already root→leaf — getBranch() order; no internal reverse)") and
   transforms.ts:449 ("getBranch() output, ROOT→LEAF … no internal reverse needed"). **The item_description is
   authoritative**: "do NOT reverse — walk in the natural root→leaf order." Do NOT call `.reverse()`.
3. **resolvePinnedHide is SIMPLER than resolveCheckpoint.** No unit-snap (4b), no rewind-own exclusion, no
   mulligan-note exclusion, and it returns `number[]` (NOT `{ remove } | null`). Pairing safety comes from the
   PRODUCER (`captureHideEntryIds`, P1.M2.T3, resolves at UNIT level → pins the WHOLE unit's entry ids), not from
   this resolver. See §"Why simpler" below.
4. **Returns `[]` on ALL refusal/defensive cases** (never null). Compaction refusal happens via the
   `entryMessageYield` `-1` sentinel: compaction IS in `isContextProducingType`'s list (so it passes the filter)
   but `entryMessageYield` returns `-1` for it → `return []` (refuse safely). Identical to resolveCheckpoint's
   `return null` on the same sentinel, except resolvePinnedHide returns `[]`.
5. **The walk does NOT break at the first match** (unlike resolveCheckpoint, which breaks at the single checkpoint
   target). It walks the ENTIRE branch because a SET of entries may be pinned (e.g. a whole toolGroup = assistant +
   all its results = multiple entry ids).

## The reusable helpers (transforms.ts — module-private, hoisted)

```ts
// transforms.ts:549 — how many LLM messages does this branch entry produce?
function entryMessageYield(entry: unknown): number {
  const type = isRecord(entry) ? readOwn(entry, "type") : undefined;
  if (type === "message" || type === "custom_message" || type === "branch_summary") return 1;
  return -1; // compaction (indeterminate) OR unknown/non-context-producing → caller refuses
}

// transforms.ts:557 — is this entry type one that produces a context message?
function isContextProducingType(type: unknown): boolean {
  return type === "message" || type === "custom_message" || type === "branch_summary" || type === "compaction";
}
```
NOTE: `compaction` passes `isContextProducingType` but `entryMessageYield` returns `-1` for it → the walk refuses
on the FIRST compaction encountered (alignment indeterminate). This is the compaction-refusal mechanism (test (c)).

## The type to reuse (already exported)

```ts
// transforms.ts:394 — EXPORTED; a real Pi SessionEntry[] from getBranch() assigns in with NO cast.
export interface BranchEntry {
  type: string; id: string; parentId?: string | null; timestamp?: string;
  targetId?: string; label?: string; [key: string]: unknown;
}
```
`MessageLike` (transforms.ts:53) is also exported. resolvePinnedHide's signature:
`(messages: MessageLike[], branchEntries: BranchEntry[], hideEntryIds: string[]): number[]`.

## Why simpler than resolveCheckpoint (the load-bearing insight)

`resolveCheckpoint` removes **"everything after iTarget"** (a contiguous sweep) → it must:
- (4b) **unit-snap** iTarget to the end of its unit (else it orphans the checkpointed assistant's own toolResults);
- (5) **exclude the rewind's own unit** (keep the rewind call + its result);
- (5) **exclude mulligan:* custom messages** (keep the note/nudge).

`resolvePinnedHide` removes **EXACTLY the pinned entries** — a discrete set, not a sweep. So:
- NO unit-snap needed — pairing safety comes from the PRODUCER: `captureHideEntryIds` (P1.M2.T3) resolves at the
  UNIT level and pins the WHOLE unit's entry ids (assistant + all its results) → this resolver removes whole units
  by construction. (fix_design.md §Change 3: "the rewind tool's resolvePreview already resolves at the UNIT level …
  so the captured entry IDs correspond to whole units, not partial ones.")
- NO rewind-own / note exclusion needed — `hideEntryIds` contains only the TARGET span's ids, captured at
  marker-creation time (BEFORE the marker is persisted + the note sent; the rewind's own toolCall isn't recorded
  yet either). So neither the note nor the rewind's own call is ever in `hideEntryIds` → never walked as pinned.

## Placement

Append `resolvePinnedHide` immediately AFTER `isContextProducingType` (transforms.ts:557–559) and BEFORE the
`applyRewind` JSDoc (transforms.ts:561). It logically groups with `resolveCheckpoint` (the other entry→message
resolver) and sits right below the two helpers it reuses. `0 new imports` — it reuses `MessageLike` + `BranchEntry`
(already in module scope) + `isRecord`/`readOwn`/`entryMessageYield`/`isContextProducingType` (module-private).

## Test conventions to mirror (test/transforms.test.ts)

- Import line (line 2): add `resolvePinnedHide` to the existing long `import { … } from "../src/transforms.js"`.
- `BranchEntry` + `MessageLike` already imported (line 2).
- Message fixtures (hoisted, module-scope, lines 9–52): `user(t)`, `asst(...callIds)`, `result(toolCallId)`,
  `asstText(t)`, `custom(customType)`.
- `BranchEntry` fixture (line 738, hoisted): `entry(id, type, extra={}) → { type, id, parentId: null, timestamp: "t", ...extra }`.
- No `beforeEach` (pure, stateless).
- Branches built in ROOT→LEAF order (the test's own comment at line 748 confirms getBranch() is root→leaf).
- Convention: each context-producing entry yields exactly 1 message → `messages[k]` ↔ k-th context-producing entry.

## Traced correctness (the 5 contract cases + extras)

| Case | Input | Expected | Why |
|---|---|---|---|
| (a) basic | msgs=[u,asst(c1),result(c1)]; branch=[e1,e2,e3 msg]; hide=[e1,e3] | `[0,2]` | e1→idx0, e3→idx2 pushed; e2 skipped |
| (b) growth stability | msgs 4; branch=[e1,e2,e3,e4]; hide=[e1,e2] | `[0,1]` | new e3,e4 (idx2,3) NOT in hideSet → visible (permanence) |
| (c) compaction refusal | branch=[e1 msg, eC compaction, e2 msg]; hide=[e2] | `[]` | eC passes filter; entryMessageYield(eC)=-1 → return [] |
| (d) defensive | non-array messages/branch/hideEntryIds | `[]` | Array.isArray guards |
| (e) empty hideEntryIds | hide=[] | `[]` | length===0 guard |
| alignment loss | msgs=[u] (1); branch=[e1,e2]; hide=[e2] | `[]` | e2: msgCursor 1 + yield 1 = 2 > 1 → return [] |
| whole-toolGroup pairing | hide=[e_asst,e_result] | `[1,2]` | both pinned → both removed → no orphan |
| label id in hideEntryIds (caller error) | hide=[eL] where eL is a label entry | `[]` | label filtered out by isContextProducingType → never walked |

All traced by hand against the implementation in the PRP. ✓

## Parallel-task boundary

- **P1.M2.T1.S1** (in-flight, parallel) adds `hideEntryIds?: string[]` to `RewindMarker` (markers.ts) +
  `RewindMarkerLike` (transforms.ts:814). It has NOT landed yet (`grep hideEntryIds src/ test/` → empty at research
  time). **No conflict**: `resolvePinnedHide` takes `hideEntryIds: string[]` as a PLAIN parameter — it does not
  read the marker field. The field is read only by `filterPipeline` (P1.M2.T4) via `readOwn(rw, "hideEntryIds")`.
  So `resolvePinnedHide` compiles + tests green whether or not T1.S1 has landed.
- **Do NOT touch** `resolveCheckpoint` (P1.M1.T3.S1 owns it, Complete), `filterPipeline` dispatch (P1.M2.T4 owns it),
  `captureHideEntryIds` (P1.M2.T3 owns it), or `RewindMarkerLike` (P1.M2.T1.S1 owns it). This task ONLY adds the
  pure `resolvePinnedHide` function + its tests.