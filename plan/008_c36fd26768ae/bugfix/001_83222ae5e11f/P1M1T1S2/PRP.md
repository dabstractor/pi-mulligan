# PRP — Strengthen F-revert-reload to exercise real checkpoint file-revert (P1.M1.T1.S2 / BUG-001 test)

## Goal

**Feature Goal**: Replace the degenerate, always-trivially-clean checkpoint-rewind at the tail of the
`F-revert-reload` integration test with a checkpoint-rewind whose span ACTUALLY contains a real `write`
toolCall to a file, so the test proves the BUG-001 fix (checkpoint-granularity file revert proceeds and
reverts files when the span changed files) — and would FAIL without that fix.

**Deliverable**: A modified `test/integration/revert-edge.test.ts` (test-only; NO production code change)
whose `F-revert-reload` `it` case drives a checkpoint span containing a real `write` to `a.ts` across the
simulated `/resume` and asserts the working tree is reverted to the pre-checkpoint state (`A0\n`), with the
success text containing the `Reverted …` (PROCEED) clause and NOT the `file revert refused` (REFUSE) clause.

**Success Definition**:
- `npm run typecheck` passes.
- `npm test` (or `npx vitest run test/integration/revert-edge.test.ts`) passes WITH the P1.M1.T1.S1 fix applied.
- The strengthened `F-revert-reload` case FAILS if the S1 fix is reverted (re-introducing
  `checkpoint.afterRef ?? checkpoint.beforeRef`): the file stays `A3-resume\n` and the `a.ts === "A0\n"`
  assertion fails — i.e. the test now genuinely guards the BUG-001 regression.
- The E32 cross-reload coverage (the `resetRuntime`+`detectAndCreate`+`store2`+manual rebuild) is PRESERVED.

## Why

- BUG-001 made the headline v1.2 capability `mulligan_rewind(granularity:"checkpoint", revert_file_changes:true)`
  silently never restore files for its only useful case. The shipped `F-revert-reload` test only passes because
  it deliberately engineers the degenerate empty-`modifiedFiles` case (its own comments admit this), so it gave
  false confidence and failed to catch BUG-001.
- P1.M1.T1.S1 fixes the dirty-guard baseline. P1.M1.T1.S2 (THIS task) makes the integration test actually
  exercise the fixed path so the regression cannot recur silently.
- PRD `§2.5 Recommendations`: "Strengthen the F-revert-* integration tests: F-revert-reload should exercise a
  checkpoint span that ACTUALLY contains file tool calls (the real use case), not the degenerate
  empty-modifiedFiles case."

## What

User-visible behavior: NONE (test-only; no config/API/docs surface change).

Test-visible behavior of the strengthened `F-revert-reload` case, step (h):
- BEFORE the checkpoint-rewind, `a.ts` is mutated to `"A3-resume\n"` and the post-/resume span contains a real
  `write` toolCall to `a.ts` (`w2`).
- The `mulligan_rewind({granularity:"checkpoint", checkpoint:"x", revert_file_changes:true})` result text
  contains `"Reverted"` and `"rewound checkpoint"` and does NOT contain `"file revert refused"`.
- After the rewind, `a.ts === "A0\n"` (the `ckpt:x` `beforeRef` state).
- The persisted `mulligan:rewind` marker's `revert.backend === "git"` and `revert.revertedFiles` includes `"a.ts"`.

### Success Criteria

- [ ] `F-revert-reload` checkpoint span contains a real `write` to `a.ts` (non-empty `modifiedFiles`).
- [ ] Asserts `a.ts` reverted to `A0\n` and result text shows PROCEED (not REFUSE).
- [ ] Test passes with the S1 fix; FAILS without it (file stays `A3-resume\n`).
- [ ] E32 cross-reload flow retained; manual `rt2.snapshots` rebuild retained (BUG-002/P1.M2 owns removing it).
- [ ] All stale "MUST contain NO file toolCalls" / degenerate-bypass comments removed/rewritten.
- [ ] No production files changed; `npm run typecheck` + `npm test` green.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase gets, from this PRP + the referenced files: the exact test
file, the exact `it` case and its line range, the exact lines/strings to change, the helper functions already
defined in-file (`asstWrite`, `result`, `appended.push` idiom, `firstText`, last-marker scan), the BUG-001
before/after code shape in `rewind.ts`, and the proof of why the test fails-without / passes-with the fix.

### Documentation & References

