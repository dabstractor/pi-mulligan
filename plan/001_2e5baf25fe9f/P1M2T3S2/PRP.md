# PRP — P1.M2.T3.S2: `renderNote(note, ledger, granularity)` with conditional ledger blocks

**Work item:** P1.M2.T3.S2 · **Points:** 1 · **Stage:** Pure Helper Library → Note Validation & Rendering
**Scope:** **APPEND to two existing files** — `src/notes.ts` (the `renderNote` pure function + two module-private
helpers + two `import type` lines) and `test/notes.test.ts` (vitest Tier-1 renderNote tests). **No other file is
touched.** Zero Pi dependency; `renderNote` never throws. This is **S2 of a 3-part `notes.ts`** (S1 = `validateNote`
+ `NoteInput`, DONE; S3 = `renderBloatReminder` + `renderDriftNudge`, LATER) — S2 ships ONLY `renderNote`.

> **IMPLEMENTATION STATUS (parallel race — READ FIRST):** While this PRP was being researched, a parallel
> implementer landed S2 concurrently. As of writing, `src/notes.ts` already contains `renderNote` (+ `readNoteField`/
> `readLedgerList` + the two `import type` lines) and `test/notes.test.ts` already contains the renderNote tests
> (notes suite grew 25→41; **verified: 6 files / 187 tests green, `npx tsc --noEmit -p tsconfig.json` exit 0**). The
> landed code matches this PRP's design nearly verbatim (both derive from spec/04 §2.3 with the same `join("\n\n")`
> insight, reusing S1's `readOwn`). **Therefore this PRP is now the authoritative SPECIFICATION + VERIFICATION
> CONTRACT for S2**, not a greenfield to-do. The implementer/reviewer's job is to **VERIFY the on-disk renderNote
> against the acceptance criteria below** (pinned format tests, the 12 GOTCHAs, the validation gates). If anything
> diverges, fix the code to match the spec-pinned contract in this PRP. The exact code in Task 1/2 is the reference
> implementation; if the on-disk code already equals it, the validation gates are the deliverable.
>
> (Original parallel-context note, now superseded: S1 `validateNote`+`NoteInput` landed before S2 — `src/notes.ts` and
> `test/notes.test.ts` already existed. S2 reuses S1's module-private `isRecord`/`readOwn`, consumes the `NoteInput`
> export verbatim, and does NOT touch S1's exports.)

---

## Goal

**Feature Goal**: Ship Mulligan's **note renderer** — a pure, Pi-free, side-effect-free function that composes the
markdown note the resumed model reads, per `spec/04-data-model.md §2.3`. It interpolates the (already-validated)
`NoteInput` + the deterministic `FileLedger` + the `Granularity` into the pinned `mulligan:note` shape: a
`## 🔄 Mulligan rewind (<granularity>)` header, four bold-label body lines (`**What happened:**` / `**Avoid:**` /
`**Current true state:**` / `**Next:**`), and **conditional** `<files-read>` / `<files-modified>` /
`<bash-side-effects>` block tags (each **omitted entirely** when its ledger list is empty). Sections are separated
by exactly one blank line; no trailing newline.

**Deliverable** (APPEND to two EXISTING files — do NOT rewrite either):
1. `src/notes.ts` — APPEND:
   - **two `import type` lines at the very top of the file** (above the existing module doc comment):
     `import type { FileLedger } from "./ledger.js";` and `import type { Granularity } from "./config.js";`
     (TYPE-ONLY — erased at compile time; notes.ts stays Pi-free. This is the import S1 anticipated — see S1
     PRP GOTCHA #2; notes.ts is the pure-helper tier, NOT a permanent zero-imports gate.)
   - `export function renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string` — builds
     the markdown per spec/04 §2.3 by joining sections with `"\n\n"`. Each ledger block is
     `<tag>\n` + `items.join("\n")` + `\n</tag>`; a block is **pushed only when its list is non-empty** (spec/04
     §2.3: "If a ledger list is empty, omit its block").
   - two module-private helpers: `readNoteField` (read a NoteInput field as a string, `""` if absent/non-string)
     and `readLedgerList` (read a FileLedger list as a filtered `string[]`, `[]` if absent/non-array). Both reuse
     S1's `readOwn`/`isRecord` — do NOT redefine those.
   - **REUSES** S1's existing exports + `isRecord`/`readOwn` unchanged. S1's `validateNote`/`NoteInput`/
     `NOTE_INVALID_REASON` are NOT modified.
2. `test/notes.test.ts` — APPEND: add `renderNote` + `type FileLedger` + `type Granularity` to the imports, add an
   `EMPTY_LEDGER` constant, and APPEND `renderNote` `describe` blocks (pinned `.toBe()` format tests +
   `toMatchInlineSnapshot()` representative-note cases). Mirror `test/tokens.test.ts`/`test/ledger.test.ts`
   conventions (no `beforeEach`; `describe`/`it`/`expect`/`expectTypeOf`).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (new code + tests type-sound under `strict`).
- `npx vitest run` is **all-green** — the grown `notes` suite **AND** the pre-existing suites (baseline
  6 files / 171 tests → 6 files / 171+N; renderNote tests are additive).
- `renderNote` **never throws** (defensive on null/array note, throwing-Proxy note, null/non-array ledger, empty
  ledger lists) — it sits on the rewind-tool hot path (spec/05 §1 step 5; E13 discipline).
- The **pinned format contract (spec/04 §2.3 + spec/10 §1.8)**: the rendered string EXACTLY matches the spec's
  markdown shape — header with verbatim granularity, bold body lines, ledger blocks in `read→modified→bash` order,
  each omitted when empty, sections separated by one blank line, no trailing newline.

---

## User Persona

**Target User**: The implementing AI agent for `tools/rewind.ts` (`mulligan_rewind`, P1.M5.T1.S1) — the SOLE runtime
consumer in v1. The rewind tool, in **step 5 of its behavior** (spec/05 §1 step 5), calls
`renderNote(note, ledger, granularity)` **after** `validateNote(note)` has passed (step 2) and after the ledger is
composed. It takes the returned string and uses it **verbatim** as the `content` of the `mulligan:note`
`CustomMessage`: `pi.sendMessage({ customType:"mulligan:note", content: <rendered>, display:true,
details:{ schema:"pi-mulligan", v:1, kind:"note", rewindId: id } })` (spec/05 §1 step 6; spec/04 §3). The SECOND
consumer is the test suite (spec/10 §1.8: "Snapshot tests for representative notes").

**Use Case**: An agent just wasted a turn (e.g. a 40k-token `grep`) and calls
`mulligan_rewind(note:{what_happened, avoid, true_current_state, next}, granularity:"last_tool_call_group")`. After
validation passes, the tool extracts the file ledger of the abandoned span and calls
`renderNote(note, ledger, "last_tool_call_group")`. The returned markdown becomes the note the **resumed model
reads** at the top of its fresh context — telling it what happened, what to avoid, the true on-disk state, and the
next action. The note is Mulligan's **primary defense against confabulation** (D2): the resumed model is told
explicitly what happened so it does not invent it. `renderNote` is the function that turns the structured inputs
into that readable, machine-parseable markdown.

**User Journey**:
1. Agent calls `mulligan_rewind(note, granularity)`; tool step 2 `validateNote(note)` ⇒ `{valid:true}`.
2. Tool step 5 composes the `FileLedger` (P1.M2.T2.S1 `extractFileLedger`), then calls
   `renderNote(note, ledger, granularity)` ⇒ the note markdown string.
3. Tool step 6 persists `RewindMarker.note = note` + `RewindMarker.ledger = ledger` (spec/04 §3) AND
   `pi.sendMessage({ customType:"mulligan:note", content: <rendered>, display:true, ... })`.
4. On the next inference, the model sees `[kept prefix] + [the rendered mulligan:note] + [rewind confirmation]`
   (spec/03 §architecture) — its fresh start, informed by the note.

**Pain Points Addressed**: Without a rendered note, a rewind leaves a **context gap** the resumed model would
**confabulate** (invent) its way through (D/D17). `renderNote` produces the durable, structured, machine-readable
message that bridges the gap — the agent's own what/avoid/state/next, augmented by the deterministic file ledger
so the model does not redo side-effectful work (E5).

---

## Why

- **Unblocks `tools/rewind.ts` (P1.M5.T1.S1) — step 5 needs `renderNote`.** spec/05 §1 step 5 names it directly:
  "`renderNote(note, ledger, granularity)` → the note string." The tool cannot ship without it. Shipping the pure
  renderer now (pure-helper tier, alongside `tokens.ts`/`ledger.ts`) lets the downstream tool focus on glue.
- **The note is the confabulation defense (D2) — and `renderNote` is how it becomes readable.** spec/04 §2.1:
  *"This structure is the primary defense against confabulation."* The structured `NoteInput` is the SUBSTANCE;
  `renderNote` is the FORM — the markdown the resumed model actually reads. A correct, spec-exact renderer is
  load-bearing for the entire safety property.
- **Spec-pinned format → deterministic, no judgement calls.** The exact markdown (header string, bold labels,
  block tags, blank-line separation, omission rule) is pinned verbatim in spec/04 §2.3. There is nothing to
  invent — implement the shape exactly, omit empty blocks, join with blank lines.
- **Pure-helper tier & unit-testable in isolation.** renderNote imports ONLY types (erased at compile time) from
  sibling pure modules (`ledger.ts`, `config.ts`); it has no Pi, no model, no session, no I/O. It is the kind of
  pure function the test suite (spec/10 §1) covers with fast snapshot-style unit tests.

---

## What

APPEND `renderNote` to `src/notes.ts`. The function:

- **Reads** the 4 note fields (defensively, via `readOwn` — Proxy-safe, never throws) and the 3 ledger lists
  (defensively — `Array.isArray` guard).
- **Builds a `sections: string[]`** in fixed order: the header line, the three "What happened"/"Avoid"/"Current
  true state" bold lines, then (conditionally) each non-empty ledger block, then the "Next" line.
- **Interpolates granularity verbatim** into the header: `` `## 🔄 Mulligan rewind (${granularity})` ``.
- **Formats each ledger block** as `<tag>\n` + `items.join("\n")` + `\n</tag>` and pushes it **only when its list
  is non-empty**.
- **Returns `sections.join("\n\n")`** — exactly one blank line between every pair of adjacent sections, no
  trailing newline. This automatically collapses correctly when ledger blocks are absent (no orphan blank lines).

This subtask does **NOT**: rewrite S1's `validateNote`/`NoteInput`/`NOTE_INVALID_REASON` (they are UNCHANGED);
implement `renderBloatReminder` / `renderDriftNudge` (S3 — it APPENDS later); implement the rewind tool
(P1.M5.T1.S1); re-validate the note inside `renderNote` (validateNote already ran at tool step 2); mutate inputs;
or widen the public signature.

### Success Criteria

- [ ] `src/notes.ts` APPENDS `renderNote` + the two `import type` lines + the two module-private helpers, leaving
      S1's exports and `isRecord`/`readOwn` UNCHANGED.
- [ ] `test/notes.test.ts` APPENDS `renderNote` test blocks (pinned `.toBe()` + `toMatchInlineSnapshot()`); the
      whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **Pinned format (spec/04 §2.3):** header = `## 🔄 Mulligan rewind (<granularity>)` with granularity
      verbatim; body = `**What happened:**`/`**Avoid:**`/`**Current true state:**`/`**Next:**` (bold label + space
      + value); sections separated by ONE blank line; NO trailing newline.
- [ ] **Conditional blocks:** a non-empty ledger list renders `<tag>\n<items joined by \n>\n</tag>`; an EMPTY list
      omits its block entirely (no orphan blank line).
- [ ] **Block ordering:** when multiple blocks are present, they appear in `files-read` → `files-modified` →
      `bash-side-effects` order (matching `FileLedger` field order).
- [ ] **All-empty ledger** → no block tags at all; output = `[header, What, Avoid, Current, Next].join("\n\n")`.
- [ ] **Never throws:** null/array/primitive note, throwing-Proxy note, null/non-array ledger, missing fields →
      renders gracefully, no exception; `expect(() => renderNote(...)).not.toThrow()`.
- [ ] **Signature is exactly** `renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string`
      (not widened to `| null`).
- [ ] **Snapshot tests (spec/10 §1.8):** representative notes captured via `toMatchInlineSnapshot()`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `renderNote` to APPEND is given verbatim below (Task 1) and the exact test
> additions (Task 2), including the pinned expected-output strings computed from spec/04 §2.3. The format is quoted
> verbatim from spec/04 §2.3; the omission rule + "snapshot-style" test mandate from spec/10 §1.8; the consumer
> contract from spec/05 §1 step 5/6. The type seams (`NoteInput`, `FileLedger`, `Granularity`) are quoted from the
> on-disk `src/notes.ts` / `src/ledger.ts` / `src/config.ts`. The baseline (6 files / 171 tests, tsc exit 0) and
> the snapshot convention (`toMatchInlineSnapshot`, `test/tokens.test.ts:48`) are verified live. No prior knowledge
> beyond "this APPENDS a pure helper to the S1 `notes.ts`" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/notes.ts` — it ALREADY EXISTS (S1 landed it).** This is **S2 of 3**: ship ONLY `renderNote` +
  the two `import type` lines + the two module-private helpers. **S3 (`renderBloatReminder`/`renderDriftNudge`)
  APPENDS later** and will reuse the same `isRecord`/`readOwn`. Do NOT touch S1's `validateNote`/`NoteInput`/
  `NOTE_INVALID_REASON`/`NOTE_FIELDS`.
- **APPEND to `test/notes.test.ts` — it ALREADY EXISTS (S1 landed it).** Keep S1's `validateNote` tests intact;
  add `renderNote` to the import and APPEND new `describe` blocks.
- **ADD `import type { FileLedger } from "./ledger.js"` + `import type { Granularity } from "./config.js"` at the
  very TOP of `src/notes.ts`.** TYPE-ONLY imports (erased at compile time). notes.ts is the pure-helper tier and
  is NOT bound to a permanent zero-imports gate (unlike tokens.ts/ledger.ts). S1's zero-imports gate was S1-ONLY
  (S1 PRP GOTCHA #2 explicitly anticipated these S2 imports).
- **Do NOT re-validate the note inside `renderNote`.** `validateNote` already ran at tool step 2 (spec/05 §1);
  renderNote's job is rendering, not policing. (Defensive reads via `readOwn` still apply — see GOTCHA #5.)
- **Do NOT widen the public signature.** The contract pins `renderNote(note: NoteInput, ledger: FileLedger,
  granularity: Granularity): string`. Keep it; use the internal `readOwn`/`isRecord` guards for runtime defense
  (mirrors S1's `validateNote(note: NoteInput)` + internal `isRecord` — S1 PRP GOTCHA #7).

### Documentation & References

```yaml
# MUST READ — authoritative sources for renderNote
- file: spec/04-data-model.md
  section: "§2.3 Rendered note (the CustomMessage content)"
  why: "THE source of the exact markdown shape — the header line ('## 🔄 Mulligan rewind (<granularity>)'), the
        four bold body lines, the three <files-read>/<files-modified>/<bash-side-effects> block tags, the
        omission rule ('If a ledger list is empty, omit its block'), the compaction-convention rationale, and the
        signature 'renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string is pure and
        unit-tested with snapshot-style cases.'"
  critical: "Sections separated by ONE blank line. Block = '<tag>\\n<items joined by \\n>\\n</tag>'. Omit empty
             blocks entirely. Granularity interpolated VERBATIM. No trailing newline."

- file: spec/10-testing.md
  section: "§1.8 renderNote / field validation"
  why: "THE Tier-1 test mandate: 'All four fields present → renders with ledger blocks; empty ledger lists →
        their blocks omitted. ... Snapshot tests for representative notes.' (The 'any empty field → validation
        refuses' half is validateNote/S1 — NOT renderNote.)"
  critical: "Snapshot tests for representative notes; pinned format assertions for the omission + ordering rules."

- file: spec/05-tools.md
  section: "§1 mulligan_rewind, steps 5 + 6 (Compose ledger + note; Persist)"
  why: "THE consumer contract: step 5 calls renderNote(note, ledger, granularity) → the note string; step 6 uses
        it VERBATIM as pi.sendMessage({ customType:'mulligan:note', content: <rendered>, display:true, ... }).
        Confirms renderNote runs AFTER validateNote (step 2) and AFTER ledger extraction — so inputs are already
        valid; renderNote just renders."
  critical: "renderNote's output is consumed VERBATIM as an agent-facing LLM context message — format fidelity matters."

- file: spec/03-architecture.md
  section: "§7 Module layout (line 183: notes.ts PURE: renderNote(note, ledger) + field validation)"
  why: "Confirms notes.ts is a pure helper (unit-testable without Pi/model/session). renderNote IS the 'renderNote'
        named there. Confirms renderNote is downstream of the marker but its OUTPUT feeds the context message."

- file: spec/11-build-order.md
  section: "§1 Repository layout (line 30: notes.ts PURE: validateNote, renderNote, renderBloatReminder, renderDriftNudge)"
  why: "Confirms notes.ts holds all 4 note helpers (S1 shipped validateNote; S2 ships renderNote; S3 appends the
        rest) AND test/notes.test.ts is the test file. Confirms notes.ts is the pure-helper tier (imports OK)."

# FILES TO CONSUME / APPEND TO (read-only contracts + the append targets)
- file: src/notes.ts
  why: "THE APPEND TARGET (S1 landed it). REUSE the module-private isRecord + readOwn (already defined ≈ lines
        120-140) — call readOwn from readNoteField/readLedgerList; do NOT redefine them. The NoteInput export is
        renderNote's first param. Leave validateNote/NoteValidation/NOTE_INVALID_REASON/NOTE_FIELDS UNCHANGED."
  pattern: "APPEND renderNote + readNoteField + readLedgerList at the END (after readOwn). Add the two import type
            lines at the very TOP. Mirror the S1→S2 append style used in tokens.ts ('P1.M2.T1.S2 additions')."
  gotcha: "S1 explicitly anticipated these S2 imports (S1 PRP GOTCHA #2). Do NOT add runtime imports — type-only only."

