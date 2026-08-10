# PRP — P1.M3.T1.S2: Tests for checkpoint consumption

## Goal

**Feature Goal**: Add TDD tests proving that a successful `mulligan_rewind(granularity:"checkpoint",
checkpoint:"<name>")` **consumes** the target checkpoint (its `LabelEntry` label is cleared via the
S1 hook in `src/tools/rewind.ts`), with the five contract-required downstream effects: (a)
`mulligan_audit` no longer lists it active, (b) a second rewind to the consumed name refuses
`not found`, (c) re-creating the checkpoint sets a fresh label and a subsequent rewind works, (d) a
checkpoint that is never consumed persists unchanged, and (e) a `pi.setLabel` throw during consumption
is swallowed (E13) and the rewind still succeeds.

**Deliverable**: ~5 new `it(...)` test blocks appended to an existing `describe(...)` in
**`test/tools/rewind.test.ts` ONLY** (the file that already owns the checkpoint-rewind success path,
the `makePi().labels` setLabel-capturing fake, the `checkpointLabelEntry` fixture, and the exact refusal-
text assertion pattern). Plus one new import of the pure `listCheckpoints` function from `src/tools/audit.js`.
No new helper functions, no harness changes, no new files, no `src/` edits.

**Success Definition**: After the edit, (a–e) each have at least one passing test; the new tests reuse
ONLY existing fixtures (`checkpointLabelEntry`, `makePi`, `makeCtx`, `run`, `firstText`, `VALID_NOTE`,
`msgEntry`/`user`); `npm run typecheck` exits 0; `npx vitest run test/tools/rewind.test.ts` passes
(assuming the S1 hook is landed); the full `npx vitest run` suite is green with the test count raised by
the number of new `it` blocks; and no file other than `test/tools/rewind.test.ts` is modified.

