# Verification Findings — P1.M3.T1.S1 (BUG-001: clear ALL matching checkpoint targets)

**Task**: Fix BUG-001 in `src/tools/rewind.ts` step 7b (checkpoint-consumption loop): when the same
checkpoint name is set on TWO distinct targets, Pi persists both labels concurrently (`labelsById` =
`Map<targetId,label>`, no cross-target uniqueness). The current loop clears ONLY the first-found
(oldest) target then `break`s, leaving the survivor labeled → `checkpointExists` stays true → a second
rewind succeeds instead of refusing "not found" (spec/05 §3 step 5 MUST violation). FIX: mirror
`checkpointExists`' pattern — collect candidate targetIds, then clear EACH whose CURRENT
`getLabel(id) === needle` (no break). Plus a regression test (case i) in `test/tools/rewind.test.ts`.

Ground truth read: `src/tools/rewind.ts` (checkpointExists:289-336; step 7b block:582-623),
`test/tools/rewind.test.ts` (makeCtx labels/getLabel:106-167; checkpointLabelEntry:223; consumption
tests a-h:1145-1288), `architecture/bug_verification.md` §BUG-001, `architecture/spec_requirements.md`,
P1M2T1S1/PRP.md (sibling — transforms.ts only, no overlap).

---

## A. THE BUG (verified, src/tools/rewind.ts:582-623)

The step 7b `if (granularity === "checkpoint")` block iterates `getEntries()` in append order, finds
the FIRST label entry matching `needle`, calls `pi.setLabel(targetId, undefined)`, then `break`s:
```ts
if (isMatch && typeof targetId === "string" && targetId.length > 0) {
  pi.setLabel(targetId, undefined);
  break; // BUG-001 fix (validation 1a): …  ← clears ONLY the oldest target; newer target retains label
}
```
**Root cause**: Pi's `labelsById` (`Map<targetId,label>`) has NO cross-target uniqueness, so when name
"x" is set on targetA then targetB, BOTH carry `mulligan:checkpoint:x`. The loop clears targetA (first
in append order) and breaks; `resolveCheckpoint` (transforms.ts) targets targetB (most recent, REVERSE
scan) — a target/clear mismatch. After clearing targetA, `checkpointExists("x")` still returns true via
`getLabel(targetB)`, so a second rewind SUCCEEDS instead of refusing "not found".
**Note on the stale comment**: the existing `break` comment says "BUG-001 fix (validation 1a)" — that
was a PRIOR round's fix (the break once ran before any clear). THIS round's BUG-001 is the
duplicate-target issue. The comment must be updated (contract DOCS step 5).

## B. THE CORRECT PATTERN (already in this file: checkpointExists, lines 302-336)

`checkpointExists` ALREADY does the right thing — it is the pattern to mirror:
```ts
function checkpointExists(ctx, name): boolean {
  const needle = `mulligan:checkpoint:${name}`;
  const candidates = new Set<string>();           // (1) collect candidate targetIds
  ... for (e of entries) { if (ee.type==="label" && ee.label===needle && typeof ee.targetId==="string" && ee.targetId.length>0) candidates.add(ee.targetId); }
  ... for (id of candidates) {                    // (2) confirm ACTIVITY via latest-wins getLabel
    try { if (ctx.sessionManager.getLabel(id) === needle) return true; } catch { /* skip */ }
  }
  return false;
}
```
The fix = the SAME two-phase pattern, but CLEAR each active candidate instead of return-true. This:
- discovers ALL candidate targets (not just the first), and
- clears only CURRENTLY-active ones (a historical entry already cleared maps to `undefined` via getLabel).

## C. THE FIX (Approach A — contract-recommended; mirrors checkpointExists)

Replace the entire step 7b `if (granularity === "checkpoint") { … }` block (lines 589-623) with:
```ts
    if (granularity === "checkpoint") {
      try {
        const needle = `mulligan:checkpoint:${params.checkpoint}`;
        // (1) collect candidate targetIds whose raw label string === needle (a cleared checkpoint still
        //     has the historical set entry in the raw stream; getLabel below confirms current activity).
        const candidates = new Set<string>();
        let entries: unknown;
        try { entries = ctx.sessionManager.getEntries(); } catch { entries = undefined; }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
            try {
              const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
              if (ee.type === "label" && ee.label === needle && typeof ee.targetId === "string" && ee.targetId.length > 0) {
                candidates.add(ee.targetId);
              }
            } catch { /* skip a throwing-Proxy entry */ }
          }
        }
        // (2) clear each candidate whose CURRENT getLabel still maps to the needle (latest-wins; NO break —
        //     Pi's labelsById has no cross-target uniqueness, so two targets sharing a name BOTH get cleared).
        for (const id of candidates) {
          try { if (ctx.sessionManager.getLabel(id) === needle) pi.setLabel(id, undefined); }
          catch { /* E13: a label-clear failure must never undo the rewind */ }
        }
      } catch { /* E13: never undo the rewind (marker persisted at step 7) */ }
    }
```
**Why no break**: with one active target, candidates has 1 element → exactly 1 clear (identical to old
behavior, so existing tests (a)–(h) stay green). With two active targets sharing the name, BOTH clear.
**Why getLabel gate**: skips historical entries already cleared (test (g)'s set+clear state →
getLabel=undefined → no redundant clear).

## D. NON-BREAKING PROOF (traced every existing consumption test)

