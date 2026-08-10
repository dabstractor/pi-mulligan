---
name: "P1.M3.T2.S1 — Refuse nuclear last_turn on first/only user message before persisting (BUG-006) [RE-PLAN v2]"
description: >
  Re-planning PRP after Attempt 1. The core fix (step 5b guarded refusal in
  src/tools/rewind.ts) and the rewind.test.ts test updates are ALREADY APPLIED in
  the working tree (unstaged) and CORRECT — they MUST be preserved, not redone.
  Attempt 1 failed only because its non-regression audit was incomplete: it
  audited only test/tools/rewind.test.ts and missed that
  test/edge-cases.test.ts:447-456 ("the TOOL persists even for a protected
  rewind…") encodes the PRE-FIX buggy behavior and now fails. This PRP authorizes
  exactly ONE additional edit (edge-cases.test.ts) — the only test in the whole
  suite that asserts the bug — after which the full vitest suite is green. The
  audit this time is EXHAUSTIVE (every to_previous_prompt hit classified).
---

# PRP — P1.M3.T2.S1: Refuse nuclear last_turn on first/only user message (BUG-006)

## ⚠️ RE-PLANNING STATUS — READ FIRST

This is **Attempt 2** after Attempt 1 returned `"result":"issue"`. The failure was
NOT a code defect — the fix is correct and spec-compliant. It was a **PRP scope
defect**: Attempt 1's non-regression proof audited only `test/tools/rewind.test.ts`
and promised "no other test regresses," but a third file
(`test/edge-cases.test.ts`) encodes the pre-fix buggy behavior and broke.

**Current working-tree state (verified via `git diff`):**

| File | State | Action in Attempt 2 |
|---|---|---|
| `src/tools/rewind.ts` | step 5b fix ALREADY applied (unstaged, +18 lines) | **VERIFY only — do NOT redo, do NOT revert** |
| `test/tools/rewind.test.ts` | 2 changes ALREADY applied (unstaged, +35 lines: updated snapshot + new F-protected test) | **VERIFY only — do NOT redo, do NOT revert** |
| `test/edge-cases.test.ts` | UNCHANGED — lines 447-456 still assert the bug, FAILING | **THIS IS THE ONLY EDIT NEEDED** |
| `tasks.json` | modified by orchestrator (status transition) | Do NOT touch (orchestrator-owned) |

**Do not run `git checkout` / `git restore` / `git stash` on `src/tools/rewind.ts`
or `test/tools/rewind.test.ts`** — that would discard correct, complete work.
Verify the changes are present (Validation Gate 0) and leave them as-is.

---

## Goal

**Feature Goal**: Make `mulligan_rewind(granularity:"last_turn", to_previous_prompt:true)`
REFUSE before persisting when the rewind would cross the protected first/only user
message (the original task) — instead of persisting a no-op marker + stray note.
Fully green test suite with no test left encoding the old buggy behavior.

**Deliverable**:
1. (DONE — preserve) The step 5b guarded refusal in `src/tools/rewind.ts`
   `rewindExecute`, placed AFTER `resolvePreview` (step 5) and BEFORE `renderNote`
   (step 6) / `persist` (step 7).
2. (DONE — preserve) The `test/tools/rewind.test.ts` regression coverage
   (new F-protected describe block + updated two-user-message snapshot).
3. (TO DO — this PRP's primary work) Update `test/edge-cases.test.ts:447-456`
   (and its describe-block comment at 403-405) to assert refusal + no-persist
   instead of persist.

**Success Definition**:
- `npm test` (full `vitest run`) is **100% green** — including the formerly-failing
  `test/edge-cases.test.ts > E3 > the TOOL …` test.
- `npm run typecheck` exits 0.
- A nuclear `last_turn` rewind on the first/only user message returns
  `Mulligan: refused — would cross a protected message (…).` and persists
  NOTHING (no `mulligan:rewind` marker, no `mulligan:note`, depth counter
  untouched).
- A normal nuclear `last_turn` (a prior user message exists) is UNAFFECTED.

## Why

- **spec/08 E3 (MUST)**: "the tool refuses **before persisting** (returns a refusal
  text)" when a rewind would remove the first user message. The pre-fix tool
  violated this — it persisted a no-op marker + stray note + success text.
- **spec/10 §2.1 F-protected (acceptance)**: "tool returns refusal text; **no
  marker created**".
- **Real harm of the bug**: consumes a depth slot toward `rewind.maxDepth` with a
  permanently-useless marker; leaves a stray `mulligan:note`; returns success text
  that misleads the agent into thinking the rewind "worked."
- The filter's `protectedOk()` (transforms.ts) is defense-in-depth only — it no-ops
  the empty hide at filter time, but the tool-level contract (refuse + do not
  persist) is what E3 demands.

## What

User-visible behavior: calling `mulligan_rewind` with `granularity:"last_turn"` +
`to_previous_prompt:true` when the latest user message IS the first (or only, or
absent) user message returns a refusal text and changes nothing on disk.

### Success Criteria

- [ ] step 5b is present in `src/tools/rewind.ts` (verify via Gate 0).
- [ ] `test/tools/rewind.test.ts` has the new F-protected describe block + the
      updated two-user-message snapshot (verify via Gate 0).
- [ ] `test/edge-cases.test.ts:447-456` asserts **refusal + zero persist**
      (the edit this PRP authorizes).
- [ ] `test/edge-cases.test.ts:403-405` describe-block comment no longer claims
      "The TOOL does NOT pre-check protected — it persists."
- [ ] `npm test` → all suites green (zero failures).
- [ ] `npm run typecheck` → exit 0.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?_ **YES** — the fix is already implemented and verified;
the only remaining work is one test-file edit whose exact old/new text is given
verbatim below, plus an exhaustive audit proving no fourth file is affected.

### Documentation & References

```yaml
# MUST READ — the authoritative spec contract this fix enforces.
- url: spec/08-edge-cases.md  (E3 — "Rewinding across a protected message")
  why: E3's MUST clause — "the tool refuses before persisting (returns a refusal text). The filter also enforces min(remove) > iFirstUser as defense-in-depth."
  critical: "refuses BEFORE persisting" is the operative phrase — the tool must NOT append a marker or leave a note.

- url: spec/10-testing.md  (§2.1 table row "F-protected")
  why: acceptance criterion — "tool returns refusal text; no marker created".
  critical: "no marker created" = appendRewindMarker + leaveNote must NOT run.

# The bug's root-cause analysis + spec clause mapping (architecture docs).
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/bug_verification.md
  section: "BUG-006: Nuclear last_turn on the first/only user message persists a no-op marker"
  why: exact location of the missing check (between step 5 resolvePreview and step 7 persist) + the resolveLastTurn {remove:[]} signal.
  gotcha: bug_verification.md line ~329 says "test/tools/rewind.test.ts does not test nuclear-first-user persist refusal" — that statement is TRUE for rewind.test.ts but was mis-read as "no test anywhere does"; edge-cases.test.ts DOES. See research/non_regression_audit.md.

- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/spec_requirements.md
  section: "BUG-006 (Minor): …persists a no-op marker instead of refusing per spec E3"
  why: exact spec text for E3 + F-protected + the fix direction ("Add an explicit protected-refusal check in rewindExecute after resolvePreview returns").

# The already-applied fix (verify, do not redo).
- file: src/tools/rewind.ts
  pattern: "rewindExecute step 5b" — the guarded `if (granularity === "last_turn" && params.to_previous_prompt === true && k === 0) return refuse(...)` AFTER the resolvePreview try/catch and BEFORE the `(6) render note` comment.
  why: this is the fix Attempt 1 correctly added. Verify it is present (Gate 0); do NOT re-add or revert.
  gotcha: the three-way AND (no `hideEntryIds.length === 0` term) is INTENTIONAL and correct — k===0 ⟺ remove.length===0 ⟺ hideEntryIds.length===0 (captureHideEntryIds derives hideEntryIds from remove), so the fourth term is redundant.

# The signal resolver (unchanged — explains why k===0 is the protected signal).
- file: src/transforms.ts
  pattern: "resolveLastTurn" — returns {remove:[]} for BOTH the empty-messages case (iLastUser === -1 early-return) AND the nuclear-first-user case (iFirstUser === iLastUser, line ~345).
  why: confirms that resolvePreview surfaces k===0 for the protected case AND for the edge-cases.test.ts empty-context fixture (makeCtx() with no contextEntries → buildContextEntries() returns [] → messages=[] → resolveLastTurn returns {remove:[]}).
  gotcha: a NORMAL nuclear last_turn always finds ≥1 message after the user prompt, so k===0 + last_turn + to_previous_prompt:true is UNIQUELY the protected refusal. No false positives.

# The comprehensive non-regression audit (proof no fourth file is affected).
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M3T2S1/research/non_regression_audit.md
  why: every to_previous_prompt hit across ALL test files classified. Conclusion: edge-cases.test.ts:447-456 is the ONLY remaining test asserting the bug.
```

### Current Codebase tree (relevant slice)

```bash
src/
  tools/
    rewind.ts          # step 5b fix ALREADY here (verify, don't touch)
  transforms.ts        # resolveLastTurn — UNCHANGED (returns {remove:[]} for protected)
test/
  tools/
    rewind.test.ts     # F-protected test + updated snapshot ALREADY here (verify)
  edge-cases.test.ts   # ⬅ THE ONE FILE TO EDIT (lines 403-405 comment + 447-456 test)
  transforms.test.ts   # UNCHANGED (tests pure resolveLastTurn — identical behavior)
  integration/
    smoke.ts           # F-protected case ALREADY asserts refusal text (no change)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: the three-way AND is the precise protected-refusal detector.
//   granularity === "last_turn" && params.to_previous_prompt === true && k === 0
// Do NOT add `&& hideEntryIds.length === 0` — it is ALWAYS true when k===0
// (captureHideEntryIds returns [] iff remove is empty), so it would be dead code.
// Do NOT broaden to `k <= 1` or drop the granularity/to_previous_prompt terms —
// that would refuse LEGITIMATE K=0 last_tool_call_group rewinds and break ~8 tests.

// CRITICAL: the refuse() closure (defined inside rewindExecute's try) latches
// rt.rewindRefusedTurnIndex (P4.M1.T2.S3). Routing step 5b through refuse() —
// which Attempt 1 already did — ensures the drift-nudge mute flag latches like
// every other refusal. Do not bypass it with a raw `return refusal(...)`.

// CRITICAL: empty-messages ≠ "no protection". resolveLastTurn([]) returns
// {remove:[]} via the iLastUser===-1 early-return. So the edge-cases.test.ts
// fixture (makeCtx() with NO contextEntries → buildContextEntries() → []) ALSO
// hits step 5b and refuses. This is SAFE per E3 ("when in doubt, protect the
// original task") and confirmed empirically (the test fails today because the
// tool refuses and persists 0 entries).

// GOTCHA: leaving the describe-block comment at edge-cases.test.ts:403-405
// ("The TOOL does NOT pre-check protected — it persists") un-edited is an active
// contradiction sitting directly above the new refusal test. It MUST be updated
// (it is part of the same logical edit region).
```

## Implementation Blueprint

### The ONLY implementation task: update `test/edge-cases.test.ts`

This is a test-correction, not new code. The implementer must make **two edits in
`test/edge-cases.test.ts`** (use ONE `edit` call with two `edits[]` entries — they
are non-overlapping regions of the same file):

#### Edit 1 — the E3 describe-block comment (lines ~400-405)

**oldText** (EXACT current text):
```typescript
describe("E3 — Rewinding across a protected message (filter-side defense)", () => {
  // GOTCHA #10: the REAL behavior is two-layer (resolver refuses nuclear + protectedOk blocks first:user
  // crossing). The TOOL does NOT pre-check protected — it persists; the filter no-ops. We pin the code's
  // actual behavior, NOT a non-existent "tool refuses before persisting".
```

**newText**:
```typescript
describe("E3 — Rewinding across a protected message (tool refuses + filter defense-in-depth)", () => {
  // Two-layer protection (spec/08 E3 — "the tool refuses before persisting"):
  //   (1) the TOOL pre-checks and REFUSES before persisting (rewindExecute step 5b — BUG-006 fix), and
  //   (2) the filter's protectedOk no-ops any rewind whose remove would cross first:user (backstop).
  // The tool-level refusal is the PRIMARY guard; the filter is defense-in-depth.
```

#### Edit 2 — the test body (lines ~447-456)

**oldText** (EXACT current text):
```typescript
  it("the TOOL persists even for a protected rewind (the filter no-ops; GOTCHA #10)", async () => {
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    // A last_turn nuclear rewind on a fresh (no-user-message) snapshot — persists regardless.
    const res = await tool.execute("rw-prot", rewindParams({ granularity: "last_turn", to_previous_prompt: true }), undefined, undefined, ctx);
    expect(firstText(res)).toMatch(/rewound|refused/); // tool returned a text result (it does NOT pre-check protected)
    // The tool persists the marker + note (the filter is what no-ops, not the tool).
    expect(appended.length + sent.length).toBeGreaterThan(0);
  });
```

**newText**:
```typescript
  it("the TOOL REFUSES a protected nuclear rewind before persisting (spec/08 E3; BUG-006 fix; was GOTCHA #10)", async () => {
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    // A last_turn nuclear rewind on a fresh (no-user-message) snapshot: the tool now detects the protected
    // first:user boundary (rewindExecute step 5b) and REFUSES before persisting — matching spec/08 E3
    // ("refuses before persisting") + spec/10 §2.1 F-protected ("no marker created"). resolveLastTurn([])
    // returns {remove:[]} (iLastUser===-1 early-return) → resolvePreview surfaces k===0 → step 5b refuses.
    // The filter-side protectedOk no-op (below) is now SECOND-LINE defense-in-depth, not the primary guard.
    const res = await tool.execute("rw-prot", rewindParams({ granularity: "last_turn", to_previous_prompt: true }), undefined, undefined, ctx);
    expect(firstText(res)).toMatch(/refused/); // E3: refusal text (refusal() prefixes "Mulligan: refused — " + trailing ".")
    expect(firstText(res)).toContain("would cross a protected message"); // the step 5b reason string
    expect(appended.length + sent.length).toBe(0); // F-protected: NO marker, NO note persisted (refuses before step 6/7)
  });
```

**Why this is the complete and correct test update:**
- The fixture is UNCHANGED (`makeCtx()` with no `contextEntries` → empty snapshot).
  Only the EXPECTATIONS flip (persist → refuse), mirroring the contract change.
- `firstText(res)` now must match `/refused/` (not `/rewound|refused/`) and contain
  the step 5b reason phrase `"would cross a protected message"`.
- `appended.length + sent.length` flips from `>0` to `===0` — the tool refuses
  before `appendRewindMarker` (step 7) and `leaveNote` (step 7).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY (read-only) the already-applied work is intact.
  - RUN: git diff --stat src/tools/rewind.ts test/tools/rewind.test.ts
    EXPECT: both files listed as modified (src ~+18 lines; rewind.test.ts ~+35 lines).
  - GREP: grep -n "5b" src/tools/rewind.ts  → expect a hit at the step 5b comment.
  - GREP: grep -n "protected message (step 5b" test/tools/rewind.test.ts  → expect 1 hit (the new describe).
  - DO NOT run git checkout/restore/stash on either file. If the diffs are missing, STOP and report
    (the prior work was lost) — do NOT silently re-implement.

Task 1: EDIT test/edge-cases.test.ts (the two edits above, in ONE edit call).
  - EDIT 1: the E3 describe-block header comment (lines ~400-405).
  - EDIT 2: the test body (lines ~447-456).
  - CONSTRAINT: edits[].oldText must match the file EXACTLY (whitespace, em-dashes "—", comments). The
    em-dash characters in the existing comments are real Unicode "—" — copy them verbatim.
  - DO NOT touch any other line in edge-cases.test.ts (the other E3 tests — resolveLastTurn unit tests,
    protectedOk unit tests, filterPipeline no-op test — remain valid and unchanged).

Task 2: VALIDATE (the Validation Loop below).
```

### Integration Points

```yaml
NO source-code changes in this PRP (the fix is already integrated).
NO config / migration / route changes.
NO new dependencies.
The ONLY mutation is one test file (2 non-overlapping regions).
```

## Validation Loop

### Level 0: Pre-flight — verify the already-applied work is intact (MUST pass before Task 1)

```bash
# Both files must show as modified by the prior attempt:
git diff --stat src/tools/rewind.ts test/tools/rewind.test.ts
# Expected: rewind.ts | 18 +++... and rewind.test.ts | 35 +++...

# The step 5b guarded refusal is present:
grep -n "5b) protected-refusal check" src/tools/rewind.ts      # expect 1 hit
grep -n 'params.to_previous_prompt === true && k === 0' src/tools/rewind.ts   # expect 1 hit

# The prior F-protected regression test is present:
grep -n "protected message (step 5b" test/tools/rewind.test.ts # expect 1 hit (the describe title)
```

### Level 1: Typecheck (after Task 1)

```bash
npm run typecheck      # = tsc --noEmit
# Expected: exit 0 (test edits are type-identical; the firstText/appended/sent vars are unchanged types).
```

### Level 2: The targeted test (after Task 1) — MUST be green now

```bash
# The formerly-failing test, run in isolation:
npx vitest run test/edge-cases.test.ts -t "the TOOL REFUSES a protected nuclear rewind"
# Expected: 1 passed.

# The whole E3 block (the other 5 E3 tests must stay green — they test the unchanged resolver/filter layer):
npx vitest run test/edge-cases.test.ts -t "E3"
# Expected: all E3 tests passed.
```

### Level 3: Full suite (the gate Attempt 1 failed) — MUST be 100% green

```bash
npm test               # = vitest run  (the entire suite)
# Expected: ALL test files passed, ZERO failures. This is the primary acceptance gate.
#   Before Task 1: edge-cases.test.ts has 1 failure ("expected 0 to be greater than 0").
#   After Task 1: that failure is gone; no other test changed status.
```

### Level 4: Behavioral spot-check (optional, confirms the spec contract end-to-end)

```bash
# The prior F-protected regression test in rewind.test.ts (added by Attempt 1) must pass:
npx vitest run test/tools/rewind.test.ts -t "refusal: protected message"
# Expected: passed (asserts refusal text + appended===0 + sent===0 + details === {granularity:"last_turn"}).

# The smoke F-protected case is unaffected (it already asserted refusal text):
npm run smoke 2>/dev/null | grep -i "smoke-prot\|refused" || true
# (Smoke is model-driven; a full green `npm test` is sufficient. This is informational only.)
```

## Final Validation Checklist

### Technical Validation

- [ ] Gate 0 passed: `git diff --stat` shows both prior files modified; step 5b + F-protected test present.
- [ ] `npm run typecheck` → exit 0.
- [ ] `npm test` → **all suites green, zero failures** (the gate Attempt 1 failed).
- [ ] `npx vitest run test/edge-cases.test.ts -t "the TOOL REFUSES"` → passed.
- [ ] `npx vitest run test/edge-cases.test.ts -t "E3"` → all E3 tests passed.

### Scope Validation (the defect Attempt 1 had)

- [ ] ONLY these files are modified vs the repo baseline: `src/tools/rewind.ts`,
      `test/tools/rewind.test.ts`, `test/edge-cases.test.ts`. (Plus orchestrator-owned
      `tasks.json` — do not touch.)
- [ ] NO `git checkout`/`restore`/`stash` was run on `src/tools/rewind.ts` or
      `test/tools/rewind.test.ts` (prior work preserved).
- [ ] The non-regression audit (research/non_regression_audit.md) was consulted; no
      test beyond edge-cases.test.ts:447-456 asserts the buggy persist behavior.

### Feature Validation

- [ ] A nuclear `last_turn` on the first/only/absent user message returns
      `Mulligan: refused — would cross a protected message (…).` and persists NOTHING.
- [ ] A normal nuclear `last_turn` (prior user message exists) is UNAFFECTED
      (covered by the updated rewind.test.ts:558 two-user-message test — K=1, persists).
- [ ] `last_tool_call_group` and `checkpoint` rewinds are UNAFFECTED
      (step 5b's three-way AND excludes them; covered by existing tests).

---

## Anti-Patterns to Avoid

- ❌ Don't re-implement step 5b in `src/tools/rewind.ts` — it's already correct and applied.
- ❌ Don't run `git checkout`/`restore`/`stash` on the two already-modified files.
- ❌ Don't add a redundant `hideEntryIds.length === 0` term to the step 5b condition.
- ❌ Don't broaden the `oldText` match to include surrounding E3 tests — edit ONLY the
  describe comment (403-405) and the one `it()` (447-456). The other E3 tests stay byte-identical.
- ❌ Don't change the fixture in edge-cases.test.ts:447 (keep `makeCtx()` with no
  `contextEntries`) — only the expectations change.
- ❌ Don't skip `npm test` (the full suite) — that is precisely the gate Attempt 1 missed.

---

## Confidence Score: 9/10

The fix is already implemented, typechecked, and validated at the unit level. The
only remaining work is a single, fully-specified test-file edit (verbatim old/new
text provided). The 1-point residual risk is purely editorial: matching the
exact `oldText` (em-dashes, comment wording) for the edit to apply cleanly. Gate 0
catches any "prior work was lost" surprise before Task 1. The non-regression audit
is now exhaustive across every `to_previous_prompt` hit.