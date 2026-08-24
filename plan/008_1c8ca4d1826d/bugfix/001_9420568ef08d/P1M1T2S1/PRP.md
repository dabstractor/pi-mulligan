# PRP — P1.M1.T2.S1: Add `prevRewindNoteAtLatestPrompt` pure helper (cancel-aware, same-prompt slice) + fixtures

## Goal

**Feature Goal**: Deliver the read-side primitive for BUG-002 (E22 identical-note advisory, spec/08-edge-cases.md E22 SHOULD): an EXPORTED pure helper in `src/tools/rewind.ts` — `prevRewindNoteAtLatestPrompt(ctx): string | null` — that returns the previous same-prompt rewind's normalized `note.what_happened`, so P1.M1.T2.S2 can compare it against the CURRENT call's note and append the spec-verbatim advisory. Plus the test fixture `rewindEntryWithNote(seq, whatHappened)` the existing fixture set lacks, and green unit tests for the helper.

**Deliverable**: exported `prevRewindNoteAtLatestPrompt` in `src/tools/rewind.ts`; new `rewindEntryWithNote` fixture + unit tests in `test/tools/rewind.test.ts` (consuming it via the existing `makeCtx`/`run`-adjacent harness). NO wiring into `rewindExecute` — that is S2.

**Success Definition**: helper returns the LAST surviving (non-cancelled) rewind marker's `data.note.what_happened` normalized via `trim().toLowerCase()`, restricted to entries AFTER the last user-message entry; `null` when there is no user prompt, no surviving rewind in the slice, or the surviving marker lacks a readable note; never throws; `npm test` green; `npx tsc --noEmit` clean.

## Why

Spec/08 E22 (SHOULD): "if two consecutive rewinds re-land at the same prompt with substantively identical notes (same `what_happened` after trim/lowercase — which now includes the avoid/lesson), the success text for the second one SHOULD append" the identical-note warning. The MUST-level backstops (maxRetriesPerPrompt, abortContextFraction) exist and are tested; the missing advisory costs the agent up to (budget-1) wasted re-attempts. No new persistent state is needed — every `mulligan:rewind` marker already persists its raw `NoteInput` in `data.note` (src/markers.ts RewindMarker). This subtask isolates the pure read so S2's text-wiring is a one-line comparison.

## What

