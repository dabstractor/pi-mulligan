# PRP — P1.M3.T1.S1: Remove break-after-first-clear; clear ALL matching checkpoint targets (BUG-001)

## Goal

**Feature Goal**: Fix BUG-001 — the checkpoint-consumption loop in `src/tools/rewind.ts` step 7b clears
ONLY the first-found (oldest) target then `break`s. When the same checkpoint name is set on two distinct
targets (Pi's `labelsById` is `Map<targetId,label>` with **no cross-target uniqueness**), the survivor
retains the label, so `checkpointExists` stays true and a second `mulligan_rewind(granularity:"checkpoint",
checkpoint:"x")` **succeeds instead of refusing "not found"** — a direct violation of spec/05 §3 step 5
("Auto-expiry on consumption (REQUIRED)") and spec/10 §2.1 (F-checkpoint). The fix mirrors the existing
`checkpointExists` pattern: collect ALL candidate targetIds, then clear EACH whose CURRENT
`getLabel(id) === needle` (no break), so every concurrently-labeled target is retired.

**Deliverable**: (1) A replacement of the step 7b `if (granularity === "checkpoint") { … }` block (and
its comment) in **`src/tools/rewind.ts`** with the candidate-collect + `getLabel`-gated clear pattern;
(2) a regression test (case **i**) appended to the "checkpoint consumption" describe block in
**`test/tools/rewind.test.ts`** that sets the same name on two distinct targets and asserts BOTH are
cleared + a second rewind refuses. Two files only.

**Success Definition**: After the fix, a rewind to name "x" where two targets (targetA, targetB) both
carry label `mulligan:checkpoint:x` clears BOTH (`pi.setLabel(targetA, undefined)` AND
`pi.setLabel(targetB, undefined)`); a subsequent `checkpointExists(ctx, "x")` returns false; a second
rewind refuses `checkpoint 'x' not found on this branch`. With a single active target, exactly ONE clear
fires (existing tests (a)–(h) stay green). `npm run typecheck` exits 0; `npx vitest run` passes (21 files,
+1 new test). A `setLabel` failure is swallowed (E13 — the rewind still succeeds).

> ⚠️ **Why the regression test is REQUIRED (not optional):** the contract step-4 OUTPUT names only
> `rewind.ts`, but the bug was **masked precisely because** the existing consumption tests (a–h) label only
> a single targetId (`"leaf-1"`) — they never exercise the duplicate-target case (bug_verification §BUG-001:
> "the existing unit tests … never exercise the duplicate-target scenario and mask the bug"). PRD
> §Recommendations explicitly says: "Add a regression test that sets the same checkpoint name on two distinct
> targets." A fix without that test would leave the validation gate green even if the fix were later
> reverted. So the test (case i) is a first-class deliverable of this subtask (the only subtask in P1.M3.T1).

## User Persona (if applicable)

**Target User**: The agent (consumer of checkpoints) + the operator relying on the consumption contract.

**Use Case**: The agent sets checkpoint "x", appends a message (advancing the branch leaf), sets "x" again
on a new target, then rewinds to "x". Both targets now carry the label; the rewind must consume the
checkpoint so a second rewind to "x" refuses — otherwise stale state silently re-targets.

**Pain Points Addressed**: Pre-fix, the second rewind to a consumed (duplicated) name SUCCEEDS, re-hiding
already-rewound state and violating the single-use contract the agent relies on for "undo in one shot".

## Why

- **Spec MUST** (spec/05 §3 step 5): *"Once a mulligan_rewind successfully targets it, the checkpoint is
  consumed and MUST be retired."* The duplicate-target path leaves it un-retired. spec/10 §2.1 F-checkpoint:
  *"a second rewind to 'x' refuses (not found) unless re-created."*
- **Target/clear mismatch**: `resolveCheckpoint` (transforms.ts) scans branchEntries in **REVERSE** → targets
  the MOST RECENT match (targetB). The buggy consumption loop scans **forward** → clears targetA. Fixing the
  loop to clear ALL matching targets removes the mismatch without touching resolveCheckpoint.
- **Pattern reuse (DRY, low-risk)**: the correct two-phase pattern (collect candidates → confirm via
  `getLabel`) ALREADY exists in this file as `checkpointExists` (lines 302-336). The fix applies the SAME
  pattern, clearing instead of returning-true — so the single-active-target path is byte-for-byte
  equivalent in effect (existing tests stay green).
- **Defense-in-depth via `getLabel` gate**: clearing only candidates whose CURRENT label matches avoids
  issuing redundant clears for historical entries that were already cleared (test (g)'s set+clear state).

## What

Replace the step 7b `if (granularity === "checkpoint") { … }` block in `rewindExecute` with a two-phase
loop: (1) collect candidate targetIds from raw label entries whose `label === needle`; (2) for each
candidate, if `ctx.sessionManager.getLabel(id) === needle`, call `pi.setLabel(id, undefined)`. Remove the
`break`. Update the (7b) comment block to note the duplicate-target fix and remove the stale
"BUG-001 fix (validation 1a)" reference (that was a prior round). Add regression test case (i).

### Success Criteria

- [ ] A rewind to "x" with two targets (targetA, targetB) both labeled `mulligan:checkpoint:x` calls
      `pi.setLabel(targetA, undefined)` AND `pi.setLabel(targetB, undefined)` (assertable via `makePi().labels`).
- [ ] A rewind to "x" with ONE active target calls `pi.setLabel` exactly once (existing tests (a)–(h) green).
- [ ] The `break` is GONE; the loop clears ALL candidates whose `getLabel` matches the needle.
- [ ] A candidate whose `getLabel` is `undefined` (already cleared) is NOT re-cleared (the getLabel gate).
- [ ] A `setLabel` or `getLabel` throw is swallowed (E13) — the rewind still returns success.
- [ ] After the fix, a second rewind to the consumed (duplicated) name refuses `checkpoint 'x' not found`.
- [ ] `npm run typecheck` exits 0; `npx vitest run` passes (21 files, +1 new test (i); existing (a)–(h) green).
- [ ] The (7b) comment cites spec/05 §3 step 5 + notes the duplicate-target fix (no stale "validation 1a" ref).
- [ ] No file other than `src/tools/rewind.ts` and `test/tools/rewind.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the verbatim current step 7b block (the FIND target, lines 582-623), the
verbatim replacement (the REPLACE target), the authoritative `checkpointExists` pattern to mirror
(lines 302-336, quoted), the per-test non-breaking proof (a table tracing every existing consumption
test through the fixed code), the complete regression test (case i) with its exact insertion point
(after case (h)), the harness facts (`checkpointLabelEntry(name, targetId)`, `makeCtx({labels})`
override, `makePi().labels` capture), and deterministic `typecheck` + `vitest` gates. The implementer
opens two files and runs two commands.

### Documentation & References

```yaml
# MUST EDIT — the consumption loop (the bug)
- file: src/tools/rewind.ts
  why: rewindExecute step 7b (lines 582-623) is the buggy block. Replace the whole
        `if (granularity === "checkpoint") { … }` (lines 589-623) + update the (7b) comment (582-588).
  section: "rewindExecute — between step 7 (leaveNote) and step 8 (hasWarning). The block opens with
            `// (7b) checkpoint consumption — spec/05 §3 step 5 …` and `if (granularity === \"checkpoint\") {`."
  pattern: "The CORRECT pattern is ALREADY in this file as checkpointExists (lines 302-336): collect
            candidate targetIds into a Set, then confirm each via ctx.sessionManager.getLabel(id) === needle.
            Mirror it EXACTLY — clear each active candidate instead of return-true."
  gotcha: "The current `break` (line 612) is the bug. Its comment 'BUG-001 fix (validation 1a)' refers to a
           PRIOR round (the break once ran before any clear); THIS round's BUG-001 is the duplicate-target
           issue. Update the comment to reflect the duplicate-target fix (contract DOCS step 5)."

# MUST READ — the CORRECT pattern to mirror (same file, READ-ONLY reference)
- file: src/tools/rewind.ts
  why: checkpointExists (lines 289-336) is the reference implementation of the two-phase pattern: (1)
        `const candidates = new Set<string>();` + scan getEntries for type==='label' && label===needle &&
        typeof targetId==='string' && targetId.length>0 → candidates.add(targetId); (2) for (id of candidates)
        if (ctx.sessionManager.getLabel(id) === needle) … . Mirror it verbatim.
  critical: "The consumption fix is checkpointExists with 'clear' substituted for 'return true'. Same
             defensive inline `(e as { type?: unknown; … })` casts, same per-entry try/catch, same Set, same
             getLabel gate. Do NOT import readOwn/isRecord (rewind.ts does not use them)."

# MUST EDIT — the regression test
- file: test/tools/rewind.test.ts
  why: The "checkpoint consumption" describe block (lines ~1145-1288) has cases (a)-(h), ALL labeling a
        SINGLE targetId ("leaf-1"). Append case (i) as the LAST `it(...)` (after (h), before the closing
        `});`) — the duplicate-target regression the existing suite lacks.
  section: "describe(\"mulligan_rewind — checkpoint consumption (spec/05 §3 step 5)\", () => { … }) — the
            LAST `it` is (h) '[regression 1b] a re-set checkpoint …' ending at the block's closing `});`."
  pattern: "Mirror cases (a)/(f): makePi() → { labels, pi }; makeCtx({ entries, contextEntries }); run(…);
            assert firstText(res) + labels.toContainEqual({ entryId, label: undefined }). For the second-rewind
            refusal, mirror (b): a FRESH ctx with makeCtx({ labels: {…undefined} }) override simulating
            post-consumption."
  gotcha: "checkpointLabelEntry(name, targetId='leaf-1') takes targetId as the 2nd arg (line 223) — pass
           distinct ids ('msg-a','msg-b'). makeCtx({labels}) override (line 115) bypasses the derive-from-
           entries walk so getLabel returns the override — use it for the second-rewind ctx. The fake's
           `entries` is STATIC (setLabel does NOT mutate it) — that's why the override exists."

# MUST READ — the bug verification (root cause + the masked-test gap)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/bug_verification.md
  why: §BUG-001 confirms the bug end-to-end (labelsById Map<targetId,label>, no cross-target uniqueness;
        resolveCheckpoint REVERSE-scan targets targetB while the forward loop clears targetA) and the test
        gap ("cases g/h only label a single targetId … mask the bug").
  critical: "Approach A (collect candidates → getLabel-gated clear) is the contract-recommended fix and
             matches checkpointExists. Approach B (clear all raw matching entries without getLabel gate) is
             simpler but issues redundant clears — DO NOT use it; the getLabel gate matters for test (g)."

# CONTEXT — the parallel-sibling PRP (no file overlap)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M2T1S1/PRP.md
  why: CONTRACT. P1.M2.T1.S1 (BUG-004) edits src/transforms.ts + test/transforms.test.ts ONLY. ZERO overlap
        with src/tools/rewind.ts + test/tools/rewind.test.ts. No conflict, any order.
  gotcha: "Do NOT touch transforms.ts (sibling's scope). Validation baseline it cites: tsc exit 0; 952 tests."

# EXTERNAL — the C1/C9 read-only-manager split (why clear via pi, read via ctx.sessionManager)
- note: "Labels are WRITTEN via pi.setLabel (ExtensionAPI — C9) and READ via ctx.sessionManager.getLabel
         (ReadonlySessionManager — C1). checkpointExists reads via ctx.sessionManager.getLabel; the
         consumption clear writes via pi.setLabel. Both use ctx.sessionManager.getEntries() to discover
         candidates. This fix preserves that split (it changes only WHAT is cleared, not the seam)."
```

### Current Codebase tree (the relevant slice)

```bash
src/tools/
└── rewind.ts          # ← EDIT step 7b block (lines 589-623) + (7b) comment (582-588); checkpointExists (302-336) is the READ-ONLY pattern to mirror
test/tools/
└── rewind.test.ts     # ← EDIT: append case (i) as last `it` in the "checkpoint consumption" describe block (after (h))
src/transforms.ts      # READ-ONLY — resolveCheckpoint (REVERSE scan) is correct; sibling P1.M2.T1.S1 edits this (BUG-004)
src/tools/audit.ts     # READ-ONLY — listCheckpoints skips undefined labels (no edit)
spec/05-tools.md       # READ-ONLY — §3 step 5 citation
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/tools/rewind.ts        # replace step 7b block: collect candidates → getLabel-gated clear (no break); update (7b) comment
test/tools/rewind.test.ts  # +1 test case (i): duplicate-target regression (both cleared + second rewind refuses)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (the break is the bug — REMOVE it): the current loop clears the FIRST matching target
//   then `break`s (line 612). With two targets sharing the name, only the oldest is cleared; the survivor
//   stays labeled → checkpointExists stays true → second rewind succeeds. The fix has NO break: it clears
//   EVERY candidate whose getLabel matches. (With one active target, the Set has 1 element → 1 clear, so
//   existing single-target tests (a)-(h) stay green.)

// CRITICAL GOTCHA #2 (mirror checkpointExists EXACTLY — it is the reference): checkpointExists (lines 302-336)
//   already implements the correct two-phase pattern in THIS file. The fix = checkpointExists with
//   pi.setLabel(id, undefined) substituted for `return true`. Same `new Set<string>()` candidate collection,
//   same `ee.type === "label" && ee.label === needle && typeof ee.targetId === "string" && ee.targetId.length > 0`
//   filter, same per-entry try/catch, same `ctx.sessionManager.getLabel(id) === needle` gate. Do NOT invent a
//   new shape — copy checkpointExists so the two scanners stay structurally identical (future-proof + DRY).

// CRITICAL GOTCHA #3 (the getLabel gate matters for test (g)): test (g) constructs entries with a SET entry
//   followed by a CLEAR entry (post-consumption state). The rewind REFUSES at step 3 (checkpointExists=false
//   via getLabel=undefined) so step 7b is never reached → labels stays [] (test (g) asserts toHaveLength(0)).
//   BUT even if 7b WERE reached, the getLabel gate would skip the already-cleared target (getLabel=undefined
//   ≠ needle → no clear). So the gate is both correctness (don't re-clear) AND test-(g) safety. Do NOT use
//   Approach B (clear all raw matching entries without the gate) — it would issue a redundant clear for the
//   historical set entry and is NOT what checkpointExists does.

// CRITICAL GOTCHA #4 (E13 — keep the own try/catch): rewindExecute's whole body is one try/catch (site 9)
//   returning refusal("unexpected error"). If a getEntries/getLabel/setLabel throw escaped the consumption
//   block, it would invert an already-succeeded rewind into a refusal. The fix keeps: (a) the outer
//   try/catch around the whole block (swallows); (b) a per-candidate try/catch around getLabel+setLabel
//   (so one candidate's failure doesn't skip the others). Mirror checkpointExists's per-candidate try/catch.

// CRITICAL GOTCHA #5 (update the stale comment): the current `break` comment says "BUG-001 fix (validation
//   1a)" — that was a PRIOR round (the break once ran before any clear). THIS round's BUG-001 is the
//   duplicate-target issue. The (7b) comment block must note: clear ALL matching targets (no break) because
//   Pi's labelsById has no cross-target uniqueness. Remove the stale "validation 1a" reference. (Mode A — the
//   comment IS the documentation; contract DOCS step 5.)

// CRITICAL GOTCHA #6 (test case letter is (i), not (h)): the consumption block already has (a)-(h). Case
//   (h) is "[regression 1b] a re-set checkpoint (set, clear, set-again) is active again". The new case is
//   (i). Insert it as the LAST `it(...)` AFTER (h), immediately before the describe block's closing `});`.

// OUT OF SCOPE (do NOT touch):
//   - checkpointExists (rewind.ts:289-336) → the REFERENCE pattern; do NOT modify it (it's correct).
//   - resolveCheckpoint (transforms.ts) → correct (REVERSE scan → most-recent target); sibling P1.M2.T1.S1's file.
//   - audit.ts / markers.ts / config.ts / index.ts → READ-ONLY.
//   - spec/* → READ-ONLY (spec/05 §3 step 5 is the cited authority).
// This PRP edits ONLY src/tools/rewind.ts (step 7b) + test/tools/rewind.test.ts (case i).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no new types. The fix reuses the existing `LabelEntry` shape (`{ type:"label", targetId:string,
label:string|undefined }`) via defensive inline casts and the existing `pi.setLabel`/`ctx.sessionManager.getLabel`
APIs. No model, no schema, no export. Pure local control-flow change in `rewindExecute` step 7b._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/rewind.ts — replace the step 7b block (lines 582-623) with the candidate-collect + getLabel-gated clear
  - LOCATE rewindExecute. The step 7b block is the `// (7b) checkpoint consumption …` comment + the
    `if (granularity === "checkpoint") { … }` that follows it, sitting AFTER `leaveNote(pi, rendered,
    markerId ?? toolCallId);` (end of step 7) and BEFORE `// (8) mutation warning`.
  - FIND (verbatim — the ENTIRE current step 7b block, comment + if-block; this is the unique anchor).
    Use the exact text from "Implementation Patterns & Key Details" §CURRENT.
  - REPLACE WITH the fixed block from "Implementation Patterns & Key Details" §FIXED.
  - THE FIX (3 changes vs current):
    (1) Replace the single-pass `for (e of entries) { … if (isMatch) { setLabel; break; } }` with TWO
        phases: (a) `const candidates = new Set<string>();` + a collection loop (same filter as
        checkpointExists: type==='label' && label===needle && typeof targetId==='string' && length>0);
        (b) `for (const id of candidates) { try { if (ctx.sessionManager.getLabel(id) === needle)
        pi.setLabel(id, undefined); } catch { /* E13 */ } }`.
    (2) REMOVE the `break` (and its stale "validation 1a" comment).
    (3) UPDATE the (7b) comment block: note clear-ALL-matching-targets, no cross-target uniqueness,
        mirrors checkpointExists, spec/05 §3 step 5.
  - PRESERVE: the outer `if (granularity === "checkpoint") { try { … } catch { /* E13 */ } }` structure;
    the `needle = \`mulligan:checkpoint:${params.checkpoint}\`` line; the top try around getEntries
    (entries=undefined on throw); the per-entry try/catch in the collection loop (skip throwing-Proxy
    entries); the E13 catch comments.
  - DO NOT: touch checkpointExists, resolvePreview, the persist (step 7), the success return (step 9),
    the refuse() closure, the factory, or any other function; import readOwn/isRecord; add an export.

Task 2: EDIT test/tools/rewind.test.ts — append regression case (i) to the "checkpoint consumption" describe block
  - LOCATE the describe block: `describe("mulligan_rewind — checkpoint consumption (spec/05 §3 step 5)", () => {`.
  - FIND the LAST `it(...)` in that block — case (h): `it("(h) [regression 1b] a re-set checkpoint (set,
    clear, set-again) is active again", async () => { … });` — and the block's closing `});`.
  - INSERT case (i) BETWEEN the end of case (h)'s `});` and the describe block's closing `});`. Use the
    exact code from "Implementation Patterns & Key Details" §TEST (i).
  - THE TEST asserts: (1) a rewind to "x" with two targets (msg-a, msg-b) succeeds; (2) labels contains
    BOTH clears `{entryId:"msg-a",label:undefined}` AND `{entryId:"msg-b",label:undefined}` (the bug
    cleared only msg-a); (3) a second rewind (fresh ctx with labels override = both undefined) refuses
    "checkpoint 'x' not found on this branch".
  - FIXTURES (all existing — no new helpers): checkpointLabelEntry(name, targetId), makeCtx({entries,
    labels, contextEntries}), makePi()→{labels,pi}, msgEntry(user("u")), VALID_NOTE, run(), firstText().
  - DO NOT: modify cases (a)-(h); add new helpers; touch any other test file.
```

### Implementation Patterns & Key Details

**§CURRENT** (the verbatim FIND target — the whole step 7b block in rewind.ts, lines 582-623):
```ts
    // (7b) checkpoint consumption — spec/05 §3 step 5 ("Auto-expiry on consumption (REQUIRED)").
    //      ONLY on the checkpoint-granularity success path (step 7 persist + leaveNote already completed).
    //      A checkpoint label (`mulligan:checkpoint:<name>`) is consumed by the rewind that targets it: clear
    //      the label so a second rewind by the same name can't re-target stale state (single-source downstream
    //      effect). Mirrors checkpointExists' defensive scan style (inline `(e as {...})` casts, per-entry
    //      try/catch — no readOwn/isRecord import). E13: the clear is best-effort and its own try/catch — a
    //      label-clear failure must never undo the rewind (the marker is already persisted at step 7).
    if (granularity === "checkpoint") {
      try {
        const needle = `mulligan:checkpoint:${params.checkpoint}`;
        let entries: unknown;
        try {
          entries = ctx.sessionManager.getEntries();
        } catch {
          entries = undefined;
        }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
            let isMatch = false;
            let targetId: unknown = undefined;
            try {
              const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
              isMatch = ee.type === "label" && ee.label === needle;
              targetId = ee.targetId;
            } catch {
              continue;
            }
            if (isMatch && typeof targetId === "string" && targetId.length > 0) {
              pi.setLabel(targetId, undefined);
              break; // BUG-001 fix (validation 1a): clear THEN stop — the unconditional `break` ran after
                     // the FIRST entry (often a user message), so the label-clear was never reached in a
                     // realistic multi-entry session. Break ONLY after a successful clear.
            }
          }
        }
      } catch {
        // E13: a label-clear failure must never undo the rewind (marker already persisted at step 7).
      }
    }
