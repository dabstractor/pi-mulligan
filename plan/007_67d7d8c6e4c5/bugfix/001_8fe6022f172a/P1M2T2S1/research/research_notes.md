# Research Notes — P1.M2.T2.S1: Add cancel-exclusion to `countRewindMarkers` + fix stale comments + regression test (BUG-004)

## Scope
A CODE change to ONE module-local function (`countRewindMarkers` in `src/tools/rewind.ts`) + 2 stale-comment
fixes (its JSDoc + the call-site comment) + ONE regression test. The cumulative depth guard must exclude
rewinds retired by a `mulligan:cancel`, honoring spec/05 §1 step 4 "count ACTIVE" and unblocking the
cancel-then-retry workflow.

## The bug (BUG-004 — PRD §2.3 Issue 2)
`countRewindMarkers` (src/tools/rewind.ts:204-222) counts ALL `mulligan:rewind` entries, never excluding
markers retired by a `mulligan:cancel`. Its comment justifies this with stale pre-E21 reasoning ("Markers are
permanent (never cleared)"). But E21 amended D6 — markers ARE retractable via `mulligan_cancel`. Result: 5
rewinds all cancelled (0 active) + a 6th attempt → REFUSED "max rewind depth (5) reached — 5 active rewind
marker(s)" despite 0 active markers. The sibling guard `countRetriesAtLatestPrompt` (step 4b) ALREADY excludes
cancels (BUG-005 fix), so the two guards were inconsistent. PRD §2.5 recommends: "Update countRewindMarkers to
exclude markers whose data.id is in the active cancelledIds set (mirroring countRetriesAtLatestPrompt's BUG-005
fix)."

## The target function (verbatim current — src/tools/rewind.ts:204-222)
```ts
function countRewindMarkers(ctx: ExtensionContext): number {
  let count = 0;
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return 0; // never let the depth guard throw
  }
  if (!Array.isArray(entries)) return 0;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      if ((e as { type?: unknown }).type === "custom" && (e as { customType?: unknown }).customType === "mulligan:rewind") {
        count++;
      }
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  return count;
}
```
- Uses `for (const e of entries)` (NOT indexed) and `(e as {...})` casts with per-entry try/catch.

## The stale JSDoc (verbatim — src/tools/rewind.ts:198-203)
```
/**
 * countRewindMarkers — the depth-guard source (GOTCHA #9). Scan `ctx.sessionManager.getEntries()` for entries
 * where `type === "custom" && customType === "mulligan:rewind"`; return the count. Markers are permanent (never
 * cleared), so ALL persisted rewind markers count toward maxDepth. Defensive (never throws; a throwing-Proxy
 * entry or a non-array → the entry is skipped / the count is 0). Module-local.
 */
```

## The stale call-site comment (verbatim — src/tools/rewind.ts:524)
```
    // (4) depth guard (step 4; E4). Markers are permanent → ALL persisted rewind markers count toward maxDepth.
    const depth = countRewindMarkers(ctx);
    if (depth >= config.rewind.maxDepth) {
      return refuse(
        `max rewind depth (${config.rewind.maxDepth}) reached — ${depth} active rewind marker(s). Consider mulligan_shrink or just continuing; if stuck in a loop, the human should intervene`,
        granularity,
      );
    }
```
- The refusal text `${depth} active rewind marker(s)` stays UNCHANGED — with the fix `depth` is the ACTIVE
  count, so "active" becomes accurate. (Text format unchanged; only the count value becomes correct.)

## The pattern to mirror — countRetriesAtLatestPrompt (the BUG-005 fix, already shipped)
src/tools/rewind.ts:~270-340 (verbatim captured). It does TWO passes over the post-prompt slice:
1. **Cancel-id pass**: `cancelledRewindIds = new Set<string>()`; for each `mulligan:cancel` entry read
   `ee.data?.targetId`; if `typeof targetId === "string" && targetId.length > 0` → add.
2. **Cancel-aware count**: for each `mulligan:rewind` entry read `ee.data?.id`; if
   `typeof id === "string" && cancelledRewindIds.has(id)` → SKIP; else `count++`.

**DIFFERENCE for countRewindMarkers**: it scans the ENTIRE entry list (cumulative depth guard), so BOTH passes
must iterate ALL entries (`for (const e of entries)`), not just the post-prompt slice. Otherwise identical.

## The canonical pattern — readMarkers cancelledIds (src/filter.ts:101-205, verbatim captured)
- `cancelledIds = new Set<string>()`.
- `customType === "mulligan:cancel" && kind === "cancel"` → `readOwn(data, "targetId")`; if non-empty string → add.
- `activeRewinds = rewinds.filter(r => { const id = readOwn(r, "id"); return typeof id !== "string" || !cancelledIds.has(id); })`.
- Defensive polarity: unreadable id → KEEP (here: COUNT).

## Defensive polarity — COUNT on bad data (CRITICAL for backward compat)
SKIP a rewind ONLY IF `data.id` is a string AND in `cancelledRewindIds`. An id-less/unreadable rewind (e.g.
`rewindEntry(seq)` → `data: { seq }`, no id) is COUNTED. This guarantees the existing depth-guard tests stay
green: their fixtures use `rewindEntry(1..5)` (no id) with NO cancel entries → cancelledRewindIds is empty →
all counted → still refuse "5 active rewind marker(s)" at maxDepth=5.

## Entry shapes
- `mulligan:rewind` → `entry.data.id` (uuid).
- `mulligan:cancel` → `entry.data.targetId` (=== the retired rewind's data.id).

## Test harness — test/tools/rewind.test.ts (CONFIRMED actual helpers)
**IMPORTANT CONTRACT CORRECTION**: the item_description names `customEntry()` / `rewindEntryData()`, but those
helpers live in **test/edge-cases.test.ts** (line 278: `rewindEntryData(seq)`, and `customEntry(customType, data)`).
The helpers actually IN test/tools/rewind.test.ts are:
- `rewindEntry(seq = 1)` (line 207) → `{ type:"custom", customType:"mulligan:rewind", data:{ seq } }` — NO id.
- `rewindEntryWithId(seq, id)` (line 212) → `{ type:"custom", customType:"mulligan:rewind", data:{ seq, id, kind:"rewind" } }` — WITH id.
- `cancelEntry(targetId)` (line 217) → `{ type:"custom", customType:"mulligan:cancel", data:{ kind:"cancel", targetId } }`.
- `msgEntry(message)` (line 244), `user(text)` (line 284), `makePi()`, `makeCtx({entries})`, `run(pi, ctx, params)`, `firstText(res)`, `VALID_NOTE`.

So the regression test should be ADDED to **test/tools/rewind.test.ts** using the existing
`rewindEntryWithId` + `cancelEntry` helpers (mirroring the BUG-005 test at rewind.test.ts:1133-1161, which uses
exactly these helpers). NO new helper needed.

## Existing depth-guard tests (must stay UNCHANGED — verified no cancel entries in fixtures)
- `test/tools/rewind.test.ts:404-412` — "exactly maxDepth (5) active rewind markers → refusal": entries
  `[rewindEntry(1..5)]` (no cancels) → with fix: cancelledRewindIds empty → count=5 → still refuse "5 active
  rewind marker(s)". ✅ unchanged.
- `test/tools/rewind.test.ts:418-428` — "fewer than maxDepth (4) → succeeds": `[rewindEntry(1..4)]` → count=4 →
  4<5 → succeed. ✅ unchanged.
- `test/tools/rewind.test.ts:~432` — "honors a custom maxDepth (maxDepth:1, 1 rewind → refuse)". ✅ unchanged.
- `test/edge-cases.test.ts:428-446` — `customEntry("mulligan:rewind", rewindEntryData(i))` ×5 (no cancels) →
  refuse; ×4 → succeed. ✅ unchanged.

## The NEW regression test (canonical BUG-004 repro, from the contract)
Scenario: user(msg) + 5 `rewindEntryWithId(i, "rew-i")` + 5 `cancelEntry("rew-i")` (one per rewind).
- WITHOUT fix: count=5 (all rewind markers) → 5>=maxDepth(5) → REFUSE.
- WITH fix: count=0 (all 5 cancelled) → 0<5 → SUCCEED (marker persisted).
- Assert: `firstText(res)` contains "Mulligan: rewound" (success), does NOT contain "max rewind depth (5) reached",
  and `appended.length === 1`. Place it in rewind.test.ts alongside the depth-guard + BUG-005 tests.

## Validation commands (package.json)
- `npm run typecheck` → `tsc --noEmit`.
- `npx vitest run test/tools/rewind.test.ts` (and `test/edge-cases.test.ts` to confirm the boundary tests stay green).

## Parallel-sibling coordination (no file conflict)
- **P1.M2.T1.S1** (parallel, implementing): edits `src/tools/audit.ts` (renderAuditReport checkpoint clause) +
  `test/tools/audit.test.ts` ONLY. Does NOT touch `src/tools/rewind.ts` or `test/tools/rewind.test.ts`.
- This PRP (P1.M2.T2.S1) edits `src/tools/rewind.ts` (countRewindMarkers + 2 comments) + `test/tools/rewind.test.ts`
  (1 regression test). No overlap.

## Out of scope (do NOT touch)
- `countRetriesAtLatestPrompt` (the BUG-005 fix — the PATTERN to mirror; already shipped; NOT edited here).
- `src/filter.ts` (readMarkers cancelledIds — canonical reference; not edited).
- `src/tools/audit.ts` + `test/tools/audit.test.ts` (owned by P1.M2.T1.S1).
- The refusal TEXT at rewind.ts:528 (unchanged — only the count value becomes accurate).
- Any other function in rewind.ts (only countRewindMarkers + its JSDoc + the call-site comment).
- Existing depth-guard / retry-budget tests (ADD a new it(...); do NOT modify existing assertions).
- spec/* (READ-ONLY: spec/05 §1 step 4 "count active", spec/08 E21 cancel).