1. **Exported helper** in `src/tools/rewind.ts` (place immediately AFTER `countRetriesAtLatestPrompt`, ~line 341, mirroring its exact structure):

   ```ts
   export function prevRewindNoteAtLatestPrompt(ctx: ExtensionContext): string | null
   ```

   Algorithm — a structural sibling of `countRetriesAtLatestPrompt` (rewind.ts:283-340), reusing its exact defensive patterns:
   - `try { entries = ctx.sessionManager.getEntries() } catch { return null }` — never throw (E13).
   - Non-array `entries` → null.
   - Find `latestPromptIndex` = LAST index where `type === "message" && message?.role === "user"` (same per-entry try/catch + structural cast `{ type?: unknown; message?: { role?: unknown } }` as countRetriesAtLatestPrompt). Not found (-1) → null (no user prompt → nothing to compare against).
   - **Cancel-exclusion (BUG-005 pattern, rewind.ts:313-322)**: scan the post-prompt slice (`latestPromptIndex + 1` .. end) for `type === "custom" && customType === "mulligan:cancel"` entries; collect non-string/empty-skipped `data.targetId`s into a `cancelledRewindIds` Set.
   - Walk the SAME post-prompt slice; for each `customType === "mulligan:rewind"` entry whose `data.id` is a string NOT in `cancelledRewindIds` (unreadable/absent `data.id` → the marker is NOT excluded — keep, matching the "never exclude on bad data" polarity), record `data.note?.what_happened` when it is a string. Keep the LAST such surviving marker's value.
   - Return `lastWhatHappened.trim().toLowerCase()`, or null when no surviving rewind had a readable note (`typeof !== "string"` → treat as absent; an empty/whitespace note still normalizes to `""` and IS returned — S2's equality comparison handles it; do NOT over-filter here).
   - Note: within a single slice the LAST surviving marker in entry order is the "previous rewind" relative to the CURRENT call (whose marker is appended only later, after this helper runs).
   - JSDoc: module-doc style matching neighbors; cite spec/08 E22 "substantively identical = same what_happened after trim().toLowerCase()" (what_happened already absorbs avoid/lesson per the v1.2 note-merge — one field suffices); cite BUG-005 cancel-exclusion; EXPORTED for S2 + tests (first export in this helpers cluster — module-local siblings stay module-local).

2. **New fixture** in `test/tools/rewind.test.ts` (next to `rewindEntryWithId`, ~line 211):

   ```ts
   /** A rewind marker entry WITH a data.note (for the E22 identical-note advisory tests — the existing
    *  rewindEntry/rewindEntryWithId fixtures carry no note; production markers always persist NoteInput). */
   function rewindEntryWithNote(seq: number, whatHappened: string, id = `rw-${seq}`) {
     return { type: "custom", customType: "mulligan:rewind",
       data: { seq, id, kind: "rewind", note: { what_happened: whatHappened } } };
   }
   ```
   (Typing: follow `rewindEntryWithId`'s inline-return-type style. `note` here is a partial NoteInput — fine, the helper only reads `what_happened` defensively.)

3. **Unit tests** — new describe block in `test/tools/rewind.test.ts`, importing the helper from `../../src/tools/rewind.js` (check the file's existing import of `makeRewindTool`/`RewindParams` and extend it). The helper is pure over `makeCtx({entries})` — no `run`/`pi` needed (direct-call, like the BUG-004/005 counter tests' fixture style):
   - happy path: `[user msg, asst msg, rewindEntryWithNote(1,"The read failed")]` → `"the read failed"` (trim+lowercase verified with mixed case + trailing spaces: `"  The Read FAILED  "` → `"the read failed"`).
   - LAST surviving marker wins: two surviving rewinds in the slice → returns the second one's note.
   - cancel-aware: `rewindEntryWithNote(1,"A","id-1")` + a cancel entry `{type:"custom",customType:"mulligan:cancel",data:{targetId:"id-1"}}` in the slice, plus `rewindEntryWithNote(2,"B","id-2")` → returns `"b"`; if ALL rewinds in the slice are cancelled → null.
   - no user prompt (`entries: [rewindEntryWithNote(1,"A")]` with no user message entry) → null.
   - rewind BEFORE the latest prompt is ignored: `[user, rewindWithNote("A"), user, asst]` → null (slice after the LAST user is empty).
   - surviving marker without a note (e.g. `rewindEntry(1)`) → null.
   - throwing `getEntries` (`makeCtx` with `getEntries: () => { throw new Error("x") }` — build inline; makeCtx may not support it, check) → null.
   Naming: `test Prev — <scenario>` inside `describe("prevRewindNoteAtLatestPrompt (P1.M1.T2.S1 / spec/08 E22)")`.

4. **DO NOT wire into `rewindExecute`/`successText`** — the advisory comparison + spec-verbatim warning string is P1.M1.T2.S2. Do not touch `successText` (:181-194) or the execute steps.

### Success Criteria

- [ ] `prevRewindNoteAtLatestPrompt` exported from src/tools/rewind.ts, never throws, null on all no-signal paths
- [ ] Returns last surviving same-prompt rewind's normalized `note.what_happened` (trim + toLowerCase)
- [ ] Cancel-exclusion mirrors countRetriesAtLatestPrompt's BUG-005 semantics (unreadable data.id → kept)
- [ ] `rewindEntryWithNote` fixture added; ≥7 unit tests green covering the cases above
- [ ] `npm test` green; `npx tsc --noEmit` clean
- [ ] No changes to rewindExecute, successText, REWIND_DESC, or the param schema (S1/S2 own those)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase": they need `countRetriesAtLatestPrompt`'s exact scan/cancel pattern (excerpted below), the marker shape (`data.note.what_happened`), the test harness entry points, and the S2 consumer contract. All provided.

### Documentation & References

```yaml
- file: src/tools/rewind.ts
  why: THE file. countRetriesAtLatestPrompt :283-340 — the STRUCTURAL TEMPLATE (last-user-entry scan,
        post-prompt slice, BUG-005 cancel set, defensive casts); countRewindMarkers :218-266 (the
        cancel-exclusion JSDoc conventions to mirror); successText :181-194 (DO NOT TOUCH — S2 wires here).
  pattern: per-entry try/catch + structural casts; "never exclude on bad data" polarity; fail-open.
  gotcha: the helper must be EXPORTED (first export in this helper cluster) — siblings stay module-local.

- file: src/markers.ts
  why: RewindMarker (~:50-85) — `note: NoteInput` is persisted INTO marker data, so data.note.what_happened
        exists on disk for every production marker. No schema change needed anywhere.
  gotcha: do NOT edit markers.ts.

- file: src/notes.ts
  why: NoteInput (:39) — what_happened/true_current_state/avoid/lesson/next?. One-field comparison suffices
        per spec E22 ("which now includes the avoid/lesson").

- file: test/tools/rewind.test.ts
  why: makeCtx ~:181, run ~:186, firstText ~:197 (harness); fixtures rewindEntry :207,
        rewindEntryWithId :211 (placement + typing style for rewindEntryWithNote), msgEntry :244,
        user :289. Existing BUG-005 describe blocks show the direct-call fixture style.

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M1T1S1/PRP.md
  why: PARALLEL CONTRACT — S1 edits only REWIND_DESC + checkpoint-param strings and their assertions.
        Zero overlap; do not touch those strings or their tests.
  gotcha: S1 may have modified rewind.ts:101-131 by the time you start — your edit region (:283+) is untouched.

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/prd_snapshot.md (§ Minor Issues, BUG-002)
  why: the advisory spec text + trim/lowercase definition. The WARNING STRING itself is S2's deliverable.
```

### Current Code (exact excerpt — the structural template, rewind.ts:283-340 abridged)

```ts
function countRetriesAtLatestPrompt(ctx: ExtensionContext): number {
  let entries: unknown;
  try { entries = ctx.sessionManager.getEntries(); } catch { return 0; }
  if (!Array.isArray(entries)) return 0;
  let latestPromptIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; message?: { role?: unknown } };
      if (ee.type === "message" && ee.message?.role === "user") latestPromptIndex = i;
    } catch { /* throwing-Proxy entry → skip */ }
  }
  if (latestPromptIndex === -1) return 0;
  const cancelledRewindIds = new Set<string>();
  for (let i = latestPromptIndex + 1; i < entries.length; i++) {
    // ... type==="custom" && customType==="mulligan:cancel" → add non-empty string data.targetId
  }
  let count = 0;
  for (let i = latestPromptIndex + 1; i < entries.length; i++) {
    // ... customType==="mulligan:rewind" → skip when data.id ∈ cancelledRewindIds, else count++
  }
  return count;
}
```

`prevRewindNoteAtLatestPrompt` = same skeleton, with the second loop recording `data.note?.what_happened` (defensively, `typeof === "string"`) of the last surviving marker and returning it normalized (or null). Constants 0 → null.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: defensive polarity — a rewind with an UNREADABLE/absent data.id is NOT excluded (kept as a
//   surviving marker whose note may still be read); a malformed cancel (non-string/empty targetId) is skipped.
// CRITICAL: never throw — every entry read inside try/catch; getEntries() wrapped (E13 fail-open → null).
// GOTCHA: return the NORMALIZED string; S2 normalizes the CURRENT note with the same trim().toLowerCase()
//   before comparing — the equality must be case/whitespace-insensitive per spec.
// GOTCHA: the slice is entries AFTER the latest user entry — a rewind issued before the LAST prompt is a
//   DIFFERENT prompt's rewind and must be invisible to this helper.
// GOTCHA: makeCtx in tests builds { sessionManager: { getEntries: () => entries } } — for the throwing-
//   getEntries case, construct the ctx inline rather than forcing a makeCtx change.
// GOTCHA: vitest does not typecheck tests; keep fixture return types honest anyway (house style).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD prevRewindNoteAtLatestPrompt in src/tools/rewind.ts (after countRetriesAtLatestPrompt, ~:341)
  - IMPLEMENT per the excerpt/skeleton above; EXPORT; JSDoc citing spec/08 E22 + BUG-005 + S2 consumer
  - NAMING: prevRewindNoteAtLatestPrompt (exact, per contract)
  - PLACEMENT: src/tools/rewind.ts pure-helper cluster (this file already imports prepare-args/runtime/
    filter/transforms/audit — an ExtensionContext-typed helper is the established local convention)

Task 2: ADD rewindEntryWithNote fixture in test/tools/rewind.test.ts (~:215, after rewindEntryWithId)
  - IMPLEMENT per the snippet in "What" #2; follow rewindEntryWithId's inline-return-type style

Task 3: ADD the describe block with the ≥7 cases from "What" #3
  - EXTEND the existing import from ../../src/tools/rewind.js with prevRewindNoteAtLatestPrompt
  - DIRECT-CALL style (no run/pi) — pass makeCtx({entries}).ctx straight into the helper

Task 4: VERIFY
  - npx tsc --noEmit → clean
  - npm test → all green (full suite; no other file touched)
  - grep -n "prevRewindNoteAtLatestPrompt" src/ → definition + export only (ZERO call sites — S2 wires it)
```

### Implementation Patterns & Key Details

```ts
// The recording loop (the only part that differs from countRetriesAtLatestPrompt):
let lastNote: string | null = null;
for (let i = latestPromptIndex + 1; i < entries.length; i++) {
  const e = entries[i];
  if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
  try {
    const ee = e as { type?: unknown; customType?: unknown;
                      data?: { id?: unknown; note?: { what_happened?: unknown } } };
    if (ee.type === "custom" && ee.customType === "mulligan:rewind") {
      const id = ee.data?.id;
      if (typeof id === "string" && cancelledRewindIds.has(id)) continue; // cancelled → skip
      const wh = ee.data?.note?.what_happened;          // absent note → marker survives, contributes nothing
      if (typeof wh === "string") lastNote = wh;         // LAST surviving marker's note wins
      else if (lastNote === null && ee.data?.note === undefined) { /* keep null — see test "marker without a note" */ }
    }
  } catch { /* throwing-Proxy entry → skip */ }
}
return lastNote === null ? null : lastNote.trim().toLowerCase();
```
(Implementer: the `else if` branch is a no-op placeholder for clarity — the correct semantics are simply: a surviving marker with no readable note does not overwrite a previously-recorded note, and `lastNote` stays null if NO surviving marker ever had one. Simplify to just the `if (typeof wh === "string") lastNote = wh;` line and the null-return — but make sure the "all surviving markers lack notes → null" test pins it.)

### Integration Points

```yaml
EXPORTS (src/tools/rewind.ts):
  - NEW: prevRewindNoteAtLatestPrompt (first exported member of the pure-helper cluster)
TEST FIXTURES (test/tools/rewind.test.ts):
  - NEW: rewindEntryWithNote
CONSUMER (NOT this subtask):
  - P1.M1.T2.S2: in rewindExecute's success path — const prev = prevRewindNoteAtLatestPrompt(ctx);
    if (prev !== null && prev === note.what_happened.trim().toLowerCase()) append the spec-verbatim
    "⚠ You have rewound with an identical note — ..." to successText.
NO config/schema/marker-shape changes. No public-API surface change (internal helper, Mode: no docs).
```

## Validation Loop

### Level 1: Types

```bash
npx tsc --noEmit    # 0 errors (S1 lands in parallel but touches disjoint regions; joint gate at merge)
```

### Level 2: Tests

```bash
npm test                                   # full suite green
npx vitest run test/tools/rewind.test.ts   # targeted during development
```

### Level 3: Contract assertions

```bash
grep -n "prevRewindNoteAtLatestPrompt" src/tools/rewind.ts   # definition + export, NO call sites
grep -n "rewindEntryWithNote" test/tools/rewind.test.ts      # fixture + ≥7 usages
grep -n "identical note" src/                                # expect 0 (the warning text is S2's)
```

## Final Validation Checklist

- [ ] `npx tsc --noEmit` clean; `npm test` green
- [ ] Helper exported, pure, never throws; null on no-prompt / no-surviving-rewind / no-note paths
- [ ] Cancel-exclusion (BUG-005 pattern) verified by tests; unreadable-id polarity pinned
- [ ] `rewindEntryWithNote` fixture + ≥7 targeted unit tests added
- [ ] No wiring into rewindExecute/successText; no REWIND_DESC/schema touches (S1/S2 own those)
- [ ] Only src/tools/rewind.ts + test/tools/rewind.test.ts modified

## Anti-Patterns to Avoid

- ❌ Do NOT append the advisory warning text here — S2 owns the string and the wiring
- ❌ Do NOT introduce new persisted state or edit markers.ts — the note is already on disk
- ❌ Do NOT reuse `readMarkers` from filter.ts for this — it returns the active FILTER bundle without
  per-prompt slicing; the same-prompt slice scan is the point (and the contract specifies the entry walk)
- ❌ Do NOT throw or skip the try/catch wrappers — E13 fail-open → null, always
- ❌ Do NOT compare against avoid/lesson — spec says what_happened alone (it absorbs them)