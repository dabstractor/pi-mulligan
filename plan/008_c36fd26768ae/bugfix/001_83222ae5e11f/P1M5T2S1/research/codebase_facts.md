# P1.M5.T2.S1 — Codebase Research Notes (BUG-006: reset lastCommit in gc())

## The defect (verified in source)

`GitBackend` (src/snapshot/git.ts) keeps two private fields that accumulate across captures but are
NEVER reset anywhere in the codebase (confirmed by grep — `capturesThisTurn = 0` / `lastCommit = null`
appear ONLY in their private declarations; no reassignment site exists):

1. **`private lastCommit: string | null = null;`** (git.ts:218)
   - SET at git.ts:377: `this.lastCommit = commitSha;` (after every successful capture)
   - READ at git.ts:366: `if (this.lastCommit) commitArgs.push("-p", this.lastCommit);`
   - Effect: EVERY capture chains onto the previous via `-p <parent>`. After gc() deletes the
     `refs/mulligan/snapshots/turn/*` refs, the deleted turn commits remain REACHABLE through the
     parent chain of every subsequent commit-tree. `git gc` reclaims only UNreachable objects → the
     deleted turn-snapshot commits (and their exclusive blobs) are never reclaimed for the rest of
     the session → unbounded within-session shadow-repo growth. Contradicts spec §5 "physically
     reclaims". Bounded by session_shutdown (destroy() → fsRm(shadowDir)).

2. **`private capturesThisTurn = 0;`** (git.ts:219)
   - INCREMENTED at git.ts:378: `this.capturesThisTurn++;`
   - CHECKED at git.ts:327: `if (this.capturesThisTurn >= this.cfg.maxSnapshotsPerTurn) return null;`
   - Comment on the field claims "reset by lifecycle P3 at turn boundary" — but NO such reset exists.
   - Effect: after `maxSnapshotsPerTurn` (default 64, config.ts:212) successful captures, EVERY
     subsequent capture() returns null (aborts). Across enough turns in a long session, captures
     silently stop working. gc() is the turn-boundary point (capture.ts gcTurnSnapshots →
     rt.store.gc() at turn_start) → the correct reset location.

## The fix (work-item spec — exact placement)

In gc() (git.ts:636), AFTER the ref-deletion `for` loop (ends at line 655) and BEFORE the
`// (2) physical reclaim` comment (line 657) / the `git gc --auto --prune=now` call (line 658):

```typescript
// BUG-006: reset the commit chain so deleted turn/* commits become unreachable from future
// commits → git gc can reclaim them. Also reset the maxSnapshotsPerTurn counter (the turn
// boundary / GC pass is the spec'd reset point — currently never reset, which could prevent
// captures after enough turns).
this.lastCommit = null;
this.capturesThisTurn = 0;
```

This is safe because gc() already acquires the mutex (spec §4.3 — serialized with capture/restore).
Two field assignments are instant; no I/O added.

## Why placement is inside try (not finally)

If the ref-deletion loop throws (a git error mid-loop), the catch handles it and the reset does NOT
run — correct: the next gc() retries the whole pass including the reset. If the reset runs but the
`git gc` command then fails, lastCommit is already null → commits are unreachable → a future gc
reclaims them. So inside-try-between-loop-and-gc is correct + matches the work-item's exact wording
("AFTER the ref deletion loop and BEFORE the git gc call").

## gc() JSDoc update (Mode A)

The gc() JSDoc (lines ~622-635) currently says it "Drops EVERY refs/mulligan/snapshots/turn/* ref ...
AND physically reclaims via git gc --auto --prune=now". Add a sentence noting the lastCommit +
capturesThisTurn reset so the "physically reclaims" claim (spec §5) actually holds.

## Test design (behavioral — fields are PRIVATE)

`lastCommit` / `capturesThisTurn` are private → test via observable capture() behavior through the
existing DI-seam fake in test/git.test.ts (`makeBackend` / `makeExec` / `findCmd`).

### Test A: lastCommit reset breaks the commit chain across gc()
- capture("turn") → commit-tree args: `["commit-tree","TREE123","-m","snapshot:turn"]` (NO -p; lastCommit was null).
- capture("turn-after") → commit-tree args: `["commit-tree","TREE123","-p","COMMIT456","-m","snapshot:turn-after"]` (-p COMMIT456; chained).
- gb.gc() → resets lastCommit = null.
- capture("turn") again → commit-tree args: `["commit-tree","TREE123","-m","snapshot:turn"]` (NO -p; proves reset).
- Assert via `calls.filter(c => c.args[0] === "commit-tree")` — the 3rd commit-tree has NO "-p".

### Test B: capturesThisTurn reset re-enables capture after the cap
- cfg with `maxSnapshotsPerTurn: 1`.
- capture("turn") → "COMMIT456" (non-null; capturesThisTurn 0→1).
- capture("turn-after") → null (capturesThisTurn 1 >= 1 → abort; the cap check at git.ts:327 is
  BEFORE scan/add, so no pipeline commands issued this turn — ensureInit is memoized).
- gb.gc() → resets capturesThisTurn = 0.
- capture("turn") again → "COMMIT456" (non-null; proves the cap counter was reset).

### Existing gc test (git.test.ts:482) — NOT broken
Adding two field assignments adds NO git commands → the existing test's call-sequence assertions
(for-each-ref → update-ref -d → gc) remain valid. No existing test regresses.

## Coordination with parallel item P1.M5.T1.S1 (BUG-005)

P1.M5.T1.S1 edits src/snapshot/git.ts too (capture() note-write after line 377; restore() note-read).
This item (T2.S1) edits gc() (lines ~640-660). These methods are ~250 lines apart → NO textual
merge conflict and NO logical conflict (different methods). Both touch git.ts so a merge tool may
flag adjacency, but the hunks are disjoint. No shared state. No coordination needed beyond the
disjoint-hunk guarantee.

## Validation commands (verified against repo conventions)

- `npm run typecheck` (tsc --noEmit) — the two field assignments type-check trivially.
- `npx vitest run test/git.test.ts -v` — new tests + all existing green.
- `npm test` — full suite green (no regression; gc()/capture() behavior is the only change).
- `git diff --name-only` → ONLY `src/snapshot/git.ts` + `test/git.test.ts`.