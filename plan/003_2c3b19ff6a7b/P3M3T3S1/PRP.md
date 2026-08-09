# PRP — P3.M3.T3.S1: Expose `recentMetrics: TurnMetric[]` on MarkersBundle (sorted newest-first)

## Goal

**Feature Goal**: Change `readMarkers` (src/filter.ts) so that, instead of keeping only the LATEST
turn-metric (highest `seq`), it collects **ALL** valid `mulligan:turn-metric` entries during the scan,
sorts them **newest-first** (highest `seq` at index 0), and exposes the full sorted array as a new required
`recentMetrics: TurnMetric[]` field on `MarkersBundle`. Keep the existing `metric` field (latest =
`recentMetrics[0]` ?? null) for backward compatibility. `readMarkers` continues to **NEVER throw**
(existing defensive pattern, fail-open).

**Deliverable**:
- `src/filter.ts` — modified: `MarkersBundle` interface (+1 field with JSDoc), `readMarkers` function
  (collect-all + sort + populate `metric` from `recentMetrics[0]` + add `recentMetrics` to BOTH return
  points). **No new imports** (`TurnMetric` is already imported). **No changes** to `contextHandler`,
  `registerFilterHandler`, or any other function/file.
- `test/filter.test.ts` — modified: 3 existing tests gain `recentMetrics` assertions (empty-bundle,
  latest-metric, getEntries-throws); 1 NEW `describe` block with 5 `it`s covering sorting / latest-eq /
  all-collected / always-array / defensive-non-number-seq.

**Success Definition**:
- `readMarkers(ctx)` with 3 turn-metrics of seq [1,3,2] returns `recentMetrics` whose `.seq` values are
  `[3,2,1]` (newest-first, highest seq at index 0).
- `bundle.metric` is the SAME object as `bundle.recentMetrics[0]` (`toBe`) and has the highest seq.
- `bundle.recentMetrics` contains EVERY turn-metric on the branch (NO slicing in `readMarkers`).
- `bundle.recentMetrics` is ALWAYS an array: `[]` for empty entries and `[]` on the getEntries-throws
  (fail-open) path.
- `readMarkers` still never throws (existing defensive behavior preserved).
- `npx tsc --noEmit` clean; `npm test` green.

## Why

- **Required by spec/07 §5.1 (Windowed drift signaling, REQUIRED).** §5.1 mandates: "the window is
  computed in the filter from the last N `mulligan:turn-metric` entries on the branch." Today `readMarkers`
  throws away all but the latest metric, so there is no way for the consumer to compute a window. This task
  exposes the raw material (the full sorted array) so the window math can be done downstream.
- **Purely additive plumbing — enables three downstream tasks without changing runtime behavior.** The
  consumer changes are FUTURE: P3.M3.T4.S1 changes `shouldNudge` to take the window (`TurnMetric[]`);
  P3.M3.T6.S1 wires `contextHandler` to slice `recentMetrics` to `driftWindowTurns` and pass it to
  `shouldNudge`; P3.M3.T5.S1 adds the high-water signal. None of those read `recentMetrics` yet, so adding
  the field now changes ZERO runtime behavior — it is dormant until the consumer lands.
- **Keeps `metric` for backward compat.** `suppressCheck` (nudges.ts) and the current
  `shouldNudge(markers.metric, config)` + `injectNudge(messages, markers.metric)` calls in `contextHandler`
  all use the single latest metric. Those keep working unchanged: `metric` is now defined as
  `recentMetrics[0] ?? null`.
- **Small, surgical, mechanical.** One Pi-coupled module, one loop branch rewritten (latest-keep → push-all),
  one sort+assign after the loop, one interface field, two return points updated, and a known set of test
  edits. The pattern is the same shape as the P3.M1.T2.S1 cancel-drop change (which added `cancelledIds` to
  the same interface + readMarkers + tests).

## What

