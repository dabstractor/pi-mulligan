name: "P4.M1.T1.S1 — RewindParams schema additions + REWIND_DESC update"
description: |

---

## Goal

**Feature Goal**: Add the two v1.2 opt-in working-tree-revert parameters (`revert_file_changes`,
`delete_created_files`) to the `mulligan_rewind` tool's typebox parameter schema, and advertise
`revert_file_changes` in the LLM-facing `REWIND_DESC` description string — so that the
downstream revert-logic item (P4.M2.T1, "step 6b") can read these flags off `RewindArgs` and the
LLM knows the feature exists.

**Deliverable**: A modified `src/tools/rewind.ts` (two new optional `Type.Boolean` fields in
`RewindParams`; one appended sentence in `REWIND_DESC`) plus updated/new tests in
`test/tools/rewind.test.ts`. `RewindArgs` (`Static<typeof RewindParams>`) auto-picks up the new
fields — no separate type edit is needed.

**Success Definition**:
- `RewindParams` has `revert_file_changes` and `delete_created_files` as `Type.Optional(Type.Boolean(...))` with VERBATIM descriptions from spec/05 §1.
- `REWIND_DESC` ends with the appended `Set revert_file_changes ...` sentence (verbatim from spec/05 §6).
- `RewindArgs` type-includes the two new optional fields.
- The tool STILL accepts `{note, granularity}` WITHOUT the new fields (backward-compat — nothing that previously worked breaks).
- `npx tsc --noEmit` passes; the full rewind test suite passes.
- NO logic is added here — step 6b (the actual `store.restore` call) is P4.M2.T1, a later item. The new params are simply carried on the schema (and ignored by `rewindExecute` until P4.M2.T1 consumes them).

## User Persona

**Target User**: The LLM agent that calls `mulligan_rewind` (the param descriptions ARE its docs — Mode A), and the human operator who reads `REWIND_DESC` in the tool listing.

**Use Case**: After a wrong-direction turn where the agent also edited files, the agent opts into restoring those working-tree files so it need not re-read them on resume.

**Pain Points Addressed**: Without the schema fields there is no way for `rewindExecute` (P4.M2.T1) to receive the agent's opt-in; without the description sentence the LLM never learns the feature exists.

## Why

- **Unblocks P4.M2.T1** (rewindExecute step 6b + E5 warning reword): that item reads
  `params.revert_file_changes` / `params.delete_created_files` off the `RewindArgs` type. This
  item is the schema/type prerequisite.
- **Mode A docs ride with the work**: per the item description, the param descriptions ARE the
  LLM-facing documentation (spec/05 §1), so they must be shipped verbatim with the schema.
- Part of P4.M1 "Tool schema + description" (R5a schema + R5d description). The R5b/R5c logic
  (step 6b + warning reword) is the sibling module P4.M2, explicitly out of scope.

## What

Two additive, non-breaking changes to `src/tools/rewind.ts`, plus test updates:

1. **`RewindParams`** — add two optional boolean fields after the existing `checkpoint` field
   (before the closing `});` of the `Type.Object`).
2. **`REWIND_DESC`** — append one sentence (with a leading space) to the existing string.
3. **Tests** — update the existing verbatim-string assertion, add type assertions for the new
   fields, and add a backward-compat runtime test.

### Success Criteria

- [ ] `RewindParams` (the exported `Type.Object`) includes `revert_file_changes` and `delete_created_files`, each `Type.Optional(Type.Boolean({ description: <verbatim> }))`.
- [ ] `REWIND_DESC` equals the current string + the appended ` Set revert_file_changes ...` sentence (verbatim, leading space).
- [ ] `RewindArgs` (= `Static<typeof RewindParams>`) type-includes `revert_file_changes?: boolean | undefined` and `delete_created_files?: boolean | undefined`.
- [ ] Calling the tool with `{note, granularity}` (no new fields) behaves exactly as before (backward-compat).
- [ ] `npx tsc --noEmit` passes; `npx vitest run test/tools/rewind.test.ts` passes.
- [ ] NO step-6b revert logic is added in this item (the params are carried but not yet acted on — that is P4.M2.T1).

## All Needed Context

### Context Completeness Check

_Pass test_: An implementer who has never seen this codebase is given this PRP + the two files.
They can make the exact edits because every string is verbatim, every insertion point is named,
and the existing tests to update are pinpointed by their current assertion text. ✅

### Documentation & References

