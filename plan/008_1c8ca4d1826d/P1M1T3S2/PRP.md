# PRP — P1.M1.T3.S2 (rev 2): filterPipeline scope-guard tests + land the span-end cap

**RE-PLANNING NOTE (attempt 2/3).** Attempt 1 delivered cases (a)–(c) green and case (d) as a
documented `it.fails` tripwire, because the landed `markerTurnSpan` never caps `span.end`. The
feedback resolves the design conflict in favor of scope_guard_design.md §1.4/§3 (cap the end),
so **this PRP now authorizes exactly one production change in `src/transforms.ts`** plus
flipping the tripwire. That supersedes attempt 1's "don't touch src/transforms.ts" guard —
that guard existed only because the item was believed test-only.

## Goal

**Feature Goal**: The shrink scope guard is complete and test-locked in both directions: a pinned
in-turn shrink PERSISTS across later user messages (issuing-turn bound, not fire-time), and a LIVE
(unpinned) selector can never re-target into a LATER turn — `markerTurnSpan.end` is capped at the
next user message after the marker's position.

**Deliverable**:
1. One production edit in `src/transforms.ts` `markerTurnSpan`: cap `span.end`.
2. `test/transforms.test.ts`: flip the existing `it.fails` case (d) to a plain `it()` (update its
   stale KNOWN-CONTRACT-GAP comment); keep/verify cases (a)–(c) unchanged and green; optionally add
   a direct `markerTurnSpan` unit test for the cap boundary.

**Success Definition**: `npx tsc --noEmit` clean; `npx vitest run test/transforms.test.ts` all green
(including the now-plain case (d)); full suite green (`npx vitest run`); no behavior change for any
in-scope target (cases (a)–(c) untouched and green prove it).

## Why

- PRD §2 issuing-turn ruling (see selected PRD, spec/06 §5 v2.0): "neither selector drift, nor
  pinning, nor compaction re-entry can apply a shrink to an earlier turn" — and by symmetry (§1.4/§3
  of scope_guard_design.md) never a LATER one. The landed implementation only bounds the START.
- Attempt 1 verified empirically: with `[u0, a1, read(IN), u1, a2, read(LATER)]` and the marker
  before `u1`, the live `read`/`last` selector substitutes LATER (index 5), not IN (index 2) — the
  exact drift the guard exists to prevent.
- Design docs conflicted; the resolution (feedback) picks the cap: `end = index of the first user
  message at or after markerMsgPos, falling back to messages.length`.

## What

Change `markerTurnSpan` step 6 in `src/transforms.ts` (currently ends the function with
`return { start: iLastUser + 1, end: messages.length };`):

```ts
// end: the FIRST user message at-or-after the marker boundary terminates the issuing turn
// (feedback resolution; scope_guard_design.md §1.4/§3 beat §2.2's literal fire-time reading).
let iNextUser = messages.length;
for (let i = markerMsgPos; i < messages.length; i++) {
  if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") { iNextUser = i; break; }
}
return { start: iLastUser + 1, end: iNextUser };
```

Also update the function's JSDoc "ALGORITHM" step 6 and the "Turn bound" paragraph (lines ~1228 and
~1283-1285 area) to describe the cap (one or two sentences — match the existing dense comment style).
**Do not change anything else in the function** (guards, compaction scan, alignment, yielded walk
stay byte-identical).

Then in `test/transforms.test.ts`:
- Replace the `KNOWN CONTRACT GAP ...` comment block + `it.fails(` at the end of the
  `filterPipeline — shrink scope guard (...)` describe block with a plain `it(` and a short comment
  noting the cap is landed (this item). **Do not otherwise modify the test body** — its assertions
  are already correct (in-turn read at idx 2 stamped, LATER READ at idx 5 verbatim).
- Verify (do not edit) cases (a)–(c) still pass — they must, per the feedback's own analysis:
  - (a) pinned fire-2: markerMsgPos=3, next user at index 3 (`u1`) → span [1,3); pinned idx 2 in-span.
  - (b) span [4,6) (no later user → end stays 6); pin at idx 2 → still out-of-scope no-op.
  - (c) unaffected (span null paths).