- file: src/ledger.ts
  why: "The FileLedger type seam: export interface FileLedger { readFiles: string[]; modifiedFiles: string[];
        bashSideEffects: string[] }. renderNote reads these three arrays (defensively)."
  pattern: "import type { FileLedger } from './ledger.js' — TYPE-ONLY (no runtime coupling; ledger stays Pi-free)."

- file: src/config.ts
  why: "The Granularity type seam: export type Granularity = 'last_tool_call_group' | 'last_turn' | 'checkpoint'.
        Interpolated VERBATIM into the header."
  pattern: "import type { Granularity } from './config.js' — TYPE-ONLY."

- file: test/notes.test.ts
  why: "THE APPEND TARGET (S1 landed it). Keep S1's validateNote tests intact. Add renderNote to the import +
        import type { FileLedger } from '../src/ledger.js' + import type { Granularity } from '../src/config.js';
        APPEND renderNote describe blocks. Reuse the S1 VALID_NOTE constant."
  pattern: "Mirror test/tokens.test.ts (toMatchInlineSnapshot at line 48) + test/ledger.test.ts (toEqual for shapes)."

- file: test/tokens.test.ts
  why: "The snapshot convention: expect(...).toMatchInlineSnapshot(`11`) at line 48. Confirms vitest inline
        snapshots are the house style + how to assert a deterministic scalar/string output."
  pattern: "toMatchInlineSnapshot() — vitest auto-writes NEW inline snapshots on first run; provide the value
            pre-filled when you can, else run `npx vitest run -u` once to populate."

