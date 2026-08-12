# PRP — P1.M3.T1.S2: Tests — drop the checkpoint-tool registration assertion + update tool-count refs

## Goal

**Feature Goal**: Update the tests that assert the extension's agent-tool **registration state** after S1
(P1.M3.T1.S1) unregisters `mulligan_checkpoint` from `src/index.ts`, dropping the registered agent-tool
count from 5 → **4** (rewind, shrink, audit, cancel). Per spec/05 §3 (h2.58) the checkpoint agent tool is
**REMOVED** in v1.1 (moved to a human slash command — E23 RESOLVED). A precise grep of the contract's 5
candidate test files finds that **only ONE** (`test/index.test.ts`) actually asserts the registration
count/names — the other 4 either import the (retained) factory directly or contain no stale claim, so per
the contract's own conditional wording ("search for … and update") they are **NO-OPs**.

**Deliverable**: Surgical edits to **`test/index.test.ts` ONLY** — 4 small changes in the registration
test block (lines 66–79): (1) test name "registers all **5** tools" → "registers all **4** tools";
(2) `expect(tools).toHaveLength(5)` → `toHaveLength(4)`; (3) the sorted-names array drops
`"mulligan_checkpoint"` → `["mulligan_audit", "mulligan_cancel", "mulligan_rewind", "mulligan_shrink"]`;
(4) `expect(tools.length).toBe(5)` → `toBe(4)`. No other file. No new tests.

**Success Definition**: After the edit (and assuming S1 landed), (a) `test/index.test.ts` asserts **4**
registered tools with names `mulligan_audit`/`mulligan_cancel`/`mulligan_rewind`/`mulligan_shrink` (no
`mulligan_checkpoint`); (b) `npm run typecheck` exits 0; (c) `npx vitest run test/index.test.ts` is GREEN;
(d) the full `npx vitest run` suite is green (the other checkpoint-touching tests import the retained
factory directly and are unaffected); (e) no file other than `test/index.test.ts` is modified.

> ⚠️ **This is a [Mode A] TEST-ONLY task.** It is the test-half of the S1/S2 red→green pair: S1 (index.ts)
> makes `test/index.test.ts` RED; S2 (this task) makes it GREEN again. The contract lists 5 candidate files
> but a precise grep shows only `test/index.test.ts` has a stale registration assertion — the other 4 are
> verified NO-OPs (smoke.ts/edge-cases.test.ts call the retained factory directly; audit.test.ts:198 is an
> accurate fixture comment; checkpoint.test.ts the contract says LEAVE). Do NOT edit a file that has no
> stale claim.

## User Persona (if applicable)

**Target User**: Maintainers running the test suite after the v1.1 checkpoint-tool removal.

**Use Case**: S1 lands (index.ts registers 4 tools); CI runs `npm test`; without S2 the registration test
fails ("expected 5 tools, got 4"). S2 brings the suite back to green by updating the assertion to the new
4-tool reality.

**Pain Points Addressed**: A stale registration assertion blocks CI green after the (correct) S1 change.
S2 realigns the test with the post-v1.1 agent-tool inventory.

## Why

- **Red→green pair completion**: S1 deliberately does NOT touch tests (its PRP gates on "the isolated
  index.test.ts failure is the S2 handoff"). S2 is the matching half that restores green. Splitting src
  and its asserting test across two tasks avoids one task both making and testing the same change.
- **Spec fidelity (spec/05 §3 / E23)**: the agent-tool inventory is now 4 (rewind, shrink, audit, cancel).
  The registration test is the single place that pins this inventory; it must say 4.
- **Minimal, surgical**: a 4-line assertion update in one test. The factory (`src/tools/checkpoint.ts`) is
  RETAINED (Phase 2 reuses `validCheckpointName` + `NAME_RE`; smoke.ts/edge-cases.test.ts/checkpoint.test.ts
  import it directly), so no other test breaks.
- **Truth in the no-op verdict**: the contract's steps (b)–(d) are conditional ("search for … and update").
  The search (grep) finds no stale claim in smoke.ts/edge-cases.test.ts/audit.test.ts. Editing them anyway
  would be inventing work and risking unrelated breakage.

## What

Four surgical edits in **`test/index.test.ts`** (the registration test block, lines 66–79). Two of the
contract's 5 candidate files are explicitly LEAVE (checkpoint.test.ts); the other two (smoke.ts,
edge-cases.test.ts) plus audit.test.ts are verified NO-OPs.

