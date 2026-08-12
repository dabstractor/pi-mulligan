# PRP — P1.M1.T1.S3: `markers.ts` backward-compat annotation (`to_previous_prompt` stays optional)

---

## Goal

**Feature Goal**: Annotate the persisted `RewindMarker.options.to_previous_prompt` field in `src/markers.ts` as a legacy v1.0 field, so the source truthfully documents that the v1.1 resolver ignores it (a `last_turn` rewind always keeps the latest user message — spec/13 §1). The field itself **stays optional** (`?:`) and is **not removed**: old persisted markers (v1.0) that carry `options.to_previous_prompt` must still type-check and be read harmlessly. This is a **pure documentation/annotation change** — no behavioral change, no migration, no new code path.

**Deliverable**: A modified `src/markers.ts` with exactly ONE edit: the JSDoc comment above `to_previous_prompt?: boolean;` (line 59) is replaced with a legacy note. The field declaration on line 60 (`to_previous_prompt?: boolean;`) is byte-for-byte unchanged. No other line in `markers.ts` is touched, and no other file is modified by S3.

**Success Definition**:
- Line 60 still reads `to_previous_prompt?: boolean;` (optional, `?:` — unchanged).
- Line 59 now carries a JSDoc stating it is a legacy v1.0 field ignored by the v1.1 resolver (wording mirrors the already-landed `RewindMarkerLike.options` note S1 added in `src/transforms.ts:1105-1107`).
- `grep -n "to_previous_prompt" src/markers.ts` → exactly TWO matches (the new JSDoc line + the field line), same count as before; `to_previous_prompt` is NOT deleted.
- `npx tsc --noEmit` → NO error originating in `src/markers.ts` (a comment change cannot break types; the field staying optional keeps `markers.test.ts:122` and `:175` compiling).
- No downstream consumer reads the field after S1+S2: `resolveLastTurn` (S1) no longer reads `options.to_previous_prompt`; the rewind tool (S2) no longer emits it.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers reading `markers.ts` (the persisted-data-model source of truth), and the S4 implementer who will sweep the 39 test occurrences.

**Use Case**: A maintainer opens `markers.ts` to understand the `RewindMarker` persisted shape and sees, at the `options` block, an accurate note that `to_previous_prompt` is a harmless legacy field rather than the stale (and now false) claim that it "discards the most recent user message (nuclear)."

**User Journey**: S1 removed the resolver's nuclear mode + added the equivalent legacy JSDoc on the *internal* read shape (`RewindMarkerLike.options` in transforms.ts) → S2 removed the field from the rewind tool's schema + stopped emitting it → **S3 mirrors the legacy annotation on the *persisted* shape in markers.ts** → S4 updates the 39 test occurrences. After the chain, both the internal and persisted shapes carry the same truthful "legacy v1.0 field; ignored" note, and old markers read harmlessly.

**Pain Points Addressed**: The current JSDoc on line 59 ("If true, also discard the most recent user message (nuclear). Default false.") is a **stale lie** — it describes behavior the v1.1 resolver no longer performs (S1). Leaving it would mislead any maintainer and contradict the guardrail (spec/13 §1). S3 fixes the source comment to match the v1.1 reality.

## Why

- **Business value / user impact**: Enforces the v1.1 guardrail (spec/13 §1, h2.127): "a rewind never wipes user input." The annotation documents, in the persisted-data-model source of truth, that the field which *used to* enable user-message discarding is now ignored. It is the documentation half of the `to_previous_prompt` removal (Mode A: the JSDoc is the documentation — no separate doc task, per the item contract).
- **Integration with existing features**: `RewindMarker.options.to_previous_prompt` is the **persisted** shape (markers.ts). Its internal-read counterpart `RewindMarkerLike.options.to_previous_prompt` (transforms.ts:1107) was **already annotated by S1** with the identical legacy note. S3 brings the persisted shape to parity so the two shapes do not contradict each other. S2 stopped *emitting* the field (payload `options` is now `{ protect }`); S3 ensures the *persisted type* still *accepts* it for old markers. S4 owns the test fixtures/assertions.
- **Problems this solves and for whom**: For maintainers — the source comment stops lying. For old sessions — persisted v1.0 markers carrying `options.to_previous_prompt` continue to deserialize and type-check without error (forward-compatible, no migration). The annotation makes the "kept for backward compat, ignored at runtime" intent explicit at the declaration site.