```

**§FIXED** (the verbatim REPLACE target — mirrors checkpointExists; no break; getLabel gate):
```ts
    // (7b) checkpoint consumption — spec/05 §3 step 5 ("Auto-expiry on consumption (REQUIRED)").
    //      ONLY on the checkpoint-granularity success path (step 7 persist + leaveNote already completed).
    //      A checkpoint label (`mulligan:checkpoint:<name>`) is consumed by the rewind that targets it: clear
    //      the label so a second rewind by the same name can't re-target stale state (single-source downstream
    //      effect). Mirrors checkpointExists' pattern EXACTLY (this file, lines ~302-336): (1) collect candidate
    //      targetIds from raw label entries whose label string === needle; (2) confirm each via
    //      getLabel(id)===needle (Pi's latest-wins map — undefined once a clear follows the set); (3) clear each
    //      CURRENTLY-active target. There is NO break: Pi's labelsById is Map<targetId,label> with NO
    //      cross-target uniqueness, so when the same name is set on two targets BOTH carry the label and BOTH
    //      must be cleared or checkpointExists stays true via the survivor (BUG-001 — the old
    //      break-after-first-clear cleared only the oldest target, while resolveCheckpoint targets the newest).
    //      Defensive inline `(e as {...})` casts + per-entry try/catch (no readOwn/isRecord import — matches
    //      the file's idiom). E13: best-effort, own try/catch + per-candidate try/catch — a label-clear failure
    //      must never undo the rewind (the marker is already persisted at step 7).
    if (granularity === "checkpoint") {
      try {
        const needle = `mulligan:checkpoint:${params.checkpoint}`;
        // (1) collect candidate targetIds whose raw label string === needle (a cleared checkpoint still has
        //     the historical set entry in the raw stream; getLabel below confirms current activity). Set → a
        //     target set twice (or cleared-then-reset) is collected once.
        const candidates = new Set<string>();
        let entries: unknown;
        try {
          entries = ctx.sessionManager.getEntries();
        } catch {
          entries = undefined;
        }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
            try {
              const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
              if (ee.type === "label" && ee.label === needle && typeof ee.targetId === "string" && ee.targetId.length > 0) {
                candidates.add(ee.targetId);
              }
            } catch {
              // skip a throwing-Proxy entry
            }
          }
        }
        // (2) clear each candidate whose CURRENT getLabel still maps to the needle (latest-wins; only
        //     ACTUALLY-active targets are cleared — a historical entry already cleared maps to undefined).
        for (const id of candidates) {
          try {
            if (ctx.sessionManager.getLabel(id) === needle) pi.setLabel(id, undefined);
          } catch {
            // E13: a label-clear failure must never undo the rewind (marker already persisted at step 7).
          }
        }
      } catch {
        // E13: a label-clear failure must never undo the rewind (marker already persisted at step 7).
      }
    }