**Current text (verbatim, lines 66–80):**
```ts
  it("registers all 5 tools with the exact names", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);

    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["mulligan_audit", "mulligan_cancel", "mulligan_checkpoint", "mulligan_rewind", "mulligan_shrink"].sort(),
    );
  });

  it("does not register extra tools", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);
    expect(tools.length).toBe(5);
  });
```

**Desired text (post-edit):**
```ts
  it("registers all 4 tools with the exact names", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);

    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["mulligan_audit", "mulligan_cancel", "mulligan_rewind", "mulligan_shrink"].sort(),
    );
  });

  it("does not register extra tools", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);
    expect(tools.length).toBe(4);
  });
```

### Success Criteria

- [ ] `test/index.test.ts` test name reads "registers all **4** tools with the exact names".
- [ ] `expect(tools).toHaveLength(4)` (was 5).
- [ ] The sorted-names array is `["mulligan_audit", "mulligan_cancel", "mulligan_rewind", "mulligan_shrink"]`
      (no `"mulligan_checkpoint"`).
- [ ] `expect(tools.length).toBe(4)` (was 5).
- [ ] `grep -nE "5 tools|toHaveLength\(5\)|toBe\(5\)" test/index.test.ts` → 0 hits.
- [ ] `grep -n "mulligan_checkpoint" test/index.test.ts` → 0 hits.
- [ ] `npm run typecheck` exits 0; `npx vitest run test/index.test.ts` GREEN; full `npx vitest run` GREEN.
- [ ] No file other than `test/index.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the verbatim current text (lines 66–80, with the 4 exact edit targets) and the
verbatim desired text; the precise grep verdict proving only `test/index.test.ts` needs edits (the other 4
candidate files are NO-OPs, with the per-file evidence); the S1 contract (index.ts registers 4 tools,
checkpoint.ts retained); the red→green-pair framing (S1 makes it red, S2 green; order-independent for
correctness); and the validation gates with their confirmed states. The implementer opens one test file
and runs grep + vitest.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: test/index.test.ts
  why: The registration test (lines 66-80) is the ONLY test that asserts the agent-tool inventory via
        index.ts's factory. Three assertions are stale post-S1: test name "5 tools" (line 66),
        toHaveLength(5) (line 70), the names array including "mulligan_checkpoint" (line 72), and
        toBe(5) (line 79).
  section: "describe('index.ts extension factory') → the 'registers all 5 tools' + 'does not register
            extra tools' its (lines 66-80)."
  pattern: "Standard vitest: makePi() returns { tools, pi, handlers }; indexFactory(pi) runs the factory;
            tools is the array of registered tool defs. Use TEXT-anchored find/replace (the verbatim
            strings), not line numbers."
  gotcha: "makePi()/indexFactory() are UNCHANGED — only the 4 assertion literals change. Do NOT touch the
           helpers, the 'arms the 5 event handlers' test (line 83 — that's EVENT HANDLERS, a different
           count), or any other test in the file."

# MUST READ — the S1 contract (defines the post-edit state this test must assert)
- file: plan/007_67d7d8c6e4c5/P1M3T1S1/PRP.md
  why: CONTRACT. S1 removes the checkpoint import + registration from src/index.ts → exactly 4
        pi.registerTool calls (makeRewindTool, makeShrinkTool, auditTool, makeCancelTool). This test must
        assert that 4-tool inventory. S1 edits src/index.ts ONLY; S2 edits test/index.test.ts ONLY. Zero
        file overlap. S1 deliberately leaves this test RED as the S2 handoff.
  critical: "Assume S1 is landed (index.ts registers 4 tools). If S1 has NOT landed when S2 runs, this
             test will FAIL on the NEW 4-tool assertions (index.ts still registers 5) — the inverse
             handoff, also expected. The pair is green only when BOTH have landed."

# MUST READ — the authoritative test-touchpoint map (confirms the NO-OP verdict for the other 4 files)
- docfile: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "§Change 1 → 'Tests affected' lists: index.test.ts:66-80 (FIX → 4); smoke.ts:40,253,269 (imports/
        calls makeCheckpointTool directly — repurpose or remove); checkpoint.test.ts (leave — Phase 2);
        edge-cases.test.ts (references to '5 tools' → update); audit.test.ts (checkpoint-as-agent-tool →
        update). A precise grep REFINES this: smoke.ts/edge-cases.test.ts have NO '5 tools' assertion
        (they call the retained factory directly); audit.test.ts:198 is a fixture COMMENT (not a claim).
        So only index.test.ts actually needs edits."
  critical: "This is the source of the 5-file candidate list. The grep verdict narrows it to 1 file.
             Verify, don't assume — re-run the grep before editing."

# MUST READ — verify the NO-OP files have no stale registration assertion (do NOT edit them blindly)
- file: test/integration/smoke.ts
  why: READ-ONLY. Imports makeCheckpointTool (line 40) + calls it at 252/268 (F-checkpoint scenario) via
        the FACTORY (not index.ts registration). The factory file is RETAINED by S1, so these calls still
        work. NO "5 tools"/registration-count assertion exists (grep: zero hits for `5 tools`, `tools.length`,
        `toBe(5)`, `toHaveLength(5)`). The `registerTool`/`registerCommand` hits (lines 14/18/500/504/515/518)
        are the SMOKE HARNESS's own `mulligan_smoke_big` test tool + `/mulligan_smoke` command — unrelated.
  critical: "Contract step (b) explicitly says: 'the F-checkpoint scenario calls makeCheckpointTool(pi)
             directly — this still works since the factory file is retained.' → NO EDIT."

- file: test/edge-cases.test.ts
  why: READ-ONLY. Imports makeCheckpointTool/validCheckpointName DIRECTLY (line 45); tests the FACTORY
        (lines 668-672 invalid-name refusal, 807-815 throwing-setLabel never-throws). NO "5 tools"/
        registration-count assertion (grep: zero hits). These are factory-behavior tests, not registration
        tests — unaffected by S1.
  critical: "NO EDIT."

- file: test/tools/audit.test.ts
  why: READ-ONLY. Line 198 is a JSDoc COMMENT inside the `checkpointEntry(name, targetId)` fixture helper:
        '…is current when mulligan_checkpoint runs, so two checkpoints have different targetIds.' It
        describes how the label fixture mirrors production label-setting — NOT a claim that checkpoint is
        a registered agent tool. Accurate regardless of registration (the factory still sets labels when
        called directly).
  critical: "NO EDIT."

# MUST NOT EDIT — the factory test (contract step e says LEAVE)
- file: test/tools/checkpoint.test.ts
  why: READ-ONLY. The ENTIRE file tests the factory directly (makeCheckpointTool(pi) → name/label/
        description metadata, regex accept/reject, disabled-refusal BUG-007, never-throws, result shape,
        types). S1 RETAINS src/tools/checkpoint.ts (Phase 2 reuses validCheckpointName + NAME_RE), so every
        test here still passes. Contract step (e): "Leave test/tools/checkpoint.test.ts in place."
  critical: "DO NOT EDIT. Editing or deleting it would break the retained-factory coverage."

# CONTEXT — the spec authority (checkpoint REMOVED, count 5→4)
- docfile: spec/05-tools.md
  why: "§3 (h2.58): 'mulligan_checkpoint — REMOVED as an agent tool (v1.1) ... moved to a human slash
        command.' §h2.104 (E23 RESOLVED). §h2.132 §6: 'the agent tool count drops from 5 to 4.'"
  critical: "READ-ONLY. This is why the registration test must assert 4 tools."

# CONTEXT — the retained factory (why the other tests don't break)
- file: src/tools/checkpoint.ts
  why: READ-ONLY. S1 does NOT delete this file. It still exports makeCheckpointTool (line ~182),
        validCheckpointName (line ~74), NAME_RE (line ~66). test/integration/smoke.ts,
        test/edge-cases.test.ts, and test/tools/checkpoint.test.ts import these directly — so they are
        unaffected by the index.ts registration removal.
  critical: "tsconfig has NO noUnusedLocals → its now-unregistered exports don't error. The factory test
             (checkpoint.test.ts) stays green."

# EXTERNAL — vitest assertion API
- url: https://vitest.dev/api/#expect
  why: expect(array).toHaveLength(n) and expect(x).toBe(y) — both already used in this test. Mirror the
        existing assertion style; only the numeric literal + array element change.
  critical: "Keep toHaveLength (line 70) and toBe (line 79) as they are — just change 5 → 4 in each."
```