```yaml
# MUST READ — the contract this test depends on (the fix under test)
- file: src/tools/rewind.ts
  why: step 6b (working-tree revert decision tree) — the code path the test exercises.
  section: "step 6b branch (5)+(6)" — ~lines 843-935
  pattern: |
    AFTER the S1 fix: `const afterRef = checkpoint.afterRef;` (NO `?? checkpoint.beforeRef` fallback).
    if (afterRef) { dirtyCheck → REFUSE on drift, else doRestore(); }
    else { doRestore(); }            // checkpoint granularity — guard SKIPPED (spec/14 §6 step 3)
    doRestore = async () => store.restore(checkpoint.beforeRef, {revertFileChanges, deleteCreatedFiles}) + fold RestoreResult
  critical: |
    `affectedPaths = ledger.modifiedFiles` is UNCHANGED here (BUG-004 / P1.M4 is separate). So the test's
    `write` toolCall MUST be a real `write` (name "write", arguments.file_path) so extractFileLedger puts the
    path in modifiedFiles. The REFUSE clause text is VERBATIM:
    `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`
    (em dash —). The PROCEED clause: `Reverted N file(s), deleted N; N skipped/failed, N refused (see log).`
    NOTE the PROCEED clause literally contains the substring "refused" — so the absence assertion MUST key on
    "file revert refused" (REFUSE-only), NOT bare "refused".

- file: src/commands.ts
  why: confirms checkpoint snapshots capture a SINGLE beforeRef and NEVER set afterRef.
  section: makeCheckpointCommand handler ~lines 217-222
  pattern: rt.snapshots.set("ckpt:"+name, { label, backend, beforeRef: ckptRef, turnIndex: -1, ts }) — NO afterRef field.

- file: src/tools/rewind.ts
  why: resolvePreview — how the checkpoint span + ledger are computed (so the write lands in modifiedFiles).
  section: resolvePreview ~lines 595-621
  pattern: |
    checkpoint granularity → resolveCheckpoint(messages, branchEntries, checkpoint, toolCallId)?.remove = number[] of MESSAGE INDICES
    (from the checkpoint anchor to the branch leaf); extractFileLedger(messages, remove) scans those messages
    for write/edit toolCalls → ledger.modifiedFiles. GOTCHA #7: remove = indices; GOTCHA #8: branchEntries = getBranch() DATA.

- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  why: §BUG-001 root cause + "Existing Test Impact" (this task's trigger) + §BUG-002 (why the rebuild comment stays).
  section: "BUG-001 (Critical)" + "BUG-002 (Major): E32 cross-reload ... Existing Test Impact"

- file: test/integration/revert-git.test.ts
  why: sibling integration test showing the canonical asstWrite+result+msgEntry pattern for real git revert.
  section: ~lines 235-245 (asstWrite/result helpers), ~393 (msgEntry(asstWrite("w1","a.ts")) usage)
  pattern: mirror this for the post-/resume write message.

- file: test/integration/revert-edge.test.ts   # THE FILE UNDER EDIT
  why: the single file this task modifies.
  section: describe "F-revert-* …" → it "F-revert-reload: …" (~lines 270-654)
```

### Current Codebase tree (the slice that matters)

```bash
test/integration/
  revert-edge.test.ts      # <-- EDIT THIS (F-revert-reload it-case, step (h) ~626-653)
  revert-git.test.ts       # reference: asstWrite/result/msgEntry idiom, real git revert assertions
  revert-cas.test.ts       # reference: asstWrite idiom
src/tools/rewind.ts        # READ-ONLY here — step 6b (S1 fix), resolvePreview
src/commands.ts            # READ-ONLY — makeCheckpointCommand (single beforeRef, no afterRef)
src/markers.ts             # READ-ONLY — RevertCheckpoint.afterRef?: string
src/snapshot/store.ts      # READ-ONLY — SnapshotStore (restore/dirtyCheck/has)
```

### Desired Codebase tree with files to be added/changed