```

**§TEST (i)** (the verbatim regression test — insert as the last `it` in the consumption describe block):
```ts

  it("(i) [regression BUG-001] two targets share a checkpoint name → BOTH cleared (no break)", async () => {
    // Reproduces BUG-001: Pi's labelsById is Map<targetId,label> with NO cross-target uniqueness, so when a
    // checkpoint name is set on two distinct targets BOTH carry the label. The old consumption loop cleared
    // ONLY the first-found (oldest) target then `break`ed, leaving the survivor labeled → checkpointExists
    // stayed true → a second rewind succeeded instead of refusing "not found" (spec/05 §3 step 5 violation).
    const { labels, pi } = makePi();
    // Two label entries with the same name on DIFFERENT targetIds (both currently active):
    const { ctx } = makeCtx({
      entries: [
        checkpointLabelEntry("x", "msg-a"), // targetA (older); resolveCheckpoint scans REVERSE → targets msg-b
        checkpointLabelEntry("x", "msg-b"), // targetB (newer)
      ],
      contextEntries: [msgEntry(user("u"))], // branch non-empty → resolveCheckpoint no-op (success path)
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "x" });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint."); // success
    // BUG-001 contract: BOTH targets cleared (the old code cleared only msg-a, then broke):
    expect(labels).toContainEqual({ entryId: "msg-a", label: undefined });
    expect(labels).toContainEqual({ entryId: "msg-b", label: undefined });
    // A second rewind by the same name refuses "not found" (both targets now consumed):
    const { ctx: ctx2 } = makeCtx({
      entries: [checkpointLabelEntry("x", "msg-a"), checkpointLabelEntry("x", "msg-b")],
      labels: { "msg-a": undefined, "msg-b": undefined }, // override → simulate post-consumption (both cleared)
      contextEntries: [msgEntry(user("u"))],
    });
    const res2 = await run(pi, ctx2, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "x" });
    expect(firstText(res2)).toContain("Mulligan: refused — checkpoint 'x' not found on this branch.");
  });