**User-visible behavior**: None directly. `recentMetrics` is an internal field on an internal bundle
(spec/06 §1: readMarkers is an internal filter function; spec/06 §1 note "DOCS: none — readMarkers is an
internal filter function"). The observable effect (once the consumer lands) is that the drift nudge fires on
*windowed/sustained* growth rather than a single turn's spike — `recentMetrics` is the data that makes the
window computable.

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. **`MarkersBundle` interface** — add `recentMetrics: TurnMetric[]` (required, non-optional, no `?`).
   Placed LAST (after `cancelledIds`), matching the append-last convention.
2. **`readMarkers` loop** — in the `mulligan:turn-metric` / `kind === "turn-metric"` branch, REPLACE the
   keep-latest logic with `allMetrics.push(data as unknown as TurnMetric);` (collect EVERY valid
   turn-metric; do not filter by seq during the scan).
3. **`readMarkers` after-loop sort + `metric` assignment** — sort `allMetrics` descending by `seq`
   (newest-first), then set `metric = recentMetrics[0] ?? null`. The sort comparator MUST defensively
   coerce a non-number `seq` to `-Infinity` (so malformed metrics sort to the END and are still included),
   mirroring the EXISTING defensive coercion being removed.
4. **`readMarkers` returns** — BOTH return points (the getEntries-throws early-return AND the final return)
   must include `recentMetrics` as the LAST field. Return field order: `{ rewinds, shrinks, metric,
   cancelledIds, recentMetrics }`.
5. **NEVER throws.** No change to the try/catch fail-open discipline. The catch early-return still produces
   a valid bundle (with `recentMetrics: []`).

### Success Criteria
- [ ] `MarkersBundle` has `recentMetrics: TurnMetric[]` (required) with JSDoc.
- [ ] `readMarkers` collects ALL valid turn-metrics (not just the latest).
- [ ] `recentMetrics` is sorted newest-first (highest seq at index 0).
- [ ] `metric === recentMetrics[0]` (or null when empty) — backward compat preserved.
- [ ] `recentMetrics` is always an array, including on the empty-entries and getEntries-throws paths.
- [ ] `readMarkers` still never throws; `contextHandler`/`registerFilterHandler` unchanged.
- [ ] `npx tsc --noEmit` clean; `npm test` green.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP quotes the EXACT current `MarkersBundle` interface block, the EXACT current metric-collection
branch, the EXACT top-of-function declarations, the EXACT two return statements, and the EXACT test helpers
(`metricData`, `customEntry`, `makeCtx`) to mirror. It names the one import that already exists (`TurnMetric`)
and confirms (grep-verified) that NO fresh `MarkersBundle` literal exists anywhere, so adding a required field
cannot break tsc at any other site. An implementer who has never seen this repo can do it from this document
+ `src/filter.ts` + `test/filter.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file you are editing (two sites: interface + readMarkers)
- file: src/filter.ts
  why: |
    Contains MarkersBundle (the interface to extend) and readMarkers (the function to modify). TurnMetric is
    ALREADY imported (`import type { RewindMarker, ShrinkMarker, TurnMetric } from "./markers.js";`) — no new
    import needed. contextHandler and registerFilterHandler are UNCHANGED (they read markers.metric, which is
    kept). The only construction sites of MarkersBundle are the 2 return statements inside readMarkers — both
    are edited in this task.
  pattern: |
    // CURRENT MarkersBundle interface — APPEND recentMetrics: TurnMetric[] LAST (after cancelledIds):
    export interface MarkersBundle {
      rewinds: RewindMarker[];
      shrinks: ShrinkMarker[];
      metric: TurnMetric | null;
      cancelledIds: Set<string>;
      // <── INSERT recentMetrics: TurnMetric[] here (with JSDoc) ──>
    }
    // CURRENT metric-collection branch (inside the loop) — REPLACE keep-latest with push-all:
    } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
      const candidate = data as unknown as TurnMetric;
      const cSeq = typeof candidate.seq === "number" ? candidate.seq : -Infinity;
      const mSeq = metric && typeof metric.seq === "number" ? metric.seq : -Infinity;
      if (metric === null || cSeq > mSeq) metric = candidate; // keep the LATEST (highest seq)
    }
    //   ── becomes ──
    } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
      allMetrics.push(data as unknown as TurnMetric); // collect ALL valid turn-metrics (P3.M3.T3.S1)
    }
  section: MarkersBundle interface (~lines 88-104) + readMarkers (~lines 108-205)
  gotcha: |
    CRITICAL — DO NOT copy Pattern 10's `recentMetrics = allMetrics.slice(0, config.nudges.driftWindowTurns)`
    line from architecture/implementation_patterns.md. The ITEM CONTRACT is authoritative: readMarkers exposes
    the FULL sorted array and does NOT slice and does NOT import config (it takes only `ctx`). The consumer
    (P3.M3.T6.S1) slices. Pattern 10 is a sketch; the contract overrules it. (See "Known Gotchas" below.)
  gotcha2: |
    The sort comparator MUST defensively coerce a non-number `seq` to `-Infinity` (mirrors the defensive
    cSeq/mSeq coercion currently being removed). readMarkers casts raw session data, so a metric could have a
    missing/non-number seq; without the guard, `b.seq - a.seq` yields NaN and Array.prototype.sort produces an
    implementation-defined / non-deterministic order. Coercing to -Infinity puts malformed metrics at the END
    of the descending list (still included — never drop on bad data, matching the established defensive rule).

# MUST READ — the pattern to mirror (the immediately-preceding readMarkers extension)
- file: src/filter.ts
  why: |
    P3.M1.T2.S1 added `cancelledIds` to MarkersBundle + readMarkers using the SAME shape this task uses:
    (a) add a field LAST to the interface, (b) collect into a local during the scan, (c) populate it before
    return, (d) include it in BOTH the catch early-return and the final return, (e) always-present on every
    path. Read the `cancelledIds` JSDoc + its `.add(...)` site + both returns to match comment depth, the
    "always present" invariant, and the fail-open catch shape. `recentMetrics` is structurally simpler (an
    array vs a Set, and no post-loop filter — just a sort).
  pattern: |
    // The cancelledIds precedent: declared at top, populated in the loop, present in both returns:
    const cancelledIds = new Set<string>();            // top
    cancelledIds.add(targetId);                          // in loop (cancel branch)
    return { rewinds, shrinks, metric, cancelledIds };   // catch early-return
    return { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds }; // final
    // recentMetrics mirrors this: declare allMetrics[] at top, push in loop, sort+assign before final
    // return, include in both returns (catch uses the empty allMetrics).
  section: readMarkers cancelledIds block + both returns

# MUST READ — the test file to extend
- file: test/filter.test.ts
  why: |
    The readMarkers tests live here. Three existing its need a `recentMetrics` assertion added (empty-bundle,
    latest-metric, getEntries-throws), and one NEW describe block is added. Mirror the EXISTING helpers:
    `metricData(seq, grew?, bloat?)`, `customEntry(customType, data)`, `makeCtx({ entries,
    throwOnGetEntries })`. These are already defined at the top of the file — reuse them, do not redefine.
  pattern: |
    // metricData builds a valid turn-metric data payload:
    function metricData(seq, grew = false, bloat = false) {
      return { schema:"pi-mulligan", v:1, kind:"turn-metric", seq, ts:1,
        deltaTokens: grew ? 5000 : 100, bloatHit: bloat, bloatHits: [], grewOverThreshold: grew, turnIndex: seq };
    }
    // customEntry wraps a data payload in a { type:"custom", customType, data } SessionEntry:
    customEntry("mulligan:turn-metric", metricData(3, true))
    // For a MALFORMED metric (non-number seq), build the data inline (do not use metricData):
    customEntry("mulligan:turn-metric",
      { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:"oops", ts:1, deltaTokens:1,
        bloatHit:false, bloatHits:[], grewOverThreshold:false, turnIndex:0 })
  section: "readMarkers — fresh read, bucket, latest metric" describe + helper definitions (~lines 81-205)
  gotcha: |
    The 3 existing assertions to update are the only places that would otherwise miss the new field; they are
    deep-equality-free (toEqual on arrays / toBeNull on metric) so adding a new assertion line is the ONLY
    edit needed (unlike runtime.test.ts's toEqual-on-whole-shape, these do not pin the full bundle shape, so
    there is no "must add the key to the expected literal" footgun here).

# Architecture reference (read-only confirmation)
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  section: "Pattern 10: readMarkers recentMetrics (filter.ts)"
  why: |
    Confirms the high-level intent (collect all, sort descending, expose recentMetrics, keep metric for
    backward compat). BUT note the discrepancy (see src/filter.ts gotcha above): Pattern 10's sketch shows
    slicing INSIDE readMarkers (`allMetrics.slice(0, driftWindowTurns)`). The ITEM CONTRACT overrules this —
    readMarkers exposes the FULL array and does NOT slice. Use Pattern 10 for the sort/ordering/keep-metric
    intent; do NOT copy its slice line.

# Spec sources (read-only; the source of this field's meaning)
- docfile: spec/07-preventive-and-nudges.md
  section: "§5.1 Windowed drift signaling (REQUIRED)"
  why: |
    The consumer spec — "the window is computed in the filter from the last N mulligan:turn-metric entries on
    the branch." This task exposes those N (well, ALL) entries; the windowing math is the consumer's job
    (P3.M3.T4.S1 shouldNudge + P3.M3.T6.S1 contextHandler). Read §5.1 to understand WHY recentMetrics must be
    newest-first and full (the consumer slices from the front: recentMetrics.slice(0, driftWindowTurns)).
- docfile: spec/06-context-filter.md
  section: "§1 The handler (glue)"
  why: |
    Shows the handler reads `markers.metric` (the latest) and calls shouldNudge(metric)/injectNudge(metric).
    Those continue to use the latest metric — confirming `metric` MUST be kept (backward compat). DOCS: none
    — readMarkers is an internal filter function (spec/06 §1), so recentMetrics needs no user-facing docs.

# The parallel predecessor (currently being implemented — assume it lands exactly as specified)
- docfile: plan/003_2c3b19ff6a7b/P3M3T2S1/PRP.md
  why: |
    T2.S1 adds `aboveHighWater` to SessionRuntime (src/runtime.ts). That is a DIFFERENT file (runtime.ts vs
    filter.ts) — NO edit conflict. T2.S1's output (`rt.aboveHighWater`) is consumed by shouldHighWater
    (P3.M3.T5.S1), NOT by readMarkers. This task does not touch runtime.ts. You only need T2's existence in
    mind to understand the full high-water design; readMarkers/recentMetrics is independent of it.
```

### Current Codebase tree (relevant slice)

```bash
src/
  filter.ts           # <-- MODIFY: MarkersBundle interface (+recentMetrics) + readMarkers (collect-all + sort + 2 returns)
  markers.ts          # read-only (TurnMetric interface lives here; ALREADY imported into filter.ts)
  nudges.ts           # read-only (suppressCheck + shouldNudge read markers.metric — UNCHANGED, still works)
  transforms.ts       # read-only (its own MarkerBundle; MarkersBundle stays structurally assignable)
  runtime.ts          # read-only (T2.S1 adds aboveHighWater here — independent of filter.ts)
test/
  filter.test.ts      # <-- MODIFY: 3 existing its + recentMetrics assertions; +1 new describe block (5 its)
spec/
  06-context-filter.md # read-only (§1 — readMarkers is internal; metric kept for the handler)
  07-preventive-and-nudges.md # read-only (§5.1 — the consumer spec driving recentMetrics)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/filter.ts        # EXTENDED in place. MarkersBundle.recentMetrics (TurnMetric[]); readMarkers collects
                     #   all turn-metrics, sorts newest-first, sets metric = recentMetrics[0] ?? null, returns
                     #   recentMetrics on BOTH paths.
test/filter.test.ts  # EXTENDED in place. 3 existing tests gain recentMetrics assertions; +1 new describe
                     #   (sorting / latest-eq / all-collected / always-array / defensive-non-number-seq).
# No new files. All changes are additive edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — DO NOT slice in readMarkers. The item CONTRACT (authoritative) says expose the FULL sorted
//   array; the consumer (P3.M3.T6.S1) slices to driftWindowTurns. Pattern 10 in implementation_patterns.md
//   sketches `allMetrics.slice(0, config.nudges.driftWindowTurns)` — DO NOT copy that. readMarkers must NOT
//   import config (it takes only `ctx`); slicing belongs to the consumer. readMarkers stays config-free.

// CRITICAL — the sort comparator MUST defensively coerce non-number seq to -Infinity. readMarkers casts raw
//   session data (data as unknown as TurnMetric), so a metric can have a missing/non-number seq. Without the
//   guard, `b.seq - a.seq` yields NaN → Array.prototype.sort gives an implementation-defined order. Coercing
//   to -Infinity puts malformed metrics at the END of the descending list (still included — never drop on bad
//   data, matching the established defensive rule: "a marker whose id is unreadable is KEPT"). This mirrors
//   the defensive `cSeq`/`mSeq` coercion in the code being removed.

// CRITICAL — the field is REQUIRED (no `?`), so any MarkersBundle LITERAL built from scratch would break tsc.
//   GREP-VERIFIED: there are NO fresh MarkersBundle literals anywhere in src+test. The only usages are a
//   `type MarkersBundle` import and three `as MarkersBundle` CASTS in test/filter.test.ts (lines 336/367/373,
//   casts on pipelineCalls — NOT constructions; casts bypass excess-property checks). The ONLY construction
//   sites are the 2 return statements inside readMarkers — both edited here. So adding a required field is
//   type-safe everywhere else.

// GOTCHA — BOTH return points in readMarkers must include recentMetrics: (1) the getEntries-throws catch
//   early-return, and (2) the final return. At the catch point, `allMetrics` is `[]` (declared but never
//   populated) and `metric` is `null` — so the catch return is `{ rewinds, shrinks, metric, cancelledIds,
//   recentMetrics: allMetrics }` (i.e. recentMetrics: []). Forgetting the catch return makes tsc error
//   "Property 'recentMetrics' is missing" on that return statement.

// GOTCHA — append the field LAST in the interface (after cancelledIds) and LAST in both return objects
//   (after cancelledIds). The contract mandates return order { rewinds, shrinks, metric, cancelledIds,
//   recentMetrics }. Every prior MarkersBundle addition (cancelledIds) was appended last — keep that.

// GOTCHA — keep `metric` (latest) for backward compat. suppressCheck (nudges.ts) and the current
//   contextHandler calls shouldNudge(markers.metric)/injectNudge(messages, markers.metric) all use the single
//   latest metric. Define `metric = recentMetrics[0] ?? null` so those keep working UNCHANGED. Do NOT remove
//   the metric field, do NOT change contextHandler in this task.

// GOTCHA — seq is monotonic per-session (runtime.ts nextSeq, pre-increment → first is 1) and "ties impossible
//   by construction" (handler doc). So among WELL-FORMED metrics the descending sort is a strict total order;
//   Array.prototype.sort stability is irrelevant. Only malformed (non-number seq) metrics are ambiguous, and
//   the -Infinity coercion makes them deterministically sort to the end.

// GOTCHA — recentMetrics is internal (spec/06 §1: readMarkers is an internal filter function). NO user-facing
//   docs, NO README change, NO spec change. The contract states "DOCS: none." README config-table sync is the
//   separate P3.M4.T1.S1 task and concerns config knobs, not this internal bundle field.

// GOTCHA — contextHandler is UNCHANGED. It reads markers.metric (kept) and its existing
//   shouldNudge(markers.metric, config) / suppressCheck(markers.metric, markers) / injectNudge(...) calls
//   continue to work. The windowed-drift consumer change (slicing recentMetrics + new shouldNudge signature)
//   is P3.M3.T4.S1 + P3.M3.T6.S1 — FUTURE. This task is purely additive: zero runtime behavior change.
```

## Implementation Blueprint

### Data models and structure

```typescript
// MarkersBundle — the ONLY data-model change (interface in src/filter.ts). One new required array field,
// appended LAST (after cancelledIds). TurnMetric is ALREADY imported — no new import.
export interface MarkersBundle {
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  metric: TurnMetric | null;
  cancelledIds: Set<string>;
  /** The full set of `mulligan:turn-metric` entries on the branch, sorted NEWEST-FIRST (highest `seq` at
   *  index 0). `metric` (the latest) === `recentMetrics[0]` (or null when empty) — kept for backward compat
   *  (suppressCheck + the current per-turn shouldNudge(metric)/injectNudge(metric) calls in contextHandler
   *  still use the single latest metric). The consumer (contextHandler, P3.M3.T6.S1) slices this to
   *  `config.nudges.driftWindowTurns` and passes the window to the windowed shouldNudge (P3.M3.T4.S1) per
   *  spec/07 §5.1. readMarkers does NOT slice — it exposes EVERY metric on the branch so the window math is
   *  the consumer's responsibility (the item contract mandates this; Pattern 10's in-readMarkers slice is
   *  superseded). Defensive on a missing/non-number `seq` (coerced to -Infinity → sorted to the end; still
   *  included — never drop on bad data). Always present (empty array when there are no turn-metrics, and on
   *  the getEntries-throws fail-open path). Internal (spec/06 §1: readMarkers is an internal filter fn). */
  recentMetrics: TurnMetric[];
}
// No schema library — plain TS interface. No persistence wrapper. Populated by readMarkers each fire.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/filter.ts — MarkersBundle interface (+1 field + JSDoc)
  - LOCATE the `export interface MarkersBundle { … }` block (the field list ends with cancelledIds + its
    JSDoc).
  - APPEND after the cancelledIds field (with the JSDoc shown in "Data models and structure" above):
      /** The full set of `mulligan:turn-metric` entries on the branch, sorted NEWEST-FIRST … (see PRP). */
      recentMetrics: TurnMetric[];
  - FOLLOW pattern: the cancelledIds field + its JSDoc block (mirror the comment depth + the "always
    present" / "defensive on bad data" framing + the consumer-task cross-reference style).
  - NAMING: `recentMetrics` (exact camelCase — match the contract + the consumer spec §5.1 wording).
  - GOTCHA: REQUIRED (no `?`) — always carries a value (the default `[]`). Mirrors every other field.

Task 2: MODIFY src/filter.ts — readMarkers top-of-function declarations (+1 local)
  - LOCATE the top of `readMarkers`:
      const rewinds: RewindMarker[] = [];
      const shrinks: ShrinkMarker[] = [];
      let metric: TurnMetric | null = null;
      const cancelledIds = new Set<string>();
  - ADD a new local (after cancelledIds):
      const allMetrics: TurnMetric[] = []; // P3.M3.T3.S1: collect ALL valid turn-metrics (sorted later)
  - NOTE: keep `let metric` (it is assigned AFTER the loop now; the catch early-return still references it
    as null). `allMetrics` starts as `[]`, so the catch return can use `recentMetrics: allMetrics`.

Task 3: MODIFY src/filter.ts — readMarkers metric-collection branch (keep-latest → push-all)
  - LOCATE the branch inside the loop:
      } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
        const candidate = data as unknown as TurnMetric;
        const cSeq = typeof candidate.seq === "number" ? candidate.seq : -Infinity;
        const mSeq = metric && typeof metric.seq === "number" ? metric.seq : -Infinity;
        if (metric === null || cSeq > mSeq) metric = candidate; // keep the LATEST (highest seq)
      }
  - REPLACE the body with a single push (collect EVERY valid turn-metric; no seq filtering during the scan):
      } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
        allMetrics.push(data as unknown as TurnMetric); // P3.M3.T3.S1: collect ALL (sorted newest-first below)
      }
  - WHY: the contract LOGIC step (a) — "push ALL valid turn-metrics into an array allMetrics." The defensive
    seq coercion moves to the sort comparator (Task 4). The cancel branch and all other branches are
    UNCHANGED.

