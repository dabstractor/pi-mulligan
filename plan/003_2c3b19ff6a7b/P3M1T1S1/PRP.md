# PRP — P3.M1.T1.S1: CancelMarker interface + MulliganEnvelope.kind extension + appendCancelMarker wrapper

## Goal

**Feature Goal**: Add the `cancel` marker data model to `src/markers.ts` — extend the versioning envelope's `kind` union, define a `CancelMarker` interface (mirroring `TurnMetric` in that it carries NO `id` field), define a `CancelMarkerInput` type, and implement an `appendCancelMarker(pi, ctx, data)` persistence wrapper that is an exact structural clone of `appendShrinkMarker` (minus the uuid stamp). Also document the new shape in `spec/04-data-model.md`.

**Deliverable**:
- `src/markers.ts` — modified: `MulliganEnvelope.kind` extended to `"cancel"`; new exported `CancelMarker` interface; new exported `CancelMarkerInput` type; new exported `appendCancelMarker(pi, ctx, data): string | null` function.
- `spec/04-data-model.md` — modified: new subsection after §5 (Turn metric) documenting the cancel marker.
- `test/markers.test.ts` — modified: new `appendCancelMarker` test blocks mirroring the existing `appendShrinkMarker`/`appendTurnMetric` blocks.

**Success Definition**:
- `appendCancelMarker` calls `pi.appendEntry("mulligan:cancel", { schema:"pi-mulligan", v:1, kind:"cancel", targetId, seq, ts })` and returns the scripted leaf id.
- The persisted entry carries NO `id` field (it is not itself cancellable — same rule as `TurnMetric`).
- `seq` is monotonic per-session and shared with the other marker types (rewind/shrink/turn-metric) via `nextSeq`.
- The wrapper NEVER throws — returns `null` on any failure (fail-open discipline E13).
- All existing tests still pass; new tests pass; `tsc --noEmit` is clean.

## Why