- file: plan/001_2e5baf25fe9f/P1M2T3S1/PRP.md
  why: "The S1 contract (the parallel predecessor, now LANDED). Confirms NoteInput's exact shape + field names, the
        isRecord/readOwn helpers renderNote reuses, and that S2 'will ADD import type { FileLedger } + import type
        { Granularity } — that is EXPECTED and correct' (S1 GOTCHA #2). Treat as a contract."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; devDeps typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts           # exports Granularity (read-only seam; import TYPE only). DO NOT TOUCH.
│   ├── log.ts              # fail-open JSONL logger. DO NOT TOUCH.
│   ├── runtime.ts          # per-session map. DO NOT TOUCH.
│   ├── tokens.ts           # pure helper sibling (snapshot-test convention). DO NOT TOUCH.
│   ├── ledger.ts           # exports FileLedger (read-only seam; import TYPE only). DO NOT TOUCH.
│   └── notes.ts            # S1 LANDED (validateNote + NoteInput + isRecord/readOwn). S2 renderNote also PRESENT (see status note).
├── test/
│   ├── config.test.ts / log.test.ts / runtime.test.ts / tokens.test.ts / ledger.test.ts  # Read-only.
│   └── notes.test.ts       # S1 (25 validateNote) + S2 renderNote tests ALSO PRESENT (41 total). See status note.
└── spec/                   # 04 §2.3 (THE format) + 10 §1.8 (tests) + 05 §1 step5/6 (consumer) + 03 §7 + 11 §1.
# VERIFIED STATE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   6 files / 187 tests green (config 21, ledger 39, log 15, notes 41 [25 S1 + 16 S2], runtime 20, tokens 51).
#   Per the IMPLEMENTATION STATUS note at the top, S2's renderNote + tests are ALREADY LANDED by a parallel agent.
#   This PRP is the SPEC + VERIFICATION contract: confirm the on-disk code equals Task 1/2 and the gates pass.
#   (The pre-S2 baseline was 6 files / 171 tests; S2 grew notes 25→41, total 171→187.)
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
#   The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent a lint/format command.
```

### Desired Codebase tree with files to be APPENDED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── notes.ts            # APPENDED — +2 import type lines (top) + renderNote + readNoteField + readLedgerList (end).
└── test/
    └── notes.test.ts       # APPENDED — +renderNote import + FileLedger/Granularity type imports + renderNote describe blocks.
# No other files touched. S1's validateNote/NoteInput/NOTE_INVALID_REASON + isRecord/readOwn are UNCHANGED.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — APPEND, do NOT rewrite src/notes.ts. S1 landed validateNote + NoteInput + NoteValidation
#   + NOTE_INVALID_REASON + NOTE_FIELDS + isRecord + readOwn. S2 ADDS: two `import type` lines at the very TOP,
#   and renderNote + readNoteField + readLedgerList at the END. REUSE isRecord/readOwn (call readOwn from your new
#   helpers) — do NOT redefine them. Do NOT modify S1's exports. (Mirrors how tokens.ts's S2 appended — see the
#   'P1.M2.T1.S2 additions' comment in src/tokens.ts.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — The two imports are TYPE-ONLY, at the very TOP of src/notes.ts:
#     import type { FileLedger } from "./ledger.js";
#     import type { Granularity } from "./config.js";
#   `import type` is ERASED at compile time ⇒ notes.ts stays Pi-FREE and unit-testable in isolation; ledger.ts/
#   config.ts are NOT pulled into the runtime graph. notes.ts is the PURE-HELPER tier (spec/11 §1), NOT the
#   foundation permanent-zero-imports tier (tokens.ts/ledger.ts) — S1 PRP GOTCHA #2 explicitly anticipated this.
#   The S1-only "zero imports" gate NO LONGER HOLDS at S2; that is correct and expected (do NOT "defend" it).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — EXACT format: build `sections: string[]` and `return sections.join("\n\n")`. ONE blank
#   line (the "\n\n") between every pair of adjacent sections — header, the 3 bold lines, each present ledger
#   block, and the Next line. This AUTOMATICALLY yields: (a) correct blank-line separation everywhere; (b) a
#   missing/empty ledger block leaves NO orphan blank line (it is simply not pushed); (c) all-empty-ledger
#   collapses to [header, What, Avoid, Current, Next].join("\n\n"). Do NOT hand-glue "\n\n" per case — use join.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — Ledger block format = `<tag>\n` + items.join("\n") + `\n</tag>`. Each item on its OWN
#   line. Push the block ONLY when `items.length > 0`. Block ORDER is fixed: files-read → files-modified →
#   bash-side-effects (same order as FileLedger's fields). Tags are EXACTLY: <files-read>, <files-modified>,
#   <bash-side-effects> — mirror Pi's compaction summary convention (spec/04 §2.3). Do NOT rename/reformat.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — NEVER throw (rewind-tool hot path; spec/05 §1 step 5; E13 discipline). Read note fields
#   via readOwn (Proxy-safe; a throwing-Proxy get-trap returns undefined, not an exception) and render the value
#   as "" if it is not a string. Read ledger lists via readLedgerList (Array.isArray guard; filter to string
#   elements; [] if absent/non-array). A null note, an array note, a non-array ledger, a throwing-Proxy note, or
#   missing fields → render gracefully, NEVER an exception. `expect(() => renderNote(...)).not.toThrow()` must pass.
#   NOTE: renderNote does NOT re-validate the note — validateNote (tool step 2) already guarantees non-empty
#   strings in real use; renderNote just renders whatever it is given, defensively.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (CRITICAL) — Interpolate granularity VERBATIM: `## 🔄 Mulligan rewind (${granularity})`. Do NOT
#   prettify ("last_turn", NOT "Last turn"). granularity is a string-literal union ⇒ interpolate DIRECTLY; do NOT
#   add `typeof granularity === "string"` (TS flags it as always-true; the typebox schema at the tool boundary
#   already guarantees the value). The "checkpoint" granularity renders as "(checkpoint)".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — Keep the PUBLIC signature EXACTLY `renderNote(note: NoteInput, ledger: FileLedger, granularity:
#   Granularity): string`. Do NOT widen to `ledger: FileLedger | null` (the contract pins FileLedger; the tool
#   always passes a real ledger). Use the internal readOwn/Array.isArray guards for runtime defense WITHOUT
#   changing the parameter type. At the type level FileLedger is always a record with string[] fields, so TS may
#   treat the defensive branches as partly-unreachable — that is fine; they compile cleanly and the runtime guard
#   still executes for a type-violating caller. Do NOT add `// @ts-ignore`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — No trailing newline. `sections.join("\n\n")` produces none — assert `out.endsWith("\n") === false`.
#   The spec markdown block (spec/04 §2.3) ends with `**Next:** <next>` and nothing after. Do NOT append a
#   trailing "\n" (the consumer pi.sendMessage stores content verbatim; an extra newline is harmless but
#   non-spec-exact and would break snapshot equality).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — The test imports from "../src/notes.js" (.js extension, even though the file is notes.ts).
#   moduleResolution:"Bundler" + package.json type:"module" → TS resolves the .js to .ts. This is the established
#   convention (tokens.test.ts, ledger.test.ts, notes.test.ts all use ../src/<file>.js). The new TYPE imports for
#   fixtures use "../src/ledger.js" and "../src/config.js" the same way.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — toMatchInlineSnapshot(): vitest AUTO-WRITES a NEW (empty/missing) inline snapshot on the first
#   `vitest run` (a missing inline snapshot is treated as out-of-date and updated). So an empty
#   `toMatchInlineSnapshot()` call passes on first run AND populates the source. If your vitest version requires
#   `-u`, run `npx vitest run -u` once, then `npx vitest run` to confirm green. The pinned `.toBe()` tests are the
#   AUTHORITATIVE format contract and pass WITHOUT any snapshot write (fully deterministic).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — Do NOT escape or transform the note field VALUES. Render them AS-IS (the agent authored them;
#   spec/04 §2.3: "The agent-supplied true_current_state text is rendered as-is"). A field containing markdown,
#   backticks, newlines, or quotes is interpolated verbatim. (renderNote is rendering, not sanitizing.)
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No new data models. `renderNote` consumes three EXISTING types (imported TYPE-ONLY) and returns a `string`:

```ts
// Reused from S1 (src/notes.ts — UNCHANGED):
export interface NoteInput {
  what_happened: string;
  avoid: string;
  true_current_state: string;
  next: string;
}
// Imported TYPE-ONLY from src/ledger.ts (spec/04 §2.2):
export interface FileLedger {
  readFiles: string[];
  modifiedFiles: string[];
  bashSideEffects: string[];
}
// Imported TYPE-ONLY from src/config.ts (spec/12, spec/05 §1):
export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 6 files / 171 tests green
  - RUN: test -f src/notes.ts && grep -q 'export function validateNote' src/notes.ts && echo "ok: S1 notes.ts present"
  - RUN: grep -q 'function readOwn' src/notes.ts && echo "ok: readOwn present (reuse it — do NOT redefine)"

Task 1: APPEND renderNote to src/notes.ts   (exact content below — copy verbatim)
  - EDIT 1 (TOP of file): add the two `import type` lines as the FIRST lines (above the module doc comment).
  - EDIT 2 (END of file): append the S2 comment banner + LEDGER_BLOCKS + renderNote + readNoteField + readLedgerList.
  - CONSTRAINTS:
      * `import type` ONLY (no runtime imports) — GOTCHA #2.
      * sections.join("\n\n"); block = `<tag>\n` + items.join("\n") + `\n</tag>`; push only if items.length>0;
        order files-read→files-modified→bash-side-effects — GOTCHA #3/#4.
      * read fields via readOwn (reuse S1's); never throw; do NOT re-validate — GOTCHA #5.
      * granularity interpolated verbatim; no typeof guard — GOTCHA #6.
      * signature exactly renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string — GOTCHA #7.
      * no trailing newline — GOTCHA #8.
      * REUSE S1's isRecord/readOwn; do NOT redefine; do NOT touch S1's exports — GOTCHA #1.
  - NAMING/PLACEMENT: src/notes.ts. New exports: renderNote. New module-local: LEDGER_BLOCKS, readNoteField,
    readLedgerList. Existing (UNCHANGED): NoteInput, NoteValidation, NOTE_INVALID_REASON, NOTE_FIELDS,
    validateNote, isRecord, readOwn.

Task 2: APPEND renderNote tests to test/notes.test.ts   (exact content below — copy verbatim)
  - EDIT 1 (imports): add renderNote to the notes import; add the two `import type` fixture lines.
  - EDIT 2 (end): append the EMPTY_LEDGER constant + the renderNote describe blocks (pinned .toBe() +
    toMatchInlineSnapshot + defensive + types).
  - CONSTRAINTS: NO beforeEach (pure, stateless). Mirror tokens.test.ts/ledger.test.ts. Keep S1's tests intact.
  - COVERAGE: pinned format (all-empty → no blocks; all-present → 3 blocks in order; partial → only present block);
    header verbatim granularity incl. "checkpoint"; no trailing newline; block-omission; never-throws defensive
    (null/array/primitive note, throwing-Proxy note, null/non-array ledger); expectTypeOf (FileLedger/Granularity
    consumed; renderNote returns string); snapshot representative notes (toMatchInlineSnapshot).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest, incl. `-u` once if a snapshot needs populating). Levels 3/4 N/A (pure helper).
```