```yaml
- docfile: spec/05-tools.md
  why: The VERBATIM source for the two new param descriptions (§1 "Parameter schema") and the
        REWIND_DESC append sentence (§6 "Description strings").
  critical: |
    The item description is AUTHORITATIVE for the exact strings — copy from THIS PRP's
    "Implementation Blueprint" rather than re-transcribing from the spec, to avoid drift.
    IMPORTANT: spec/05 §6 gives the FULL v1.2 description which ALSO contains a checkpoint
    sentence ("granularity 'checkpoint' rewinds back to a checkpoint a user set ..."). That
    checkpoint sentence is NOT in the current code and is OUT OF SCOPE — append ONLY the
    revert_file_changes sentence specified below.

- file: src/tools/rewind.ts
  why: THE file to edit. Contains RewindParams (Type.Object, ~lines 37–94) and REWIND_DESC
        (const string, line 126).
  pattern: |
    - RewindParams fields are formatted multi-line: `Type.Optional(Type.String({ description:
      "..." }))`. Match this style for the new booleans (descriptions are long → wrap).
    - A section-separator comment style already exists in the file, e.g.
      `// ── <title> ──`. The spec shows the separator
      `// ── v1.2 working-tree revert (opt-in). See @14-working-tree-revert.md. ──` — use it
      above the two new fields to match the spec's layout.
    - REWIND_DESC is a single const string literal; the append is string concatenation kept
      as ONE literal (do not split into two adjacent string literals — keep it one string for
      the verbatim-test assertion to stay a single `.toBe(...)`).

- file: test/tools/rewind.test.ts
  why: THE test file to edit. Contains the two affected/new-test locations.
  pattern: |
    - vitest, hand-rolled makePi()/makeCtx() fakes (NO vi.fn()).
    - `.js` import paths; expectTypeOf for type assertions.
    - `run(pi, ctx, params, toolCallId)` helper drives `makeRewindTool(pi).execute(...)`.
    - `VALID_NOTE` constant + `firstText(res)` extractor.
    - clearAll() + setConfig(undefined) in beforeEach/afterEach (test isolation).

- docfile: plan/008_c36fd26768ae/architecture/codebase_patterns.md
  section: §4 "Tool Factory Pattern (src/tools/rewind.ts)"
  why: Confirms "RewindParams schema is VERBATIM from spec/05 §1 — copy the exact descriptions"
        and "REWIND_DESC → append revert_file_changes advertisement sentence".
  critical: This PRP IS the concrete realization of that pattern note for this item.

- file: src/config.ts
  why: NOT edited — but confirms the description strings are accurate. The descriptions reference
        `config.revert` ("Requires revert to be enabled in config") and
        `config.revert.allowDeleteCreatedFiles`. Both exist (interface lines 82–116; defaults
        205–207; validation 351–356; allowDeleteCreatedFiles default false at line 207). So the
        description TEXT is correct against the shipped config (P1.M1.T1 = Complete). No logic
        dependency — these are just strings.
```

### Current Codebase tree (relevant slice)

```bash
src/
  tools/
    rewind.ts          # EDIT — RewindParams + REWIND_DESC
  config.ts            # READ ONLY — confirm config.revert.* (already shipped)
test/
  tools/
    rewind.test.ts     # EDIT — update verbatim test + add type/backward-compat tests
```

### Desired Codebase tree

```bash
# No new files. Two files modified (rewind.ts, rewind.test.ts). No deletions.
src/tools/rewind.ts        # RewindParams += 2 optional booleans; REWIND_DESC += 1 sentence
test/tools/rewind.test.ts  # update 1 assertion; add ~2 tests (type + backward-compat)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL #1 — RewindArgs is DERIVED, not hand-written.
//   `export type RewindArgs = Static<typeof RewindParams>;` already exists. Adding fields to the
//   Type.Object AUTOMATICALLY adds them to RewindArgs. Do NOT hand-edit RewindArgs — there is no
//   separate interface. The only proof the new fields are on the type is `expectTypeOf` (compile-time).

// CRITICAL #2 — Type.Optional wrapping is REQUIRED for backward-compat.
//   `Type.Optional(Type.Boolean({...}))` makes the field `boolean | undefined` and OMITS it from
//   required validation. If you forget Type.Optional, every existing call that omits the field
//   (i.e. ALL of them until v1.2 callers exist) becomes a schema violation. The spec shows
//   Type.Optional — keep it.