## What

No user-visible behavior. No runtime change at all. The change is a single JSDoc comment replacement on `src/markers.ts:59`. The field stays optional. Old markers read the same as before (the resolver already ignores the field since S1).

### Success Criteria

- [ ] `src/markers.ts:60` reads exactly `    to_previous_prompt?: boolean;` (the field — UNCHANGED, still optional).
- [ ] `src/markers.ts:59` is a JSDoc line stating the field is a legacy v1.0 field ignored by the v1.1 resolver; wording consistent with the S1 note on `RewindMarkerLike.options` (transforms.ts:1105-1107).
- [ ] The old, now-false JSDoc ("Only for granularity=last_turn. If true, also discard the most recent user message (nuclear). Default false.") is GONE.
- [ ] `to_previous_prompt` still appears in `src/markers.ts` (NOT deleted) — `grep -c` is unchanged (still 2: the JSDoc mention + the field).
- [ ] `protect?: string[];` (line 61) and the entire rest of `markers.ts` are UNCHANGED.
- [ ] `npx tsc --noEmit` → no error citing `src/markers.ts`.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP quotes the exact current text of the line to replace (line 59), the exact target text, confirms the field line (60) is untouched, points at the already-landed sibling annotation in transforms.ts (the wording precedent to copy for consistency), and verifies that the two `markers.test.ts` fixtures (lines 122, 175) still compile precisely *because* the field stays optional (so S3 introduces no tsc error). It also states explicitly which downstream tsc/test failures are EXPECTED and owned by S4 (not chased here).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/markers.ts
  why: "THE file. The ONE S3 edit is the JSDoc on line 59, directly above the field on line 60. The surrounding options block (lines 58-62) is inside `interface RewindMarker extends MulliganEnvelope` (the PERSISTED shape). The current line-59 JSDoc is now a STALE LIE — it claims the field 'discards the most recent user message (nuclear)' and defaults false, but S1 made resolveLastTurn ignore the field entirely. Line 60 (`to_previous_prompt?: boolean;`) is OPTIONAL (`?:`) and MUST stay so."
  pattern: "All persisted-marker fields in this file carry a one-line /** ... */ JSDoc above them (see `protect?: string[];` on line 61, `excludeToolCallId?` further down, `hideEntryIds?`, etc.). S3 follows that exact convention: replace the line-59 comment, keep the `/** ... */` shape, keep it to one or two lines."
  gotcha: "This is a COMMENT-ONLY change. Do not touch the field declaration (`to_previous_prompt?: boolean;`), do not change `?:` to `:` (that would break backward-compat reads of old markers), do not remove the field. The field STAYS so old persisted markers type-check. `RewindMarkerInput` (line 86) is `Omit<RewindMarker, 'schema'|'v'|'kind'|'id'|'seq'|'ts'>` — it inherits `options`, so editing the `RewindMarker.options` JSDoc is the single source of truth for both."

- file: src/transforms.ts
  why: "THE WORDING PRECEDENT. S1 already annotated the internal-read counterpart, `RewindMarkerLike.options` (lines 1105-1107): '/** Legacy v1.0 field; ignored by the v1.1 resolver (last_turn always keeps the latest user message by construction). Kept optional for backward-compat reads of old persisted markers. */ options?: { to_previous_prompt?: boolean };'. S3's markers.ts note should be CONSISTENT with this (same meaning, mirrored phrasing) so the persisted shape and the internal read shape do not contradict each other. Do NOT edit transforms.ts in S3 (S1 owns it — it is already done)."
  pattern: "S1 wrote the note as a TWO-line `/** ... */` JSDoc covering: (a) legacy v1.0 field, (b) ignored by v1.1 resolver + WHY (last_turn keeps the user message by construction), (c) kept optional for backward-compat reads. S3's markers.ts note should hit the same three points."
  gotcha: "transforms.ts:1107 and markers.ts:60 are DIFFERENT shapes (internal-read slice vs persisted envelope), both keeping the field optional. They are not redundant — markers.ts is what gets serialized; transforms.ts is what the filter reads. Both keep the field for the same backward-compat reason; both should carry the same legacy note."