Task 4: MODIFY src/filter.ts — readMarkers after-loop sort + metric assignment
  - LOCATE the post-loop cancel-drop block (activeRewinds/activeShrinks) and INSERT the sort+assign AFTER it,
    BEFORE the final return:
      // P3.M3.T3.S1 / spec/07 §5.1: expose the full turn-metric window. Sort ALL collected metrics
      // NEWEST-FIRST (highest seq at index 0). seq is monotonic per-session (ties impossible by
      // construction), so among well-formed metrics this is a strict total order. Defensive: a non-number
      // seq is coerced to -Infinity (sorted to the END — still included; never drop on bad data, matching
      // the established defensive rule). metric (latest) = recentMetrics[0] for backward compat
      // (suppressCheck + contextHandler's shouldNudge(metric)/injectNudge(metric) still use it). The
      // consumer (P3.M3.T6.S1) slices to driftWindowTurns — readMarkers does NOT slice and does NOT import
      // config (the item contract mandates a full, config-free array; Pattern 10's in-readMarkers slice is
      // superseded).
      const recentMetrics = allMetrics.sort(
        (a, b) =>
          (typeof b.seq === "number" ? b.seq : -Infinity) -
          (typeof a.seq === "number" ? a.seq : -Infinity),
      );
      metric = recentMetrics[0] ?? null;
  - NOTE: `allMetrics.sort(...)` mutates allMetrics in place (fine — it is local and not returned elsewhere);
    `recentMetrics` is the same reference. `recentMetrics[0] ?? null` handles the empty case (undefined → null).
  - GOTCHA: the comparator MUST use the defensive `typeof … === "number" ? … : -Infinity` on BOTH operands
    (not bare `b.seq - a.seq`). Without it, a non-number seq yields NaN → non-deterministic sort order.