// CRITICAL #3 — The append is ONE sentence with a LEADING SPACE, into ONE string literal.
//   `" ...last message. Set revert_file_changes to also restore ..."` — the leading space separates
//   it from the preceding sentence. Keep REWIND_DESC a single string literal (not `"a" + " b"`), so
//   the existing `expect(REWIND_DESC).toBe("<whole string>")` test stays a single literal.

// CRITICAL #4 — Do NOT add the checkpoint sentence.
//   spec/05 §6's full v1.2 description also contains
//   "granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's
//   prompts after it (they consented by setting it)." That sentence is NOT in the current code and
//   is OUT OF SCOPE (a separate v1.1-era concern). Append ONLY the revert_file_changes sentence.

// CRITICAL #5 — No logic in this item.
//   Do NOT touch rewindExecute, do NOT add a "step 6b", do NOT read config.revert, do NOT call any
//   snapshot store. The new params are simply declared on the schema and carried in params. They are
//   read+acted-on by P4.M2.T1. Adding logic here = scope creep that collides with P4.M2.T1.

// QUIRK — the existing REWIND_DESC doc-comment says "spec/05 §5" but the description strings live
//   in §6 (per the PRD index h2.61/h3.43). This is a pre-existing minor mislabel in a comment; do
//   NOT "fix" it in this item (out of scope, and §5 vs §6 numbering is internal). Optionally note
//   the append came from §6 in a brief inline comment.
```

## Implementation Blueprint

### Data models and structure

There are no new data models. The only "model" change is to the typebox schema `RewindParams`,
which automatically flows into the derived `RewindArgs = Static<typeof RewindParams>`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tools/rewind.ts — add the two optional boolean fields to RewindParams
  - LOCATE: the RewindParams Type.Object (search `export const RewindParams = Type.Object({`).
    The LAST property is currently `checkpoint: Type.Optional(Type.String({...}))` ending with
    `),` then the closing `});`.
  - INSERT: immediately BEFORE the closing `});` of the Type.Object, add a separator comment and
    the two fields. EXACT block to insert (VERBATIM descriptions from spec/05 §1; match the file's
    multi-line style for the long descriptions):

        // ── v1.2 working-tree revert (opt-in). See @14-working-tree-revert.md. ──
        revert_file_changes: Type.Optional(
          Type.Boolean({
            description:
              "v1.2 OPT-IN. When true (granularity last_turn/checkpoint), restore the working-tree files you modified in the rewound span to their pre-span state, so you need not re-read them on resume. Best-effort; failures are logged and never block the rewind. Requires revert to be enabled in config. Ignored at last_tool_call_group granularity (noticed in the result).",
          }),
        ),
        delete_created_files: Type.Optional(
          Type.Boolean({
            description:
              "v1.2 OPT-IN, DESTRUCTIVE. When true, DELETE working-tree files the rewound span newly created (files that did not exist before the span). Requires BOTH this flag AND config.revert.allowDeleteCreatedFiles. Best-effort.",
          }),
        ),

  - NAMING: snake_case field names (matches the existing `what_happened`, `last_tool_call_group` idiom).
  - PRESERVE: every existing field (note, granularity, checkpoint) and its EXACT description string unchanged.
  - VERIFY after edit: the comment `/** RewindArgs — the inferred execute-time params type. */`
    + `export type RewindArgs = Static<typeof RewindParams>;` line immediately follows the Type.Object
    unchanged (it auto-derives — no edit needed).

Task 2: MODIFY src/tools/rewind.ts — append the revert sentence to REWIND_DESC
  - LOCATE: `export const REWIND_DESC =` (line ~126). It is ONE string literal.
  - EDIT: keep it ONE string literal; append (with a LEADING SPACE) the verbatim sentence from
    spec/05 §6. The resulting REWIND_DESC MUST be EXACTLY:

      "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message. Set revert_file_changes to also restore the working-tree files you modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only)."

  - GOTCHA: note the LEADING SPACE before "Set" (separates from the preceding "last message.").
  - GOTCHA: do NOT also add the "granularity 'checkpoint' rewinds back ..." sentence (out of scope — see CRITICAL #4).
  - PRESERVE: the JSDoc comment above REWIND_DESC (optionally add a one-line note that the revert
    sentence is the v1.2 append from §6; do NOT change the existing "spec/05 §5" wording — out of scope).

Task 3: MODIFY test/tools/rewind.test.ts — update the existing verbatim-string assertion
  - LOCATE: the test `it("description is the spec/05 §5 verbatim string", () => { expect(REWIND_DESC).toBe("...") })`
    (~line 299). It currently asserts the OLD string (ending "...from the user's last message.").
  - EDIT: change the asserted string to the NEW value (the full string from Task 2, ending with the
    appended revert sentence). This test will FAIL until Task 2 is done — it is the regression guard
    that the append landed verbatim.
  - WHY: this is an existing test; the append changes the string, so the assertion MUST be updated
    in lock-step. Not updating it = a guaranteed red test.

Task 4: MODIFY test/tools/rewind.test.ts — assert RewindArgs includes the new optional fields
  - LOCATE: the test `it("RewindArgs (Static<typeof RewindParams>) has note + granularity + checkpoint", ...)`
    (~line 809). It currently does 3 expectTypeOf checks (note, granularity, checkpoint).
  - EDIT: ADD two assertions (and optionally widen the test name to mention the new fields):
        expectTypeOf(args.revert_file_changes).toEqualTypeOf<boolean | undefined>();
        expectTypeOf(args.delete_created_files).toEqualTypeOf<boolean | undefined>();
  - FOLLOW pattern: the existing `expectTypeOf(args.checkpoint).toEqualTypeOf<string | undefined>()`
    line — these two are identical in shape (both optional). Optional typebox booleans resolve to
    `boolean | undefined` in the Static type.
  - COVERAGE: both new fields; both must be `boolean | undefined` (proves Type.Optional worked).

Task 5: ADD test(s) to test/tools/rewind.test.ts — backward-compat + schema-presence
  - ADD a new describe block (e.g. after the registration-metadata block) "mulligan_rewind — v1.2
    revert params (P4.M1.T1.S1)" with:
    (a) BACKWARD-COMPAT (runtime): call `run(pi, ctx, { note: VALID_NOTE, granularity:
        "last_tool_call_group" })` with NO new fields and assert a NORMAL outcome. Easiest robust
        variant: use a config-disabled refusal so no snapshot is needed —
            setConfig({ rewind: { enabled: false } });
            const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
            expect(firstText(res)).toBe("Mulligan: refused — rewind is disabled.");
        This proves omitting the new fields does not break the call (the params object type-checks
        because both are optional; the runtime behaves identically to before).
    (b) SCHEMA PRESENCE (runtime): assert the typebox schema actually carries both keys, each a
        boolean:
            expect(RewindParams.properties).toHaveProperty("revert_file_changes");
            expect(RewindParams.properties).toHaveProperty("delete_created_files");
            // typebox booleans have kind "Boolean" (read defensively off the schema object)
            expect((RewindParams.properties as Record<string, { type?: string }>).revert_file_changes.type).toBe("boolean");
            expect((RewindParams.properties as Record<string, { type?: string }>).delete_created_files.type).toBe("boolean");
        (typebox Type.Boolean produces `{ type: "boolean", description }`; Type.Optional wraps it —
        the inner object still has `.type === "boolean"`. `RewindParams.properties` is the typebox
        properties object. If the exact `.type` read is fragile against the installed typebox version,
        fall back to asserting `toHaveProperty` for both keys + that the Static type check (Task 4)
        passed under tsc — the type check is the authoritative proof of optionality.)
    (c) OPTIONAL positive-path variant: optionally also assert that a call that DOES pass
        `revert_file_changes: true` (with config defaults) still succeeds with the normal success text
        and does NOT yet do any revert work (the param is accepted but ignored until P4.M2.T1). This
        guards against accidentally wiring logic prematurely. If added, seed a minimal snapshot so the
        success path resolves (e.g. contextEntries with a user msg + a toolGroup), and assert the
        success text does NOT contain a "Reverted" clause (that wording lands in P4.M2.T1).
  - FOLLOW pattern: the file's existing describe/it idiom; import `RewindParams` is already in the
    test's import block (verify — it imports `RewindParams` + `REWIND_DESC` + `type RewindArgs`).
  - NAMING: snake/camel as in the rest of the file; describe titles reference "(P4.M1.T1.S1)" like
    sibling blocks reference their item ids.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: typebox optional boolean with a long description (matches the file's checkpoint style).
//   The existing code formats multi-line; do the same for the long revert descriptions:
revert_file_changes: Type.Optional(
  Type.Boolean({
    description:
      "v1.2 OPT-IN. When true (granularity last_turn/checkpoint), restore the working-tree files " +
      // ... (keep it a SINGLE string literal OR concatenated literals — but the verbatim content
      // is the source of truth; prefer one literal per the file's checkpoint precedent)
      "...",
  }),
),
// NOTE: the existing `checkpoint` field uses ONE description string literal (not concatenated).
// Mirror that: write each description as ONE string literal. The descriptions above fit comfortably
// on one line each — keep them as single literals (no `+` concatenation) to match the precedent and
// to keep the verbatim-test robust.

// PATTERN: appending to a const description string.
//   REWIND_DESC stays a SINGLE string literal. The append is inside the same literal, with a leading
//   space. Do NOT change it to `"old" + " new"` — the existing `.toBe(<whole>)` test expects one literal.
export const REWIND_DESC =
  "Shed recent context ... from the user's last message. Set revert_file_changes to also restore the working-tree files you modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only).";

// PATTERN: derived type assertion (compile-time, no runtime effect).
//   RewindArgs = Static<typeof RewindParams> already exists; the proof the new fields landed is tsc + expectTypeOf:
expectTypeOf(args.revert_file_changes).toEqualTypeOf<boolean | undefined>(); // Type.Optional → | undefined
expectTypeOf(args.delete_created_files).toEqualTypeOf<boolean | undefined>();
```

