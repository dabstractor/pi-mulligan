# PRP — P3.M1.T4.S1: Extend renderAuditReport + AuditDetails to list cancelled markers as retired

## Goal

**Feature Goal**: Make `mulligan_audit` surface the marker-retraction that P3.M1.T1–T3 introduced, so the
agent's token-aware self-view is honest about retired markers (spec/08 E21 acceptance (c): "`mulligan_audit`
lists cancelled markers as retired"). Concretely: the PURE `renderAuditReport` renderer in `src/tools/audit.ts`
gets a new `cancelledCount: number` arg and appends an `N cancelled (retired)` clause to the "Active markers"
line (omitted when `cancelledCount === 0`); the structured `AuditDetails` payload gains a `nCancelled: number`
field; and `auditExecute` threads `markers.cancelledIds.size` (already exposed by the LANDED
`readMarkers` / `MarkersBundle` of P3.M1.T2.S1) into both the renderer and `details`. This is the read-only
display half — it writes NOTHING, edits only `src/tools/audit.ts` + its tests, and relies on `cancelledIds`
being a `Set<string>` that always exists.

**Deliverable**:
- `src/tools/audit.ts` — MODIFIED only:
  - `renderAuditReport` args object gains `cancelledCount: number`.
  - The "Active markers" line appends `, ${cancelledCount} cancelled (retired)` when `cancelledCount > 0`
    (omitted when `=== 0` — keeps the line clean AND keeps the two existing exact-string test assertions green).
  - `AuditDetails` interface gains a REQUIRED `nCancelled: number` field (documented; sits beside `nCheckpoints`).
  - `auditExecute` success path passes `cancelledCount: markers.cancelledIds.size` to `renderAuditReport` and
    sets `details.nCancelled = markers.cancelledIds.size`.
  - `auditExecute` catch path sets `details.nCancelled = 0` (so the new REQUIRED field is present on EVERY
    return path — CRITICAL GOTCHA #1).
- `test/tools/audit.test.ts` — MODIFIED only:
  - New fixture builder `cancelMarkerEntry(targetId)` mirroring `rewindMarkerEntry`/`shrinkMarkerEntry`.
  - New `describe` block for the cancelled/retired listing: pure-renderer cases (cancelledCount 0/1/3 →
    omit/include) + integration cases via `auditTool.execute` (seed cancel entries in `getEntries` → assert
    `details.nCancelled` and the rendered `N cancelled (retired)` clause) + the catch path carries `nCancelled:0`.

**Success Definition**:
- `npx tsc --noEmit` clean (the `AuditDetails` shape change is type-checked on both return paths).
- `npm test` green: the new audit cases pass AND the two pre-existing exact-string active-markers assertions
  (lines 522 & 754, `cancelledCount` implicitly 0) still pass unchanged — proving the omit-when-0 rule.
- With a `mulligan:cancel` entry on the branch, the audit report renders a line ending in
  `N cancelled (retired)` and `details.nCancelled === markers.cancelledIds.size`.
- With no cancel entries, the report is byte-identical to today (no `cancelled` clause) and
  `details.nCancelled === 0`.
- A throwing `getEntries()` still yields a failure text result (never throws) with `details.nCancelled === 0`.

## Why

- This closes the G3 / E21 feedback loop on the **display** side. P3.M1.T1.S1 (data model/persistence) and
  P3.M1.T2.S1 (runtime cancel-drop + `cancelledIds` on `MarkersBundle`) both LANDED; P3.M1.T3.S1 (the
  `mulligan_cancel` tool) is the agent-facing writer being implemented in parallel. Without this task the agent
  cancels a marker, the transform stops applying, but the audit report still claims "0 shrink" / the same rewind
  count as if nothing happened — the agent cannot SEE that a marker was retired, so it can't reason about its own
  retraction history. E21 acceptance (c) explicitly requires the audit to list cancelled markers as retired.
- It is the **sole consumer** of `markers.cancelledIds` outside `filter.ts`. It is strictly read-only: it adds a
  render clause + a numeric `details` field, touches no persistence, no `pi.*`, no config, no wiring
  (`auditTool` is already registered in `index.ts`). The blast radius is exactly two files.
- It is the LAST child of the M1 (marker retraction) milestone; M2 (stale retirement) will append cancel markers
  programmatically (P3.M2.T3.S1) and this same `nCancelled` clause will surface those automatic retirements too
  — no further audit work needed.

## What

**User-visible behavior**: when the agent runs `mulligan_audit` after issuing (or having issued) one or more
`mulligan_cancel`s, the "Active markers" line in the report gains a trailing `, N cancelled (retired)` clause,
where N is the number of distinct cancel entries on the branch. The cancelled markers are NOT counted in the
rewind/shrink counts (they were dropped by `readMarkers`), so the numbers stay self-consistent: a shrink that
was cancelled shows up only as `+1 cancelled (retired)`, not as `1 shrink`. With no cancels, the line is
identical to today. The structured `details` payload exposes the same count as `nCancelled` for logs/UI.

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. `renderAuditReport`'s `args` object type gains `cancelledCount: number` (no `?` — the caller always supplies it).
2. The "Active markers" line is extended so that **when `cancelledCount > 0`** it ends in
   `, ${cancelledCount} cancelled (retired)` immediately after the checkpoints clause; **when `=== 0`** the
   clause is omitted entirely (no trailing comma). Exact target shape (acceptance contract):
   `Active markers: N rewind (gran), N shrink, N checkpoints [names], N cancelled (retired)`.
3. `AuditDetails` gains `nCancelled: number` as a REQUIRED field (beside `nCheckpoints`).
4. `auditExecute` success path: `renderAuditReport({ ..., cancelledCount: markers.cancelledIds.size })` AND
   `details.nCancelled = markers.cancelledIds.size`.
5. `auditExecute` catch path: `details.nCancelled = 0` (the field is REQUIRED — every return path must carry it).
6. The execute body STILL never throws (the existing single try/catch is unchanged; this task adds no new throw sites).

### Success Criteria
- [ ] `renderAuditReport({ ..., cancelledCount: 2 })` produces an "Active markers" line ending in `, 2 cancelled (retired)`.
- [ ] `renderAuditReport({ ..., cancelledCount: 0 })` produces an "Active markers" line with NO `cancelled` clause (byte-identical to today).
- [ ] `AuditDetails` has a REQUIRED `nCancelled: number` field, present on BOTH the success and catch return paths.
- [ ] Seeding `mulligan:cancel` entries in `getEntries()` → `auditTool.execute` returns `details.nCancelled === <count>`
      and the report shows `N cancelled (retired)`.
- [ ] No cancel entries → `details.nCancelled === 0` and the report omits the clause (existing tests unchanged).
- [ ] `npx tsc --noEmit` clean; `npm test` green (new cases pass, no regressions in the 18 existing test files).

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes** — this is a tightly-scoped 2-file change. The implementer must read `src/tools/audit.ts` (the ONLY
source file edited — the exact `renderAuditReport` push to extend, the `AuditDetails` interface, and the two
return-path `details` objects in `auditExecute` are all in this file) and `test/tools/audit.test.ts` (the ONLY
test file edited — mirror its builder + assertion idioms). The single external dependency —
`markers.cancelledIds: Set<string>` on `MarkersBundle` — is already LANDED (P3.M1.T2.S1) and is read-only here.
No `pi.*`, no persistence, no config, no `index.ts` wiring change. The only non-obvious bits are: (a) the
cancelled clause is OMITTED when 0 (a hard requirement that also keeps two pre-existing exact-string tests
green), (b) `nCancelled` is a REQUIRED `AuditDetails` field so the CATCH path must set it too, and (c) a cancel
targeting a ghost id still inflates `cancelledIds` (so the audit count reflects cancel ENTRIES on the branch,
not "markers that actually existed"). All three are spelled out below.

### Documentation & References

```yaml
# MUST READ + EDIT — the ONLY source file this task touches
- file: src/tools/audit.ts
  why: |
    Contains the PURE `renderAuditReport` (extend its args + the Active-markers push), the `AuditDetails`
    interface (add nCancelled), and `auditExecute` (thread markers.cancelledIds.size into BOTH the renderer
    call and the success-path details; add nCancelled:0 to the catch-path details). `auditTool` itself,
    AUDIT_DESC, AuditParams, and all the describeMessage/buildCallLookup/listCheckpoints/messageBytes helpers
    are UNCHANGED.
  section: renderAuditReport (~the "PURE report renderer" block); AuditDetails (~"structured details payload");
           auditExecute (success return + catch return)
  pattern: |
    # Active-markers push — CURRENT (extend this ONE L.push):
    const gran = [...new Set(args.rewinds.map((r) => readStr(r,"granularity")).filter((g):g is string=>!!g))].join(", ");
    const ckptNames = args.checkpointNames.length ? ` [${args.checkpointNames.join(", ")}]` : " []";
    L.push(
      `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : ""}, ` +
        `${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints${ckptNames}`,
    );
    # TARGET: append `, ${cancelledCount} cancelled (retired)` ONLY when args.cancelledCount > 0.
  gotcha: |
    (1) OMIT the clause when cancelledCount===0 (hard requirement; keeps the 2 existing exact-string tests
        at audit.test.ts:522 & :754 green — they pass no cancels, so cancelledCount is 0).
    (2) `nCancelled` is a REQUIRED AuditDetails field → the CATCH path's `details:{...}` MUST include
        `nCancelled: 0` (CRITICAL GOTCHA #1: details is required on every return path; strict tsconfig).
    (3) Use the EXACT spelling `cancelled (retired)` (British double-l + "(retired)" parenthetical) — matches
        E21 acceptance (c) "lists cancelled markers as retired" and the contract example.

# MUST READ — the INPUT contract (already LANDED by P3.M1.T2.S1; DO NOT edit filter.ts)
- file: src/filter.ts
  why: |
    `MarkersBundle` exposes `cancelledIds: Set<string>` (the uuid ids retired by mulligan:cancel entries — empty
    Set when none, ALWAYS present even on readMarkers' own catch path). `readMarkers(ctx)` returns
    `{ rewinds, shrinks, metric, cancelledIds }` where rewinds/shrinks already EXCLUDE cancelled markers. So
    `markers.cancelledIds.size` is the exact retired count — no filtering/computing needed in audit.ts.
  section: MarkersBundle (~line 95); readMarkers cancel-drop (~lines 124-178)
  gotcha: |
    A cancel targeting a GHOST id (no matching rewind/shrink) is STILL recorded in cancelledIds (readMarkers
    records every data.targetId unconditionally — verified filter.test.ts:213 `expect(...).toEqual(new Set(["nope"]))`).
    So nCancelled counts CANCEL ENTRIES on the branch, not "markers that existed". This is correct and intended:
    the audit reflects retraction history. Do NOT try to subtract — pass markers.cancelledIds.size verbatim.

# MUST READ + EDIT — the ONLY test file this task touches (mirror its idiom)
- file: test/tools/audit.test.ts
  why: |
    House idiom: vitest, hand-rolled makePi()/makeCtx() fakes (NO vi.fn), .js imports, expectTypeOf, clearAll()
    before/after each (shared runtime Map). Pure helpers (incl. renderAuditReport) are unit-tested DIRECTLY with
    plain-data args; integration tests call auditTool.execute("call-1", params, undefined, undefined, fakeCtx).
    EXISTING fixture builders to MIRROR for the cancel entry: rewindMarkerEntry(granularity, seq) and
    shrinkMarkerEntry(seq) — each returns a `as unknown as SessionEntry` custom entry with a module-level
    entrySeq id. Add cancelMarkerEntry(targetId) the same way.
  section: renderAuditReport assertions (search "Active markers"); makeCtx() fake (scripts getEntries)
  pattern: |
    # NEW builder — mirror rewindMarkerEntry/shrinkMarkerEntry structure:
    function cancelMarkerEntry(targetId: string): SessionEntry {
      entrySeq += 1;
      return {
        type: "custom", id: `e-${entrySeq}`, parentId: null, timestamp: "",
        customType: "mulligan:cancel",
        data: { schema: "pi-mulligan", v: 1, kind: "cancel", targetId, seq: 0, ts: 1 },
      } as unknown as SessionEntry;
    }
    # EXISTING exact-string assertions that MUST stay green (they assert NO cancelled clause — cancelledCount 0):
    #   audit.test.ts:522  "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [before-x, before-y]"
    #   audit.test.ts:754  "Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]"
  gotcha: |
    (1) readMarkers does NOT validate the `schema` field (only customType+kind) — value is cosmetic; use
        "pi-mulligan" (markers.ts real output) for fidelity.
    (2) When a cancel targets a real rewind/shrink marker's data.id, readMarkers DROPS that marker from
        rewinds/shrinks AND records the id. So a test pairing "1 rewind + 1 cancel targeting it" yields
        nRewinds:0, nCancelled:1 — not nRewinds:1. To ISOLATE the cancelled clause, seed a cancel targeting a
        GHOST id (e.g. "ghost-1") with NO matching marker → nCancelled:1 and rewinds/shrinks unchanged.

# Sibling PRPs (read-only contracts — what EXISTS when this item starts)
- docfile: plan/003_2c3b19ff6a7b/P3M1T2S1/PRP.md
  why: LANDED. Defines readMarkers' cancel-drop + cancelledIds:Set<string> on MarkersBundle. This task's sole input.
- docfile: plan/003_2c3b19ff6a7b/P3M1T3S1/PRP.md
  why: Implementing in parallel. Creates the mulligan_cancel tool that WRITES mulligan:cancel entries (which this
        audit then DISPLAYS). No code-level coupling with audit.ts — they share only the on-disk cancel-entry shape.
- docfile: plan/003_2c3b19ff6a7b/architecture/system_context.md
  why: §"tools/audit.ts" confirms the contract: renderAuditReport's current args + Active-markers line format, and
        the P3 delta "extend to list cancelled markers as retired (acceptance c). readMarkers now returns cancelledIds."

# Pi type reference — details shape (why nCancelled must be on EVERY return path)
- file: node_modules/@earendil-works/pi-coding-agent
  why: AgentToolResult<T>'s `details: T` is REQUIRED (audit.ts CRITICAL GOTCHA #1). tsconfig is strict, so adding
        a non-optional field to AuditDetails without setting it on the catch path is a COMPILE ERROR. Set it on both.
```

### Current Codebase tree (relevant slice)

```bash
src/
├── tools/
│   ├── audit.ts          # ← EDIT (renderAuditReport args + Active-markers line; AuditDetails; auditExecute x2 paths)
│   ├── cancel.ts         # (P3.M1.T3.S1, in parallel — NOT this task's concern)
│   ├── checkpoint.ts
│   ├── rewind.ts
│   └── shrink.ts
├── filter.ts             # readMarkers + MarkersBundle.cancelledIds — LANDED, READ-ONLY consumer
├── markers.ts            # appendCancelMarker / CancelMarker — LANDED, READ-ONLY consumer
└── index.ts              # auditTool already registered — NO CHANGE
test/
└── tools/
    └── audit.test.ts     # ← EDIT (add cancelMarkerEntry builder + cancelled/retired describe block)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Two EXISTING files modified:
src/tools/audit.ts     # renderAuditReport(+cancelledCount arg & clause) + AuditDetails(+nCancelled) + auditExecute(thread size; catch nCancelled:0)
test/tools/audit.test.ts # +cancelMarkerEntry(targetId) builder + "lists cancelled markers as retired" describe block
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: AuditDetails.details is REQUIRED on EVERY return path (audit.ts CRITICAL GOTCHA #1).
// Adding a non-optional `nCancelled: number` to AuditDetails makes BOTH the success AND catch paths must set it.
// Forgetting the catch path is a tsc ERROR (strict tsconfig) — not just a runtime gap.

// CRITICAL: the cancelled clause is OMITTED when cancelledCount===0. This is a HARD requirement (acceptance
// contract: "keep the line clean") AND it is what keeps the two pre-existing exact-string active-markers
// assertions green (audit.test.ts:522 & :754 pass no cancels). Do NOT render ", 0 cancelled (retired)".

// GOTCHA: readMarkers already DROPS cancelled markers from rewinds/shrinks before returning, so a cancelled
// shrink is NOT in shrinks[] (it shows up ONLY via cancelledIds). The audit numbers are self-consistent:
// cancel a shrink → shrinks count drops by 1, cancelled count rises by 1. Do NOT double-count.

// GOTCHA: a cancel targeting a ghost id (no matching marker) STILL inflates cancelledIds.size. This is intended
// (the audit reflects retraction history / cancel entries on the branch). Pass markers.cancelledIds.size verbatim.

// SPELLING: "cancelled" (British double-l) is the codebase-wide convention (cancelledIds, nCancelled,
// mulligan:cancel). Match it exactly — do NOT write "canceled". The clause literal is "cancelled (retired)".

// NO config / NO wiring change: auditTool is a PLAIN `export const` already registered in index.ts. There is no
// `config.audit` sub-knob and no registration to touch. This task edits ONLY audit.ts + its test file.
```

## Implementation Blueprint

### Data models and structure

The only data-model change is the `AuditDetails` interface and `renderAuditReport`'s `args` type — both inline
type literals in `src/tools/audit.ts` (no separate models file). No Pydantic/ORM/Pydantic-schema artifacts apply
(this is a TypeScript project; see the validation commands below).

```ts
// AuditDetails — add nCancelled as a REQUIRED field (beside nCheckpoints):
export interface AuditDetails {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  source: "cached" | "fallback";
  nRewinds: number;
  nShrinks: number;
  nCheckpoints: number;
  /** Count of cancelled (retired) rewind/shrink markers = markers.cancelledIds.size (P3.M1.T4.S1 / E21 (c)). */
  nCancelled: number;
  top: AuditRow[];
  error?: string; // catch-path ONLY
}

// renderAuditReport — add cancelledCount to the args object:
export function renderAuditReport(args: {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  checkpointNames: string[];
  protectedRoles: string[];
  rows: AuditRow[];
  filtered: unknown[];
  cancelledCount: number; // P3.M1.T4.S1 — caller passes markers.cancelledIds.size
}): string { /* ... */ }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tools/audit.ts — AuditDetails interface (+nCancelled)
  - IMPLEMENT: add `nCancelled: number;` field to the `AuditDetails` interface, documented (beside nCheckpoints).
  - WHY FIRST: it is the type both return paths must satisfy; editing it first surfaces the tsc errors that guide
    Task 3 (both details objects must now include nCancelled).
  - NAMING: nCancelled (British double-l — matches cancelledIds, the codebase convention).
  - PLACEMENT: inside the existing `export interface AuditDetails { ... }` block.

Task 2: MODIFY src/tools/audit.ts — renderAuditReport (+cancelledCount arg & clause)
  - IMPLEMENT: add `cancelledCount: number;` to the `args` object type. Extend the "Active markers" L.push so it
    appends `, ${args.cancelledCount} cancelled (retired)` ONLY when `args.cancelledCount > 0`.
  - FOLLOW pattern: the existing 3-line gran/ckptNames/L.push block (the ONLY place the line is built).
  - NAMING: clause literal exactly `, ${n} cancelled (retired)` (note the leading comma+space; "cancelled" double-l).
  - GOTCHA: OMIT when cancelledCount===0 (no trailing comma) — hard requirement + keeps existing tests green.
  - PLACEMENT: the single L.push that builds "Active markers: ..." (immediately before the `Protected:` push).

Task 3: MODIFY src/tools/audit.ts — auditExecute (thread cancelledIds.size into renderer + BOTH details paths)
  - IMPLEMENT:
    - Success path renderAuditReport call: add `cancelledCount: markers.cancelledIds.size,` to the args object.
    - Success path `details`: add `nCancelled: markers.cancelledIds.size,` to the details object.
    - Catch path `details`: add `nCancelled: 0,` to the details object (REQUIRED field — CRITICAL GOTCHA #1).
  - DEPENDENCIES: readMarkers(ctx) is already called as `const markers = readMarkers(ctx);` — reuse it; do NOT
    add a second readMarkers call.
  - NAMING: cancelledCount (renderer arg) + nCancelled (details field) — see Tasks 1-2.
  - GOTCHA: NEVER throws — the existing single try/catch is unchanged; this task adds no new throw sites.
  - PLACEMENT: two details objects (success ~end of try; catch in `catch (e)`) + the one renderAuditReport call.

Task 4: MODIFY test/tools/audit.test.ts — cancelMarkerEntry builder
  - IMPLEMENT: add a `cancelMarkerEntry(targetId: string): SessionEntry` fixture builder mirroring
    rewindMarkerEntry/shrinkMarkerEntry (same module-level `entrySeq`, customType "mulligan:cancel",
    data { schema:"pi-mulligan", v:1, kind:"cancel", targetId, seq:0, ts:1 }).
  - FOLLOW pattern: rewindMarkerEntry(granularity, seq) / shrinkMarkerEntry(seq) — both `as unknown as SessionEntry`.
  - PLACEMENT: next to the other marker builders (after shrinkMarkerEntry, before kbText).

Task 5: MODIFY test/tools/audit.test.ts — "lists cancelled markers as retired" describe block
  - IMPLEMENT (pure-renderer cases, call renderAuditReport directly with minimal plain-data args):
    a) cancelledCount:1 (no rewinds/shrinks/checkpoints) → Active-markers line ends in ", 1 cancelled (retired)".
    b) cancelledCount:3 → "..., 3 cancelled (retired)".
    c) cancelledCount:0 → NO "cancelled" substring in the line (omit rule) — guard against ", 0 cancelled".
  - IMPLEMENT (integration cases via auditTool.execute + makeCtx seeding getEntries):
    d) seed ONE cancelMarkerEntry("ghost-1") (ghost id, no matching marker) → details.nCancelled===1 AND firstText
       includes "1 cancelled (retired)". (Ghost id isolates the clause: rewinds/shrinks counts stay 0.)
    e) seed TWO cancelMarkerEntry targeting "g1","g2" → details.nCancelled===2; report shows "2 cancelled (retired)".
    f) NO cancel entries (existing behavior) → details.nCancelled===0; report has NO "cancelled" clause.
    g) a REAL pair: rewindMarkerEntry("last_tool_call_group",1) + cancelMarkerEntry("rw-1") → details.nRewinds===0
       (dropped by readMarkers) AND details.nCancelled===1 AND report shows "1 cancelled (retired)".
  - IMPLEMENT (resilience): catch path — makeCtx({throwOnGetEntries:true}) → execute returns failure text,
       details.nCancelled===0 (the new field is present on the catch path), details.error is set.
  - IMPLEMENT (type assert): `expectTypeOf<AuditDetails>().toMatchTypeOf<{ nCancelled: number }>()` OR extend the
       existing auditTool ToolDefinition type assert to confirm nCancelled is part of AuditDetails.
  - FOLLOW pattern: the existing "(f) active markers + checkpoints" describe block at audit.test.ts:503 + the
    primary-path cached-view setup (`getRuntime("s1").lastFiltered = [...]` so the audit uses the cached path,
    isolating it from filterPipeline). Use `setConfig({})` in a beforeEach for deterministic thresholds.
  - NAMING: describe "mulligan_audit — lists cancelled markers as retired (P3.M1.T4.S1 / E21 (c))".
  - COVERAGE: omit-when-0 (c), include-when-N (a,b), nCancelled↔cancelledIds.size (d,e,g), never-throws (catch),
       type-surface (type assert).
  - PLACEMENT: new describe block near the existing active-markers block (~line 503).
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the "Active markers" line extension (Task 2). Extend the EXISTING L.push — keep gran + ckptNames as-is,
// append the cancelled clause conditionally. Do NOT introduce a second push; the line is built in ONE push.
const granularities = [...new Set(args.rewinds.map((r) => readStr(r, "granularity")).filter((g): g is string => !!g))];
const gran = granularities.join(", ");
const ckptNames = args.checkpointNames.length ? ` [${args.checkpointNames.join(", ")}]` : " []";
const cancelledClause = args.cancelledCount > 0 ? `, ${args.cancelledCount} cancelled (retired)` : "";
L.push(
  `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : ""}, ` +
    `${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints${ckptNames}${cancelledClause}`,
);

// PATTERN: auditExecute success path (Task 3) — reuse the existing `markers` const; add ONE field to each object.
const markers = readMarkers(ctx);                                  // ALREADY present — do not re-read
// ... (checkpointNames, rows, filtered unchanged) ...
const report = renderAuditReport({
  totalTokens, confidence,
  rewinds: markers.rewinds as RewindMarker[],
  shrinks: markers.shrinks as ShrinkMarker[],
  checkpointNames,
  protectedRoles: config.rewind.protectedRoles,
  rows, filtered,
  cancelledCount: markers.cancelledIds.size,                        // P3.M1.T4.S1
});
return {
  content: [{ type: "text" as const, text: report }],
  details: {
    totalTokens, confidence, source,
    nRewinds: markers.rewinds.length,
    nShrinks: markers.shrinks.length,
    nCheckpoints: checkpointNames.length,
    nCancelled: markers.cancelledIds.size,                          // P3.M1.T4.S1
    top: rows,
  },
};

// PATTERN: auditExecute CATCH path (Task 3) — nCancelled:0 so the REQUIRED field is present (CRITICAL GOTCHA #1).
details: {
  totalTokens: 0, confidence: "low", source: "fallback",
  nRewinds: 0, nShrinks: 0, nCheckpoints: 0, nCancelled: 0, top: [], error: reason,
}

// TEST PATTERN: isolate the cancelled clause with a GHOST-id cancel (no marker dropped):
const { ctx } = makeCtx({ entries: [cancelMarkerEntry("ghost-1")] });
getRuntime("s1").lastFiltered = [userMsg("hi")];   // cached path → no filterPipeline re-run
const res = await run(ctx, {});
expect(res.details.nCancelled).toBe(1);
expect(firstText(res)).toContain("1 cancelled (retired)");
```

### Integration Points

```yaml
DATABASE:
  - none (audit persists NOTHING; marker entries are on-disk via prior mulligan_cancel calls)
CONFIG:
  - none (no new config knob; audit is always-on diagnostics; there is no config.audit sub-switch)
ROUTES:
  - none (auditTool is already registered in src/index.ts as `pi.registerTool(auditTool)`; NO wiring change)
TYPES:
  - AuditDetails gains nCancelled:number (REQUIRED) — surfaced to logs/UI via the tool result's `details`.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck after each edit — strict tsconfig: a missing nCancelled on EITHER return path is a COMPILE ERROR.
npx tsc --noEmit
# Expected: zero errors. If AuditDetails-complaint errors appear on the catch path, add nCancelled:0 there.

# No separate linter step in package.json (the project ships only `test` + `smoke` scripts); tsc + vitest are the gates.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the FULL suite (catches regressions in the 18 existing test files, esp. the two exact-string
# active-markers assertions at audit.test.ts:522 & :754 which assert NO cancelled clause).
npm test
# Expected: all green. If audit.test.ts:522 or :754 now FAILS, you rendered ", 0 cancelled (retired)" — re-apply
# the omit-when-0 rule (Task 2).

# Targeted run while iterating (vitest run, single file):
npx vitest run test/tools/audit.test.ts
# Expected: the new "lists cancelled markers as retired" describe block passes; existing blocks unchanged.
```

### Level 3: Integration Testing (System Validation)

```bash
# Manual render sanity (optional): drive renderAuditReport directly from a one-off node -e, or rely on the
# pure-renderer unit cases (Task 5 a–c) which call renderAuditReport with plain data — they ARE the integration
# proof that the clause appears/omits correctly. No long-running server; the audit is a pure tool.

# Real-Pi smoke (if running the integration harness): issue mulligan_rewind → mulligan_cancel → mulligan_audit,
# then eyeball the report's "Active markers" line for the "N cancelled (retired)" clause. (The unit cases cover
# this deterministically; the smoke is belt-and-suspenders.)
npm run smoke   # optional integration harness (test/integration/run-smoke.mjs)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Render-format spot check: confirm the clause uses the contract spelling by grepping the renderer output.
# (Done via the pure unit case asserting `.toContain("cancelled (retired)")` — British double-l + "(retired)".)

# Self-consistency check (unit case Task 5 g): cancelling a REAL marker drops it from its bucket AND raises
# nCancelled — assert BOTH nRewinds:0 and nCancelled:1 in the same result so the numbers cannot double-count.

# Type-surface check (Task 5 type assert): expectTypeOf<AuditDetails>().toMatchTypeOf<{ nCancelled: number }>()
# guarantees downstream consumers (logs/UI/test helpers) see the field as part of the public AuditDetails type.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean (AuditDetails change is checked on BOTH auditExecute return paths).
- [ ] `npm test` green — new "lists cancelled markers as retired" block passes AND no regression in the other 18 files.
- [ ] The two pre-existing exact-string active-markers assertions (audit.test.ts:522 & :754) STILL pass unchanged.

### Feature Validation
- [ ] renderAuditReport with cancelledCount>0 → "Active markers" line ends in `, N cancelled (retired)`.
- [ ] renderAuditReport with cancelledCount===0 → NO `cancelled` clause (line byte-identical to today).
- [ ] AuditDetails.nCancelled === markers.cancelledIds.size on the success path; === 0 on the catch path.
- [ ] A ghost-id cancel still shows in the audit (cancelledIds counts cancel entries on the branch).
- [ ] Cancelling a REAL marker drops it from its bucket AND raises nCancelled (no double-count).

### Code Quality Validation
- [ ] British spelling "cancelled" used consistently (cancelledIds, nCancelled, "cancelled (retired)").
- [ ] Only `src/tools/audit.ts` + `test/tools/audit.test.ts` are modified (no filter.ts/markers.ts/index.ts/config.ts).
- [ ] No new throw sites; the existing single try/catch in auditExecute is preserved (E13 — never throws).
- [ ] No new config knob, no new wiring, no persistence change (audit remains read-only).

### Documentation & Deployment
- [ ] The `nCancelled` field and `cancelledCount` arg each carry a one-line JSDoc referencing P3.M1.T4.S1 / E21 (c).
- [ ] No user-facing/config/API surface change (E21 docs note: "audit behavior is already documented in spec/05 §4;
      the retired listing is an extension of the existing 'Active markers' line").

---

## Anti-Patterns to Avoid

- ❌ Don't render `, 0 cancelled (retired)` — the clause is OMITTED when cancelledCount===0 (hard requirement +
  keeps the existing exact-string tests green).
- ❌ Don't forget `nCancelled: 0` on the CATCH-path `details` — `AuditDetails` is REQUIRED on every return path
  (strict tsconfig makes this a compile error, but verify it).
- ❌ Don't edit `src/filter.ts`, `src/markers.ts`, `src/index.ts`, or `src/config.ts` — `cancelledIds` is LANDED
  and read-only here; the audit is already wired; there is no new config.
- ❌ Don't re-read markers or re-scan entries for cancels inside audit.ts — `markers.cancelledIds.size` is the
  canonical count; reuse the existing `const markers = readMarkers(ctx)`.
- ❌ Don't double-count: a cancelled marker is DROPPED from rewinds/shrinks by readMarkers, so it appears ONLY via
  nCancelled. Do not add it back to a marker bucket.
- ❌ Don't spell it "canceled" (one l) — the codebase convention is the British double-l (cancelledIds, nCancelled).
- ❌ Don't change `auditTool`, `AUDIT_DESC`, `AuditParams`, or any of the describe/label/byte helpers — the change
  is scoped to the renderer args, the Active-markers line, the AuditDetails interface, and the two details objects.

---

**Confidence Score: 9/10** — one-pass success is highly likely: it is a 2-file change with a precisely-specified
contract, the sole input (`cancelledIds`) is already LANDED and read-only, and the only failure modes (forgetting
the catch-path field; rendering `, 0 cancelled`) are both caught deterministically by `npx tsc --noEmit` and the
two pre-existing exact-string tests respectively. The -1 is for the small risk of a typo in the clause spelling
("cancelled (retired)") — mitigated by the `.toContain` unit assertion.