```bash
test/integration/revert-edge.test.ts   # MODIFIED (one it-case: F-revert-reload step (h) + header/inline comments)
# (no new files; no production changes)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// 1. Checkpoints NEVER set afterRef (commands.ts ~217-222). So checkpoint granularity ALWAYS takes the
//    `else { doRestore(); }` branch post-fix. The guard is only meaningful for last_turn (which has afterRef).
//
// 2. affectedPaths = ledger.modifiedFiles is a HEURISTIC (BUG-004 not fixed). A real `write` toolCall
//    (name:"write", arguments.file_path) IS picked up; a bare bash mutation is NOT. So the post-/resume change
//    to a.ts MUST be expressed as a `write` toolCall (asstWrite), not just a writeFileSync on disk. (The on-disk
//    writeFileSync IS also needed so the working tree actually differs from R0 — the ledger is advisory, but
//    store.restore/dirtyCheck read the REAL tree.)
//
// 3. PROCEED clause contains the substring "refused" ("… N refused (see log)."). Absence assertions MUST use
//    the REFUSE-only string "file revert refused", never bare "refused".
//
// 4. The makeSessionCtx `appended` array is the SHARED backing for BOTH pi.appendEntry writes AND
//    sessionManager reads. Push post-/resume messages with the established `{type:"message", id, parentId,
//    timestamp:0, message} as never` shape, parentId chaining back to the surviving "a1" anchor (u2/a2/r1 are
//    excised at step (g)).
//
// 5. The rewind toolCallId ("final") does NOT need a matching message in the stream — resolveCheckpoint
//    resolves to the branch leaf regardless (the existing degenerate step (h) already relies on this).
//
// 6. E32 cross-reload rebuild (the manual rt2.snapshots loop ~lines 600-625) is RETAINED — it is the BUG-002
//    gap; P1.M2.T1.S2 owns replacing it with the production session_start read-side. Keep the rebuild, just
//    refresh its comment to name BUG-002 / P1.M2.
```

## Implementation Blueprint

### Data models and structure

No new data models. The test reuses the in-file helpers and the existing message-entry shapes:

```ts
// Already defined in test/integration/revert-edge.test.ts — REUSE, do not redefine:
function asstWrite(callId: string, file_path: string): Record<string, unknown>  // ~line 230
function result(toolCallId: string): Record<string, unknown>                    // ~line 245
function firstText(res): string                                                  // ~line 290
// push idiom:
appended.push({ type: "message", id: "<id>", parentId: "<prev>", timestamp: 0, message: <msg> } as never);
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE the F-revert-reload header description (file docstring, ~lines 17-19)
  - FIND: the sentence starting "Also exercises the dirty-guard BYPASS for a checkpoint with NO afterRef (CRITICAL
    #3)" through "… the rewind span MUST contain NO file toolCalls (empty modifiedFiles → dirtyCheck→[] → PROCEED)."
  - REPLACE WITH: a description of the POST-FIX path — a checkpoint has NO afterRef, so (post BUG-001) the dirty
    guard is SKIPPED and the span CAN and now DOES contain a real file write, which IS reverted; note the test
    FAILS without the BUG-001 fix (the fallback afterRef=beforeRef would flag the agent's own write as drift → REFUSE).
  - WHY: removes the stale "MUST contain NO file toolCalls" claim that describes the bug, not the fixed behavior.

Task 2: REWRITE the step (g) trailing comment (~line 567)
  - FIND: "(from the a1 anchor to leaf) then contains NO file toolCalls → empty modifiedFiles → dirty guard bypassed"
    (inside the /resume excise block's explanatory comment).
  - REPLACE WITH: the span now contains a REAL write (added at step h), so modifiedFiles=["a.ts"]; that is the
    point — it forces the (post-fix) skipped-guard path AND would trip the (pre-fix) beforeRef-baseline REFUSE.
  - NOTE: keep the excision of u2/a2/r1 (E32 realism); just stop claiming the span has no file toolCalls.

Task 3: UPDATE the rt2.snapshots rebuild comment (~lines 600-601)
  - FIND: "REBUILD rt2.snapshots … production NEVER does this read-side — it is the gap E32 leaves; the test
    SIMULATES the rebuild a future session_start hook would do …"
  - REPLACE WITH: same meaning, but reference BUG-002 / P1.M2.T1 as the tracked production fix (session_start will
    scan mulligan:revert-checkpoint entries and rebuild rt.snapshots). Keep the rebuild code itself UNCHANGED.
  - WHY: item permits keeping the comment as a BUG-002 note since this test still exercises the cross-reload path.

Task 4: MODIFY step (h) — make the checkpoint span contain a REAL write (~lines 626-653)
  - BEFORE the rewind, MUTATE the working tree so it differs from R0:
      writeFileSync(join(repoDir, "a.ts"), "A3-resume\n");
  - CHANGE the pushed a3 message from a NON-WRITE to a WRITE, and add its toolResult:
      appended.push({ type:"message", id:"u3", parentId:"a1", timestamp:0, message: user("resume and reconsider") } as never);
      appended.push({ type:"message", id:"a3", parentId:"u3", timestamp:0, message: asstWrite("w2", "a.ts") } as never);  // was asst("post-resume")
      appended.push({ type:"message", id:"r2", parentId:"a3", timestamp:0, message: result("w2") } as never);
  - KEEP the run() call exactly: run(pi, ctx, { note: VALID_NOTE, granularity:"checkpoint", checkpoint:"x",
    revert_file_changes:true }, "final").
  - ASSERTIONS (replace/extend the block ~640-653):
      expect(firstText(res2)).toContain("Reverted");                 // PROCEED clause
      expect(firstText(res2)).toContain("rewound checkpoint");
      expect(firstText(res2)).not.toContain("file revert refused");  // REFUSE clause ABSENT (use the REFUSE-only string)
      expect(readFileSync(join(repoDir, "a.ts"), "utf8")).toBe("A0\n");   // reverted to ckpt:x beforeRef state
      // existing last-marker scan stays:
      expect(revert2?.backend).toBe("git");
      expect(revert2?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));
  - REWRITE the step (h) explanatory comment (~628-630): explain that the span now contains a REAL write →
    modifiedFiles=["a.ts"]; WITHOUT the BUG-001 fix the fallback afterRef=beforeRef=R0 would make
    dirtyCheck(R0,["a.ts"]) flag the agent's own A3-resume write as drift → REFUSE (a.ts stays A3-resume);
    WITH the fix afterRef is undefined → else-branch doRestore() → store.restore(R0) → a.ts→A0. State this is
    the regression guard for BUG-001.

Task 5: VERIFY — no other stale references
  - grep the file for "MUST contain NO file toolCalls", "empty modifiedFiles", "dirtyCheck(afterRef=beforeRef",
    "contains NO file toolCalls" — all should be gone or rewritten. (F-revert-granularity's own header text is
    UNRELATED and stays.)
```

### Implementation Patterns & Key Details

```ts
// The single critical edit (step h) — conceptual diff:

// --- BEFORE (degenerate: span has NO write → modifiedFiles=[] → trivially clean) ---
writeFileSync(join(repoDir, "a.ts"), "A2-postreload\n");          // (f) post-reload mutation (untouched)
// … /resume simulation … (untouched) …
appended.push({ type:"message", id:"u3", parentId:"a1", …, message: user("resume and reconsider") } as never);
appended.push({ type:"message", id:"a3", parentId:"u3", …, message: asst("post-resume") } as never);  // NON-WRITE
const res2 = await run(pi, ctx, { note:VALID_NOTE, granularity:"checkpoint", checkpoint:"x", revert_file_changes:true }, "final");
expect(firstText(res2)).toContain("Reverted");
expect(firstText(res2)).toContain("rewound checkpoint");
expect(readFileSync(join(repoDir,"a.ts"),"utf8")).toBe("A0\n");   // passed even WITHOUT the fix (degenerate)

// --- AFTER (real write → modifiedFiles=["a.ts"] → guard SKIPPED post-fix; would REFUSE pre-fix) ---
// … /resume simulation … (unchanged) …
writeFileSync(join(repoDir, "a.ts"), "A3-resume\n");              // (h) the agent's post-/resume write — differs from R0(A0)
appended.push({ type:"message", id:"u3", parentId:"a1", …, message: user("resume and reconsider") } as never);
appended.push({ type:"message", id:"a3", parentId:"u3", …, message: asstWrite("w2", "a.ts") } as never);  // REAL write
appended.push({ type:"message", id:"r2", parentId:"a3", …, message: result("w2") } as never);
const res2 = await run(pi, ctx, { note:VALID_NOTE, granularity:"checkpoint", checkpoint:"x", revert_file_changes:true }, "final");
expect(firstText(res2)).toContain("Reverted");
expect(firstText(res2)).toContain("rewound checkpoint");
expect(firstText(res2)).not.toContain("file revert refused");     // the REFUSE clause must be ABSENT
expect(readFileSync(join(repoDir,"a.ts"),"utf8")).toBe("A0\n");    // now FAILS without the BUG-001 fix ✓
```

### Integration Points

```yaml
NO PRODUCTION CHANGES — this is a test-only task.
- src/tools/rewind.ts:        DO NOT EDIT (S1 owns; BUG-001 fix is the dependency, already applied at runtime)
- src/commands.ts:            DO NOT EDIT
- src/index.ts:               DO NOT EDIT (BUG-002/P1.M2 owns the session_start rebuild)
- test config / vitest:       DO NOT EDIT (npm test already runs test/integration/**; gitAvailable() guards this it)
- The test consumes the EXISTING exported surface: makeCheckpointCommand, makeRewindTool,
  turnStartCaptureHandler, agentEndCaptureHandler, gcTurnSnapshots, detectAndCreate, getRuntime, resetRuntime,
  clearAll, setConfig, getConfig, asstWrite, result, firstText, VALID_NOTE.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the test file (tsc --noEmit via the project script)
npm run typecheck
# Expected: zero errors. The `as never` casts and the message shapes must type-check.
# (No ruff/mypy — this is a TypeScript project. Lint is part of the repo's own pipeline if configured.)
```

### Level 2: Unit / Integration Tests (Component Validation)

```bash
# Run JUST this file for fast feedback (git must be on PATH — the it self-guards with gitAvailable())
npx vitest run test/integration/revert-edge.test.ts
# Expected: BOTH it-cases pass (F-revert-granularity unchanged; F-revert-reload now exercises a real write).

# Full suite (confirms no collateral damage to the 1277-test suite)
npm test
# Expected: all green.
```

### Level 3: Regression-Guard Verification (THE key check for this task)

```bash
# PROVE the strengthened test FAILS without the BUG-001 fix (temporary manual check — do NOT commit this):
#   1. Temporarily revert src/tools/rewind.ts step 6b to the buggy line:
#        const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef;
#      and make dirtyCheck unconditional again (or just restore the file from git: `git stash` the S1 change).
#   2. npx vitest run test/integration/revert-edge.test.ts
#      Expected: F-revert-reload FAILS — a.ts stays "A3-resume\n", the "file revert refused" clause IS present,
#                and `a.ts === "A0\n"` throws.
#   3. Restore the S1 fix (git stash pop). Re-run → PASS.
# This proves the test is a genuine regression guard, not another degenerate always-pass.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the persisted marker carries the reverted file (end-to-end audit):
# (covered in-task by the existing last-marker scan assertion)
#   expect(revert2?.backend).toBe("git");
#   expect(revert2?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));
# No extra tooling required.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` passes (zero TS errors).
- [ ] `npx vitest run test/integration/revert-edge.test.ts` passes (both it-cases).
- [ ] `npm test` full suite passes (no collateral).
- [ ] Level 3 regression-guard check confirmed: test FAILS with the S1 fix reverted.

### Feature Validation

- [ ] `F-revert-reload` step (h) span contains a real `write` to `a.ts` (`asstWrite("w2","a.ts")`).
- [ ] Asserts `a.ts === "A0\n"` after the checkpoint-rewind (reverted, not refused).
- [ ] Asserts result text contains `"Reverted"` + `"rewound checkpoint"` and NOT `"file revert refused"`.
- [ ] Marker `revert.backend === "git"` and `revert.revertedFiles` includes `"a.ts"`.
- [ ] E32 cross-reload flow (resetRuntime + detectAndCreate + store2 + manual rebuild) RETAINED and still passing.

### Code Quality Validation

- [ ] Reuses existing in-file helpers (`asstWrite`, `result`, `firstText`, `appended.push` idiom) — no duplication.
- [ ] All stale degenerate-bypass comments removed/rewritten (header ~17-19, ~567, ~600-601, ~628-630).
- [ ] Comment density matches the codebase house style (WHY each decision; spec/edge-case IDs).
- [ ] No production files touched; no new files; change confined to the single `it` case + its comments.

### Documentation & Deployment

- [ ] No user-facing/config/API/docs change (test-only) — nothing to deploy.
- [ ] The retained manual-rebuild comment now names BUG-002 / P1.M2 as the future production read-side.

---

## Anti-Patterns to Avoid

- ❌ Don't express the post-/resume `a.ts` change as ONLY a `writeFileSync` — the ledger heuristic
  (`modifiedFiles`) needs a real `write` toolCall (`asstWrite`) to include the path. Both are required
  (on-disk mutation so the real tree differs from R0; toolCall so the ledger sees it).
- ❌ Don't assert absence of bare `"refused"` — the PROCEED clause contains it. Assert `"file revert refused"`.
- ❌ Don't remove the E32 cross-reload portion to "simplify" — that coverage is the test's other headline and
  its rebuild simulation is the BUG-002 gap owned by P1.M2.
- ❌ Don't touch `affectedPaths`/`changedPaths` (that's BUG-004 / P1.M4) or any production file.
- ❌ Don't change the `rewind` toolCallId (`"final"`) — it works without a matching stream message.
- ❌ Don't leave any "MUST contain NO file toolCalls" / "empty modifiedFiles → PROCEED" comments — they now
  describe the bug, not the fixed behavior, and would mislead the next reader.

---

**Confidence Score: 9/10** — one-pass success is highly likely. The change is small and surgical (one `it`
case + its comments in a single test file), the dependency (S1 fix) is precisely specified, the exact lines and
strings to change are enumerated, the in-file helpers to reuse are named, and the fail-without/pass-with proof
is spelled out. The only residual risk is the precise parentId/leaf resolution of `resolveCheckpoint` after the
span gains a result message — but the existing degenerate step (h) already proves that resolution works, and the
only delta is swapping a non-write assistant message for a write + its result.