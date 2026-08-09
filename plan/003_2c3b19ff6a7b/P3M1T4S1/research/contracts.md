# Research — P3.M1.T4.S1: Audit retired-marker listing

## Ground-truth contracts (read directly from src/, 2025-08-09)

### `src/tools/audit.ts` — the file being modified (PURE renderer + execute)

**`renderAuditReport` CURRENT signature** (exported, PURE — takes plain data, no `ctx`):
```ts
export function renderAuditReport(args: {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  checkpointNames: string[];
  protectedRoles: string[];
  rows: AuditRow[];
  filtered: unknown[];
}): string
```

**Active markers line — CURRENT code** (the exact 3 lines to extend):
```ts
const granularities = [...new Set(args.rewinds.map((r) => readStr(r, "granularity")).filter((g): g is string => !!g))];
const gran = granularities.join(", ");
const ckptNames = args.checkpointNames.length ? ` [${args.checkpointNames.join(", ")}]` : " []";
L.push(
  `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : ""}, ` +
    `${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints${ckptNames}`,
);
```
This is the LAST push before the `Protected:` line. The `L.push` for the active-markers line is immediately followed by:
```ts
L.push(`Protected: will not rewind past ${describeProtected(args.protectedRoles)}.`);
```

**`AuditDetails` CURRENT interface** (REQUIRED on every return path — CRITICAL GOTCHA #1):
```ts
export interface AuditDetails {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  source: "cached" | "fallback";
  nRewinds: number;
  nShrinks: number;
  nCheckpoints: number;
  top: AuditRow[];
  error?: string;   // catch-path ONLY
}
```

**`auditExecute` — the two return paths that build `details`** (both must get the new field):
1. SUCCESS path (~end of try block):
```ts
const markers = readMarkers(ctx);
const checkpointNames = listCheckpoints(ctx.sessionManager.getEntries() as unknown as unknown[]);
const report = renderAuditReport({
  totalTokens, confidence,
  rewinds: markers.rewinds as RewindMarker[],
  shrinks: markers.shrinks as ShrinkMarker[],
  checkpointNames,
  protectedRoles: config.rewind.protectedRoles,
  rows, filtered,
});
return {
  content: [{ type: "text" as const, text: report }],
  details: {
    totalTokens, confidence, source,
    nRewinds: markers.rewinds.length,
    nShrinks: markers.shrinks.length,
    nCheckpoints: checkpointNames.length,
    top: rows,
  },
};
```
2. CATCH path (E13 — never throws):
```ts
return {
  content: [{ type: "text" as const, text: `Mulligan: audit failed — ${reason}` }],
  details: {
    totalTokens: 0, confidence: "low", source: "fallback",
    nRewinds: 0, nShrinks: 0, nCheckpoints: 0, top: [], error: reason,
  },
};
```

### `src/filter.ts` — the input contract (P3.M1.T2.S1 — LANDED, read-only consumer)

**`MarkersBundle`** (filter.ts ~line 95) ALREADY exposes `cancelledIds: Set<string>`:
```ts
export interface MarkersBundle {
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  metric: TurnMetric | null;
  cancelledIds: Set<string>;   // uuid ids retired by a mulligan:cancel; empty Set when none
}
```
`readMarkers(ctx)` returns `{ rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds }`.
- `cancelledIds` holds the uuid `id`s targeted by `mulligan:cancel` entries (read from `data.targetId`).
- A marker whose `data.id ∈ cancelledIds` is DROPPED from `rewinds`/`shrinks` BEFORE returning.
- A cancel targeting a GHOST id (no matching marker) is STILL recorded in `cancelledIds` (filter.test.ts:213).
- ALWAYS a Set (even on the catch path of readMarkers — filter.test.ts:176-177).
- **This task reads `markers.cancelledIds.size` ONLY. It does NOT edit filter.ts.**

### `src/markers.ts` — cancel envelope schema (LANDED)
`appendCancelMarker` stamps `{ schema: "pi-mulligan", v: 1, kind: "cancel", targetId, seq, ts }` into a custom
entry with `customType: "mulligan:cancel"`. CancelMarker has NO `id` field (not itself cancellable).

### Test patterns — `test/tools/audit.test.ts` (vitest, house idiom)
- Pure helpers (incl. `renderAuditReport`) are unit-tested DIRECTLY with plain-data args.
- Integration tests call `auditTool.execute("call-1", params, undefined, undefined, fakeCtx)`; `makeCtx()` scripts
  `sessionManager.{getSessionId,buildContextEntries,getEntries,getBranch}` (the fakes track `calls[]`).
- Builder helpers already present: `rewindMarkerEntry(granularity, seq)`, `shrinkMarkerEntry(seq)`,
  `checkpointEntry(name, targetId?)`, `msgEntry(role, extra?)`. Each shares a module-level `entrySeq` counter.
- **Existing EXACT-string active-markers assertions** (MUST stay green — they omit the cancelled clause by default):
  - line 522: `"Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [before-x, before-y]"`
  - line 754: `"Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]"`
  → These pass `cancelledCount` of 0 (no cancels seeded) → the new clause MUST be omitted when `cancelledCount === 0`.

### filter.test.ts cancel builder (to mirror in audit.test.ts)
```ts
function cancelData(targetId: string): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "cancel", targetId, seq: 0, ts: 1 };
}
function makeCancelEntry(targetId: string): SessionEntry {
  return customEntry("mulligan:cancel", cancelData(targetId));
}
```
Note: readMarkers does NOT validate the `schema` field (only `customType` + `kind`), so its value is cosmetic
for readMarkers behavior. Use `"pi-mulligan"` (markers.ts real output) in the audit-test cancel builder.

### Validation commands (verified)
- `npx tsc --noEmit` — typecheck (strict tsconfig; `details` shape must match `AuditDetails` exactly).
- `npm test` → `vitest run` (runs the whole suite; audit tests in test/tools/audit.test.ts).

## Decisions locked for the PRP
1. `renderAuditReport` gains `cancelledCount: number` (the CALLER passes `markers.cancelledIds.size`).
2. The cancelled clause is appended AFTER the checkpoints clause, as `, N cancelled (retired)`, OMITTED when 0.
3. `AuditDetails` gains `nCancelled: number` (REQUIRED field — appears on BOTH success and catch paths).
4. `auditExecute` passes `cancelledCount: markers.cancelledIds.size` to the renderer and `nCancelled: same` to details.
5. Tests: (a) pure renderer — cancelledCount 0/1/3 → omit/include assertion; (b) integration via auditTool.execute
   seeding cancel entries in getEntries → assert nCancelled + the rendered clause; (c) catch path carries nCancelled:0.