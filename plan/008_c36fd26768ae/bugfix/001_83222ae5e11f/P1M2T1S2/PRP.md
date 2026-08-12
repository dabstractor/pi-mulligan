---
name: "P1.M2.T1.S2 (BUG-002) — extract checkpoint-rebuild into shared helper + convert F-revert-reload to verify the production path (remove manual simulation)"
description: >
  BUG-002 test-hardening + helper extraction. P1.M2.T1.S1 added the checkpoint-snapshot rebuild INLINE in
  src/index.ts session_start. This task EXTRACTS that inline block into an EXPORTED helper
  `rebuildCheckpointSnapshots(ctx, rt)` in src/capture.ts — mirroring the exact `gcTurnSnapshots` precedent
  (also exported from capture.ts, also called by both session_start and the test) — so the F-revert-reload
  integration test (test/integration/revert-edge.test.ts ~lines 601-619) can STOP manually simulating the
  rebuild and instead CALL THE SAME PRODUCTION CODE. The test's "production NEVER does this read-side"
  comment becomes "production DOES this now (BUG-002 fixed)". Behavior-preserving refactor of S1's freshly
  written inline code + the test conversion. Depends on S1 being implemented first.
---

## Goal

**Feature Goal**: Make the F-revert-reload integration test verify the **production** cross-reload
rebuild path instead of a test-only manual simulation. Today (after S1) the production rebuild EXISTS
(inline in `src/index.ts` session_start) but the test still does its OWN hand-rolled
`rt2.snapshots.set(...)` loop — so CI proves the control *data* is durable, NOT that *production* reads it.
After this task the test calls the **same exported helper** production calls, and the helper is the single
source of truth. The task TITLE — "verify production rebuild path (REMOVE manual simulation)" — is satisfied
by approach (a): extract the rebuild into `capture.ts` and have both callers use it.

**Deliverable**: A behavior-preserving **extract-method refactor** across three files plus a focused unit-test
addition:
1. **src/capture.ts** — NEW exported `rebuildCheckpointSnapshots(ctx, rt)` helper (the body is S1's inline
   rebuild, moved verbatim + JSDoc citing spec/14 §5 / E32 / BUG-002). No new imports.
2. **src/index.ts** — S1's inline rebuild block becomes a ONE-LINE call `await rebuildCheckpointSnapshots(ctx, rt);`;
   `rebuildCheckpointSnapshots` is added to the `./capture.js` import block.
3. **test/integration/revert-edge.test.ts** — the manual rebuild block (~lines 601-619) is REMOVED; in its
   place `await rebuildCheckpointSnapshots(ctx, rt2);` calls the production helper. The comment flips from
   "Production NEVER does this read-side" to "production DOES this now". The assertion `rt2.snapshots.get("ckpt:x")`
   is now populated by PRODUCTION code, not by a test replica. `rebuildCheckpointSnapshots` is added to the
   capture.ts import.
4. **test/capture.test.ts** (recommended) — a new `describe("rebuildCheckpointSnapshots — …")` unit-test block
   mirroring the existing `gcTurnSnapshots` unit tests (happy-path, no-store no-op, malformed entry skipped,
   `has()===false` skipped, throwing-Proxy entry skipped). This is the direct precedent and pins the helper's
   fail-open guarantees independently of the git-requiring integration test.

**Success Definition**:
- The F-revert-reload test NO LONGER contains the manual `controlEntries`-filter + `for (const ce …) rt2.snapshots!.set(…)`
  block. It calls `rebuildCheckpointSnapshots(ctx, rt2)` and asserts `rt2.snapshots.get("ckpt:x")` is a
  populated `RevertCheckpoint` (beforeRef===R0, backend==="git", turnIndex===-1) — produced by the SAME
  helper `session_start` calls.
- `session_start` in `src/index.ts` calls `await rebuildCheckpointSnapshots(ctx, rt)` (no inline loop remains);
  behavior is unchanged (the helper IS the inline code, moved).
- The helper is exported from `src/capture.ts` and imported by BOTH `src/index.ts` and the test (single source of truth).
- `npm run typecheck` clean; `npm test` green (1277+ tests); `npx vitest run test/integration/revert-edge.test.ts` green.
- The helper's fail-open guarantees (skip malformed entries, skip `has()===false`/NoOpStore refs, never throw)
  are unit-tested in `test/capture.test.ts` (mirrors the `gcTurnSnapshots` block).

## User Persona

**Target User**: The Mulligan maintainer (and CI). After this task, the E32 cross-reload durability claim is
backed by a test that exercises the **real** production read-path, not a parallel simulation. A future
regression that breaks `session_start`'s rebuild will FAIL CI instead of passing behind a stale test replica.

**Use Case**: Regression-proofing the BUG-002 fix. The previous test gave false confidence (it passed because
it did production's job for it); this task closes that hole.

**Pain Points Addressed**: Test/production divergence — two copies of the rebuild logic that can silently
drift (the exact failure mode that let BUG-002 ship in the first place).

## Why

- **The shipped test gave false confidence** (the root cause of how BUG-002 slipped past CI). Its own comment
  said verbatim: *"REBUILD rt2.snapshots from the persisted mulligan:revert-checkpoint control entries.
  Production NEVER does this read-side — it is the BUG-002 gap tracked by P1.M2.T1"*. S1 fixed production;
  S2 fixes the test so it can never again mask a production regression.
- **Single source of truth.** Two copies of the entry-scan + reconstruction logic (one inline in index.ts,
  one in the test) will drift. Extracting one exported helper called by both eliminates the divergence.
- **Exact codebase precedent.** `gcTurnSnapshots(rt)` is **already** an exported capture.ts helper called by
  BOTH session_start (`index.ts:125`) and the test (`revert-edge.test.ts:600`), and unit-tested in its own
  `describe` block (`capture.test.ts:371`). `rebuildCheckpointSnapshots` is the same shape — it additionally
  takes `ctx` because it reads `getEntries()`. Low risk: a known-good pattern.
- **Small + behavior-preserving.** No new types, no new logic, no config/API/docs surface. The production
  rebuild body moves file-to-file unchanged; index.ts shrinks to a one-line call; the test swaps a loop for a
  call.

## What

User-visible behavior: NONE (no config, no API, no docs surface). The bug was already fixed by S1; this task
only hardens the test and de-duplicates the logic.

Internal changes:
1. **`src/capture.ts`** gains an exported async helper `rebuildCheckpointSnapshots(ctx, rt)` whose body is
   S1's inline rebuild (defensive entry-scan mirroring `clearCheckpointByName`, customType filter, field
   guards, optional `rt.store.has(ref)` verify with fail-open, `rt.snapshots?.set(label, {...})` with
   `turnIndex:-1` / no afterRef). Wrapped so it never throws.