```

Key points the fix encodes (understand, don't just paste):

```ts
// PATTERN — mirror checkpointExists (lines 302-336), the reference in THIS file:
//   (1) const candidates = new Set<string>();  scan getEntries for type==='label' && label===needle &&
//       typeof targetId==='string' && targetId.length>0 → candidates.add(targetId).
//   (2) for (const id of candidates) if (ctx.sessionManager.getLabel(id) === needle) <clear | return true>.
// The consumption fix = checkpointExists with pi.setLabel(id, undefined) for `return true`. Identical shape.

// CRITICAL — no break: a Set with 1 active target → 1 clear (existing tests (a)-(h) green). A Set with 2
//   active targets sharing the name → 2 clears (BUG-001 fixed). The break was the bug.

// CRITICAL — getLabel gate (not Approach B): only clear candidates whose CURRENT label is the needle. A
//   historical set entry that was already cleared maps to undefined via getLabel → skipped. This is both
//   correctness (no redundant clear) and test-(g) safety (the set+clear state's rewind refuses at step 3
//   anyway, but the gate is defense-in-depth).

// CRITICAL — E13: the per-candidate try/catch swallows a getLabel/setLabel throw for ONE candidate without
//   skipping the others; the outer try/catch swallows a getEntries throw. Either way the rewind (already
//   persisted at step 7) returns success — never inverted to a refusal.
```

### Integration Points

```yaml
NO NEW INTEGRATION POINTS — two-file control-flow + test change.
  - DATABASE: none
  - CONFIG: none (consumption is unconditional on the checkpoint success path — spec/05 §3 step 5 is
              REQUIRED, not configurable; no knob gates it)
  - ROUTES: none
  - CODE (rewind.ts): replaces the step 7b block in rewindExecute between step 7 (leaveNote) and step 8
            (hasWarning). Uses `granularity`, `params.checkpoint`, `ctx.sessionManager.getEntries()`,
            `ctx.sessionManager.getLabel(id)`, `pi.setLabel(id, undefined)` — ALL in scope. No new import,
            no new export, no signature change. checkpointExists (the mirrored reference) is UNCHANGED.
  - CODE (downstream — NO edits): audit.listCheckpoints skips undefined labels; checkpointExists returns
            false once all targets clear; resolveCheckpoint (transforms.ts) is correct (REVERSE scan).
            Clearing all matching targets is the single source — no downstream edit.
  - TESTS (rewind.test.ts): +1 case (i) in the existing "checkpoint consumption" describe block. Reuses
            checkpointLabelEntry/makeCtx/makePi/msgEntry/user/VALID_NOTE/run/firstText — no new helpers.
  - PARALLEL-SIBLING: P1.M2.T1.S1 edits src/transforms.ts + test/transforms.test.ts (BUG-004) — different
            files, zero overlap, any order.
