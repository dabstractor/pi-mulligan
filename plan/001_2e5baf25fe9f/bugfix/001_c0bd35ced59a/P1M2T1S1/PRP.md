# PRP — P1.M2.T1.S1: Add `hideEntryIds` to marker type interfaces (`src/markers.ts` + `src/transforms.ts`)

**Work item:** P1.M2.T1.S1 · **Points:** 1 · **Bugfix:** BUG-001/BUG-002 data-model foundation (fix_design.md §Change 1)
**Scope:** **EDIT TWO source files** — add an OPTIONAL `hideEntryIds?: string[]` field to `RewindMarker`
(`src/markers.ts:54-73`) and to `RewindMarkerLike` (`src/transforms.ts:793-805`), each with a JSDoc comment.
`RewindMarkerInput` (`src/markers.ts:77`) gains the field **automatically** via its `Omit` derivation — **do NOT
edit it by hand**. Optionally add ONE type-level test to lock the contract. **No runtime/algorithm change; no new
files; no new deps; the field is optional and additive so all existing tests stay green.**

> This is the **data-model foundation** for the permanent-hiding fix. The CONSUMERS come later and are OUT OF
> SCOPE here: `captureHideEntryIds` (P1.M2.T3 populates it), `resolvePinnedHide` (P1.M2.T2 reads it), and the
> `filterPipeline` dispatch (P1.M2.T4 reads it via `readOwn(rw, "hideEntryIds")`).

---

## Goal

**Feature Goal**: Give the rewind marker data model a **typed, optional stable-anchor field** so the downstream
permanent-hiding fix can pin the entry IDs of the messages to hide AT MARKER-CREATION TIME, instead of
re-resolving a relative spec ("last tool group" / "last turn") against the constantly-growing message list every
context fire (the root cause of BUG-001/BUG-002). The field is OPTIONAL for backward compatibility: old markers
lack it → `filterPipeline` falls back to relative resolution; new markers populate it → permanent hiding.

**Deliverable** (two edits + optional test, no new files):
1. `src/markers.ts` — `RewindMarker` (lines 54-73): add `hideEntryIds?: string[]` (+ JSDoc) immediately after
   `excludeToolCallId?: string;`. `RewindMarkerInput` (line 77) is **unchanged** — the field auto-propagates via
   `Omit<RewindMarker, …>`.
2. `src/transforms.ts` — `RewindMarkerLike` (lines 793-805): add `hideEntryIds?: string[]` (+ JSDoc) immediately
   after `excludeToolCallId?: string;` (before `checkpoint?: string;`).
3. *(Recommended)* `test/markers.test.ts` — ONE type-level assertion that `hideEntryIds` is `string[] | undefined`
   on `RewindMarkerInput`, present-or-absent both valid (backward-compat proof).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (the optional field is type-sound under `strict`).
- `npm test` (or `npx vitest run`) is **fully green** — all 671+ existing tests still pass (the field is
  optional + additive; nothing reads it yet).
- `grep -n "hideEntryIds" src/markers.ts src/transforms.ts` shows the field in **both** files.
- `RewindMarkerInput` was NOT hand-edited (it gains the field via `Omit`).

---

## User Persona

**Target User**: The implementing AI agents for the three downstream permanent-hiding subtasks:
- **P1.M2.T3** (`captureHideEntryIds`) — writes `data.hideEntryIds = [...]` into a `RewindMarkerInput`.
- **P1.M2.T2** (`resolvePinnedHide`) — receives `hideEntryIds: string[]` as an argument.
- **P1.M2.T4** (`filterPipeline`) — reads `readOwn(rw, "hideEntryIds")` off a `RewindMarkerLike`.