#### Exact content to APPEND — `src/notes.ts` EDIT 1: the two import lines (at the very TOP of the file)

```ts
import type { FileLedger } from "./ledger.js";
import type { Granularity } from "./config.js";
```

> These become lines 1–2 of `src/notes.ts`, above the existing `/**` module doc comment. TYPE-ONLY ⇒ erased at
> compile time (notes.ts stays Pi-free). (GOTCHA #2.)

#### Exact content to APPEND — `src/notes.ts` EDIT 2: the renderNote block (at the END of the file)

```ts
// ─────────────────────────────────────────────────────────────────────────────
// S2 (P1.M2.T3.S2) — renderNote (spec/04-data-model.md §2.3 — the mulligan:note CustomMessage content)
// APPENDED below the S1 exports (NoteInput, NoteValidation, NOTE_INVALID_REASON, validateNote) and the
// module-private isRecord/readOwn helpers, which are UNCHANGED and REUSED here. This module now imports
// TYPE-ONLY { FileLedger } (from ledger.js) + { Granularity } (from config.js) — erased at compile time, so
// notes.ts stays Pi-free and unit-testable in isolation (notes.ts is the pure-helper tier, NOT a permanent
// zero-imports gate — see S1 PRP GOTCHA #2). renderNote is pure and is unit-tested with snapshot-style cases
// (spec/10 §1.8).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three ledger block descriptors, in spec/04 §2.3 order (read → modified → bash). Each tuple is
 * [rendered-tag, FileLedger-field]. Module-local.
 */
const LEDGER_BLOCKS: ReadonlyArray<readonly [tag: string, field: keyof FileLedger]> = [
  ["files-read", "readFiles"],
  ["files-modified", "modifiedFiles"],
  ["bash-side-effects", "bashSideEffects"],
];

/**
 * renderNote — compose the markdown note the resumed model reads as the `mulligan:note` CustomMessage content
 * (spec/04-data-model.md §2.3). PURE: it interpolates the (already-validated) NoteInput + the deterministic
 * FileLedger + the Granularity into the pinned markdown shape. Called by tools/rewind.ts step 5 (spec/05 §1)
 * AFTER validateNote has passed (step 2) and the ledger is composed; the returned string becomes
 * `pi.sendMessage({ customType:"mulligan:note", content: <this>, display:true, details:{...} })` (spec/05 §1
 * step 6; spec/04 §3).
 *
 * FORMAT (spec/04 §2.3 — built by joining these sections with a blank line, i.e. "\n\n"):
 *     ## 🔄 Mulligan rewind (<granularity>)
 *     **What happened:** <what_happened>
 *     **Avoid:** <avoid>
 *     **Current true state:** <true_current_state>
 *     <files-read>…</files-read>                ← omitted iff ledger.readFiles is empty
 *     <files-modified>…</files-modified>        ← omitted iff ledger.modifiedFiles is empty
 *     <bash-side-effects>…</bash-side-effects>  ← omitted iff ledger.bashSideEffects is empty
 *     **Next:** <next>
 * Each ledger block is `<tag>\n<item1>\n<item2>\n…\n</tag>` (items joined by "\n", one per line). The block tags
 * mirror Pi's compaction summary convention so a model accustomed to compaction parses them naturally (spec/04
 * §2.3). The granularity is interpolated VERBATIM (e.g. "last_turn", NOT "Last turn"). No trailing newline.
 *
 * DEFENSIVE — NEVER throws (rewind-tool hot path; E13 discipline). note fields are read via readOwn (Proxy-safe;
 * a throwing-Proxy get-trap returns undefined, not an exception); a non-record note or non-array ledger list
 * renders gracefully (treated as empty strings / empty block) rather than crashing. renderNote does NOT re-validate
 * the note — validateNote (step 2) already guarantees every field is a non-empty string in real use; this function
 * just renders whatever it is given, defensively. Field VALUES are rendered AS-IS (spec/04 §2.3).
 *
 * @param note        the agent's NoteInput (validateNote has already accepted it)
 * @param ledger      the deterministic FileLedger from extractFileLedger (P1.M2.T2.S1)
 * @param granularity the rewind granularity, interpolated into the header verbatim
 * @returns the markdown string (sections separated by blank lines; NO trailing newline)
 */
export function renderNote(
  note: NoteInput,
  ledger: FileLedger,
  granularity: Granularity,
): string {
  const sections: string[] = [
    `## 🔄 Mulligan rewind (${granularity})`,
    `**What happened:** ${readNoteField(note, "what_happened")}`,
    `**Avoid:** ${readNoteField(note, "avoid")}`,
    `**Current true state:** ${readNoteField(note, "true_current_state")}`,
  ];
  for (const [tag, field] of LEDGER_BLOCKS) {
    const items = readLedgerList(ledger, field);
    if (items.length > 0) {
      sections.push(`<${tag}>\n${items.join("\n")}\n</${tag}>`);
    }
  }
  sections.push(`**Next:** ${readNoteField(note, "next")}`);
  return sections.join("\n\n");
}