Task 5: MODIFY src/filter.ts — readMarkers returns (+recentMetrics on BOTH paths)
  - (5a) getEntries-throws catch early-return — currently:
        } catch {
          return { rewinds, shrinks, metric, cancelledIds }; // a throwing getEntries → empty bundle (fail-open)
        }
    CHANGE to (add recentMetrics LAST; at this point metric===null and allMetrics===[]):
        } catch {
          return { rewinds, shrinks, metric, cancelledIds, recentMetrics: allMetrics }; // fail-open (recentMetrics: [])
        }
  - (5b) final return — currently:
        return { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds };
    CHANGE to (add recentMetrics LAST):
        return { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds, recentMetrics };
  - GOTCHA: forgetting (5a) makes tsc error "Property 'recentMetrics' is missing in type '{ rewinds, shrinks,
    metric, cancelledIds }'" on the catch return. Both returns are required to satisfy the new interface.

Task 6: MODIFY test/filter.test.ts — augment 3 EXISTING readMarkers tests
  - (6a) "returns an empty bundle for an empty entry stream" — ADD (after the existing `expect(bundle.metric).toBeNull()`):
      expect(bundle.recentMetrics).toEqual([]);
  - (6b) "keeps only the LATEST turn-metric (highest seq)" — the entries are seq [1,3,2]. ADD (after the
    existing `expect((bundle.metric as { seq: number }).seq).toBe(3)`):
      expect(bundle.recentMetrics).toHaveLength(3);
      expect((bundle.recentMetrics[0] as { seq: number }).seq).toBe(3); // newest-first
      expect(bundle.metric).toBe(bundle.recentMetrics[0]);              // latest === recentMetrics[0]
  - (6c) "never throws when getEntries throws (fail-open → empty bundle)" — ADD (after the existing
    `expect(bundle.cancelledIds.size).toBe(0)`):
      expect(bundle.recentMetrics).toEqual([]); // recentMetrics always present on the fail-open path