### Current Codebase tree (the relevant slice)

```bash
test/
├── index.test.ts                # ← EDIT: 4 assertion literals in the registration test (lines 66, 70, 72, 79)
├── integration/smoke.ts         # READ-ONLY (NO-OP — imports/calls makeCheckpointTool directly; no "5 tools" assertion)
├── edge-cases.test.ts           # READ-ONLY (NO-OP — tests the factory directly; no "5 tools" assertion)
└── tools/
    ├── audit.test.ts            # READ-ONLY (NO-OP — line 198 is an accurate fixture comment)
    └── checkpoint.test.ts       # READ-ONLY (contract says LEAVE — factory retained)
src/
├── index.ts                     # READ-ONLY (S1's scope — registers 4 tools post-S1)
└── tools/checkpoint.ts          # READ-ONLY (RETAINED — Phase 2 reuse; tests import it directly)
spec/05-tools.md                 # READ-ONLY — §3 (h2.58) REMOVED, E23 RESOLVED, count 5→4
plan/.../architecture/change_surface.md  # READ-ONLY — §Change 1 (the authoritative test-touchpoint list)
plan/.../P1M3T1S1/PRP.md         # READ-ONLY — S1 contract (index.ts registers 4 tools)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing test file:
test/index.test.ts   # 4 assertion-literal edits in the registration test block (5→4 count, drop checkpoint name)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (only test/index.test.ts needs edits — the other 4 candidate files are NO-OPs): a
//   precise grep finds ZERO "5 tools"/registration-count assertions in smoke.ts, edge-cases.test.ts, or
//   audit.test.ts. smoke.ts/edge-cases.test.ts import the RETAINED factory directly (not via index.ts);
//   audit.test.ts:198 is a fixture COMMENT. Per the contract's own conditional wording ("search for … and
//   update"), these are NO-OPs. Do NOT edit a file that has no stale claim — that risks unrelated breakage.
//   (Verified this session: grep `5 tools|tools.length|toBe(5)|toHaveLength(5)|registerTool|registered`
//   across smoke.ts/edge-cases.test.ts → only the smoke-harness's OWN mulligan_smoke_big tool, unrelated.)

// CRITICAL GOTCHA #2 (the "arms the 5 event handlers" test at line ~83 is a DIFFERENT count — leave it):
//   test/index.test.ts has a THIRD test, "arms the 5 event handlers" (~line 83), asserting the 3 pi.on
//   handlers fire. That "5" refers to EVENT-HANDLER arms (session_start/context/turn_end + ...), NOT the
//   agent-tool inventory. S1 does NOT change the event handlers. DO NOT touch that test. Only the two
//   registration tests (lines 66-80) are in scope.

// CRITICAL GOTCHA #3 (the red→green pair — gate on BOTH S1+S2 landed): S1 (index.ts) makes this test RED;
//   S2 (this edit) makes it GREEN. If S2 runs BEFORE S1 lands, the NEW 4-tool assertions FAIL (index.ts
//   still registers 5) — the inverse handoff. The pair is green only when BOTH have landed. Do NOT assume
//   a failure means your edit is wrong — check whether S1 has landed (grep `makeCheckpointTool src/index.ts`
//   → 0 means S1 landed).

// CRITICAL GOTCHA #4 (drop ONLY mulligan_checkpoint from the names array — keep the other 4 + the .sort()):
//   the names array is `["mulligan_audit", "mulligan_cancel", "mulligan_checkpoint", "mulligan_rewind",
//   "mulligan_shrink"].sort()`. Remove the `"mulligan_checkpoint", ` element (and its trailing comma+space).
//   Keep `.sort()` (the array is compared sorted). The 4 remaining names stay in their current order
//   (sort makes order irrelevant, but don't reorder anyway — minimize the diff).

// CRITICAL GOTCHA #5 (do NOT delete test/tools/checkpoint.test.ts — the factory is retained): S1 does NOT
//   delete src/tools/checkpoint.ts (Phase 2 reuses validCheckpointName + NAME_RE). checkpoint.test.ts tests
//   the factory directly and stays GREEN. Contract step (e): "Leave test/tools/checkpoint.test.ts in place."

// OUT OF SCOPE (do NOT touch in this subtask):
//   - src/* → S1 owns index.ts; checkpoint.ts stays (Phase 2 reuse). READ-ONLY.
//   - test/integration/smoke.ts → NO-OP (factory called directly; no registration assertion).
//   - test/edge-cases.test.ts → NO-OP (factory tested directly; no registration assertion).
//   - test/tools/audit.test.ts → NO-OP (line 198 is an accurate fixture comment).
//   - test/tools/checkpoint.test.ts → LEAVE (factory retained; contract step e).
//   - test/integration/run-smoke.mjs → the line-342 "exactly 5 mulligan:rewind" hit is the F-maxdepth
//     scenario (5 rewind markers, 6th refused) — UNRELATED to the agent-tool inventory.
//   - spec/* → READ-ONLY.
// This PRP edits ONLY test/index.test.ts (4 assertion literals in the registration test block).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a 4-literal assertion update in one test block. The "model" is the agent-tool
inventory dropping from 5 to 4 (spec/05 §3; spec/03 §2.1)._

### Implementation Tasks (ordered by dependencies)

One task — 4 text-anchored edits in one file. Apply as find/replace using the verbatim strings.

```yaml
Task 1: EDIT test/index.test.ts — the registration test block (4 assertion literals)
  - EDIT 1 — test name (line 66):
      FIND:  '  it("registers all 5 tools with the exact names", () => {'
      REPLACE: '  it("registers all 4 tools with the exact names", () => {'
  - EDIT 2 — toHaveLength (line 70):
      FIND:  '    expect(tools).toHaveLength(5);'
      REPLACE: '    expect(tools).toHaveLength(4);'
  - EDIT 3 — names array (line 72): drop "mulligan_checkpoint", (keep the other 4 + .sort())
      FIND:  '      ["mulligan_audit", "mulligan_cancel", "mulligan_checkpoint", "mulligan_rewind", "mulligan_shrink"].sort(),'
      REPLACE: '      ["mulligan_audit", "mulligan_cancel", "mulligan_rewind", "mulligan_shrink"].sort(),'
  - EDIT 4 — toBe (line 79):
      FIND:  '    expect(tools.length).toBe(5);'
      REPLACE: '    expect(tools.length).toBe(4);'
  - PRESERVE: makePi()/indexFactory() helpers (unchanged); the "does not register extra tools" test name
    (still accurate); the "arms the 5 event handlers" test (~line 83 — DIFFERENT count; leave it); all
    other tests in the file.
  - DO NOT: touch any other file (smoke.ts/edge-cases.test.ts/audit.test.ts/checkpoint.test.ts are NO-OPs/
    LEAVE); reorder the names array (sort makes order irrelevant, but minimize the diff); change
    toHaveLength→toBe or vice versa (keep the existing assertion style).

Task 2: VALIDATE — grep gates + typecheck + vitest
  - RUN: `grep -nE "5 tools|toHaveLength\(5\)|toBe\(5\)" test/index.test.ts` → expect 0 hits.
  - RUN: `grep -n "mulligan_checkpoint" test/index.test.ts` → expect 0 hits.
  - RUN: `grep -n "toHaveLength(4)\|toBe(4)\|registers all 4 tools" test/index.test.ts` → expect ≥3 hits.
  - RUN: `npm run typecheck` → expect exit 0.
  - RUN: `npx vitest run test/index.test.ts` → expect GREEN (4 tools) IF S1 landed; RED on the 4-tool
    assertions if S1 has NOT landed (the inverse handoff — expected, not a defect).
  - RUN: `npx vitest run` → expect full suite GREEN (the other checkpoint tests import the retained factory).

Task 3: SCOPE-GUARD self-check
  - CONFIRM no file other than test/index.test.ts was modified: `git status --short` lists ONLY it.
  - CONFIRM src/index.ts (S1's scope), checkpoint.ts, smoke.ts, edge-cases.test.ts, audit.test.ts,
    checkpoint.test.ts, spec/* were NOT touched.
    `git diff --name-only | grep -vE '^test/index.test.ts$'` → expect NO output.
```

### Implementation Patterns & Key Details

```ts
// PATTERN (text-anchored edits, NOT line numbers): the 4 edits are on lines 66, 70, 72, 79. Each FIND
//   string is unique in the file. Do NOT use line numbers as anchors (they don't shift here — no deletions —
//   but the verbatim strings are safer and self-documenting).

// PATTERN (mirror the existing assertion style): line 70 uses toHaveLength(N); line 79 uses toBe(N). Keep
//   each as-is — only the literal 5 → 4 changes. Do NOT "normalize" one to the other.

// CRITICAL (the names array: drop one element, keep .sort()): the assertion compares the sorted names, so
//   order is irrelevant — but keep the remaining 4 in their current positions to minimize the diff. Remove
//   exactly `"mulligan_checkpoint", ` (the element + its trailing comma and space).

// CRITICAL (do NOT touch the "arms the 5 event handlers" test): that ~line-83 test counts EVENT-HANDLER
//   arms, not tools. S1 does not change event handlers. Its "5" is correct and unrelated. Only the two
//   registration tests (lines 66-80) are in scope.
```

### Integration Points

```yaml
NO CODE/CONFIG/ROUTE INTEGRATION — test-only (Mode A).
  - DATABASE: none
  - CONFIG: none
  - ROUTES: none
  - CODE: none (all src/* is READ-ONLY — S1 owns index.ts; checkpoint.ts retained)
  - TESTS: +0 new tests; 4 assertion-literal edits in test/index.test.ts ONLY. No other test file touched.
  - DOCS: none (Mode A — test-only; docs ride with the implementing subtask S1 / the spec already says REMOVED).
  - PARALLEL-SIBLING COORDINATION: S1 edits src/index.ts ONLY; S2 edits test/index.test.ts ONLY. Zero file
          overlap. The pair is a red→green handshake: S1 makes the test red, S2 makes it green. Order-
          independent for correctness (the final state is green only when both have landed).
  - The only "integration" is ASSERTION CONSISTENCY: test/index.test.ts must assert the 4-tool inventory
          that src/index.ts registers post-S1. The grep gates enforce this.
```

---

## Validation Loop

A 4-literal test edit cannot break production code. Validation = grep confirms the stale 5/checkpoint
claims are gone + the new 4-tool claims are present, typecheck clean, and the suite green (assuming S1 landed).

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The stale "5 tools" / 5-count assertions are GONE:
grep -nE '5 tools|toHaveLength\(5\)|toBe\(5\)' test/index.test.ts   # EXPECT: 0 hits.
grep -n 'mulligan_checkpoint' test/index.test.ts                    # EXPECT: 0 hits.

# (b) The new "4 tools" / 4-count assertions are PRESENT:
grep -nE 'registers all 4 tools|toHaveLength\(4\)|toBe\(4\)' test/index.test.ts  # EXPECT: ≥3 hits.

# (c) The "arms the 5 event handlers" test is UNTOUCHED (it's a different count):
grep -n 'arms the 5 event handlers' test/index.test.ts              # EXPECT: 1 hit (still there, unchanged).
```
Expected: (a) 0 + 0; (b) ≥3; (c) 1 (the event-handlers test is preserved).

### Level 2: Type-check (the strict gate)

```bash
npm run typecheck        # = tsc --noEmit (strict; tsconfig includes src + test)
echo "typecheck exit: $?"
# EXPECT: exit 0, NO output. The edit changes 4 numeric/string literals in a test — no type impact.
#   If tsc errors, you accidentally touched a helper or broke the array syntax — re-check the diff.
```
Expected: exit 0.

### Level 3: Unit Tests (the registration test + full suite)

```bash
# The registration test (the file under edit):
npx vitest run test/index.test.ts
# EXPECT (S1 LANDED): GREEN — the factory registers 4 tools; the 4-tool assertions pass.
# EXPECT (S1 NOT YET LANDED): RED on the 4-tool assertions (index.ts still registers 5) — the inverse
#   handoff. This is NOT an S2 defect; it means S1 hasn't landed yet. Confirm via:
grep -c 'makeCheckpointTool' src/index.ts   # 0 = S1 landed (test should be green); 1+ = S1 not landed.

# Full suite (the other checkpoint-touching tests must stay green — they import the retained factory):
npx vitest run
# EXPECT (S1 LANDED): full suite green. test/integration/smoke.ts, test/edge-cases.test.ts, and
#   test/tools/checkpoint.test.ts import makeCheckpointTool/validCheckpointName directly from the RETAINED
#   src/tools/checkpoint.ts — unaffected by the index.ts registration removal. If one of THOSE fails, S1
#   accidentally deleted checkpoint.ts (re-check S1's diff, not S2's).
```
Expected: registration test green (+ S1 landed); full suite green.

### Level 4: Scope-discipline gate (no collateral edits)

```bash
git diff --stat           # EXPECT: test/index.test.ts ONLY.
git diff --name-only | grep -vE '^test/index.test.ts$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# EXPECT: "scope OK". src/index.ts (S1's scope), src/tools/checkpoint.ts, test/integration/smoke.ts,
#   test/edge-cases.test.ts, test/tools/audit.test.ts, test/tools/checkpoint.test.ts, spec/* must NOT appear.
```
Expected: only `test/index.test.ts` in your diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep — 0 `5 tools`/`toHaveLength(5)`/`toBe(5)`/`mulligan_checkpoint` in test/index.test.ts;
      ≥3 new `4 tools`/`toHaveLength(4)`/`toBe(4)` hits; the "arms the 5 event handlers" test preserved.
- [ ] Level 2: `npm run typecheck` → exit 0.
- [ ] Level 3: `npx vitest run test/index.test.ts` GREEN (assuming S1 landed); full `npx vitest run` GREEN.
- [ ] Level 4: `git diff --name-only` shows ONLY `test/index.test.ts`.

### Feature Validation
- [ ] test/index.test.ts asserts **4** registered tools (toHaveLength(4) + toBe(4)).
- [ ] The sorted-names array is `["mulligan_audit", "mulligan_cancel", "mulligan_rewind", "mulligan_shrink"]`
      (no `mulligan_checkpoint`).
- [ ] The test name reads "registers all **4** tools with the exact names".

### Code Quality / Scope Discipline
- [ ] Modified ONLY `test/index.test.ts` (`git status --short` shows nothing else).
- [ ] Did NOT edit `src/*` (S1 owns index.ts; checkpoint.ts retained; READ-ONLY).
- [ ] Did NOT edit `test/integration/smoke.ts` (NO-OP — factory called directly; no registration assertion).
- [ ] Did NOT edit `test/edge-cases.test.ts` (NO-OP — factory tested directly; no registration assertion).
- [ ] Did NOT edit `test/tools/audit.test.ts` (NO-OP — line 198 is an accurate fixture comment).
- [ ] Did NOT edit `test/tools/checkpoint.test.ts` (contract step e says LEAVE — factory retained).
- [ ] Did NOT touch the "arms the 5 event handlers" test (different count; S1 doesn't change handlers).
- [ ] Did NOT change the assertion style (kept toHaveLength on line 70, toBe on line 79).

### Documentation
- [ ] No doc file (Mode A — test-only; the spec already says checkpoint is REMOVED; S1 carries any code-comment docs).

---

## Anti-Patterns to Avoid

- ❌ Don't edit smoke.ts, edge-cases.test.ts, audit.test.ts, or checkpoint.test.ts. A precise grep shows
  NONE of them has a stale registration assertion: smoke.ts/edge-cases.test.ts call the RETAINED factory
  directly; audit.test.ts:198 is a fixture comment; checkpoint.test.ts the contract says LEAVE. The
  contract's steps (b)–(d) are conditional ("search for … and update") and the search finds nothing.
  (GOTCHA #1.)
- ❌ Don't touch the "arms the 5 event handlers" test (~line 83). That "5" counts EVENT-HANDLER arms, not
  tools. S1 doesn't change event handlers. Only the two registration tests (lines 66-80) are in scope.
  (GOTCHA #2.)
- ❌ Don't assume a test failure means your edit is wrong. The S1/S2 pair is a red→green handshake: if S1
  hasn't landed, the NEW 4-tool assertions fail (index.ts still registers 5). Check `grep -c
  'makeCheckpointTool' src/index.ts` (0 = S1 landed). (GOTCHA #3.)
- ❌ Don't reorder the names array or drop `.sort()`. Remove exactly the `"mulligan_checkpoint", ` element;
  keep the other 4 in place + the `.sort()` call. (GOTCHA #4.)
- ❌ Don't delete test/tools/checkpoint.test.ts. S1 RETAINS src/tools/checkpoint.ts (Phase 2 reuse); the
  factory test stays green. Contract step (e): LEAVE. (GOTCHA #5.)
- ❌ Don't "normalize" the assertion style (toHaveLength ↔ toBe). Keep each line's existing matcher; change
  only the literal 5 → 4.
- ❌ Don't edit src/* or spec/*. `git status --short` must show test/index.test.ts only.
- ❌ Don't run only `npm run typecheck` and call it validated — that's necessary but not sufficient. The
  real gates are the grep (Level 1) + `npx vitest run test/index.test.ts` green (Level 3, assuming S1 landed).

---

## Confidence Score

**9/10** for one-pass implementation success. This is a 4-literal assertion update in one test block, with:
the verbatim FIND/REPLACE for all 4 edits (test name, toHaveLength, names array, toBe); the corrected
premise (only 1 of the contract's 5 candidate files needs edits — verified by precise grep, with per-file
NO-OP evidence); the S1 contract (index.ts registers 4 tools; checkpoint.ts retained); the red→green-pair
framing (order-independent; green only when both land); and deterministic grep + vitest gates. The residual
risks — both clearly flagged — are (1) over-editing the 4 NO-OP files (mitigated by GOTCHA #1 + the grep
verdict) and (2) misreading the inverse-handoff failure as a defect if S1 hasn't landed (mitigated by
GOTCHA #3 + the `grep -c makeCheckpointTool src/index.ts` check). The edit is provably type-safe (4
numeric/string literals) and the other checkpoint tests are provably unaffected (they import the retained
factory directly). No dependency on the parallel sibling beyond S1 landing (the test goes green once both
are applied).