- This is the foundational data-model + persistence layer for **G3 / marker retraction** (spec `08-edge-cases.md` E21; amends decision D6 "agent rewinds are permanent"). A mistaken `mulligan:rewind`/`mulligan:shrink` currently applies on every subsequent `context` fire for the rest of the session, and a `mulligan_rewind` of the issuing call does NOT retire it (markers are `custom` control entries outside the rewind's `hideEntryIds` span). Retraction fixes that.
- This task is PURELY the data model + the persistence wrapper. It does NOT wire the cancel into `readMarkers` (that is P3.M1.T2.S1), does NOT build the `mulligan_cancel` tool (P3.M1.T3.S1), does NOT update audit (P3.M1.T4.S1), and does NOT do stale-retirement (P3.M2.T3.S1). But ALL of those consume the exports from THIS task, so the interface here is the contract the rest of G3 builds on.
- Amends D6: agent markers are no longer irrevocably permanent — a mistaken marker becomes retractable. (Retraction suppresses the marker going forward only; it does NOT undo on-disk side effects D1/E5 or replay hidden content.)

## What

**User-visible behavior**: None directly — this is a foundational, non-runtime-input data-model change. An agent never calls `appendCancelMarker` itself; the `mulligan_cancel` tool (a sibling task) will. The observable effect lands when `readMarkers` drops cancelled markers (downstream).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. Extend `MulliganEnvelope.kind` to `"rewind" | "shrink" | "turn-metric" | "cancel"` (the closed union stays closed).
2. Add `interface CancelMarker extends MulliganEnvelope { kind: "cancel"; targetId: string; seq: number; ts: number }`.
   - `targetId` is the **uuid `id` field** of the rewind/shrink marker being cancelled (NOT the entry id — see "targetId semantics" below).
   - `CancelMarker` does NOT have its own `id` uuid field (like `TurnMetric` — a cancel is not itself cancellable).
3. Add `type CancelMarkerInput = Omit<CancelMarker, "schema" | "v" | "kind" | "seq" | "ts">` — i.e. exactly `{ targetId: string }`.
4. Add `appendCancelMarker(pi: ExtensionAPI, ctx: ExtensionContext, data: CancelMarkerInput): string | null` mirroring `appendShrinkMarker` EXACTLY, except: NO `id: randomUUID()` stamp; `kind: "cancel"`; `customType: "mulligan:cancel"`.

### Success Criteria
- [ ] `MulliganEnvelope.kind` union includes `"cancel"` (type-level; existing `expectTypeOf` test for the envelope will need its expected union updated).
- [ ] `CancelMarker` interface exported and extends the envelope with `kind: "cancel"`.
- [ ] `CancelMarker` has NO `id` field (asserted at the type level, mirroring the `TurnMetric` no-id test).
- [ ] `CancelMarkerInput` exported and equals `{ targetId: string }`.
- [ ] `appendCancelMarker` exported; calls `pi.appendEntry("mulligan:cancel", ...)` exactly once; returns `ctx.sessionManager.getLeafId()`.
- [ ] `appendCancelMarker` never throws (returns `null` on appendEntry/getSessionId/getLeafId failures).
- [ ] `seq` from `appendCancelMarker` participates in the shared per-session `nextSeq` sequence (a rewind=1, cancel=2 ordering holds).
- [ ] `spec/04-data-model.md` has a new cancel subsection after §5.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes** — provided they read `src/markers.ts` (the EXACT template file) and follow the four bullet-level requirements above. The wrapper is a near-verbatim clone of `appendShrinkMarker`/`appendTurnMetric` already in that file; the only deltas are (a) no uuid `id` stamp, (b) `kind: "cancel"`, (c) `customType: "mulligan:cancel"`, (d) the payload is `{ targetId }` rather than a marker body. The test fakes (`makePi()`/`makeCtx()`) already exist in `test/markers.test.ts` and are reused verbatim.

### Documentation & References

```yaml
# MUST READ — the EXACT template to clone (appendShrinkMarker + appendTurnMetric live here)
- file: src/markers.ts
  why: |
    This file defines MulliganEnvelope, RewindMarker/ShrinkMarker/TurnMarker interfaces,
    their *Input types, and the three append*Marker wrappers. appendShrinkMarker (stamps a uuid id)
    and appendTurnMetric (stamps NO id) are the two templates appendCancelMarker sits BETWEEN:
    clone appendShrinkMarker's structure, but drop the `id: randomUUID()` line (like appendTurnMetric).
  pattern: |
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: <Marker> = { ...data, schema: "pi-mulligan", v: 1, kind: "<kind>", seq, ts: Date.now() };
    pi.appendEntry("mulligan:<kind>", entry);
    return ctx.sessionManager.getLeafId();
    // whole body in try/catch -> return null
  gotcha: |
    appendShrinkMarker stamps `id: randomUUID()` (shrink/rewind markers are cancellable, so they
    need a stable uuid). appendTurnMetric does NOT (turn-metrics are never cancelled). CancelMarker
    is ALSO never cancelled, so appendCancelMarker must NOT stamp an `id` — mirror appendTurnMetric here.

# MUST READ — the contract for readMarkers (DOWNSTREAM, but it defines what targetId means)
- file: src/filter.ts
  why: |
    readMarkers (P3.M1.T2.S1, a SEPARATE task) will build cancelledIds from cancel markers'
    targetId values and drop rewinds/shrinks whose data.id is in that set. This confirms that
    targetId = the marker's uuid `id` field, NOT the entry id. Do NOT change filter.ts in THIS task.
  section: readMarkers + MarkersBundle (P3.M1.T2.S1 will modify these; this task must not)

# MUST READ — the exact test file to extend (fakes + assertion idioms live here)
- file: test/markers.test.ts
  why: |
    Reuse makePi() (captures appendEntry calls as {customType, data}) and makeCtx() (scripts
    getLeafId/getSessionId + throwOn* flags). The existing appendShrinkMarker / appendTurnMetric
    describe-blocks are the copy-template for the new appendCancelMarker tests.
    clearAll() in beforeEach/afterEach resets the shared runtime seq map.
  pattern: |
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendCancelMarker(pi, ctx, { targetId: "uuid-of-target" });
    expect(appended[0].customType).toBe("mulligan:cancel");
    expect(entry.kind).toBe("cancel");
    expect(entry.targetId).toBe("uuid-of-target");
    expect(entry).not.toHaveProperty("id");  // no id stamp — like TurnMetric
    expect(id).toBe("leaf-1");
  gotcha: |
    The MulliganEnvelope expectTypeOf test asserts kind is exactly "rewind"|"shrink"|"turn-metric".
    After extending the union to include "cancel", UPDATE that test's expected union or it fails.

# MUST UPDATE — the spec doc (Mode A: doc rides with the work)
- file: spec/04-data-model.md
  why: |
    Authoritative schemas. §1 MulliganEnvelope.kind union + the §1 customType table must include
    cancel. Add a new subsection immediately after §5 (Turn metric) documenting CancelMarker.
  section: §1 (envelope union + customType table) + new subsection after §5

# Architecture delta notes (already validated against the live code)
- docfile: plan/003_2c3b19ff6a7b/architecture/system_context.md
  why: Confirms current markers.ts state + the exact P3.M1.T1.S1 delta. States customType = "mulligan:cancel", no id needed on the marker.
  section: "markers.ts" + "P3 delta" bullets

- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  why: Pattern 1 gives the exact appendCancelMarker body. NOTE: that doc also explores an
        "entry id vs uuid id" ambiguity for targetId — RESOLVED by the work-item contract:
        targetId = the marker's uuid `id` field. Use that; ignore the entry-id alternative.
  section: "G3 / P3.M1 — Pattern 1"
```

### Current Codebase tree (relevant slice)

```bash
src/
  markers.ts          # <-- MODIFY: envelope.kind + CancelMarker + CancelMarkerInput + appendCancelMarker
  runtime.ts          # read-only dep: nextSeq(sessionId) (already exported, already imported by markers.ts)
  config.ts           # no change this task
  filter.ts           # no change this task (downstream P3.M1.T2.S1)
  tools/              # no change this task (downstream P3.M1.T3.S1)
test/
  markers.test.ts     # <-- MODIFY: add appendCancelMarker test blocks + update envelope union test
spec/
  04-data-model.md    # <-- MODIFY: envelope union + customType table + new cancel subsection
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/
  markers.ts          # EXTENDED in place (no new file). Exports: CancelMarker, CancelMarkerInput, appendCancelMarker
test/
  markers.test.ts     # EXTENDED in place. New describe blocks for appendCancelMarker + updated envelope union test
spec/
  04-data-model.md    # EXTENDED in place. New cancel subsection + union/table rows
# No new files are created. All changes are additive edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: appendCancelMarker must NOT stamp an `id` (uuid). rewind + shrink stamp one (they are cancellable);
// turn-metric + cancel stamp NONE (neither is itself cancellable). Mirror appendTurnMetric, NOT appendRewindMarker,
// on the id question. This is spec/04 GOTCHA #4 applied to a second marker type.

// CRITICAL: targetId is the marker's uuid `id` field (e.g. RewindMarker.id / ShrinkMarker.id), NOT the Pi entry id.
// readMarkers (downstream) drops markers whose data.id ∈ cancelledIds(targetIds). The wrapper does NOT validate that
// targetId exists on the branch — that is the mulligan_cancel TOOL's job (P3.M1.T3.S1). The wrapper just persists.

// CRITICAL: fail-open discipline (E13). The whole wrapper body is in try/catch → returns null on ANY failure
// (appendEntry throws, getSessionId throws, getLeafId throws OR returns null). NEVER rethrow. This module sits on
// the tool/event hot path.

// CRITICAL: C7 (spec/02-proven-constraints.md). pi.appendEntry returns void — capture the leaf id via
// ctx.sessionManager.getLeafId() IMMEDIATELY after appendEntry, same synchronous tick, before any other append.

// CRITICAL: nextSeq mutates a SHARED module-scoped runtime map (runtime.ts). Tests MUST clearAll() in
// beforeEach/afterEach (already done in test/markers.test.ts) so seq sequences can't leak between tests.

// GOTCHA: ctx.sessionManager is a ReadonlySessionManager (read-only; C1) — the wrapper only reads sessionId +
// leafId from it, and writes through `pi` (appendEntry). Do not attempt any write on ctx.sessionManager.

// GOTCHA: the envelope union is CLOSED. Adding "cancel" is the only place the union changes — the Pi-level
// customType "mulligan:cancel" is separate (that's the getEntries() filter key, distinct from data.kind).
```

## Implementation Blueprint

### Data models and structure

All types go in `src/markers.ts`. They reuse the existing `MulliganEnvelope` base and the existing `Omit<...>` *Input idiom.

```typescript
// 1. Extend the existing MulliganEnvelope.kind union (ONE edit on the existing interface):
export interface MulliganEnvelope {
  schema: "pi-mulligan";
  v: 1;
  kind: "rewind" | "shrink" | "turn-metric" | "cancel"; // <-- add "cancel"
}

// 2. New interface — place it in the markers region, after TurnMarker / TurnMetricInput.
//    NO `id` field (like TurnMarker). targetId = the uuid id of the rewind/shrink being cancelled.
export interface CancelMarker extends MulliganEnvelope {
  kind: "cancel";
  /** The uuid `id` field of the rewind/shrink marker being cancelled (NOT the entry id).
   *  readMarkers drops markers whose data.id ∈ the set of cancel targetIds. */
  targetId: string;
  seq: number;   // monotonic per-session counter (runtime.ts nextSeq), shared with rewind/shrink/turn-metric
  ts: number;    // Date.now() at append
}

// 3. New input type — the caller payload. Equals exactly { targetId: string }.
export type CancelMarkerInput = Omit<CancelMarker, "schema" | "v" | "kind" | "seq" | "ts">;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/markers.ts — extend MulliganEnvelope.kind union
  - EDIT: the existing `export interface MulliganEnvelope { ... }` block.
  - CHANGE: `kind: "rewind" | "shrink" | "turn-metric"` → `kind: "rewind" | "shrink" | "turn-metric" | "cancel"`.
  - WHY: closed union must include the new marker kind so CancelMarker extends it validly.
  - NAMING/PLACEMENT: in-place edit on the existing interface; do not move it.

Task 2: MODIFY src/markers.ts — add CancelMarker interface + CancelMarkerInput type
  - ADD: the two declarations shown in "Data models and structure" above.
  - PLACEMENT: in the markers region, after the TurnMarker / TurnMetricInput block (after §5 marker,
    before the "Wrappers" section comment). Keeps markers grouped and read top-to-bottom by kind.
  - FOLLOW pattern: TurnMarker (no-id marker) for the interface shape; TurnMetricInput for the Omit idiom.
  - GOTCHA: CancelMarker must NOT declare an `id` field. targetId is required (not optional).

Task 3: MODIFY src/markers.ts — add appendCancelMarker wrapper
  - ADD: the function below, placed in the "Wrappers" section, after appendTurnMetric and before NoteDetails.
  - FOLLOW pattern: appendShrinkMarker structurally; DROP the `id: randomUUID()` line (mirror appendTurnMetric).
  - NAMING: appendCancelMarker (matches appendRewindMarker/appendShrinkMarker/appendTurnMetric).
  - customType: "mulligan:cancel".  kind: "cancel".
  - DEPENDENCIES: imports randomUUID (already imported — but UNUSED by this wrapper; that is fine), nextSeq
    (already imported), ExtensionAPI/ExtensionContext (already imported).
  - RETURN: string | null. NEVER throws (try/catch → null).

  ```typescript
  export function appendCancelMarker(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    data: CancelMarkerInput,
  ): string | null {
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      const seq = nextSeq(sessionId);
      const entry: CancelMarker = {
        ...data,
        schema: "pi-mulligan",
        v: 1,
        kind: "cancel",
        seq,
        ts: Date.now(),
      };
      pi.appendEntry("mulligan:cancel", entry);
      return ctx.sessionManager.getLeafId();
    } catch {
      return null; // never throw on the tool/event hot path (E13)
    }
  }
  ```

Task 4: MODIFY test/markers.test.ts — add appendCancelMarker tests + fix the envelope union test
  - EDIT: the import block — add `appendCancelMarker`, `type CancelMarker`, `type CancelMarkerInput` to the
    existing `from "../src/markers.js"` import.
  - EDIT: the "MulliganEnvelope is { ... }" expectTypeOf test (in the `describe("types ...")` block) — its
    expected `kind` union MUST now be `"rewind" | "shrink" | "turn-metric" | "cancel"` or the type test fails.
  - ADD: a CANCEL_DATA const: `const CANCEL_DATA: CancelMarkerInput = { targetId: "target-uuid-123" };`
  - ADD: a describe block "appendCancelMarker — envelope + customType + payload" mirroring the shrink/turn-metric
    blocks: assert customType "mulligan:cancel", schema "pi-mulligan", v 1, kind "cancel", targetId carried
    verbatim, seq (first marker → 1), ts is a number ≤ Date.now(), returns "leaf-1".
  - ADD: to the "id stamping" describe block — a test that appendCancelMarker does NOT stamp an `id`
    (mirror the appendTurnMetric no-id test: `expect(entry).not.toHaveProperty("id")`).
  - ADD: a never-throws test: appendCancelMarker returns null and does not throw when appendEntry throws
    (makePi({ throwOnAppend: true })) and when getSessionId/getLeafId throw.
  - ADD: a leaf-null test: appendCancelMarker returns null when getLeafId() is null (makeCtx({ leafId: null })).
  - ADD (recommended): a seq-sharing test — append a rewind (seq 1) then a cancel (seq 2) in one session and
    assert both seqs, proving cancel participates in the shared nextSeq sequence.
  - ADD: type tests — CancelMarker.kind narrows to "cancel"; CancelMarkerInput equals { targetId: string };
    CancelMarker is assignable to MulliganEnvelope (the union extension from Task 1 makes this compile).
  - FOLLOW pattern: the existing appendShrinkMarker / appendTurnMetric describe blocks (idioms, fakes, clearAll).

Task 5: MODIFY spec/04-data-model.md — document the cancel marker (Mode A: rides with the work)
  - EDIT §1 (Versioning): add `"cancel"` to the MulliganEnvelope.kind union in the code block.
  - EDIT §1 customType table: add a row `| mulligan:cancel | custom | "cancel" | no |`.
  - ADD a new subsection immediately after §5 (Turn metric) and before §6 (Checkpoint). Title it
    "## 6. Marker: cancel (marker retraction)" and renumber the subsequent sections (Checkpoint → §7,
    Configuration → §8, In-memory state → §9, Logging → §10, Cross-references → §11).
    - ALTERNATIVE if renumbering cross-refs is too risky: insert as "## 5½. Marker: cancel (marker retraction)"
      to avoid touching §6+ numbers. Either is acceptable; pick one and be consistent. Before renumbering,
      grep the repo for `04-data-model.md §6`/`§7`/`§8`/`§9`/`§10` references and update them (most code
      comments reference §1/§3/§4/§5, which stay stable under either option).
  - CONTENT of the new subsection (adapt to the file's tone):
    - State it is stored via `pi.appendEntry("mulligan:cancel", data)`.
    - The `CancelMarker` TS interface (kind "cancel"; targetId: string = the uuid id of the cancelled
      rewind/shrink; seq; ts). State explicitly it carries NO `id` field (like turn-metric — a cancel is
      not itself cancellable).
    - Semantics: `readMarkers` builds a `cancelledIds` set from all cancel targetIds and drops any
      rewind/shrink whose `data.id` is in that set, BEFORE the filter sees it (forward reference to E21
      and to P3.M1.T2.S1). Retraction suppresses the marker going forward only — it does NOT undo on-disk
      side effects (D1/E5) or replay hidden content. Amends D6.
    - Reference `@08-edge-cases.md` E21 for the full retraction contract.
```