2. **`src/index.ts`** session_start: the inline rebuild block (added by S1 after `await gcTurnSnapshots(rt);`)
   is replaced by `await rebuildCheckpointSnapshots(ctx, rt);`. The capture.ts import gains `rebuildCheckpointSnapshots`.
3. **`test/integration/revert-edge.test.ts`**: the manual rebuild block (~lines 601-619) is deleted; the call
   `await rebuildCheckpointSnapshots(ctx, rt2);` is inserted after `await gcTurnSnapshots(rt2);` (and before the
   assertion of `rt2.snapshots.get("ckpt:x")`). The comment is rewritten. The capture.ts import gains the helper.
4. **`test/capture.test.ts`** (recommended): a new `describe("rebuildCheckpointSnapshots — …")` block with
   happy-path + fail-open unit cases, mirroring the gcTurnSnapshots unit tests.

### Success Criteria

- [ ] `src/capture.ts` exports `rebuildCheckpointSnapshots(ctx: ExtensionContext, rt: SessionRuntime): Promise<void>`.
- [ ] `src/index.ts` session_start calls the helper (no inline rebuild loop remains); `git grep -n "revert-checkpoint" src/index.ts` shows ZERO entry-scan/`set(` logic (only the helper call + the existing JSDoc).
- [ ] The helper body is S1's inline rebuild, moved verbatim (defensive idiom + field guards + has() verify + turnIndex:-1 + no afterRef).
- [ ] `test/integration/revert-edge.test.ts` no longer contains the `controlEntries`-filter loop or any `rt2.snapshots!.set(...)` rebuild; it calls `await rebuildCheckpointSnapshots(ctx, rt2);`.
- [ ] The test asserts `rt2.snapshots?.get("ckpt:x")` is truthy with `beforeRef===R0` + `backend==="git"` — populated by the production helper.
- [ ] The test comment reads (paraphrased) "production DOES this now (BUG-002 fixed via rebuildCheckpointSnapshots)", NOT "production NEVER does this".
- [ ] `test/capture.test.ts` has a `describe("rebuildCheckpointSnapshots")` block covering: happy-path rebuild, no-store no-op, malformed-entry skip, `has()===false`/NoOpStore skip, throwing-Proxy-entry skip.
- [ ] `npm run typecheck` clean; `npm test` green; `npx vitest run test/integration/revert-edge.test.ts` green.
- [ ] NO behavior change: `git diff src/` is a pure extract-method refactor (index.ts shrinks, capture.ts grows by the same code).

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact precedent
(`gcTurnSnapshots`), the exact file to add the helper (`src/capture.ts`, with both `ExtensionContext` + `SessionRuntime`
already imported), the exact inline block to extract (S1's PRP provides it verbatim), the exact test block to
delete (~lines 601-619), the exact assertion to keep, the exact fake-semantics proof (makeSessionCtx returns
`appended: entries` and `getEntries()` returns the same `entries`), and the exact unit-test precedent
(`capture.test.ts:371-452`) are all specified. The implementer needs `src/capture.ts`, `src/index.ts`,
`test/integration/revert-edge.test.ts`, `test/capture.test.ts`, and S1's PRP — no spec archaeology required.

### Documentation & References

```yaml
# MUST READ — the authoritative sibling PRP whose inline code this task EXTRACTS
- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M2T1S1/PRP.md
  why: "S1 added the checkpoint-rebuild INLINE in index.ts session_start (after gcTurnSnapshots). Its
        'Implementation Blueprint → Task 1 → INSERT (exact code)' block contains the VERBATIM rebuild body
        (Array.isArray guard → per-entry object guard → try/catch → customType filter → typeof field guards
        → has() verify → rt.snapshots?.set(label, {label, backend, beforeRef, turnIndex:-1, ts}) ). THAT is
        the code to move into capture.ts unchanged. S1's GOTCHA #4 explicitly defers the test conversion to S2."
  section: "Implementation Blueprint → Task 1 (INSERT exact code) + Task 2 (JSDoc) + GOTCHA #4"
  critical: "The body is the SINGLE source of truth for the rebuild logic. Do NOT reimplement it; copy it
             verbatim into the helper. The helper's signature adds `ctx: ExtensionContext` (first param) so it
             can read `ctx.sessionManager.getEntries()`; the rest is identical."

# MUST READ — the precedent being mirrored (exported capture.ts helper, dual caller)
- file: src/capture.ts
  why: "`gcTurnSnapshots(rt: SessionRuntime)` (line 59, exported) is called by session_start (index.ts:125)
        AND by the test (revert-edge.test.ts:600), and is unit-tested in capture.test.ts:371. The new
        `rebuildCheckpointSnapshots(ctx, rt)` is the SAME shape (it additionally takes ctx for getEntries).
        Follow gcTurnSnapshots's JSDoc style, its `if (!rt.store) return;` self-gate, and its try/catch-wrapped
        body. NOTE: rebuildCheckpointSnapshots also self-gates on rt.store being set (it needs rt.store.has())."
  section: "gcTurnSnapshots (line 49-68)"
  pattern: "Exported async helper taking SessionRuntime (+ ctx here), full JSDoc citing spec/14 §5 + E-series,
            fail-open (never throws), called by BOTH session_start and the test. Mirror it precisely."

# MUST READ — the session_start handler whose inline block is replaced by a one-line call
- file: src/index.ts
  why: "session_start (lines ~107-128) is the ONLY production caller. After S1 it contains the inline rebuild
        inside `if (!getConfig().revert.enabled) { try { … await gcTurnSnapshots(rt); /* S1 inline rebuild */ }
        catch {...} }`. This task replaces the inline block with `await rebuildCheckpointSnapshots(ctx, rt);`.
        `ctx` and `rt` are BOTH already in the session_start closure scope (ctx is the handler's 2nd arg; rt
        comes from getRuntime(sid)). The capture.ts import block is at line ~16 (`gcTurnSnapshots,`)."
  gotcha: "The rebuild call MUST stay INSIDE the existing try block, AFTER `await gcTurnSnapshots(rt);`
           (same ordering invariant as S1: checkpoint refs must survive gc before has() confirms them). Do NOT
           move it or add a new try/catch wrapper."

# MUST READ — the WRITE site (confirms the persisted control-entry shape the helper reconstructs)
- file: src/commands.ts
  why: "makeCheckpointCommand step 4b (~line 226) writes `pi.appendEntry(\"mulligan:revert-checkpoint\",
        { label, ref, backend })`. The helper reconstructs EXACTLY this shape. The `clearCheckpointByName`
        function (~lines 120-145) is the canonical defensive getEntries()-scan idiom the helper mirrors
        (Array.isArray guard → per-entry object guard → try/catch per entry). S1's inline code already copied
        it; the helper keeps that copy verbatim."
  section: "makeCheckpointCommand step 4b (~226); clearCheckpointByName (~120-145)"

# MUST READ — the test file being converted (the manual block to remove + the assertion to keep)
- file: test/integration/revert-edge.test.ts
  why: "F-revert-reload (it starts ~line 445). The manual rebuild block is ~lines 601-619: a comment
        ('REBUILD rt2.snapshots … Production NEVER does this read-side …'), a `controlEntries` filter, a
        `for (const ce of controlEntries) rt2.snapshots!.set(ce.data.label, {…})` loop, then the assertions
        (`rt2.snapshots?.get(\"ckpt:x\")` truthy + beforeRef===R0 + backend==='git'). REMOVE the comment +
        filter + loop; INSERT `await rebuildCheckpointSnapshots(ctx, rt2);` in their place (after
        `await gcTurnSnapshots(rt2);` at line ~600); KEEP the assertions. The capture.ts import is lines 52-55."
  critical: "makeSessionCtx (lines ~206-248) returns `appended: entries` (the SHARED array) and
             `sessionManager.getEntries()` returns the SAME `entries`. So the helper reading
             ctx.sessionManager.getEntries() sees IDENTICAL data to the manual `appended`-filter loop it
             replaces. This is the correctness proof that the swap is behavior-equivalent."

# MUST READ — the unit-test precedent (add a parallel describe block here)
- file: test/capture.test.ts
  why: "`describe(\"gcTurnSnapshots — shared prompt-boundary GC helper\")` (lines 371-452) is the EXACT pattern
        for a `describe(\"rebuildCheckpointSnapshots — …\")` block: hand-rolled `makeStore()` + `getRuntime()`
        fakes (NO vi.fn()), it-cases for happy-path / no-store / skip-on-condition / never-throw. Mirror it."
  pattern: "makeStore({hasResult?, hasThrows?}) fake → getRuntime(id) → rt.store=store → set up entries via a
            fake ctx (sessionManager.getEntries returns an array) → call helper → assert rt.snapshots state."
  gotcha: "The helper needs a `ctx` with `sessionManager.getEntries()`. capture.test.ts's existing makePi/makeCtx
           fakes may not expose getEntries returning a controllable array — build a MINIMAL inline fake ctx for
            this describe block (a plain object `{ sessionManager: { getEntries: () => fixture } }` cast to
            ExtensionContext), exactly as revert-edge.test.ts's makeCtx does."

# The interface + runtime types (no change; the helper constructs/uses these)
- file: src/markers.ts
  why: "`export interface RevertCheckpoint { label: string; backend: \"git\"|\"cas\"; beforeRef: string;
        afterRef?: string; turnIndex: number; ts: number; }` (line 121). The helper constructs members of it
        (NO afterRef — checkpoints capture once). The Map value type is `RevertCheckpoint`."
- file: src/runtime.ts
  why: "`snapshots?: Map<string, RevertCheckpoint>` (line 123); `store?: SnapshotStore` (line 132). The helper
        reads rt.store.has(ref) + rt.snapshots.set(...). Use `rt.snapshots?.set(...)` (optional chaining)."

# Spec authority (background — the contract S1 finally satisfied, which S2 now regression-tests)
- file: spec/14-working-tree-revert.md
  why: "§5 (capture lifecycle & retention) + E32 ('post-reload snapshot loss → RESOLVED in v1.2') are the
        contract. S1 made it true in production; S2 makes the test prove it via the production code path."
  section: "§5 Capture lifecycle & retention; spec/08 E32"

# Root-cause analysis
- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  why: "§BUG-002 'Existing Test Impact': the F-revert-reload test 'manually simulates the rebuild with a
        comment … This manual simulation must be removed and replaced with a test that verifies the production
        rebuild path works.' THIS task is that replacement."
```

### Current Codebase tree (the slice that matters)

```bash
src/
├── capture.ts          # <-- ADD rebuildCheckpointSnapshots (exported helper, after gcTurnSnapshots)
├── index.ts            # <-- REFACTOR: inline rebuild → one-line call; +import
├── commands.ts         # READ-ONLY — clearCheckpointByName idiom (the defensive scan source)
├── markers.ts          # READ-ONLY — RevertCheckpoint interface
├── runtime.ts          # READ-ONLY — SessionRuntime.snapshots? + .store?
└── snapshot/store.ts   # READ-ONLY — SnapshotStore.has() (NoOpStore→false)
test/
├── integration/
│   └── revert-edge.test.ts  # <-- CONVERT: remove manual rebuild (601-619); call helper; +import
└── capture.test.ts          # <-- ADD describe("rebuildCheckpointSnapshots") unit block (recommended)
```

### Desired Codebase tree (files this task changes)

```bash
src/
├── capture.ts          # MODIFIED: +exported rebuildCheckpointSnapshots(ctx, rt) helper + JSDoc
└── index.ts            # MODIFIED: inline rebuild → `await rebuildCheckpointSnapshots(ctx, rt);` + import
test/
├── integration/
│   └── revert-edge.test.ts  # MODIFIED: remove manual rebuild block; call helper; rewrite comment; + import
└── capture.test.ts          # MODIFIED: +describe("rebuildCheckpointSnapshots") unit-test block
# (no new files; no config/api/docs surface)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — DEPENDS ON S1. S1 (P1.M2.T1.S1) added the rebuild INLINE in src/index.ts session_start. This
// task EXTRACTS it. If S1 is NOT yet implemented, this task CANNOT proceed — confirm the inline block exists
// (grep `revert-checkpoint` in src/index.ts shows the scan loop) before editing. If S1 landed with a slightly
// different shape, COPY S1's ACTUAL inline body into the helper verbatim (do not re-derive it).

// GOTCHA #2 — the helper signature is (ctx, rt), NOT (rt) like gcTurnSnapshots. It MUST read
// ctx.sessionManager.getEntries() (the persisted control entries). ctx is the FIRST param so the call site
// reads naturally: `await rebuildCheckpointSnapshots(ctx, rt)`. Both ExtensionContext and SessionRuntime are
// ALREADY imported in capture.ts — NO new imports.

// GOTCHA #3 — KEEP the defensive entry-scan idiom VERBATIM from S1 (which copied clearCheckpointByName,
// commands.ts ~120-145): getEntries() in try/catch (fail-open) → Array.isArray guard → per-entry
// `typeof e !== "object" || e === null || Array.isArray(e)` → per-entry try/catch (throwing-Proxy → skip) →
// customType filter → typeof field guards (label/ref non-empty strings; backend literal "git"|"cas"). Do NOT
// import readOwn/isRecord (module-private in filter.ts) — inline guards only, exactly like S1/clearCheckpointByName.

// GOTCHA #4 — ORDER: the helper is called AFTER gcTurnSnapshots(rt) in BOTH session_start and the test.
// gcTurnSnapshots drops turn/* refs but EXEMPTS ckpt:* — so the rebuilt checkpoint refs survive for the
// helper's has() verify. Do not change the call order in either caller.

// GOTCHA #5 — has() verify is fail-open: `let present = true; try { present = await rt.store!.has(d.ref); }
// catch { present = false; } if (!present) continue;`. NoOpStore.has→false ⇒ entry skipped (backend 'none' ⇒
// nothing to restore — correct). rt.store is guaranteed set when the helper runs (session_start: detectAndCreate
// ran first; test: rt2.store = store2 assigned before the call). Use rt.store! or guard `if (!rt.store) return;`
// at the helper top (mirror gcTurnSnapshots's `if (!rt.store) return;` self-gate).

// GOTCHA #6 — the reconstructed RevertCheckpoint has NO afterRef (checkpoints capture once) + turnIndex:-1
// (sentinel) + ts:Date.now(). The label key is data.label (already namespaced "ckpt:<name>" at write time) —
// set under the SAME key the rewind tool looks up. The persisted data is { label, ref, backend } → map
// beforeRef←data.ref. This is identical to S1; do not change the mapping.

// GOTCHA #7 — makeSessionCtx (revert-edge.test.ts ~206-248) returns `appended: entries` AND its
// sessionManager.getEntries() returns the SAME `entries`. So replacing the manual `appended`-filter loop with
// `await rebuildCheckpointSnapshots(ctx, rt2)` is BEHAVIOR-EQUIVALENT — the helper reads the identical array.
// This is the proof the conversion is safe. Do NOT also keep the manual loop "just in case".

// GOTCHA #8 — the test's manual rebuild references the `appended` array via the makeSessionCtx destructure
// (`const { appended, pi, ctx } = makeSessionCtx(...)`). After removing the loop, `appended` is still used
// later in the test (the rewound-IDs splice at ~line 585 and the marker scan near the end). So keep the
// destructure — only remove the controlEntries rebuild block. Do NOT remove the `appended` binding.

// GOTCHA #9 — the new call in the test goes BETWEEN `await gcTurnSnapshots(rt2);` (line ~600) and the
// `// ASSERT the rebuilt snapshot restored ckpt:x's beforeRef === R0.` assertion block. Keep the assertion
// block intact (it now asserts production populated the snapshot). Only the comment above the old manual
// loop + the loop itself are removed/replaced.

// GOTCHA #10 — NO ruff/mypy/eslint (those are Python/template tools). Gates are `npm run typecheck`
// (tsc --noEmit, strict) + `npm test` (vitest run). Do NOT add or run any other linter.

// GOTCHA #11 — capture.test.ts's existing fakes (makePi/makeCtx) may not give a controllable getEntries().
// For the new describe block, build a MINIMAL inline fake ctx: `const ctx = { sessionManager: { getEntries:
// () => fixture } } as unknown as ExtensionContext;` (mirror revert-edge.test.ts makeCtx's minimal shape).
// The helper only reads ctx.sessionManager.getEntries() — nothing else on ctx.
```

## Implementation Blueprint

### Data models and structure

No new data models. The helper constructs members of the existing exported `RevertCheckpoint` interface
(src/markers.ts:121) from the persisted control-entry data — identical to S1's inline reconstruction:

```typescript
// Persisted (commands.ts ~226 — pi.appendEntry 2nd arg):
//   { label: "ckpt:<name>", ref: <captured sha>, backend: "git" | "cas" }
//
// Reconstructed RevertCheckpoint (markers.ts:121) — IDENTICAL to S1:
//   { label: data.label, backend: data.backend, beforeRef: data.ref, turnIndex: -1, ts: Date.now() }
//   // afterRef OMITTED (checkpoints capture once) — required by the BUG-001 fix (rewind.ts step 6b).
```

### Implementation Tasks (ordered by dependencies)

```yaml
PREREQUISITE: confirm S1 (P1.M2.T1.S1) is implemented. `grep -n "revert-checkpoint" src/index.ts` MUST show
  the inline rebuild scan loop inside session_start. If absent, S1 has not landed — STOP and surface it
  (this task extracts S1's inline code; without it there is nothing to extract). If present, note S1's exact
  inline body and COPY it verbatim into Task 1.

Task 1: ADD the exported helper to src/capture.ts
  - PLACEMENT: immediately AFTER gcTurnSnapshots (line ~68) and BEFORE turnStartCaptureHandler — keep the
    "shared helpers" cluster together (gcTurnSnapshots + rebuildCheckpointSnapshots are the two reused passes).
  - SIGNATURE: `export async function rebuildCheckpointSnapshots(ctx: ExtensionContext, rt: SessionRuntime): Promise<void>`
  - BODY: S1's inline rebuild, moved VERBATIM (do NOT re-derive it). Structure:
        // [P1.M2.T1.S1/S2 / spec/14 §5 / E32 / BUG-002] rebuild rt.snapshots from the persisted
        // mulligan:revert-checkpoint control entries that /mulligan_checkpoint wrote (commands.ts step 4b).
        // (full JSDoc — see Task 1b)
        if (!rt.store) return; // self-gate (mirror gcTurnSnapshots) — no store ⇒ nothing to verify/set
        let entries: unknown;
        try { entries = ctx.sessionManager.getEntries(); } catch { return; } // fail-open read (C12 fresh)
        if (!Array.isArray(entries)) return;
        for (const e of entries) {
          if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
          try {
            const ee = e as { type?: unknown; customType?: unknown; data?: unknown };
            if (ee.type !== "custom" || ee.customType !== "mulligan:revert-checkpoint") continue;
            const data = ee.data;
            if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
            const d = data as { label?: unknown; ref?: unknown; backend?: unknown };
            if (typeof d.label !== "string" || d.label.length === 0) continue;
            if (typeof d.ref !== "string" || d.ref.length === 0) continue;
            if (d.backend !== "git" && d.backend !== "cas") continue;
            let present = true;
            try { present = await rt.store.has(d.ref); } catch { present = false; }
            if (!present) continue; // ref GC'd / storage lost / NoOpStore ⇒ skip (fail-open)
            rt.snapshots?.set(d.label, {
              label: d.label, backend: d.backend, beforeRef: d.ref, turnIndex: -1, ts: Date.now(),
            });
          } catch { /* throwing-Proxy entry ⇒ skip */ }
        }
  - NOTE: if S1's actual inline body differs in any defensive detail, prefer S1's version over this sketch
    (S1 is the source of truth for the rebuild). The sketch here is the verbatim copy from S1's PRP.
  - IMPORTS: NONE added (ExtensionContext + SessionRuntime already imported in capture.ts).
  - JSDOC (Task 1b below).

Task 1b: WRITE the helper's JSDoc (mirror gcTurnSnapshots's style)
  - Cite: spec/14 §5 (capture lifecycle) + E32 (post-reload snapshot loss → RESOLVED in v1.2) + BUG-002.
  - Document: scans ctx.sessionManager.getEntries() for customType==="mulligan:revert-checkpoint", reconstructs
    each RevertCheckpoint (beforeRef←ref, turnIndex:-1, no afterRef), optionally verifies ref via rt.store.has(ref)
    (fail-open skip on absent/NoOpStore/throw), sets rt.snapshots. NEVER throws (fail-open). EXPORTED so BOTH
    session_start (index.ts) AND the integration test call the SAME code (single source of truth — the
    gcTurnSnapshots precedent). MUST run AFTER gcTurnSnapshots (ckpt:* refs exempt from gc).
  - Add the `[P1.M2.T1.S1/S2 / spec/14 §5 / E32 / BUG-002]` tag at the top of the JSDoc.

Task 2: REFACTOR src/index.ts — replace the inline rebuild with a helper call
  - LOCATE session_start's revert block (after S1 it contains the inline rebuild INSIDE the try, after
    `await gcTurnSnapshots(rt);`).
  - REPLACE the entire inline rebuild block (the `try { let entries = …; for (…) { … } } catch {}` scan loop)
    with ONE line: `await rebuildCheckpointSnapshots(ctx, rt);`
  - KEEP the surrounding try/catch + the `await gcTurnSnapshots(rt);` line UNCHANGED. The ordering
    (gcTurnSnapshots THEN rebuild) is preserved.
  - IMPORT: add `rebuildCheckpointSnapshots,` to the `./capture.js` import block (line ~16):
        import {
          registerTurnStartCapture,
          registerAgentEndCapture,
          gcTurnSnapshots,
          rebuildCheckpointSnapshots, // [P1.M2.T1.S2 / BUG-002] shared rebuild helper (session_start + test)
        } from "./capture.js";
  - PRESERVE S1's JSDoc paragraph above the block (it documents the rebuild pass — still accurate, now via the
    helper). Optionally append a one-line note: "Extracted into rebuildCheckpointSnapshots (capture.ts) so the
    F-revert-reload test calls the SAME code (P1.M2.T1.S2)."
  - VERIFY: `git grep -n "revert-checkpoint" src/index.ts` should show ZERO scan-loop/`set(` logic — only the
    helper call + JSDoc references.