**Use Case**: Without a typed field, those tasks would either (a) persist `hideEntryIds` untyped via the spread
(the fragile `checkpoint` precedent — see GOTCHA #1 in `src/tools/rewind.ts`), or (b) need `as any` casts. This
task makes the field first-class across all three type surfaces so the writers/readers are fully type-safe.

**Pain Points Addressed**: Today `checkpoint` rides the spread **without** being in the frozen `RewindMarker`/
`RewindMarkerInput` types — it works at runtime but is invisible to the type system (a footgun: a typo'd field
name would silently no-op). `hideEntryIds` is the critical permanent-hiding anchor; it deserves a real typed
field, not a repeat of that fragility.

---

## Why

- **Foundation for the actual fix.** BUG-001 (last_tool_call_group leak-back) and BUG-002 (last_turn infinite
  loop) both stem from relative-spec re-resolution. The agreed fix (PRD §Recommendations, fix_design.md) is to
  **pin stable entry IDs at marker-creation time**. That requires the marker to CARRY those IDs — which requires
  this typed field to exist first.
- **Backward-compatible by construction.** `optional` means: old persisted markers (created before this fix)
  deserialize without `hideEntryIds` → `readOwn` returns `undefined` → legacy relative resolution runs. No
  migration; no broken sessions.
- **Type safety > runtime luck.** The `checkpoint` precedent proves the spread mechanism carries extra fields,
  but doing that for the *primary* permanent-hiding anchor would repeat a known footgun. Adding the field to the
  types is a one-time, ~10-line, zero-risk investment that de-risks three downstream tasks.
- **Cheapest possible change.** Two interface edits + JSDoc. No logic, no signature change, no new file, no dep.

---

## What

Make exactly **two** `edit`-tool edits (one per file), each inserting a JSDoc'd optional `hideEntryIds?: string[]`
field. `RewindMarkerInput` requires **no edit** (Omit-derivation — see *The Omit-propagation insight*). Then run
the gates; all existing tests must stay green. Optionally add one type-level test.

### Success Criteria

- [ ] `RewindMarker` (`src/markers.ts`) has `hideEntryIds?: string[]` with the JSDoc (verbatim from Task 1).
- [ ] `RewindMarkerLike` (`src/transforms.ts`) has `hideEntryIds?: string[]` with the JSDoc (verbatim from Task 2).
- [ ] `RewindMarkerInput` (`src/markers.ts:77`) was **NOT** hand-edited — it is still the single `Omit<…>` line.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` (or `npm test`) is fully green — **zero** regressions (field is optional + unread yet).
- [ ] `src/transforms.ts` still has **0 imports** (adding a field to an interface cannot add an import; verify).
- [ ] *(Optional)* one type-level test in `test/markers.test.ts` asserts `hideEntryIds` is `string[] | undefined`.
- [ ] You did **NOT** touch `resolveCheckpoint` / `filterPipeline` / `appendRewindMarker` / `rewind.ts` (out of scope —
      those belong to P1.M1.T3.S1 / P1.M2.T2 / P1.M2.T3 / P1.M2.T4).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `oldText`/`newText` for both edits is given verbatim below (Task 1 / Task
> 2). The one non-obvious fact — that `RewindMarkerInput = Omit<RewindMarker, …>` auto-propagates the new field,
> so it needs NO edit — is documented with evidence. The precedent (`checkpoint` rides the spread untyped) and the
> spread site (`appendRewindMarker`'s `{ ...data, … }`) are both quoted. The parallel-task boundary
> (P1.M1.T3.S1 edits `resolveCheckpoint` in the same file, ~340 lines away) is called out. No prior knowledge
> beyond "tsc + vitest pass on the current tree" is required.

### Scope decision (READ BEFORE CODING)

- **Do NOT hand-edit `RewindMarkerInput`.** It is `Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts">`.
  `hideEntryIds` is NOT in the Omit list, so adding it to `RewindMarker` propagates it automatically. Editing it
  by hand is redundant (and would be the only place the field could drift). See *The Omit-propagation insight*.
- **Do NOT implement capture / resolve / dispatch.** `captureHideEntryIds` (P1.M2.T3), `resolvePinnedHide`
  (P1.M2.T2), and the `filterPipeline` dispatch (P1.M2.T4) all consume this field — they are separate subtasks.
  This task ONLY adds the type field.
- **Do NOT touch `resolveCheckpoint`.** P1.M1.T3.S1 is editing it RIGHT NOW in `src/transforms.ts:450-526`. Your
  edit is in `RewindMarkerLike` (`src/transforms.ts:793-805`) — a disjoint region. Stay in your lane to avoid a
  merge conflict.
- **Do NOT change `appendRewindMarker`.** Its `{ ...data, ...envelope }` spread (markers.ts:166-176) ALREADY
  persists any field present in `data`. Once the field is typed, it flows through unchanged.

### The Omit-propagation insight (the one non-obvious fact — read this)

```ts
// src/markers.ts:77 — UNCHANGED by this task
export type RewindMarkerInput = Omit<RewindMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;
```
`RewindMarkerInput` is `RewindMarker` **minus the envelope/id/seq/ts fields the wrapper stamps on**.
`hideEntryIds` is a caller-supplied targeting field, NOT an envelope field, so it is **not omitted** → it appears
in `RewindMarkerInput` the moment you add it to `RewindMarker`. **This is correct and intended** (the rewind tool
will populate it via `data.hideEntryIds` in P1.M2.T3, and the spread in `appendRewindMarker` persists it). Verify
after Task 1 with: `npx tsc --noEmit` (a `RewindMarkerInput` literal omitting `hideEntryIds` must still compile →
backward compat; one including it must also compile → forward path).

### Documentation & References

```yaml
# MUST READ — authoritative sources for this change
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md
  section: "Change 1: RewindMarker gains hideEntryIds field"
  why: "THE design doc for this exact change. Quotes the field, the JSDoc intent, and the additive/backward-compat
        impact. Change 1 is the ONLY part in scope here (Changes 2-5 are downstream tasks)."
  critical: "hideEntryIds is OPTIONAL — 'Absent (old markers) → falls back to relative re-resolution.' Do NOT make
        it required; that would break deserialization of pre-fix markers."

- file: src/markers.ts
  section: "RewindMarker interface (lines 54-73) + RewindMarkerInput (line 77) + appendRewindMarker (161-189)"
  why: "RewindMarker is the FROZEN persisted shape (spec/04 §3); RewindMarkerInput is its Omit-derived caller
        payload; appendRewindMarker spreads {...data, ...envelope} so any field in data is persisted."
  pattern: "Add hideEntryIds as an OPTIONAL field + JSDoc, exactly like the existing excludeToolCallId?: string."
  gotcha: "RewindMarkerInput needs NO edit (Omit-propagation). appendRewindMarker needs NO edit (spread carries it)."

- file: src/transforms.ts
  section: "RewindMarkerLike interface (lines 793-805)"
  why: "The structural slice filterPipeline READS. Declared LOCALLY so transforms.ts stays Pi-FREE (0 imports). A
        real RewindMarker assigns in with NO cast. checkpoint?: string (line 825) is the precedent field."
  pattern: "Add hideEntryIds?: string[] + JSDoc, mirroring checkpoint?: string's optional+readOwn-read style."
  gotcha: "transforms.ts MUST stay 0-import. Adding an interface field cannot add an import — verify with grep."

- file: src/tools/rewind.ts
  section: "CRITICAL GOTCHA #1 (header JSDoc) — checkpoint rides the spread WITHOUT being in the frozen type"
  why: "Explains WHY hideEntryIds is being added to the types properly (to avoid repeating checkpoint's untyped-
        via-spread footgun for the PRIMARY permanent-hiding anchor). Read for motivation; do NOT edit this file."

- file: test/markers.test.ts
  section: "REWIND_DATA fixture (lines 117-130) + type-level expectTypeOf (line 435)"
  why: "REWIND_DATA: RewindMarkerInput OMITS hideEntryIds today → after Task 1 it still compiles (proves backward
        compat). The optional type-level test (Task 3) reuses this fixture."
  pattern: "Mirror the existing expectTypeOf<...>() convention for the new field assertion."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M1T3S1/PRP.md
  why: "The parallel in-flight task. It edits resolveCheckpoint (transforms.ts:450-526) + 3 transforms tests. My
        edit (RewindMarkerLike, transforms.ts:793-805) is ~340 lines away — disjoint. Do NOT touch resolveCheckpoint."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T1S1/research/codebase_recon.md
  why: "First-hand recon: exact current line numbers, the Omit-propagation proof, the spread site, the checkpoint
        precedent, the parallel-task boundary, baseline tsc/vitest state (176 markers+transforms tests green)."

# AUTHORITATIVE field definition (implement EXACTLY this on both interfaces):
#   /** <see JSDoc in Task 1 / Task 2> */
#   hideEntryIds?: string[];
# - OPTIONAL (backward compat with pre-fix persisted markers).
# - string[] of stable Pi session ENTRY ids (NOT message indices — indices shift on compaction; ids don't).
# - Written by captureHideEntryIds (P1.M2.T3); read by resolvePinnedHide (P1.M2.T2) via filterPipeline readOwn (P1.M2.T4).
```

### Current Codebase tree (state at this subtask's start — verified live)

```bash
pi-mulligan/
├── package.json            # type:'module'; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── markers.ts          # EDIT: RewindMarker (54-73) +hideEntryIds. RewindMarkerInput (77) NO-EDIT (Omit).
│   ├── transforms.ts       # EDIT: RewindMarkerLike (793-805) +hideEntryIds. (resolveCheckpoint 450-526 = P1.M1.T3.S1, parallel — DO NOT TOUCH.)
│   ├── tools/rewind.ts     # READ-ONLY (GOTCHA #1 motivation; P1.M2.T3 will populate hideEntryIds here).
│   ├── filter.ts / nudges.ts / config.ts / log.ts / runtime.ts / tokens.ts / ledger.ts / notes.ts / index.ts  # untouched
│   └── ...
├── test/
│   ├── markers.test.ts     # OPTIONAL +1 type-level test (Task 3); REWIND_DATA fixture at lines 117-130.
│   ├── transforms.test.ts  # untouched (P1.M1.T3.S1 edits the resolveCheckpoint tests here, not us).
│   └── ...
└── plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md  # §Change 1 = authoritative
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0;
#   `npx vitest run test/markers.test.ts test/transforms.test.ts` → 176 passed (markers 42 + transforms 134).
```

### Desired Codebase tree with files to be changed (THIS subtask)

```bash
pi-mulligan/
├── src/
│   ├── markers.ts          # +1 optional field on RewindMarker (+ JSDoc). RewindMarkerInput unchanged.
│   └── transforms.ts       # +1 optional field on RewindMarkerLike (+ JSDoc).
└── test/
    └── markers.test.ts     # (optional) +1 type-level assertion.
# No new files. No new deps. No package.json change. No spec-doc change (P1.M4 owns spec sync).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — RewindMarkerInput needs NO edit. It is Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts">
# (markers.ts:77). hideEntryIds is NOT omitted → adding it to RewindMarker propagates it to RewindMarkerInput
# automatically. Hand-editing RewindMarkerInput is redundant AND the only place the field could drift. DON'T.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 — The field MUST be OPTIONAL (hideEntryIds?: string[]). Pre-fix persisted markers lack it; making it
# required breaks their deserialization + breaks RewindMarkerInput literals that omit it (e.g. REWIND_DATA in
# markers.test.ts:117). Backward compat = optional + readOwn-read (undefined → legacy fallback). (fix_design.md §Change 1.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — transforms.ts MUST stay Pi-FREE (0 imports). RewindMarkerLike is declared LOCALLY (structurally
# identical to markers.ts's RewindMarker) precisely so transforms.ts doesn't import markers.ts (which pulls in Pi).
# Adding an interface field CANNOT add an import — verify after: `grep -cE '^import|^from' src/transforms.ts` is unchanged.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — Parallel task P1.M1.T3.S1 edits resolveCheckpoint (transforms.ts:450-526) RIGHT NOW. Your edit is in
# RewindMarkerLike (transforms.ts:793-805) — disjoint. Edit ONLY the interface; do NOT touch resolveCheckpoint or its
# tests, or you'll collide with the in-flight task.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — appendRewindMarker's { ...data, ...envelope } spread (markers.ts:166-176) ALREADY persists any field in
# data. Once hideEntryIds is typed on RewindMarkerInput, a caller passing it gets it persisted with NO wrapper change.
# Do NOT edit appendRewindMarker. (P1.M2.T3 is the task that starts POPULATING data.hideEntryIds; this task only types it.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — hideEntryIds holds ENTRY ids (stable), NOT message indices (shift on compaction). The JSDoc must say
# "entry IDs" explicitly so downstream implementers don't store indices. (fix_design.md: "Pi session entries have
# permanent, stable id fields.")
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// The single new field, added to RewindMarker (markers.ts) AND RewindMarkerLike (transforms.ts):
/** Stable entry IDs of the messages to hide, pinned at marker-creation time (fix_design.md §Change 1).
 *  filterPipeline resolves these IDs → current message indices via resolvePinnedHide and removes them
 *  (permanent hiding across session growth — fixes BUG-001/BUG-002). Absent (old markers, or capture failure)
 *  → falls back to granularity-based relative re-resolution. OPTIONAL for backward compatibility. */
hideEntryIds?: string[];

// RewindMarkerInput (markers.ts:77) gains this field AUTOMATICALLY — it is Omit<RewindMarker, …> and
// hideEntryIds is not in the Omit list. NO hand-edit.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json            # expect exit 0
  - RUN: npx vitest run test/markers.test.ts test/transforms.test.ts   # expect 176 passed
  - RUN: grep -n "hideEntryIds" src/markers.ts src/transforms.ts       # expect NO matches (we are ADDING it)

Task 1: EDIT src/markers.ts — add hideEntryIds to RewindMarker (exact oldText/newText below)
  - FIND: the RewindMarker interface (export interface RewindMarker extends MulliganEnvelope { ... }), specifically
    the `excludeToolCallId?: string;` line + its JSDoc (unique anchor in this file).
  - INSERT: the JSDoc'd `hideEntryIds?: string[];` field immediately AFTER `excludeToolCallId?: string;`.
  - DO NOT EDIT RewindMarkerInput (line 77) — it is Omit<RewindMarker,…> and auto-propagates (GOTCHA #1).
  - DO NOT EDIT appendRewindMarker — the spread already persists it (GOTCHA #5).

Task 2: EDIT src/transforms.ts — add hideEntryIds to RewindMarkerLike (exact oldText/newText below)
  - FIND: the RewindMarkerLike interface (export interface RewindMarkerLike { ... }), specifically its
    `excludeToolCallId?: string;` line + its (different) JSDoc (unique anchor in this file).
  - INSERT: the JSDoc'd `hideEntryIds?: string[];` field immediately AFTER `excludeToolCallId?: string;`
    (i.e. BEFORE `checkpoint?: string;`).
  - DO NOT touch resolveCheckpoint (450-526) — that is P1.M1.T3.S1's in-flight scope (GOTCHA #4).
  - VERIFY transforms.ts still has 0 imports after the edit (GOTCHA #3).

Task 3 (OPTIONAL, recommended): ADD one type-level test to test/markers.test.ts (exact content below)
  - LOCKS the contract for the 3 downstream consumers and proves backward-compat (omitted = valid).
  - If the team prefers to keep this task to the bare minimum (interface + JSDoc), SKIP this — it is not required
    by the work-item contract ("Run existing tests — they should all pass"). But it is cheap and de-risks T2/T3/T4.

Task 4: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + grep gates) and Level 2 (full vitest run). Levels 3/4 are N/A (no runtime/Pi change).
```

#### Exact edit — `src/markers.ts` (Task 1 — `edit` tool, single replacement)

**oldText** (unique anchor in markers.ts — the JSDoc + the `excludeToolCallId` line inside `RewindMarker`):
```
  /** toolCallId of THIS rewind's own tool call, so the filter excludes it resolving "last tool-call group" (spec/06 §3). */
  excludeToolCallId?: string;
```
**newText**:
```
  /** toolCallId of THIS rewind's own tool call, so the filter excludes it resolving "last tool-call group" (spec/06 §3). */
  excludeToolCallId?: string;
  /**
   * Stable entry IDs of the messages to hide, pinned at marker-creation time (fix_design.md §Change 1). When present,
   * filterPipeline resolves these IDs → current message indices via resolvePinnedHide and removes them — permanent
   * hiding across session growth (fixes BUG-001/BUG-002; root cause: relative specs re-target onto new work). Absent
   * (old markers, or when capture failed) → filterPipeline falls back to granularity-based relative re-resolution.
   * OPTIONAL for backward compatibility. Holds ENTRY ids (stable), NOT message indices (which shift on compaction).
   * Populated by captureHideEntryIds (P1.M2.T3); read by filterPipeline via readOwn(rw,"hideEntryIds") (P1.M2.T4).
   */
  hideEntryIds?: string[];
```

#### Exact edit — `src/transforms.ts` (Task 2 — `edit` tool, single replacement)

**oldText** (unique anchor in transforms.ts — the JSDoc + the `excludeToolCallId` line inside `RewindMarkerLike`):
```
  /** toolCallId of THIS rewind's own tool call (filter skips its group for last_tool_call_group; keeps its unit for
   *  last_turn/checkpoint). Absent/empty/non-string → not skipped/kept. */
  excludeToolCallId?: string;
```
**newText**:
```
  /** toolCallId of THIS rewind's own tool call (filter skips its group for last_tool_call_group; keeps its unit for
   *  last_turn/checkpoint). Absent/empty/non-string → not skipped/kept. */
  excludeToolCallId?: string;
  /**
   * Stable entry IDs of the messages to hide, pinned at marker-creation time (fix_design.md §Change 1). filterPipeline
   * dispatches on this FIRST: when it is a non-empty array, resolvePinnedHide maps the IDs → current message indices
   * and removes them (permanent hiding across session growth — fixes BUG-001/BUG-002). Absent/empty (old markers, or
   * capture failure) → falls back to granularity-based relative re-resolution (backward compat). Read defensively via
   * readOwn(rw,"hideEntryIds"). OPTIONAL. Holds ENTRY ids (stable), NOT message indices (which shift on compaction).
   */
  hideEntryIds?: string[];
```

#### Exact content — `test/markers.test.ts` (Task 3, OPTIONAL — add inside the existing rewind describe block)

```ts
// Add to the existing rewind-marker describe block. Reuses the REWIND_DATA fixture (markers.test.ts:117-130),
// which OMITS hideEntryIds — so assigning it unchanged already proves backward-compat (omitted = valid).
it("RewindMarker/RewindMarkerInput carry optional hideEntryIds (fix_design.md §Change 1; backward-compat)", () => {
  // RewindMarkerInput is Omit<RewindMarker,…> → hideEntryIds propagates from RewindMarker. Omitted is valid:
  const withoutHide: RewindMarkerInput = REWIND_DATA; // already omits hideEntryIds → compiles (old markers)
  // …and present is valid (new markers):
  const withHide: RewindMarkerInput = { ...REWIND_DATA, hideEntryIds: ["e1", "e2"] };
  expectTypeOf(withHide.hideEntryIds).toEqualTypeOf<string[] | undefined>();
  expectTypeOf(withoutHide.hideEntryIds).toEqualTypeOf<string[] | undefined>();
});
```
*(Ensure `RewindMarkerInput` is already imported at the top of markers.test.ts — it is, per line 117.)*

### Implementation Patterns & Key Details

```ts
// PATTERN: optional targeting field read defensively via readOwn — identical style to the existing checkpoint?:
// string field (transforms.ts RewindMarkerLike). filterPipeline already does readOwn(rw,"checkpoint"); the
// downstream P1.M2.T4 will add readOwn(rw,"hideEntryIds") the same way. This task only types the field.

// PATTERN: the spread persists it. appendRewindMarker (markers.ts:166) builds:
//   const entry: RewindMarker = { ...data /* RewindMarkerInput */, schema, v, kind, id, seq, ts };
// …so any field in data (including hideEntryIds once populated by P1.M2.T3) is persisted with NO wrapper change.

// GOTCHA #1: RewindMarkerInput = Omit<RewindMarker, …> → hideEntryIds auto-propagates. NO hand-edit.
// GOTCHA #2: OPTIONAL (?:) — required would break pre-fix marker deserialization + the REWIND_DATA fixture.
// GOTCHA #6: ENTRY ids, NOT message indices — say so in the JSDoc (indices shift on compaction; ids don't).
```

### Integration Points

```yaml
DATA MODEL (this task):
  - src/markers.ts:        RewindMarker +hideEntryIds?: string[]   (RewindMarkerInput auto-propagates via Omit)
  - src/transforms.ts:     RewindMarkerLike +hideEntryIds?: string[]

DOWNSTREAM CONSUMERS (LATER subtasks — do NOT implement here):
  - P1.M2.T2 (resolvePinnedHide, transforms.ts):        fn arg hideEntryIds: string[]
  - P1.M2.T3 (captureHideEntryIds, rewind.ts/markers.ts): writes data.hideEntryIds = [...]
  - P1.M2.T4 (filterPipeline, transforms.ts):           readOwn(rw,"hideEntryIds") → resolvePinnedHide else legacy

NO DATABASE / NO ROUTES / NO CONFIG / NO NEW DEPS — purely an additive TypeScript interface field. Nothing is
added to package.json. No spec-doc change (P1.M4.T1 owns spec/06 sync). No Pi handle touched.
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Task 1 + Task 2)

```bash
# Type-check the whole project (the optional field must be type-sound under strict):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# The field exists in BOTH files:
grep -n "hideEntryIds" src/markers.ts src/transforms.ts   # expect ≥1 hit in EACH file
# RewindMarkerInput was NOT hand-edited (still a single Omit line):
grep -cE 'hideEntryIds' <<< "$(sed -n '77p' src/markers.ts)"   # expect 0 (line 77 is the Omit alias, untouched)
# transforms.ts still Pi-FREE (0 imports — GOTCHA #3):
grep -cE '^import|^from' src/transforms.ts   # unchanged from baseline (compare against pre-edit count)

# Expected: tsc exit 0; hideEntryIds present in both files; RewindMarkerInput line untouched; transforms imports unchanged.
```

### Level 2: Unit tests (run after all edits)

```bash
# The two directly-relevant suites:
npx vitest run test/markers.test.ts test/transforms.test.ts   # MUST be all-green (176 tests)

# Full regression — the field is optional + unread, so NOTHING should change:
npx vitest run                                                  # MUST be all-green (671+ tests, zero regressions)

# Expected: every test green. If ANY test fails, you almost certainly edited something out of scope
# (e.g. resolveCheckpoint, or made the field required) — revert and re-read the Scope decision.
```

### Level 3: Integration / runtime (N/A for this change)

This task adds a **type field only** — no runtime behavior, no Pi handler, no algorithm. Nothing reads
`hideEntryIds` yet (the readers are P1.M2.T2/T4). Real integration (permanent hiding across session growth) is
exercised by P1.M3 regression tests once the consumers land. Nothing to run here.

### Level 4: Creative / domain-specific validation (optional type-proof)

```bash
# Optional: hand-proof the Omit-propagation + backward-compat with a throwaway tsc check:
cat > /tmp/hide_check.ts <<'EOF'
import type { RewindMarker, RewindMarkerInput } from "./src/markers.js";
const a: RewindMarkerInput = { granularity: "last_turn" } as RewindMarkerInput; // omits hideEntryIds (old marker)
const b: RewindMarkerInput = { ...(a as object), hideEntryIds: ["e1"] } as RewindMarkerInput; // new marker
const _t1: string[] | undefined = a.hideEntryIds;
const _t2: string[] | undefined = b.hideEntryIds;
EOF
npx tsc --noEmit --strict --moduleResolution Bundler --module ESNext --target ES2022 /tmp/hide_check.ts && echo "TYPE-OK"
# Expected: TYPE-OK (both omitted and present are valid; field is string[] | undefined). Delete /tmp/hide_check.ts after.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is fully green (zero regressions — field is optional + unread).
- [ ] `hideEntryIds` present in BOTH `src/markers.ts` (RewindMarker) and `src/transforms.ts` (RewindMarkerLike).
- [ ] `RewindMarkerInput` (markers.ts:77) NOT hand-edited (still the single `Omit<…>` line).
- [ ] `src/transforms.ts` import count unchanged (still Pi-FREE / 0 imports).

### Feature Validation

- [ ] Field is **optional** (`hideEntryIds?: string[]`) in both interfaces — required would break old markers.
- [ ] JSDoc on both interfaces documents: pinned at creation time; resolvePinnedHide resolves IDs→indices; absent →
      legacy fallback; holds ENTRY ids not indices.
- [ ] No existing test breaks (rewind/transform/filter/edge-case suites all green).
- [ ] You did NOT touch `resolveCheckpoint`, `filterPipeline`, `appendRewindMarker`, or `rewind.ts` (out of scope).

### Code Quality Validation

- [ ] Follows the existing optional-field style (`excludeToolCallId?: string`, `checkpoint?: string`).
- [ ] Edits are minimal and additive (one field + JSDoc per interface).
- [ ] Anti-patterns avoided (see below — no required field, no hand-edit of the Omit alias, no out-of-scope edits).
- [ ] No new dependencies; no package.json change.

### Documentation & Deployment

- [ ] JSDoc on `RewindMarker` and `RewindMarkerLike` explains `hideEntryIds` (Mode A — docs ride with the work).
- [ ] No spec-doc change required here (P1.M4.T1 owns the spec/06 idempotency/resolver sync).
- [ ] No new environment variables (none needed).

---

## Anti-Patterns to Avoid

- ❌ **Making `hideEntryIds` required** — breaks deserialization of pre-fix markers + the `REWIND_DATA` fixture. It is OPTIONAL (GOTCHA #2).
- ❌ **Hand-editing `RewindMarkerInput`** — it is `Omit<RewindMarker, …>`; the field auto-propagates. Hand-editing is redundant and the only place drift could creep in (GOTCHA #1).
- ❌ **Editing `appendRewindMarker`** — its `{ ...data, … }` spread already persists the field; no wrapper change needed (GOTCHA #5).
- ❌ **Touching `resolveCheckpoint` / its tests** — that is P1.M1.T3.S1's in-flight scope in the same file (GOTCHA #4).
- ❌ **Implementing `resolvePinnedHide` / `captureHideEntryIds` / the dispatch here** — those are P1.M2.T2/T3/T4. This task is types only.
- ❌ **Storing message indices instead of entry ids** — indices shift on compaction; the JSDoc must say "entry IDs" (GOTCHA #6).
- ❌ **Adding an import to transforms.ts** — it must stay Pi-FREE / 0 imports. An interface field can't add one, but verify (GOTCHA #3).
- ❌ **Skipping the full `vitest run`** — "the field is optional, it can't break anything" is exactly the assumption that lets an out-of-scope edit slip through. Run the whole suite.