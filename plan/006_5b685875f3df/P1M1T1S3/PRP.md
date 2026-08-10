# PRP — P1.M1.T1.S3: Tests for the three-field note (notes.test.ts + rewind.test.ts + edge-cases.test.ts + markers.test.ts)

**Mode A (test-only) — no user-facing/config/API surface change.**
**Depends on:** P1.M1.T1.S1 (notes.ts — `NoteInput` is now 3-field, **Complete**) and P1.M1.T1.S2
(rewind.ts — `RewindParams.note` schema 3-field + `REWIND_DESC` rephrase, **Ready, assume-landed**).
**Does NOT modify:** any `src/` file. This PRP updates TEST FIXTURES + ASSERTIONS ONLY.

---

## Goal

**Feature Goal**: Update every test file that references the removed `NoteInput.avoid` field so the full
suite is green again after S1+S2 collapsed the rewind note from 4 fields to 3 (`what_happened`,
`true_current_state`, `next`; the `avoid` lesson is folded into `what_happened`).

**Deliverable**: Modified `test/notes.test.ts`, `test/tools/rewind.test.ts`, `test/edge-cases.test.ts`,
and `test/markers.test.ts` with all `avoid` references removed/merged, all `**Avoid:**` snapshot lines
stripped, the `REWIND_DESC` snapshot updated to S2's new text, and the `expectTypeOf` note-shape
assertions narrowed to 3 fields. No source changes; no new files.

**Success Definition**:
- `npm test` (vitest) — **all 956 tests green** (currently 12 fail in 3 files after S1).
- `npm run typecheck` (tsc --noEmit) — **zero errors** (currently 13, all in test files; one of them is
  in `test/markers.test.ts` which the item body omitted — see CRITICAL FINDING below).
- `grep -rn "avoid" test/notes.test.ts test/tools/rewind.test.ts test/edge-cases.test.ts test/markers.test.ts`
  → zero matches. `grep -rn "\*\*Avoid:\*\*" test/` → zero matches.
- The `**Avoid:**` line is gone from every `renderNote` snapshot; the 3-section format (header → What
  happened → Current true state → [ledger] → Next) is asserted instead.

## CRITICAL FINDING — two touchpoints the item description MISSED

The item's CONTRACT lists three test files (notes.test.ts, rewind.test.ts, edge-cases.test.ts). Verified
codebase analysis (`npx tsc --noEmit` + `npx vitest run` on 2025-08-10) found **two additional breakages
that WILL keep the gates red** if not fixed in this subtask:

1. **`test/tools/rewind.test.ts:290` — REWIND_DESC verbatim snapshot (FAILS vitest).** The
   "registration metadata" describe asserts `expect(REWIND_DESC).toBe("…disappears from your view
   permanently…")`. S2 (rewind.ts PRP Task 3) rephrases that substring to "hidden from your context
   going forward". Because **S3 owns rewind.test.ts**, this snapshot MUST be updated here — otherwise
   `npm test` stays red regardless of the `avoid` fixes. The item body only cited ~lines 54/332/845
   (the `avoid` ones) and omitted line 290.

2. **`test/markers.test.ts:126` — `RewindMarkerInput.note.avoid` (FAILS tsc).** The fixture
   `REWIND_DATA: RewindMarkerInput` has `note.avoid`. `RewindMarkerInput.note` is typed `NoteInput`
   (now 3-field) → TS2353. It does NOT fail vitest (line 177 `expect(entry.note).toEqual(REWIND_DATA.note)`
   is self-symmetric) but it FAILS `npm run typecheck` and violates the item's own OUTPUT criterion
   ("no references to NoteInput.avoid"). The S2 PRP GOTCHA #4 explicitly attributes "test/* tsc errors"
   to S3. **This file MUST be fixed.**

Both are included in the task list below. The remaining `avoid` hits (audit.test.ts:230, cancel.test.ts:175,
drift_nudge.test.ts:48, smoke.ts:67) are type-erased by `as unknown`/`as never` casts and/or never reach
`validateNote` → they do NOT break either gate (verified). They are OPTIONAL hygiene cleanup (documented
in the research notes; not required for green).

## User Persona

