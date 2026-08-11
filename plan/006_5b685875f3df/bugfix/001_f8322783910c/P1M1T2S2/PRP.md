# PRP — P1.M1.T2.S2: Compaction-aware retained-tail walk in `resolvePinnedShrink` (BUG-002 fix, shrink half)

---

## Goal

**Feature Goal**: Fix the IDENTICAL compaction-bail bug as `resolvePinnedHide` (T2.S1) in `resolvePinnedShrink` (src/transforms.ts:829). Today it filters `branchEntries` to `isContextProducingType` (which INCLUDES `compaction`), walks forward, and returns `null` the instant `entryMessageYield(entry)` returns the `-1` "indeterminate" sentinel for a compaction entry — making EVERY pinned shrink a permanent no-op after the first auto-compaction. Replace the forward-walk-with-bail with the SAME **retained-tail walk** T2.S1 established for `resolvePinnedHide`, adapted for a **single-ID lookup**: find the LAST compaction entry, take the entries after it (the retained tail), map that tail to the LAST `tailEntries.length` messages, and return the FIRST retained-tail entry whose `id === pinnedEntryId`. This restores pinned shrinks post-compaction for consistency with the pinned-rewind fix.

**Deliverable**:
1. `src/transforms.ts` (MODIFY) — rewrite the body of `resolvePinnedShrink` (the `ctxEntries` filter + `msgCursor` forward walk block, ~lines 839–842). The two defensive checks at the top STAY; the retained-tail walk REPLACES the buggy walk. Signature `(messages, branchEntries, pinnedEntryId): number | null` is UNCHANGED. Rewrite the JSDoc to document the retained-tail walk + spec/08 E24 + the single-ID adaptation (Mode A).
2. `test/transforms.test.ts` (MODIFY) — **update the ONE breaking test (c)** (~line 1757) which currently asserts the BUGGY `null` return on compaction, and **add ~5 new compaction test cases** (production repro, pinned-in-head → null, multiple-compactions, no-compaction parity, defensive `tailStartIdx<0`) in the existing `resolvePinnedShrink` describe block (line 1733).

