# PRP — P1.M1.T2.S1: Compaction-aware retained-tail walk in `resolvePinnedHide` (BUG-002 fix)

---

## Goal

**Feature Goal**: Fix BUG-002 — after the first auto-compaction in a session, `resolvePinnedHide` currently returns `[]` (total surrender) the instant its forward walk hits ANY compaction entry, making EVERY pinned rewind a permanent no-op and leaking hidden content back into the model's view. Replace the forward-walk-with-bail algorithm with a **retained-tail walk**: find the LAST compaction entry on the branch, take the entries AFTER it (the retained tail), map that tail to the LAST `tailEntries.length` messages in the compaction-aware `event.messages`, and hide exactly the pinned entries found there. Entries pinned in the compacted-away head are correctly unmatched (they're absent from messages).

**Deliverable**:
1. `src/transforms.ts` (MODIFY) — rewrite the body of `resolvePinnedHide` (lines 625–660). Steps 1–2 (defensive checks + `hideSet`) STAY; steps 3–5 (the `ctxEntries` filter + `msgCursor` forward walk with `if (y < 0) return []` bail) are REPLACED by the retained-tail walk. Signature `(messages, branchEntries, hideEntryIds): number[]` is UNCHANGED. Rewrite the JSDoc to document the retained-tail algorithm + spec/08 E24 (Mode A).
2. `test/transforms.test.ts` (MODIFY) — **update existing test (c)** (line ~1633) which currently asserts the BUGGY `[]` return, and **add ~5 new compaction test cases** (production repro, pinned-in-head, multiple-compactions, no-compaction parity, defensive `tailStartIdx<0`) in the existing `resolvePinnedHide` describe block (line 1612).

**Success Definition**:
- `resolvePinnedHide([user, compactionSummary, asst, result(big)], [e1(msg), c1(compaction), e3(msg), e4(msg)], ["e3","e4"])` returns `[2, 3]` (the retained-tail toolGroup — was `[]` before the fix; BUG-002 repro).
- The existing no-compaction tests (a) `[0,2]` and (b) `[0,1]` STILL pass (the no-compaction case degenerates to the legacy walk: `tailStartIdx === 0`).
- The defensive tests (d) non-array → `[]` and (e) empty `hideEntryIds` → `[]` STILL pass (steps 1–2 unchanged).
- `resolveCheckpoint` STILL refuses on compaction-in-walked-range (its tests at lines 838–860 unchanged — I do NOT touch `entryMessageYield`/`isContextProducingType`).
- `npx vitest run test/transforms.test.ts` — all pass. `npx vitest run` — full suite passes. `npx tsc --noEmit` — no new errors.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers + the agent relying on pinned rewinds (the production hide path) in long sessions where Pi auto-compacts context.

**Use Case**: A long session triggers Pi's first auto-compaction. A pinned rewind whose `hideEntryIds` target entries in the retained tail must KEEP hiding that content on every subsequent inference.

**User Journey**: Agent rewinds a bloated tool result → `captureHideEntryIds` pins the entry IDs → session auto-compacts later → next context fire → `resolvePinnedHide` now walks the retained tail (not bailing on the compaction entry) → returns the correct message indices → `applyRewind` removes them → the hidden content stays hidden (permanent soft-delete honored).

**Pain Points Addressed**: Post-compaction, pinned hides silently no-op'd, so previously-hidden content reappeared verbatim in the model's view on every inference — directly violating PRD success criterion #1 ("shed it so that no subsequent inference sees it") and the "permanent soft-delete" guarantee.

## Why

- **Business value / user impact**: Major (BUG-002). Pinned rewinds are the production hide path; compaction is a routine Pi event in long sessions. The bug silently disabled the project's core "permanent soft-delete" guarantee for the entire rest of any session after the first compaction.
- **Integration with existing features**: `resolvePinnedHide` is consumed by `filterPipeline` (src/transforms.ts:1364) on every context fire. The fix is internal (same signature, same `number[]` return contract); `filterPipeline`/`applyRewind` are unchanged. `resolveCheckpoint` keeps its bail-on-compaction (contiguous-sweep semantics) — I do NOT touch the shared `entryMessageYield`/`isContextProducingType` helpers.
- **Problems this solves and for whom**: For the agent/developer — pinned hides survive compaction. For maintainers — one canonical retained-tail algorithm that the sibling `resolvePinnedShrink` (T2.S2) will mirror.
- **Scope boundary (CRITICAL)**: This task is `resolvePinnedHide` ONLY. `resolvePinnedShrink` (lines 821–842, same bug) is P1.M1.T2.S2 — a SEPARATE subtask. `resolveCheckpoint`/`entryMessageYield`/`isContextProducingType` are UNCHANGED. The previous PRP (P1.M1.T1.S2) touches `src/filter.ts`/`src/nudges.ts` — ZERO overlap with `src/transforms.ts`.

## What