/**
 * Read a NoteInput field as a string ("" if absent/non-string); defensive, never throws (a Proxy get-trap may
 * throw — readOwn swallows it). Module-private; reuses S1's readOwn. The literal-union key keeps the call sites
 * type-checked against the real NoteInput field names.
 */
function readNoteField(
  note: unknown,
  key: "what_happened" | "avoid" | "true_current_state" | "next",
): string {
  const v = readOwn(note, key);
  return typeof v === "string" ? v : "";
}

/**
 * Read a FileLedger list as a string[] (filtering to string elements; [] if absent/non-array). Defensive, never
 * throws. Module-private; reuses S1's readOwn. The `keyof FileLedger` keeps the call sites type-checked.
 */
function readLedgerList(ledger: unknown, field: keyof FileLedger): string[] {
  const v = readOwn(ledger, field);
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}
```

#### Exact content to APPEND — `test/notes.test.ts` EDIT 1: extend the imports

Replace the existing import block:
```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateNote,
  NOTE_INVALID_REASON,
  type NoteInput,
  type NoteValidation,
} from "../src/notes.js";
```
with (add `renderNote` + the two fixture type imports):
```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateNote,
  renderNote,
  NOTE_INVALID_REASON,
  type NoteInput,
  type NoteValidation,
} from "../src/notes.js";
import type { FileLedger } from "../src/ledger.js";
import type { Granularity } from "../src/config.js";
```

#### Exact content to APPEND — `test/notes.test.ts` EDIT 2: the renderNote test blocks (at the END of the file)

```ts
// ─────────────────────────────────────────────────────────────────────────────
// S2 (P1.M2.T3.S2) — renderNote tests (spec/04-data-model.md §2.3 + spec/10-testing.md §1.8)
// APPENDED below the S1 validateNote tests, which are UNCHANGED.
// ─────────────────────────────────────────────────────────────────────────────

/** A ledger with all three lists empty (spec/04 §2.3 omission rule). */
const EMPTY_LEDGER: FileLedger = { readFiles: [], modifiedFiles: [], bashSideEffects: [] };

describe("renderNote — spec/04 §2.3 pinned format", () => {
  it("all ledger lists empty → no ledger blocks; header interpolates granularity VERBATIM", () => {
    const out = renderNote(VALID_NOTE, EMPTY_LEDGER, "last_turn");
    expect(out).toBe(
      [
        "## 🔄 Mulligan rewind (last_turn)",
        "",
        `**What happened:** ${VALID_NOTE.what_happened}`,
        "",
        `**Avoid:** ${VALID_NOTE.avoid}`,
        "",
        `**Current true state:** ${VALID_NOTE.true_current_state}`,
        "",
        `**Next:** ${VALID_NOTE.next}`,
      ].join("\n"),
    );
    // No trailing newline (GOTCHA #8).
    expect(out.endsWith("\n")).toBe(false);
    // No ledger block tags present at all.
    expect(out).not.toContain("<files-read>");
    expect(out).not.toContain("<files-modified>");
    expect(out).not.toContain("<bash-side-effects>");
  });

  it("all three ledger lists non-empty → all three blocks, in read→modified→bash order", () => {
    const ledger: FileLedger = {
      readFiles: ["path/a.ts", "path/b.ts"],
      modifiedFiles: ["path/c.ts"],
      bashSideEffects: ['git commit -m "wip"'],
    };
    const out = renderNote(VALID_NOTE, ledger, "last_tool_call_group");
    expect(out).toBe(
      [
        "## 🔄 Mulligan rewind (last_tool_call_group)",
        "",
        `**What happened:** ${VALID_NOTE.what_happened}`,
        "",
        `**Avoid:** ${VALID_NOTE.avoid}`,
        "",
        `**Current true state:** ${VALID_NOTE.true_current_state}`,
        "",
        "<files-read>",
        "path/a.ts",
        "path/b.ts",
        "</files-read>",
        "",
        "<files-modified>",
        "path/c.ts",
        "</files-modified>",
        "",
        "<bash-side-effects>",
        'git commit -m "wip"',
        "</bash-side-effects>",
        "",
        `**Next:** ${VALID_NOTE.next}`,
      ].join("\n"),
    );
  });

  it("each block is independently conditional — partial ledger (only readFiles) → only <files-read>", () => {
    const ledger: FileLedger = { readFiles: ["src/x.ts"], modifiedFiles: [], bashSideEffects: [] };
    const out = renderNote(VALID_NOTE, ledger, "checkpoint"); // "checkpoint" granularity rendered verbatim too
    expect(out).toContain("## 🔄 Mulligan rewind (checkpoint)");
    expect(out).toContain("<files-read>\nsrc/x.ts\n</files-read>");
    expect(out).not.toContain("<files-modified>");
    expect(out).not.toContain("<bash-side-effects>");
  });

  it("only bashSideEffects non-empty → only <bash-side-effects> block", () => {
    const ledger: FileLedger = {
      readFiles: [],
      modifiedFiles: [],
      bashSideEffects: ["rm -rf node_modules", "npm install"],
    };
    const out = renderNote(VALID_NOTE, ledger, "last_turn");
    expect(out).toContain(
      "<bash-side-effects>\nrm -rf node_modules\nnpm install\n</bash-side-effects>",
    );
    expect(out).not.toContain("<files-read>");
    expect(out).not.toContain("<files-modified>");
  });

  it("only modifiedFiles non-empty → only <files-modified> block", () => {
    const ledger: FileLedger = { readFiles: [], modifiedFiles: ["a.ts", "b.ts"], bashSideEffects: [] };
    const out = renderNote(VALID_NOTE, ledger, "last_tool_call_group");
    expect(out).toContain("<files-modified>\na.ts\nb.ts\n</files-modified>");
    expect(out).not.toContain("<files-read>");
    expect(out).not.toContain("<bash-side-effects>");
  });
});