### Implementation Patterns & Key Details

```typescript
// The wrapper is a verbatim structural clone of appendShrinkMarker with two deltas:
//   (1) NO `id: randomUUID()` line  — cancel is not itself cancellable (mirror appendTurnMetric)
//   (2) kind: "cancel", customType: "mulligan:cancel"
// Everything else — getSessionId, nextSeq, the entry object, appendEntry, getLeafId, try/catch→null — is identical.

// targetId semantics (IMPORTANT — downstream contract):
//   targetId holds the uuid `id` field of the rewind/shrink being cancelled (RewindMarker.id / ShrinkMarker.id).
//   It is NOT the Pi entry id. The wrapper does not validate targetId exists — that is the tool's job.
//   readMarkers (P3.M1.T2.S1) will: collect mulligan:cancel entries → build cancelledIds:Set<string> from their
//   data.targetId → drop rewinds/shrinks whose data.id ∈ cancelledIds. This task only ships the data model +
//   the wrapper; the drop logic is a separate task.

// Test fake reuse (test/markers.test.ts already defines these — import nothing new):
//   makePi()       -> { appended: [{customType, data}], pi }
//   makeCtx(opts)  -> { ctx }  (opts.leafId defaults to "leaf-1"; opts.leafId:null tests the null return;
//                              opts.throwOnGetSessionId / throwOnGetLeafId / makePi throwOn* test never-throws)
```