**Success Definition**:
- `resolvePinnedShrink([user, compactionSummary, asst, result], [e1(msg), c1(compaction), e3(msg), e4(msg)], "e3")` returns `2` (the retained-tail entry's message index — was `null` before the fix; BUG-002 shrink repro).
- The existing no-compaction tests (a) `1` and (b) `0` STILL pass (no-compaction degenerates: `tailStartIdx === 0`).
- The defensive tests (d) not-found → `null`, (e) non-array/empty → `null`, (f) throwing-Proxy `.not.toThrow()`, (g) `number | null` type STILL pass.
- `resolvePinnedHide` (T2.S1's territory) is UNCHANGED; `resolveCheckpoint`, `entryMessageYield`, `isContextProducingType` are UNCHANGED.
- `npx vitest run test/transforms.test.ts` — all pass. `npx vitest run` — full suite passes. `npx tsc --noEmit` — no new errors.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers + the agent relying on PINNED shrinks (the `pinnedEntryId` identity-lock path) in long sessions where Pi auto-compacts context.

**Use Case**: A long session triggers Pi's first auto-compaction. A pinned shrink whose `pinnedEntryId` targets an entry still present in the retained tail must KEEP substituting that message's content on every subsequent inference (identity-locked — never drifts onto a later matching message).

**User Journey**: Agent shrinks a bloated read → `pinnedEntryId` locks the stable entry id → session auto-compacts later → next context fire → `resolvePinnedShrink` now walks the retained tail (not bailing on the compaction entry) → returns the correct message index → `applyShrink` substitutes it → the shrink persists (identity-or-nothing honored).

**Pain Points Addressed**: Post-compaction, pinned shrinks silently no-op'd, so a previously-substituted (compacted) message reappeared verbatim in the model's view on every inference — the same permanent-soft-substitution leak BUG-002 describes for hides, now fixed for shrinks too for consistency.

## Why

- **Business value / user impact**: Major-consistency (BUG-002). The PRD focuses the BUG-002 write-up on pinned rewinds (the production hide path), but the shrink resolver has the IDENTICAL root cause. Fixing only `resolvePinnedHide` would leave pinned shrinks silently broken post-compaction — an inconsistency that's worse than the original uniform bug (two resolvers, one fixed, one not). This task applies the canonical algorithm T2.S1 established.
- **Integration with existing features**: `resolvePinnedShrink` is consumed by `applyShrink` (src/transforms.ts:922) on every context fire and by `filterPipeline` (src/transforms.ts:1471) for each pinned shrink marker. Both already treat `null` as a no-op (`if (i === null) return messages` / `if (origIdx === null) continue`) — the fix is internal (same signature, same `number | null` return contract); neither call site changes. T2.S1's `resolvePinnedHide` lives in a SEPARATE describe block/test set — zero overlap.
- **Problems this solves and for whom**: For the agent/developer — pinned shrinks survive compaction (identity lock persists). For maintainers — one canonical retained-tail algorithm shared by both pinned resolvers, eliminating the "which one is fixed?" trap.
- **Scope boundary (CRITICAL)**: This task is `resolvePinnedShrink` ONLY. `resolvePinnedHide` (T2.S1, in parallel) is NOT touched. `resolveCheckpoint` / `entryMessageYield` / `isContextProducingType` are UNCHANGED (resolveCheckpoint keeps its bail-on-compaction for contiguous-sweep semantics). The two call sites are NOT modified.

## What

User-visible behavior: after a compaction, pinned shrinks whose target is in the retained tail now correctly resolve to that message's index (previously no-op'd → substitution lost). Pinned targets in the compacted-away head are correctly unmatched (`null` — they're gone from messages; no leak, no error). No-compaction sessions behave identically to today (degenerate to the legacy forward walk).

### Success Criteria

- [ ] `resolvePinnedShrink` finds `lastCompactionIdx` (LAST `type === "compaction"` entry; -1 if none), builds `tailEntries` from `branchEntries.slice(lastCompactionIdx + 1)` filtered to `entryMessageYield(e) > 0` (message/custom_message/branch_summary), computes `tailStartIdx = messages.length - tailEntries.length`, returns `null` if `tailStartIdx < 0`, else walks the tail and returns `tailStartIdx + k` for the FIRST entry whose string `id === pinnedEntryId` (else `null`).
- [ ] Signature/return type UNCHANGED: `(messages, branchEntries, pinnedEntryId): number | null`; both call sites (922, 1471) untouched.
- [ ] `entryMessageYield`, `isContextProducingType`, `resolveCheckpoint`, `resolvePinnedHide` are UNCHANGED.
- [ ] Existing tests (a)/(b)/(d)/(e)/(f)/(g) stay green; test (c) is updated from `null` to the correct post-fix return (`1`); ~5 new compaction cases added.
- [ ] `npx vitest run test/transforms.test.ts`, `npx vitest run`, `npx tsc --noEmit` all pass (no new errors).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — **YES.** This PRP contains the verbatim current function body, the verbatim target body, the algorithmic contract from T2.S1, the exact one-test-that-breaks + its update, the new test cases with traced expected values, the `entry()`/`compactionSummary()` fixture helpers, the throw-safety proof for `readOwn` (so test (f) stays green), and the hard constraint to NOT touch the shared helpers or `resolvePinnedHide`.

### Documentation & References

```yaml
# MUST READ — the file being fixed (the function + shared helpers + call sites are all here).
- file: src/transforms.ts
  why: "THE file. resolvePinnedShrink declared at line 829 (body ~833–842). Shared helpers REUSED (do NOT change):
    entryMessageYield (~549, returns 1 for message/custom_message/branch_summary, -1 for compaction/other);
    isContextProducingType (~555, INCLUDES compaction — do NOT use for the tail filter); isRecord (173);
    readOwn (178, THROW-SAFE: try/catch → undefined). The two call sites consume null as no-op:
    applyShrink (~922, `if (i === null) return messages`); filterPipeline (~1471, `if (origIdx === null) continue`).
    resolvePinnedHide (~625, T2.S1's) and resolveCheckpoint (~454) are NOT touched."
  pattern: "CURRENT body: ctxEntries = branchEntries.filter(isContextProducingType) (INCLUDES compaction);
    forward walk with msgCursor; `if (entryMessageYield(e) < 0) return null` BAILS on compaction (THE BUG).
    TARGET: find lastCompactionIdx; tailEntries = branchEntries.slice(lastCompactionIdx+1).filter(e=>entryMessageYield(e)>0);
    tailStartIdx = messages.length - tailEntries.length; if <0 return null; walk tail, return tailStartIdx+k on FIRST id match, else null."
  gotcha: "Reuse entryMessageYield as the tail filter predicate (`> 0`) — NOT isContextProducingType (which includes
    compaction). readOwn is throw-safe, so calling it directly in the lastCompactionIdx scan is safe (test (f) green)."

# MUST READ — the algorithmic CONTRACT (the sibling that sets the canonical algorithm this task mirrors).
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M1T2S1/PRP.md
  why: "CONTRACT for resolvePinnedHide's retained-tail walk (lastCompactionIdx scan → slice(after) → entryMessageYield>0
    filter → tailStartIdx = messages.length - tailEntries.length → walk pushing tailStartIdx+k). T2.S2 applies the SAME
    algorithm adapted for single-ID: return the index (not push to array), refuse → null (not []), FIRST match (IDs unique)."
  critical: "T2.S1 owns resolvePinnedHide + ITS describe block (tests a–j there). T2.S2 owns resolvePinnedShrink + ITS
    describe block (line 1733) — DIFFERENT blocks, no merge conflict. Do NOT touch resolvePinnedHide's body or tests."

# MUST READ — the root-cause synthesis + the exact algorithm sketch.
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: "§BUG-002 gives the root cause (getBranch raw vs event.messages compaction-aware), 'Why Compaction Breaks
    Alignment', and the retained-tail algorithm sketch. Confirms BOTH resolvePinnedHide AND resolvePinnedShrink have
    the same bug, and that entryMessageYield/isContextProducingType are NOT changed (resolveCheckpoint needs them)."
  critical: "The 'retained tail maps to the LAST tailEntries.length messages' insight is the entire fix. The
    no-compaction case degenerates to the current forward walk (tailStartIdx === 0)."

# MUST READ — the test file (the function + helpers + the test that breaks).
- file: test/transforms.test.ts
  why: "THE test file. resolvePinnedShrink describe block at line 1733 (cases a–g). FIXTURE HELPERS: `entry(id,type,
    extra={})` at line 738 → `{type,id,parentId:null,timestamp:'t',...extra}`; `compactionSummary(text='summary')` at
    line 743 (USE THIS for compaction-summary messages — it exists); `user/asst/result/asstText` at lines 9–33.
    compaction BRANCH entry shape: `entry('eC','compaction',{summary:'s', firstKeptEntryId:'e3'})` (mirror resolveCheckpoint
    tests ~838–860)."
  pattern: "Test (c) at ~1757 asserts the BUGGY null (branch=[e1(msg),eC(compaction),e2(msg)], msgs=[user,asst], pin 'e2').
    POST-FIX returns 1 (lastCompactionIdx=1; tailEntries=[e2]; tailStartIdx=2-1=1; e2↔idx1). MUST update (c)."
  critical: "Test (c) is the ONE existing test that breaks. Tests (a)/(b)/(d)/(e)/(f)/(g) stay GREEN (verified by trace).
    resolvePinnedHide's tests are T2.S1's separate block — do not touch them."

# CONTEXT — the spec framing (E24).
- file: spec/08-edge-cases.md
  why: "E24 frames the pinned-hide compaction interaction as a 'KNOWN LIMITATION'. The JSDoc rewrite (Mode A) should
    note the retained-tail fix UPGRADES E24 for shrinks too: retained-tail targets now resolve post-compaction; only
    compacted-head entries no-op (correct)."
  critical: "E24 is a leak, not a replay — so the fix is pure correctness (substitution persists); no new pairing risk."
```

### Current Codebase tree (the relevant slice)

```bash
src/
  transforms.ts   # ← MODIFY: resolvePinnedShrink body (~839–842) → retained-tail walk; JSDoc (~813–828) rewritten
                   #   REUSED unchanged: entryMessageYield (~549), isContextProducingType (~555), isRecord (173),
                   #   readOwn (178), resolveCheckpoint (~454–540), resolvePinnedHide (~625, T2.S1's),
                   #   applyShrink call site (~922), filterPipeline call site (~1471), applyRewind
test/
  transforms.test.ts   # ← MODIFY: update test (c) (~1757); add ~5 compaction cases in the describe block (1733)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This subtask MODIFIES exactly two existing files:
src/transforms.ts        # resolvePinnedShrink body rewritten; JSDoc (~813–828) rewritten (Mode A)
test/transforms.test.ts  # update test (c); add ~5 new compaction it(...) cases (h)–(l) in the resolvePinnedShrink describe block
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (ONE existing test breaks — test (c) MUST be updated, not just added-to).
//   test/transforms.test.ts (~line 1757) currently ASSERTS THE BUG: branch=[e1(msg),eC(compaction),e2(msg)],
//   msgs=[user,asst], pin 'e2' → expects toBeNull(). After the fix this returns 1 (e2 is in the retained tail:
//   lastCompactionIdx=1, tailEntries=[e2], tailStartIdx=2-1=1, e2↔messages[1]). If you forget to update (c),
//   `npx vitest run test/transforms.test.ts` FAILS on (c). Update (c)'s expectation to 1 AND rename it to
//   reflect "retained-tail resolve WORKS post-compaction" (the old title said "compaction refusal").

// CRITICAL GOTCHA #2 (use entryMessageYield as the tail filter predicate, NOT isContextProducingType).
//   isContextProducingType INCLUDES 'compaction' (wrong for the retained tail — we are PAST compaction).
//   entryMessageYield returns 1 for EXACTLY {message, custom_message, branch_summary} and -1 otherwise, so
//   `tailEntries = branchEntries.slice(lastCompactionIdx+1).filter(e => entryMessageYield(e) > 0)` is the
//   clean one-call filter. (Because lastCompactionIdx is the LAST compaction, the slice range contains no
//   compaction anyway — but filtering with entryMessageYield>0 is correct AND self-documenting.)

// CRITICAL GOTCHA #3 (do NOT touch resolvePinnedHide / entryMessageYield / isContextProducingType / resolveCheckpoint).
//   resolveCheckpoint (~454) REUSES entryMessageYield + isContextProducingType and KEEPS its bail-on-compaction
//   (contiguous-sweep semantics — its tests ~838–860 assert compaction-in-walked-range → null/refuse). resolvePinnedHide
//   (~625) is T2.S1's (in parallel) — its body + its describe block are T2.S1's territory. ONLY resolvePinnedShrink
//   changes here. Touching any other resolver crosses task boundaries and risks merge conflicts with T2.S1.

// CRITICAL GOTCHA #4 (the no-compaction case MUST degenerate to the legacy walk — prove tests (a)/(b) stay green).
//   When lastCompactionIdx === -1: tailEntries = ALL context-message entries (slice(0).filter(yield>0));
//   tailStartIdx = messages.length - tailEntries.length. In a well-aligned no-compaction branch every context
//   entry yields exactly 1 message → tailEntries.length === messages.length → tailStartIdx === 0 → entry k ↔
//   messages[k]. This is IDENTICAL to the old msgCursor=0 forward walk. (Trace (a): [e1,e2,e3],3 msgs,pin e2
//   → tailStartIdx 0 → e2 at k=1 → returns 1 ✓. (b): grown [e1..e4],4 msgs,pin e1 → tailStartIdx 0 → e1 k=0 → 0 ✓.)

// CRITICAL GOTCHA #5 (signature + return type UNCHANGED — number | null; call sites untouched).
//   Keep `export function resolvePinnedShrink(messages: MessageLike[], branchEntries: BranchEntry[],
//   pinnedEntryId: string): number | null`. Return number | null (NEVER []). null is the documented no-op:
//   applyShrink (~922) does `if (i === null) return messages` (SAME ref no-op); filterPipeline (~1471) does
//   `if (origIdx === null) continue`. Returning null (NOT falling back to live resolution) is INTENTIONAL:
//   once a target is pinned we want identity-or-nothing (the rewind precedent) — re-resolving a DIFFERENT
//   message would re-introduce the moving-target bug pinning exists to prevent.

// CRITICAL GOTCHA #6 (tailStartIdx < 0 is the defensive alignment-loss guard — keep it; return null).
//   If tailEntries.length > messages.length (raw branch vs compaction-aware messages misalign beyond recovery),
//   return null (refuse safely; no-op this fire; no crash). This replaces the old `if (msgCursor + y > messages.length)
//   return null` guard — same intent, computed up-front from the tail length. NOTE: return null, NOT [] (shrink
//   contract differs from hide's []).

// CRITICAL GOTCHA #7 (return tailStartIdx + k on FIRST match; no accumulator array).
//   resolvePinnedShrink resolves ONE id → ONE index (unlike resolvePinnedHide's SET → number[]). So do NOT build a
//   `remove` array; on the first entry whose string id === pinnedEntryId, `return tailStartIdx + k` immediately.
//   Entry IDs are unique, so there is at most one match — early-returning on the first is correct and avoids walking
//   the whole tail needlessly. k is the forEach/loop index; there is no per-entry msgCursor increment (each
//   retained-tail entry yields exactly 1 message, so tailStartIdx + k is the mapping).

// CRITICAL GOTCHA #8 (NEVER throws; readOwn is THROW-SAFE so test (f) stays green; purity; isRecord discipline).
//   readOwn (line 178) wraps `obj[key]` in try/catch → returns undefined on a throwing-Proxy get trap. So the new
//   lastCompactionIdx scan calling readOwn directly is SAFE: for the trap entry, readOwn(trap,"type")→undefined→≠
//   "compaction"→scan skips it; the tail filter's entryMessageYield(trap)→isRecord→readOwn→undefined→returns -1→
//   `>0` false→trap filtered out of tailEntries→walk never touches it→returns null, no throw. (Test (f) traced ✓.)
//   resolvePinnedShrink sits on the context-handler hot path via filterPipeline (E13 fail-open). NEVER imports Pi.

// CRITICAL GOTCHA #9 (compactionSummary() message helper EXISTS — use it; don't inline).
//   test/transforms.test.ts line 743 defines `compactionSummary(text="summary"): MessageLike`. Use it for the
//   compaction-summary entries in the `msgs` arrays of the new test cases. (T2.S1's PRP hedged on its existence;
//   here it is confirmed.) The exact message CONTENT is irrelevant — only the count matters for tailStartIdx math.
```

---

## Implementation Blueprint

### Data models and structure

**No data-model changes.** `BranchEntry` (`{type: string, id: string, parentId?, timestamp?, ...}`), `MessageLike`, and the function signature `(messages, branchEntries, pinnedEntryId): number | null` are all UNCHANGED. The fix is a pure algorithm swap inside the function body.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE src/transforms.ts:~833–842 — resolvePinnedShrink body (retained-tail walk)
  - KEEP the two defensive checks VERBATIM (top of body):
      if (!Array.isArray(messages) || !Array.isArray(branchEntries)) return null;
      if (typeof pinnedEntryId !== "string" || pinnedEntryId.length === 0) return null;
  - REPLACE the `ctxEntries` filter + `msgCursor` forward walk + bail WITH the retained-tail walk:
      // 3) RETAINED-TAIL WALK (compaction-aware; fixes BUG-002 — mirrors resolvePinnedHide, adapted for ONE id).
      //    getBranch() is the RAW path (carries compacted-away entries + the compaction entry); event.messages is
      //    compaction-aware. The entries AFTER the LAST compaction are the "retained tail" and map 1:1 to the LAST
      //    tailEntries.length messages. resolveCheckpoint keeps its bail-on-compaction (contiguous-sweep) — NOT touched.
      let lastCompactionIdx = -1;
      for (let i = branchEntries.length - 1; i >= 0; i--) {
        const t = isRecord(branchEntries[i]) ? readOwn(branchEntries[i], "type") : undefined;
        if (t === "compaction") { lastCompactionIdx = i; break; }
      }
      // 4) tailEntries = retained tail (entries AFTER the last compaction), context-message types ONLY.
      const tailEntries = branchEntries
        .slice(lastCompactionIdx + 1)
        .filter((e) => entryMessageYield(e) > 0); // message/custom_message/branch_summary (yield 1); excludes compaction/label/custom
      // 5) Retained tail ↔ the LAST tailEntries.length messages. If the tail is longer than messages → refuse (null).
      const tailStartIdx = messages.length - tailEntries.length;
      if (tailStartIdx < 0) return null; // defensive: raw branch vs compaction-aware messages misalign
      // 6) Walk the tail; return the FIRST (only) entry whose id === pinnedEntryId. No-compaction case: tailStartIdx === 0.
      for (let k = 0; k < tailEntries.length; k++) {
        const id = isRecord(tailEntries[k]) ? readOwn(tailEntries[k], "id") : undefined;
        if (typeof id === "string" && id === pinnedEntryId) {
          return tailStartIdx + k; // this entry ↔ messages[tailStartIdx + k]
        }
      }
      // 7) Pinned entry not in the retained tail (compacted away / wrong branch) → no-op this fire (identity-or-nothing).
      return null;
  - PRESERVE: the function signature, the return type number | null, the two defensive checks, the `export`. Reuse
    entryMessageYield (filter predicate) + isRecord/readOwn. (GOTCHA #2, #5, #6, #7, #8.)
  - NAMING: `lastCompactionIdx`, `tailEntries`, `tailStartIdx`, `k`. No new imports.
  - DEPENDENCIES: none.

Task 2: REWRITE src/transforms.ts:~813–828 — the resolvePinnedShrink JSDoc (Mode A docs)
  - The current JSDoc documents the OLD algorithm ("ALGORITHM (identical alignment walk to resolvePinnedHide §4):
    filter branchEntries to context-producing types, walk in parallel with messages via msgCursor + entryMessageYield,
    and return the FIRST message index (msgCursor) of the entry whose id === pinnedEntryId ... returns null when
    alignment is INDETERMINATE: a compaction/unknown entry type (entryMessageYield === -1)"). REWRITE the ALGORITHM
    section to document the retained-tail walk:
      * Find lastCompactionIdx (LAST compaction entry; -1 if none) by scanning branchEntries END→start.
      * tailEntries = entries AFTER it, context-message types only (entryMessageYield > 0).
      * Retained tail ↔ the LAST tailEntries.length messages (tailStartIdx = messages.length - tailEntries.length);
        if tailStartIdx < 0 → null (defensive alignment loss).
      * Walk the tail; return tailStartIdx + k on the FIRST entry whose id === pinnedEntryId; else null.
      * Entries in the compacted-away head are correctly unmatched (absent from messages → null). No-compaction case
        degenerates to the legacy forward walk (tailStartIdx === 0).
  - ADD a note: this UPGRADES spec/08 E24 for shrinks (retained-tail targets now resolve post-compaction; only
    compacted-head entries no-op). Reference §BUG-002 (system_context) + T2.S1 (resolvePinnedHide — same algorithm).
  - KEEP: the "WHY PINNED IDS / identity-or-nothing" rationale (still returns null, NOT live fallback — that would
    re-introduce the moving-target bug), the RETURNS/purity/defensive notes (number | null; never throws; isRecord/
    readOwn; never imports Pi; hot-path fail-open). Update only the ALGORITHM section + add the E24/BUG-002 note.
  - GOTCHA: JSDoc only — do not change the signature, return type, or any code. (GOTCHA #5, #8.)
  - DEPENDENCIES: Task 1.

Task 3: UPDATE test/transforms.test.ts — fix the ONE breaking test (c) (~line 1757)
  - LOCATE (verbatim, the buggy-assertion test):
      it("(c) compaction refusal — a branch containing a compaction entry → null (entryMessageYield === -1 → no-op)", () => {
        const msgs: MessageLike[] = [user("u"), asst("c1")];
        const branch: BranchEntry[] = [
          entry("e1", "message"), entry("eC", "compaction"), entry("e2", "message"),
        ];
        expect(resolvePinnedShrink(msgs, branch, "e2")).toBeNull(); // alignment INDETERMINATE → no-op (identity-or-nothing)
      });
  - REPLACE WITH (the post-fix CORRECT behavior):
      it("(c) compaction — pinned entry in the RETAINED TAIL resolves (BUG-002 fix; was null before)", () => {
        const msgs: MessageLike[] = [user("u"), asst("c1")];
        // root→leaf: e1 (compacted-away head), eC (compaction), e2 (retained tail). lastCompactionIdx=1; tailEntries=[e2];
        // tailStartIdx = 2 - 1 = 1 → e2 ↔ messages[1].
        const branch: BranchEntry[] = [
          entry("e1", "message"), entry("eC", "compaction"), entry("e2", "message"),
        ];
        expect(resolvePinnedShrink(msgs, branch, "e2")).toBe(1); // e2 is retained-tail → resolves to idx1 (was null before the fix)
      });
  - RATIONALE: trace — lastCompactionIdx=1 (eC at idx1); tailEntries=[e2]; tailStartIdx=2-1=1; e2→idx1. This is the
    single existing test whose expectation flips under the fix. (GOTCHA #1.)
  - GOTCHA: do NOT touch tests (a)/(b)/(d)/(e)/(f)/(g) — they stay green. (GOTCHA #4, #8.)
  - DEPENDENCIES: Task 1 (the rewrite must be in place for the updated expectation to pass).

Task 4: ADD new compaction test cases to test/transforms.test.ts (resolvePinnedShrink describe block, line 1733)
  - ADD these it(...) cases inside the SAME describe block, AFTER test (g) (before the closing `});` of the block).
    Reuse entry()/user()/asst()/result()/compactionSummary() helpers (compactionSummary is at test line 743). Mirror
    the compaction-branch-entry shape from resolveCheckpoint's tests (~838–860:
    `entry("c1","compaction",{summary:"s", firstKeptEntryId:"e3"})`):

    (h) PRODUCTION REPRO (BUG-002 shrink — the headline proof):
        it("(h) compaction in head + pinned retained-tail target → resolves (BUG-002 shrink production repro)", () => {
          const msgs: MessageLike[] = [user("u"), compactionSummary("s"), asst("c1"), result("c1")]; // 4 msgs idx 0..3
          const branch: BranchEntry[] = [
            entry("e1", "message"), entry("c1", "compaction", { summary: "s", firstKeptEntryId: "e3" }),
            entry("e3", "message"), entry("e4", "message"),
          ];
          // lastCompactionIdx=1; tailEntries=[e3,e4]; tailStartIdx=4-2=2 → e3↔idx2, e4↔idx3.
          expect(resolvePinnedShrink(msgs, branch, "e3")).toBe(2); // the pinned retained-tail target resolves (was null before)
          expect(resolvePinnedShrink(msgs, branch, "e4")).toBe(3);
        });

    (i) PINNED-IN-COMPACTED-AWAY HEAD → null (correct: absent from messages):
        it("(i) pinned entry in the COMPACTED-AWAY head → null (gone from messages; no leak, no error)", () => {
          const msgs: MessageLike[] = [user("u"), compactionSummary("s"), asst("c1")]; // 3 msgs
          const branch: BranchEntry[] = [
            entry("e1", "message"), entry("c1", "compaction", { summary: "s" }), entry("e3", "message"),
          ];
          // e1 is BEFORE the compaction (compacted-away head) → not in tailEntries → not matched → null.
          expect(resolvePinnedShrink(msgs, branch, "e1")).toBeNull();
        });

    (j) MULTIPLE COMPACTIONS — only the LAST matters:
        it("(j) multiple compactions — only the LAST compaction's tail is retained", () => {
          const msgs: MessageLike[] = [compactionSummary("s2"), asst("c1")]; // 2 msgs (2nd summary + retained tail e3)
          const branch: BranchEntry[] = [
            entry("e1", "message"), entry("c1", "compaction", { summary: "s1" }),
            entry("e2", "message"), entry("c2", "compaction", { summary: "s2" }), entry("e3", "message"),
          ];
          // lastCompactionIdx=3 (c2); tailEntries=[e3]; tailStartIdx=2-1=1 → e3↔idx1. e2 was compacted away by c2.
          expect(resolvePinnedShrink(msgs, branch, "e3")).toBe(1);   // retained-tail entry resolves
          expect(resolvePinnedShrink(msgs, branch, "e2")).toBeNull(); // e2 compacted away by c2 → gone
        });

    (k) NO-COMPACTION PARITY (degenerate to legacy walk):
        it("(k) no compaction on the branch → identical to the legacy forward walk (tailStartIdx === 0)", () => {
          const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1")];
          const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message"), entry("e3", "message")];
          // lastCompactionIdx=-1; tailEntries=[e1,e2,e3]; tailStartIdx=3-3=0 → legacy mapping.
          expect(resolvePinnedShrink(msgs, branch, "e1")).toBe(0); // identical to test (a) (e2→1 there)
          expect(resolvePinnedShrink(msgs, branch, "e3")).toBe(2);
        });

    (l) DEFENSIVE tailStartIdx < 0:
        it("(l) defensive — tail longer than messages (alignment lost) → null", () => {
          const msgs: MessageLike[] = [user("u")]; // 1 message
          const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message")]; // 2 retained-tail entries
          // tailEntries=[e1,e2] (len 2) > messages.length (1) → tailStartIdx = 1-2 = -1 → null.
          expect(resolvePinnedShrink(msgs, branch, "e1")).toBeNull();
        });
  - NAMING: titles name the compaction scenario + BUG-002 where relevant. Reuse the file's entry()/compactionSummary().
  - GOTCHA: for the compaction-summary MESSAGE (msgs array), use compactionSummary("s") (it exists at test L743);
    the exact content is irrelevant — only the count matters for tailStartIdx. compaction BRANCH entries use
    entry("c1","compaction",{summary:"s", firstKeptEntryId:"e3"}).
  - DEPENDENCIES: Task 1.

Task 5: VALIDATE (no new code)
  - RUN `npx vitest run test/transforms.test.ts` → all pass (updated (c) + new (h)–(l); (a)/(b)/(d)/(e)/(f)/(g) green;
    resolveCheckpoint's compaction tests ~838–860 UNCHANGED/green; resolvePinnedHide's tests = T2.S1's block — green
    and untouched).
  - RUN `npx vitest run` → full suite passes (applyShrink/filterPipeline integration tests unaffected — same number|null
    contract; null consumed as no-op at both call sites).
  - RUN `npx tsc --noEmit` → no new errors (signature unchanged; entryMessageYield reused as a predicate returns
    number; `> 0` is a valid boolean filter; the for-loop's `k` is number). Any pre-existing errors elsewhere are out of scope.
  - DEPENDENCIES: Tasks 1–4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): the retained-tail walk replaces the forward-walk-with-bail (single-ID adaptation).
//   KEY insight: getBranch() is RAW (compacted-away + compaction + tail); event.messages is compaction-aware.
//   The retained tail (entries AFTER the last compaction) maps 1:1 to the LAST N messages.
let lastCompactionIdx = -1;
for (let i = branchEntries.length - 1; i >= 0; i--) {       // scan END→start → first hit = LAST compaction
  const t = isRecord(branchEntries[i]) ? readOwn(branchEntries[i], "type") : undefined;
  if (t === "compaction") { lastCompactionIdx = i; break; }
}
const tailEntries = branchEntries
  .slice(lastCompactionIdx + 1)                              // entries AFTER the last compaction
  .filter((e) => entryMessageYield(e) > 0);                  // message/custom_message/branch_summary ONLY (yield 1)
const tailStartIdx = messages.length - tailEntries.length;   // retained tail ↔ the LAST tailEntries.length messages
if (tailStartIdx < 0) return null;                           // defensive: alignment lost → no-op
for (let k = 0; k < tailEntries.length; k++) {               // FIRST match only (entry ids are unique)
  const id = isRecord(tailEntries[k]) ? readOwn(tailEntries[k], "id") : undefined;
  if (typeof id === "string" && id === pinnedEntryId) return tailStartIdx + k;  // entry k ↔ messages[tailStartIdx + k]
}
return null;                                                 // compacted away / wrong branch → no-op

// WALK-THROUGH (production repro — Task 4 case h, pin "e3"):
//   msgs    = [user, compactionSummary, asst(c1), result(c1)]   // 4 messages (idx 0..3)
//   branch  = [e1(msg), c1(compaction), e3(msg), e4(msg)]
//   pin     = "e3"
//   scan: i=3 e4(msg) no; i=2 e3(msg) no; i=1 c1(compaction) YES → lastCompactionIdx=1, break.
//   tailEntries = branch.slice(2).filter(yield>0) = [e3(msg), e4(msg)]   (len 2)
//   tailStartIdx = 4 - 2 = 2
//   walk: k=0 e3 id "e3" === "e3" → return 2+0 = 2.   ✓ (was null before the fix)

// WALK-THROUGH (no-compaction parity — Task 4 case k / proves tests (a)/(b) stay green):
//   branch has NO compaction → lastCompactionIdx stays -1 → slice(0) = ALL entries → tailEntries = all
//   context-message entries → tailEntries.length === messages.length → tailStartIdx === 0 → entry k ↔ messages[k].
//   IDENTICAL to the legacy msgCursor=0 forward walk.

// CRITICAL: do NOT call isContextProducingType for the tail filter — it INCLUDES 'compaction' (GOTCHA #2).
//   entryMessageYield(e) > 0 is the correct one-call predicate (1 for message/custom_message/branch_summary only).
//   Return null (NOT []) on refusal/absence — the shrink contract is number | null (GOTCHA #5, #6).
```

### Integration Points

```yaml
CODE:
  - modify: src/transforms.ts — resolvePinnedShrink body (~839–842) → retained-tail walk; JSDoc (~813–828) rewritten
  - untouched: entryMessageYield (~549), isContextProducingType (~555), isRecord (173), readOwn (178),
    resolveCheckpoint (~454–540), resolvePinnedHide (~625, T2.S1's), applyShrink call site (~922),
    filterPipeline call site (~1471), applyRewind
TESTS:
  - modify: test/transforms.test.ts — update test (c) (~1757); add ~5 compaction cases (h)–(l) in the resolvePinnedShrink
    describe block (1733)
  - untouched: all other test files; resolveCheckpoint's compaction tests (~838–860); resolvePinnedHide's describe block (T2.S1's);
    applyShrink/filterPipeline integration tests
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. resolvePinnedShrink is a pure read-only resolver; no config keys, no persistence, no registration.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: no new errors from src/transforms.ts. The change is a body rewrite with an UNCHANGED signature;
# entryMessageYield is reused as a filter predicate (returns number; `> 0` is a valid boolean). Common mistakes:
#   - accidentally editing resolvePinnedHide/entryMessageYield/isContextProducingType/resolveCheckpoint (GOTCHA #3);
#   - changing the signature or return type (number | null; NOT number[]) (GOTCHA #5);
#   - returning [] instead of null on refusal (GOTCHA #6);
#   - a type error from the for-loop — `k` is number, `tailEntries[k]` is BranchEntry.
# Re-read the diff: ONLY resolvePinnedShrink's body (~839–842) + its JSDoc (~813–828) should differ.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The transforms test file — fast feedback on the algorithm swap.
npx vitest run test/transforms.test.ts
# EXPECTED: all pass. If test (c) FAILS with received=null expected=1 → you didn't update (c) (Task 3, GOTCHA #1).
# If a new compaction case fails, re-trace lastCompactionIdx / tailEntries / tailStartIdx for that fixture.
# resolveCheckpoint's compaction tests (~838–860) MUST still pass (proves entryMessageYield/isContextProducingType
# unchanged — GOTCHA #3). resolvePinnedHide's tests = T2.S1's block; they pass and are untouched.
# Test (f) (throwing-Proxy) MUST pass — confirms readOwn's throw-safety holds with the new direct readOwn call
# in the lastCompactionIdx scan (GOTCHA #8).

# Full suite — confirm applyShrink/filterPipeline integration tests still pass (same number|null contract; both
# call sites consume null as no-op).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: resolvePinnedShrink is a PURE resolver exercised directly by the unit tests. The
# end-to-end "does a pinned shrink actually substitute post-compaction" path runs through filterPipeline →
# resolvePinnedShrink → applyShrink, and is covered by the existing filterPipeline integration tests (which pass
# the resolved index / null through applyShrink). No live runtime seam is newly exercisable here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# TDD red→green confirmation (optional — proves test (c)'s update + the new cases lock in the fix):
#   1. BEFORE applying Task 1: the NEW compaction cases (h)/(j) FAIL with received=null (the bug). This is the red step.
#   2. Apply Task 1 → re-run → PASS (green). The red→green transition is the proof the fix works end-to-end.

# Grep sanity (confirm the retained-tail walk landed in resolvePinnedShrink and the bail is gone there):
grep -n 'lastCompactionIdx\|tailEntries\|tailStartIdx' src/transforms.ts
# EXPECTED: these appear TWICE now — once in resolvePinnedHide (T2.S1) and once in resolvePinnedShrink (this task).

grep -n 'if (y < 0) return' src/transforms.ts
# EXPECTED: the OLD `if (y < 0) return` bail is GONE from resolvePinnedShrink AND resolvePinnedHide, but STILL
# present in resolveCheckpoint (contiguous-sweep — correct, GOTCHA #3).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — no new errors from `src/transforms.ts` / `test/transforms.test.ts`.
- [ ] `npx vitest run test/transforms.test.ts` — all pass (updated (c) + new (h)–(l); (a)/(b)/(d)/(e)/(f)/(g) green).
- [ ] `npx vitest run` — full suite passes.

### Feature Validation
- [ ] `resolvePinnedShrink([user, summary, asst, result], [e1(msg), c1(compaction), e3(msg), e4(msg)], "e3") === 2` (BUG-002 shrink repro — was `null`).
- [ ] Pinned-in-compacted-head → `null` (correct — absent from messages).
- [ ] No-compaction branch → identical to the legacy walk (tests (a)/(b)/(k) green; `tailStartIdx === 0`).
- [ ] `tailStartIdx < 0` → `null` (defensive alignment-loss guard).
- [ ] resolvePinnedShrink body uses `lastCompactionIdx` + `tailEntries` + `tailStartIdx`; the old `if (y < 0) return null` bail is gone.

### Code Quality Validation
- [ ] Signature/return type UNCHANGED (`(messages, branchEntries, pinnedEntryId): number | null`); both call sites (922, 1471) untouched.
- [ ] `entryMessageYield` reused as the tail filter predicate (`> 0`); NOT `isContextProducingType` (which includes compaction).
- [ ] `entryMessageYield`, `isContextProducingType`, `isRecord`, `readOwn`, `resolveCheckpoint`, `resolvePinnedHide` are UNCHANGED.
- [ ] Only `src/transforms.ts` (resolvePinnedShrink body + JSDoc) and `test/transforms.test.ts` (test (c) + new cases) are modified.

### Documentation & Deployment
- [ ] resolvePinnedShrink JSDoc documents the retained-tail algorithm, the single-ID adaptation (FIRST match → one index), the no-compaction degenerate case, the compacted-head-unmatched correctness, and references spec/08 E24 + §BUG-002 + T2.S1 (Mode A).
- [ ] No README/spec change in this subtask (changeset doc sync is a separate task).

---

## Anti-Patterns to Avoid

- ❌ Don't reuse `isContextProducingType` for the retained-tail filter — it INCLUDES 'compaction' (wrong for the tail). Use `entryMessageYield(e) > 0` (1 for message/custom_message/branch_summary only) (GOTCHA #2).
- ❌ Don't touch `resolvePinnedHide` / `entryMessageYield` / `isContextProducingType` / `resolveCheckpoint` — resolveCheckpoint KEEPS its bail-on-compaction (contiguous-sweep); resolvePinnedHide is T2.S1's (in parallel) (GOTCHA #3).
- ❌ Don't forget to UPDATE test (c) — it asserts the BUGGY `null`; after the fix it returns `1`. Leaving it = a failing test (GOTCHA #1).
- ❌ Don't keep a running `msgCursor += yield` or build a `remove` array — resolvePinnedShrink resolves ONE id → ONE index. Return `tailStartIdx + k` on the FIRST match (early return). Each retained-tail entry yields exactly 1 message, so the offset is computed ONCE (GOTCHA #7).
- ❌ Don't change the signature or return `[]` — `number | null` is the contract. `null` (not `[]`) is applyShrink's/filterPipeline's no-op signal, and must NOT trigger live resolution (identity-or-nothing; GOTCHA #5, #6).
- ❌ Don't drop the `tailStartIdx < 0` guard — it's the defensive alignment-loss check that replaces the old `msgCursor + y > messages.length` refusal. Return `null` (GOTCHA #6).
- ❌ Don't break the no-compaction degenerate case — when `lastCompactionIdx === -1`, `tailStartIdx` must be `0` so tests (a)/(b)/(k) stay green. If they break, the tail filter or start-index math is wrong (GOTCHA #4).
- ❌ Don't worry that the direct `readOwn` call in the new lastCompactionIdx scan breaks test (f) — `readOwn` is throw-safe (try/catch → undefined). The trap entry is simply skipped by the scan and filtered out of the tail. (GOTCHA #8.)
- ❌ Don't skip the new compaction tests because "the unit tests pass" — the `null`-on-compaction bug was previously ASSERTED as correct (test (c)); without the new cases the fix can silently regress later.

---

## Decision Log

- **D1 — Mirror T2.S1's retained-tail walk exactly; adapt only for single-ID + `number | null`.** T2.S1 established the canonical algorithm (lastCompactionIdx scan → slice(after) → entryMessageYield>0 filter → tailStartIdx = messages.length - tailEntries.length → walk). The shrink resolver differs only in (a) one id, not a set (direct `===` comparison, not Set.has), (b) returns one index or null (not an array), (c) refuses with null (not []). Using the IDENTICAL scan+filter+tailStartIdx makes the two resolvers obviously parallel and lets the new compaction tests reuse T2.S1's traced fixtures almost verbatim.

- **D2 — Reuse `entryMessageYield` as the tail filter predicate (`> 0`), not `isContextProducingType`.** `isContextProducingType` includes 'compaction' (correct for resolveCheckpoint's whole-branch ctxEntries, wrong for the retained tail). `entryMessageYield` returns 1 for EXACTLY {message, custom_message, branch_summary} and -1 otherwise — a clean one-call filter that excludes compaction/label/custom. This reuses the existing helper without modifying it (resolveCheckpoint's contract preserved) and self-documents the "1 message per retained-tail entry" invariant. Identical to T2.S1 D2.

- **D3 — Return `null` on refusal/absence (NOT `[]`, NOT a live fallback).** The shrink contract is `number | null`: both call sites (applyShrink:922, filterPipeline:1471) consume `null` as a no-op. Returning `[]` would be a type error; falling back to live `resolveShrinkTarget` would re-introduce the moving-target bug that `pinnedEntryId` exists to prevent (identity-or-nothing, the rewind precedent). This is the deliberate asymmetry from resolvePinnedHide (which returns `[]` because it produces a removal SET) — each resolver keeps its own documented no-op sentinel.

- **D4 — FIRST-match early return (entry ids are unique).** Unlike resolvePinnedHide (which collects ALL pinned entries into an array), resolvePinnedShrink resolves ONE id → ONE index. Entry ids are unique on a branch, so there is at most one match; returning `tailStartIdx + k` on the first match avoids walking the rest of the tail needlessly and is the natural fit for the `number | null` return.

- **D5 — Scope = resolvePinnedShrink ONLY; resolvePinnedHide is T2.S1.** Both have the identical bug, but the plan splits them (resolvePinnedHide = 2 pts, the path-setting one; resolvePinnedShrink = 1 pt, mirroring the established algorithm). Touching resolvePinnedHide's body or its describe block crosses a task boundary and risks merge conflicts with the parallel sibling. This PRP consumes T2.S1's algorithm as a stable contract and applies it unchanged.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a focused algorithm swap of ONE function (body rewrite, signature preserved) that mirrors an already-specified sibling (T2.S1), backed by: (a) the verbatim current body + verbatim target body, (b) the exact algorithmic contract from T2.S1's PRP, (c) the authoritative algorithm sketch in system_context §BUG-002, (d) the exact one-test-that-breaks (c) with its traced post-fix value, (e) 5 new compaction test cases with traced expected values reusing the confirmed `compactionSummary()` helper, (f) the no-compaction degenerate proof that tests (a)/(b) stay green, (g) the throw-safety proof for `readOwn` (so the direct call in the new scan keeps test (f) green), and (h) the hard constraint (GOTCHA #2/#3) to reuse `entryMessageYield` as the predicate and leave `resolveCheckpoint`/`resolvePinnedHide` alone. Residual risks: (1) forgetting to update test (c) (mitigated by GOTCHA #1 + Task 3); (2) accidentally returning `[]` instead of `null` (mitigated by GOTCHA #5/#6 + the Anti-Patterns).