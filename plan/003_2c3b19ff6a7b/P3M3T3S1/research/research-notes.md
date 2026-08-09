# Research Notes — P3.M3.T3.S1: Expose `recentMetrics: TurnMetric[]` on MarkersBundle

## What this task is (from the item contract)

`readMarkers` (src/filter.ts) currently keeps ONLY the latest turn-metric (highest `seq`) on the branch.
This task changes it to collect **ALL** valid turn-metrics during the scan, sort them **newest-first**
(highest `seq` at index 0), and expose the full sorted array as `recentMetrics` on `MarkersBundle`.
Keep `metric` (latest = `recentMetrics[0]`) for backward compat. NEVER throws.

## CRITICAL discrepancy between Pattern 10 and the item contract

- `architecture/implementation_patterns.md` **Pattern 10** shows slicing INSIDE readMarkers:
  `recentMetrics = allMetrics.slice(0, config.nudges.driftWindowTurns)`.
- The **item CONTRACT** (authoritative) says the opposite: "expose the full sorted array as recentMetrics
  … The consumer (contextHandler) slices to driftWindowTurns." and LOGIC step (d) "Set recentMetrics =
  allMetrics (the full sorted array, newest-first)."
- **DECISION: follow the CONTRACT.** readMarkers does NOT slice and does NOT import config. It exposes the
  FULL sorted array. The consumer (P3.M3.T6.S1) slices. This keeps readMarkers config-free (it currently
  takes only `ctx`) and pure w.r.t. the read surface. Flag this in the PRP so the implementer does NOT
  copy Pattern 10's slice line.

## Exact current code to edit (src/filter.ts) — readMarkers

### MarkersBundle interface (append `recentMetrics` LAST, after `cancelledIds`)
```typescript
export interface MarkersBundle {
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  metric: TurnMetric | null;
  /** uuid `id`s ... (P3.M1.T2.S1 / E21). ... */
  cancelledIds: Set<string>;
}
```

### Top-of-function declarations (currently)
```typescript
  const rewinds: RewindMarker[] = [];
  const shrinks: ShrinkMarker[] = [];
  let metric: TurnMetric | null = null;
  const cancelledIds = new Set<string>();
```

### getEntries-throw early-return (fail-open path) — currently
```typescript
  } catch {
    return { rewinds, shrinks, metric, cancelledIds }; // a throwing getEntries → empty bundle (fail-open)
  }
```
At this point `metric === null` and `allMetrics === []` (declared but never populated). Must add
`recentMetrics` to this return (value = the empty `allMetrics`, i.e. `[]`).

### The metric-collection branch inside the loop (currently keeps ONLY the latest)
```typescript
    } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
      const candidate = data as unknown as TurnMetric;
      const cSeq = typeof candidate.seq === "number" ? candidate.seq : -Infinity;
      const mSeq = metric && typeof metric.seq === "number" ? metric.seq : -Infinity;
      if (metric === null || cSeq > mSeq) metric = candidate; // keep the LATEST (highest seq)
    } else if (customType === "mulligan:cancel" && kind === "cancel") {
```
REPLACE the keep-latest math with a simple `allMetrics.push(data as unknown as TurnMetric);`.

### Final return (currently)
```typescript
  return { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds };
```
Add `recentMetrics`. And BEFORE it, after activeRewinds/activeShrinks: sort allMetrics newest-first and
set `metric = recentMetrics[0] ?? null`.

## Key facts verified

- **TurnMetric already imported** in filter.ts: `import type { RewindMarker, ShrinkMarker, TurnMetric } from "./markers.js";` → NO new import needed.
- **seq is monotonic per-session** (runtime.ts `nextSeq`, pre-increment). The handler doc states "ties
  impossible by construction" → the descending sort is a strict total order; Array.prototype.sort stability
  is irrelevant. But malformed entries (non-number seq) CAN occur (readMarkers casts raw session data), so
  the sort comparator MUST defendively coerce non-number seq → `-Infinity` (those go to the END of the
  descending list). This mirrors the EXISTING defensive `cSeq`/`mSeq` coercion being removed.