```

---

## Validation Loop

This is a control-flow fix in one `.ts` file + one regression test. Validation = grep the break is gone +
the new pattern present, typecheck clean, the full vitest suite green (existing (a)–(h) non-breaking +
new (i) passes), and a targeted proof the duplicate case is fixed.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The `break` is GONE from the consumption block:
grep -n "break; // BUG-001 fix (validation 1a)" src/tools/rewind.ts   # Expected: NO output (the stale break+comment removed).
grep -n "break;" src/tools/rewind.ts | grep -i "consumption\|checkpoint"   # Expected: NO consumption-related break (captureHideEntryIds has its own break — that's fine, unrelated).

# (b) The new two-phase pattern is present (candidate Set + getLabel gate):
grep -n "const candidates = new Set<string>()" src/tools/rewind.ts   # Expected: ≥2 hits (checkpointExists + the new step 7b).
grep -n "if (ctx.sessionManager.getLabel(id) === needle) pi.setLabel(id, undefined)" src/tools/rewind.ts   # Expected: 1 hit (step 7b).

# (c) The (7b) comment notes the duplicate-target fix:
grep -n "cross-target uniqueness\|BOTH.*cleared\|BUG-001" src/tools/rewind.ts   # Expected: a hit in the (7b) comment.

# (d) The regression test landed as case (i):
grep -n '"(i) \[regression BUG-001\]' test/tools/rewind.test.ts   # Expected: 1 hit.
```
Expected: (a) no stale break; (b) candidate Set + getLabel-gated clear present; (c) comment updated; (d) case (i) present.