Task 7: CREATE test cases in test/filter.test.ts — NEW describe block for recentMetrics
  - ADD a new describe AFTER the "readMarkers — cancel-drop" describe block (keep readMarkers tests grouped):
      describe("readMarkers — recentMetrics window (P3.M3.T3.S1 / spec/07 §5.1)", () => {
  - (7a) "exposes recentMetrics sorted NEWEST-FIRST (highest seq at index 0)":
      const entries = [
        customEntry("mulligan:turn-metric", metricData(1)),
        customEntry("mulligan:turn-metric", metricData(3, true)),
        customEntry("mulligan:turn-metric", metricData(2)),
      ];
      const bundle = readMarkers(makeCtx({ entries }));
      expect(bundle.recentMetrics).toHaveLength(3);
      expect(bundle.recentMetrics.map(m => (m as { seq: number }).seq)).toEqual([3, 2, 1]); // descending
  - (7b) "metric (latest) === recentMetrics[0] (backward compat)":
      // reuse the same entries; metric is the highest-seq metric
      expect(bundle.metric).not.toBeNull();
      expect(bundle.metric).toBe(bundle.recentMetrics[0]);              // SAME object (toBe), not a copy
      expect((bundle.metric as { seq: number }).seq).toBe(3);
  - (7c) "recentMetrics contains ALL turn-metrics on the branch (readMarkers does NOT slice)":
      const entries = [
        customEntry("mulligan:turn-metric", metricData(1)),
        customEntry("mulligan:turn-metric", metricData(2)),
        customEntry("mulligan:turn-metric", metricData(3)),
        customEntry("mulligan:turn-metric", metricData(4)),
      ];
      const bundle = readMarkers(makeCtx({ entries }));
      expect(bundle.recentMetrics).toHaveLength(4); // full array — NO slicing to driftWindowTurns here
      expect(bundle.recentMetrics.map(m => (m as { seq: number }).seq)).toEqual([4, 3, 2, 1]);
  - (7d) "recentMetrics is always an array (empty when no turn-metrics; [] on getEntries-throws)":
      const empty = readMarkers(makeCtx({ entries: [] }));
      expect(Array.isArray(empty.recentMetrics)).toBe(true);
      expect(empty.recentMetrics).toEqual([]);
      const thrown = readMarkers(makeCtx({ throwOnGetEntries: true }));
      expect(Array.isArray(thrown.recentMetrics)).toBe(true);
      expect(thrown.recentMetrics).toEqual([]); // fail-open path → []
  - (7e) "defensive: a turn-metric with a non-number seq is INCLUDED (sorted to the end)":
      const malformed = { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:"oops", ts:1,
        deltaTokens:1, bloatHit:false, bloatHits:[], grewOverThreshold:false, turnIndex:0 };
      const entries = [
        customEntry("mulligan:turn-metric", metricData(5)),
        customEntry("mulligan:turn-metric", malformed),   // non-number seq → coerced to -Infinity → end
        customEntry("mulligan:turn-metric", metricData(10)),
      ];
      const bundle = readMarkers(makeCtx({ entries }));
      expect(bundle.recentMetrics).toHaveLength(3);                       // malformed still included
      expect((bundle.recentMetrics[0] as { seq: number }).seq).toBe(10);  // valid highest first
      expect((bundle.recentMetrics[1] as { seq: number }).seq).toBe(5);   // valid next
      expect(bundle.recentMetrics[2]).toBe(malformed);                    // malformed last (same object)
  - FOLLOW pattern: the existing readMarkers its (use customEntry + metricData + makeCtx; cast with
    `as { seq: number }` for the seq read; `toBe` for object identity, `toEqual` for arrays).
  - GOTCHA: do NOT import driftWindowTurns or config — readMarkers does not slice, so the tests assert the
    FULL array regardless of the configured window. (The window is the consumer's concern, tested in
    P3.M3.T6.S1.)

Task 8 (OPTIONAL — accuracy only, NOT required for green tests): none
  - recentMetrics is internal (spec/06 §1) and brand-new. No README, no spec, no integration references.
    The contract states "DOCS: none — readMarkers is an internal filter function (spec/06 §1)." README
    config-table sync for the nudges knobs is P3.M4.T1.S1, a dedicated later doc task; recentMetrics is an
    internal bundle field, not config, and is intentionally undocumented.
```

### Implementation Patterns & Key Details

```typescript
// THE edits to src/filter.ts — readMarkers (verbatim). The interface edit is in "Data models and structure".

// Edit (top-of-function) — ADD allMetrics after cancelledIds:
  const rewinds: RewindMarker[] = [];
  const shrinks: ShrinkMarker[] = [];
  let metric: TurnMetric | null = null;
  const cancelledIds = new Set<string>();
  const allMetrics: TurnMetric[] = []; // P3.M3.T3.S1: collect ALL valid turn-metrics (sorted later)

// Edit (loop branch) — keep-latest → push-all:
    } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
      allMetrics.push(data as unknown as TurnMetric); // P3.M3.T3.S1: collect ALL (sorted newest-first below)
    }