> ⚠️ **This is a [Mode A] TEST-ONLY task.** It consumes the S1 consumption hook (sibling
> P1.M3.T1.S1, assumed landed per its PRP contract) and asserts its observable effects. No user-facing,
> config, or API surface changes — docs ride with the implementing subtask (S1). The tests are TDD: if
> S1 is NOT yet landed, scenarios (a)/(b)/(c)/(e) will FAIL (consumption won't happen), which is the
> intended red→green signal; scenario (d) passes regardless.

## User Persona (if applicable)

**Target User**: Maintainers of the pi-mulligan codebase (the audience for a regression test suite).

**Use Case**: A maintainer refactors `rewindExecute` (e.g., reorders steps, touches the checkpoint path,
or rewrites the entry scan) and runs `npx vitest run`. These tests guarantee the spec/05 §3 step 5
"Auto-expiry on consumption (REQUIRED)" contract is not silently broken — especially the E13 safety net
(scenario e), which a careless refactor (removing the inner try/catch) would break with no other test
catching it.

**Pain Points Addressed**: Without these tests, the S1 consumption hook is an untested side-effect:
a future change could remove the `pi.setLabel(targetId, undefined)` clear, drop the E13 own-try/catch
(inverting success→failure), or fire on non-checkpoint granularities — and the existing suite (which
does not assert on `labels`) would stay green. These tests close that gap.

## Why

- **Spec REQUIRED behavior is currently untested** (spec/05 §3 step 5 "Auto-expiry on consumption" +
  spec/10 §2.1 F-checkpoint). The S1 hook delivers it; S2 *verifies* it. Without S2, the requirement is
  implemented but unguarded against regression.
- **The E13 path is the highest-risk untested branch**: the consumption hook runs AFTER the rewind
  succeeds, so a thrown `setLabel` must NOT invert success→failure. Only a dedicated test
  (`throwOnSetLabel: true` → assert success text) catches a regression here. No existing test exercises
  a throwing setLabel on the checkpoint-rewind success path.
- **Symmetry with the SET-direction coverage**: `checkpoint.test.ts` already tests `mulligan_checkpoint`
  (setLabel SET, regex validation, stable-entry). S2 completes the pair by testing the CLEAR direction
  (consumption) from the rewind side.
- **Scope discipline**: tests belong in `rewind.test.ts` (the rewind tool is the actor under test for
  4 of 5 scenarios; scenario (c)'s round-trip is asserted from the rewind side too). `checkpoint.test.ts`
  owns the SET path and is not touched.

## What

Five new `it(...)` blocks (one per contract scenario a–e), appended to the existing checkpoint-related
`describe(...)` in `test/tools/rewind.test.ts`. Each reuses existing fixtures. One new import line
(`listCheckpoints` from `../../src/tools/audit.js`). A new nested `describe("checkpoint consumption
(spec/05 §3 step 5)", ...)` groups them for readability (mirrors the file's existing nested-describe
style for related scenario clusters).

### Success Criteria

- [ ] **(a)** A test asserts that after a successful checkpoint rewind, `listCheckpoints(consumedEntries)`
      (where `consumedEntries` simulates the post-clear state) does NOT include the consumed name.
- [ ] **(b)** A test asserts that a second checkpoint rewind to the consumed name returns the exact
      refusal text `Mulligan: refused — checkpoint '<name>' not found on this branch.`
- [ ] **(c)** A test asserts the re-create round-trip: after consumption, a fresh `checkpointLabelEntry`
      in entries lets a rewind succeed again AND clears the new label (labels captures the new clear).
- [ ] **(d)** A test asserts that a non-checkpoint rewind (`last_turn` or `last_tool_call_group`) does
      NOT consume any checkpoint — `labels` stays empty AND `listCheckpoints(entries)` still includes
      the unconsumed name.
- [ ] **(e)** A test asserts E13: `makePi({throwOnSetLabel:true})` + a checkpoint rewind still returns
      success text (`Mulligan: rewound checkpoint.`) and appends the marker (NOT a refusal).
- [ ] All new tests reuse existing fixtures — no new helper functions.
- [ ] `npm run typecheck` exits 0; `npx vitest run test/tools/rewind.test.ts` passes; full
      `npx vitest run` is green (count raised by the new `it` blocks).
- [ ] No file other than `test/tools/rewind.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the exact test file to extend and why (`rewind.test.ts`), the complete
list of reusable fixtures with their signatures and line numbers (`makePi`, `makeCtx`, `run`,
`firstText`, `checkpointLabelEntry`, `VALID_NOTE`, `msgEntry`/`user`), the exact assertion strings
(success text `Mulligan: rewound checkpoint.`; refusal text `Mulligan: refused — checkpoint '<name>'
not found on this branch.` with em-dash U+2014), the CRITICAL test-fake mechanic (the static
`makeCtx().entries` array is NOT mutated by `setLabel` — so scenario b needs a fresh ctx simulating the
consumed state), the pure function to import for scenario a/d (`listCheckpoints` from `audit.ts:332`),
the per-scenario drive + assertion table, and the two validation gates (`typecheck`, `vitest`) with
their confirmed states. The implementer opens one test file, adds one import, and writes ~5 `it` blocks.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: test/tools/rewind.test.ts
  why: Owns the checkpoint-rewind path tests. Already has: makePi().labels (captures setLabel incl
        undefined-clear), makeCtx({entries}) (static entries array), run()/firstText() helpers,
        checkpointLabelEntry(name, targetId="leaf-1") fixture, VALID_NOTE, msgEntry/user builders,
        and the existing checkpoint success test (~line 340) + refusal test (~line 334, exact text).
        All five new scenarios extend an existing checkpoint describe block here.
  section: "Find the existing checkpoint describe (the block containing the 'checkpoint success' and
            'checkpoint ... not found' tests, ~lines 330-360). APPEND a new nested
            describe('checkpoint consumption (spec/05 §3 step 5)', () => { ... }) with the 5 it blocks."
  pattern: "House idiom (mirrors test/markers.test.ts, test/tools/checkpoint.test.ts): vitest imports,
            hand-rolled makePi/makeCtx (NO vi.fn()), '.js' import paths, clearAll()+setConfig(undefined)
            in beforeEach/afterEach (already present at file scope — do NOT re-add)."
  gotcha: "makeCtx().entries is STATIC — setLabel does NOT mutate it (setLabel only pushes to makePi.labels;
           getEntries returns the same array ref). So scenario (b) MUST construct a FRESH ctx whose entries
           simulate the consumed state (omit the label entry). See CRITICAL GOTCHA #1."

# MUST IMPORT — the pure assertion target for scenarios (a) and (d)
- file: src/tools/audit.ts
  why: listCheckpoints (line 332, EXPORTED) is a PURE function: (entries: unknown[]) => string[]. It scans
        for type==='label' && typeof label==='string' && label.startsWith('mulligan:checkpoint:') and
        returns the names (prefix stripped). This is what mulligan_audit uses to list active checkpoints.
        Import it directly: `import { listCheckpoints } from "../../src/tools/audit.js";` and call with a
        hand-built consumed-state array — NO ctx needed for the assertion.
  critical: "listCheckpoints skips entries where typeof label !== 'string' (so undefined-cleared labels
             drop out). Scenario (a) asserts listCheckpoints(consumedEntries) does NOT include the name;
             scenario (d) asserts it DOES include an unconsumed name. READ-ONLY — do NOT edit audit.ts."

# MUST READ — the S1 consumption hook (the code under test; assume landed per contract)
- file: src/tools/rewind.ts
  why: The step 7b hook (inserted by sibling P1.M3.T1.S1) calls pi.setLabel(targetId, undefined) on the
        checkpoint-granularity success path, wrapped in its own try/catch (E13). These tests verify its
        observable effects. The refusal text for a missing checkpoint is at line 469:
        refuse(`checkpoint '${name}' not found on this branch`, "checkpoint") → rendered as
        `Mulligan: refused — checkpoint '<name>' not found on this branch.`
  critical: "READ-ONLY. If S1 is NOT yet landed, scenarios (a)/(b)/(c)/(e) FAIL (TDD red) — that's correct.
             The hook is guarded by if(granularity==='checkpoint') so non-checkpoint rewinds never call
             setLabel (scenario d passes regardless of S1)."

# MUST READ — the SET-direction counterpart (for scenario c round-trip understanding)
- file: src/tools/checkpoint.ts
  why: mulligan_checkpoint's execute (setCheckpoint in src/markers.ts) calls pi.setLabel(stableId,
        `mulligan:checkpoint:${name}`). Scenario (c) simulates the RESULT of a re-create (a fresh
        checkpointLabelEntry in entries) and asserts the rewind side of the round-trip — it does NOT
        call mulligan_checkpoint directly (that's checkpoint.test.ts's job, already covered).
  gotcha: "READ-ONLY. Do NOT call makeCheckpointTool in these tests — scenario (c) asserts the rewind
           round-trip by constructing the post-re-create entries state, not by invoking the SET tool."

# CONTEXT — the spec authority (for the describe label + test names)
- file: spec/05-tools.md
  why: §3 mulligan_checkpoint → Behavior → step 5 (line ~182): 'Auto-expiry on consumption (REQUIRED):
        … the checkpoint is consumed and MUST be retired — its label cleared … so it no longer appears
        active in mulligan_audit. Re-creating a checkpoint of the same name after consumption is allowed
        (sets a fresh label). A checkpoint that is never consumed persists, as today.' This is the spec
        wording the describe block + test names cite.
  critical: "READ-ONLY. The describe label 'checkpoint consumption (spec/05 §3 step 5)' traces to this."

# CONTEXT — the integration-scenario mirror (spec/10 §2.1 F-checkpoint)
- file: spec/10-verification-strategy.md
  why: §2.1 F-checkpoint row: 'checkpoint is consumed on use — mulligan_audit no longer lists it active
        and a second rewind to "x" refuses (not found) unless re-created (spec/05 §3 step 5)'. These
        unit tests are the Tier-1 mirror of that Tier-2 integration scenario.
  critical: "READ-ONLY. Confirms scenarios (a)/(b)/(c) match the spec's stated pass criteria."

# CONTEXT — the S1 PRP (the contract this task tests against)
- file: plan/005_95d30743cdd4/P1M3T1S1/PRP.md
  why: CONTRACT. S1 adds the step 7b consumption hook to src/tools/rewind.ts (guarded by
        if(granularity==='checkpoint'), own try/catch E13 swallow, pi.setLabel(targetId, undefined)).
        S2 assumes it is landed. S1 edits ONLY src/tools/rewind.ts; S2 edits ONLY test/tools/rewind.test.ts.
        Zero file overlap.
  gotcha: "Do NOT edit src/tools/rewind.ts — S1 owns the hook. If the hook is absent, your tests (a/b/c/e)
           go red; that is the TDD signal, NOT a reason to implement the hook here."

# CONTEXT — the architecture effect table (downstream no-edit proof)
- file: plan/005_95d30743cdd4/architecture/m3_checkpoint_expiry.md
  why: Confirms clearing the label is the single source: listCheckpoints skips undefined labels;
        checkpointExists returns false after clear; re-create works. These tests assert exactly those.
  critical: "READ-ONLY cross-check."

# EXTERNAL — vitest assertion API (the test runner)
- url: https://vitest.dev/api/#expect
  why: expect(...).toContain(substring) for the success/refusal text assertions; expect(array).toEqual([...])
        or expect(array).toContainEqual(obj) for the labels capture; expect(array).toHaveLength(n) for
        appended count. The file already uses these — mirror the existing style.
  critical: "Use toContain for substring text matches (the existing checkpoint tests do). For the labels
             array, use toContainEqual({ entryId: 'leaf-1', label: undefined }) or find()+toEqual — both
             are used elsewhere in the file. Match the file's existing assertion flavor."
```

### Current Codebase tree (the relevant slice)

```bash
test/tools/
├── rewind.test.ts        # ← EDIT: append 'checkpoint consumption' describe with 5 it blocks + 1 import
├── checkpoint.test.ts    # READ-ONLY — owns the SET-direction (mulligan_checkpoint) tests; not touched
└── (shrink/cancel/audit.test.ts)  # READ-ONLY — unaffected
src/tools/
├── rewind.ts             # READ-ONLY — the S1 hook (code under test; refusal text at line 469)
├── audit.ts              # READ-ONLY — listCheckpoints (line 332, the pure import for scenarios a/d)
├── checkpoint.ts         # READ-ONLY — the SET counterpart (scenario c understanding only)
└── (shrink/cancel.ts)    # READ-ONLY — unaffected
src/
└── markers.ts            # READ-ONLY — setCheckpoint SET precedent
spec/
├── 05-tools.md           # READ-ONLY — §3 step 5 'Auto-expiry on consumption' authority
└── 10-verification-strategy.md  # READ-ONLY — §2.1 F-checkpoint mirror
plan/005_95d30743cdd4/
├── P1M3T1S1/PRP.md       # READ-ONLY — the S1 contract (the hook under test)
└── architecture/m3_checkpoint_expiry.md  # READ-ONLY — effect table
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing test file:
test/tools/rewind.test.ts   # +1 import (listCheckpoints from audit.js)
                            # +1 nested describe('checkpoint consumption (spec/05 §3 step 5)', ...)
                            #  with 5 it blocks (scenarios a–e), all reusing existing fixtures.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (the STATIC makeCtx().entries — the #1 test-structure determinant):
//   makeCtx({ entries: [...] }).ctx.sessionManager.getEntries() returns the SAME array reference on
//   every call, and pi.setLabel does NOT mutate it (setLabel only pushes to makePi.labels). So calling
//   run() twice against the SAME ctx will NOT make the second call see a cleared label. To test
//   "second rewind refuses not found" (scenario b), construct a FRESH ctx whose entries array SIMULATES
//   the consumed state — i.e. omit the checkpointLabelEntry (or set its label to undefined). This mirrors
//   how the real session looks post-clear (Pi removes/undefines the label). Do NOT attempt to "observe"
//   the clear by re-reading the first ctx's entries — it will still contain the label.

// CRITICAL GOTCHA #2 (assert the clear via makePi().labels, NOT via re-reading ctx entries):
//   The consumption hook calls pi.setLabel(targetId, undefined). makePi captures this as
//   { entryId: targetId, label: undefined } in the labels array. Scenario (a/c) asserts labels contains
//   this entry (via toContainEqual or labels.find(...)). The default checkpointLabelEntry targetId is
//   "leaf-1", so the expected capture is { entryId: "leaf-1", label: undefined }. NOTE: label is
//   UNDEFINED (not a string) — toContainEqual({ entryId: "leaf-1", label: undefined }) is correct.

// CRITICAL GOTCHA #3 (non-checkpoint rewinds must NOT call setLabel — scenario d):
//   The S1 hook is guarded by if(granularity === "checkpoint"). A last_turn or last_tool_call_group
//   rewind must leave labels EMPTY. Assert expect(labels).toEqual([]) (or toHaveLength(0)) after such a
//   rewind. This is the guard against the hook accidentally firing on the wrong granularity.

// CRITICAL GOTCHA #4 (the E13 test is the highest-value regression guard — scenario e):
//   makePi({ throwOnSetLabel: true }) makes setLabel throw "setLabel boom" BEFORE pushing to labels.
//   The S1 hook's OWN try/catch must swallow this, so the rewind STILL returns success. Assert:
//     expect(firstText(res)).toContain("Mulligan: rewound checkpoint.")  // success, NOT refusal
//     expect(appended).toHaveLength(1)                                   // marker still persisted
//   AND assert it is NOT a refusal: expect(firstText(res)).not.toContain("refused").
//   labels will be EMPTY (the throw pre-empts the push) — that's fine, do not assert labels here.
//   WITHOUT this test, a refactor that drops the inner catch inverts success→failure silently.

// CRITICAL GOTCHA #5 (exact refusal text — byte-match the existing test at line 334):
//   The existing refusal test asserts: "Mulligan: refused — checkpoint 'nope' not found on this branch."
//   Note the U+2014 EM DASH (—) between "refused" and "checkpoint", and the trailing period. For
//   scenario (b) with name "anchor", assert: "Mulligan: refused — checkpoint 'anchor' not found on this branch."
//   Use toContain (not toEqual) so you don't have to match surrounding whitespace. Do NOT "normalize" the
//   em-dash to a hyphen or en-dash — the code emits U+2014.

// CRITICAL GOTCHA #6 (contextEntries needed so resolveCheckpoint is a no-op):
//   The existing checkpoint success test passes contextEntries: [msgEntry(user("u"))] so the branch is
//   non-empty and resolveCheckpoint doesn't throw. Mirror this in every checkpoint-rewind test — a
//   checkpoint rewind still resolves the preview span via the branch. Omitting contextEntries can cause
//   an unrelated failure (empty branch) that masks the consumption assertion.

// CRITICAL GOTCHA #7 (do NOT add beforeEach/afterEach — they're file-scoped already):
//   The file already has beforeEach(() => { clearAll(); setConfig(undefined); }) and afterEach(clearAll)
//   at the top level. Do NOT add another pair inside the new describe — the runtime/config reset is
//   shared and already runs before/after every it. Re-adding would be redundant (harmless but noise).

// OUT OF SCOPE (do NOT touch in this subtask):
//   - src/* (any source) → the S1 hook is sibling P1.M3.T1.S1's scope; this task only tests it.
//   - test/tools/checkpoint.test.ts → owns the SET-direction tests; not touched.
//   - spec/* → READ-ONLY (spec/05 §3 step 5 is the cited authority).
//   - Any other test file → all five scenarios belong in rewind.test.ts.
// This PRP edits ONLY test/tools/rewind.test.ts (1 import + 1 nested describe with ~5 it blocks).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no new data models. The tests reuse the existing `LabelEntry` fixture (`checkpointLabelEntry`),
the existing `labels: { entryId: string; label: string | undefined }[]` capture shape, and the pure
`listCheckpoints(entries: unknown[]): string[]` function. The only "structure" is the new nested
`describe(...)` block grouping the five scenario tests._

### Scenario → test mapping (the task's core logic)

| # | Contract | Drive (reuse existing fixtures) | Assert |
|---|----------|--------------------------------|--------|
| a | audit no longer lists consumed | `makePi()`+`makeCtx({entries:[checkpointLabelEntry("anchor")], contextEntries:[msgEntry(user("u"))]})`; `run(pi, ctx, {note:VALID_NOTE, granularity:"checkpoint", checkpoint:"anchor"})` | (1) success text contains `"Mulligan: rewound checkpoint."`; (2) `labels` contains `{entryId:"leaf-1", label:undefined}` (the clear); (3) `listCheckpoints([{type:"label",targetId:"leaf-1",label:undefined}])` does NOT include "anchor" (pure-fn assertion of the consumed state) |
| b | second rewind refuses "not found" | FIRST `run()` consumes "anchor" (as in a); THEN construct a FRESH `makeCtx({entries:[], contextEntries:[msgEntry(user("u"))]})` (simulating consumed state — no label); `run(pi, ctx2, {note:VALID_NOTE, granularity:"checkpoint", checkpoint:"anchor"})` | `firstText(res2)` contains `"Mulligan: refused — checkpoint 'anchor' not found on this branch."` |
| c | re-create round-trip works | FIRST `run()` consumes "x"; THEN `makeCtx({entries:[checkpointLabelEntry("x")], contextEntries:[msgEntry(user("u"))]})` (fresh label, simulating a re-create); `run(pi, ctx2, {note:VALID_NOTE, granularity:"checkpoint", checkpoint:"x"})` | (1) success text; (2) `labels` now has the NEW clear `{entryId:"leaf-1", label:undefined}` (count went up by one more) |
| d | unconsumed persists | `makePi()`+`makeCtx({entries:[checkpointLabelEntry("persist")], contextEntries:[msgEntry(user("u")), msgEntry(asst("c1")), msgEntry(result("c1"))]})`; `run(pi, ctx, {note:VALID_NOTE, granularity:"last_turn"})` | (1) `labels` is EMPTY (no setLabel on non-checkpoint); (2) `listCheckpoints([checkpointLabelEntry("persist")])` includes "persist" |
| e | E13 — setLabel throw swallowed | `makePi({throwOnSetLabel:true})`+`makeCtx({entries:[checkpointLabelEntry("anchor")], contextEntries:[msgEntry(user("u"))]})`; `run(pi, ctx, {note:VALID_NOTE, granularity:"checkpoint", checkpoint:"anchor"})` | (1) `firstText(res)` contains `"Mulligan: rewound checkpoint."` (success); (2) `appended` has length 1 (marker persisted); (3) `firstText(res)` does NOT contain "refused" |

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the listCheckpoints import to test/tools/rewind.test.ts
  - FIND the existing import block at the top of the file (the block importing from "../../src/tools/rewind.js",
    "../../src/notes.js", "../../src/runtime.js", "../../src/config.js", etc.).
  - ADD a new import line (match the file's import style — one per line, semicolon-terminated):
      `import { listCheckpoints } from "../../src/tools/audit.js";`
  - PLACEMENT: with the other "../../src/..." imports. Do NOT reorder existing imports.
  - WHY: scenarios (a) and (d) assert on the pure listCheckpoints function (what mulligan_audit uses).
    Importing it directly avoids needing to invoke the audit tool (which would require its own fakes).

Task 2: ADD the nested describe block with the five scenario tests
  - FIND the existing checkpoint-related describe block (the one containing the 'checkpoint success' test
    at ~line 340 and the 'checkpoint ... not found' refusal test at ~line 334). APPEND the new nested
    describe INSIDE it (or as a sibling, matching the file's existing nesting style for scenario clusters).
  - ADD (verbatim structure — fill each it body per the scenario→test mapping table above):
      describe("checkpoint consumption (spec/05 §3 step 5)", () => {
        it("(a) a successful checkpoint rewind clears the label → listCheckpoints drops it", async () => { ... });
        it("(b) a second rewind to the consumed name refuses 'not found'", async () => { ... });
        it("(c) re-creating the checkpoint sets a fresh label; a subsequent rewind works", async () => { ... });
        it("(d) a non-checkpoint rewind does NOT consume — the checkpoint persists", async () => { ... });
        it("(e) a setLabel throw during consumption is swallowed (E13) — rewind still succeeds", async () => { ... });
      });
  - REUSE: checkpointLabelEntry, makePi, makeCtx, run, firstText, VALID_NOTE, msgEntry, user, asst, result.
    Do NOT define new helper functions.
  - ASSERTIONS: use the exact strings from GOTCHA #5 (em-dash U+2014). Use toContain for text. For labels,
    use expect(labels).toContainEqual({ entryId: "leaf-1", label: undefined }) OR labels.find(...)+toEqual.
  - SEE "Implementation Patterns & Key Details" for each it body's exact structure.

Task 3: VALIDATE — typecheck + the rewind suite + full suite
  - RUN: `npm run typecheck`                → expect exit 0 (the new tests use already-typed fakes/fixtures).
  - RUN: `npx vitest run test/tools/rewind.test.ts` → expect all pass IF S1 is landed; if S1 is NOT landed,
    scenarios (a)/(b)/(c)/(e) FAIL (TDD red — intended). Scenario (d) passes either way.
  - RUN: `npx vitest run`                   → expect full suite green; test count UP by 5 (the new it blocks).

Task 4: SCOPE-GUARD self-check
  - CONFIRM no file other than test/tools/rewind.test.ts was modified: `git status --short` lists ONLY it.
  - CONFIRM src/*, spec/*, other test files, package.json were NOT touched.
    `git diff --name-only | grep -Ev 'test/tools/rewind.test.ts'` → expect NO output.
```

### Implementation Patterns & Key Details

The five `it` block bodies (the concrete code structure — adapt assertion flavor to match the file):

```ts
// (a) — clear captured + pure-fn consumed-state assertion
it("(a) a successful checkpoint rewind clears the label → listCheckpoints drops it", async () => {
  const { labels, pi } = makePi();
  const { ctx } = makeCtx({
    entries: [checkpointLabelEntry("anchor")],               // label present (consumable)
    contextEntries: [msgEntry(user("u"))],                   // branch non-empty (resolveCheckpoint no-op)
  });
  const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "anchor" });
  expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");          // success
  expect(labels).toContainEqual({ entryId: "leaf-1", label: undefined });     // the CLEAR was captured
  // pure-fn assertion of the consumed state (what mulligan_audit would see):
  expect(listCheckpoints([{ type: "label", targetId: "leaf-1", label: undefined }])).not.toContain("anchor");
});

// (b) — second rewind refuses (FRESH ctx simulating consumed state — see GOTCHA #1)
it("(b) a second rewind to the consumed name refuses 'not found'", async () => {
  const { pi } = makePi();
  // first rewind consumes "anchor"
  const { ctx: ctx1 } = makeCtx({ entries: [checkpointLabelEntry("anchor")], contextEntries: [msgEntry(user("u"))] });
  await run(pi, ctx1, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "anchor" });
  // second rewind: FRESH ctx whose entries simulate the consumed state (label gone)
  const { ctx: ctx2 } = makeCtx({ entries: [], contextEntries: [msgEntry(user("u"))] });
  const res2 = await run(pi, ctx2, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "anchor" });
  expect(firstText(res2)).toContain("Mulligan: refused — checkpoint 'anchor' not found on this branch.");
});

// (c) — re-create round-trip (fresh label → rewind succeeds again + clears new label)
it("(c) re-creating the checkpoint sets a fresh label; a subsequent rewind works", async () => {
  const { labels, pi } = makePi();
  // first rewind consumes "x"
  const { ctx: ctx1 } = makeCtx({ entries: [checkpointLabelEntry("x")], contextEntries: [msgEntry(user("u"))] });
  await run(pi, ctx1, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "x" });
  // simulate a re-create: a FRESH ctx whose entries contain a new checkpointLabelEntry("x")
  const { ctx: ctx2 } = makeCtx({ entries: [checkpointLabelEntry("x")], contextEntries: [msgEntry(user("u"))] });
  const res2 = await run(pi, ctx2, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "x" });
  expect(firstText(res2)).toContain("Mulligan: rewound checkpoint.");         // succeeds again
  expect(labels).toContainEqual({ entryId: "leaf-1", label: undefined });     // new clear captured
  // (labels now has TWO clears total — one per rewind; assert count if desired: expect(labels).toHaveLength(2))
});

// (d) — non-checkpoint rewind does NOT consume; checkpoint persists
it("(d) a non-checkpoint rewind does NOT consume — the checkpoint persists", async () => {
  const { labels, pi } = makePi();
  const { ctx } = makeCtx({
    entries: [checkpointLabelEntry("persist")],               // a checkpoint exists but won't be touched
    contextEntries: [msgEntry(user("u")), msgEntry(asst("c1")), msgEntry(result("c1"))], // last_turn resolves
  });
  const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
  expect(firstText(res)).toContain("Mulligan: rewound");      // the last_turn rewind succeeded
  expect(labels).toEqual([]);                                 // NO setLabel call on non-checkpoint path
  expect(listCheckpoints([checkpointLabelEntry("persist")])).toContain("persist"); // still active
});

// (e) — E13: setLabel throw swallowed, rewind still succeeds (the highest-value guard)
it("(e) a setLabel throw during consumption is swallowed (E13) — rewind still succeeds", async () => {
  const { appended, pi } = makePi({ throwOnSetLabel: true });  // setLabel throws "setLabel boom"
  const { ctx } = makeCtx({
    entries: [checkpointLabelEntry("anchor")],
    contextEntries: [msgEntry(user("u"))],
  });
  const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "anchor" });
  expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");   // success (NOT refusal)
  expect(firstText(res)).not.toContain("refused");                     // not inverted to a failure
  expect(appended).toHaveLength(1);                                    // marker still persisted
});
```

Key points the bodies encode (the implementer should understand, not just paste):

```ts
// PATTERN — reuse, don't reinvent: every fixture (checkpointLabelEntry, makePi, makeCtx, run, firstText,
//   VALID_NOTE, msgEntry/user/asst/result) already exists in this file. The ONLY new symbol is the
//   listCheckpoints import. No new helpers.

// PATTERN — fresh ctx per distinct session state (GOTCHA #1): the fake's entries array is static; setLabel
//   doesn't mutate it. So scenarios (b) and (c) construct a SECOND makeCtx to simulate the post-consumption
//   (b: label removed) or post-re-create (c: fresh label) state. This mirrors the real session's evolution.

// CRITICAL — the labels capture includes undefined (GOTCHA #2): the clear call pushes
//   { entryId: "leaf-1", label: undefined }. Assert with toContainEqual({...label: undefined}) — NOT a
//   string comparison. The default checkpointLabelEntry targetId is "leaf-1".

// CRITICAL — scenario (e) is the E13 guard (GOTCHA #4): the OWN try/catch in the S1 hook must swallow the
//   setLabel throw. Assert success text + appended length 1 + NOT "refused". Without this test, a refactor
//   dropping the inner catch inverts success→failure silently.
```

### Integration Points

```yaml
NO NEW INTEGRATION POINTS — test-only addition.
  - DATABASE: none
  - CONFIG: none (setConfig(undefined) in the file's beforeEach already resets config; no new knob)
  - ROUTES: none
  - CODE: none (all src/* is READ-ONLY — the S1 hook is the code under test, not edited here)
  - TESTS: +1 import (listCheckpoints from src/tools/audit.js) + 1 nested describe with ~5 it blocks in
           test/tools/rewind.test.ts. No new test file, no new helper, no harness change.
  - DOCS: none (Mode A — test-only; docs ride with the implementing subtask S1).
  - The only "integration" is the TDD CONTRACT: these tests assume S1's hook is landed. If S1 is absent,
          (a)/(b)/(c)/(e) go red (intended); (d) passes regardless.
```

---

## Validation Loop

A test-only addition cannot break production code, but it MUST typecheck and the suite MUST stay green
(plus the new tests pass once S1 is landed). Run all levels.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The import landed and is used:
grep -n 'import { listCheckpoints }' test/tools/rewind.test.ts    # Expected: 1 match (the new import).
grep -n 'listCheckpoints(' test/tools/rewind.test.ts              # Expected: ≥2 matches (scenarios a + d).

# (b) The nested describe landed with the spec citation:
grep -n 'checkpoint consumption (spec/05 §3 step 5)' test/tools/rewind.test.ts  # Expected: 1 match.

# (c) All five scenario labels are present:
grep -nE '\(a\) a successful checkpoint rewind clears|\(b\) a second rewind to the consumed|\(c\) re-creating the checkpoint|\(d\) a non-checkpoint rewind does NOT consume|\(e\) a setLabel throw during consumption' test/tools/rewind.test.ts
# Expected: 5 matches (one per scenario).

# (d) Em-dash fidelity in the refusal assertion (GOTCHA #5):
grep -nF 'Mulligan: refused — checkpoint ' test/tools/rewind.test.ts  # Expected: ≥2 (existing line 334 + new scenario b).
```
Expected: all grep checks hit; the em-dash (U+2014) is preserved (not a hyphen/en-dash).

### Level 2: Type-check (the strict gate)

```bash
npm run typecheck        # = tsc --noEmit (strict; tsconfig includes src + test)
echo "typecheck exit: $?"
# Expected: exit 0, NO output. The new tests use already-typed fakes/fixtures; listCheckpoints is typed
#           (entries: unknown[]) => string[]. If tsc errors, READ it — likely a typo in an import path
#           or a malformed fixture object — and fix before proceeding.
```
Expected: exit 0.

### Level 3: Unit Tests (the new tests must pass — assuming S1 landed)

```bash
# The rewind tool suite (the file under edit):
npx vitest run test/tools/rewind.test.ts
# Expected: all pass (existing + the 5 new). If S1 is NOT yet landed, scenarios (a)/(b)/(c)/(e) FAIL —
#           that is the TDD red signal (the hook is absent). Scenario (d) passes either way.
# If a new test fails for a DIFFERENT reason (e.g. wrong assertion string, malformed fixture), READ the
# failure and fix the TEST, not the production code (the hook is S1's scope).

# Full suite (catches any cross-file surprise — there should be none):
npx vitest run
# Expected: all files green; test count UP by 5 (the new it blocks). If a count OTHER than +5 changed,
#           scope leaked — re-check.
```
Expected: rewind suite green (+5 tests); full suite green.

### Level 4: Behavior proof (manual reasoning — the five contract scenarios)

```bash
# Confirm the tests assert the contract (not just run):
# (a) clear captured:        grep for 'toContainEqual({ entryId: "leaf-1", label: undefined })'
# (b) refusal text:          grep for 'not found on this branch' in the new describe
# (c) round-trip success:    grep for the second run() asserting 'rewound checkpoint'
# (d) no-setLabel + persist: grep for 'expect(labels).toEqual([])' + 'toContain("persist")'
# (e) E13 swallow:           grep for 'throwOnSetLabel: true' + 'not.toContain("refused")'
grep -nE 'throwOnSetLabel: true|not.toContain\("refused"\)|toEqual\(\[\]\)|toContainEqual\(\{ entryId: "leaf-1", label: undefined \}\)' test/tools/rewind.test.ts
# Expected: hits for each of the five scenarios' signature assertions.
```
Expected: each scenario's distinguishing assertion is present.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
# The only change should be test/tools/rewind.test.ts:
git -C . diff --stat -- test/tools/rewind.test.ts   # Expected: test/tools/rewind.test.ts | +N -0 (or +N -1 for the import insertion point).
git -C . diff --name-only | grep -vE 'test/tools/rewind.test.ts' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# Expected: "scope OK" (ONLY test/tools/rewind.test.ts appears in the diff). src/tools/rewind.ts (S1's
#           scope), audit.ts, checkpoint.ts, spec/*, package.json, other test files must NOT appear.
```
Expected: only `test/tools/rewind.test.ts` in the diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms the listCheckpoints import, the nested describe with spec citation, all five
      scenario labels, and em-dash fidelity in the refusal assertion.
- [ ] Level 2: `npm run typecheck` exits 0 (strict mode clean).
- [ ] Level 3: `npx vitest run test/tools/rewind.test.ts` passes (+5 tests); full `npx vitest run` green.
- [ ] Level 4: each scenario's distinguishing assertion is present (clear capture, refusal text, round-trip,
      no-setLabel+persist, E13 swallow).
- [ ] Level 5: `git diff --name-only` shows ONLY `test/tools/rewind.test.ts`.

### Feature Validation
- [ ] **(a)** test asserts the clear is captured in `labels` AND `listCheckpoints(consumedState)` drops the name.
- [ ] **(b)** test asserts the second rewind returns the exact refusal text (em-dash, trailing period).
- [ ] **(c)** test asserts the re-create round-trip: fresh label → rewind succeeds + clears new label.
- [ ] **(d)** test asserts a non-checkpoint rewind leaves `labels` empty AND the checkpoint persists in listCheckpoints.
- [ ] **(e)** test asserts E13: `throwOnSetLabel:true` → success text + marker appended + NOT "refused".

### Code Quality / Scope Discipline
- [ ] All five tests reuse existing fixtures (checkpointLabelEntry, makePi, makeCtx, run, firstText,
      VALID_NOTE, msgEntry/user/asst/result) — no new helper functions.
- [ ] The only new import is `listCheckpoints` from `../../src/tools/audit.js`.
- [ ] Tests are grouped in a nested `describe("checkpoint consumption (spec/05 §3 step 5)", ...)`.
- [ ] Did NOT edit `src/*` (the S1 hook is sibling P1.M3.T1.S1's scope).
- [ ] Did NOT edit `test/tools/checkpoint.test.ts` (owns the SET-direction tests).
- [ ] Did NOT add a second `beforeEach`/`afterEach` (the file-scoped reset already covers the new tests).
- [ ] Assertion strings use the em-dash (U+2014) — not normalized to hyphen/en-dash.

### Documentation
- [ ] The nested describe label cites `spec/05 §3 step 5` (traces the tests to the spec authority).
- [ ] No separate doc file (Mode A — test-only; docs ride with the implementing subtask S1).

---

## Anti-Patterns to Avoid

- ❌ Don't invent new helper functions or fakes. Every fixture (`checkpointLabelEntry`, `makePi`, `makeCtx`,
  `run`, `firstText`, `VALID_NOTE`, `msgEntry`/`user`/`asst`/`result`) already exists in this file. Reuse them.
- ❌ Don't attempt to "observe" the label clear by re-reading the FIRST ctx's entries (GOTCHA #1). The fake's
  entries array is static; setLabel doesn't mutate it. Construct a FRESH ctx for scenario (b) whose entries
  simulate the consumed state (label omitted). Assert the clear via `makePi().labels`, not via ctx entries.
- ❌ Don't normalize the em-dash in the refusal string. The code emits U+2014 (`—`); the existing test at
  line 334 uses it; scenario (b) must too. Use `toContain` with the exact em-dash string.
- ❌ Don't call `makeCheckpointTool` (the SET tool) in scenario (c). The SET direction is checkpoint.test.ts's
  job (already covered). Scenario (c) asserts the REWIND round-trip by constructing the post-re-create
  entries state (a fresh `checkpointLabelEntry`), not by invoking the checkpoint tool.
- ❌ Don't add a `beforeEach`/`afterEach` inside the new describe. The file already has file-scoped
  `clearAll()` + `setConfig(undefined)` resets that run before/after every `it`. Re-adding is redundant noise.
- ❌ Don't edit `src/tools/rewind.ts` to "make a test pass." If a test fails because the S1 hook is absent,
  that's the intended TDD red — leave the test red and let S1 land the hook. (If S1 is already landed and a
  test still fails, fix the TEST's assertion/fixture, not the production code.)
- ❌ Don't assert `labels` contains a STRING for the clear. The clear pushes `label: undefined`. Use
  `toContainEqual({ entryId: "leaf-1", label: undefined })` (or `find` + `toEqual`).
- ❌ Don't forget scenario (e) — it's the highest-value guard. Without it, a refactor that drops the S1
  hook's inner try/catch inverts success→failure silently and NO other test catches it.
- ❌ Don't put these tests in `checkpoint.test.ts`. They test the REWIND (consumption) path; the rewind
  tool is the actor under test for 4 of 5 scenarios. `checkpoint.test.ts` owns the SET path.
- ❌ Don't skip `npm run typecheck` / `npx vitest run` because "it's just tests." typecheck catches import-
  path/fixture typos; vitest confirms the assertions are correct and S1 is landed.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a test-only addition to one file, reusing an
already-present, well-documented test infrastructure (`makePi().labels` captures setLabel including
undefined; `checkpointLabelEntry` fixture; `run`/`firstText` helpers; the exact refusal-text pattern at
line 334). The five scenarios each have a concrete drive + assertion mapped to verified code facts
(success text `Mulligan: rewound checkpoint.`; refusal text with em-dash; `listCheckpoints` pure
function; the static-entries fake mechanic). The one structural subtlety — that `makeCtx().entries` is
NOT mutated by setLabel, so scenario (b) needs a fresh ctx — is the explicitly-flagged CRITICAL GOTCHA #1
with the concrete workaround. The highest-value test (scenario e, the E13 guard) is clearly specified.
The residual uncertainty: the exact `it`-block count (could be 5 or split into more granular cases) and
the implementer's assertion-flavor choice (`toContainEqual` vs `find`+`toEqual`) — both are stylistic and
fully exemplified, hence not 10/10.