- **No fresh `MarkersBundle` literals exist** anywhere in src+test. Grep-verified: the only usages are
  `type MarkersBundle` (import) and three `as MarkersBundle` casts in test/filter.test.ts (lines 336/367/373,
  all casts on `pipelineCalls` — NOT constructions). So adding a REQUIRED `recentMetrics` field cannot break
  tsc at any other site. The ONLY construction sites are the 2 return statements inside readMarkers (both
  being edited).
- **contextHandler is UNCHANGED by this task.** It reads `markers.metric` (kept). The windowed-drift
  consumer change (slicing recentMetrics + new shouldNudge signature) is P3.M3.T6.S1 + P3.M3.T4.S1 — FUTURE.
  This task is purely additive (new field + populate it + tests). Zero runtime behavior change (the new
  field is not read by anything yet).
- **transforms.ts's `MarkerBundle` is a SEPARATE interface** (note: different name, "MarkerBundle" vs
  "MarkersBundle"). MarkersBundle stays structurally assignable to filterPipeline's `{ rewinds, shrinks }`
  param (extra fields are fine for variable→param assignability; excess-property checks only apply to fresh
  literals). Adding `recentMetrics` preserves assignability.
- **Return field order** the contract mandates: `{ rewinds, shrinks, metric, cancelledIds, recentMetrics }`.
  Place `recentMetrics` LAST in BOTH the interface and both returns (matches the "append last" convention
  used in runtime.ts additions).

## Test patterns (test/filter.test.ts) — helpers to mirror

- `metricData(seq, grew?, bloat?)` → `{ schema:"pi-mulligan", v:1, kind:"turn-metric", seq, ts:1, deltaTokens, bloatHit, bloatHits:[], grewOverThreshold, turnIndex: seq }`.
- `customEntry(customType, data)` → a `{ type:"custom", customType, data, ... }` SessionEntry.
- `makeCtx({ entries, throwOnGetEntries, ... })` → fake ExtensionContext.
- Existing relevant tests:
  - "returns an empty bundle for an empty entry stream" → ADD `expect(bundle.recentMetrics).toEqual([])`.
  - "keeps only the LATEST turn-metric (highest seq)" (entries seq [1,3,2]) → ADD length + [0].seq checks.
  - "never throws when getEntries throws" → ADD `expect(bundle.recentMetrics).toEqual([])`.

## New test ideas (contract MOCKING clause)

Build session entries with 3+ turn-metrics of varying seq. Assert:
- `recentMetrics` is sorted newest-first (highest seq at index 0): seqs [1,3,2] → [3,2,1].
- `metric` (latest) === `recentMetrics[0]` (same object, `toBe`); and metric.seq === 3.
- `recentMetrics` contains ALL turn-metrics on the branch (no slicing in readMarkers): 4 metrics → length 4.
- `recentMetrics` is always an array: empty entries → `[]`; `throwOnGetEntries` → `[]`.
- Defensive: a turn-metric with a non-number `seq` is INCLUDED (sorted to the end): mix seq "oops" with seq 5,10 → [10,5,malformed], length 3.

## Validation commands (verified for this repo)

- `npx tsc --noEmit` — zero errors (type-check whole project; no separate build script).
- `npx vitest run test/filter.test.ts` — affected file, fast feedback.
- `npm test` — full suite green (the `"test"` script runs vitest).
- No linter/formatter configured (package.json has only `test` + `smoke` scripts).

## Out of scope (FUTURE tasks — do NOT implement here)

- P3.M3.T4.S1 — change `shouldNudge` signature to accept the window (`TurnMetric[]`).
- P3.M3.T6.S1 — wire windowed drift + high-water into contextHandler (slices `recentMetrics` to
  `driftWindowTurns`, passes to `shouldNudge`).
- P3.M3.T5.S1 — `shouldHighWater` + `renderHighWaterNudge` (uses `rt.aboveHighWater` from P3.M3.T2.S1).