- file: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "§Change 2 is the authoritative touchpoint list. It states EXACTLY for markers.ts: 'Line 60: `options.to_previous_prompt?: boolean` — keep OPTIONAL, add JSDoc \"legacy v1.0 field; ignored by v1.1 resolver\".' §Backward Compatibility confirms: 'Old persisted markers with options.to_previous_prompt are read harmlessly (field stays optional; resolver ignores it). No migration.'"
  critical: "Confirms this is a KEEP-AND-ANNOTATE task, not a removal. The field is deliberately retained so v1.0 persisted markers deserialize without error. No migration script is needed or wanted."

- file: plan/007_67d7d8c6e4c5/P1M1T1S1/PRP.md
  why: "The CONTRACT for the resolver half. Confirms resolveLastTurn no longer reads `options.to_previous_prompt` (signature `(messages, excludeToolCallId?)`, no `opts`), and confirms S1 already added the parallel legacy JSDoc to `RewindMarkerLike.options` (transforms.ts:1105-1107) — the exact wording S3 should mirror."
  critical: "S1's success criterion was 'grep to_previous_prompt src/transforms.ts → only the RewindMarkerLike.options legacy field + its updated JSDoc.' S3's analog is 'grep to_previous_prompt src/markers.ts → only the RewindMarker.options legacy field + its updated JSDoc' (count unchanged at 2)."

- file: plan/007_67d7d8c6e4c5/P1M1T1S2/PRP.md
  why: "The CONTRACT for the tool half. Confirms the rewind tool (S2) stops EMITTING `to_previous_prompt` (payload `options` becomes `{ protect }`), and confirms markers.ts line 60 stays optional so S2's `{ protect }` payload is assignable with no cast change. S3 is the third leg: the PERSISTED shape keeps the field optional + annotated."
  critical: "S2 explicitly deferred markers.ts to S3 ('Do NOT edit markers.ts in S2 — S3 owns it'). S3 is the only subtask that touches markers.ts in this chain."

- spec: spec/13 §1 (h2.127) + spec/04 §3 (RewindMarker)
  why: "spec/13 §1 (h2.127) is the guardrail: 'This is why v1's to_previous_prompt option is removed — it discarded the latest user message.' spec/04 §3 is the RewindMarker persisted shape that markers.ts encodes (the options block). The annotation documents the spec/13 §1 rationale at the field site."
  critical: "The note's WHY ('last_turn always keeps the user message') is a direct, faithful restatement of spec/13 §1 + spec/06 §8 (h2.71): last_turn never hides a user message by construction."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  markers.ts        # ← MODIFY (S3): ONE JSDoc line (line 59) above to_previous_prompt? (line 60); field stays optional
  transforms.ts     # ← S1 (DONE): RewindMarkerLike.options legacy JSDoc already added (lines 1105-1107) — the wording precedent
  tools/rewind.ts   # ← S2 (DONE): stopped emitting to_previous_prompt (payload options now { protect })
test/
  markers.test.ts        # ← S4: fixtures (line 122 options:{to_previous_prompt:false}, line 175 .toEqual assertion) — still COMPILE (field optional)
  transforms.test.ts     # ← S4: 13 occurrences
  tools/rewind.test.ts   # ← S4: 11 occurrences
  edge-cases.test.ts     # ← S4: 8 occurrences
  integration/smoke.ts   # ← S4: 4 occurrences
  tools/cancel.test.ts   # ← S4: 1 occurrence
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S3 MODIFIES exactly ONE source file and makes exactly ONE comment edit (no code change, no test change):
src/markers.ts   # line 59 JSDoc replaced (legacy note); line 60 field UNCHANGED (stays `?:`)
# All other files are S1 (transforms.ts — done) / S2 (rewind.ts — done) / S4 (tests) — NOT touched here.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (this is a COMMENT-ONLY change — the field MUST stay optional). The field declaration on line 60
//   (`to_previous_prompt?: boolean;`) is byte-for-byte unchanged. Do NOT change `?:` to `:` (that makes the field
//   REQUIRED and breaks every old persisted marker that omits it, plus breaks the rewind tool's `{ protect }` payload).
//   Do NOT remove the field (old v1.0 markers would fail to type-check on load). The `?:` IS the backward-compat —
//   the annotation just documents WHY it stays optional.

