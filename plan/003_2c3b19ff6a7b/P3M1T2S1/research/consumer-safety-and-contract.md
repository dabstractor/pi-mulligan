# Research Notes — P3.M1.T2.S1 (readMarkers cancel-drop)

## What this task does
Extend `readMarkers(ctx)` in `src/filter.ts` to collect `mulligan:cancel` entries into a
`cancelledIds: Set<string>`, drop any rewind/shrink whose uuid `id` field is in that set, and expose
`cancelledIds` on the `MarkersBundle` interface. Runtime half of G3 / E21 (marker retraction).

## Key validated findings (consumer-safety analysis)

Adding `cancelledIds: Set<string>` to `MarkersBundle` is **structurally additive and breaks nothing**:

| Consumer | Param/return type | Effect of adding `cancelledIds` |
| --- | --- | --- |
| `filterPipeline` (transforms.ts `MarkerBundle`, line ~1037) | `{ rewinds; shrinks }` (RewindMarkerLike[]/ShrinkMarkerLike[]) | `markers` passed as a **variable** (readMarkers result), not a fresh literal → TS excess-property checks don't fire. Extra field ignored. |
| `nudges.ts suppressCheck` | `{ rewinds; shrinks }` (ReadonlyArray) | Same — structurally assignable; extra `metric` already ignored, `cancelledIds` too. |
| `contextHandler` (filter.ts) | reads `markers.rewinds/.shrinks/.metric` | Now sees **active-only** markers (cancelled dropped) — correct, intended. |
| `audit.ts renderAuditReport` (line ~540) | reads `markers.rewinds/.shrinks` only | Now reports active-only counts. The cancelled-COUNT row is P3.M1.T4.S1 (will also read `markers.cancelledIds`). Beneficial side effect. |

## Existing test safety (no full-object `toEqual` on a readMarkers bundle)
- `test/filter.test.ts` "empty bundle" / "getEntries throws" tests assert **individual fields**
  (`bundle.rewinds`, `bundle.shrinks`, `bundle.metric`), not the whole object → adding a field is invisible.
- `test/edge-cases.test.ts` (~line 742) asserts `out.messages` (the contextHandler return), not bundle shape.
- `test/tools/audit.test.ts` fixtures contain no cancels (cancel markers are brand new from P3.M1.T1.S1),
  so `nRewinds`/`nShrinks` assertions are unchanged.

## Contract decisions (from work-item description; over-rule doc alternatives)
1. **`targetId` = the marker's uuid `id` field** (RewindMarker.id / ShrinkMarker.id), NOT the Pi entry id.
   `implementation_patterns.md` Pattern 2 floated an "entry id" alternative → **OVER-RULED** by the contract.
2. **Drop predicate is verbatim**: `rewinds.filter(r => { const id = readOwn(r, "id"); return typeof id !== "string" || !cancelledIds.has(id); })` — do NOT rephrase (rewiring breaks the defensive keep-on-unreadable-id).
3. **Order-independent BY CONSTRUCTION**: single-pass scan collects rewinds/shrinks AND targetIds, then the
   filter runs AFTER the loop → a cancel entry BEFORE its target still drops it.
4. **Defensive**: malformed cancel (non-string/empty/missing `targetId`) is skipped (fail-open, never throws);
   a marker with an unreadable `id` is KEPT (never drop on bad data).
5. **Both return paths carry `cancelledIds`**: declare `const cancelledIds = new Set<string>()` at function top
   (in scope for the getEntries-threw catch AND the end-of-function return).

## Dependency on P3.M1.T1.S1 (treated as already-landed)
P3.M1.T1.S1 lands: `CancelMarker { kind:"cancel"; targetId:string; seq; ts }` (no own `id`),
`CancelMarkerInput = { targetId: string }`, `appendCancelMarker` (clone of `appendTurnMetric`, customType
`"mulligan:cancel"`), and extends `MulliganEnvelope.kind` to include `"cancel"`.
**This task does NOT import CancelMarker** — it reads `data` defensively via `readOwn`, so it is decoupled from
the exact interface. It only needs the persisted entry shape: `customType === "mulligan:cancel"`, `data.kind === "cancel"`, `data.targetId` (string).

## No external research needed
Pure TypeScript codebase work with established defensive patterns (`readOwn`/`isRecord` already in filter.ts).
No new libraries, no new APIs. Spec/08 E21 + the work-item contract fully specify behavior.