| Test | entries | Fixed-code behavior | Existing assertion | Passes? |
|---|---|---|---|---|
| (a) | [label("anchor",leaf-1)] active | candidates={leaf-1}; getLabel=needle → clear | `toContainEqual({leaf-1,undefined})` | ✅ |
| (b) | ctx1 consumes; ctx2 empty | second rewind refuses at step 3 | refuses "not found" | ✅ |
| (c) | two fresh ctx, single active each | each clears leaf-1 once | `toHaveLength(2)` | ✅ (1 clear/rewind) |
| (d) | last_turn (non-checkpoint) | step 7b NEVER entered | `labels.toEqual([])` | ✅ |
| (e) | throwOnSetLabel | per-candidate try/catch swallows | success + `appended.toHaveLength(1)` | ✅ |
| (f) | multi-entry, label at [3] active | candidates={leaf-1} → clear | `toContainEqual({leaf-1,undefined})` | ✅ |
| (g) | set+clear (post-consumption) | checkpointExists=false → refuse at STEP 3 (7b unreached) | `labels.toHaveLength(0)` | ✅ |
| (h) | set/clear/re-set (re-create) | checkpointExists=true → 7b clears leaf-1 | no labels assertion | ✅ |

**Key**: tests (b)/(g) refuse at step 3 (checkpointExists, UNCHANGED) before reaching step 7b → labels
stays []. Test (c) clears exactly 1 per rewind (single target). Test (g)'s getLabel-gate skips the
already-cleared target. NONE break.

## E. THE REGRESSION TEST (case i — REQUIRED; the bug was masked by its absence)

The existing block (a-h) only ever labels a single targetId ("leaf-1") → never exercises the duplicate
case. PRD §Recommendations: "Add a regression test that sets the same checkpoint name on two distinct
targets." This is case **(i)** (a-h exist; i is the next), inserted as the LAST `it(...)` in the
"checkpoint consumption" describe block (after (h), before the closing `});`):
```ts
  it("(i) [regression BUG-001] two targets share a checkpoint name → BOTH cleared (no break)", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [
        checkpointLabelEntry("x", "msg-a"), // targetA (older)
        checkpointLabelEntry("x", "msg-b"), // targetB (newer) — resolveCheckpoint scans REVERSE → targets msg-b
      ],
      contextEntries: [msgEntry(user("u"))], // branch non-empty → resolveCheckpoint no-op (success path)
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "x" });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint."); // success
    expect(labels).toContainEqual({ entryId: "msg-a", label: undefined }); // BOTH cleared…
    expect(labels).toContainEqual({ entryId: "msg-b", label: undefined }); // …(old code cleared only msg-a)
    // second rewind by the same name refuses "not found" (both targets now consumed):
    const { ctx: ctx2 } = makeCtx({
      entries: [checkpointLabelEntry("x", "msg-a"), checkpointLabelEntry("x", "msg-b")],
      labels: { "msg-a": undefined, "msg-b": undefined }, // override → simulate post-consumption (both cleared)
      contextEntries: [msgEntry(user("u"))],
    });
    const res2 = await run(pi, ctx2, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "x" });
    expect(firstText(res2)).toContain("Mulligan: refused — checkpoint 'x' not found on this branch.");
  });
```
**Why it catches the bug**: buggy code clears msg-a (first in append order) then breaks →
`labels`=[{msg-a,undefined}] → the `toContainEqual({msg-b,undefined})` assertion FAILS. Fixed code:
candidates={msg-a,msg-b}, getLabel both=needle → clears both → assertion passes.
**Harness facts**: `checkpointLabelEntry(name, targetId)` accepts targetId (line 223);
`makeCtx({labels})` override bypasses the derive-from-entries walk (line 115) so the second-rewind
ctx simulates post-consumption; `makePi().labels` captures every setLabel as `{entryId,label}`;
`msgEntry`/`user` are existing helpers; `VALID_NOTE` is the existing fixture (line 53).

## F. SCOPE
- EDIT `src/tools/rewind.ts`: replace the step 7b `if (granularity==="checkpoint"){…}` block (lines 589-623)
  + update the (7b) comment block (lines 582-588). [Mode A doc — the comment IS the doc.]
- EDIT `test/tools/rewind.test.ts`: append case (i) as the LAST `it(...)` in the "checkpoint consumption"
  describe block (after case (h), before its closing `});`).
- DO NOT edit checkpointExists, transforms.ts, audit.ts, config.ts, markers.ts, spec/*, index.ts.
- PARALLEL-SIBLING: P1.M2.T1.S1 edits src/transforms.ts + test/transforms.test.ts (BUG-004) — different
  files, zero overlap, any order.

## G. VALIDATION BASELINES (confirmed this session)
- `npm run typecheck` (= `tsc --noEmit`) → **exit 0**.
- `npx vitest run` → **21 test files pass** (pre-edit). After adding case (i), 21 files / +1 test.

## H. CITATION
spec/05 §3 step 5 (line ~182): "Auto-expiry on consumption (REQUIRED): … the checkpoint is consumed and
MUST be retired — its label cleared … so it no longer appears active in mulligan_audit." spec/10 §2.1
F-checkpoint: "a second rewind to 'x' refuses (not found) unless re-created."

## I. FILES READ (evidence)
src/tools/rewind.ts (checkpointExists:289-336; step 7b:582-623; rewindExecute steps), test/tools/rewind.test.ts
(makeCtx:106-167; checkpointLabelEntry:223; makePi:62-94; consumption tests a-h:1145-1288; VALID_NOTE:53),
architecture/bug_verification.md (§BUG-001), architecture/spec_requirements.md, P1M2T1S1/PRP.md (sibling).