# Codebase Recon — P1.M2.T3.S1 (`validateNote` + `NoteInput`)

**Scope:** CREATE `src/notes.ts` (validateNote + NoteInput + module-private defensive helpers) and
`test/notes.test.ts`. **No other file touched.** This is S1 of a 3-part `notes.ts` (S2 = renderNote;
S3 = renderBloatReminder + renderDriftNudge). `notes.ts` is greenfield.

---

## 1. What the spec pins (verbatim sources)

### 1.1 `NoteInput` — spec/04-data-model.md §2.1 (load-bearing field names)
```ts
interface NoteInput {
  what_happened: string;     // Past tense: what went wrong, concretely.
  avoid: string;             // Imperative: what NOT to do again.
  true_current_state: string;// The TRUE current state (files changed, commands run, decisions made).
  next: string;              // Imperative: the immediate next action on resume.
}
```
- "All four fields are **required and non-empty** (enforced by the tool; see `@05-tools.md`)."
- "This structure is the primary defense against confabulation (D/D17)."
- NoteInput is ALSO persisted verbatim in `RewindMarker.note` (spec/04 §3, line 132: `note: NoteInput`) AND
  is the input to `renderNote(note, ledger, granularity)` (spec/04 §2.3). So field names/casing/optionality
  are a CONTRACT consumed by renderNote (S2) + the persisted marker + the typebox schema.

### 1.2 validateNote contract — spec/05-tools.md §1 step 2 + spec/08 E9 + spec/10 §1.8 + item_description
- **spec/05 §1 step 2:** "Validate note: all four `note.*` fields are non-empty after trim. Else return
  `'Mulligan: refused — note fields must all be non-empty.'` (The structured note is the confabulation
  defense; half-hearted notes are rejected.)"
- **spec/08 E9:** "the agent calls `mulligan_rewind` with an empty `note` field (e.g. `what_happened: ""`).
  Risk: a vacuous note defeats the confabulation defense. Behavior: tool refuses: 'note fields must all be
  non-empty.' The structured note is non-negotiable."
- **spec/10 §1.8** ("renderNote / field validation"): "Any empty field → validation refuses (returns a
  structured error, not a rendered note). Snapshot tests for representative notes." (Snapshot = renderNote/S2;
  field-validation-refuses = validateNote/THIS task.)
- **item_description LOGIC (pinned):** `validateNote(note: NoteInput): { valid: boolean; reason?: string }`.
  Check all 4 fields: `typeof === 'string' && field.trim().length > 0`. Return
  `{valid:false, reason:'note fields must all be non-empty'}` if any fail.

### 1.3 PINNED reason string
`'note fields must all be non-empty'` — **no trailing period** (spec/05 wraps it as
`"Mulligan: refused — <reason>."` — the tool adds the prefix + sentence-closing period). item_description and
E9 both use the bare phrase. → define `NOTE_INVALID_REASON = "note fields must all be non-empty"` and EXPORT it
so the rewind tool (P1.M5.T1.S1) reuses the exact literal (DRY + the test pins it).

---

## 2. Module tiering — is notes.ts zero-imports?

