---
name: "P1.M2.T4.S1 — cancel test lock: full-history hints, pinned-identity covering, marker-span live fallback, two-arm schema"
---

## Goal

**Feature Goal**: Lock the v2.0 `mulligan_cancel` behavior (from P1.M2.T3.S1/S2, assumed landed exactly per their PRPs) with tests in `test/tools/cancel.test.ts`: (a) FULL-HISTORY hint resolution — a shrink marker issued LAST turn is still cancellable by a `by_tool_call_id`/`by_tool_name` hint matching its (now previous-turn) target → `cancelled:true` (@05 §5 v2.0: cancel is not current-turn-scoped); (b) covering-check pinned path — a shrink with `pinnedEntryId === entryId(matched message)` is retired even when its live selector has drifted; (c) the unpinned (live) covering fallback resolves within the MARKER's own issuing-turn span and does NOT cover a message from a later turn; (d) schema two-arm — content-substring `target` fails the real host-validation pipeline while both v2.0 arms pass; (e) markerId fallback, idempotency, and the exact no-op/success/refusal texts stay regression-guarded (retain the existing verbatim string assertions).

**Deliverable**: Edited `test/tools/cancel.test.ts` only — a `getBranch()` arm on `makeCtx` (with a `branchEntries` option), a `pinnedEntryId?` opt on `makeShrinkEntry`, case (c) rewritten minimally to two-arm equivalents, the `CANCEL_DESC` verbatim assertion tracking the current 2-arm string, and a new describe block for (a)/(b)/(c). NO production-code edits.

**Success Definition**: `npx vitest run test/tools/cancel.test.ts` green; `npm test` + `npm run typecheck` green; every new behavior from P1.M2.T3.S2's Success Definition has an automated lock in this file (its PRP deferred the lock to this item).

## Why

P1.M2.T3.S2 upgraded the covering check (pinned identity → span-bounded live → unspanned fallback) and P1.M2.T3.S1 changed the schema/description, but explicitly deferred the test lock: its validation loop only ran manual reasoning checks. Without this item the v2.0 cancel contract — full-history hint reachability (E21 acceptance-(a)), pinned-identity covering under selector drift, and span-bounded live fallback — is unguarded against regression, and the spec/10 §1.11 cancel cases are still exercised through the interim cast-based content-arm cases.

## What

### Exact edits

1. **makeCtx — add `getBranch()`** (fake sessionManager, ~:98-113): new option `branchEntries?: SessionEntry[]` defaulting to `[]`. Method:
   ```ts
   getBranch() {
     if (opts.throwOnGetBranch) throw new Error("getBranch boom"); // optional new flag, mirrors filter.test.ts:123
     return branchEntries;
   }
   ```
   Default `[]` keeps every existing test green: `markerTurnSpan` finds no marker in the branch → null → unspanned fallback = pre-v2.0 live behavior, which is exactly what the existing (a1)/(b)/(d)/(e) fixtures assert.

2. **makeShrinkEntry — add `pinnedEntryId?: string`** to the opts object (~:204): when present, include `pinnedEntryId` in `data` (next to `target`). Document: pin holds an ENTRY id (`"e-N"`), NEVER a message index.

3. **CANCEL_DESC verbatim assertion** (:464-473): re-read `src/tools/cancel.ts` CANCEL_DESC and make the test's expected literal byte-identical to the CURRENT string (the v2.0 two-arm wording landed by P1.M2.T3.S1 — as of this writing it already says "by_tool_call_id, by_tool_name+occurrence" with no `by_content_includes`; if the landed string drifted, update the test literal — never edit the source).

4. **Case (c) rewrite (minimal — :682-:721)**: replace the two interim cast-based legacy-no-op cases with two-arm equivalents:
   - "(c) by_tool_name+occurrence covering-check via the marker's OWN selector": a message snapshot where a shrink's own `{by_tool_name:"bash", occurrence:"last"}` selector resolves to the matched index → retired (same shape as b-last but with `bash`, so (c) covers the second arm explicitly).
   - "(c-neg) hint matches, no marker covers → no-op": keep the e1-family shape but drop the content-arm cast entirely — use `{by_tool_call_id:"call-B"}` matched vs `{by_tool_call_id:"call-A"}` marker (or fold into existing (e); if redundant, delete and note in the describe header that (e) covers it — full migration of remaining content-arm sites is P1.M4.T1.S2, NOT this item).
   - The `as unknown as CancelArgs["target"]` casts in the OLD (c)/(c-neg) must not survive in the rewritten cases.