### Level 2: Type-check (the strict gate)

```bash
npm run typecheck        # = tsc --noEmit (strict; tsconfig includes src + test)
echo "typecheck exit: $?"
# Expected: exit 0, NO output. The inline `(e as { type?: unknown; … })` casts + `Set<string>` + getLabel
#           are strict-safe. If tsc errors, READ it (likely a stray untyped access) and fix before proceeding.
```
Expected: exit 0.

### Level 3: Unit Tests (regression guard + the new test)

```bash
# The rewind tool suite (the file with the fix + the new test):
npx vitest run test/tools/rewind.test.ts
# Expected: ALL pass, including the new case (i). Existing cases (a)-(h) stay green (the fix is a superset:
#           1 active target → 1 clear, identical effect). If (a)-(h) fail, the fix changed behavior for the
#           single-target case — re-check you mirrored checkpointExists exactly (esp. the getLabel gate).

# Confirm case (i) specifically is the duplicate-target test and passes:
npx vitest run test/tools/rewind.test.ts -t "two targets share a checkpoint name"
# Expected: 1 test passes.

# Full suite (catches any cross-file surprise; sibling P1.M2.T1.S1's transforms.ts fix may also be present):
npx vitest run
# Expected: 21 test files pass, 0 failures. Pre-edit was 21 files; this task adds 1 test (case i) to
#           rewind.test.ts. If a file COUNT or owner changed unexpectedly, scope leaked — re-check.
```
Expected: rewind tests pass (incl. (i)); full suite 21 files green.