### Integration Points

```yaml
SCHEMA (src/tools/rewind.ts):
  - add to: RewindParams Type.Object (before its closing `});`)
  - fields: revert_file_changes, delete_created_files (both Type.Optional(Type.Boolean({...})))
DESCRIPTION (src/tools/rewind.ts):
  - modify: REWIND_DESC const string (append one sentence, leading space, single literal)
TYPES:
  - none separately — RewindArgs is Static<typeof RewindParams> and auto-derives
CONFIG:
  - none — config.revert.* already shipped (P1.M1.T1). The descriptions REFERENCE config.revert as
    LLM-facing text only; no config change here.
LOGIC:
  - NONE in this item. step 6b (read params.revert_*, resolve handle, store.restore, fold results)
    is P4.M2.T1. The new params are declared and carried but NOT read by rewindExecute in this item.
TESTS:
  - update: the REWIND_DESC verbatim assertion (~line 299)
  - extend: the RewindArgs type test (~line 809) with 2 expectTypeOf lines
  - add: a backward-compat + schema-presence describe block (P4.M1.T1.S1)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type check — the NEW fields' optionality is PROVEN only by tsc compiling the expectTypeOf assertions.
npx tsc --noEmit
# Expected: zero errors. If RewindArgs doesn't have the new optional fields, the expectTypeOf in the
# test (Task 4) will FAIL to compile / type-check — that is the gate.

# Lint / format (match the repo's existing tooling — check package.json scripts).
npx prettier --check src/tools/rewind.ts test/tools/rewind.test.ts 2>/dev/null || true
# (If the repo uses eslint/eslint-plugin, run its check on the two files. The existing files already
#  pass — the additions are mechanical and follow the same style.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# The rewind tool test file — covers the schema, the derived type (expectTypeOf), backward-compat,
# and the updated REWIND_DESC verbatim assertion.
npx vitest run test/tools/rewind.test.ts
# Expected: ALL pass. Watch specifically:
#   - "description is the spec/05 §5 verbatim string" → passes (Task 3 updated it to the new string).
#   - the RewindArgs type test (Task 4) → passes (proves the new fields are optional booleans).
#   - the new "v1.2 revert params (P4.M1.T1.S1)" block → passes (backward-compat + schema presence).

# Sanity: run the markers + config tests too (they import RewindMarkerInput; this item does NOT
# change RewindMarkerInput, but confirm no accidental cross-breakage).
npx vitest run test/markers.test.ts test/config.test.ts
# Expected: pass unchanged (this item adds NO marker/config logic).
```

