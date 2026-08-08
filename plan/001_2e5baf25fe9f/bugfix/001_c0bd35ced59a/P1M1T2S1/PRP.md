# PRP — P1.M1.T2.S1: Fix setCheckpoint to walk getBranch for stable entry (BUG-003)

**Work item:** P1.M1.T2.S1 · **Points:** 1 · **Bugfix:** BUG-003 (checkpoint rewind hides nothing — labeling half)
**Scope:** Change ONE function, `setCheckpoint` (`src/markers.ts:327-339`), to label the **last real `message`
entry on the branch** (found by walking `ctx.sessionManager.getBranch()` ROOT→LEAF backwards) instead of the raw
`getLeafId()` leaf. Add Mode-A JSDoc. Update the unit tests in `test/tools/checkpoint.test.ts` (named in the
contract) **and** `test/markers.test.ts` (direct setCheckpoint tests that break in lockstep — REQUIRED for a green
suite), plus comment/hygiene ride-alongs. **No change to `resolveCheckpoint` (T1 owns the walk; T3 owns orphan-snap);
no signature change; no spec-doc change.**

---

## Goal

**Feature Goal**: Make `setCheckpoint` anchor a checkpoint on a **deterministic, always-mappable message entry**
so that a later `resolveCheckpoint` (walk-direction fixed by T1) can actually map it to a message index and hide
later work. Today `setCheckpoint` labels whatever `getLeafId()` returns, which — after any Mulligan write (a
rewind/shrink/turn-metric **`custom`** marker, a **`label`** entry, a note **`custom_message`**, or a transient
no-role message) — is a **non-context-producing** or non-genuine entry that `resolveCheckpoint`'s walk filters out,
so the walk never matches it (`found` stays `false`) and checkpoint rewinds silently no-op (BUG-003's labeling root cause).

**Deliverable**:
1. `src/markers.ts` — `setCheckpoint`: replace `getLeafId()` + `{error:"no leaf"}` with a `getBranch()` backwards
   walk to the last `message` entry whose `message.role` is a non-empty string; return `{entryId: stableId}` or
   `{error:"no stable entry to checkpoint"}`. Keep the try/catch (NEVER throws). Rewrite the JSDoc (Mode A).
2. `src/tools/checkpoint.ts:113,147` — fix the two stale comments (`null-checks getLeafId` / `{error:"no leaf"}`).
3. `test/tools/checkpoint.test.ts` — makeCtx gains `getBranch()` (default branch ends in a stable message whose id
   == scripted leafId, so success assertions stay valid); add the crux test (non-message leaf → labels last message);
   convert "no-leaf"→"no-stable-entry" and "throwing getLeafId"→"throwing getBranch".
4. `test/markers.test.ts` — makeCtx gains `getBranch()`; update the 6 setCheckpoint tests (incl. the inline-C1/C9
   test) to the new read-via-getBranch behavior and new error string; add the crux test.
5. `test/edge-cases.test.ts:821` — (hygiene) give the throwing-setLabel checkpoint test a stable-message branch so
   it actually exercises the throwing-setLabel path (currently it degrades to the no-stable-entry path and passes by
   regex accident).

**Success Definition**: `setCheckpoint` labels a real `message` entry even when the leaf is a `custom`/`label`/note
entry (the crux tests pass). `npx tsc --noEmit` exits 0. `npm test` is fully green. The old `{error:"no leaf"}` is
gone from `src/markers.ts` (replaced by `{error:"no stable entry to checkpoint"}`).

---

## User Persona

**Target User**: The implementing AI agent (this and downstream P1.M1.T3, P1.M3, P1.M4 subtasks) and the end agent
that calls `mulligan_checkpoint`.

**Use Case**: The agent sets a checkpoint before speculative work, does the work, then rewinds to the checkpoint.
With T1's walk fix + this labeling fix, `resolveCheckpoint` now maps the labeled message to a real index and hides
the post-checkpoint work. Without this fix, even with T1 applied, a checkpoint set after any prior Mulligan write
labels a non-message leaf that `resolveCheckpoint` cannot find → no-op.

**Pain Points Addressed**: Today checkpoint rewinds are silently non-functional whenever a Mulligan marker/note was
the last thing appended before the checkpoint (a very common sequence: the agent often rewinds, THEN sets a
checkpoint). This PRP makes the checkpoint anchor robust to whatever sits at the leaf.

---

## Why

- **Root-cause fix for BUG-003's labeling half.** `resolveCheckpoint` (step 4, `src/transforms.ts`) returns `null`
  ("targetId labels a non-context-producing entry → refuse") when the labeled entry isn't a `message`. `getLeafId()`
  returns the last-appended entry — a `custom`/`label`/note after any Mulligan write — which is exactly the unmappable
  case. Labeling the last real `message` guarantees `resolveCheckpoint`'s walk finds it (`found=true`).
- **Composes cleanly with T1 (already applied) and T3 (next).** T1 fixed the walk DIRECTION (now root→leaf, verified
  at `transforms.ts:463/478/445`). This PRP fixes WHICH entry is labeled. T3 will snap `iTarget` to a unit boundary
  to prevent orphaning a checkpointed assistant message's toolResult. The three are independent, ordered fixes; this
  one is the labeling step.
- **Honest error surface.** `{error:"no stable entry to checkpoint"}` is accurate (a brand-new session with no
  committed message yet cannot be checkpointed), replacing the now-meaningless `{error:"no leaf"}` (getLeafId is no
  longer consulted).
- **Robust to BOTH getLeafId() interpretations.** Whether the leaf is the committed assistant message (architecture
  `pi_session_model.md` Q1) or a transient/garbage entry (PRD BUG-003's observation), the walk to the last real
  `message` with a role always yields a genuine, context-producing conversation turn.

---

## What

A single-function behavior change plus its JSDoc and tests:

1. **`setCheckpoint` (`src/markers.ts:327`)**: walk `ctx.sessionManager.getBranch()` (ROOT→LEAF) from the END
   backwards; pick the first entry where `e.type === "message" && e.message && typeof e.message.role === "string" &&
   e.message.role.length > 0`; label ITS id. If none, `{error:"no stable entry to checkpoint"}`. Keep try/catch.
2. **JSDoc (Mode A)**: document the stable-entry walk, the reason getLeafId() is wrong, and the new error.
3. **Tests**: makeCtx fakes gain `getBranch()`; success assertions stay valid (default branch ends in a message whose
   id == the scripted leaf id); add the crux test (non-message leaf → labels last message, NOT the leaf); convert the
   no-leaf and throwing-getLeafId tests to no-stable-entry and throwing-getBranch.

This subtask does **NOT** touch: `resolveCheckpoint` / `transforms.ts` (T1 done; T3 = orphan-snap),
`filterPipeline`, `hideEntryIds` (P1.M2), `spec/06` (P1.M4.T1), the smoke harness (P1.M3.T2), `index.ts`, or
`SetCheckpointResult` (signature unchanged). The tool layer (`checkpoint.ts`) needs NO logic change (it forwards
`res.error` generically) — only two stale comments.

### Success Criteria

- [ ] `setCheckpoint` contains NO `getLeafId()` call; it calls `ctx.sessionManager.getBranch()` and walks it backwards.
- [ ] It labels the last `message` entry with a non-empty `role`; returns `{entryId: stableId}` / `{error:"no stable
      entry to checkpoint"}`; still wrapped in try/catch (NEVER throws).
- [ ] Crux tests pass in BOTH `test/markers.test.ts` and `test/tools/checkpoint.test.ts`: a branch whose leaf is a
      `custom` entry → setCheckpoint labels the earlier message id, NOT the leaf id.
- [ ] `npx tsc --noEmit -p tsconfig.json` → 0 errors.
- [ ] `npm test` → full suite green.
- [ ] `grep -rn "no leaf" src/markers.ts` returns nothing; the only `no leaf` mentions left are unrelated
      (markers.ts append-wrapper "no leaf" prose at line ~159, shrink.ts comment) — verify none describe setCheckpoint.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact old→new code for `setCheckpoint` is given verbatim; the test fake design
> (makeCtx + getBranch) and the crux test are specified; the full blast radius (3 test files + 1 source comment) is
> enumerated with line numbers verified by grep; the bug mechanism is grounded in `resolveCheckpoint` step 4
> (`found=false → null`). The validation commands are proven to run in this repo (vitest + tsc are the project gates).

### Documentation & References

```yaml
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/pi_session_model.md
  why: "Q2 (getBranch returns ROOT→LEAF), Q3 (no transient entry type — 'stable' = context-producing type), Q5
        (parentId walk = getBranch without the final reverse). Grounds WHY the walk-to-last-message is correct and
        what 'stable' means."
  critical: "Q3: the ONLY way to know an entry has real content is its type. A message entry's content is
             entry.message (role). The fix's role check matches this exactly."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M1T1S1/PRP.md
  why: "THE CONTRACT this PRP builds on. T1 fixed resolveCheckpoint's walk direction (root→leaf, no .reverse(),
        reverse-scan for labels) and is ALREADY applied to the working tree. This PRP assumes the post-T1
        resolveCheckpoint (verified at transforms.ts:463/478/445). Do NOT re-touch resolveCheckpoint."
  pattern: "T1 reordered test/transforms.test.ts fixtures to root→leaf; THIS PRP must keep getBranch() fakes in
            the SAME root→leaf order so resolveCheckpoint's walk (tested via the tool/integration paths) stays valid."

- file: src/transforms.ts
  why: "resolveCheckpoint @450 (post-T1). Step 4 (lines ~498-510) is the DECISIVE proof: `if (!found) return null;
        // targetId labels a non-context-producing entry → refuse`. The labeled entry MUST be a context-producing
        type (`message`) for `found` to become true. The fix guarantees this."
  gotcha: "`message` and `custom_message` are both context-producing; `custom`/`label` are NOT. So labeling a prior
           rewind marker (`custom`) or a checkpoint label (`label`) → filtered out → no-op. The fix labels a `message`."

- file: src/markers.ts
  why: "setCheckpoint @327-339 (the function to fix), its JSDoc @306-326, SetCheckpointResult @299-303. The
        leaf-capture idiom in the append* wrappers (@130-200) uses getLeafId for MARKER ids (correct, unchanged) —
        only setCheckpoint's use of getLeafId is wrong."
  gotcha: "Do NOT change the append* wrappers' getLeafId capture — that idiom (C7) is correct and unrelated."

- file: src/tools/checkpoint.ts
  why: "checkpointExecute @117-152 calls setCheckpoint and forwards res.error generically
        (`refusal('could not set checkpoint: '+res.error, name)`). NO logic change — only the stale comments @113 & @147."
  pattern: "The tool does NOT call getLeafId itself (it delegates fully) — so the error string flows through unchanged."

- file: test/markers.test.ts
  why: "DIRECT setCheckpoint unit tests @472-545 (6 tests). makeCtx @64-90 scripts getLeafId (no getBranch) — these
        WILL FAIL after the fix (setCheckpoint throws on undefined getBranch → {error}). MUST update makeCtx + these
        tests. NOT named in the item but REQUIRED for a green suite."
  gotcha: "makeCtx here is SHARED with the append* tests (they use getSessionId+getLeafId, NOT getBranch) — ADD
           getBranch without disturbing the `calls` sequences those tests assert (e.g. ['getSessionId','getLeafId'])."

- file: test/tools/checkpoint.test.ts
  why: "makeCtx @56-71 (scripts getLeafId only) + the no-leaf @238 & throwing-getLeafId @267 tests. Named in the
        item contract. Update makeCtx to provide getBranch; convert the two error-path tests."

- file: test/edge-cases.test.ts
  why: "Checkpoint throwing-setLabel test @821 uses makeCtx() with default branch=[] (makeCtx @177-215 DOES support
        getBranch). With the fix, empty branch → no-stable-entry → setLabel never reached → throwOnSetLabel never
        triggers. Test STILL PASSES (regex /refused|could not set/i matches) but DEGRADES. Hygiene fix: pass a
        stable-message branch."
```

### Current Codebase tree (relevant slice — post-T1 working tree)

```bash
pi-mulligan/
├── src/
│   ├── markers.ts            # setCheckpoint @327-339 (FIX); JSDoc @306-326; append* wrappers UNCHANGED
│   ├── transforms.ts         # resolveCheckpoint @450 (post-T1, DONE — read-only for this PRP)
│   ├── filter.ts             # @184 getBranch()→filterPipeline (caller, no change)
│   └── tools/
│       ├── checkpoint.ts     # @113,@147 stale comments (ride-along); logic UNCHANGED
│       └── rewind.ts         # @266,@288 GOTCHA #8 + getBranch caller (no change)
└── test/
    ├── markers.test.ts        # makeCtx @64-90 + setCheckpoint block @472-545 (REQUIRED updates)
    ├── tools/checkpoint.test.ts  # makeCtx @56-71 + no-leaf/throwing tests (REQUIRED, named in item)
    ├── edge-cases.test.ts     # @821 checkpoint throwing-setLabel test (RECOMMENDED hygiene)
    └── transforms.test.ts     # resolveCheckpoint fixtures (post-T1, DONE — no change)
```

### Desired Codebase tree

```bash
# No files added/removed. EDIT IN PLACE:
#   src/markers.ts              — setCheckpoint body + JSDoc (THE fix)
#   src/tools/checkpoint.ts     — 2 stale comments
#   test/markers.test.ts        — makeCtx + 6 setCheckpoint tests + crux test
#   test/tools/checkpoint.test.ts — makeCtx + no-leaf/throwing tests + crux test
#   test/edge-cases.test.ts     — 1 hygiene edit (branch for the throwing-setLabel test)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA A (THE bug): getLeafId() labels a non-mappable entry.
// After ANY Mulligan write the leaf is a `custom` marker / `label` / note `custom_message` — NOT a `message`.
// resolveCheckpoint (transforms.ts step 4) filters branchEntries to context-producing types and walks them; a
// `custom`/`label` target is filtered OUT → `found` stays false → returns null → checkpoint no-ops (BUG-003).
// FIX: walk getBranch() backwards to the last REAL `message` entry (always context-producing + genuine turn).
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA B: the `e.type === "message"` discriminant is REQUIRED for the type-check.
// branch is `SessionEntry[]` (a union). Only `SessionMessageEntry` has a `message` field. The check
// `e.type === "message"` narrows `e` so `e.message.role` type-checks under strict. Drop the check → TS error.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA C: keep the `role.length > 0` runtime guard even though role is typed as a string-literal union.
// AgentMessage.role is `"user"|"assistant"|"toolResult"|...` — always a non-empty string at the type level, so the
// `typeof === "string" && .length > 0` check is a no-op for well-formed entries. BUT it defends against the
// transient/no-role message the PRD observed (a `message` entry with no/empty role). Keep it — it's the contract logic.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA D: NEVER throw — keep the existing try/catch.
// getBranch() throwing (or returning non-array) → the backwards loop's `branch.length`/index access throws →
// caught → `{error: <msg>}`. A throwing getBranch is a real failure mode (test/edge-cases.test.ts scripts it) and
// MUST stay swallowed (markers.ts hot-path discipline). Do NOT remove the try/catch.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA E: test/markers.test.ts MUST be updated even though the item names only checkpoint.test.ts.
// It has DIRECT setCheckpoint unit tests (6 of them) whose makeCtx provides NO getBranch. After the fix, setCheckpoint
// calls getBranch → `undefined is not a function` → caught → {error} on EVERY path → all 6 fail. A green suite
// REQUIRES updating markers.test.ts. (Verified by grep — see Blast Radius table.)
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA F: makeCtx default branch must end in a stable message whose id == the scripted leafId.
// The existing success tests do `makeCtx({ leafId: "leaf-9" })` and assert `{entryId:"leaf-9"}` / labels[0].entryId
// === "leaf-9". For those to stay valid with ZERO value churn, the default branch should be
// [msgEntry("u","user"), msgEntry(<leafId>,"assistant")] so the stable anchor id == leafId. An explicit `branch` opt
// overrides this for the crux / no-stable tests.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA G: branch order in test fakes is ROOT→LEAF (matching getBranch() / T1's contract).
// The walk scans from the END (leaf-most) backwards. Build fixtures root-first/leaf-last (same convention T1
// established for test/transforms.test.ts). The non-message leaf is the LAST element in the crux fixture.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA H: do NOT change the append* wrappers' getLeafId capture (markers.ts appendRewindMarker/appendShrink/
// appendTurnMetric). That idiom (pi.appendEntry then getLeafId, same tick — C7) returns the MARKER's own id and is
// correct + unit-tested (test/markers.test.ts call-order tests). Only setCheckpoint's getLeafId use is wrong.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA I: edge-cases.test.ts:821 currently passes by ACCIDENT after the fix.
// Its makeCtx() default branch=[] → no-stable-entry → refusal text → the test's regex /refused|could not set/i
// matches, so it stays green. But it no longer exercises throwing-setLabel (setLabel is never reached). The hygiene
// edit (pass a stable-message branch) RESTORES the test's intent. Not a gate failure if skipped, but recommended.
// ────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

> N/A — no type changes. `SetCheckpointResult` (`{entryId:string} | {error:string}`, markers.ts:299) is unchanged;
> the new `{error:"no stable entry to checkpoint"}` is just a new value of the existing `error` string variant. The
> `setCheckpoint(pi, ctx, name)` signature is unchanged.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/markers.ts — setCheckpoint body (THE fix)
  - FILE: src/markers.ts (function @327-339)
  - CURRENT:
        export function setCheckpoint(
          pi: ExtensionAPI,
          ctx: ExtensionContext,
          name: string,
        ): SetCheckpointResult {
          try {
            const leafId = ctx.sessionManager.getLeafId();
            if (!leafId) return { error: "no leaf" };
            pi.setLabel(leafId, `mulligan:checkpoint:${name}`);
            return { entryId: leafId };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        }
  - REPLACE WITH:
        export function setCheckpoint(
          pi: ExtensionAPI,
          ctx: ExtensionContext,
          name: string,
        ): SetCheckpointResult {
          try {
            // BUG-003 fix: label the last REAL message entry, NOT the raw getLeafId() leaf.
            // After any Mulligan write the leaf is a non-context-producing entry (a `custom` marker / `label` /
            // note `custom_message`) that resolveCheckpoint CANNOT map (its walk filters to context-producing types
            // and refuses — "targetId labels a non-context-producing entry → null"). A transient no-role message is
            // also not a genuine turn. Walking getBranch() (ROOT→LEAF) BACKWARDS to the last `message` entry with a
            // real role guarantees a deterministic, always-mappable checkpoint anchor.
            const branch = ctx.sessionManager.getBranch();
            let stableId: string | null = null;
            for (let i = branch.length - 1; i >= 0; i--) {
              const e = branch[i];
              if (
                e.type === "message" &&
                e.message &&
                typeof e.message.role === "string" &&
                e.message.role.length > 0
              ) {
                stableId = e.id;
                break;
              }
            }
            if (!stableId) return { error: "no stable entry to checkpoint" };
            pi.setLabel(stableId, `mulligan:checkpoint:${name}`);
            return { entryId: stableId };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        }
  - WHY: GOTCHA A. `e.type === "message"` narrows the SessionEntry union so `e.message.role` type-checks (GOTCHA B).
         try/catch retained (GOTCHA D). The role guard defends the transient-message case (GOTCHA C).

Task 2: EDIT src/markers.ts — setCheckpoint JSDoc (Mode A, rides WITH the work)
  - FILE: src/markers.ts (JSDoc @306-326). Replace the summary line + the "Returns {...}" line + the step bullets.
  - EDIT 2a — summary line (≈306-307). CURRENT: `* setCheckpoint — label the current leaf as a named checkpoint (spec/04 §6, spec/05 §3; constraints C9, C1).`
    REPLACE WITH: `* setCheckpoint — label the last REAL message entry on the branch as a named checkpoint (spec/04 §6,
    * spec/05 §3; constraints C9, C1; BUG-003 fix).`
  - EDIT 2b — after the "Writes through pi.setLabel ... reads the target leaf id through ctx.sessionManager.getLeafId()"
    paragraph, REPLACE that paragraph with:
        * Anchor selection (BUG-003): the wrapper does NOT label `getLeafId()`. It walks
        * `ctx.sessionManager.getBranch()` (ROOT→LEAF) BACKWARDS to the last `message` entry whose `message.role` is a
        * non-empty string — a deterministic, always-context-producing, genuine conversation turn. `getLeafId()` after
        * any Mulligan write is a `custom`/`label`/note entry that `resolveCheckpoint` (spec/06 §6) cannot map (its walk
        * filters to context-producing types and refuses), which made checkpoint rewinds silently no-op. A transient
        * no-role message is also skipped by the role guard.
  - EDIT 2c — the "Returns {...}" line (≈317). CURRENT: `* Returns `{entryId: leafId}` on success, `{error: "no leaf"}` when `getLeafId()` is null (and does NOT call setLabel),
    * or `{error: <msg>}` on any thrown failure (try/catch). NEVER throws.`
    REPLACE WITH: `* Returns `{entryId: stableId}` (the labeled message entry id) on success; `{error: "no stable entry
    * to checkpoint"}` when the branch has no `message` entry with a real role (and does NOT call setLabel); or
    * `{error: <msg>}` on any thrown failure (try/catch — e.g. a throwing getBranch). NEVER throws.`

Task 3: EDIT src/tools/checkpoint.ts — 2 stale comments (ride-along accuracy)
  - EDIT 3a — line ≈110-113 (checkpointExecute JSDoc step 2). CURRENT:
        *   2. Delegate to `setCheckpoint(pi, ctx, name)` (markers.ts: null-checks getLeafId, prefixes with
        *      `mulligan:checkpoint:`, try/catches; trusts the caller's name).
    REPLACE WITH:
        *   2. Delegate to `setCheckpoint(pi, ctx, name)` (markers.ts: walks getBranch() to the last real message,
        *      prefixes with `mulligan:checkpoint:`, try/catches; trusts the caller's name).
  - EDIT 3b — line ≈113 (step 3b) AND line ≈147 (inline comment). Both say `{error:"no leaf"}`. CHANGE to
        `{error:"no stable entry to checkpoint"}`. (3b JSDoc: `On { error } (e.g. "no stable entry to checkpoint" or
        a swallowed setLabel throw)`; inline: `// (3b) wrapper-reported failure (e.g. {error:"no stable entry to
        checkpoint"} or a swallowed setLabel throw).`)

Task 4: EDIT test/markers.test.ts — makeCtx gains getBranch + update the 6 setCheckpoint tests + add crux test
  - EDIT 4a — makeCtx (@64-90). Add a `branch?: unknown[]` opt, a `throwOnGetBranch?: boolean` opt, a getBranch()
    method, and track "getBranch" in `calls`. Default branch (when `branch` undefined):
        const scriptedLeafId = opts.leafId === undefined ? "leaf-1" : opts.leafId;
        const defaultBranch =
          scriptedLeafId === null
            ? []   // no stable message → exercises the no-stable-entry path
            : [
                { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
                { type: "message", id: scriptedLeafId, parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
              ];
        const branch = opts.branch ?? defaultBranch;
    ADD to sessionManager:
        getBranch() { calls.push("getBranch"); if (opts.throwOnGetBranch) throw new Error("getBranch boom"); return branch; },
    (getSessionId/getLeafId UNCHANGED — the append* tests still use them; their `calls` sequences don't include
     getBranch because they never call it. See GOTCHA E/F.)
  - EDIT 4b — test @478 ("calls pi.setLabel once ... returns {entryId: leafId}"): assertions UNCHANGED
    (makeCtx({leafId:"leaf-9"}) → default branch ends in msg("leaf-9") → stableId "leaf-9"). Just verify it still
    passes; optionally tighten the test name to "...labels the last real message (entryId === its id)".
  - EDIT 4c — test @491 ("returns {error:'no leaf'} when getLeafId() is null"): change to
        it("returns {error:'no stable entry to checkpoint'} when the branch has no message, and does NOT call setLabel", () => {
          const { labels, pi } = makePi();
          const { ctx } = makeCtx({ leafId: null });   // → defaultBranch = [] (no stable message)
          const res = setCheckpoint(pi, ctx, "x");
          expect(res).toEqual({ error: "no stable entry to checkpoint" });
          expect(labels).toHaveLength(0);
        });
  - EDIT 4d — test @508 ("never throws — a throwing getLeafId"): change to "throwing getBranch":
        const { ctx } = makeCtx({ throwOnGetBranch: true });
        (keep the `expect(() => ...).not.toThrow()` + `{error:string}` assertions).
  - EDIT 4e — test @517-535 ("writes through pi.setLabel, reads through ctx.sessionManager.getLeafId"):
    rebuild the inline ctx to provide getBranch (returning a branch ending in msg("L","assistant")) and assert
    getBranch is called (NOT getLeafId). setLabel still via pi. Keep the C1/C9 split intent:
        const ctx = {
          sessionManager: {
            getBranch: () => { getBranchCalls.push("getBranch"); return [
              { type:"message", id:"u", parentId:null, timestamp:"t", message:{role:"user",content:[],timestamp:0} },
              { type:"message", id:"L", parentId:"u", timestamp:"t", message:{role:"assistant",content:[],timestamp:0} },
            ]; },
          },
        } as unknown as ExtensionContext;
        ...
        expect(setLabelCalls).toEqual(["setLabel:L:mulligan:checkpoint:n"]);
        expect(getBranchCalls).toEqual(["getBranch"]);
        expect(res).toEqual({ entryId: "L" });
  - EDIT 4f — ADD the crux test (the BUG-003 regression guard), inside the setCheckpoint describe block:
        it("labels the last real MESSAGE, not a non-message leaf (BUG-003): branch ending in a custom marker", () => {
          const { labels, pi } = makePi();
          const { ctx } = makeCtx({ branch: [
            { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
            { type: "message", id: "asst-7", parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
            { type: "custom", id: "marker-leaf", parentId: "asst-7", timestamp: "t", customType: "mulligan:rewind", data: {} },
          ]});
          const res = setCheckpoint(pi, ctx, "ckpt");
          expect(res).toEqual({ entryId: "asst-7" });      // the last real MESSAGE, NOT the custom leaf "marker-leaf"
          expect(labels[0].entryId).toBe("asst-7");
          expect(labels[0].label).toBe("mulligan:checkpoint:ckpt");
        });
  - EDIT 4g — test @541-542 (discriminated union expectTypeOf): UNCHANGED (it checks the TYPE, not the value;
    makeCtx().ctx → {entryId}; makeCtx({leafId:null}).ctx → branch=[] → {error}). Still passes.

Task 5: EDIT test/tools/checkpoint.test.ts — makeCtx gains getBranch + convert error-path tests + add crux test
  - EDIT 5a — makeCtx (@56-71). Replace the getLeafId-only body with a branch-driven fake:
        function makeCtx(opts: { branch?: unknown[]; throwOnGetBranch?: boolean } = {}) {
          const branch = opts.branch ?? [
            { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
            { type: "message", id: "leaf-1", parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
          ];
          const sessionManager = {
            getBranch() { if (opts.throwOnGetBranch) throw new Error("getBranch boom"); return branch; },
          };
          return { ctx: { sessionManager } as unknown as ExtensionContext };
        }
    (setCheckpoint no longer reads getLeafId, so the fake need not provide it. The default branch ends in
     msg("leaf-1","assistant") so tests using the default still anchor on "leaf-1".)
  - EDIT 5b — success tests @169-194 that passed `makeCtx({ leafId: "leaf-9" })`: change to pass an explicit branch
    ending in msg("leaf-9"), e.g. `makeCtx({ branch: [msgUser, msgEntry("leaf-9","assistant")] })`, OR add a small
    helper. (The makeCtx here no longer takes leafId — 5a removed it.) Keep the assertions (`entryId: "leaf-9"`,
    successText(...,"leaf-9"), `details.entryId === "leaf-9"`) UNCHANGED.
        // helper (add near the other helpers):
        function branchEndingInMsg(leafMsgId: string): unknown[] {
          return [
            { type:"message", id:"u1", parentId:null, timestamp:"t", message:{role:"user",content:[],timestamp:0} },
            { type:"message", id:leafMsgId, parentId:"u1", timestamp:"t", message:{role:"assistant",content:[],timestamp:0} },
          ];
        }
    Then: `makeCtx({ branch: branchEndingInMsg("leaf-9") })`, `makeCtx({ branch: branchEndingInMsg("leaf-42") })`,
    `makeCtx({ branch: branchEndingInMsg("L") })`.
  - EDIT 5c — no-leaf describe block @238-249 → "no-stable-entry refusal":
        describe("mulligan_checkpoint — no-stable-entry refusal (setCheckpoint returns {error:'no stable entry to checkpoint'})", () => {
          it("branch with no message → refusal text; setLabel NOT called", async () => {
            const { labels, pi } = makePi();
            const { ctx } = makeCtx({ branch: [] });   // empty branch → no stable message
            const res = await run(pi, ctx, "before-refactor");
            expect(labels).toHaveLength(0);
            expect(firstText(res)).toContain("Mulligan: refused —");
            expect(firstText(res)).toContain("could not set checkpoint");
            expect(firstText(res)).toContain("no stable entry to checkpoint");
            expect(res.details).toEqual({ name: "before-refactor" });
          });
        });
  - EDIT 5d — throwing-getLeafId test @267-273 → throwing-getBranch:
        const { ctx } = makeCtx({ throwOnGetBranch: true });
        (keep the `expect(run(...)).resolves.toBeDefined()` + refusal-text assertions).
  - EDIT 5e — result-shape test @300 ("refusal (no leaf)") → rename to "refusal (no stable entry)" and use
        `makeCtx({ branch: [] })`; assertions (content shape + details present) UNCHANGED.
  - EDIT 5f — ADD the crux test (BUG-003 regression guard) to the success-path describe block:
        it("labels the last real MESSAGE, not a non-message leaf (BUG-003)", async () => {
          const { labels, pi } = makePi();
          const { ctx } = makeCtx({ branch: [
            { type:"message", id:"u1", parentId:null, timestamp:"t", message:{role:"user",content:[],timestamp:0} },
            { type:"message", id:"asst-7", parentId:"u1", timestamp:"t", message:{role:"assistant",content:[],timestamp:0} },
            { type:"custom", id:"marker-leaf", parentId:"asst-7", timestamp:"t", customType:"mulligan:rewind", data:{} },
          ]});
          const res = await run(pi, ctx, "pre-experiment");
          expect(labels[0].entryId).toBe("asst-7");          // NOT the custom leaf
          expect(firstText(res)).toBe(successText("pre-experiment", "asst-7"));
          expect(res.details).toEqual({ name: "pre-experiment", entryId: "asst-7" });
        });
  - EDIT 5g — file header comment @12 (the case list): update case (d) from "no-leaf: leafId null → {error:'no leaf'}"
    to "no-stable-entry: empty branch → {error:'no stable entry to checkpoint'}", and @6 "scripts getLeafId" →
    "scripts getBranch".

Task 6 (RECOMMENDED hygiene): EDIT test/edge-cases.test.ts:821 — restore the throwing-setLabel test's intent
  - CURRENT: `const { ctx } = makeCtx();` (default branch=[] → no-stable-entry → setLabel never reached).
  - REPLACE WITH: `const { ctx } = makeCtx({ branch: [
        { type:"message", id:"u1", parentId:null, timestamp:"t", message:{role:"user",content:[],timestamp:0} },
        { type:"message", id:"leaf-1", parentId:"u1", timestamp:"t", message:{role:"assistant",content:[],timestamp:0} },
      ] });`
  - WHY (GOTCHA I): with a stable-message branch, setCheckpoint reaches setLabel, which throws (throwOnSetLabel) →
    swallowed → {error} → refusal text. The test then genuinely exercises its claimed path again. (The existing
    regex /refused|could not set/i still matches either way, so this is intent-restoration, not a gate fix.)
  - edge-cases.test.ts makeCtx (@177) already supports `branch` — no makeCtx change needed there.

Task 7: VALIDATE — run the gates in the Validation Loop. No further edits.
```

### Implementation Patterns & Key Details

```ts
// ── THE fix: walk getBranch() (ROOT→LEAF) BACKWARDS to the last real message ──
const branch = ctx.sessionManager.getBranch();      // SessionEntry[], root→leaf (getBranch() order)
let stableId: string | null = null;
for (let i = branch.length - 1; i >= 0; i--) {       // leaf→root scan: most-recent real message wins
  const e = branch[i];
  if (e.type === "message" && e.message              // `e.type === "message"` narrows the union (GOTCHA B)
      && typeof e.message.role === "string" && e.message.role.length > 0) {   // GOTCHA C: skip transient/no-role
    stableId = e.id; break;
  }
}
if (!stableId) return { error: "no stable entry to checkpoint" };
pi.setLabel(stableId, `mulligan:checkpoint:${name}`);
return { entryId: stableId };

// PATTERN: why resolveCheckpoint NEEDS a `message` anchor (transforms.ts step 4):
//   ctxEntries = branchEntries.filter(isContextProducingType)   // message/custom_message/branch_summary/compaction
//   … walk … if (e.id === targetId) { found = true; … }
//   if (!found) return null;   // ← a `custom`/`label` targetId is filtered out → no-op (BUG-003)
// Labeling a `message` guarantees found=true. (GOTCHA A)

// PATTERN: makeCtx default branch == [user-msg, assistant-msg(id=leafId)] keeps existing success assertions valid
//   with ZERO value churn — the stable anchor id equals the old scripted leafId. (GOTCHA F)

// ANTI-PATTERN (do NOT):
//   - const leafId = ctx.sessionManager.getLeafId();           // THE BUG — labels a non-message leaf (GOTCHA A)
//   - return { error: "no leaf" };                             // replaced by "no stable entry to checkpoint"
//   - drop the try/catch                                       // NEVER throws is contract (GOTCHA D)
//   - touch resolveCheckpoint / filterPipeline / transforms.ts // T1 (done) + T3 (next) own those
//   - change SetCheckpointResult or the setCheckpoint signature // unchanged
//   - change the append* wrappers' getLeafId capture           // correct + unrelated (GOTCHA H)
//   - forget test/markers.test.ts                              // REQUIRED, breaks without it (GOTCHA E)
```

### Integration Points

```yaml
NO INTEGRATION / SIGNATURE CHANGES:
  - setCheckpoint(pi, ctx, name): SetCheckpointResult — UNCHANGED signature.
  - SetCheckpointResult ({entryId:string}|{error:string}) — UNCHANGED type; new error value only.
  - checkpoint.ts checkpointExecute — UNCHANGED logic (forwards res.error generically); 2 comment fixes only.
  - resolveCheckpoint / filterPipeline / filter.ts:184 caller — UNCHANGED (post-T1).
DOWNSTREAM ENABLED:
  - P1.M1.T3.S1 (orphan-snap): resolveCheckpoint will snap the (now-correctly-mapped) iTarget to a unit boundary
    so a checkpointed assistant message's toolResult isn't orphaned. Depends on a CORRECT iTarget, which requires
    a `message` anchor — i.e. THIS fix.
  - P1.M3.T1.S1 (checkpoint permanent-hiding regression tests) + P1.M3.T2.S1 (F-checkpoint smoke): assert hiding
    actually occurs; only meaningful once labeling (this) + walk (T1) are both fixed.
```

---

## Validation Loop

### Level 1: Syntax & Style (after Task 1)

```bash
# Type-check (tsc is the project's only static gate). The `e.type === "message"` discriminant narrows the union
# so e.message.role type-checks under strict; if tsc errors here, you dropped the discriminant (GOTCHA B).
npx tsc --noEmit -p tsconfig.json
# Expected: zero errors.
```

### Level 2: Unit Tests (the core proof)

```bash
# The two test files that exercise setCheckpoint directly:
npx vitest run test/markers.test.ts -t "setCheckpoint"      # the 6 direct tests + the new crux test → green
npx vitest run test/tools/checkpoint.test.ts               # all checkpoint tool tests → green

# THE regression guard — confirm the fix changes behavior on the non-message-leaf case:
npx vitest run test/markers.test.ts -t "labels the last real MESSAGE"      # the crux test → 1 passed
npx vitest run test/tools/checkpoint.test.ts -t "labels the last real MESSAGE"  # → 1 passed
# (These FAIL on the old code — they label "marker-leaf" — and PASS on the fixed code.)

# Full suite — confirm no regressions (resolveCheckpoint, filter, rewind, edge-cases all green):
npm test
# Expected: all green. If markers.test.ts or checkpoint.test.ts fail, a makeCtx wasn't given getBranch (GOTCHA E)
# or a success test still passes an old leafId-without-branch (Task 5b). If edge-cases.test.ts:821 was NOT edited
# (Task 6 skipped) it still passes by regex accident — acceptable, but Task 6 restores its intent.
```

### Level 3: Integration Testing

> N/A for this unit-level fix. The smoke harness (F-checkpoint) is enhanced in P1.M3.T2.S1, not here. Do NOT run
> the smoke harness as an S1 gate — its current assertions check marker persistence, not hiding (a known gap fixed
> by a later subtask). The fix is proven by the Level 2 crux tests + the post-T1 resolveCheckpoint contract.

### Level 4: Targeted correctness probe (optional)

```bash
# Confirm the old error string is gone from setCheckpoint and its tool comments:
grep -rn "no leaf" src/markers.ts src/tools/checkpoint.ts
# Expected: NO output (the only remaining "no leaf" in the repo is markers.ts ~line 159 append-wrapper prose and
# shrink.ts ~line 121 — both describe the append* wrappers' null-leaf return, NOT setCheckpoint). If "no leaf"
# appears in a setCheckpoint context, an edit was missed.

# Confirm setCheckpoint no longer calls getLeafId:
grep -n "getLeafId" src/markers.ts
# Expected: matches ONLY in the append* wrappers (appendRewindMarker/appendShrinkMarker/appendTurnMetric) — NOT in
# setCheckpoint. (GOTCHA H.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` → zero errors.
- [ ] `npx vitest run test/markers.test.ts -t "setCheckpoint"` → green (incl. the crux test).
- [ ] `npx vitest run test/tools/checkpoint.test.ts` → green (incl. the crux test).
- [ ] `npm test` → full suite green.
- [ ] `grep -rn "no leaf" src/markers.ts src/tools/checkpoint.ts` → no setCheckpoint-related matches.

### Feature Validation (the fix)
- [ ] `setCheckpoint` body calls `ctx.sessionManager.getBranch()` and contains NO `getLeafId()` call.
- [ ] It walks the branch backwards (high-index→0) and labels the first `message` entry with a non-empty role.
- [ ] Returns `{error:"no stable entry to checkpoint"}` when no such entry exists (and does NOT call setLabel).
- [ ] Crux tests (both files) assert a non-message leaf → labels the earlier message id, NOT the leaf.
- [ ] try/catch retained; a throwing getBranch → `{error}` (never throws).

### Code Quality Validation
- [ ] setCheckpoint JSDoc (Mode A) documents the stable-entry walk + the new error string (Task 2).
- [ ] checkpoint.ts comments (@113, @147) no longer say "null-checks getLeafId" / "{error:'no leaf'}" (Task 3).
- [ ] test/markers.test.ts makeCtx provides getBranch WITHOUT disturbing the append* tests' `calls` sequences (GOTCHA E).
- [ ] test branch fixtures are ROOT→LEAF (GOTCHA G), consistent with T1's transforms.test.ts convention.
- [ ] No changes outside the named edit sites (resolveCheckpoint, filterPipeline, transforms.ts, index.ts, spec/ untouched).

### Documentation & Deployment
- [ ] Mode-A JSDoc rides WITH the work (Task 2). No new env vars, no config changes, no spec-doc edits.

---

## Anti-Patterns to Avoid

- ❌ Don't keep `getLeafId()` in setCheckpoint — it IS the bug (GOTCHA A). Label the last real `message` via getBranch.
- ❌ Don't drop the `e.type === "message"` discriminant — it's required for the type-check (GOTCHA B) AND the logic.
- ❌ Don't drop the try/catch — NEVER-throws is the contract (GOTCHA D); a throwing getBranch must stay swallowed.
- ❌ Don't touch `resolveCheckpoint`/`filterPipeline`/`transforms.ts` — T1 (done) owns the walk, T3 owns orphan-snap.
- ❌ Don't change `SetCheckpointResult` or the `setCheckpoint(pi,ctx,name)` signature — unchanged.
- ❌ Don't change the append* wrappers' `getLeafId` capture — correct + unrelated (GOTCHA H); only setCheckpoint is wrong.
- ❌ Don't omit `test/markers.test.ts` — it has 6 DIRECT setCheckpoint tests that break without the makeCtx update
  (GOTCHA E). The item names only checkpoint.test.ts, but a green suite REQUIRES markers.test.ts too.
- ❌ Don't change test ASSERTIONS that are still valid — only the makeCtx fake + the two error-path tests + the new
  crux test. Success assertions stay valid because the default branch ends in a message whose id == leafId (GOTCHA F).
- ❌ Don't build branch fixtures leaf-first — ROOT→LEAF (GOTCHA G), matching getBranch()/T1.
- ❌ Don't modify `PRD.md`, `tasks.json`, `prd_snapshot.md`, `.gitignore`, or any `spec/` file (PRP rules; spec/06 is
  P1.M4.T1's). This subtask edits only the 2 src files + 3 test files named above.

---

## Confidence Score: 9/10

The fix is one function (~12 lines) with verbatim old→new code, grounded in the decisive `resolveCheckpoint` step-4
`found=false` mechanism. The full blast radius is enumerated by grep: 2 src files (1 fix + comments) + 3 test files
(2 REQUIRED, 1 hygiene). The crux tests (non-message leaf → labels last message) are precise regression guards that
FAIL on the old code and PASS on the fixed code. The −1 reserves for the makeCtx-shared-with-append*-tests risk in
`test/markers.test.ts` (GOTCHA E): adding getBranch must not perturb the call-order assertions of the unrelated
append-wrapper tests — the Level-2 full-suite gate catches any such regression immediately with a clear diff.