// CRITICAL GOTCHA #2 (the current line-59 JSDoc is a STALE LIE — that is the bug S3 fixes). It currently reads:
//   "Only for granularity=last_turn. If true, also discard the most recent user message (nuclear). Default false."
//   After S1, resolveLastTurn NEVER reads this field, so "If true, also discard the most recent user message (nuclear)"
//   is false, and "Default false" is meaningless (the field has no effect). Replace the WHOLE comment; do not try to
//   "partially correct" it. Leaving any fragment of the nuclear/discard language would keep the lie alive.

// CRITICAL GOTCHA #3 (mirror S1's wording for cross-file consistency — do not invent new phrasing). S1 already wrote
//   the parallel note on the internal-read shape `RewindMarkerLike.options` (transforms.ts:1105-1107). The persisted
//   shape (`RewindMarker.options`, markers.ts) should say the SAME THING in the same voice, so a reader hopping between
//   the two files sees consistent language. The three semantic points to hit: (a) legacy v1.0 field, (b) ignored by the
//   v1.1 resolver + the guardrail reason (last_turn keeps the user message by construction), (c) kept optional for
//   backward-compat reads of old persisted markers.

// CRITICAL GOTCHA #4 (markers.test.ts fixtures STILL COMPILE — do not "fix" them in S3). Line 122
//   (`options: { to_previous_prompt: false }`) and line 175 (`expect(entry.options).toEqual({ to_previous_prompt: false })`)
//   reference the field. Because S3 keeps the field OPTIONAL, BOTH still type-check and the assertion still passes
//   (REWIND_DATA on line 122 sets the field; appendRewindMarker spreads it verbatim). Whether to UPDATE these fixtures
//   (e.g. drop the field from REWIND_DATA to mirror the v1.1 `{ protect }` payload) is an S4 decision, NOT S3's. Do
//   NOT edit any test file in S3 (scope creep + merge-conflict risk with S4).

// CRITICAL GOTCHA #5 (no downstream consumer reads the field after S1+S2 — this is purely documentary). S1's
//   resolveLastTurn no longer reads `options.to_previous_prompt` (the `opts` param is gone). S2's rewind tool no longer
//   EMITS it (payload options is `{ protect }`). So the only thing the field does post-v1.1 is: exist (so old markers
//   type-check) and be ignored. S3's annotation documents that exact reality. There is no runtime path to test.

// CRITICAL GOTCHA #6 (scope — S3 is markers.ts line 59 ONLY). Do NOT touch transforms.ts (S1, done), rewind.ts (S2,
//   done), any test file (S4), config.ts, index.ts, or any tool. S3 is the backward-compat annotation on the persisted
//   shape — one comment. The `protect?: string[]` field below it, the whole `appendRewindMarker` wrapper, `leaveNote`,
//   `setCheckpoint`, and every other member of markers.ts are UNCHANGED.
```

## Implementation Blueprint

### Data models and structure

**No data-model change whatsoever.** `RewindMarker.options.to_previous_prompt` keeps its type (`boolean | undefined`, via `?:`). `RewindMarkerInput` (line 86, `Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts">`) inherits the unchanged `options` shape. This is a documentation-only edit.

