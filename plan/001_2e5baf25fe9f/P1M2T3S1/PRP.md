# PRP — P1.M2.T3.S1: `validateNote(note)` — all 4 fields required non-empty

**Work item:** P1.M2.T3.S1 · **Points:** 0.5 · **Stage:** Pure Helper Library → Note Validation & Rendering
**Scope:** **CREATE two new files** — `src/notes.ts` (the `NoteInput` interface + the `validateNote` pure
function + module-private defensive helpers) and `test/notes.test.ts` (vitest Tier-1 unit tests). **No other
file is touched.** Zero Pi dependency, no imports at S1, never throws. This is **S1 of a 3-part `notes.ts`**
(S2 = `renderNote`; S3 = `renderBloatReminder` + `renderDriftNudge`) — S1 ships ONLY validateNote + NoteInput.

---

## Goal

**Feature Goal**: Ship Mulligan's **note validator** — a pure, Pi-free, side-effect-free function that asserts
all four `NoteInput` fields (`what_happened`, `avoid`, `true_current_state`, `next`) are non-empty strings
**after trim**. This is the rewind tool's runtime guard against a vacuous note: the structured note is Mulligan's
**primary defense against confabulation** (decision D2), so a half-hearted note (any field missing, empty, or
whitespace-only) is **rejected** (spec/05 §1 step 2, spec/08 E9, spec/10 §1.8).

**Deliverable** (two NEW files):
1. `src/notes.ts` — exports:
   - `export interface NoteInput { what_happened: string; avoid: string; true_current_state: string; next: string }` (spec/04 §2.1 verbatim — field names + optionality are load-bearing for renderNote/S2 + `RewindMarker.note`/spec/04 §3).
   - `export interface NoteValidation { valid: boolean; reason?: string }`.
   - `export const NOTE_INVALID_REASON = "note fields must all be non-empty"` (spec-pinned, no trailing period).
   - `export function validateNote(note: NoteInput): NoteValidation` — checks all 4 fields
     `typeof === 'string' && field.trim().length > 0`; any fail → `{valid:false, reason:NOTE_INVALID_REASON}`;
     all pass → `{valid:true}`.
   - module-private defensive helpers `isRecord` + `readOwn` (mirrored from tokens.ts; reused by S2/S3).
   - **ZERO imports at S1** (`grep -cE '^import|^from' src/notes.ts` → **0**). (notes.ts is the pure-helper
     tier, NOT the foundation zero-imports tier — S2 will ADD `ledger.ts`/`config.ts` type imports. See GOTCHA #2.)
2. `test/notes.test.ts` — vitest, `import { validateNote, NOTE_INVALID_REASON, type NoteInput, type NoteValidation } from "../src/notes.js"`, mirrors `test/tokens.test.ts` conventions (no `beforeEach`, `describe`/`it`/`expect`/`expectTypeOf`).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (new module + test type-sound under `strict`).
- `npx vitest run` is **all-green** — the new `notes` suite **AND** the pre-existing suites (baseline 5 files / 146 tests → 6 files / 146+N).
- `src/notes.ts` has **zero imports** at S1 completion.
- `validateNote` **never throws** (defensive on null/array note, throwing-Proxy note, missing/non-string/whitespace-only fields) — it sits on the rewind-tool hot path (spec/05 step 2; E9/E13-style discipline).
- The **pinned Tier-1 contract (spec/10 §1.8 + E9)**: all 4 fields present + non-empty → `{valid:true}`;
  ANY of the 4 empty → `{valid:false, reason:"note fields must all be non-empty"}` (the SAME single reason for every failure).

---

## User Persona

**Target User**: The implementing AI agent for `tools/rewind.ts` (`mulligan_rewind`, P1.M5.T1.S1) — the SOLE
runtime consumer in v1. The rewind tool receives the agent's `note` (typebox-validated so all 4 fields are
present strings), then calls `validateNote(note)` as **step 2 of its behavior** (spec/05 §1 step 2). On
`{valid:false}` it returns the refusal text `"Mulligan: refused — note fields must all be non-empty."` (it
prefixes `NOTE_INVALID_REASON` with `"Mulligan: refused — "` and closes with `.`). On `{valid:true}` it proceeds
to compose the ledger + render the note (S2) + persist the marker. The SECOND consumer is `renderNote` (S2),
which takes the SAME `NoteInput` type as its first parameter — so `NoteInput` is the shared type seam between
the tool, the validator, and the renderer.

**Use Case**: An agent just wasted a turn and wants a mulligan. It calls `mulligan_rewind(note:{...}, granularity:"last_turn")`.
If it supplied a real, concrete note (all 4 fields filled), `validateNote` returns `{valid:true}` and the rewind
proceeds. If it tried to phone it in (`what_happened:""`, or `next:"   "`), `validateNote` returns
`{valid:false, reason:"note fields must all be non-empty"}`, the tool refuses, and the agent is forced to supply
a genuine note — protecting the resumed model from confabulating its way through a context gap (D2, E9).

**User Journey**:
1. Agent calls `mulligan_rewind(note, granularity)`.
2. Tool (step 2) calls `validateNote(note)` → `NoteValidation`.
3. If `{valid:false}` → tool returns `"Mulligan: refused — note fields must all be non-empty."` (no marker, no note persisted).
4. If `{valid:true}` → tool proceeds: compose ledger (S1 ledger helper), `renderNote(note, ledger, granularity)` (S2),
   persist `RewindMarker.note = note` (spec/04 §3), and `pi.sendMessage({customType:"mulligan:note", ...})`.

**Pain Points Addressed**: Without a hard structural check, an agent could rewind with `what_happened:"idk"` or
empty fields, leaving the resumed model with **no real guidance** — it would confabulate (invent) what happened
and what to do, defeating the entire purpose of the rewind (D/D17). `validateNote` makes the structured note
**non-negotiable** (E9): every rewind carries a genuine what/avoid/state/next.

---

## Why