- Optional but recommended: a direct unit test of `markerTurnSpan` (it's exported) covering
  end-cap boundary: marker between two turns → `end === index of next user`; marker in final
  turn → `end === messages.length`.

## All Needed Context

### Documentation & References

```yaml
- file: src/transforms.ts
  why: markerTurnSpan (line ~1245) — the ONLY production function to edit; also the
        filterPipeline shrink loop (lines ~1723-1785) which consumes the span
        (pinned: origIdx vs span bounds; live: translateSpanToReduced then applyShrink).
  pattern: keep the existing comment density/style; readOwn/isRecord for every field access.
  gotcha: filterPipeline calls markerTurnSpan on the ORIGINAL messages; the cap uses original
          indices — no translation needed inside markerTurnSpan itself.

- file: test/transforms.test.ts
  why: the scope-guard describe block (search "filterPipeline — shrink scope guard"); the
        it.fails case (d) + its KNOWN CONTRACT GAP comment are at the end of that block.
        Helpers already in scope: user(), asst(), result(), readMsg(), entry(id,type),
        mkShrink(seq, target, replacement, {pinnedEntryId?, markerEntryId?}), stampShrink(),
        textOf(), cfg, MarkerBundle, BranchEntry, MessageLike.
  pattern: pure fixtures only — NO mocks, NO Pi.
  gotcha: do NOT touch the other 190+ tests in this file.

- file: plan/008_1c8ca4d1826d/architecture/scope_guard_design.md
  why: §1.4/§3 are the authoritative ruling the cap implements; §2.2's literal reading is the
        superseded one. Read-only for behavior; you MAY append a one-line reconciliation note to
        §2.2 if it still says "messages.length" uncapped (keep it to one sentence).
```

### Current code state (verified)

- `markerTurnSpan` returns `{ start: iLastUser + 1, end: messages.length }` — step 6 scan only
  looks at `i < markerMsgPos`. The fix adds a forward scan for the terminating user message.
- The live path translates the original-space span via `translateSpanToReduced` (conservative,
  never widens) — narrowing `end` is safe there.
- Full suite was 1087/1087 with case (d) as `it.fails`; transforms.test.ts was 196/196.

### Known Gotchas

```text
# CRITICAL: cap at the FIRST user at-or-after markerMsgPos — an agent message after the marker
#   in the SAME turn (e.g. marker mid-turn, then more assistant/tool messages, then the turn's
#   own results) must stay IN the span. Only a `role === "user"` message terminates the turn.
# CRITICAL: fallback end = messages.length when no later user exists (final turn — case (a)
#   fire-1 and case (b) depend on this).
# CRITICAL: keep markerTurnSpan pure, Pi-free, zero new imports, never throwing (E13).
# GOTCHA: `entryMessageYield` counts message/custom_message/branch_summary entries; custom
#   entries (the marker itself) yield 0 — do not "simplify" the walk.
```

## Implementation Tasks (ordered)

```yaml
Task 1: EDIT src/transforms.ts — markerTurnSpan end cap (code block above) + JSDoc step-6 update
Task 2: EDIT test/transforms.test.ts — flip it.fails → it, replace the gap comment
Task 3: (optional) ADD direct markerTurnSpan unit test(s) in the existing style
Task 4: RUN validation gates below; fix ONLY regressions caused by the cap (none expected per
        the feedback's own analysis — if (a)-(c) break, re-check the cap scan bounds before
        touching tests)
Task 5: (optional) one-line reconciliation note in architecture/scope_guard_design.md §2.2
```

## Validation Loop

```bash
npx tsc --noEmit                                   # zero errors
npx vitest run test/transforms.test.ts             # all green, case (d) now plain it()
npx vitest run                                     # full suite green (baseline 1087 + 1 flipped)
```

The flipped case (d) MUST be a plain passing `it()` — leaving any `it.fails` behind is failure.

## Final Validation Checklist

- [ ] `markerTurnSpan` caps `end` at next user (fallback: `messages.length`); nothing else in the function changed
- [ ] Case (d) is a plain green `it()`; gap comment removed
- [ ] Cases (a)–(c) byte-untouched and green
- [ ] tsc + full vitest suite green
- [ ] No mocks anywhere new; transforms.ts stays 0-import/Pi-free
- [ ] Only files touched: `src/transforms.ts`, `test/transforms.test.ts` (plus optional one-line
      design-doc note). NEVER touch PRD.md, tasks.json, prd_snapshot.md, .gitignore.

## Anti-Patterns to Avoid

- ❌ Don't rebind the span to the FIRE-TIME current turn (that expires markers — case (a) guards it)
- ❌ Don't cap at the next ASSISTANT message or the next toolResult — only `role === "user"` terminates
- ❌ Don't touch filterPipeline, applyShrink, resolvePinnedShrink, or translateSpanToReduced
- ❌ Don't weaken or delete cases (a)–(c) to make the cap pass — if they fail, the cap is wrong
- ❌ Don't catch-all or add imports in transforms.ts

**Confidence Score: 9/10** — the fix is a verified one-line design decision with pre-analyzed
non-regression on all three landed cases; the test body already exists and passes once capped.