describe("renderNote — snapshot-style cases (spec/10 §1.8)", () => {
  // toMatchInlineSnapshot() with no argument: vitest AUTO-WRITES the snapshot on first run (GOTCHA #11).
  // If your vitest version requires it, run `npx vitest run -u` once to populate, then `npx vitest run`.

  it("representative last_turn note with a full ledger", () => {
    const ledger: FileLedger = {
      readFiles: ["src/auth/session.ts"],
      modifiedFiles: ["src/auth/session.ts"],
      bashSideEffects: ["npm run build"],
    };
    expect(renderNote(VALID_NOTE, ledger, "last_turn")).toMatchInlineSnapshot();
  });

  it("representative last_tool_call_group note with an empty ledger", () => {
    expect(renderNote(VALID_NOTE, EMPTY_LEDGER, "last_tool_call_group")).toMatchInlineSnapshot();
  });
});

describe("renderNote — field values rendered AS-IS (no escaping/transform)", () => {
  it("fields containing markdown / backticks / quotes are interpolated verbatim", () => {
    const note: NoteInput = {
      what_happened: "ran `grep -r auth .` → ~38k tokens",
      avoid: "don't run wide grep; use **-l** or pipe to `head`",
      true_current_state: "no files changed; \"scratch.ts\" not created",
      next: "re-run as `grep -rl auth src/`",
    };
    const out = renderNote(note, EMPTY_LEDGER, "last_turn");
    expect(out).toContain("**What happened:** ran `grep -r auth .` → ~38k tokens");
    expect(out).toContain('**Current true state:** no files changed; "scratch.ts" not created');
    expect(out).toContain("**Next:** re-run as `grep -rl auth src/`");
  });
});

describe("renderNote — defensive (NEVER throws — GOTCHA #5)", () => {
  it("a null note passed as NoteInput → renders empty fields, not a throw", () => {
    expect(() => renderNote(null as unknown as NoteInput, EMPTY_LEDGER, "last_turn")).not.toThrow();
    const out = renderNote(null as unknown as NoteInput, EMPTY_LEDGER, "last_turn");
    expect(out).toContain("## 🔄 Mulligan rewind (last_turn)");
    expect(out).toContain("**What happened:** "); // empty value, not a crash
  });

  it("an array passed as NoteInput → renders empty fields, not a throw", () => {
    expect(() =>
      renderNote(["x", "y", "z", "w"] as unknown as NoteInput, EMPTY_LEDGER, "last_turn"),
    ).not.toThrow();
  });

  it("a null ledger passed as FileLedger → no blocks, not a throw", () => {
    expect(() => renderNote(VALID_NOTE, null as unknown as FileLedger, "last_turn")).not.toThrow();
    const out = renderNote(VALID_NOTE, null as unknown as FileLedger, "last_turn");
    expect(out).not.toContain("<files-read>");
  });

  it("a ledger with non-array lists → no blocks, not a throw", () => {
    const bad = { readFiles: "src/a.ts", modifiedFiles: null, bashSideEffects: undefined } as unknown as FileLedger;
    expect(() => renderNote(VALID_NOTE, bad, "last_turn")).not.toThrow();
    expect(renderNote(VALID_NOTE, bad, "last_turn")).not.toContain("<files-read>");
  });

  it("does not throw on a throwing-Proxy note (readOwn swallows the get-trap)", () => {
    const trap = new Proxy(
      { ...VALID_NOTE } as NoteInput,
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => renderNote(trap, EMPTY_LEDGER, "last_turn")).not.toThrow();
    // every field read throws → read as undefined → "" → rendered with empty values, no crash
    const out = renderNote(trap, EMPTY_LEDGER, "last_turn");
    expect(out).toContain("## 🔄 Mulligan rewind (last_turn)");
    expect(out).toContain("**Next:** ");
  });
});