- **Unblocks `tools/rewind.ts` (P1.M5.T1.S1) AND `renderNote` (P1.M2.T3.S2).** `validateNote` is step 2 of the
  rewind tool's behavior; `NoteInput` is the shared type the tool, validator, and renderer all use. Shipping the
  pure validator + the canonical `NoteInput` now (pure-helper tier, alongside `tokens.ts`/`ledger.ts`) lets the
  downstream tool focus on glue, not on field-checking or type definition.
- **Confabulation defense is the load-bearing safety property (D2, spec/04 §2.1, spec/08 E9).** spec/04 §2.1:
  *"This structure is the primary defense against confabulation (D/D17)."* E9: *"a vacuous note defeats the
  confabulation defense… The structured note is non-negotiable."* `validateNote` is the ENFORCEMENT of that
  mandate at the tool boundary.
- **Spec-pinned contract → deterministic, no judgement calls.** Both the refusal reason string
  (`"note fields must all be non-empty"`) and the check (`non-empty after trim`) are pinned verbatim in
  spec/05 step 2, spec/08 E9, and the item_description. There is nothing to invent — implement exactly.
- **Pure-helper tier & import-free at S1 (like `tokens.ts`/`ledger.ts` at their S1).** `notes.ts` is the
  pure-helper tier (spec/11 §1, spec/03 §2.3/§7). S1 adds zero imports and mirrors the `tokens.ts` defensive
  discipline (`isRecord`/`readOwn` + never-throws). S1 is decoupled from `ledger.ts` (validateNote does NOT
  consume `FileLedger` — that is renderNote's S2 seam), so the parallel P1.M2.T2.S1 ledger work does not affect it.

---

## What

CREATE `src/notes.ts` exporting `NoteInput`, `NoteValidation`, `NOTE_INVALID_REASON`, and `validateNote`. The function:

- **Guards the note object** with `isRecord` (a null/array/primitive passed as `NoteInput` → invalid, never throws).
- **Iterates the 4 field names** (`what_happened`, `avoid`, `true_current_state`, `next` — spec/04 §2.1 order).
- **For each field reads it via `readOwn`** (returns `unknown`, Proxy-safe) and checks `typeof value === "string" && value.trim().length > 0`.
- **Any failure → `{valid:false, reason:NOTE_INVALID_REASON}`** (the SAME single reason for every failure — we
  do NOT vary it per field, because the rewind tool shows one refusal text either way).
- **All 4 pass → `{valid:true}`** (no `reason`).

This subtask does **NOT**: touch `index.ts`/`config.ts`/`log.ts`/`runtime.ts`/`tokens.ts`/`ledger.ts`;
implement `renderNote` / `renderBloatReminder` / `renderDriftNudge` (S2/S3 — they APPEND to this file later);
implement the rewind tool (P1.M5.T1.S1); import anything at S1; or mutate inputs.

### Success Criteria

- [ ] `src/notes.ts` is CREATED and exports `NoteInput`, `NoteValidation`, `NOTE_INVALID_REASON`, `validateNote`.
- [ ] `src/notes.ts` has **zero imports** at S1 (`grep -cE '^import|^from' src/notes.ts` → 0).
- [ ] `test/notes.test.ts` is CREATED; `npx vitest run` is all-green (notes + config + ledger + log + runtime + tokens).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **Pinned contract (spec/10 §1.8 + E9):** all 4 fields present + non-empty → `{valid:true}`; ANY of the 4
      empty → `{valid:false, reason:"note fields must all be non-empty"}`.
- [ ] **trim check:** whitespace-only field (`"   \n\t  "`) → invalid (the field is empty *after trim*).
- [ ] **non-string rejection:** a field that is a number / null / undefined at runtime → invalid (`typeof` check).
- [ ] **single pinned reason:** `NOTE_INVALID_REASON === "note fields must all be non-empty"` (no trailing
      period); EVERY failure returns that exact string.
- [ ] **genuinely-valid content with surrounding whitespace passes** (trim does not over-reject): `"  real text  "` → valid.
- [ ] **Defensive — never throws (E13-style):** null note, array note, throwing-Proxy note, missing field → all
      return `{valid:false,...}`, never throw; `expect(() => validateNote(...)).not.toThrow()`.
- [ ] **NoteInput has EXACTLY the 4 spec/04 §2.1 fields** (asserted via `expectTypeOf`).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `src/notes.ts` to CREATE is given verbatim below (Task 1) and the exact
> `test/notes.test.ts` (Task 2), including the pinned contract + edge cases. The `NoteInput` shape is quoted
> verbatim from spec/04 §2.1; the check (`non-empty after trim`) + the pinned reason string are quoted from
> spec/05 step 2 / spec/08 E9 / the item_description. The defensive helpers `isRecord`/`readOwn` are copied
> verbatim from `tokens.ts` (verified on disk). The baseline (5 files / 146 tests, tsc exit 0) is verified live.
> No prior knowledge beyond "this is a pure-helper-tier sibling of `tokens.ts`" is required.

### Scope decision (READ BEFORE CODING)

- **CREATE `src/notes.ts` — it does NOT exist.** Pure-helper tier (spec/11 §1, spec/03 §2.3/§7). This is **S1
  of 3**: ship ONLY `NoteInput` + `NoteValidation` + `NOTE_INVALID_REASON` + `validateNote` + the module-private
  `isRecord`/`readOwn`. **S2 (renderNote) and S3 (renderBloatReminder/renderDriftNudge) APPEND to this file
  later** and reuse the hoisted `isRecord`/`readOwn`. Write the file header to acknowledge the append plan
  (mirror how tokens.ts's S2 appended — see `src/tokens.ts` lines ~180–230).
- **CREATE `test/notes.test.ts` — it does NOT exist.** Mirror `test/tokens.test.ts` conventions exactly.
- **Do NOT import anything at S1.** Zero-imports gate at S1 (`grep -cE '^import|^from' src/notes.ts` → 0). Pure
  string work — no Pi, no config, no log, no runtime, no tokens, no ledger. (S2 will ADD `import type { FileLedger }
  from "./ledger.js"` + `import type { Granularity } from "./config.js"` — that is EXPECTED and correct; notes.ts
  is NOT bound to a permanent zero-imports gate, unlike tokens.ts/ledger.ts. See GOTCHA #2.)
- **Do NOT implement renderNote / renderBloatReminder / renderDriftNudge.** Those are S2/S3. This task ships ONLY
  validateNote + NoteInput.
- **Do NOT widen the public signature.** The contract pins `validateNote(note: NoteInput)`. Keep it `NoteInput`
  (the rewind tool always has a real NoteInput object — typebox guarantees the 4 fields are strings; validateNote
  catches the empty/whitespace case). Add the internal `isRecord` guard for runtime defense, but do NOT change
  the parameter type to `NoteInput | null`.

### Documentation & References

```yaml
# MUST READ — authoritative sources for validateNote + NoteInput
- file: spec/04-data-model.md
  section: "§2.1 NoteInput — what the agent passes to mulligan_rewind"
  why: "THE source of the NoteInput interface — the 4 field names, their order, and 'All four fields are
        required and non-empty (enforced by the tool)'. Field names/casing/optionality are load-bearing: NoteInput
        is ALSO persisted verbatim in RewindMarker.note (§3, line 132) and is renderNote's first param (§2.3)."
  critical: "NoteInput = { what_happened, avoid, true_current_state, next } — all 4 string, all required."

- file: spec/05-tools.md
  section: "§1 mulligan_rewind, step 2 (Validate note)"
  why: "THE behavioral contract: 'all four note.* fields are non-empty after trim. Else return \"Mulligan:
        refused — note fields must all be non-empty.\"' Pins the EXACT reason string + the trim check + that a
        half-hearted note is rejected (confabulation defense)."
  critical: "Reason literal = 'note fields must all be non-empty' (no trailing period — the tool adds the prefix
        'Mulligan: refused — ' and the sentence-closing '.')."

- file: spec/08-edge-cases.md
  section: "E9 (Note field validation failure)"
  why: "THE edge case validateNote exists to handle: empty note field (e.g. what_happened:\"\") → 'a vacuous note
        defeats the confabulation defense' → tool refuses 'note fields must all be non-empty.' 'The structured note
        is non-negotiable.'"

- file: spec/10-testing.md
  section: "§1.8 renderNote / field validation"
  why: "THE Tier-1 test section: 'Any empty field → validation refuses (returns a structured error, not a
        rendered note).' (The snapshot part is renderNote/S2; the field-validation-refuses part is THIS task.)"

- file: spec/03-architecture.md
  section: "§2.3 Pure helpers + §7 Module layout (line 183: notes.ts PURE: renderNote + field validation)"
  why: "Confirms notes.ts is a pure helper (unit-testable without Pi/model/session). validateNote IS the 'field
        validation' named there."

- file: spec/11-build-order.md
  section: "§1 Repository layout (line 30: notes.ts PURE: validateNote, renderNote, renderBloatReminder, renderDriftNudge)"
  why: "Confirms notes.ts holds all 4 note helpers (S1 ships validateNote; S2/S3 append the rest) AND test/
        notes.test.ts is the test file. Confirms notes.ts is the pure-helper tier (not the foundation zero-imports tier)."

# SIBLINGS TO MIRROR (read-only — do NOT import)
- file: src/tokens.ts
  why: "The closest sibling (foundation pure helper). MIRROR: the module header doc structure, the
        isRecord (≈line 151-154) + readOwn (≈line 158-163) defensive helpers (copy verbatim), the never-throws /
        fail-open discipline, the S1→S2 append pattern (S2 APPENDS and REUSES S1's hoisted helpers — see the
        'P1.M2.T1.S2 additions' comment block), and the pattern of EXPORTING a reusable const (CHARS_PER_TOKEN)
        analogous to NOTE_INVALID_REASON."
  pattern: "isRecord/readOwn swallow Proxy-trap throws so the function never throws; export a pinned const for DRY reuse."

- file: src/ledger.ts
  why: "The pure-helper-tier sibling just landed (parallel P1.M2.T2.S1). Confirms the module-header + GOTCHA +
        defensive-helper conventions in active use. validateNote does NOT import it (zero coupling at S1) —
        renderNote/S2 will, via `import type { FileLedger }`."
  pattern: "Same isRecord/readOwn helpers; same never-throws discipline; same tsc/vitest-only validation (no lint step)."

- file: test/tokens.test.ts
  why: "THE test convention to mirror: `import { describe, it, expect, expectTypeOf } from 'vitest'`; import from
        '../src/notes.js' (.js ext, Bundler resolution); NO beforeEach (pure, stateless); describe blocks grouped
        by concern; expectTypeOf for type assertions; a throwing-Proxy defensive test."
  pattern: "describe('validateNote — spec/05 §1 step2 + E9 + §1.8 contract'); pinned-contract first, edge cases, defensive, types."

- file: plan/001_2e5baf25fe9f/P1M2T3S2  # (downstream — renderNote) — referenced, not yet written
  why: "renderNote(note, ledger, granularity) is S2 — it APPENDS to this notes.ts and consumes NoteInput (this
        task's export) + FileLedger (from ledger.ts) + Granularity (from config.ts). So NoteInput's field names/
        casing are a load-bearing contract — match spec/04 §2.1 verbatim. NOTE: S2 will ADD imports to notes.ts."

- file: plan/001_2e5baf25fe9f/architecture/system_context.md
  section: "Module layout (notes.ts: validateNote, renderNote) + Decision D2"
  why: "Confirms D2 (agent-authored structured note = confabulation defense) — the WHY behind validateNote's strictness."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; devDeps typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts           # MulliganConfig + Granularity (read-only sibling). DO NOT TOUCH.
│   ├── log.ts              # fail-open JSONL logger (read-only sibling). DO NOT TOUCH.
│   ├── runtime.ts          # per-session map (read-only sibling). DO NOT TOUCH.
│   ├── tokens.ts           # pure helper sibling to MIRROR (isRecord/readOwn, never-throws, S1→S2 append). DO NOT TOUCH.
│   └── ledger.ts           # pure helper sibling just landed (P1.M2.T2.S1). DO NOT TOUCH. (validateNote does NOT import it.)
├── test/
│   ├── config.test.ts / log.test.ts / runtime.test.ts / tokens.test.ts / ledger.test.ts  # Read-only (mirror tokens.test.ts).
└── spec/                   # 04 §2.1 + 05 §1 step2 + 08 E9 + 10 §1.8 + 03 §2.3 + 11 §1 are authoritative.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   5 files / 146 tests green (config 21, ledger 39, log 15, runtime 20, tokens 51). This task is pure + additive
#   (2 new files); it cannot regress the baseline.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
#   The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent a lint/format command.
```

### Desired Codebase tree with files to be CREATED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── notes.ts            # CREATED — NoteInput + NoteValidation + NOTE_INVALID_REASON + validateNote + isRecord/readOwn. ZERO imports at S1.
└── test/
    └── notes.test.ts       # CREATED — vitest Tier-1: pinned contract + per-field empty/whitespace + non-string + single-reason + defensive + types.
# No other files touched.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — This is S1 of a 3-part notes.ts. Ship ONLY validateNote + NoteInput + helpers.
#   S2 (renderNote) and S3 (renderBloatReminder/renderDriftNudge) APPEND to src/notes.ts later and REUSE the
#   module-private isRecord/readOwn you write here (hoisted in the same module scope — exactly like tokens.ts's
#   S2 reused S1's helpers; see src/tokens.ts 'P1.M2.T1.S2 additions' comment). Write isRecord/readOwn as plain
#   module-private functions (not exported) so S2/S3 can call them. Do NOT render anything, do NOT touch ledger.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — notes.ts is the PURE-HELPER tier, NOT the foundation zero-imports tier.
#   tokens.ts + ledger.ts are "consumer of NO other module" (permanent zero-imports gate). notes.ts is NOT —
#   spec/11 §1 + spec/03 §2.3 list it as a pure helper that MAY import other pure modules. At S1, validateNote
#   needs no imports → grep shows 0. But S2 (renderNote) WILL ADD `import type { FileLedger } from "./ledger.js"`
#   + `import type { Granularity } from "./config.js"`. That is EXPECTED and correct — do NOT "defend" a
#   permanent zero-imports gate here (that would block S2). The gate for THIS task is "zero imports at S1 only".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — NEVER throw (rewind-tool hot path; spec/05 step 2; E9/E13 discipline). isRecord guards
#   a null/array/primitive passed as NoteInput; readOwn reads each field WITHOUT triggering a throwing Proxy
#   get-trap (try/catch → undefined). A malformed note, a missing/non-string/whitespace field, or a throwing-Proxy
#   note → {valid:false, reason} — NEVER an exception. `expect(() => validateNote(...)).not.toThrow()` must pass.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — Read each field via readOwn (NOT direct note.field). `note` is typed NoteInput (all 4
#   required strings), so `note.what_happened` is statically `string` and `typeof note.what_happened !== 'string'`
#   is DEAD CODE (TS narrows it away). readOwn(note, field) returns `unknown`, so the `typeof === 'string'` check
#   is REAL (catches a runtime-non-string value when a caller violates the type) AND Proxy-safe. This is exactly
#   what the item_description's `typeof === 'string'` requirement demands. Iterate a `readonly (keyof NoteInput)[]`
#   tuple of the 4 field names and readOwn each.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — The reason string is the SINGLE spec-pinned literal, EXACTLY: "note fields must all be non-empty"
#   (NO trailing period). spec/05 wraps it as "Mulligan: refused — note fields must all be non-empty." (the tool
#   adds the prefix + sentence period); spec/08 E9 and the item_description use the bare phrase. Every failure
#   returns this SAME string (do NOT vary it per field — the rewind tool shows one refusal text either way).
#   Define `export const NOTE_INVALID_REASON = "note fields must all be non-empty"` and return {reason: NOTE_INVALID_REASON}
#   so the rewind tool (S2-consumer P1.M5.T1.S1) reuses the exact literal (DRY).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — The trim check is the SUBSTANCE. `field.trim().length > 0` rejects "" AND "   \n\t  " (whitespace-
#   only). It must NOT reject genuinely-valid content that merely has surrounding whitespace ("  real text  " →
#   valid). typeof string && trim().length > 0 — both conjuncts, in that order (short-circuit avoids .trim() on a
#   non-string). A non-string value (number/null/undefined) fails the typeof conjunct → invalid (not a throw).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — Keep the public signature EXACTLY `validateNote(note: NoteInput): NoteValidation`. Do NOT widen to
#   `NoteInput | null` (the contract pins NoteInput; the rewind tool always has a real note object). The internal
#   isRecord guard provides runtime defense for a type-violating caller WITHOUT changing the parameter type. At
#   the type level NoteInput is always a record, so TS treats the `!isRecord(note)` branch as unreachable — that
#   is fine (it compiles cleanly; the runtime guard still executes). Do NOT add `// @ts-ignore`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — NoteInput field names + optionality are a CONTRACT. They are consumed by: renderNote (S2),
#   RewindMarker.note (spec/04 §3, persisted verbatim), and the typebox RewindParams schema (spec/05 §1). Define
#   NoteInput EXACTLY as spec/04 §2.1: { what_happened, avoid, true_current_state, next } — all `string`, all
#   required (no `?`, no `| undefined`). An `expectTypeOf<NoteInput>().toEqualTypeOf<{...}>()` test pins it.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — The test imports from "../src/notes.js" (.js extension, even though the file is notes.ts).
#   moduleResolution:"Bundler" + package.json type:"module" → TS resolves the .js to .ts. This is the established
#   convention (tokens.test.ts, ledger.test.ts both use ../src/<file>.js). Do NOT use ../src/notes.ts.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/notes.ts — NoteInput (spec/04 §2.1 verbatim) + validation result + pinned reason.

/**
 * NoteInput — what the agent passes to mulligan_rewind as the `note` (spec/04 §2.1). All four fields are
 * REQUIRED non-empty strings (enforced by validateNote; see spec/05 §1 step 2 + spec/08 E9). The structure is
 * the PRIMARY defense against confabulation (D2). EXPORTED so the rewind tool, renderNote (S2), and tests share
 * ONE canonical type. ALSO persisted verbatim in RewindMarker.note (spec/04 §3) — field names/casing are a contract.
 */
export interface NoteInput {
  /** What went wrong, concretely. Past tense. */
  what_happened: string;
  /** What NOT to do again. Imperative. */
  avoid: string;
  /** The current TRUE world state as of the rewind (files changed, commands run, decisions made). */
  true_current_state: string;
  /** The immediate next action to take on resume. Imperative. */
  next: string;
}

/** Result of validateNote. `reason` is present iff `valid` is false (always NOTE_INVALID_REASON). EXPORTED. */
export interface NoteValidation {
  valid: boolean;
  /** Present only when valid===false; always NOTE_INVALID_REASON. */
  reason?: string;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 5 files / 146 tests green
  - RUN: test ! -e src/notes.ts && echo "ok: notes.ts absent (this task CREATES it)"

Task 1: CREATE src/notes.ts   (exact content below — copy verbatim)
  - CREATE the file with: the header doc, NoteInput, NoteValidation, NOTE_INVALID_REASON, NOTE_FIELDS, validateNote,
    and the module-private isRecord/readOwn helpers.
  - CONSTRAINTS:
      * ZERO imports at S1 (GOTCHA — grep must be 0; notes.ts is pure-helper tier, NOT a permanent zero-imports gate — GOTCHA #2).
      * Read fields via readOwn so the typeof check is real (GOTCHA #4); isRecord guard first (GOTCHA #3).
      * Single pinned reason NOTE_INVALID_REASON (GOTCHA #5); trim check is the substance (GOTCHA #6).
      * Signature exactly validateNote(note: NoteInput): NoteValidation (GOTCHA #7); NoteInput exactly spec/04 §2.1 (GOTCHA #8).
      * Write isRecord/readOwn as module-private (NOT exported) so S2/S3 can reuse them (GOTCHA #1).
  - NAMING/PLACEMENT: src/notes.ts. Exported: NoteInput, NoteValidation, NOTE_INVALID_REASON, validateNote.
    Module-local: NOTE_FIELDS, isRecord, readOwn.

Task 2: CREATE test/notes.test.ts   (exact content below — copy verbatim)
  - CREATE the file with: the vitest import, the notes import (../src/notes.js — GOTCHA #9), a VALID_NOTE constant,
    and the describe blocks: pinned contract, per-field empty+whitespace, non-string/missing, single-reason,
    genuine-content-passes, defensive (never-throws incl. throwing-Proxy), types.
  - CONSTRAINTS: NO beforeEach (pure, stateless). Mirror tokens.test.ts conventions.
  - COVERAGE: pinned contract (all 4 present→valid; any empty→invalid+reason); each field empty AND whitespace-only;
    non-string (number/null/undefined); single pinned reason (NOTE_INVALID_REASON exported + no trailing period);
    genuine content with surrounding whitespace passes; defensive null/array/Proxy never-throws; expectTypeOf types.

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + zero-imports grep) and Level 2 (vitest). Levels 3/4 N/A (pure helper, no Pi runtime).
```

#### Exact content to CREATE — `src/notes.ts` (Task 1 — copy verbatim)

```ts
/**
 * notes.ts — Mulligan's note validation + rendering (pure helpers).
 * spec/04-data-model.md §2.1 (NoteInput), spec/05-tools.md §1 step 2 (validate note: all four non-empty),
 *   spec/08-edge-cases.md E9 (note field validation failure → refuse), spec/10-testing.md §1.8 (field validation),
 *   spec/03-architecture.md §2.3/§7 + spec/11 §1 (notes.ts = pure helper: validateNote/renderNote/...).
 *
 * DESIGN (read GOTCHA #1–#10 in the PRP):
 * - Pure-helper tier and Pi-FREE. At S1 (THIS task) validateNote imports NOTHING — it is fully unit-testable in
 *   isolation. P1.M2.T3.S2 (renderNote) APPENDS to this module and will ADD `import type { FileLedger } from
 *   "./ledger.js"` + `import type { Granularity } from "./config.js"` — that is EXPECTED and correct: notes.ts is
 *   the PURE-HELPER tier (spec/11 §1), NOT the foundation zero-imports tier (tokens.ts/ledger.ts). So unlike
 *   tokens.ts/ledger.ts, notes.ts is NOT bound to a PERMANENT zero-imports gate; only S1 keeps the count at 0.
 * - validateNote is the rewind tool's runtime guard against a vacuous note (spec/05 §1 step 2, E9). The structured
 *   note is the PRIMARY defense against confabulation (D2); a half-hearted note (any field missing / empty /
 *   whitespace-only) is rejected. The single reason "note fields must all be non-empty" is SPEC-PINNED (spec/05
 *   step 2, E9); the rewind tool prefixes it as "Mulligan: refused — <reason>.".
 * - NEVER throws (rewind-tool hot path; E9/E13 discipline). isRecord guards a null/array/primitive note; readOwn
 *   reads each field WITHOUT triggering a throwing Proxy get-trap. A malformed note or a field that is
 *   missing/non-string/whitespace-only → { valid:false, reason }. `note` is typed NoteInput (all four required
 *   strings) but fields are read as `unknown` via readOwn so the `typeof === 'string'` check is REAL, not dead code.
 *
 * NOTE: P1.M2.T3.S2 (renderNote) + P1.M2.T3.S3 (renderBloatReminder/renderDriftNudge) APPEND to this file next
 *   and REUSE the module-private isRecord/readOwn helpers below (hoisted in this module scope — mirrors how
 *   tokens.ts's S2 reused S1's helpers).
 */

// ── NoteInput (spec/04-data-model.md §2.1 — field names + optionality are load-bearing) ──────────

/**
 * NoteInput — what the agent passes to mulligan_rewind as the `note` (spec/04 §2.1). All four fields are
 * REQUIRED non-empty strings (enforced by validateNote; see spec/05 §1 step 2 + spec/08 E9). The structure is
 * the primary defense against confabulation (D2): the resumed model is told explicitly what happened, what to
 * avoid, the true current state, and what to do next. EXPORTED so the rewind tool, renderNote (S2), and tests
 * share one canonical type. ALSO persisted verbatim in RewindMarker.note (spec/04 §3).
 */
export interface NoteInput {
  /** What went wrong, concretely. Past tense. e.g. "Ran `grep -r auth .` and dumped ~40k tokens I didn't need." */
  what_happened: string;
  /** What NOT to do again. Imperative. e.g. "Do not run grep without --quiet, -c, or piping to head." */
  avoid: string;
  /** The current TRUE world state as of the rewind — files changed, commands run, decisions made on the span. */
  true_current_state: string;
  /** The immediate next action to take on resume. Imperative. e.g. "Re-run the search as `grep -rl auth src/`." */
  next: string;
}

/** Result of validateNote. `reason` is present iff `valid` is false (always NOTE_INVALID_REASON). EXPORTED. */
export interface NoteValidation {
  valid: boolean;
  /** Present only when valid===false; always NOTE_INVALID_REASON. */
  reason?: string;
}

/**
 * NOTE_INVALID_REASON — the single, spec-pinned refusal reason (spec/05 §1 step 2: "Mulligan: refused — note
 * fields must all be non-empty."; spec/08 E9: "note fields must all be non-empty."). NO trailing period — the
 * rewind tool adds the prefix "Mulligan: refused — " and the sentence-closing "." when it formats its refusal.
 * EXPORTED so the rewind tool reuses the exact literal (DRY + consistency) and so tests can pin it.
 */
export const NOTE_INVALID_REASON = "note fields must all be non-empty";

/** The four required, non-empty note fields, in spec/04 §2.1 order. Drives validateNote's loop (module-local). */
const NOTE_FIELDS: readonly (keyof NoteInput)[] = [
  "what_happened",
  "avoid",
  "true_current_state",
  "next",
];

/**
 * validateNote — assert all four NoteInput fields are non-empty strings AFTER TRIM (spec/05 §1 step 2, spec/08 E9,
 * spec/10 §1.8). The rewind tool calls this as step 2 of its behavior, BEFORE persisting the marker + note; a
 * vacuous note is refused so it cannot defeat the confabulation defense (D2).
 *
 * Each field must satisfy `typeof === 'string' && field.trim().length > 0`. Any failure (missing, non-string,
 * empty, or whitespace-only) → { valid:false, reason: NOTE_INVALID_REASON }. All four present + non-empty →
 * { valid:true }. The reason is the SAME single string for every failure (spec-pinned) — we do NOT vary it per
 * field, because the rewind tool shows one refusal text either way.
 *
 * Pure + defensive: NEVER throws (rewind-tool hot path; E9/E13-style discipline). isRecord guards a
 * null/array/primitive note passed as NoteInput; readOwn reads each field WITHOUT triggering a throwing Proxy
 * get-trap. Fields are read as `unknown` via readOwn, so the `typeof === 'string'` check is REAL (not dead code):
 * it catches a runtime-non-string value when a caller violates the NoteInput type.
 *
 * @param note the agent's NoteInput (a real note object assigns in with no cast)
 * @returns { valid:true } or { valid:false, reason: NOTE_INVALID_REASON }
 */
export function validateNote(note: NoteInput): NoteValidation {
  if (!isRecord(note)) {
    // null / primitive / array passed as NoteInput → invalid (defensive; never throws). At the type level
    // NoteInput is always a record, so TS treats this branch as unreachable — that is fine; the runtime guard
    // still executes for a type-violating caller.
    return { valid: false, reason: NOTE_INVALID_REASON };
  }
  for (const field of NOTE_FIELDS) {
    const value = readOwn(note, field);
    // typeof first (short-circuit: avoids .trim() on a non-string); then non-empty after trim.
    if (typeof value !== "string" || value.trim().length === 0) {
      return { valid: false, reason: NOTE_INVALID_REASON };
    }
  }
  return { valid: true };
}

// ── module-private defensive helpers (mirror tokens.ts/ledger.ts — never throw; reused by S2/S3) ────

/** True for plain records (and Object.create(null)); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable. */
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}
```

#### Exact content to CREATE — `test/notes.test.ts` (Task 2 — copy verbatim)

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateNote,
  NOTE_INVALID_REASON,
  type NoteInput,
  type NoteValidation,
} from "../src/notes.js";

// No beforeEach needed: notes.ts has NO module-scoped mutable state (pure functions + constants only).

/** A fully-valid note (all four fields non-empty) — a realistic spec/04 §2.1 example. */
const VALID_NOTE: NoteInput = {
  what_happened: "Ran `grep -r auth .` and dumped ~40k tokens of output I didn't need.",
  avoid: "Do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool which truncates.",
  true_current_state: "No files were modified on the abandoned span.",
  next: "Re-run the search as `grep -rl auth src/` and read only the 3 relevant files.",
};

describe("validateNote — spec/05 §1 step 2 + spec/08 E9 + spec/10 §1.8 contract (pinned)", () => {
  it("all four fields present + non-empty → { valid: true } (no reason)", () => {
    const r = validateNote(VALID_NOTE);
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("returns a NoteValidation { valid: boolean; reason?: string }", () => {
    const ok = validateNote(VALID_NOTE);
    expect(ok).toEqual({ valid: true });
    const bad = validateNote({ ...VALID_NOTE, what_happened: "" });
    expect(bad.valid).toBe(false);
    expect(typeof bad.reason).toBe("string");
  });
});

describe("validateNote — every field is independently required (any empty/whitespace → invalid)", () => {
  const FIELDS = ["what_happened", "avoid", "true_current_state", "next"] as const;

  for (const field of FIELDS) {
    it(`empty ${field} → invalid with the pinned reason (E9)`, () => {
      const r = validateNote({ ...VALID_NOTE, [field]: "" });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("note fields must all be non-empty");
    });

    it(`whitespace-only ${field} → invalid (trim check — GOTCHA #6)`, () => {
      const r = validateNote({ ...VALID_NOTE, [field]: "   \n\t  " });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("note fields must all be non-empty");
    });
  }
});

describe("validateNote — non-string / missing fields → invalid (typeof check — GOTCHA #4)", () => {
  it("a field set to a number → invalid", () => {
    const r = validateNote({ ...VALID_NOTE, next: 42 as unknown as string });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("note fields must all be non-empty");
  });

  it("a field set to null → invalid", () => {
    const r = validateNote({ ...VALID_NOTE, avoid: null as unknown as string });
    expect(r.valid).toBe(false);
  });

  it("a field set to undefined (missing at runtime) → invalid", () => {
    const r = validateNote({ ...VALID_NOTE, what_happened: undefined as unknown as string });
    expect(r.valid).toBe(false);
  });
});

describe("validateNote — the reason is the SINGLE spec-pinned string (GOTCHA #5)", () => {
  it("NOTE_INVALID_REASON is exported and equals the pinned literal (spec/05 step2, E9)", () => {
    expect(NOTE_INVALID_REASON).toBe("note fields must all be non-empty");
    // no trailing period — the rewind tool adds "Mulligan: refused — <reason>."
    expect(NOTE_INVALID_REASON.endsWith(".")).toBe(false);
  });

  it("every failure returns the SAME reason (no per-field variation)", () => {
    const a = validateNote({ ...VALID_NOTE, what_happened: "" });
    const b = validateNote({ ...VALID_NOTE, next: "  " });
    const c = validateNote({ ...VALID_NOTE, avoid: null as unknown as string });
    expect(a.reason).toBe(NOTE_INVALID_REASON);
    expect(b.reason).toBe(NOTE_INVALID_REASON);
    expect(c.reason).toBe(NOTE_INVALID_REASON);
  });
});

describe("validateNote — trim does not over-reject genuinely-valid content", () => {
  it("fields with leading/trailing whitespace but real content → valid", () => {
    const r = validateNote({
      what_happened: "  went down a rabbit hole  ",
      avoid: " don't grep without filters ",
      true_current_state: " scratch.ts was created ",
      next: " delete scratch.ts and restart ",
    });
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("single-character fields are valid (non-empty after trim)", () => {
    const r = validateNote({ what_happened: "x", avoid: "y", true_current_state: "z", next: "w" });
    expect(r.valid).toBe(true);
  });
});

describe("validateNote — defensive (NEVER throws — GOTCHA #3)", () => {
  it("a null note passed as NoteInput → invalid, not a throw", () => {
    expect(() => validateNote(null as unknown as NoteInput)).not.toThrow();
    expect(validateNote(null as unknown as NoteInput).valid).toBe(false);
  });

  it("an array passed as NoteInput → invalid, not a throw", () => {
    const arr = ["x", "y", "z", "w"] as unknown as NoteInput;
    expect(() => validateNote(arr)).not.toThrow();
    expect(validateNote(arr).valid).toBe(false);
  });

  it("a primitive passed as NoteInput → invalid, not a throw", () => {
    expect(() => validateNote("not a note" as unknown as NoteInput)).not.toThrow();
    expect(validateNote("not a note" as unknown as NoteInput).valid).toBe(false);
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
    expect(() => validateNote(trap)).not.toThrow();
    // every property read throws → fields read as undefined → typeof !== 'string' → invalid
    expect(validateNote(trap).valid).toBe(false);
  });
});

describe("types", () => {
  it("NoteInput has exactly the four required string fields (spec/04 §2.1)", () => {
    expectTypeOf<NoteInput>().toEqualTypeOf<{
      what_happened: string;
      avoid: string;
      true_current_state: string;
      next: string;
    }>();
  });

  it("validateNote returns NoteValidation", () => {
    expectTypeOf(validateNote(VALID_NOTE)).toEqualTypeOf<NoteValidation>();
  });

  it("NoteValidation is { valid: boolean; reason?: string }", () => {
    expectTypeOf<NoteValidation>().toEqualTypeOf<{ valid: boolean; reason?: string }>();
  });

  it("NOTE_INVALID_REASON is a string", () => {
    expectTypeOf(NOTE_INVALID_REASON).toEqualTypeOf<string>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: validateNote reads each field via readOwn so the typeof check is REAL + Proxy-safe (GOTCHA #4).
//   `note` is typed NoteInput (all 4 required strings), so direct `note.what_happened` is statically `string`
//   and `typeof note.what_happened !== 'string'` is DEAD CODE (TS narrows it). readOwn returns `unknown` → the
//   check is meaningful at runtime (catches a type-violating caller) AND never throws (try/catch on the get-trap).
for (const field of NOTE_FIELDS) {
  const value = readOwn(note, field);
  if (typeof value !== "string" || value.trim().length === 0) {  // typeof FIRST (short-circuit on non-string)
    return { valid: false, reason: NOTE_INVALID_REASON };
  }
}

// PATTERN: isRecord guard FIRST (defensive; never throws — GOTCHA #3). At the type level NoteInput is always a
//   record, so TS marks this branch unreachable — that is fine; it compiles and the runtime guard still runs.
if (!isRecord(note)) {
  return { valid: false, reason: NOTE_INVALID_REASON };
}

// PATTERN: single spec-pinned reason, returned for EVERY failure (GOTCHA #5). Do NOT vary per field.
//   The rewind tool formats: `Mulligan: refused — ${NOTE_INVALID_REASON}.`
```

### Integration Points

```yaml
# This task adds NO integration points — it is a pure, import-free helper. It CONSUMES nothing and PERSISTS
# nothing. The only seams are the EXPORTS other tasks will consume:

EXPORTS (consumed by downstream tasks):
  - NoteInput           → renderNote (S2) first param; RewindMarker.note (spec/04 §3); tools/rewind.ts (P1.M5.T1.S1).
  - validateNote        → tools/rewind.ts step 2 (P1.M5.T1.S1).
  - NOTE_INVALID_REASON → tools/rewind.ts refusal-text formatting (P1.M5.T1.S1).
  - NoteValidation      → tools/rewind.ts validation-branch typing (P1.M5.T1.S1).
  - isRecord / readOwn  → module-private; REUSED by renderNote (S2) + renderBloatReminder/renderDriftNudge (S3).

CONFIG:    none (validateNote takes no config).
DATABASE:  none (pure; persists nothing).
ROUTES:    none (no Pi surface at S1).
IMPORTS:   none at S1 (S2 will ADD `import type { FileLedger }` + `import type { Granularity }` — expected).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/notes.ts — fix before proceeding.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
# TS strict IS the type+style gate. (GOTCHA #10 — do NOT invent a lint/format command.)

# Type-check the new module + test under strict.
npx tsc --noEmit -p tsconfig.json            # Expected: exit 0. If errors, READ the output and fix.

# Zero-imports gate AT S1 (notes.ts is pure-helper tier — this gate is S1-only; S2 will add imports — GOTCHA #2).
test "$(grep -cE '^import|^from' src/notes.ts)" -eq 0 && echo "ok: zero imports at S1" \
  || { echo "FAIL: notes.ts has imports at S1 (must be 0)"; grep -nE '^import|^from' src/notes.ts; }

# Expected: "ok: zero imports at S1" and tsc exit 0.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new notes suite as it is created.
npx vitest run test/notes.test.ts            # Expected: all notes tests pass.

# Full suite — confirm NO regression to the baseline (5 files / 146 tests → 6 files / 146+N).
npx vitest run                               # Expected: 6 files all green.

# Expected: all tests pass. If failing, debug root cause and fix the implementation (do NOT weaken the tests —
#   the pinned contract + edge cases are spec-mandated).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — validateNote is a pure, import-free helper with NO Pi runtime surface. There is no server to start,
# no endpoint to hit, no MCP tool to invoke, no database. Integration is exercised later by tools/rewind.ts
# (P1.M5.T1.S1) and the integration smoke harness (P1.M7.T2.S1). This subtask's "integration" is the tsc +
# vitest gates above. (See GOTCHA #10 — do not invent commands.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for this pure helper. The domain-specific validation (the confabulation-defense guarantee) is encoded
# directly in the Level-2 tests: any empty/whitespace field → invalid with the pinned reason. There is nothing
# further to run at S1. (Performance/security/load testing apply to the tool layer, not this pure function.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 green: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Zero imports at S1: `grep -cE '^import|^from' src/notes.ts` → 0.
- [ ] Level 2 green: `npx vitest run` → 6 files all pass (no regression to the 146-test baseline).
- [ ] `npx vitest run test/notes.test.ts` → all notes tests pass.

### Feature Validation

- [ ] **Pinned contract (spec/10 §1.8 + E9):** all 4 fields present + non-empty → `{valid:true}`; any of the 4
      empty → `{valid:false, reason:"note fields must all be non-empty"}`.
- [ ] **trim check:** whitespace-only field → invalid; genuine content with surrounding whitespace → valid.
- [ ] **typeof check:** non-string field (number/null/undefined) → invalid.
- [ ] **single reason:** `NOTE_INVALID_REASON === "note fields must all be non-empty"` (no trailing period);
      every failure returns that exact string.
- [ ] **never throws:** null/array/primitive/throwing-Proxy note → `{valid:false}`, no exception.
- [ ] **NoteInput exactly spec/04 §2.1:** 4 required string fields (asserted via `expectTypeOf`).

### Code Quality Validation

- [ ] Mirrors `tokens.ts`/`ledger.ts` conventions (module header doc, isRecord/readOwn, never-throws).
- [ ] File placement matches the desired tree (`src/notes.ts`, `test/notes.test.ts`).
- [ ] `isRecord`/`readOwn` are module-private (reusable by S2/S3) — NOT exported.
- [ ] Signature is exactly `validateNote(note: NoteInput): NoteValidation` (not widened to `NoteInput | null`).
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] Module header doc cites the spec sections + the GOTCHA-driven design.
- [ ] `NoteInput` field doc-comments mirror spec/04 §2.1 (mandated purpose of each field).
- [ ] No new environment variables (pure, import-free).

---

## Anti-Patterns to Avoid

- ❌ Don't read fields directly (`note.what_happened`) — that makes the `typeof === 'string'` check dead code and is
  not Proxy-safe. Read via `readOwn(note, field)` (GOTCHA #4).
- ❌ Don't vary the reason per field — it is the SINGLE spec-pinned literal for every failure (GOTCHA #5).
- ❌ Don't add a trailing period to `NOTE_INVALID_REASON` — the rewind tool adds it (GOTCHA #5).
- ❌ Don't widen the public signature to `NoteInput | null` — the contract pins `NoteInput`; use the internal
  `isRecord` guard for runtime defense (GOTCHA #7).
- ❌ Don't defend a PERMANENT zero-imports gate — notes.ts is pure-helper tier; S2 legitimately adds imports (GOTCHA #2).
- ❌ Don't catch all exceptions broadly at the top — the only `try/catch` is inside `readOwn` (a targeted Proxy-trap
  swallow, mirroring tokens.ts). validateNote itself has no try/catch; defensiveness comes from isRecord/readOwn.
- ❌ Don't implement renderNote / the rewind tool / the typebox schema — those are S2 / P1.M5.T1.S1. Ship ONLY validateNote + NoteInput.
- ❌ Don't invent a lint/format command (no eslint/prettier configured) — the gate is `tsc --noEmit` + `vitest` (GOTCHA #10).

---

## Confidence Score

**9/10** for one-pass implementation success. The deliverable is small (one pure function + one interface +
two tiny defensive helpers, all given verbatim), the contract is pinned verbatim in three spec sections, the
baseline is verified green, and the file is additive (cannot regress). The −1 is for the one non-obvious
correctness subtlety (GOTCHA #4: read fields via `readOwn` so the `typeof` check is real, not dead code) — which
the PRP spells out and the exact-content block already implements correctly.

**Confidence Score**: 9/10