// Edit (after-loop, after activeRewinds/activeShrinks, before final return):
  const recentMetrics = allMetrics.sort(
    (a, b) =>
      (typeof b.seq === "number" ? b.seq : -Infinity) -
      (typeof a.seq === "number" ? a.seq : -Infinity),
  );
  metric = recentMetrics[0] ?? null;

// Edit (catch early-return):
    return { rewinds, shrinks, metric, cancelledIds, recentMetrics: allMetrics }; // fail-open (recentMetrics: [])

// Edit (final return):
  return { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds, recentMetrics };

// WHY push-all + sort-after (not keep-latest-during-scan): the contract requires the FULL sorted array
//   exposed as recentMetrics AND metric = recentMetrics[0]. Collecting all then sorting once is simpler and
//   less error-prone than tracking both "latest" and "all" during the scan. Sorting after the scan also keeps
//   the loop body a single push (cheap O(n) total; sort is O(n log n) only over metrics, which are ~1/turn).
// WHY defensive -Infinity in the comparator: readMarkers casts raw session data; a metric can have a
//   missing/non-number seq. `b.seq - a.seq` would yield NaN → non-deterministic order. -Infinity makes
//   malformed metrics sort deterministically to the END (still included — the established "never drop on bad
//   data" rule). This is the SAME coercion the removed cSeq/mSeq code used.
// WHY not slice: the item contract mandates a full, config-free array. Slicing belongs to the consumer
//   (P3.M3.T6.S1), keeping readMarkers pure w.r.t. the read surface (takes only ctx). Pattern 10's sketch
//   slices inside readMarkers — superseded by the contract.
```

### Integration Points

```yaml
INTERFACE (src/filter.ts):
  - MarkersBundle: +recentMetrics: TurnMetric[] (required, appended LAST after cancelledIds)