describe("renderNote — types", () => {
  it("renderNote returns a string", () => {
    expectTypeOf(renderNote(VALID_NOTE, EMPTY_LEDGER, "last_turn")).toEqualTypeOf<string>();
  });

  it("Granularity is the three rewind granularities (consumed verbatim in the header)", () => {
    expectTypeOf<Granularity>().toEqualTypeOf<"last_tool_call_group" | "last_turn" | "checkpoint">();
  });

  it("FileLedger has the three string[] lists (consumed for the conditional blocks)", () => {
    expectTypeOf<FileLedger>().toEqualTypeOf<{
      readFiles: string[];
      modifiedFiles: string[];
      bashSideEffects: string[];
    }>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: build sections[], join with "\n\n" (GOTCHA #3). ONE blank line between every adjacent section; a
//   missing/empty ledger block leaves NO orphan blank line (it is simply not pushed). This is the spec-exact shape.
const sections: string[] = [
  `## 🔄 Mulligan rewind (${granularity})`,                                  // header — granularity verbatim (GOTCHA #6)
  `**What happened:** ${readNoteField(note, "what_happened")}`,
  `**Avoid:** ${readNoteField(note, "avoid")}`,
  `**Current true state:** ${readNoteField(note, "true_current_state")}`,
];
for (const [tag, field] of LEDGER_BLOCKS) {                                  // read→modified→bash order (GOTCHA #4)
  const items = readLedgerList(ledger, field);                               // [] if absent/non-array (GOTCHA #5)
  if (items.length > 0) {                                                    // OMIT empty blocks (spec/04 §2.3)
    sections.push(`<${tag}>\n${items.join("\n")}\n</${tag}>`);               // one item per line
  }
}
sections.push(`**Next:** ${readNoteField(note, "next")}`);
return sections.join("\n\n");                                                // NO trailing newline (GOTCHA #8)

// PATTERN: read defensively via readOwn (S1's helper) so renderNote NEVER throws (GOTCHA #5). At the type level
//   NoteInput/FileLedger always have the fields, so TS may mark the defensive branches partly-unreachable — that is
//   fine; they compile cleanly and the runtime guard still executes for a type-violating caller (GOTCHA #7).
function readNoteField(note: unknown, key: "what_happened" | "avoid" | "true_current_state" | "next"): string {
  const v = readOwn(note, key);          // Proxy-safe; undefined if the get-trap throws
  return typeof v === "string" ? v : ""; // non-string → "" (rendered as empty, never a crash)
}
function readLedgerList(ledger: unknown, field: keyof FileLedger): string[] {
  const v = readOwn(ledger, field);
  if (!Array.isArray(v)) return [];      // absent / non-array / Proxy-trap → []
  return v.filter((item): item is string => typeof item === "string"); // only real strings
}
```

### Integration Points

```yaml
# This task adds NO runtime integration points — it APPENDS a pure helper. It PERSISTS nothing and calls nothing.
# The only seams are the EXPORT + the TYPE-ONLY imports:

EXPORTS (consumed by downstream tasks):
  - renderNote → tools/rewind.ts step 5 (P1.M5.T1.S1) → the mulligan:note CustomMessage content (spec/05 §1 step 6).

IMPORTS (TYPE-ONLY — erased at compile time; no runtime graph change):
  - import type { FileLedger } from "./ledger.js"  → the ledger shape (P1.M2.T2.S1, LANDED).
  - import type { Granularity } from "./config.js" → the rewind granularity union (P1.M1.T2.S1, LANDED).

REUSED (from S1, UNCHANGED):
  - isRecord / readOwn → module-private; called by readNoteField/readLedgerList. NOT redefined.

CONFIG:    none (renderNote takes granularity as a param, not config).
DATABASE:  none (pure; persists nothing).
ROUTES:    none (no Pi surface at S2).
RUNTIME:   none (pure; no module-scoped mutable state added — S3 must keep that invariant too).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending src/notes.ts — fix before proceeding.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
# TS strict IS the type+style gate. (GOTCHA #10 — do NOT invent a lint/format command.)

# Type-check the appended module + test under strict.
npx tsc --noEmit -p tsconfig.json            # Expected: exit 0. If errors, READ the output and fix.

# Sanity: imports are TYPE-ONLY (no runtime coupling added; the two lines must both start with `import type`).
grep -nE '^import type \{ (FileLedger|Granularity) \}' src/notes.ts   # Expected: two lines (FileLedger, Granularity).
# POSIX-safe "no runtime import" check: any line starting with 'import ' that is NOT 'import type ' is a runtime import.
test -z "$(grep -nE '^import ' src/notes.ts | grep -v 'import type ')" && echo "ok: no runtime imports added" \
  || { echo "FAIL: a runtime import was added (must be type-only)"; grep -nE '^import ' src/notes.ts | grep -v 'import type '; }

# Sanity: renderNote is exported and reuses S1's readOwn (not redefined).
grep -q 'export function renderNote' src/notes.ts && echo "ok: renderNote exported"
test "$(grep -c 'function readOwn' src/notes.ts)" -eq 1 && echo "ok: readOwn defined once (reused, not redefined)"

# Expected: tsc exit 0; "ok" lines for the three sanity checks.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the grown notes suite (S1 validateNote tests + S2 renderNote tests).
npx vitest run test/notes.test.ts          # Expected: all notes tests pass.

# toMatchInlineSnapshot() auto-writes NEW snapshots on first run (GOTCHA #11). If your vitest version requires -u:
npx vitest run test/notes.test.ts -u       # populate the inline snapshots, then re-run clean:
npx vitest run test/notes.test.ts          # Expected: green (snapshots now pinned in source).

# Full suite — confirm NO regression to the baseline (6 files / 171 tests → 6 files / 171+N).
npx vitest run                             # Expected: 6 files all green.

# Expected: all tests pass. If failing, debug root cause and fix the implementation (do NOT weaken the tests —
#   the pinned format + omission + ordering contract is spec-mandated).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — renderNote is a pure helper with NO Pi runtime surface. There is no server to start, no endpoint to hit,
# no MCP tool to invoke, no database. Integration is exercised later by tools/rewind.ts (P1.M5.T1.S1, which calls
# renderNote at step 5 and feeds its output to pi.sendMessage at step 6) and the integration smoke harness
# (P1.M7.T2.S1, F-rewind-core asserts the mulligan:note content appears in the filtered view + session JSONL).
# This subtask's "integration" is the tsc + vitest gates above. (See GOTCHA #10 — do not invent commands.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for this pure helper. The domain-specific validation (the confabulation-defense guarantee — a correct,
# complete, machine-readable note bridging the context gap) is encoded directly in the Level-2 pinned-format tests:
# the rendered markdown EXACTLY matches spec/04 §2.3 (header + 4 bold lines + conditional ledger blocks), so the
# resumed model gets the full what/avoid/state/next + the deterministic file ledger. There is nothing further to
# run at S2. (Performance/security/load testing apply to the tool layer, not this pure string function.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 green: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Imports are TYPE-ONLY: both new import lines start with `import type`; no runtime import added.
- [ ] `renderNote` is exported; `readOwn` is defined ONCE (reused from S1, not redefined).
- [ ] Level 2 green: `npx vitest run` → 6 files all pass (no regression to the 171-test baseline).
- [ ] `npx vitest run test/notes.test.ts` → all notes tests pass (S1 + S2); snapshots populated (`-u` if needed).

### Feature Validation

- [ ] **Pinned format (spec/04 §2.3):** header `## 🔄 Mulligan rewind (<granularity>)`; 4 bold body lines
      (`**What happened:**`/`**Avoid:**`/`**Current true state:**`/`**Next:**`); sections separated by ONE blank
      line; NO trailing newline.
- [ ] **Verbatim granularity:** `last_turn` / `last_tool_call_group` / `checkpoint` interpolated as-is (not
      prettified).
- [ ] **Conditional blocks:** non-empty list → `<tag>\n<items joined by \n>\n</tag>`; empty list → block omitted
      (no orphan blank line).
- [ ] **Block ordering:** `files-read` → `files-modified` → `bash-side-effects`.
- [ ] **All-empty ledger:** no block tags; output = `[header, What, Avoid, Current, Next].join("\n\n")`.
- [ ] **Values as-is:** markdown/backticks/quotes in field values interpolated verbatim.
- [ ] **Never throws:** null/array/primitive note, throwing-Proxy note, null/non-array ledger → renders, no exception.
- [ ] **Signature exact:** `renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string`.

### Code Quality Validation

- [ ] Mirrors `tokens.ts`/`ledger.ts`/S1-`notes.ts` conventions (module banner, defensive reads, never-throws).
- [ ] APPENDS to the existing files (S1 exports + `isRecord`/`readOwn` UNCHANGED); does NOT rewrite.
- [ ] `LEDGER_BLOCKS`/`readNoteField`/`readLedgerList` are module-private (reusable by S3) — NOT exported.
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] S2 banner cites the spec sections + the S1-reuse + the snapshot-test mandate.
- [ ] `renderNote` doc-comment reproduces the spec/04 §2.3 format + the defensive contract.
- [ ] No new environment variables (pure; type-only imports).

---

## Anti-Patterns to Avoid

- ❌ Don't REWRITE `src/notes.ts` — APPEND (GOTCHA #1). Reuse S1's `isRecord`/`readOwn`; leave S1's exports intact.
- ❌ Don't hand-glue `"\n\n"` per case or special-case the block layout — build a `sections[]` and `join("\n\n")`
  (GOTCHA #3). Hand-gluing produces orphan blank lines when a ledger block is empty.
- ❌ Don't include a ledger block when its list is empty, not even as an empty `<tag></tag>` (GOTCHA #4 — omit
  entirely).
- ❌ Don't prettify the granularity or add a `typeof granularity === "string"` guard — interpolate verbatim
  (GOTCHA #6).
- ❌ Don't read note fields directly (`note.what_happened`) if that bypasses Proxy safety — but more importantly,
  don't CRASH on a malformed note; use `readOwn` so the function never throws (GOTCHA #5).
- ❌ Don't widen the signature to `ledger: FileLedger | null` — keep `FileLedger`; use internal guards (GOTCHA #7).
- ❌ Don't append a trailing newline (GOTCHA #8) — `join("\n\n")` is correct as-is.
- ❌ Don't re-validate the note inside `renderNote` — `validateNote` already ran at tool step 2; renderNote just
  renders (GOTCHA #5). Don't escape/transform field values either — render as-is.
- ❌ Don't add a RUNTIME import — the ledger/config imports are `import type` ONLY (erased at compile time;
  GOTCHA #2). Adding a runtime import would pull Pi-coupled code into the pure-helper tier.