```typescript
// The options block BEFORE S3 (markers.ts ~lines 58-62):
//   options: {
//     /** Only for granularity=last_turn. If true, also discard the most recent user message (nuclear). Default false. */
//     to_previous_prompt?: boolean;
//     /** Role list that must not be crossed (default from config.rewind.protectedRoles). */
//     protect?: string[];
//   };
//
// The options block AFTER S3 (only the line-59 JSDoc changes; line 60 field + line 61 protect are byte-for-byte identical):
//   options: {
//     /** Legacy v1.0 field; ignored by the v1.1 resolver — last_turn always keeps the user message. Kept optional so
//      *  old persisted markers type-check and read harmlessly. */
//     to_previous_prompt?: boolean;
//     /** Role list that must not be crossed (default from config.rewind.protectedRoles). */
//     protect?: string[];
//   };
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REPLACE the JSDoc on src/markers.ts line 59 (directly above `to_previous_prompt?: boolean;`)
  - OLD (line 59):
      /** Only for granularity=last_turn. If true, also discard the most recent user message (nuclear). Default false. */
  - NEW (one or two lines, mirroring transforms.ts:1105-1107 — GOTCHA #3). Recommended target:
      /** Legacy v1.0 field; ignored by the v1.1 resolver — last_turn always keeps the user message. Kept optional so
       *  old persisted markers type-check and read harmlessly. */
  - FIELD (line 60) — UNCHANGED, do not touch:
      to_previous_prompt?: boolean;
  - GOTCHA #1: keep `?:` (optional). Do NOT make it required, do NOT remove it.
  - GOTCHA #2: replace the WHOLE old comment; leave no fragment of "nuclear" / "discard" / "Default false".
  - GOTCHA #3: hit the three points S1's note hits — legacy, ignored + guardrail reason, kept optional for back-compat.
  - DEPENDENCIES: none (markers.ts is self-contained for this edit; no import/type change).

Task 2: VALIDATE (no new code)
  - GREP count: `grep -c "to_previous_prompt" src/markers.ts` → still 2 (the new JSDoc line + the field line). It must
    NOT be 0 (field retained) and must NOT grow (no stray new references).
  - GREP for the stale lie: `grep -niE "nuclear|discard the most recent user message|Default false" src/markers.ts`
    → ZERO matches (the old comment is fully gone).
  - RUN `npx tsc --noEmit` → NO error citing src/markers.ts. (A comment change cannot break types; the field staying
    optional keeps markers.test.ts:122 and :175 compiling.) Remaining tsc errors are EXPECTED in other test files
    (owned by S4) and possibly src/tools/rewind.ts if S2 has not landed yet — NOT S3's concern.
  - DEPENDENCIES: Task 1.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): every persisted-marker field in markers.ts already carries a one-line /** ... */ JSDoc above it
//   (see `protect?: string[];` on line 61, `excludeToolCallId?`, `hideEntryIds?`, `pinnedEntryId?` in ShrinkMarker,
//   etc.). S3 follows that convention exactly: a /** ... */ comment, kept to one or two lines, no code change.

// CRITICAL (the wording precedent is already landed in transforms.ts — copy its voice). S1 wrote, on the internal-read
//   shape RewindMarkerLike.options (transforms.ts:1105-1107):
//     /** Legacy v1.0 field; ignored by the v1.1 resolver (last_turn always keeps the latest user message by
//      * construction). Kept optional for backward-compat reads of old persisted markers. */
//     options?: { to_previous_prompt?: boolean };
//   The markers.ts note should be the persisted-shape twin of this. The meaning is identical; only the field shape
//   differs (markers.ts wraps it in the full RewindMarker.options block alongside `protect`; transforms.ts inlines it).
//   Keeping the language aligned means a maintainer reading either file gets the same story.

// CRITICAL (why the field MUST stay — this is forward-compat, not laziness). v1.0 sessions have persisted
//   `mulligan:rewind` CustomEntries whose `data.options` is `{ to_previous_prompt: true|false }` (or `{ to_previous_prompt,
//   protect }`). When the v1.1 filter reads them (readMarkers → cast to RewindMarker), the type must still ACCEPT that
//   field or the cast/shape is wrong. Keeping `to_previous_prompt?: boolean` (optional) means: present → ignored by the
//   resolver (S1); absent → fine (new markers from S2 only emit `{ protect }`). Both load without error. NO migration
//   script is involved — the optional field IS the migration strategy.

// CRITICAL (no runtime path to exercise). After S1 (resolver ignores it) + S2 (tool stops emitting it), there is no
//   code that branches on `to_previous_prompt`. The annotation cannot be validated by a behavior test — it is validated
//   by: (a) grep (stale language gone, field retained), (b) tsc (markers.ts clean), (c) reading the comment. S4 owns
//   any test-fixture assertion changes (markers.test.ts:175 `.toEqual({ to_previous_prompt: false })`).
```

### Integration Points

```yaml
CODE:
  - modify: src/markers.ts ONLY (line 59 JSDoc; line 60 field UNCHANGED)
  - untouched: every other line of markers.ts (appendRewindMarker, appendShrinkMarker, appendTurnMetric,
    appendCancelMarker, leaveNote, setCheckpoint, NoteDetails, SetCheckpointResult, MulliganEnvelope, all JSDoc blocks)
DOWNSTREAM (later subtask — NOT this one):
  - S4 (P1.M1.T1.S4): markers.test.ts:122 fixture + :175 assertion — decide whether to drop the field from REWIND_DATA
    to mirror the v1.1 `{ protect }` payload. S3 leaves them AS-IS (they compile + pass because the field stays optional).
SIBLINGS (already done):
  - S1 (P1.M1.T1.S1): src/transforms.ts — resolveLastTurn ignores the field; RewindMarkerLike.options already annotated.
  - S2 (P1.M1.T1.S2): src/tools/rewind.ts — schema field removed, call site 2-arg, BUG-006 block gone, payload `{ protect }`.
CONFIG / DATABASE / ROUTES / REGISTRATION / MIGRATION:
  - none. No config change, no persistence migration (the optional field IS the back-compat strategy), no registration
    change, no new code path. Pure source-comment update.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The decisive gate — confirms the field is RETAINED (still optional) AND the stale lie is gone:
grep -n "to_previous_prompt" src/markers.ts
# EXPECTED: exactly 2 lines — the NEW JSDoc (line ~59) + the field (line 60). The field must still be `?:`.

grep -niE "nuclear|discard the most recent user message|Default false" src/markers.ts
# EXPECTED: no output (the old, now-false comment is fully removed).

# Full project typecheck:
npx tsc --noEmit
# EXPECTED: NO error line cites `src/markers.ts`. (A comment-only edit cannot introduce a type error, and the field
#   staying `?:` keeps markers.test.ts:122 and :175 compiling.) Remaining errors — if any — are in other files owned
#   by sibling/later subtasks (rewind.ts if S2 not yet landed; test/* owned by S4). Do NOT "fix" those here.
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A as a gate for S3: this is a comment-only change with no runtime path. There is nothing to unit-test.
# You MAY run markers.test.ts as a SANITY check that the change introduced no regression:
npx vitest run test/markers.test.ts
# EXPECTED: green (the suite asserts the spread/persist behavior of appendRewindMarker; the options fixture on line 122
#   still type-checks because the field stays optional, and the line-175 `.toEqual({ to_previous_prompt: false })`
#   assertion still passes because REWIND_DATA still sets the field). If a markers.test.ts test FAILS, you changed more
#   than the line-59 comment — investigate. (Whether S4 later drops the field from the fixture is S4's call, not S3's.)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S3: there is no live seam to exercise. The field has no runtime effect after S1+S2 (resolver ignores it;
#   tool stops emitting it). The end-to-end "old markers load harmlessly + last_turn keeps the user message" validation
#   belongs to the integration suite (S4) and the spike harness, not to a one-line comment change. No server/endpoint.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Cross-file consistency check (proves the persisted + internal shapes tell the same story):
echo "=== markers.ts (persisted shape) ===" && grep -n -A1 "to_previous_prompt" src/markers.ts | head
echo "=== transforms.ts (internal read shape, S1) ===" && grep -n -B2 "to_previous_prompt" src/transforms.ts | head
# EXPECTED: both carry a "Legacy v1.0 field; ignored by the v1.1 resolver" note. The two files now agree.
```

## Final Validation Checklist

### Technical Validation

- [ ] `grep -c "to_previous_prompt" src/markers.ts` → still 2 (field retained, not deleted).
- [ ] `grep -niE "nuclear|discard the most recent user message|Default false" src/markers.ts` → zero matches.
- [ ] `npx tsc --noEmit` → NO error originating in `src/markers.ts`.

### Feature Validation

- [ ] `src/markers.ts:60` reads `    to_previous_prompt?: boolean;` (UNCHANGED — still optional `?:`).
- [ ] `src/markers.ts:59` is a JSDoc stating the field is a legacy v1.0 field ignored by the v1.1 resolver (last_turn always keeps the user message), kept optional for backward-compat reads.
- [ ] The note's wording is consistent with S1's `RewindMarkerLike.options` note (transforms.ts:1105-1107) — same three semantic points.
- [ ] `protect?: string[];` (line 61) and the entire rest of `markers.ts` are UNCHANGED.

### Code Quality Validation

- [ ] Only `src/markers.ts` is modified — NO edits to transforms.ts (S1, done), rewind.ts (S2, done), any test file (S4), or any other source file.
- [ ] The edit is a single JSDoc comment replacement — no field declaration change, no `?:` → `:`, no field removal.
- [ ] The annotation follows the existing one-line `/** ... */` JSDoc convention used on every field in this file.

### Documentation & Deployment

- [ ] The JSDoc note IS the documentation (Mode A — the item contract explicitly says "The JSDoc note on the field is the documentation. No separate doc task.").
- [ ] No README/spec change in S3 (the spec is already v1.1 — spec/13 §1 / h2.127 reflect the removal; changeset doc sync is P3.M1.T1).

---

## Anti-Patterns to Avoid

- ❌ Don't remove the `to_previous_prompt` field or change `?:` to `:` — old v1.0 persisted markers carry it and must keep type-checking on load. The optional field IS the backward-compat strategy (GOTCHA #1). S2 stopped *emitting* it; S3 keeps it *acceptable*.
- ❌ Don't "partially correct" the old comment (e.g. leave "Default false" or the word "nuclear"). The whole line-59 JSDoc is a stale lie after S1; replace it entirely so no misleading fragment remains (GOTCHA #2).
- ❌ Don't invent brand-new phrasing — mirror S1's already-landed note on `RewindMarkerLike.options` (transforms.ts:1105-1107) so the persisted and internal-read shapes use consistent language (GOTCHA #3).
- ❌ Don't edit `markers.test.ts` (lines 122 / 175) in S3 — those fixtures still compile *because* the field stays optional, and whether to update them is S4's decision. Touching tests crosses the task boundary (GOTCHA #4).
- ❌ Don't look for a runtime path to test — there is none after S1+S2. The resolver ignores the field; the tool no longer emits it. Validate by grep + tsc + reading the comment, not by a behavior test (GOTCHA #5).
- ❌ Don't touch any file other than `src/markers.ts` — S3 is the backward-compat annotation on the persisted shape only (GOTCHA #6). transforms.ts is S1 (done), rewind.ts is S2 (done), tests are S4.

---

## Decision Log

- **D1 — KEEP the field optional, do not remove it (backward-compat).** The item contract, `change_surface.md` §Change 2, and §Backward Compatibility all mandate: the field STAYS `?:`. v1.0 sessions have persisted `mulligan:rewind` entries with `options.to_previous_prompt`; the v1.1 filter reads them via `readMarkers` → cast to `RewindMarker`. Removing the field or making it required would either drop the data semantics or break the cast. Keeping it optional means: present → ignored (S1); absent → fine (S2's `{ protect }` payloads). No migration script. S3's annotation documents this exact intent at the declaration.

- **D2 — Replace the whole line-59 JSDoc (the current one is a stale lie).** Before S1, the comment ("If true, also discard the most recent user message (nuclear). Default false.") was accurate. After S1's `resolveLastTurn` no longer reads the field, every clause of that comment is false. Leaving it would actively mislead maintainers and contradict spec/13 §1. S3 rewrites it to a faithful "legacy v1.0 field; ignored by the v1.1 resolver" note — the documentation half of the removal (Mode A).

- **D3 — Mirror S1's wording for cross-file consistency.** S1 already annotated the internal-read counterpart (`RewindMarkerLike.options`, transforms.ts:1105-1107) with "Legacy v1.0 field; ignored by the v1.1 resolver ... Kept optional for backward-compat reads of old persisted markers." The persisted shape (`RewindMarker.options`, markers.ts) is the serialization twin and should carry the same note in the same voice, so a reader moving between files sees one consistent story rather than two different descriptions of the same legacy field.

- **D4 — No test changes in S3 (deferred to S4).** `markers.test.ts:122` (`options: { to_previous_prompt: false }`) and `:175` (`expect(entry.options).toEqual({ to_previous_prompt: false })`) still compile and still pass because S3 keeps the field optional and `REWIND_DATA` still sets it. Whether S4 later drops the field from the fixture (to mirror the v1.1 `{ protect }` payload) is a test-hygiene call for S4, which owns all 39 test occurrences. S3's scope is the source annotation only.