NO. `notes.ts` is the **pure-helper tier** (spec/11 §1: "notes.ts # PURE: validateNote, renderNote,
renderBloatReminder, renderDriftNudge"; spec/03 §2.3 line 183, §7). The **foundation zero-imports tier** is
only `tokens.ts` + `ledger.ts` ("consumer of NO other module"). `notes.ts` MAY import other pure modules:
- **S1 (THIS task):** zero imports — validateNote + NoteInput + isRecord/readOwn are self-contained.
- **S2 (renderNote):** will ADD `import type { FileLedger } from "./ledger.js"` + `import type { Granularity } from "./config.js"`.
- **S3 (renderBloatReminder/renderDriftNudge):** appends text renderers.

So: at S1 completion, `grep -cE '^import|^from' src/notes.ts` → **0**, but notes.ts is NOT bound to a
PERMANENT zero-imports gate (unlike tokens.ts/ledger.ts). Document this so S2/S3 are not blocked.

**CRITICAL: zero coupling to ledger.ts at S1.** validateNote does NOT import FileLedger (that's renderNote's
S2 seam). So the parallel P1.M2.T2.S1 (ledger) work does NOT affect this S1. (Confirmed: ledger.ts already
exists on disk + ledger.test.ts passes 39 tests — the parallel agent has landed.)

---

## 3. Sibling patterns to MIRROR (tokens.ts — defensive discipline)

`src/tokens.ts` is the closest sibling (foundation pure helper). Mirror:
- **Module header doc** referencing spec sections + a "DESIGN (read GOTCHA #1–#N in the PRP)" block.
- **Local structural types** + **module-private defensive helpers** `isRecord` / `readOwn` (tokens.ts lines
  ~151–163, copied verbatim below). These swallow Proxy-trap throws so the function NEVER throws.
- **The S1→S2 append discipline** (tokens.ts): S1 created estimateTokens + helpers; S2 APPENDED resultBytes +
  approxTokens and REUSED S1's hoisted `isRecord`/`readOwn`/`stringLength` (a comment block marks "P1.M2.T1.S2
  additions"). notes.ts follows the SAME pattern: S1 ships validateNote + NoteInput + isRecord/readOwn; S2/S3
  append and reuse the hoisted helpers. Write isRecord/readOwn so they are reusable by S2/S3.
- **Exported const for reuse** (tokens.ts exports `CHARS_PER_TOKEN`): notes.ts exports `NOTE_INVALID_REASON`.

### tokens.ts defensive helpers (copy verbatim):
```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try { return obj[key]; } catch { return undefined; }
}
```

### Why validateNote reads fields via readOwn (not direct `note.field`):
`note` is typed `NoteInput` (all 4 required strings). Direct `note.what_happened` is statically `string`, so
`typeof note.what_happened !== "string"` is DEAD CODE (TS narrows it away). Reading via `readOwn(note, field)`
returns `unknown`, making the `typeof === 'string'` check REAL (catches runtime-non-string values when a caller
violates the type) AND Proxy-safe (a throwing get-trap → undefined → invalid, never throws). This matches the
item_description's explicit `typeof === 'string'` requirement and the codebase never-throws discipline.

---

## 4. Test convention to MIRROR (tokens.test.ts + ledger.test.ts)

`test/tokens.test.ts` / `test/ledger.test.ts` conventions (verified by reading both):
- `import { describe, it, expect, expectTypeOf } from "vitest";`
- `import { ..., type NoteInput, type NoteValidation } from "../src/notes.js";` (`.js` ext; moduleResolution
  "Bundler" resolves to `.ts`).
- **NO `beforeEach`** (notes.ts has no module-scoped mutable state — pure functions + constants only).
- `describe`/`it`/`expect` (jest-style) + `expectTypeOf` for type assertions.
- Describe blocks group by concern; inline the spec section each block satisfies.
- Test the pinned contract first, then edge cases, then defensive (never-throws incl. a throwing-Proxy), then
  `expectTypeOf` type tests.

---

## 5. Baseline (VERIFIED LIVE before writing this PRP)

```
npx tsc --noEmit -p tsconfig.json   → exit 0
npx vitest run                       → 5 files / 146 tests green
  test/config.test.ts   (21)
  test/ledger.test.ts   (39)   ← parallel P1.M2.T2.S1 landed
  test/log.test.ts      (15)
  test/runtime.test.ts  (20)
  test/tokens.test.ts   (51)
```
This task is pure + additive (2 new files: src/notes.ts + test/notes.test.ts). It CANNOT regress the baseline.
After: 6 files / 146 + N tests.

### File state (verified):
- `src/notes.ts` → ABSENT (this task CREATES it).
- `test/notes.test.ts` → ABSENT (this task CREATES it).
- `src/ledger.ts` + `test/ledger.test.ts` → PRESENT (parallel S1 landed).
- `src/tokens.ts` / `src/config.ts` / `src/log.ts` / `src/runtime.ts` / `src/index.ts` → present (DO NOT TOUCH).

---

## 6. tsconfig / package.json facts (affect compilation)

- `tsconfig.json`: `strict: true`, `noImplicitAny: true`, `target: ES2022`, `module: ESNext`,
  `moduleResolution: "Bundler"`, `types: ["node"]`, `include: ["src","test"]`. → imports must use `.js`
  extensions under Bundler; unused locals/params error under strict (prefix `_` for intentionally-unused,
  e.g. none needed here).
- `package.json`: `"type": "module"`, devDeps `typescript ^5`, `vitest ^1`, `@types/node ^22`;
  `"scripts": { "test": "vitest run" }`. → `npx vitest run` is the test command; `npx tsc --noEmit -p
  tsconfig.json` is the type gate (there is no separate lint/format step configured — no ruff-equivalent;
  the gate is tsc + vitest).
- **No lint/format tool configured** (no eslint/prettier/biome in devDeps). So the "Level 1 syntax & style"
  validation reduces to `tsc --noEmit` (TS strict IS the style+type gate). Document this — do NOT invent a
  ruff/eslint command.

---

## 7. validateNote signature decision

- **Public signature: `validateNote(note: NoteInput): NoteValidation`** — matches the item_description contract
  EXACTLY (`validateNote(note: NoteInput): { valid: boolean; reason?: string }`). Do NOT widen to
  `NoteInput | null` (the contract pins `NoteInput`); the rewind tool always has a real NoteInput object
  (typebox Type.String on all 4 fields guarantees structure; validateNote catches the empty/whitespace case).
- **Internal defensive guard:** still call `isRecord(note)` first (a caller that violates the type by passing
  null/array → invalid, never throws). At the type level NoteInput is always a record, so TS treats the
  `!isRecord` branch as unreachable — but it compiles cleanly and is zero-cost runtime defense.
- **Define + export `NoteValidation`** (`{ valid: boolean; reason?: string }`) as a named interface — mirrors
  tokens.ts exporting `TokenEstimate`; lets the rewind tool type its branch.

---

## 8. Notes on the parallel sibling (P1.M2.T2.S1 ledger)

The ledger PRP ships `FileLedger` + `extractFileLedger` in `src/ledger.ts`. validateNote does NOT consume
FileLedger (renderNote/S2 does). So:
- No import of ledger.ts in S1.
- The pinned E9/§1.8 tests are independent of ledger.
- No ordering dependency: if ledger S1 were reverted, validateNote still compiles + passes (it touches none of
  ledger's exports). Confirmed by the zero-imports property.