### Integration Points

```yaml
TYPES (src/markers.ts):
  - extend: "MulliganEnvelope.kind union += 'cancel'"  (closed union; one-line edit)
  - add:    "CancelMarker, CancelMarkerInput, appendCancelMarker" (exported)

NO DATABASE / NO CONFIG / NO ROUTES / NO INDEX.TS CHANGES THIS TASK.
  - index.ts registration of makeCancelTool is a DIFFERENT task (P3.M1.T3.S1).
  - filter.ts readMarkers cancel-drop is a DIFFERENT task (P3.M1.T2.S1).
  - Do NOT touch filter.ts, tools/, config.ts, runtime.ts, or index.ts.

DOCS (spec/04-data-model.md):
  - §1: envelope kind union += "cancel"; customType table += mulligan:cancel row.
  - new subsection after §5 documenting CancelMarker (no id field; targetId = marker uuid id).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (no separate build script; tsc is a devDependency).
npx tsc --noEmit
# Expected: zero errors. If the envelope-union test in test/markers.test.ts wasn't updated, expect a type
# error there — fix the expected union to include "cancel" (Task 4).

# (No linter/formatter is configured in this repo — package.json has only "test" and "smoke" scripts.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the markers test file (fast feedback loop while iterating).
npx vitest run test/markers.test.ts

# Expected: all existing tests PASS (the only existing test that changes is the MulliganEnvelope union
# expectTypeOf, which Task 4 updates). New appendCancelMarker tests PASS.

# Then run the FULL suite to confirm no downstream regressions from the union extension.
npm test
# Expected: all green. The union extension is additive; existing consumers (filter.ts readMarkers casts,
# transforms.ts structural types) are unaffected because they don't narrow on "cancel".
```