User-visible behavior: after a compaction, pinned rewinds whose targets are in the retained tail now correctly hide those messages (previously leaked). Pinned targets in the compacted-away head are correctly unmatched (return `[]` — they're gone from messages; no leak, no error). No-compaction sessions behave identically to today (degenerate to the legacy forward walk).

### Success Criteria

- [ ] `resolvePinnedHide` finds `lastCompactionIdx` (LAST `type === "compaction"` entry; -1 if none), builds `tailEntries` from `branchEntries.slice(lastCompactionIdx + 1)` filtered to `entryMessageYield(e) > 0` (message/custom_message/branch_summary), computes `tailStartIdx = messages.length - tailEntries.length`, returns `[]` if `tailStartIdx < 0`, else walks the tail pushing `tailStartIdx + k` for each pinned entry.
- [ ] Signature/return type UNCHANGED: `(messages, branchEntries, hideEntryIds): number[]` (never `null`); `filterPipeline:1364` call site untouched.
- [ ] `entryMessageYield`, `isContextProducingType`, `resolveCheckpoint`, `resolvePinnedShrink` are UNCHANGED.
- [ ] Existing tests (a)/(b)/(d)/(e) stay green; test (c) is updated from `[]` to the correct post-fix return; ~5 new compaction cases added.
- [ ] `npx vitest run test/transforms.test.ts`, `npx vitest run`, `npx tsc --noEmit` all pass (no new errors).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — **YES.** This PRP contains the verbatim current function body, the verbatim target body, the exact one-test-that-breaks + its update, the new test cases with traced expected values, the `entry()` fixture helper, the BranchEntry shape, the algorithm traces (including the no-compaction degenerate case proving tests (a)/(b) stay green), and the hard constraint to NOT touch the shared helpers. No external documentation is required.

### Documentation & References

```yaml
# MUST READ — the file being fixed (the function + the shared helpers + the call site are all here)
- file: src/transforms.ts
  why: "THE file. resolvePinnedHide = lines 625–660 (body 633–660). Shared helpers REUSED (do NOT change): entryMessageYield (549–554, returns 1 for message/custom_message/branch_summary, -1 for compaction/other); isContextProducingType (555–557); isRecord/readOwn (module-private). The call site = filterPipeline line 1364 `resolvePinnedHide(messages, branch, hideEntryIdsRaw as string[])`. resolvePinnedShrink (821–842) is T2.S2 — DO NOT TOUCH. resolveCheckpoint (454–540) KEEPS bail-on-compaction — DO NOT TOUCH."
  pattern: "CURRENT steps 3–5: ctxEntries = branchEntries.filter(isContextProducingType) (INCLUDES compaction); forward walk with msgCursor; `if (entryMessageYield(e) < 0) return []` BAILS on compaction. TARGET: find lastCompactionIdx; tailEntries = branchEntries.slice(lastCompactionIdx+1).filter(e => entryMessageYield(e) > 0); tailStartIdx = messages.length - tailEntries.length; walk tail pushing tailStartIdx+k for pinned."
  gotcha: "Reuse entryMessageYield as the tail filter predicate (`entryMessageYield(e) > 0`) — it returns 1 for EXACTLY message/custom_message/branch_summary and -1 otherwise, so it EXCLUDES compaction/label/custom in one call. Do NOT call isContextProducingType for the tail filter (it INCLUDES compaction — wrong for the tail). isContextProducingType/entryMessageYield themselves are UNCHANGED (resolveCheckpoint still needs them)."

# MUST READ — the root-cause synthesis + the exact algorithm sketch
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: "§BUG-002 gives the root cause (getBranch raw vs event.messages compaction-aware), the 'Why Compaction Breaks Alignment' explanation, and the EXACT retained-tail algorithm sketch (steps 1–6) this PRP implements. Confirms entryMessageYield/isContextProducingType are NOT changed (resolveCheckpoint needs them) and that resolvePinnedShrink has the SAME bug (T2.S2)."
  critical: "The 'retained tail maps to the LAST tailEntries.length messages' insight is the entire fix. tailStartIdx = messages.length - tailEntries.length. The no-compaction case degenerates to the current forward walk (all entries are the retained tail; tailStartIdx === 0)."

# MUST READ — the getBranch vs event.messages distinction (the bug's foundation)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/external_deps.md
  why: "§'Critical Distinction: getBranch() vs event.messages' + the compaction-entry shape. getBranch() = RAW path (compacted-away entries + compaction entry + retained tail). event.messages = compaction-aware (summary + retained tail). Confirms the compaction entry has NO retainedTail field (external_deps §'compaction entry shape'), so the compacted-away set is unknowable from the entry → MUST walk only the retained tail."
  critical: "BranchEntry.type is a plain string ('message'|'custom_message'|'compaction'|'branch_summary'|'label'|'custom'|...). The compaction entry carries `summary`/`firstKeptEntryId` (read defensively via readOwn/[key]:unknown)."

# MUST READ — the test file (the function + helpers + the test that breaks)
- file: test/transforms.test.ts
  why: "THE test file. resolvePinnedHide describe block at line 1612 (cases a–e + types at 1719). FIXTURE HELPERS at line 738: `entry(id, type, extra={}) → {type,id,parentId:null,timestamp:'t',...extra}` and `labelEntry(...)`. Message helpers: user()/asst()/result() (e.g. user('u'), asst('c1'), result('c1')). BranchEntry imported (line 2)."
  pattern: "resolveCheckpoint's compaction tests at lines 838–860 are the TEMPLATE for compaction fixtures: `entry('e_comp','compaction',{summary:'s', firstKeptEntryId:'e_user'})`. Mirror that shape. The existing test (c) at ~1633 asserts the BUGGY [] — it MUST be updated (see Task 3)."
  critical: "Test (c) is the ONE existing test that breaks: branch=[e1(msg),eC(compaction),e2(msg)], msgs=[user,asst], hide=['e2']. OLD expects []; AFTER fix lastCompactionIdx=1, tailEntries=[e2], tailStartIdx=2-1=1, e2→idx1 → returns [1]. Tests (a)/(b)/(d)/(e) stay GREEN (verified by the no-compaction + defensive traces)."

# CONTEXT — the spec framing (upgrade a KNOWN LIMITATION to a real fix)
- file: spec/08-edge-cases.md
  why: "E24 'Pinned hide no-ops under compaction (KNOWN LIMITATION; leak, not replay)' frames the OLD (buggy) behavior as an accepted limitation. The JSDoc rewrite (Mode A) should note the fix UPGRADES E24: retained-tail hides now WORK post-compaction; only entries in the compacted-away head are unmatched (correct)."
  critical: "E24 is a leak, not a replay — so the fix is pure correctness (hidden content stays hidden); no new pairing/serialization risk."

# CONTEXT — the sibling PRP (no overlap; confirms transforms.ts is mine alone)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M1T1S2/PRP.md
  why: "CONTRACT for BUG-001 (suppressCheck). Confirms it touches src/filter.ts:319 + src/nudges.ts ONLY — ZERO overlap with src/transforms.ts. No merge-conflict risk with this task."
  critical: "Do NOT touch filter.ts or nudges.ts (previous task's territory). This task is transforms.ts ONLY."
```

### Current Codebase tree (the relevant slice)

```bash
src/
  transforms.ts   # ← MODIFY: resolvePinnedHide body (633–660) → retained-tail walk; JSDoc rewrite (562–624)
                   #   REUSED unchanged: entryMessageYield (549), isContextProducingType (555), resolveCheckpoint (454–540),
                   #   resolvePinnedShrink (821–842, T2.S2's), filterPipeline call site (1364), applyRewind, isRecord/readOwn
test/
  transforms.test.ts   # ← MODIFY: update test (c) (~1633); add ~5 compaction cases in the describe block (1612)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This subtask MODIFIES exactly two existing files:
src/transforms.ts        # resolvePinnedHide body (633–660) rewritten; JSDoc (562–624) rewritten (Mode A)
test/transforms.test.ts  # update test (c); add ~5 new compaction it(...) cases
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (ONE existing test breaks — test (c) MUST be updated, not just added-to).
//   test/transforms.test.ts (~line 1633) currently ASSERTS THE BUG: branch=[e1(msg),eC(compaction),e2(msg)],
//   msgs=[user,asst], hide=['e2'] → expects []. After the fix this returns [1] (e2 is in the retained tail:
//   lastCompactionIdx=1, tailEntries=[e2], tailStartIdx=2-1=1, e2↔messages[1]). If you forget to update (c),
//   `npx vitest run test/transforms.test.ts` FAILS on (c). Update (c)'s expectation to [1] AND rename it to
//   reflect "retained-tail hide WORKS post-compaction" (the old title said "compaction refusal").

// CRITICAL GOTCHA #2 (use entryMessageYield as the tail filter predicate, NOT isContextProducingType).
//   isContextProducingType INCLUDES 'compaction' (wrong for the retained tail — we are PAST compaction).
//   entryMessageYield returns 1 for EXACTLY {message, custom_message, branch_summary} and -1 otherwise, so
//   `tailEntries = branchEntries.slice(lastCompactionIdx+1).filter(e => entryMessageYield(e) > 0)` is the
//   clean one-call filter. (Because lastCompactionIdx is the LAST compaction, the slice range contains no
//   compaction anyway — but filtering with entryMessageYield>0 is correct AND self-documenting.)

// CRITICAL GOTCHA #3 (do NOT touch entryMessageYield / isContextProducingType / resolveCheckpoint / resolvePinnedShrink).
//   resolveCheckpoint (454–540) REUSES entryMessageYield + isContextProducingType and KEEPS its bail-on-compaction
//   (contiguous-sweep semantics — its tests at 838–860 assert compaction-in-walked-range → null/refuse). Only
//   resolvePinnedHide changes here. resolvePinnedShrink (821–842) has the SAME bug but is T2.S2 (separate subtask).
//   Touching any of these crosses task boundaries and breaks resolveCheckpoint's tested contract.

// CRITICAL GOTCHA #4 (the no-compaction case MUST degenerate to the legacy walk — prove tests (a)/(b) stay green).
//   When lastCompactionIdx === -1: tailEntries = ALL context-message entries (slice(0).filter(yield>0));
//   tailStartIdx = messages.length - tailEntries.length. In a well-aligned no-compaction branch every context
//   entry yields exactly 1 message → tailEntries.length === messages.length → tailStartIdx === 0 → entry k ↔
//   messages[k]. This is IDENTICAL to the old msgCursor=0 forward walk. (Trace (a): [e1,e2,e3],3 msgs,hide[e1,e3]
//   → tailStartIdx 0 → [0,2] ✓. (b): grown [e1..e4],4 msgs,hide[e1,e2] → [0,1] ✓.)

// CRITICAL GOTCHA #5 (signature + return type UNCHANGED — filterPipeline:1364 call site untouched).
//   Keep `export function resolvePinnedHide(messages: MessageLike[], branchEntries: BranchEntry[], hideEntryIds:
//   string[]): number[]`. Return number[] (NEVER null) — [] is the documented idempotent no-op for applyRewind.
//   Returning [] (not null) is INTENTIONAL: a refused pinned hide must NOT fall back to legacy relative resolution
//   (that re-introduces BUG-001/BUG-002). filterPipeline already dispatches hideEntryIds BEFORE legacy fallback.

// CRITICAL GOTCHA #6 (tailStartIdx < 0 is the defensive alignment-loss guard — keep it).
//   If tailEntries.length > messages.length (raw branch vs compaction-aware messages misalign beyond recovery),
//   return [] (refuse safely; marker persists; content not hidden this fire; no crash). This replaces the old
//   `if (msgCursor + y > messages.length) return []` guard — same intent, computed up-front from the tail length.

// CRITICAL GOTCHA #7 (the walk pushes tailStartIdx + k, NOT a running msgCursor).
//   The retained tail maps to the LAST N messages, so entry at tail-position k ↔ messages[tailStartIdx + k].
//   There is no per-entry `msgCursor += yield` increment in the new algorithm — the offset is computed once
//   (tailStartIdx) and k is the forEach index. (Each retained-tail entry yields exactly 1 message, so k IS the
//   message offset within the tail — no yield loop needed, unlike the old `for (j=msgCursor; j<msgCursor+y; j++)`.)

// CRITICAL GOTCHA #8 (NEVER throws; purity; isRecord/readOwn for every field read — unchanged discipline).
//   resolvePinnedHide sits on the context-handler hot path via filterPipeline (E13 fail-open). Every type/id read
//   goes through isRecord + readOwn (defensive against malformed/non-record/Proxy entries). NEVER imports Pi.
//   The new lastCompactionIdx scan and tailEntries filter must use the SAME isRecord/readOwn discipline.
```

---

## Implementation Blueprint

### Data models and structure

**No data-model changes.** The `BranchEntry` interface (line 394: `{type: string, id: string, parentId?, timestamp?, targetId?, label?, [key]: unknown}`), `MessageLike`, and the function signature are all UNCHANGED. The fix is a pure algorithm swap inside the function body.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE src/transforms.ts:633–660 — resolvePinnedHide body (retained-tail walk)
  - KEEP steps 1–2 VERBATIM (defensive array checks + hideSet build):
      if (!Array.isArray(messages) || !Array.isArray(branchEntries) || !Array.isArray(hideEntryIds)) return [];
      if (hideEntryIds.length === 0) return [];
      const hideSet = new Set<string>();
      for (const id of hideEntryIds) { if (typeof id === "string" && id.length > 0) hideSet.add(id); }
      if (hideSet.size === 0) return [];
  - REPLACE steps 3–5 (ctxEntries + msgCursor forward walk + bail) WITH the retained-tail walk:
      // 3) RETAINED-TAIL WALK (compaction-aware; fixes BUG-002). getBranch() is the RAW path (carries
      //    compacted-away entries + the compaction entry); event.messages is compaction-aware. The entries
      //    AFTER the LAST compaction are the "retained tail" and map 1:1 to the LAST tailEntries.length messages.
      //    resolveCheckpoint keeps its bail-on-compaction (contiguous-sweep) — it is NOT touched.
      let lastCompactionIdx = -1;
      for (let i = branchEntries.length - 1; i >= 0; i--) {
        const t = isRecord(branchEntries[i]) ? readOwn(branchEntries[i], "type") : undefined;
        if (t === "compaction") { lastCompactionIdx = i; break; }
      }
      // 4) tailEntries = retained tail (entries AFTER the last compaction), context-message types ONLY.
      const tailEntries = branchEntries
        .slice(lastCompactionIdx + 1)
        .filter((e) => entryMessageYield(e) > 0); // message/custom_message/branch_summary (yield 1); excludes compaction/label/custom
      // 5) Retained tail ↔ the LAST tailEntries.length messages. If the tail is longer than messages → refuse.
      const tailStartIdx = messages.length - tailEntries.length;
      if (tailStartIdx < 0) return []; // defensive: raw branch vs compaction-aware messages misalign
      // 6) Walk the tail; hide exactly the pinned entries. No-compaction case: tailStartIdx === 0 (legacy walk).
      const remove: number[] = [];
      tailEntries.forEach((e, k) => {
        const id = isRecord(e) ? readOwn(e, "id") : undefined;
        if (typeof id === "string" && hideSet.has(id)) {
          remove.push(tailStartIdx + k); // this entry ↔ messages[tailStartIdx + k]
        }
      });
      // 7) Ascending by construction (tail walk is root→leaf; msgIdx monotonic).
      return remove;
  - PRESERVE: the function signature, the return type number[], steps 1–2, the `export`. Reuse entryMessageYield
    (filter predicate) + isRecord/readOwn. (GOTCHA #2, #5, #6, #7, #8.)
  - NAMING: `lastCompactionIdx`, `tailEntries`, `tailStartIdx`, `remove`, `k`. No new imports.
  - DEPENDENCIES: none.

Task 2: REWRITE src/transforms.ts:562–624 — the resolvePinnedHide JSDoc (Mode A docs)
  - The current JSDoc documents the OLD algorithm (step 3 "ctxEntries filtered to context-producing types
    (…INCLUDES compaction)"; step 4 "yield = entryMessageYield(entry); if yield < 0 → return [] (compaction/unknown
    on the walk → alignment INDETERMINATE → refuse safely)"). REWRITE the ALGORITHM section to document the
    retained-tail walk:
      * Find lastCompactionIdx (LAST compaction entry; -1 if none).
      * tailEntries = entries AFTER it, context-message types only.
      * Retained tail ↔ the LAST tailEntries.length messages (tailStartIdx = messages.length - tailEntries.length).
      * Walk the tail; hide pinned entries; entries in the compacted-away head are correctly unmatched (absent
        from messages). tailStartIdx < 0 → [] (defensive).
      * No-compaction case degenerates to the legacy forward walk (tailStartIdx === 0).
  - ADD a note: this UPGRADES spec/08 E24 ("KNOWN LIMITATION") — retained-tail hides now WORK post-compaction;
    only compacted-head entries no-op (correct). Reference §BUG-002 (system_context) + external_deps
    (getBranch vs event.messages) + E24.
  - KEEP: the "WHY PINNED IDS" section, the "WHY NO UNIT-SNAP" section, the RETURNS/purity/defensive notes
    (still number[]; never null; isRecord/readOwn; never imports Pi; hot-path fail-open). Update only the
    ALGORITHM section + add the E24/BUG-002 note.
  - GOTCHA: JSDoc only — do not change the signature, return type, or any code. (GOTCHA #5, #8.)
  - DEPENDENCIES: Task 1.

Task 3: UPDATE test/transforms.test.ts — fix the ONE breaking test (c) (~line 1633)
  - LOCATE (verbatim, the buggy-assertion test):
      it("(c) compaction refusal — a branch containing a compaction entry → [] (entryMessageYield returns -1 → refuse)", () => {
        const msgs: MessageLike[] = [user("u"), asst("c1")];
        const branch: BranchEntry[] = [
          entry("e1", "message"), entry("eC", "compaction"), entry("e2", "message"),
        ];
        expect(resolvePinnedHide(msgs, branch, ["e2"])).toEqual([]); // alignment INDETERMINATE → refuse safely
      });
  - REPLACE WITH (the post-fix CORRECT behavior):
      it("(c) compaction — pinned entry in the RETAINED TAIL is hidden (BUG-002 fix; was [] before)", () => {
        // messages: 2 (no compaction-summary message in this minimal fixture; algorithm maps retained tail to LAST N msgs).
        const msgs: MessageLike[] = [user("u"), asst("c1")];
        // root→leaf: e1 (compacted-away head), eC (compaction), e2 (retained tail). lastCompactionIdx=1; tailEntries=[e2];
        // tailStartIdx = 2 - 1 = 1 → e2 ↔ messages[1].
        const branch: BranchEntry[] = [
          entry("e1", "message"), entry("eC", "compaction"), entry("e2", "message"),
        ];
        expect(resolvePinnedHide(msgs, branch, ["e2"])).toEqual([1]); // e2 is retained-tail → hidden (was [] before the fix)
      });
  - RATIONALE: trace — lastCompactionIdx=1 (eC at idx1); tailEntries=[e2]; tailStartIdx=2-1=1; e2→idx1. This is
    the single existing test whose expectation flips under the fix. (GOTCHA #1.)
  - GOTCHA: do NOT touch tests (a)/(b)/(d)/(e) — they stay green. (GOTCHA #4.)
  - DEPENDENCIES: Task 1 (the rewrite must be in place for the updated expectation to pass).

Task 4: ADD new compaction test cases to test/transforms.test.ts (resolvePinnedHide describe block, line 1612)
  - ADD these it(...) cases (reuse entry()/user()/asst()/result() helpers; mirror the compaction-fixture shape from
    resolveCheckpoint's tests at lines 838–860: `entry("c1","compaction",{summary:"s", firstKeptEntryId:"e_x"})`):

    (f) PRODUCTION REPRO (BUG-002 — the headline proof):
        it("(f) compaction in head + pinned retained-tail toolGroup → hides them (BUG-002 production repro)", () => {
          const msgs: MessageLike[] = [user("u"), compactionSummary("s"), asst("c1"), result("c1")]; // 4 msgs idx 0..3
          const branch: BranchEntry[] = [
            entry("e1", "message"), entry("c1", "compaction", { summary: "s", firstKeptEntryId: "e3" }),
            entry("e3", "message"), entry("e4", "message"),
          ];
          // lastCompactionIdx=1; tailEntries=[e3,e4]; tailStartIdx=4-2=2 → e3↔idx2, e4↔idx3.
          expect(resolvePinnedHide(msgs, branch, ["e3", "e4"])).toEqual([2, 3]); // result(big) at idx3 IS hidden (was [] before)
        });
        (NOTE: if there is no compactionSummary() message helper, build it inline: `{ role: "system", content: [{ type: "text", text: "s" }] } as MessageLike`, or reuse whatever the file uses for a compaction-summary message. The exact message CONTENT does not matter — only the count + the index mapping.)

    (g) PINNED-IN-COMPACTED-AWAY HEAD → [] (correct: absent from messages):
        it("(g) pinned entry in the COMPACTED-AWAY head → [] (gone from messages; no leak, no error)", () => {
          const msgs: MessageLike[] = [user("u"), compactionSummary("s"), asst("c1")]; // 3 msgs
          const branch: BranchEntry[] = [
            entry("e1", "message"), entry("c1", "compaction", { summary: "s" }), entry("e3", "message"),
          ];
          // e1 is BEFORE the compaction (compacted-away head) → not in tailEntries → not matched.
          expect(resolvePinnedHide(msgs, branch, ["e1"])).toEqual([]);
        });

    (h) MULTIPLE COMPACTIONS — only the LAST matters:
        it("(h) multiple compactions — only the LAST compaction's tail is retained", () => {
          const msgs: MessageLike[] = [compactionSummary("s2"), asst("c1")]; // 2 msgs (2nd summary + retained tail e3)
          const branch: BranchEntry[] = [
            entry("e1", "message"), entry("c1", "compaction", { summary: "s1" }),
            entry("e2", "message"), entry("c2", "compaction", { summary: "s2" }), entry("e3", "message"),
          ];
          // lastCompactionIdx=3 (c2); tailEntries=[e3]; tailStartIdx=2-1=1 → e3↔idx1. e2 was compacted away by c2.
          expect(resolvePinnedHide(msgs, branch, ["e3"])).toEqual([1]);   // retained-tail entry hidden
          expect(resolvePinnedHide(msgs, branch, ["e2"])).toEqual([]);    // e2 compacted away by c2 → gone
        });

    (i) NO-COMPACTION PARITY (degenerate to legacy walk):
        it("(i) no compaction on the branch → identical to the legacy forward walk (tailStartIdx === 0)", () => {
          const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1")];
          const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message"), entry("e3", "message")];
          // lastCompactionIdx=-1; tailEntries=[e1,e2,e3]; tailStartIdx=3-3=0 → legacy mapping.
          expect(resolvePinnedHide(msgs, branch, ["e1", "e3"])).toEqual([0, 2]); // identical to test (a)
        });

    (j) DEFENSIVE tailStartIdx < 0:
        it("(j) defensive — tail longer than messages (alignment lost) → []", () => {
          const msgs: MessageLike[] = [user("u")]; // 1 message
          const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message")]; // 2 retained-tail entries
          // tailEntries=[e1,e2] (len 2) > messages.length (1) → tailStartIdx = 1-2 = -1 → [].
          expect(resolvePinnedHide(msgs, branch, ["e1"])).toEqual([]);
        });
  - NAMING: titles name the compaction scenario + BUG-002 where relevant. Reuse the file's `entry()` helper.
  - GOTCHA: for the compaction-summary MESSAGE (msgs array), the exact role/content is irrelevant — only the
    count matters for the tailStartIdx math. If a compactionSummary() helper doesn't exist, inline a minimal
    MessageLike (e.g. `{ role: "system", content: [{ type: "text", text: "s" }] }`) or reuse the file's existing
    pattern. Match the test file's prevailing MessageLike construction style.
  - DEPENDENCIES: Task 1.

Task 5: VALIDATE (no new code)
  - RUN `npx vitest run test/transforms.test.ts` → all pass (updated (c) + new (f)–(j); (a)/(b)/(d)/(e) green;
    resolveCheckpoint's compaction tests (838–860) UNCHANGED/green).
  - RUN `npx vitest run` → full suite passes (filterPipeline integration tests unaffected — same number[] contract).
  - RUN `npx tsc --noEmit` → no new errors (signature unchanged; entryMessageYield reused as a predicate returns
    number; `> 0` is a valid boolean filter). Any pre-existing errors elsewhere are out of scope.
  - DEPENDENCIES: Tasks 1–4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): the retained-tail walk replaces the forward-walk-with-bail.
//   The KEY insight: getBranch() is RAW (compacted-away + compaction + tail); event.messages is compaction-aware.
//   The retained tail (entries AFTER the last compaction) maps 1:1 to the LAST N messages.
let lastCompactionIdx = -1;
for (let i = branchEntries.length - 1; i >= 0; i--) {       // scan from END → first hit = LAST compaction
  const t = isRecord(branchEntries[i]) ? readOwn(branchEntries[i], "type") : undefined;
  if (t === "compaction") { lastCompactionIdx = i; break; }
}
const tailEntries = branchEntries
  .slice(lastCompactionIdx + 1)                              // entries AFTER the last compaction
  .filter((e) => entryMessageYield(e) > 0);                  // message/custom_message/branch_summary ONLY (yield 1)
const tailStartIdx = messages.length - tailEntries.length;   // retained tail ↔ the LAST tailEntries.length messages
if (tailStartIdx < 0) return [];                             // defensive: alignment lost
const remove: number[] = [];
tailEntries.forEach((e, k) => {
  const id = isRecord(e) ? readOwn(e, "id") : undefined;
  if (typeof id === "string" && hideSet.has(id)) remove.push(tailStartIdx + k);  // entry k ↔ messages[tailStartIdx + k]
});
return remove;

// WALK-THROUGH (production repro — Task 4 case f):
//   msgs    = [user, compactionSummary, asst(c1), result(c1)]   // 4 messages (idx 0..3)
//   branch  = [e1(msg), c1(compaction), e3(msg), e4(msg)]
//   hide    = ["e3", "e4"]
//   scan: i=3 e4(msg) no; i=2 e3(msg) no; i=1 c1(compaction) YES → lastCompactionIdx=1, break.
//   tailEntries = branch.slice(2).filter(yield>0) = [e3(msg), e4(msg)]   (len 2)
//   tailStartIdx = 4 - 2 = 2
//   walk: e3 (k=0) → id "e3" ∈ hideSet → push 2+0=2; e4 (k=1) → id "e4" ∈ hideSet → push 2+1=3.
//   remove = [2, 3]   ✓ (result(big) at idx3 IS hidden — was [] before the fix)

// WALK-THROUGH (no-compaction parity — Task 4 case i / proves tests (a)/(b) stay green):
//   branch has NO compaction → lastCompactionIdx stays -1 → slice(0) = ALL entries → tailEntries = all
//   context-message entries → tailEntries.length === messages.length → tailStartIdx === 0 → entry k ↔ messages[k].
//   IDENTICAL to the legacy msgCursor=0 forward walk.

// CRITICAL: do NOT call isContextProducingType for the tail filter — it INCLUDES 'compaction' (GOTCHA #2).
//   entryMessageYield(e) > 0 is the correct one-call predicate (1 for message/custom_message/branch_summary only).
```

### Integration Points

```yaml
CODE:
  - modify: src/transforms.ts — resolvePinnedHide body (633–660) → retained-tail walk; JSDoc (562–624) rewritten
  - untouched: entryMessageYield (549), isContextProducingType (555), resolveCheckpoint (454–540),
    resolvePinnedShrink (821–842, T2.S2's), filterPipeline (incl. call site 1364), applyRewind, isRecord/readOwn
TESTS:
  - modify: test/transforms.test.ts — update test (c) (~1633); add ~5 compaction cases (f)–(j) in the describe block (1612)
  - untouched: all other test files; resolveCheckpoint's compaction tests (838–860); filterPipeline integration tests
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. resolvePinnedHide is a pure read-only resolver; no config keys, no persistence, no registration.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: no new errors from src/transforms.ts. The change is a body rewrite with an UNCHANGED signature;
# entryMessageYield is reused as a filter predicate (returns number; `> 0` is a valid boolean). Common mistakes:
#   - accidentally editing entryMessageYield/isContextProducingType/resolveCheckpoint/resolvePinnedShrink (GOTCHA #3);
#   - changing the signature or return type (GOTCHA #5);
#   - a type error from `tailEntries.forEach((e, k) => …)` — `e` is BranchEntry (the slice/filter preserve type), `k` is number.
# Re-read the diff: ONLY resolvePinnedHide's body (633–660) + its JSDoc (562–624) should differ.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The transforms test file — fast feedback on the algorithm swap.
npx vitest run test/transforms.test.ts
# EXPECTED: all pass. If test (c) FAILS with received=[] expected=[1] → you didn't update (c) (Task 3, GOTCHA #1).
# If a new compaction case fails, re-trace lastCompactionIdx / tailEntries / tailStartIdx for that fixture.
# resolveCheckpoint's compaction tests (838–860) MUST still pass (proves entryMessageYield/isContextProducingType
# unchanged — GOTCHA #3). resolvePinnedShrink tests are unchanged (T2.S2 owns its fix).

# Full suite — confirm filterPipeline integration tests still pass (same number[] contract; applyRewind consumes [] as no-op).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: resolvePinnedHide is a PURE resolver exercised directly by the unit tests. The
# end-to-end "does a pinned rewind actually hide content post-compaction" path runs through filterPipeline →
# resolvePinnedHide → applyRewind, and is covered by the existing filterPipeline integration tests (which pass
# the same number[] through applyRewind). No live runtime seam is newly exercisable here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# TDD red→green confirmation (optional — proves test (c)'s update + the new cases lock in the fix):
#   1. BEFORE applying Task 1: the NEW compaction cases (f)/(h) FAIL with received=[] (the bug). This is the red step.
#   2. Apply Task 1 → re-run → PASS (green). The red→green transition is the proof the fix works end-to-end.

# Grep sanity (confirm the retained-tail walk landed and the bail is gone):
grep -n 'lastCompactionIdx\|tailEntries\|tailStartIdx\|if (y < 0) return' src/transforms.ts
# EXPECTED: lastCompactionIdx/tailEntries/tailStartIdx present in resolvePinnedHide; the OLD `if (y < 0) return []`
# bail is GONE from resolvePinnedHide (but STILL present in resolveCheckpoint — that's correct, GOTCHA #3).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — no new errors from `src/transforms.ts` / `test/transforms.test.ts`.
- [ ] `npx vitest run test/transforms.test.ts` — all pass (updated (c) + new (f)–(j)).
- [ ] `npx vitest run` — full suite passes.

### Feature Validation
- [ ] `resolvePinnedHide([user, summary, asst, result], [e1(msg), c1(compaction), e3(msg), e4(msg)], ["e3","e4"]) === [2,3]` (BUG-002 repro — was `[]`).
- [ ] Pinned-in-compacted-head → `[]` (correct — absent from messages).
- [ ] No-compaction branch → identical to the legacy walk (tests (a)/(b)/(i) green; `tailStartIdx === 0`).
- [ ] `tailStartIdx < 0` → `[]` (defensive alignment-loss guard).
- [ ] resolvePinnedHide body uses `lastCompactionIdx` + `tailEntries` + `tailStartIdx`; the old `if (y < 0) return []` bail is gone.

### Code Quality Validation
- [ ] Signature/return type UNCHANGED (`(messages, branchEntries, hideEntryIds): number[]`); filterPipeline:1364 call site untouched.
- [ ] `entryMessageYield` reused as the tail filter predicate (`> 0`); NOT `isContextProducingType` (which includes compaction).
- [ ] `entryMessageYield`, `isContextProducingType`, `resolveCheckpoint`, `resolvePinnedShrink` are UNCHANGED.
- [ ] Only `src/transforms.ts` (resolvePinnedHide body + JSDoc) and `test/transforms.test.ts` (test (c) + new cases) are modified.

### Documentation & Deployment
- [ ] resolvePinnedHide JSDoc documents the retained-tail algorithm, the no-compaction degenerate case, the compacted-head-unmatched correctness, and references spec/08 E24 + §BUG-002 (Mode A).
- [ ] No README/spec change in this subtask (changeset doc sync is a separate task).

---

## Anti-Patterns to Avoid

- ❌ Don't reuse `isContextProducingType` for the retained-tail filter — it INCLUDES 'compaction' (wrong for the tail). Use `entryMessageYield(e) > 0` (1 for message/custom_message/branch_summary only) (GOTCHA #2).
- ❌ Don't touch `entryMessageYield` / `isContextProducingType` / `resolveCheckpoint` / `resolvePinnedShrink` — resolveCheckpoint KEEPS its bail-on-compaction (contiguous-sweep); resolvePinnedShrink is T2.S2 (GOTCHA #3).
- ❌ Don't forget to UPDATE test (c) — it asserts the BUGGY `[]`; after the fix it returns `[1]`. Leaving it = a failing test (GOTCHA #1).
- ❌ Don't keep a running `msgCursor += yield` — the retained-tail offset is computed ONCE (`tailStartIdx`) and `k` is the forEach index. Each retained-tail entry yields exactly 1 message, so `tailStartIdx + k` is the mapping (GOTCHA #7).
- ❌ Don't change the signature or return `null` — `number[]` (never null) is the contract; `[]` is applyRewind's idempotent no-op and must NOT trigger legacy relative resolution (GOTCHA #5).
- ❌ Don't drop the `tailStartIdx < 0` guard — it's the defensive alignment-loss check that replaces the old `msgCursor + y > messages.length` refusal (GOTCHA #6).
- ❌ Don't break the no-compaction degenerate case — when `lastCompactionIdx === -1`, `tailStartIdx` must be `0` so tests (a)/(b)/(i) stay green. If they break, the tail filter or start-index math is wrong (GOTCHA #4).
- ❌ Don't touch `filter.ts`/`nudges.ts` — that's the previous PRP's (P1.M1.T1.S2) territory (suppressCheck/BUG-001). This task is `transforms.ts` ONLY.
- ❌ Don't skip the new compaction tests because "the unit tests pass" — the `[]`-on-compaction bug was previously ASSERTED as correct (test (c)); without the new cases the fix can silently regress later.

---

## Decision Log

- **D1 — Walk the retained tail (entries after the LAST compaction), not the whole branch.** `getBranch()` is the RAW path (compacted-away + compaction + tail); `event.messages` is compaction-aware. The compacted-away set is UNKNOWABLE from the compaction entry (no `retainedTail` field — external_deps.md), so a whole-branch walk is fundamentally unalignable. But the retained tail (entries AFTER the last compaction) maps 1:1 to the LAST `tailEntries.length` messages. Walking only the tail is the minimal, correct, alignable subset — and it degenerates to the legacy forward walk when there is no compaction (preserving all existing behavior).

- **D2 — Reuse `entryMessageYield` as the tail filter predicate (`> 0`), not `isContextProducingType`.** `isContextProducingType` includes 'compaction' (correct for resolveCheckpoint's whole-branch ctxEntries, wrong for the retained tail). `entryMessageYield` returns 1 for EXACTLY {message, custom_message, branch_summary} and -1 otherwise — a clean one-call filter that excludes compaction/label/custom. This reuses the existing helper without modifying it (resolveCheckpoint's contract preserved) and self-documents the "1 message per retained-tail entry" invariant.

- **D3 — Leave `resolveCheckpoint`'s bail-on-compaction intact.** resolveCheckpoint removes a CONTIGUOUS sweep ("everything after iTarget"); a compaction anywhere in its walked range makes the sweep's end indeterminate, so refusing (null) is correct for ITS semantics. resolvePinnedHide removes a DISCRETE set (exactly the pinned entries) — it only needs the retained-tail alignment, so it can be compaction-aware without the bail. The two resolvers legitimately need DIFFERENT compaction handling; changing the shared helpers would break resolveCheckpoint's tested contract (lines 838–860).

- **D4 — Scope = resolvePinnedHide ONLY; resolvePinnedShrink is T2.S2.** Both have the identical bug, but the plan splits them (resolvePinnedHide = 2 pts, the harder/path-setting one; resolvePinnedShrink = 1 pt, mirroring this fix). Touching resolvePinnedShrink here crosses a task boundary and risks merge conflicts with the parallel sibling task. This PRP sets the canonical retained-tail algorithm that T2.S2 will mirror.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a focused algorithm swap of ONE function (body rewrite, signature preserved) backed by: (a) the verbatim current body + verbatim target body, (b) the authoritative algorithm sketch in system_context §BUG-002, (c) the exact one-test-that-breaks (c) with its traced post-fix value, (d) 5 new compaction test cases with traced expected values, (e) the no-compaction degenerate proof that tests (a)/(b) stay green, and (f) the hard constraint (GOTCHA #2/#3) to reuse `entryMessageYield` as the predicate and leave `resolveCheckpoint`/`resolvePinnedShrink` alone. Residual risks: (1) forgetting to update test (c) (mitigated by GOTCHA #1 + Task 3); (2) the compaction-summary MESSAGE fixture shape (mitigated by the "exact content is irrelevant, only the count matters" note in Task 4).