### Level 3: Integration Testing (System Validation)

```bash
# There is no live server for this item. The "integration" check is: the whole test suite still green.
npx vitest run
# Expected: full suite green. This item is additive + non-breaking, so a red suite elsewhere means
# an accidental edit — revert anything outside the two files named in this PRP.

# If the repo has a build step:
npm run build 2>/dev/null || npx tsc -p tsconfig.json
# Expected: builds. RewindParams/RewindDesc are consumed by index.ts wiring (makeRewindTool) which is
# unchanged; the new optional fields are transparent to the wiring.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# MANUAL schema inspection — confirm the two fields are present + boolean + optional at the typebox level:
node --input-type=module -e "
import { RewindParams, REWIND_DESC } from './dist/tools/rewind.js';
const p = RewindParams.properties;
console.log('revert_file_changes present:', 'revert_file_changes' in p, '| type:', p.revert_file_changes?.type);
console.log('delete_created_files present:', 'delete_created_files' in p, '| type:', p.delete_created_files?.type);
console.log('REWIND_DESC ends with revert sentence:', REWIND_DESC.endsWith('last_turn/checkpoint only).'));
console.log('REWIND_DESC does NOT contain checkpoint sentence:', !REWIND_DESC.includes(\"rewinds back to a checkpoint a user set\"));
" 2>/dev/null || echo "(skip if dist not built — Levels 1–3 are authoritative)"
# Expected:
#   revert_file_changes present: true | type: boolean
#   delete_created_files present: true | type: boolean
#   REWIND_DESC ends with revert sentence: true
#   REWIND_DESC does NOT contain checkpoint sentence: true   <-- the out-of-scope guard (CRITICAL #4)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes (the expectTypeOf assertions compile = the new fields are optional booleans on RewindArgs).
- [ ] `npx vitest run test/tools/rewind.test.ts` passes (all green incl. updated verbatim + new type/backward-compat tests).
- [ ] `npx vitest run` (full suite) passes — no accidental breakage outside the two files.
- [ ] No new lint/format errors on `src/tools/rewind.ts` and `test/tools/rewind.test.ts`.

### Feature Validation

- [ ] `RewindParams` has `revert_file_changes` and `delete_created_files` as `Type.Optional(Type.Boolean(...))` with verbatim descriptions.
- [ ] `REWIND_DESC` equals the current string + the appended ` Set revert_file_changes ...` sentence (single literal, leading space).
- [ ] The appended sentence is present; the out-of-scope checkpoint sentence is NOT present (CRITICAL #4).
- [ ] `RewindArgs` type-includes both new optional fields (proven by the type test under tsc).
- [ ] The tool still accepts `{note, granularity}` without the new fields (backward-compat test green).
- [ ] NO step-6b revert logic, NO config reads, NO store calls added (CRITICAL #5 — logic is P4.M2.T1).

### Code Quality Validation

- [ ] Field descriptions copied VERBATIM from spec/05 §1 (no paraphrasing).
- [ ] REWIND_DESC append copied VERBATIM from spec/05 §6 / the item description (leading space preserved).
- [ ] Multi-line field formatting matches the existing `checkpoint` field precedent.
- [ ] Tests follow the file's idiom (vitest, makePi/makeCtx, `.js` imports, expectTypeOf, clearAll/setConfig isolation).
- [ ] Only `src/tools/rewind.ts` and `test/tools/rewind.test.ts` are modified — nothing else.

### Documentation & Deployment

- [ ] The param descriptions ARE the LLM-facing docs (Mode A) — shipped verbatim with the schema.
- [ ] REWIND_DESC advertises `revert_file_changes` to the LLM (the description IS the doc).
- [ ] No environment variables, no README change for this item (README sync is P5.M2.T1).

---

## Anti-Patterns to Avoid

- ❌ Don't add step-6b logic here (store.restore, handle resolution, config.revert reads, success-text
  "Reverted X file(s)" clause) — that is P4.M2.T1. This item is schema + description ONLY.
- ❌ Don't forget `Type.Optional(...)` — without it the fields become REQUIRED and every existing
  rewind call (which omits them) becomes a schema violation. Backward-compat depends on optionality.
- ❌ Don't split REWIND_DESC into concatenated string literals — keep it one literal so the verbatim
  `.toBe(...)` assertion stays clean and matches the existing precedent.
- ❌ Don't append the checkpoint sentence from §6 — only the `revert_file_changes` sentence is in scope.
- ❌ Don't hand-edit `RewindArgs` — it is `Static<typeof RewindParams>` and derives automatically.
- ❌ Don't update the REWIND_DESC verbatim test's string by hand-transcribing — copy the exact value
  from Task 2 of this PRP to avoid a typo that turns the test red.
- ❌ Don't rephrase the verbatim descriptions to "improve" them — they are spec-mandated LLM-facing docs.
- ❌ Don't touch any file other than the two named in this PRP (rewind.ts + rewind.test.ts).

---

## Success Metrics

**Confidence Score**: 9/10 — This is a small, fully-specified, additive, non-breaking change. Every
string is verbatim in this PRP; every insertion point and every affected test is pinpointed. The only
residual risk is a typebox-version-specific quirk in the Level-4 runtime `.type` read (mitigated: the
authoritative optionality proof is the compile-time `expectTypeOf` under tsc, not the runtime schema read).

**Consumed by**: P4.M2.T1 (rewindExecute step 6b reads `params.revert_file_changes` /
`params.delete_created_files` off the `RewindArgs` type declared here).