Task 3: CONVERT test/integration/revert-edge.test.ts — remove manual rebuild, call the helper
  - IMPORT: add `rebuildCheckpointSnapshots` to the capture.ts import (lines 52-55):
        import {
          turnStartCaptureHandler,
          agentEndCaptureHandler,
          gcTurnSnapshots,
          rebuildCheckpointSnapshots,
        } from "../../src/capture.js";
  - LOCATE the manual rebuild block inside F-revert-reload (~lines 601-619), which is structured as:
        // REBUILD rt2.snapshots from the persisted mulligan:revert-checkpoint control entries. Production NEVER does
        // this read-side — it is the BUG-002 gap tracked by P1.M2.T1: ...
        const controlEntries = (appended as unknown[]).filter( (e) => … customType === "mulligan:revert-checkpoint" ) as {…}[];
        for (const ce of controlEntries) {
          rt2.snapshots!.set(ce.data.label, { label: ce.data.label, backend: ce.data.backend, beforeRef: ce.data.ref, turnIndex: -1, ts: Date.now() });
        }

        // ASSERT the rebuilt snapshot restored ckpt:x's beforeRef === R0.
        const rebuiltCkpt = rt2.snapshots?.get("ckpt:x") as RevertCheckpoint | undefined;
        expect(rebuiltCkpt).toBeTruthy();
        expect(rebuiltCkpt!.beforeRef).toBe(R0);
        expect(rebuiltCkpt!.backend).toBe("git");
  - DELETE the comment + the `controlEntries` declaration + the `for (const ce …)` loop. (KEEP the assertion
    block — the `// ASSERT …` comment + the three `expect(rebuiltCkpt…)` lines.)
  - INSERT, in place of the deleted loop (and BEFORE the kept assertion block):
        // [P1.M2.T1.S2 / BUG-002] Production now rebuilds rt2.snapshots from the persisted control entries —
        // call the SAME exported helper session_start uses (rebuildCheckpointSnapshots in capture.ts) instead
        // of hand-simulating it. This proves the PRODUCTION read-path populates the snapshot, not a test
        // replica. (Previously this block manually iterated `appended` and called rt2.snapshots.set() — a
        // simulation that masked BUG-002. makeSessionCtx exposes the same shared array via getEntries(), so
        // the helper reads identical data.)
        await rebuildCheckpointSnapshots(ctx, rt2);
  - DO NOT remove the `appended` destructure (GOTCHA #8) — it is still used later (rewound-IDs splice, marker scan).
  - DO NOT change the assertion expectations (they are now satisfied by the production helper instead of the
    manual loop — same values: truthy, beforeRef===R0, backend==='git').
  - KEEP the call AFTER `await gcTurnSnapshots(rt2);` (line ~600) and the `rt2.store = store2;` assignment
    (the helper self-gates on rt.store).

Task 4 (RECOMMENDED): ADD a describe("rebuildCheckpointSnapshots") unit-test block to test/capture.test.ts
  - PLACEMENT: immediately AFTER the existing `describe("gcTurnSnapshots — shared prompt-boundary GC helper")`
    block (lines 371-452) — keep the two shared-helper describe blocks adjacent.
  - MIRROR the gcTurnSnapshots unit-test structure: hand-rolled fakes (NO vi.fn()), getRuntime(id), a fake
    store with a controllable `has` result, and a MINIMAL fake ctx whose `sessionManager.getEntries()` returns
    a controllable array.
  - MINIMAL fake ctx (the helper only reads ctx.sessionManager.getEntries()):
        function makeRebuildCtx(entries: unknown[]) {
          return { sessionManager: { getEntries: () => entries } } as unknown as ExtensionContext;
        }
  - MINIMAL fake store (needs `.has(ref)` returning a boolean; capture.test.ts's makeStore already supports
    configurable behavior — reuse it or add a `hasResult`/`hasThrows` option):
        const store = makeStore({ hasResult: true }); // or a plain { has: async () => true } cast
  - it-cases (mirror gcTurnSnapshots's coverage):
      1. happy-path: entries=[{type:"custom",customType:"mulligan:revert-checkpoint",data:{label:"ckpt:x",ref:"r1",backend:"git"}}]
         → after await rebuildCheckpointSnapshots(ctx, rt): rt.snapshots.get("ckpt:x") truthy, beforeRef==="r1",
         backend==="git", turnIndex===-1.
      2. no-store no-op: rt.store undefined → resolves undefined, snapshots unchanged (size 0).
      3. malformed entry skipped: entries with empty ref / bad backend / null data / non-object → none set.
      4. has()===false skipped: store.has returns false → entry NOT set (NoOpStore-equivalent).
      5. throwing-Proxy entry skipped: an entry whose property access throws → swallowed, no throw escapes,
         other valid entries still set.
      6. (optional) duplicate label last-wins: two entries same label, second ref present → rt.snapshots has
         the second ref.
  - NAMING: `it("rebuilds rt.snapshots from mulligan:revert-checkpoint control entries")`, etc.
  - COVERAGE: the fail-open guarantees the integration test CANNOT easily exercise (malformed/throwing/absent-ref)
    are pinned here — this is the regression net for the helper's never-throw contract.

Task 5 (VERIFY-ONLY): run the gates
  - npm run typecheck    # tsc --noEmit — MUST be clean (the helper + callers type-check)
  - npx vitest run test/integration/revert-edge.test.ts   # F-revert-reload + F-revert-granularity green
  - npx vitest run test/capture.test.ts                   # the new describe block + existing gcTurnSnapshots green
  - npm test            # full suite green (no regression)
  - git diff --name-only # confirms exactly: src/capture.ts, src/index.ts, test/integration/revert-edge.test.ts,
                          # test/capture.test.ts (Task 4 is recommended; if omitted, drop it from this list)
```

### Implementation Patterns & Key Details

```typescript
// THE pattern to mirror — gcTurnSnapshots (src/capture.ts:49-68), the canonical exported shared helper. The
// new rebuildCheckpointSnapshots is this shape + a ctx param + the rebuild body:
//
//   /**
//    * rebuildCheckpointSnapshots — …full JSDoc citing spec/14 §5 / E32 / BUG-002…
//    * EXPORTED so session_start (index.ts) AND the integration test call the SAME code.
//    */
//   export async function rebuildCheckpointSnapshots(ctx: ExtensionContext, rt: SessionRuntime): Promise<void> {
//     if (!rt.store) return; // self-gate (mirror gcTurnSnapshots) — needs rt.store.has()
//     // … defensive entry scan (S1's body, verbatim) …
//   }
//
// THE defensive entry-scan idiom (from clearCheckpointByName, commands.ts ~120-145 — S1 already copied it):
//   getEntries() in try/catch → fail-open → Array.isArray guard → per-entry object guard → per-entry try/catch
//   → customType filter → typeof field guards → has() verify (fail-open) → rt.snapshots?.set(label, {...}).
//
// CRITICAL INVARIANTS (unchanged from S1 — extraction MUST preserve behavior):
//   - NEVER throws (outer + per-entry try/catch; the getEntries() read is wrapped).
//   - turnIndex:-1 (checkpoint sentinel); NO afterRef (checkpoints capture once; BUG-001 relies on its absence).
//   - has() fail-open: skip on false/throw (NoOpStore.has→false ⇒ all skipped — correct: no storage = nothing).
//   - Last-wins for duplicate labels (iterate in order; each valid+present set() overwrites).
//   - Runs AFTER gcTurnSnapshots in BOTH callers (ckpt:* refs survive gc ⇒ has() confirms truthfully).
//
// NON-GOALS (explicitly out of scope — owned by other tasks):
//   - DO NOT change the persisted control-entry shape (commands.ts:226) — read≡write, no migration.
//   - DO NOT add afterRef / change the reconstruction mapping (that's S1's contract; preserve it).
//   - DO NOT touch src/tools/rewind.ts (BUG-001/BUG-004 territory).
//   - DO NOT add a config knob, a new event handler, or any docs/user-facing surface.
//   - DO NOT re-implement the rebuild logic differently — COPY S1's verbatim. The ONLY change is location + signature.
```

### Integration Points

```yaml
src/capture.ts (ADD):
  - new exported async helper rebuildCheckpointSnapshots(ctx, rt), placed after gcTurnSnapshots
  - NO new imports (ExtensionContext + SessionRuntime already imported)

src/index.ts (REFACTOR — behavior-preserving):
  - session_start: inline rebuild block → `await rebuildCheckpointSnapshots(ctx, rt);` (after gcTurnSnapshots)
  - capture.ts import block: + `rebuildCheckpointSnapshots,`
  - JSDoc: keep S1's paragraph (still accurate); optionally note the extraction

test/integration/revert-edge.test.ts (CONVERT):
  - capture.ts import: + `rebuildCheckpointSnapshots`
  - manual rebuild block (~601-619): DELETE comment + controlEntries + for-loop; INSERT helper call
  - assertion block: KEEP (now satisfied by the production helper)

test/capture.test.ts (RECOMMENDED ADD):
  - new describe("rebuildCheckpointSnapshots — …") block after the gcTurnSnapshots describe
  - minimal fake ctx + fake store; happy-path + fail-open it-cases

NO CHANGES TO: src/commands.ts (write site), src/markers.ts, src/runtime.ts, src/snapshot/*, src/tools/*,
  config, package.json, tsconfig.json. The src/ diff is a pure extract-method refactor.
```

## Validation Loop

> NOTE: TypeScript + vitest project. Gates are `npm run typecheck` (tsc --noEmit, strict) and `npm test`
> (vitest run). There is NO ruff/mypy/eslint (Python/template tools — DO NOT APPLY).

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # = tsc --noEmit (strict). MUST be clean.
# Expected: zero errors. Confirm the helper's signature + the two call sites + the test fake ctx all type-check.
# Spot-check the import additions are the ONLY import changes:
grep -nE '^import |rebuildCheckpointSnapshots' src/capture.ts src/index.ts test/integration/revert-edge.test.ts | grep -i rebuild
# Expected: export in capture.ts; import+call in index.ts; import+call in revert-edge.test.ts.
```

### Level 2: Unit / Integration Tests (Component Validation)

```bash
# The converted cross-reload test — the headline check for THIS task.
npx vitest run test/integration/revert-edge.test.ts
# Expected: both it-cases green (F-revert-granularity UNCHANGED; F-revert-reload now via the helper).
#   F-revert-reload MUST still assert a.ts → "A0\n" after the checkpoint rewind (the BUG-001 guard) — if that
#   regresses, the helper's reconstruction dropped beforeRef/turnIndex.

# The new helper unit tests (Task 4) — fail-open coverage.
npx vitest run test/capture.test.ts -t "rebuildCheckpointSnapshots"
# Expected: all new it-cases green (happy-path rebuild, no-store no-op, malformed skip, has()===false skip,
#   throwing-Proxy skip).

# Full suite — no regression.
npm test                 # = vitest run
# Expected: all green (1277+ tests). If a snapshot/revert test regressed, the extraction changed behavior —
#   diff src/index.ts against S1's version to confirm only location+signature changed.
```

### Level 3: Production-Path Verification (THE key check for this task)

```bash
# PROVE the test now exercises the PRODUCTION rebuild (not a replica). The definitive signal:
#   1. The manual rebuild loop is GONE from the test:
grep -n "controlEntries\|rt2.snapshots!.set\|Production NEVER does" test/integration/revert-edge.test.ts
# Expected: ZERO matches (the manual block + the old comment are removed).
#   2. The test calls the SAME helper session_start calls:
grep -n "rebuildCheckpointSnapshots(ctx, rt2)\|rebuildCheckpointSnapshots(ctx, rt);" test/integration/revert-edge.test.ts src/index.ts
# Expected: one call in the test, one call in index.ts — IDENTICAL helper.
#   3. session_start has NO inline scan loop left:
git grep -n "customType === \"mulligan:revert-checkpoint\"" src/index.ts
# Expected: ZERO matches (the scan moved to capture.ts). One match in src/capture.ts (the helper body).
#   4. The assertion is unchanged (now satisfied by production):
grep -n "rebuiltCkpt!.beforeRef).toBe(R0)\|rebuiltCkpt!.backend).toBe(\"git\")" test/integration/revert-edge.test.ts
# Expected: both present — the test still proves ckpt:x is rebuilt with beforeRef===R0 + backend git.

# A quick Node sanity that the helper's behavior is unchanged (extract-method equivalence). Run the converted
# F-revert-reload it-case and confirm the BUG-001 guard still holds (a.ts → A0\n after the checkpoint rewind):
npx vitest run test/integration/revert-edge.test.ts -t "F-revert-reload" 2>&1 | tail -20
# Expected: passed; the it-case reaches the final `expect(readFileSync(...)).toBe("A0\n")`.
```

### Level 4: Fail-Open / Regression Net (the new capture.test.ts unit block)

```bash
# The unit tests pin the fail-open guarantees the git-requiring integration test cannot easily hit.
npx vitest run test/capture.test.ts -t "rebuildCheckpointSnapshots" 2>&1 | tail -25
# Expected: passed — happy-path rebuild + all fail-open it-cases (no-store, malformed, has()===false, throwing).
# These are the regression net: if a future change makes the helper throw or stop skipping bad entries, THIS
# block fails before the integration test (which needs real git) ever runs.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (helper signature + both call sites + test fake ctx all type-check).
- [ ] `npm test` full suite green (no regression).
- [ ] `npx vitest run test/integration/revert-edge.test.ts` — both it-cases pass.
- [ ] `npx vitest run test/capture.test.ts -t "rebuildCheckpointSnapshots"` — new unit block passes (Task 4).
- [ ] `git diff --name-only` shows exactly `src/capture.ts`, `src/index.ts`,
      `test/integration/revert-edge.test.ts` (+ `test/capture.test.ts` if Task 4 done).

### Feature Validation

- [ ] `src/capture.ts` exports `rebuildCheckpointSnapshots(ctx, rt)` with S1's rebuild body verbatim.
- [ ] `src/index.ts` session_start calls the helper (no inline scan loop remains; ordering after gcTurnSnapshots preserved).
- [ ] `test/integration/revert-edge.test.ts` has NO manual rebuild loop / `controlEntries` / `rt2.snapshots!.set(...)` / "Production NEVER does" comment.
- [ ] The test calls `await rebuildCheckpointSnapshots(ctx, rt2)` and asserts `rt2.snapshots.get("ckpt:x")` is populated (beforeRef===R0, backend==='git') by the PRODUCTION helper.
- [ ] The test comment now states production DOES this (BUG-002 fixed), not that it never does.
- [ ] The test still passes the BUG-001 guard (a.ts → "A0\n" after the checkpoint rewind with revert).
- [ ] `test/capture.test.ts` has a `describe("rebuildCheckpointSnapshots")` block (Task 4) covering happy-path + all fail-open cases.

### Code Quality Validation

- [ ] Mirrors the `gcTurnSnapshots` exported-helper precedent (same file, same dual-caller shape, same unit-test block style).
- [ ] Defensive entry-scan idiom copied verbatim from S1/clearCheckpointByName (NO readOwn/isRecord import).
- [ ] Behavior-preserving: the only src/ change is extract-method (index.ts shrinks, capture.ts grows by the same code).
- [ ] NO new types, NO new config/API/docs surface, NO new event handler.
- [ ] JSDoc cites spec/14 §5 / E32 / BUG-002 + the gcTurnSnapshots precedent.

### Documentation & Deployment

- [ ] Helper JSDoc documents the rebuild + the "exported so session_start and the test share one code path" rationale.
- [ ] No user-facing/config/API/docs surface change (nothing to deploy beyond the code).

---

## Anti-Patterns to Avoid

- ❌ Don't RE-IMPLEMENT the rebuild logic — COPY S1's inline body verbatim. The only changes are file location
  + the added `ctx` param. Re-deriving it risks divergence (the exact bug this task eliminates).
- ❌ Don't use approach (b) (replicate inline + flip the comment) — that is STILL manual simulation, just
  relabeled. The task TITLE is "REMOVE manual simulation"; only the shared-helper extraction (a) does that.
- ❌ Don't forget the PREREQUISITE check — if S1 isn't implemented yet, there is no inline code to extract.
  Confirm `grep revert-checkpoint src/index.ts` shows the scan loop before editing.
- ❌ Don't change the call ordering — rebuild MUST run AFTER gcTurnSnapshots in BOTH callers (ckpt:* refs must
  survive gc before has() confirms them; GOTCHA #4).
- ❌ Don't remove the `appended` destructure from the test (GOTCHA #8) — it is still used later (the
  rewound-IDs splice + the marker scan). Only the manual rebuild block is removed.
- ❌ Don't change the assertion expectations — they keep the same values (truthy, beforeRef===R0,
  backend==='git'); only the producer changes (manual loop → production helper).
- ❌ Don't import `readOwn`/`isRecord` from filter.ts (module-private) — inline typeof guards only (GOTCHA #3).
- ❌ Don't add an afterRef to the reconstruction (checkpoints capture once; BUG-001 relies on its absence; GOTCHA #6).
- ❌ Don't add a config gate or a backend==="none" branch — the helper's `has()` on NoOpStore returns false and
  skips all entries (correct fail-open; GOTCHA #5).
- ❌ Don't run ruff/mypy/eslint (not this project's toolchain; GOTCHA #10). Gates are typecheck + vitest only.
- ❌ Don't touch src/tools/rewind.ts or src/snapshot/* — this task is the BUG-002 read-side de-duplication only.

---

## Confidence Score: 9/10

**Why high**: This is a behavior-preserving **extract-method refactor** of already-shipped, already-tested
code (S1's inline rebuild), guided by an EXACT codebase precedent (`gcTurnSnapshots`: same file, same
exported-helper shape, same dual-caller pattern, same adjacent unit-test block). The body to move is pinned
verbatim in S1's PRP; the test block to delete is pinned by line range + verbatim content; the assertion to
keep is explicit; the fake-semantics equivalence (`appended === getEntries()` shared array) is proven; and the
unit-test precedent (`capture.test.ts:371-452`) is quoted. No new logic, no new types, no new config/API/docs
surface — the src/ diff is pure code relocation.

**Residual risk (the 1 point)**: depends on S1 landing first (the PREREQUISITE check). If S1's actual inline
body differs slightly from its PRP's verbatim block, the implementer must copy S1's ACTUAL code (not the PRP
sketch) — the Task 1 note calls this out. Also, capture.test.ts's existing `makeStore` fake may need a small
`hasResult`/`hasThrows` option added for Task 4's unit cases (trivial, mirroring the gcThrows option the
gcTurnSnapshots tests already use). Mitigated by: the conversion is behavior-equivalent (proven), the full
suite catches any behavior drift, and Task 4 is recommended (not blocking) — the integration test alone
satisfies the work-item's OUTPUT contract.

---