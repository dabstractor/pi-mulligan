# Research Notes — P1.M1.T2.S1 (BUG-002: compaction-aware retained-tail walk in resolvePinnedHide)

## Target & the bug
`resolvePinnedHide` (src/transforms.ts:625–660). It walks `branchEntries` forward via `entryMessageYield`; when it
hits ANY compaction entry, `entryMessageYield` returns -1 (indeterminate) → the function returns `[]` (TOTAL
surrender). Since `isContextProducedType` INCLUDES 'compaction', compaction entries are ON the walked path. After
the FIRST auto-compaction, EVERY pinned rewind becomes a permanent no-op → hidden content reappears in the model's
filtered view → violates "permanent soft-delete" (PRD success criterion #1). Confirmed: architecture/system_context.md §BUG-002.

## Root cause (the getBranch vs event.messages mismatch)
- `getBranch()` returns the RAW path (root→leaf): compacted-away entries + the `compaction` entry + retained tail.
- `event.messages` is COMPACTION-AWARE: compaction summary + retained tail, NOT the compacted-away individuals.
- The 1:1 forward walk breaks past a compaction boundary. BUT entries AFTER the LAST compaction (the "retained tail")
  each (type message/custom_message/branch_summary) map to exactly 1 message, and map to the LAST N messages.
  → No `retainedTail` field exists on the compaction entry (external_deps.md §"compaction entry shape"), so the
  compacted-away set is unknowable from the entry alone — which is why the fix walks ONLY the retained tail.

## The fix (retained-tail walk) — algorithm
1. lastCompactionIdx = index of LAST entry with type === "compaction" (scan from END; -1 if none).
2. tailEntries = branchEntries.slice(lastCompactionIdx+1).filter(e => entryMessageYield(e) > 0)
   — message/custom_message/branch_summary ONLY (yield 1); EXCLUDES compaction (we are past it) + label/custom.
   (entryMessageYield is the cleanest predicate — returns 1 for exactly the 3 context-message types, -1 otherwise.)
3. tailStartIdx = messages.length - tailEntries.length. If < 0 → return [] (alignment lost — defensive).
4. Walk tailEntries forward: entry at position k → msgIdx = tailStartIdx + k. If entry.id ∈ hideSet → push msgIdx.
5. return remove (ascending by construction).
NO-compaction degenerate: lastCompactionIdx===-1 → tailEntries = ALL context-message entries, tailStartIdx =
messages.length - allEntries.length === 0 → IDENTICAL to the legacy forward walk (existing tests (a)/(b) stay green).

## CRITICAL: do NOT touch entryMessageYield / isContextProducingType
`resolveCheckpoint` (lines 454–540) REUSES both and KEEPS its bail-on-compaction (contiguous-sweep semantics —
its tests at lines 838–860 assert compaction-in-walked-range → null/refuse). Only resolvePinnedHide changes.
`resolvePinnedShrink` (lines 821–842) has the SAME bug but is T2.S2 (SEPARATE subtask) — DO NOT touch it.

## Call site (unchanged — signature preserved)
filterPipeline, src/transforms.ts:1364:
`const remove = resolvePinnedHide(messages, branch, hideEntryIdsRaw as string[]);`
Signature stays `(messages, branchEntries, hideEntryIds): number[]`. Returns number[] (NEVER null).

## Confirmed current code (resolvePinnedHide body, lines 633–660)
Steps 1–2 (defensive + hideSet) STAY. Steps 3–5 (ctxEntries filter + msgCursor forward walk with bail-on-`y<0`)
are REPLACED by the retained-tail walk. `entryMessageYield`/`isContextProducingType`/`isRecord`/`readOwn` reused.

## Test file & patterns (test/transforms.test.ts)
- Import line 2 includes resolvePinnedHide + BranchEntry + helpers.
- resolvePinnedHide describe block at line 1612: cases (a) basic [0,2], (b) growth permanence [0,1],
  (c) **compaction → []** (← ASSERTS THE BUG; MUST UPDATE to [1]), (d) defensive non-array→[], (e) empty→[].
- FIXTURE HELPERS (line 738): `entry(id, type, extra={}) → {type,id,parentId:null,timestamp:"t",...extra}`.
  `labelEntry(id, targetId, name)`. Message helpers: user/asst/result (used as user("u"), asst("c1"), result("c1")).
- TEMPLATE for compaction tests: resolveCheckpoint's compaction cases at lines 838–860 (entry("e_comp","compaction",
  {summary:"s", firstKeptEntryId:"e_user"})). Reuse the same `entry(...,"compaction",{summary:...})` shape.
- BranchEntry interface (line 394): {type:string, id:string, parentId?, timestamp?, targetId?, label?, [key]:unknown}.

## The ONE existing test that BREAKS (must update — single most important test instruction)
test (c) at ~1633: branch=[e1(msg),eC(compaction),e2(msg)], msgs=[user,asst], hide=[e2].
OLD expects []. After fix: lastCompactionIdx=1, tailEntries=[e2], tailStartIdx=2-1=1, e2→idx1 → returns [1].
UPDATE (c) to expect [1] AND rename to reflect "retained-tail hide WORKS post-compaction" (not "refusal").
(Tests (a)/(b)/(d)/(e) stay GREEN — verified by the no-compaction degenerate trace.)

## New compaction tests to ADD (the fix's proof + coverage)
1. PRODUCTION REPRO (BUG-002): msgs=[user, compactionSummary, asst, result(big)], branch=[e1(msg),c1(compaction),
   e3(msg),e4(msg)], hide=[e3,e4] → returns [2,3] (the retained-tail toolGroup; result(big) at idx3 IS hidden).
2. PINNED-IN-COMPACTED-HEAD: hide points at an entry in the compacted-away head (e.g. e1 above compaction) that is
   NOT in the retained tail → not matched → returns [] (correct — it's gone from messages; no leak, no error).
3. MULTIPLE COMPACTIONS: branch=[e1(msg),c1(compaction),e2(msg),c2(compaction),e3(msg)] → only LAST compaction
   matters; tailEntries=[e3]; hide=[e3]→returns last idx; hide=[e2]→[] (e2 was compacted away by c2).
4. NO-COMPACTION DEGENERATE (parity guard): branch of only message entries (no compaction) → identical to today.
5. DEFENSIVE tailStartIdx<0: msgs shorter than tailEntries.length → returns [] (alignment lost).

## Validation (project tooling — vitest + tsc)
- `npx vitest run test/transforms.test.ts` — all pass (incl. updated (c) + 5 new compaction cases).
- `npx vitest run` — full suite passes (filterPipeline/resolveCheckpoint/resolvePinnedShrink tests unaffected).
- `npx tsc --noEmit` — no new errors (signature unchanged; entryMessageYield reused as a predicate returns number).

## Scope discipline (do NOT touch)
- resolvePinnedShrink (821–842) — T2.S2 (separate subtask; same bug, mirror fix later).
- resolveCheckpoint (454–540) + entryMessageYield (549) + isContextProducingType (555) — KEEP bail-on-compaction.
- filter.ts, nudges.ts — previous PRP P1.M1.T1.S2 territory (suppressCheck; ZERO overlap with transforms.ts).
- applyRewind / applyShrink / filterPipeline body — unchanged (they consume the number[] as before).
- README/spec doc sync — separate changeset task.