### Level 3: Integration Testing (System Validation)

```bash
# This task adds no runtime integration (no tool registration, no event handler change), so there is no
# service to start or endpoint to hit. The integration smoke harness (test/integration/) is unaffected.
# If desired as a sanity check:
npm run smoke   # optional — should still pass unchanged (cancel marker isn't exercised by the smoke yet)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Type-level proof that the new marker slots into the envelope (run via vitest — the expectTypeOf tests):
#   - CancelMarker extends MulliganEnvelope and narrows kind to "cancel"
#   - CancelMarker is assignable to MulliganEnvelope (proves the union edit in Task 1 took effect)
#   - CancelMarker has NO `id` property (mirror of the TurnMetric no-id proof)
#   - CancelMarkerInput === { targetId: string } (Omit of the wrapper-stamped fields)
# These are asserted in the new/edited test blocks from Task 4. `npx vitest run test/markers.test.ts` covers them.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (including the updated envelope-union type test).
- [ ] `npx vitest run test/markers.test.ts` — all tests pass (existing + new).
- [ ] `npm test` — full suite green (no regressions from the union extension).

### Feature Validation
- [ ] `appendCancelMarker` calls `pi.appendEntry("mulligan:cancel", ...)` exactly once.
- [ ] Persisted entry is `{ schema:"pi-mulligan", v:1, kind:"cancel", targetId, seq, ts }` with NO `id` field.
- [ ] `seq` shares the per-session `nextSeq` counter with rewind/shrink/turn-metric.
- [ ] Returns the scripted leaf id; returns `null` when getLeafId is null / any method throws (never throws).
- [ ] `spec/04-data-model.md` §1 union + table updated; new cancel subsection added after §5.

### Code Quality Validation
- [ ] `appendCancelMarker` is a structural clone of `appendShrinkMarker`/`appendTurnMetric` (same shape, same comments style, same try/catch→null).
- [ ] New types are exported; placement matches the existing markers-region grouping.
- [ ] No changes outside `src/markers.ts`, `test/markers.test.ts`, `spec/04-data-model.md`.

### Documentation & Deployment
- [ ] JSDoc on `appendCancelMarker` mirrors the other wrappers (steps, fail-open note, customType, no-id note).
- [ ] `spec/04-data-model.md` cancel subsection states the no-`id` rule and the targetId = marker-uuid-id contract.

---

## Anti-Patterns to Avoid

- ❌ Do NOT stamp an `id: randomUUID()` on CancelMarker — it is not cancellable (mirror TurnMetric, not ShrinkMarker).
- ❌ Do NOT let `targetId` mean the entry id — the work-item contract fixes it as the marker's uuid `id` field. (The implementation_patterns.md doc floated an entry-id alternative; the item description overrides it.)
- ❌ Do NOT validate that `targetId` exists on the branch inside the wrapper — that is the `mulligan_cancel` tool's job (P3.M1.T3.S1). The wrapper is dumb persistence.
- ❌ Do NOT rethrow from the wrapper — fail-open (E13); swallow to `null`.
- ❌ Do NOT modify `filter.ts`, `tools/`, `index.ts`, `config.ts`, or `runtime.ts` — those are sibling/downstream tasks. This task is markers.ts + its test + the spec doc only.
- ❌ Do NOT forget to update the existing `MulliganEnvelope` `expectTypeOf` test — extending the union will break it until the expected union includes `"cancel"`.
- ❌ Do NOT create a new file — all changes are additive edits to existing files.

---

## Confidence Score

**9 / 10** — one-pass success is highly likely. The wrapper is a near-verbatim clone of two existing wrappers in the same file (appendShrinkMarker for structure, appendTurnMetric for the no-id rule), the test fakes already exist and are reused, and the contract is pinned to the letter by the work-item description. The only residual risk is the spec-doc subsection numbering choice (Task 5), which is cosmetic and recoverable.