**Target User**: The pi-mulligan maintainer (developer). No end-user surface.
**Use Case**: Keeping the test suite green after the note-consolidation refactor (S1+S2). These tests are
the executable spec for `validateNote` / `renderNote` / the rewind schema; they must match the 3-field contract.
**Pain Points Addressed**: A red suite blocks all other work; stale `**Avoid:**` snapshots mis-document the
rendered note format; a lingering `avoid` reference is a latent type error.

## Why

- **Acceptance gate for note consolidation (M1)**: the item's OUTPUT is "a fully green test suite with no
  references to `NoteInput.avoid` or `**Avoid:**`." Without S3, M1 cannot merge (the suite is red).
- **Locks the 3-field contract**: the `expectTypeOf` assertions (notes.test.ts:149, rewind.test.ts:843)
  are the type-level spec — they now assert exactly `{what_happened, true_current_state, next}`.
- **Scope discipline**: this item touches ONLY test files. It does NOT modify `src/notes.ts` (S1),
  `src/tools/rewind.ts` (S2), or `src/markers.ts` (type-only import, auto-adapts).

## What

Four test files are edited (the three listed + markers.test.ts per CRITICAL FINDING #2). Per file:

**(A) `test/notes.test.ts`** — merge `VALID_NOTE.avoid` into `what_happened`; drop `"avoid"` from the
`FIELDS` array; repoint the two `avoid: null` validateNote cases (lines 67, 87) and the inline-note
`avoid` (lines 98, 323); drop `avoid` from the inline `validateNote({...})` literal (line 107); narrow
the `expectTypeOf<NoteInput>()` to 3 fields (line 149); strip the `**Avoid:**` block from BOTH renderNote
snapshots (lines 187, 215).

**(B) `test/tools/rewind.test.ts`** — merge `VALID_NOTE.avoid` into `what_happened` (line 54); update the
`REWIND_DESC` verbatim snapshot to S2's new string (line 290 — CRITICAL FINDING #1); repoint the
`["whitespace-only avoid", …]` refusal-table row to another field (line 332); narrow the
`expectTypeOf(args.note)` to 3 fields (line 843).

**(C) `test/edge-cases.test.ts`** — remove `avoid: "h"` from the marker-factory inline note (line 286);
merge `VALID_NOTE.avoid` into `what_happened` (line 307); drop `"avoid"` from the field loop (line 685);
repoint `validateNote({...VALID_NOTE, avoid: "  "})` to another field (line 701).

**(D) `test/markers.test.ts`** — merge `REWIND_DATA.note.avoid` into `what_happened` (line 126 — CRITICAL
FINDING #2).

### Success Criteria

- [ ] `npm test` → 956 passed, 0 failed.
- [ ] `npm run typecheck` → zero errors.
- [ ] `grep -rn "avoid" test/notes.test.ts test/tools/rewind.test.ts test/edge-cases.test.ts test/markers.test.ts` → no output.
- [ ] `grep -rn '\*\*Avoid:\*\*' test/` → no output.
- [ ] The `REWIND_DESC` snapshot (rewind.test.ts:290) asserts the NEW text ("hidden from your context going forward").
- [ ] No `src/` file is modified.

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes** — this PRP includes: the VERIFIED line number for every touchpoint (confirmed via tsc + vitest on
the live codebase), the EXACT current→target text for each edit (incl. the merged `what_happened` strings
per file), the `renderNote` output format (post-S1) with a copy-pasteable snapshot-fix pattern, the two
scope gaps the item missed (with rationale), the list of `avoid` references that are SAFE to leave (cast-
erased), and the exact validation commands. The implementer reads the four test files + this PRP and edits.

### Documentation & References

```yaml
# MUST READ — the code under test
- file: src/notes.ts
  why: S1 output — NoteInput is now 3-field (what_happened/true_current_state/next). renderNote() emits
        header → What happened → Current true state → [ledger] → Next (NO Avoid line). NOTE_FIELDS has 3 entries.
        validateNote checks only those 3 (extra keys ignored → forward-compat for old persisted markers).
  pattern: sections.join("\n\n"); ledger blocks pushed only when non-empty, between true_state and Next.
  critical: the rendered note has NO `**Avoid:**` line anywhere — snapshots that still assert it fail vitest.

# MUST READ — the four test files being edited (verified line numbers)
- file: test/notes.test.ts
  why: VALID_NOTE (line 16-22), FIELDS (line 42), two avoid:null validateNote cases (67, 87), inline notes
        (98, 323), inline validateNote literal (107), expectTypeOf (149), two renderNote snapshots (187, 215).
  pattern: snapshots build the expected string as `[...].join("\n")` — remove the `""` + `**Avoid:**` entry.
- file: test/tools/rewind.test.ts
  why: VALID_NOTE (line 53-55), REWIND_DESC snapshot (line 290 — CRITICAL FINDING #1), refusal table (332),
        expectTypeOf on RewindArgs.note (843-848).
  pattern: the REWIND_DESC snapshot is a single `.toBe("…")` string — replace with S2's new full string.
- file: test/edge-cases.test.ts
  why: marker-factory inline note (286), VALID_NOTE (305-307), field loop (685), validateNote avoid:'  ' (701).
- file: test/markers.test.ts
  why: REWIND_DATA: RewindMarkerInput (line 118-132) — note.avoid at 126 (CRITICAL FINDING #2; tsc TS2353).
  pattern: the fixture is TYPED (RewindMarkerInput) → excess property IS a tsc error (unlike the cast-erased
        fixtures in audit/cancel tests). Merge avoid into what_happened (line 123) and delete line 126.

# The S2 implementation contract (what REWIND_DESC + schema become)
- file: plan/006_5b685875f3df/P1M1T1S2/PRP.md
  why: S2 PRP Task 3 gives the EXACT new REWIND_DESC string for the rewind.test.ts:290 snapshot update.
  critical: the changed substring is "disappears from your view permanently" → "hidden from your context
        going forward"; the clause "(it stays on disk for the human)" STAYS. Copy the full string from S2's
        PRP Task 3 target (or read the landed src/tools/rewind.ts REWIND_DESC after S2 merges).

# The authoritative scope + verification (confirms what does/doesn't break)
- docfile: plan/006_5b685875f3df/architecture/system_context.md
  why: §Touchpoint Map (test rows) + §Verification of PRD Claims. Confirms markers.ts auto-adapts (type-only
        NoteInput import — no src edit), nudges.test.ts/drift_nudge.test.ts auto-adapt (no test edit), and
        flags edge-cases.test.ts as having avoid refs the PRD's M1.T1.S3 originally under-specified.
  critical: the Touchpoint Map lists only 3 test files + nudges/drift verify-only — it does NOT call out
        markers.test.ts:126 or rewind.test.ts:290. THIS PRP adds both (verified breakages). If you only follow
        the arch map, `npm run typecheck` and `npm test` will both stay red.

# Research notes (this PRP's own — per-line current→target tables)
- docfile: plan/006_5b685875f3df/P1M1T1S3/research/touchpoint_verification.md
  why: verified line numbers + current/target text for every touchpoint across all 4 files, plus the list of
        SAFE-to-leave avoid refs (audit/cancel/drift/smoke — cast-erased, do not break either gate).
- docfile: plan/006_5b685875f3df/P1M1T1S3/research/renderNote_format_and_merge.md
  why: the post-S1 renderNote output format, the copy-pasteable snapshot-fix pattern (which "" lines to
        remove), and the per-file merged what_happened strings.
```

### Current Codebase tree (test surface)

```bash
test/
├── notes.test.ts                 # ← EDIT (A): VALID_NOTE, FIELDS, validateNote cases, expectTypeOf, 2 snapshots
├── markers.test.ts               # ← EDIT (D): REWIND_DATA.note.avoid (CRITICAL FINDING #2 — tsc)
├── edge-cases.test.ts            # ← EDIT (C): marker note (286), VALID_NOTE (307), field loop (685), validateNote (701)
├── tools/
│   ├── rewind.test.ts            # ← EDIT (B): VALID_NOTE (54), REWIND_DESC snapshot (290), refusal table (332), expectTypeOf (843)
│   ├── audit.test.ts             # SAFE — avoid inside `as unknown as SessionEntry`; no edit needed
│   └── cancel.test.ts            # SAFE — avoid inside `as unknown as SessionEntry`; no edit needed
├── drift_nudge.test.ts           # SAFE — `as never` cast + loose assertions; no edit needed
└── integration/smoke.ts          # NOT run by vitest (not *.test.ts); avoid ignored at runtime. OPTIONAL cleanup.
```

### Desired Codebase tree (files this PRP touches)

```bash
# NO new files. 4 test files edited (3 listed + markers.test.ts):
test/notes.test.ts            # ~10 edits (VALID_NOTE merge, FIELDS, 4 validateNote/inline cases, expectTypeOf, 2 snapshots)
test/tools/rewind.test.ts     # 4 edits (VALID_NOTE merge, REWIND_DESC snapshot, refusal row, expectTypeOf)
test/edge-cases.test.ts       # 4 edits (marker note, VALID_NOTE merge, field loop, validateNote)
test/markers.test.ts          # 1 edit (REWIND_DATA.note merge — delete avoid line)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (vitest does NOT type-check — esbuild strips types). So a `tsc` excess-property error
//   (e.g. an object literal with an extra `avoid` key) does NOT fail `npm test` UNLESS a runtime assertion
//   depends on it. Conversely, `expectTypeOf<X>().toEqualTypeOf<Y>()` IS evaluated by vitest's type-aware
//   runner → a mismatch FAILS `npm test`. So: drop `avoid` from BOTH the type assertions (vitest gate) AND
//   the typed literals (tsc gate). The cast-erased fixtures (`as unknown as SessionEntry`) need NO edit.

// CRITICAL GOTCHA #2 (two gates, both must be green). The item says "Run npm test". ALSO run
//   `npm run typecheck` — markers.test.ts:126 breaks tsc only (not vitest). Both gates are S3's bar.

// GOTCHA #3 (the snapshot fix is a 3-line removal, not 1). In notes.test.ts the expected string is
//   `[...].join("\n")`. The Avoid block is: `""` (blank) + `**Avoid:** ${…}` + `""` (blank). Remove the
//   `**Avoid:**` entry AND ONE of the two surrounding `""` so exactly ONE blank separates "What happened"
//   from "Current true state" (matches renderNote's sections.join("\n\n")). See research/renderNote_format.

// GOTCHA #4 (REWIND_DESC snapshot — copy the FULL new string, don't substring). rewind.test.ts:290 asserts
//   the ENTIRE REWIND_DESC verbatim. Get the new full string from S2's landed src/tools/rewind.ts (or S2's
//   PRP Task 3 target). Only one substring changed; everything else (incl. "(it stays on disk for the
//   human)" and "Costs only a short note.") is identical.

// GOTCHA #5 (the merge wording is NOT load-bearing). The snapshots interpolate `VALID_NOTE.what_happened`,
//   so whatever you merge from `avoid` round-trips into the assertion. What IS load-bearing: `avoid` must
//   be ABSENT from the typed literal (tsc) and the snapshots must not reference `VALID_NOTE.avoid` (it's
//   now undefined → snapshot would read "undefined"). Use the `; `-join from the item contract.

// GOTCHA #6 (markers.test.ts:177 `expect(entry.note).toEqual(REWIND_DATA.note)` is SELF-SYMMETRIC). If you
//   merge avoid into what_happened in BOTH the input (REWIND_DATA.note) and... wait, the appendRewindMarker
//   wrapper stamps envelope fields but passes `note` through verbatim. So entry.note === REWIND_DATA.note
//   regardless. Just ensure REWIND_DATA.note has 3 fields (merge the avoid). The assertion stays green.

// GOTCHA #7 (.js ESM import paths). Test files import from "../../src/notes.js" etc. Don't change imports.
```

## Implementation Blueprint

### Data models and structure

No data-model change. This item reuses `NoteInput` (3-field, post-S1), `RewindArgs` (3-field note, post-S2),
and `RewindMarkerInput` (note typed `NoteInput`, auto-adapted). The edits are fixture-literal + assertion
text only — no type, no schema.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT test/notes.test.ts — VALID_NOTE + FIELDS + validateNote cases + inline notes
  - LINE 16-22 (VALID_NOTE): merge avoid into what_happened → "Ran a repo-wide grep that dumped ~38k tokens
        I didn't need; do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool
        which truncates." DELETE the `avoid:` line.
  - LINE 42 (FIELDS): `["what_happened", "avoid", "true_current_state", "next"]` → drop "avoid" → 3 entries.
        (The parametrized empty/whitespace loops over FIELDS auto-adapt — no per-case edit needed.)
  - LINE 67: `validateNote({...VALID_NOTE, avoid: null as unknown as string})` → repoint to
        `true_current_state: null as unknown as string` (keeps the "invalid" assertion valid).
  - LINE 87: same pattern → repoint to a DIFFERENT field (e.g. `what_happened: null`) for variety.
  - LINE 98: inline note `avoid: " don't grep without filters "` → DELETE the line (or merge).
  - LINE 107: `validateNote({what_happened:"x", avoid:"y", true_current_state:"z", next:"w"})` → drop avoid
        → `validateNote({what_happened:"x", true_current_state:"z", next:"w"})`.
  - LINE 323: inline note `avoid: "don't run wide grep; use **-l** or pipe to head"` → DELETE (or merge).
  - FOLLOW pattern: every typed note literal must have EXACTLY 3 keys (what_happened/true_current_state/next).
  - DEPENDENCIES: S1 (notes.ts NoteInput is 3-field).

Task 2: EDIT test/notes.test.ts — expectTypeOf + renderNote snapshots
  - LINE 149: `expectTypeOf<NoteInput>().toEqualTypeOf<{what_happened:string; avoid:string;
        true_current_state:string; next:string}>()` → drop `avoid: string;` (3 fields). (vitest runs this.)
  - LINE 187 (empty-ledger snapshot): remove the `""` + `` `**Avoid:** ${VALID_NOTE.avoid}` `` + one `""`
        from the array — keep ONE `""` between What happened and Current true state. Also remove the
        `**Avoid:**` reference (VALID_NOTE.avoid no longer exists → would be undefined).
  - LINE 215 (full-ledger snapshot): same removal of the `**Avoid:**` block (the ledger <files-read> etc.
        blocks stay AFTER Current true state, BEFORE Next).
  - VERIFY: after this, `renderNote(VALID_NOTE, EMPTY_LEDGER, "last_turn")` produces header / What happened
        / Current true state / Next joined by "\n\n" — match the post-S1 renderNote exactly.
  - DEPENDENCIES: Task 1 (VALID_NOTE merged).

Task 3: EDIT test/tools/rewind.test.ts — VALID_NOTE + REWIND_DESC snapshot + refusal table + expectTypeOf
  - LINE 53-55 (VALID_NOTE): merge avoid → "Ran a repo-wide grep that dumped ~38k tokens; don't grep without
        -l; use the built-in grep tool which truncates." DELETE the avoid line.
  - LINE 290 (CRITICAL FINDING #1): replace the `.toBe("…disappears from your view permanently…")` string
        with S2's new full REWIND_DESC: `"...The content is hidden from your context going forward (it stays
        on disk for the human)..."`. READ the landed src/tools/rewind.ts REWIND_DESC (or S2 PRP Task 3) and
        paste it verbatim — only the one substring changed.
  - LINE 332 (refusal table): `["whitespace-only avoid", {...VALID_NOTE, avoid: "   "}]` →
        `["whitespace-only true_current_state", {...VALID_NOTE, true_current_state: "   "}]`.
  - LINE 843-848 (expectTypeOf): drop `avoid: string;` from the expected note object type (3 fields).
  - DEPENDENCIES: S2 (rewind.ts REWIND_DESC + schema landed).

Task 4: EDIT test/edge-cases.test.ts — marker note + VALID_NOTE + field loop + validateNote
  - LINE 286 (marker-factory inline note): `note: {what_happened:"p", avoid:"h", true_current_state:"n",
        next:"e"}` → delete `avoid: "h",` → 3 keys. (tsc didn't flag this — likely cast — but it's a stale ref.)
  - LINE 305-307 (VALID_NOTE): merge avoid → "Ran a repo-wide grep that dumped ~38k tokens; don't grep
        without -l; use the built-in grep tool which truncates." DELETE the avoid line.
  - LINE 685 (field loop): `for (const field of ["what_happened","avoid","true_current_state","next"])` →
        drop "avoid" → 3 fields. (The loop body sets each field to "   " and asserts refusal — auto-adapts.)
  - LINE 701: `expect(validateNote({...VALID_NOTE, avoid: "  "}).valid).toBe(false)` → repoint to
        `true_current_state: "  "`.
  - DEPENDENCIES: Task validation after all edits.

Task 5: EDIT test/markers.test.ts — REWIND_DATA.note merge (CRITICAL FINDING #2)
  - LINE 118-132 (REWIND_DATA: RewindMarkerInput): merge note.avoid into note.what_happened →
        "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool
        which truncates." DELETE the `avoid:` line (line 126). KEEP true_current_state + next unchanged.
  - WHY: RewindMarkerInput.note is typed NoteInput (3-field) → the avoid literal is a TS2353 tsc error.
        Line 177 `expect(entry.note).toEqual(REWIND_DATA.note)` is self-symmetric → vitest already passes,
        but tsc fails. Merging fixes tsc without touching the assertion.
  - DEPENDENCIES: none (pure fixture edit).

Task 6: VALIDATE (no edits)
  - RUN `npm test` → expect 956 passed, 0 failed.
  - RUN `npm run typecheck` → expect zero errors.
  - GREP `grep -rn "avoid" test/notes.test.ts test/tools/rewind.test.ts test/edge-cases.test.ts test/markers.test.ts`
        → expect no output.
  - GREP `grep -rn '\*\*Avoid:\*\*' test/` → expect no output.
  - DEPENDENCIES: Tasks 1-5.
```

### Implementation Patterns & Key Details

```ts
// ── The merge (apply per-file to each VALID_NOTE / REWIND_DATA.note) ────────────────────────────────
// BEFORE:                                     // AFTER:
// const VALID_NOTE: NoteInput = {             // const VALID_NOTE: NoteInput = {
//   what_happened: "<what>",                  //   what_happened: "<what>; <avoid>",   // avoid folded in
//   avoid: "<avoid>",                         //   true_current_state: "<...>",
//   true_current_state: "<...>",              //   next: "<...>",
//   next: "<...>",                            // };
// };

// ── The renderNote snapshot fix (notes.test.ts ~187/215) ───────────────────────────────────────────
// Remove the Avoid block AND one of its flanking blanks so exactly ONE blank separates the two sections:
//   [...,                                        //   [...,
//    `**What happened:** ${…}`,                  //    `**What happened:** ${…}`,
//    "",                                         //    "",
//    `**Avoid:** ${VALID_NOTE.avoid}`,   // ←    `**Current true state:** ${…}`,
//    "",                                  // ←    "",
//    `**Current true state:** ${…}`,             //    `**Next:** ${…}`,
//    "",                                        //   ].join("\n");
//    `**Next:** ${…}`,
//   ].join("\n");

// ── The REWIND_DESC snapshot (rewind.test.ts ~290) ─────────────────────────────────────────────────
// expect(REWIND_DESC).toBe(
//   "Shed recent context you produced by mistake ... a clean view. " +
//   "The content is hidden from your context going forward (it stays on disk for the human). " +  // ← changed
//   "Costs only a short note. Use granularity 'last_tool_call_group' ... 'last_turn' ..."
// );
// Copy the FULL string from the landed src/tools/rewind.ts REWIND_DESC constant (S2 owns it).
```

### Integration Points

```yaml
TEST RUNNER:
  - command: "npm test"                    # vitest run — the primary gate (956 tests)
  - command: "npm run typecheck"           # tsc --noEmit — the secondary gate (zero errors)
  - command: "grep -rn 'avoid' test/notes.test.ts test/tools/rewind.test.ts test/edge-cases.test.ts test/markers.test.ts"
  - command: "grep -rn '\\*\\*Avoid:\\*\\*' test/"

NO SOURCE CHANGES:
  - this PRP touches ONLY the 4 test files listed above.
  - do NOT modify src/notes.ts (S1), src/tools/rewind.ts (S2), src/markers.ts (auto-adapts).
  - do NOT modify the SAFE files: audit.test.ts, cancel.test.ts, drift_nudge.test.ts (cast-erased refs).

NO CONFIG / DATABASE / ROUTE / REGISTRATION CHANGES.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing each file, typecheck the whole project (cheap, catches missed avoid refs):
npm run typecheck
# Expected: ZERO errors. If errors remain, grep the cited file for "avoid" — you missed a typed literal.
# Common misses: markers.test.ts:126 (Task 5), a second validateNote case in notes.test.ts (Task 1 line 87).

# The decisive greps — confirm no avoid/**Avoid** remains in the 4 edited files:
grep -rn "avoid" test/notes.test.ts test/tools/rewind.test.ts test/edge-cases.test.ts test/markers.test.ts
grep -rn '\*\*Avoid:\*\*' test/
# Expected: no output from both.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run each edited file in isolation as you finish it (fast feedback):
npx vitest run test/notes.test.ts
npx vitest run test/tools/rewind.test.ts
npx vitest run test/edge-cases.test.ts
npx vitest run test/markers.test.ts
# Expected: each green. If notes.test.ts snapshot fails, READ the diff — you removed the wrong "" count (GOTCHA #3).

# Full suite — the PRIMARY gate:
npm test
# Expected: 956 passed, 0 failed. Currently 12 fail (in notes/rewind/edge-cases); after S3 all green.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for a test-only item — there is no server/endpoint. The "integration" is the full vitest suite above.
# Optional: the smoke harness (NOT run by vitest — separate `npm run smoke`). It has a stale "4-field" comment
# at smoke.ts:66 and SMOKE_NOTE.avoid at :67, but validateNote ignores the extra key at runtime (forward-compat).
# It is OPTIONAL cleanup — not required for `npm test` or `npm run typecheck` green.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the merged note still round-trips through validateNote (the confabulation defense still fires):
#   every edited VALID_NOTE must still have 3 non-empty fields → validateNote(VALID_NOTE).valid === true.
#   (The parametrized whitespace tests in notes.test.ts + edge-cases.test.ts cover the negative.)

# Confirm no OTHER test regressed (the 944 currently-passing tests stay green). If a previously-green test
# turns red, you over-edited (e.g. removed a field that wasn't `avoid`, or broke a snapshot's ledger block).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` → 956 passed, 0 failed.
- [ ] `npm run typecheck` → zero errors (incl. markers.test.ts:126 fixed).
- [ ] `grep -rn "avoid" test/notes.test.ts test/tools/rewind.test.ts test/edge-cases.test.ts test/markers.test.ts` → no output.
- [ ] `grep -rn '\*\*Avoid:\*\*' test/` → no output.

### Feature Validation

- [ ] All 4 edited files have no `avoid` references.
- [ ] Every `renderNote` snapshot asserts the 3-section format (header → What happened → Current true state → [ledger] → Next).
- [ ] Both `expectTypeOf` note-shape assertions (notes.test.ts:149, rewind.test.ts:843) are 3-field.
- [ ] rewind.test.ts:290 `REWIND_DESC` snapshot matches S2's new string.
- [ ] All repointed validateNote/refusal cases still assert the "invalid/refused" outcome correctly.

### Code Quality Validation

- [ ] Follows existing test idioms (vitest, expectTypeOf, `.js` imports, `[...].join("\n")` snapshots).
- [ ] The merge uses the item's `;`-join convention consistently across all 4 files.
- [ ] No `src/` file modified; no new files created.
- [ ] The SAFE files (audit/cancel/drift/smoke) are left alone (or only optionally cleaned).

### Documentation & Deployment

- [ ] [Mode A] no user-facing docs (test-only; per SOW §5 docs ride with S1/S2, not S3).
- [ ] Test comments that said "4-field"/"four" updated to "3-field"/"three" where present (e.g. edge-cases:684
      "in EACH of the 4 fields", notes.test.ts comment if any).

---

## Anti-Patterns to Avoid

- ❌ Don't edit `src/` files — S1 owns notes.ts, S2 owns rewind.ts, markers.ts auto-adapts. This is test-only.
- ❌ Don't fix only the 3 files the item body lists — markers.test.ts:126 (tsc) and rewind.test.ts:290
  (REWIND_DESC snapshot) ALSO break and are in S3's scope. Skipping them leaves `npm run typecheck` and
  `npm test` red (CRITICAL FINDING #1 and #2).
- ❌ Don't remove BOTH blanks around `**Avoid:**` in the snapshot — renderNote joins sections with exactly one
  `\n\n`, so keep ONE `""` between What happened and Current true state (GOTCHA #3).
- ❌ Don't reference `VALID_NOTE.avoid` anywhere after merging — it's now `undefined` and the snapshot would
  render the literal text "undefined". Delete every `**Avoid:** ${VALID_NOTE.avoid}` interpolation.
- ❌ Don't paraphrase the REWIND_DESC snapshot — copy the EXACT full string from the landed rewind.ts (GOTCHA #4).
- ❌ Don't touch the cast-erased fixtures (audit.test.ts:230, cancel.test.ts:175, drift_nudge.test.ts:48) —
  they don't break either gate; editing them is scope creep and risks merge conflicts.
- ❌ Don't rely on `npm test` alone — run `npm run typecheck` too (markers.test.ts breaks only tsc; GOTCHA #2).
- ❌ Don't change the merge wording per-file into something inconsistent — use the item's `; `-join so the
  merged `what_happened` reads naturally across all four fixtures.

---

## Decision Log

- **D1 — Include markers.test.ts:126 despite the item body omitting it.** The item's CONTRACT lists 3 files,
  but its OUTPUT criterion is "no references to `NoteInput.avoid`" and "all 956+ tests green". `markers.test.ts:126`
  IS a `NoteInput.avoid` reference (typed `RewindMarkerInput.note`), and it breaks `npm run typecheck` (TS2353).
  It doesn't fail vitest (self-symmetric assertion at :177), but leaving it means a red typecheck — violating the
  spirit of the OUTPUT criterion. S2's PRP GOTCHA #4 also attributes test tsc errors to S3. Decision: FIX it (merge
  avoid into what_happened, 1-line edit). Documented as CRITICAL FINDING #2.

- **D2 — Include rewind.test.ts:290 (REWIND_DESC snapshot) in S3.** S2 changes the REWIND_DESC substring. The
  verbatim-string snapshot at rewind.test.ts:290 breaks vitest as a result. S3 owns rewind.test.ts, so S3 updates
  the snapshot. The item body focused on `avoid` touchpoints and missed this DESC-text consequence. Decision: FIX it
  (paste S2's new full string). Documented as CRITICAL FINDING #1.

- **D3 — Leave audit/cancel/drift/smoke `avoid` refs alone (OPTIONAL cleanup).** Verified they don't break either
  gate: audit.test.ts:230 + cancel.test.ts:175 are inside `as unknown as SessionEntry` (cast erases the excess-
  property check; validateNote is never called on them); drift_nudge.test.ts:48 uses `as never`; smoke.ts is not a
  *.test.ts (vitest ignores it) and validateNote ignores the extra key at runtime (forward-compat). Editing them is
  scope creep with merge-conflict risk. Decision: document as SAFE-to-leave; mention smoke.ts as optional.

- **D4 — Merge with `; `-join (item contract), accept the avoid content's internal `;`.** The item says join with
  `;`. Some avoid strings already contain `;` (e.g. "…head; prefer…"). The merged what_happened reads fine with
  multiple `;` (it's prose, not a delimiter parser). The merge wording is not load-bearing for tests (snapshots
  interpolate the field). Decision: follow the item's `; `-join verbatim.

---

## Confidence Score: 10/10

**Why 10**: Every touchpoint is verified against the live codebase (tsc + vitest + direct file reads), with
exact current→target text per line, the post-S1 renderNote format, copy-pasteable snapshot-fix patterns, and
the two scope gaps the item missed explicitly called out. The validation commands are confirmed working
(`npm test` = `vitest run`, `npm run typecheck` = `tsc --noEmit`). The only external dependency is S2 landing
its REWIND_DESC text — and the PRP tells the implementer to copy the exact string from the landed rewind.ts.
An implementer who reads this PRP + the four test files + the landed rewind.ts can make all edits correctly
on the first pass and confirm green via `npm test` + `npm run typecheck`.