FUNCTION (src/filter.ts readMarkers):
  - top declarations: +const allMetrics: TurnMetric[] = []
  - loop branch (turn-metric): keep-latest math → allMetrics.push(...)
  - after-loop (after activeRewinds/activeShrinks): +sort allMetrics newest-first → recentMetrics; metric = recentMetrics[0] ?? null
  - catch early-return: +recentMetrics: allMetrics (=== [])
  - final return: +recentMetrics (last field)

TESTS (test/filter.test.ts):
  - 3 existing its: +recentMetrics assertions (empty-bundle, latest-metric, getEntries-throws)
  - +1 new describe "readMarkers — recentMetrics window (P3.M3.T3.S1 / spec/07 §5.1)" with 5 its

NO NEW IMPORTS / NO NEW FILES / NO contextHandler CHANGE / NO registerFilterHandler CHANGE / NO nudges.ts /
  NO transforms.ts / NO markers.ts / NO runtime.ts / NO config.ts / NO index.ts.
  - TurnMetric is ALREADY imported into filter.ts — reuse it.
  - contextHandler reads markers.metric (kept) — its existing shouldNudge(markers.metric, config) /
    suppressCheck(markers.metric, markers) / injectNudge(messages, markers.metric) calls are UNCHANGED and
    still work (metric is now recentMetrics[0] ?? null).
  - The windowed-drift consumer change (slicing recentMetrics + new shouldNudge(TurnMetric[]) signature) is
    P3.M3.T4.S1 + P3.M3.T6.S1 — FUTURE. Nothing in src/ reads recentMetrics today; adding it is purely
    additive — zero runtime behavior change.
  - transforms.ts's MarkerBundle (different name) stays structurally assignable (extra field is fine for
    variable→param assignability).

DOCS:
  - None required. The contract states "DOCS: none — readMarkers is an internal filter function (spec/06 §1).
    The recentMetrics exposure is an implementation detail of §5.1, already specified." recentMetrics is
    intentionally undocumented (not user-facing, not in any marker, not persisted). README sync is P3.M4.T1.S1
    and concerns config knobs, not this internal bundle field.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (no separate build script; tsc is a devDependency).
npx tsc --noEmit
# Expected: ZERO errors. If tsc errors "Property 'recentMetrics' is missing in type '{ rewinds, shrinks,
# metric, cancelledIds }'" → you forgot Task 5a (the catch early-return) OR Task 5b (the final return). Both
# returns must include recentMetrics to satisfy the now-required interface field. If
# "Property 'recentMetrics' does not exist on type 'MarkersBundle'" in a future consumer → that's a later
# task; this task only adds the field, so no consumer references exist yet (grep confirms zero today).

# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts. Do NOT invent one.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the affected test file in isolation first (fast feedback).
npx vitest run test/filter.test.ts
# Expected: ALL pass. Watch especially:
#   - "returns an empty bundle for an empty entry stream": now asserts recentMetrics === []. If it fails,
#     you forgot Task 6a OR didn't initialize allMetrics (Task 2) / didn't add recentMetrics to the returns.
#   - "keeps only the LATEST turn-metric (highest seq)": now asserts recentMetrics length 3, [0].seq===3,
#     and metric === recentMetrics[0] (Task 6b). If metric !== recentMetrics[0], you computed them
#     independently instead of metric = recentMetrics[0] ?? null (Task 4).
#   - "never throws when getEntries throws": now asserts recentMetrics === [] (Task 6c). If it fails, you
#     forgot Task 5a (the catch early-return must include recentMetrics).
#   - New describe (Task 7): sorting [1,3,2]→[3,2,1], metric===recentMetrics[0], all-collected (no slice),
#     always-array (empty + throw), defensive-non-number-seq (sorted to end). All green.

# Then the full suite to prove no regression.
npm test
# Expected: ALL green. filter.ts is the only src change; only filter.test.ts imports readMarkers directly for
# shape checks. Other test files (nudges/transforms/markers/edge-cases/audit) consume MarkersBundle via
# contextHandler or casts — they now see recentMetrics on the type but none reference it, so they're
# unaffected. tsc --noEmit already covered type safety across the suite.
```

### Level 3: Integration Testing (System Validation)

```bash
# This task adds a field + populates it; no consumer reads it yet, so there is NO behavioral change to
# exercise. The integration smoke harness is unaffected:
npm run smoke   # optional — passes unchanged (no nudge behavior changes; recentMetrics is dormant until
                # P3.M3.T4/T6 land the windowed shouldNudge + contextHandler wiring).