5. **NEW describe block** — `mulligan_cancel — v2.0 covering lock (P1.M2.T3.S2: pinned identity, marker-span live fallback, full-history hints)`, `beforeEach(() => resetSnapshotSeq())` (same isolation as the S3 describe). Tests:

   **(v2-a) FULL-HISTORY hint — last-turn marker cancellable by hint**
   - `contextEntries`: `msgEntry("user", {content:"u0"})`, `msgEntry("toolResult", toolResult("call-A","read","big"))` (entry `e-2`, msg idx 1), `msgEntry("user", {content:"u1 (latest turn)"})` (msg idx 2).
   - `entries`: `makeShrinkEntry("entry-sh-1","uuid-sh-1",{target:{by_tool_call_id:"call-A"}, seq:1})`.
   - `branchEntries` (root→leaf, CRITICAL ORDER): `[user0Entry, toolResultEntry, shrinkEntry("entry-sh-1"), user1Entry]` — the marker sits BETWEEN the turn-1 messages and the latest user message, so `markerTurnSpan` → `{start:1, end:2}` (turn 1 only).
   - Run `{target:{by_tool_call_id:"call-A"}}` → hint resolves FULL-HISTORY to msg idx 1 (no span on the hint call); marker's live fallback resolves within its span → idx 1 === matchedIndex → **covers** → exactly one `mulligan:cancel` appended, `targetId === "uuid-sh-1"`, `res.details` → `{cancelled:true, markerId:"leaf-1"}`. This locks @05 §5 v2.0: cancel is not current-turn-scoped.
   - **Pass-by-reference note**: `branchEntries` must contain the SAME entry objects as `contextEntries` for the message entries is not required (markerTurnSpan matches by yield COUNT, not identity) — but reuse the same `msgEntry(...)` calls for both arrays by building the entries once into local consts and spreading into both options.

   **(v2-b) pinned-identity covering — selector drift tolerated**
   - `contextEntries`: `read1 = msgEntry("toolResult", toolResult("call-A","read","first"))` (entry `e-1`, idx 0), `read2 = msgEntry("toolResult", toolResult("call-B","read","second"))` (entry `e-2`, idx 1). No user messages needed.
   - `entries`: `makeShrinkEntry("entry-sh-pin","uuid-sh-pin",{target:{by_tool_name:"read", occurrence:"last"}, pinnedEntryId:"e-1", seq:1})` — the live selector has DRIFTED (resolves to idx 1), but the pin is `e-1` (idx 0's ENTRY id).
   - `branchEntries`: `[read1Entry, read2Entry, shrinkEntry]` (marker after both → span `{start:0, end:2}`; irrelevant — pinned arm short-circuits).
   - Run `{target:{by_tool_call_id:"call-A"}}` → matchedIndex 0, `matchedEntryId "e-1" === pinnedEntryId` → **covers** (even though the live selector points at idx 1) → `targetId === "uuid-sh-pin"`, `cancelled:true`.
   - Companion negative: same fixture but `pinnedEntryId:"e-2"` → pin ≠ matched entry id AND live (spanned or not) resolves to idx 1 ≠ matchedIndex 0 → NOT covered → `appended` length 0, `firstText(res)` === `"Mulligan: no active marker found for that target — nothing to cancel."`, `details` → `{cancelled:false}`.

   **(v2-c) live fallback is span-bounded — does NOT cover a later-turn message**
   - `contextEntries`: `user0 = msgEntry("user",{content:"u0"})` (idx 0), `read1 = msgEntry("toolResult", toolResult("call-A","read","turn-one read"))` (entry `e-2`, idx 1), `user1 = msgEntry("user",{content:"u1"})` (idx 2), `read2 = msgEntry("toolResult", toolResult("call-B","read","turn-two read"))` (entry `e-4`, idx 3).
   - `entries`: `makeShrinkEntry("entry-sh-old","uuid-sh-old",{target:{by_tool_name:"read", occurrence:"last"}, seq:1})` — unpinned.
   - `branchEntries`: `[user0Entry, read1Entry, shrinkEntry, user1Entry, read2Entry]` — marker issued in TURN 1; `markerTurnSpan` → `{start:1, end:2}` (ends at the next user message).
   - Run `{target:{by_tool_name:"read", occurrence:"last"}}` → hint (full-history) matches `read2` at idx 3; the marker's spanned live resolution is bounded to `[1,2)` → resolves to idx 1 (or null) — ≠ 3 → **NOT covered** → no-op: `appended` length 0, target-path no-op text, `{cancelled:false}`.
   - Control on the same fixture: run `{target:{by_tool_call_id:"call-A"}}` instead → matchedIndex 1, spanned live resolves idx 1 → covers → `targetId === "uuid-sh-old"`, `cancelled:true`. (Two separate `it`s.)

   **(v2-d) span indeterminable → unspanned fallback (regression shape)**
   - Same fixture as (v2-c) but `branchEntries: []` (marker not in the branch — compacted head shape) → span null → UNPANNED live resolution: `{by_tool_name:"read", occurrence:"last"}` now resolves full-array to idx 3; matchedIndex is 3 → **covers** → `cancelled:true`. This pins the documented "retraction prefers reachability" fallback (T3.S2 JSDoc).

6. **Existing host-validation schema test (:481-500)**: already asserts legacy `by_content_includes` FAILS and both 2-arm targets PASS through `prepareArguments → Value.Convert → Compile(CancelParams).Check` — verify it still passes unchanged (it satisfies contract point (d)); if T3.S1's landed schema drifted the union, align the two PASS literals to the landed arms — never weaken the FAIL assertion.

7. **Retain untouched (contract point (e))**: Cases 1-7, markerId-wins (f), idempotency (g-idempotent), the verbatim no-op/success/refusal text assertions, `details`-on-every-path block, types block. Do not refactor them beyond what the `getBranch` addition forces (nothing).

### Success Criteria

- [ ] (a) last-turn shrink cancellable by `by_tool_call_id` hint → `cancelled:true`
- [ ] (b) pinned shrink retired under selector drift (pin === matched ENTRY id); negative variant no-ops
- [ ] (c) unpinned shrink does NOT cover a later-turn message; control case covers within span
- [ ] span-null (empty branch) → unspanned fallback covers
- [ ] schema: content arm fails real host pipeline; both v2.0 arms pass
- [ ] markerId fallback / idempotency / no-op texts still verbatim-guarded; `CANCEL_DESC` assertion matches landed string
- [ ] `clearAll()` before+after each test; no `vi.fn()` anywhere; `.js` import paths
- [ ] `npx vitest run test/tools/cancel.test.ts`, `npm test`, `npm run typecheck` all green

## All Needed Context

### Context Completeness Check

An implementer reading only this PRP + `test/tools/cancel.test.ts` + `src/tools/cancel.ts` has every fixture shape, line anchor, and string needed. Upstream behavior is fully pinned by the two prior PRPs (T3.S1 schema/desc, T3.S2 covering logic) summarized above.

### Documentation & References

```yaml
- file: test/tools/cancel.test.ts
  why: THE file. makeCtx :79-113 (add getBranch + branchEntries opt); makeShrinkEntry :198-226 (add pinnedEntryId opt);
       msgEntry :264 + toolResult :276 + resetSnapshotSeq :253; CANCEL_DESC verbatim block :464-473;
       schema pipeline test :481-500; target-path cases (a1)-(g) :591-~930; interim (c)/(c-neg) :682-721 to rewrite
  pattern: hand-rolled fakes, NO vi.fn(), it.each/expect verbatim strings, distinct entry.id vs data.id(uuid) fixtures
  gotcha: global clearAll() before/after EACH test (GOTCHA #8 nextSeq); resetSnapshotSeq() in any describe using msgEntry

- file: src/tools/cancel.ts
  why: code under test. CancelParams union + CANCEL_DESC :137-144 (source of truth for the verbatim test literal);
       resolveTargetUuid :253-316 (post-T3.S2: getBranch read, shrink two-arm covering, full-history hint);
       no-op/success texts (search "no active marker found for that target", "marker cancelled. The transform")
  gotcha: never edit this file — test-only item; if a test disagrees with the landed source, the TEST is wrong unless
          the source contradicts the T3.S1/T3.S2 PRPs (then report, don't patch around it)

- file: src/transforms.ts
  why: markerTurnSpan :1247-1310 (exact span semantics the branchEntries fixtures encode: marker-by-ENTRY-id, yield walk,
       start = last user before markerMsgPos + 1, end = first user at/after); resolveShrinkTarget (3-arg, optional span)
  gotcha: message entries yield 1, custom marker entries yield 0; no compaction in fixtures → tail = whole branch

- file: plan/008_1c8ca4d1826d/P1M2T3S2/PRP.md
  why: the covering-check CONTRACT this item locks (two-arm rule, null-span fallback, full-history hint)

- file: plan/008_1c8ca4d1826d/architecture/_scouts/tests.md
  why: §1 harness conventions (vitest scripts, clearAll idiom, fake patterns); §2 line census incl. cancel :466/:658-691

- file: test/filter.test.ts
  why: :100-125 — the existing getBranch fake precedent (throwOnGetBranch flag, fresh-read comment) to mirror in makeCtx
```

### Current Codebase tree (relevant slice)

```bash
src/tools/cancel.ts        # code under test (v2.0 after T3.S1+S2)
test/tools/cancel.test.ts  # THE deliverable (~950 lines)
src/transforms.ts          # markerTurnSpan / resolveShrinkTarget (3-arg)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Only test/tools/cancel.test.ts is modified.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: THREE ids — entry.id ("entry-sh-1"/"e-1"), data.id (uuid "uuid-sh-1"), pinnedEntryId (an ENTRY id "e-N").
//   Pin compare is pinnedEntryId === matchedEntryId (the matched message's entry id), NEVER a message index.
// CRITICAL: branchEntries is ROOT→LEAF (chronological) and must place the marker entry BETWEEN the turn's messages
//   and the NEXT user message — the marker's position determines markerTurnSpan's start/end.
// GOTCHA: getBranch() is now called on EVERY target-path invocation → makeCtx MUST provide it or the try/catch
//   swallows and every covering test silently becomes a no-op test. Default branchEntries:[] preserves old behavior
//   (span null → unspanned fallback).
// GOTCHA: hint resolution (params.target) has NO span — full history is the v2.0 contract; don't "fix" fixtures
//   that hint-match a previous-turn message — that's the (v2-a) test's whole point.
// GOTCHA: global clearAll() (beforeEach+afterEach at file top) + resetSnapshotSeq() inside each describe that
//   builds msgEntry fixtures — two tests otherwise collide on "e-1".
// GOTCHA: no vi.fn() — hand-rolled objects cast `as unknown as ExtensionContext`/`ExtensionAPI`; `.js` import paths.
// GOTCHA: clearAll is imported from ../../src/runtime.js; setConfig(undefined) resets to DEFAULT_CONFIG (enabled).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT makeCtx (test/tools/cancel.test.ts)
  - ADD opts.branchEntries?: SessionEntry[] (default []) + opts.throwOnGetBranch?: boolean
  - ADD getBranch() to the fake sessionManager (filter.test.ts:123 precedent), with the explanatory comment
  - CHECK: full existing suite still green (default [] → unspanned fallback everywhere)

Task 2: EDIT makeShrinkEntry
  - ADD pinnedEntryId?: string to the opts type; include in data when present; JSDoc: ENTRY id, not an index

Task 3: SYNC the CANCEL_DESC verbatim test (:464-473)
  - Read src/tools/cancel.ts CANCEL_DESC; make the test literal byte-identical (update ONLY the test)

Task 4: REWRITE case (c)/(c-neg) (:682-721) to two-arm equivalents per "What" #4; remove the casts

Task 5: ADD the new describe block per "What" #5 — tests (v2-a), (v2-b)+negative, (v2-c)+control, (v2-d)
  - beforeEach(() => resetSnapshotSeq()); reuse msgEntry/toolResult/makeShrinkEntry builders
  - Build message entries ONCE as consts; pass the same objects into both contextEntries and branchEntries

Task 6: VERIFY the schema pipeline test (:481) unchanged-and-green; align PASS literals to landed arms if drifted

Task 7: VALIDATE (below) — fix red before finishing; NO production-code edits
```

### Implementation Patterns & Key Details

```ts
// Fixture skeleton for the v2.0 block (order is the contract):
const u0 = msgEntry("user", { content: "u0" });
const r1 = msgEntry("toolResult", toolResult("call-A", "read", "turn-one read")); // entry e-2 after reset
const sh = makeShrinkEntry("entry-sh-old", "uuid-sh-old", { target: { by_tool_name: "read", occurrence: "last" }, seq: 1 });
const u1 = msgEntry("user", { content: "u1" });
const r2 = msgEntry("toolResult", toolResult("call-B", "read", "turn-two read")); // entry e-4
const { ctx } = makeCtx({
  contextEntries: [u0, r1, u1, r2], // the flattened snapshot (messages)
  entries: [sh],                     // getEntries — the marker scan
  branchEntries: [u0, r1, sh, u1, r2], // root→leaf; marker INSIDE turn 1 → span {start:1,end:2}
});
// (v2-c) hint {by_tool_name:"read",occurrence:"last"} → matched idx 3; spanned live → idx 1 ≠ 3 → no-op
// (v2-c control) hint {by_tool_call_id:"call-A"} → matched idx 1; spanned live → idx 1 → covers → cancelled:true
```

### Integration Points

```yaml
# None — test-only item. No src/, config, package.json, or smoke changes.
# P1.M4.T1.S2 later sweeps the REMAINING by_content_includes sites elsewhere; do NOT touch them here.
```

## Validation Loop

### Level 1-2 (this item's gate)

```bash
npx vitest run test/tools/cancel.test.ts -v   # THE deliverable gate — all green
npm test                                      # full suite green (no cross-file regressions)
npm run typecheck                             # tsc --noEmit
grep -n "getBranch" test/tools/cancel.test.ts          # fake present + scripted
grep -n "pinnedEntryId" test/tools/cancel.test.ts      # fixture opt + the (v2-b) fixtures
grep -n "as unknown as CancelArgs" test/tools/cancel.test.ts  # expect ZERO in the rewritten (c) block
```

### Level 3: manual reasoning cross-check

For each new test, confirm the assertion could FAIL if the corresponding T3.S2 behavior regressed: (v2-a) fails if a span is (wrongly) applied to the hint; (v2-b) fails if the pinned arm is removed; (v2-c) fails if the live fallback is unspanned; (v2-d) fails if a null span wrongly no-ops.

## Final Validation Checklist

- [ ] All validation commands green; zero production-file changes (`git status` shows only test/tools/cancel.test.ts)
- [ ] (a)/(b)/(c)/(d)/(e) contract points each locked by at least one named test
- [ ] Existing cases 1-7 + (a1)-(g) untouched except the (c) rewrite and the makeCtx/getBranch addition
- [ ] House idiom respected: no vi.fn(), `.js` imports, clearAll() hooks, verbatim text assertions
- [ ] No edits to by_content_includes sites outside cancel.test.ts's (c) block (P1.M4.T1.S2 owns the sweep)

## Anti-Patterns to Avoid

- ❌ Don't edit src/tools/cancel.ts (or any src file) to make a test pass — this is a test-lock item
- ❌ Don't put a span on the hint resolution in fixtures' expectations — full-history is the contract being locked
- ❌ Don't compare pinnedEntryId to a message index or to the marker's own entry id
- ❌ Don't make branchEntries default to the entries array — default `[]` (span-null fallback) is what keeps old tests green
- ❌ Don't sweep other test files' by_content_includes occurrences (P1.M4.T1.S2) or add vi.fn()/mocks

**Confidence Score: 9/10** — pure test work against a fully-specified contract; every fixture shape, ordering rule, and verbatim string is pinned above; the only residual risk is drift between the landed T3.S2 code and its PRP, which Task 3/6's "read the source" steps absorb.