### Level 4: Behavior proof (manual reasoning — codified by case (i))

```bash
# Confirm the consumption block now has exactly the two-phase shape (candidate collect → getLabel-gated clear):
sed -n '589,640p' src/tools/rewind.ts   # visually confirm: Set<string> candidates; for(id of candidates) if(getLabel===needle) setLabel(id,undefined); NO break.

# Confirm checkpointExists (the mirrored reference) is UNCHANGED (diff should NOT touch lines 289-336):
git diff -- src/tools/rewind.ts | grep -E '^-.*candidates|^\+.*candidates' | head
# Expected: the +candidates additions are in the step 7b region; checkpointExists' candidates line is NOT a `-` removal.
```
Expected: the new two-phase block; checkpointExists untouched.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
git diff --stat   # Expected: src/tools/rewind.ts + test/tools/rewind.test.ts ONLY.
git diff --name-only | grep -vE 'src/tools/rewind.ts|test/tools/rewind.test.ts' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# Expected: "scope OK". transforms.ts (sibling P1.M2.T1.S1), audit.ts, checkpoint.ts, markers.ts, config.ts,
#           spec/*, index.ts must NOT appear (unless the sibling's transforms.ts change is also in the diff —
#           that's the sibling's, not yours; confirm your hunks are rewind.ts + rewind.test.ts only).
```
Expected: only `src/tools/rewind.ts` + `test/tools/rewind.test.ts` in YOUR diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms the stale `break` is gone; the candidate Set + `getLabel`-gated clear are present;
      the (7b) comment notes the duplicate-target fix; case (i) exists.
- [ ] Level 2: `npm run typecheck` exits 0.
- [ ] Level 3: `npx vitest run test/tools/rewind.test.ts` passes (incl. (i)); full `npx vitest run` = 21 files green.
- [ ] Level 4: the new block is two-phase; `checkpointExists` (lines 289-336) is UNCHANGED.
- [ ] Level 5: `git diff --name-only` shows ONLY `src/tools/rewind.ts` + `test/tools/rewind.test.ts`.

### Feature Validation
- [ ] A rewind to "x" with two targets (msg-a, msg-b) both labeled clears BOTH (`labels` has both).
- [ ] A rewind to "x" with ONE active target clears exactly once (existing (a)–(h) green).
- [ ] The `break` is removed; ALL candidates whose `getLabel` matches are cleared.
- [ ] A candidate whose `getLabel` is `undefined` (already cleared) is NOT re-cleared.
- [ ] A `setLabel`/`getLabel` throw is swallowed (E13) — the rewind still succeeds.
- [ ] After the fix, a second rewind to the consumed (duplicated) name refuses `checkpoint 'x' not found`.
- [ ] The (7b) comment cites spec/05 §3 step 5 + notes the duplicate-target fix (no stale "validation 1a").

### Code Quality / Scope Discipline
- [ ] The fix mirrors `checkpointExists` (same Set collection + getLabel gate) — the two scanners stay identical.
- [ ] Did NOT modify `checkpointExists` (it is the correct reference; only step 7b changes).
- [ ] Did NOT use Approach B (clear all raw matching entries without the getLabel gate).
- [ ] Did NOT touch transforms.ts (sibling P1.M2.T1.S1), audit.ts, markers.ts, config.ts, index.ts, spec/*.
- [ ] The regression test (case i) reuses existing helpers (no new helpers; no other test file touched).

### Documentation
- [ ] Mode A: the (7b) comment IS the doc — notes clear-ALL-matching + cross-target-uniqueness rationale.
- [ ] The regression test (i) docstring explains the bug (masked by single-target tests (a)-(h)).

---

## Anti-Patterns to Avoid

- ❌ Don't keep the `break`. It IS the bug — with two targets sharing a name, it clears only the oldest and
  leaves the survivor labeled. The fix clears EVERY candidate whose `getLabel` matches (no break).
- ❌ Don't invent a new scan shape. `checkpointExists` (lines 302-336) ALREADY implements the correct
  two-phase pattern in this file. Mirror it EXACTLY (Set<string> candidates → `getLabel(id) === needle` gate)
  so the two scanners stay structurally identical. Substituting `pi.setLabel(id, undefined)` for `return true`
  is the ONLY behavioral delta.
- ❌ Don't use Approach B (clear all raw matching entries without the getLabel gate). It issues redundant
  clears for historical entries and diverges from checkpointExists. The `getLabel` gate is both correctness
  (don't re-clear) and test-(g) safety.
- ❌ Don't modify `checkpointExists`. It is the correct reference pattern (the bug is ONLY in step 7b). If you
  "refactor" checkpointExists you risk breaking its 8 dependent tests for no benefit.
- ❌ Don't drop the E13 try/catch wrappers. The outer (swallows getEntries throws) and the per-candidate
  (swallows getLabel/setLabel throws for one candidate without skipping others) are both required — without
  them a throw inverts an already-succeeded rewind into a refusal.
- ❌ Don't forget to update the (7b) comment. The stale "BUG-001 fix (validation 1a)" reference describes a
  PRIOR round's fix; this round's BUG-001 is the duplicate-target issue. Update to note clear-ALL-matching +
  cross-target-uniqueness (contract DOCS step 5, Mode A).
- ❌ Don't skip the regression test (case i). The bug was masked precisely because tests (a)-(h) label only a
  single target. PRD §Recommendations explicitly requires it. Without it, the validation gate stays green
  even if the fix is reverted. It's a first-class deliverable (the only subtask in P1.M3.T1).
- ❌ Don't name the test case (h) — that case already exists ("a re-set checkpoint … is active again"). The
  new case is **(i)**, inserted as the LAST `it` in the consumption describe block (after (h)).
- ❌ Don't touch transforms.ts. `resolveCheckpoint` (REVERSE scan → most-recent target) is CORRECT; the
  target/clear mismatch is fixed entirely in rewind.ts by clearing ALL targets. transforms.ts is the sibling
  P1.M2.T1.S1's file (BUG-004).
- ❌ Don't make consumption configurable. spec/05 §3 step 5 is REQUIRED — no knob gates it. The fix runs
  unconditionally on every checkpoint-granularity success.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a focused control-flow fix in one file (replace the
step 7b block) + one regression test (case i), with: the verbatim CURRENT block (FIND) and FIXED block
(REPLACE) quoted; the authoritative `checkpointExists` pattern (lines 302-336) to mirror, quoted; a
per-test non-breaking proof table tracing every existing consumption test (a)-(h) through the fixed code;
the complete regression test (i) with its exact insertion point (after (h)) and the harness facts
(`checkpointLabelEntry(name, targetId)`, `makeCtx({labels})` override, `makePi().labels`); the
root-cause evidence (labelsById `Map<targetId,label>`, no cross-target uniqueness, REVERSE vs forward
scan mismatch); and deterministic `typecheck` + `vitest` gates. The fix is a strict superset for the
single-target case (1 candidate → 1 clear), so existing tests are provably non-breaking. The one residual
risk — accidentally using Approach B (no getLabel gate) or touching checkpointExists — is the explicitly
flagged CRITICAL GOTCHA #2/#3 and is enforced by the Level 1 grep + the non-breaking table. Not 10/10
only because the exact comment wording and the test's second-rewind `labels`-override mechanic are easy to
get subtly wrong if pasted without reading the gotchas.