# Expected: no change. Skip unless validating the broader read path.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof = the new unit tests (the real gate for readMarkers output):
#   - sorting: 3 metrics seq [1,3,2] → recentMetrics seqs [3,2,1] (newest-first)
#   - latest-eq: metric === recentMetrics[0] (same object, toBe); metric.seq === 3
#   - all-collected: 4 metrics → recentMetrics length 4 (NO slicing in readMarkers)
#   - always-array: empty entries → []; throwOnGetEntries → []
#   - defensive: malformed seq → included, sorted to the end (valid highest first)
# These mirror the contract's MOCKING clause: "build session entries with 3+ turn-metrics of varying seq.
# Assert readMarkers().recentMetrics is sorted newest-first (highest seq at index 0). Assert metric (latest)
# === recentMetrics[0]. Assert recentMetrics contains all metrics on the branch."
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (interface field + readMarkers edits + test edits type-clean).
- [ ] `npx vitest run test/filter.test.ts` — all pass (3 augmented its + 5 new its).
- [ ] `npm test` — full suite green (no regressions; nudges/transforms/markers/edge-cases/audit unaffected).

### Feature Validation
- [ ] 3 metrics seq [1,3,2] → `recentMetrics` seqs `[3,2,1]` (newest-first).
- [ ] `bundle.metric` === `bundle.recentMetrics[0]` (`toBe`); `metric.seq === 3`.
- [ ] `recentMetrics` contains ALL turn-metrics (no slicing; 4 metrics → length 4).
- [ ] `recentMetrics` is `[]` for empty entries and `[]` on the getEntries-throws path.
- [ ] A malformed (non-number seq) metric is INCLUDED and sorted to the end.
- [ ] `readMarkers` never throws; `contextHandler`/`registerFilterHandler` unchanged.

### Code Quality Validation
- [ ] New interface field is REQUIRED (no `?`); JSDoc present (purpose + ordering + backward-compat +
      consumer-task + spec refs + the "do NOT slice" note).
- [ ] Field appended LAST in the interface and LAST in BOTH returns (matches the contract's return order +
      the append-last convention).
- [ ] Sort comparator defensively coerces non-number seq to -Infinity (mirrors the removed cSeq/mSeq guard).
- [ ] No changes outside `src/filter.ts` and `test/filter.test.ts`.

### Documentation & Deployment
- [ ] No docs required (contract: "DOCS: none — internal filter function"). spec/06 §1 is the canonical home.
- [ ] No README change (internal bundle field, not config; README config-table sync is P3.M4.T1.S1).

---

## Anti-Patterns to Avoid

- ❌ Do NOT slice `recentMetrics` inside readMarkers (`allMetrics.slice(0, driftWindowTurns)`). The item contract mandates a FULL, config-free array; slicing belongs to the consumer (P3.M3.T6.S1). Pattern 10's sketch slices — superseded. readMarkers must NOT import config.
- ❌ Do NOT remove the `metric` field or change `contextHandler`. `metric` (latest) is kept for backward compat (`suppressCheck` + the current `shouldNudge(metric)`/`injectNudge(metric)` calls). Define `metric = recentMetrics[0] ?? null`. The windowed consumer change is P3.M3.T4/T6 — FUTURE.
- ❌ Do NOT make `recentMetrics` optional (`?`) — it always carries a value (default `[]`); required like every other field.
- ❌ Do NOT use a bare `b.seq - a.seq` comparator — a non-number `seq` yields NaN → non-deterministic sort. Coerce both operands: `(typeof b.seq === "number" ? b.seq : -Infinity) - (typeof a.seq === "number" ? a.seq : -Infinity)`.
- ❌ Do NOT drop malformed (non-number seq) metrics from `recentMetrics` — the established defensive rule is "never drop on bad data." Coerce to -Infinity so they sort to the end but remain included.
- ❌ Do NOT forget EITHER return point — BOTH the getEntries-throws catch early-return AND the final return must include `recentMetrics`, or tsc errors "Property 'recentMetrics' is missing" on the one you missed.
- ❌ Do NOT append the field anywhere but LAST (after `cancelledIds`) in the interface and LAST in both returns — the contract mandates return order `{ rewinds, shrinks, metric, cancelledIds, recentMetrics }`.
- ❌ Do NOT import `TurnMetric` again — it is ALREADY imported in filter.ts (`import type { RewindMarker, ShrinkMarker, TurnMetric } from "./markers.js"`).
- ❌ Do NOT add `recentMetrics` to transforms.ts's `MarkerBundle` (different interface, different file). MarkersBundle stays structurally assignable to filterPipeline's `{ rewinds, shrinks }` param automatically.
- ❌ Do NOT create a new file or touch any file other than `src/filter.ts` and `test/filter.test.ts`.

---

## Confidence Score

**10 / 10** — one-pass success is essentially certain. This is a small, surgical, purely-additive change to one
Pi-coupled module: one required array field on `MarkersBundle`, one loop branch rewritten (keep-latest →
push-all), one defensive descending sort + `metric = recentMetrics[0] ?? null` after the loop, and two return
statements updated to carry the new field. The pattern is the verbatim precedent set by P3.M1.T2.S1's
`cancelledIds` addition to the SAME interface + function (the immediately-preceding readMarkers extension):
declare local → populate in loop → include on BOTH return paths → always-present. `TurnMetric` is already
imported, so no new import. Grep-verified that NO fresh `MarkersBundle` literal exists anywhere in src+test
(only a `type` import and three `as MarkersBundle` casts), so adding a required field cannot break tsc at any
other construction site. The one substantive trap — Pattern 10's in-readMarkers `slice` line — is explicitly
called out as superseded by the item contract (readMarkers exposes the FULL array, config-free; the consumer
slices). The defensive `-Infinity` seq coercion (the second trap) mirrors the EXACT coercion in the code being
removed, so the behavior on malformed metrics is preserved. The test edits are a known, fully-enumerated set
(3 augmented its + 5 new its) with the exact helpers (`metricData`/`customEntry`/`makeCtx`) and the exact
malformed-metric fixture quoted. No external research adds value — the in-repo precedent, the spec §5.1
rationale, and Pattern 10 (for intent, not its slice) are authoritative.