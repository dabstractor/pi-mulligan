---
name: "P1.M2.T1.S1 (BUG-002) — session_start rebuilds rt.snapshots from persisted mulligan:revert-checkpoint entries"
description: >
  Add the MISSING read-side of the E32 cross-reload checkpoint contract to the session_start handler in
  `src/index.ts`: after `detectAndCreate` + `gcTurnSnapshots`, scan `ctx.sessionManager.getEntries()` for
  `mulligan:revert-checkpoint` control entries, defensively reconstruct each into a `RevertCheckpoint`
  (turnIndex:-1 sentinel; beforeRef from the stored ref; verify via `rt.store.has(ref)`), and repopulate
  `rt.snapshots` so a post-/resume `mulligan_rewind(granularity:"checkpoint", revert_file_changes:true)`
  finds its snapshot. Purely additive production code (Mode-A JSDoc update). Per
  plan/.../bug_fix_analysis.md §BUG-002 + spec/14 §5 / E32. NO test/config/API change (the test update is
  sibling P1.M2.T1.S2).
---

## Goal

**Feature Goal**: `session_start` (the only `/resume`/`/reload` entry point) rebuilds the in-memory
`rt.snapshots` map from the persisted `mulligan:revert-checkpoint` control entries that
`/mulligan_checkpoint` writes — closing the write-only gap (BUG-002) that left E32 "resolved in v1.2"
untrue in shipped code. After this fix, `rt.snapshots.get("ckpt:<name>")` is populated for every
pre-existing checkpoint immediately after session_start, so a checkpoint-granularity rewind with
`revert_file_changes` proceeds to `store.restore()` instead of hitting the "no working-tree snapshot
for this boundary" skip branch.

**Deliverable**: A surgical, additive change to `src/index.ts` — a new rebuild pass inserted inside the
existing `session_start` handler's `if (getConfig().revert.enabled) { try { … } }` block, AFTER
`await gcTurnSnapshots(rt);`, that scans `ctx.sessionManager.getEntries()`, reconstructs
`RevertCheckpoint`s, optionally verifies each ref via `rt.store.has(ref)`, and sets them into
`rt.snapshots`. Plus a Mode-A JSDoc update on the session_start revert block citing spec/14 §5 / E32 /
BUG-002. NO other file is touched (the F-revert-reload test update is sibling task P1.M2.T1.S2).

**Success Definition**:
- In a session with `revert.enabled`, after `/mulligan_checkpoint x` then a simulated `/resume`
  (`resetRuntime(sid)` + re-`detectAndCreate` on the same storage, exactly as the F-revert-reload test
  does), `rt.snapshots.get("ckpt:x")` is a `RevertCheckpoint` with `beforeRef === <the captured ref>` and
  `backend === store.describe().backend` — i.e. it is populated by the PRODUCTION session_start pass, not
  by test-only manual simulation.
- A subsequent `mulligan_rewind(granularity:"checkpoint", checkpoint:"x", revert_file_changes:true)`
  proceeds to `store.restore()` and reverts files (does NOT hit the "no working-tree snapshot" skip).
- Malformed control entries (non-string fields, missing data, unknown backend, throwing-Proxy entries)
  are SKIPPED (fail-open) — a single bad entry never blocks the rebuild or session_start.
- A control entry whose ref no longer exists in the store (`has(ref)===false` — GC'd / storage lost /
  NoOpStore) is skipped (fail-open).
- `npm run typecheck` clean; `npm test` green (the existing F-revert-reload test still passes — it does
  its own manual rebuild on a separate `rt2`, and production's rebuild runs only in the REAL
  session_start handler the test does not invoke; see GOTCHA #4).

## User Persona

**Target User**: A Mulligan user who (a) sets a checkpoint with `/mulligan_checkpoint x`, (b) does work,
(c) `/resume`s the session (or Pi reloads mid-task), and (d) then asks the agent to
`mulligan_rewind(granularity:"checkpoint", checkpoint:"x", revert_file_changes:true)`. Today (BUG-002)
the working-tree files are NOT reverted across that `/resume` — the snapshot ref is persisted but never
read back. This fix makes the documented E32 durability real.

**Use Case**: Cross-reload checkpoint file-revert — the headline v1.2 robustness guarantee.

**Pain Points Addressed**: Silent no-op of `revert_file_changes` across `/resume` for checkpoints (the
rewind succeeds for the CONTEXT but reports "0 files reverted" with no snapshot, contradicting the
checkpoint's whole purpose).

## Why

- **E32 is currently a lie in shipped code.** spec/14 §5 / E32 claims a `/resume` "re-reads the refs and
  the store still honors them" for checkpoints, backed by the persisted `mulligan:revert-checkpoint`
  control entry. The WRITE side exists (commands.ts:226) but the READ side is missing — a grep for
  `revert-checkpoint` finds it ONLY at the write site and in comments. After `resetRuntime` on
  session_start, `rt.snapshots` is a fresh empty Map, so every pre-existing checkpoint is invisible to
  the rewind tool's restore path.
- **The shipped test gives false confidence.** The F-revert-reload integration test passes ONLY because
  it manually simulates the rebuild the production code never does (its own comment: *"REBUILD
  rt2.snapshots from the persisted mulligan:revert-checkpoint control entries. Production NEVER does this
  read-side — it is the BUG-002 gap tracked by P1.M2.T1"*). So the bug slipped past CI.
- **Small, surgical, purely additive.** This is the missing read-half of an already-shipped write/read
  pair. It changes ONE production function (session_start), adds ~25 lines + a JSDoc paragraph, touches
  no other file, and reuses the exact defensive entry-scan idiom already used by `clearCheckpointByName`
  (commands.ts). No new types, no new imports beyond an optional type-only one, no config/API surface.

## What

User-visible behavior: NONE (no config, no API, no docs surface change). The fix is internal: after
`/resume`, working-tree file revert for checkpoints now actually happens.

Internal behavior change in `src/index.ts` `session_start` handler, inside the
`if (!getConfig().revert.enabled) return;` → `try { … }` block, positioned AFTER `await gcTurnSnapshots(rt);`:

1. Read `ctx.sessionManager.getEntries()` (defensively — `try/catch` → fail-open to no rebuild; `Array.isArray` guard).
2. For each entry where `type === "custom"` && `customType === "mulligan:revert-checkpoint"`:
   - Read `data.label`, `data.ref`, `data.backend` with `typeof`/literal guards (skip on any bad/missing field).
   - Optionally verify `await rt.store.has(data.ref)`; skip the entry if `false` or it throws (ref GC'd / storage lost / NoOpStore).
   - `rt.snapshots?.set(data.label, { label: data.label, backend: data.backend, beforeRef: data.ref, turnIndex: -1, ts: Date.now() })`.
3. Per-entry `try/catch` (a throwing-Proxy entry is skipped, never thrown). The whole pass sits inside the
   existing session_start `try/catch` (belt-and-suspenders: a rebuild failure NEVER blocks session_start).
4. Duplicate labels (a checkpoint set multiple times): iterate IN ORDER; the last valid+present `set()` wins.

### Success Criteria

- [ ] After a simulated `/resume` (resetRuntime + re-detectAndCreate on the same storage) with
      `revert.enabled`, `rt.snapshots.get("ckpt:<name>")` is a populated `RevertCheckpoint` produced by
      the PRODUCTION session_start pass.
- [ ] `beforeRef === <captured ref>`, `backend === store.describe().backend`, `turnIndex === -1`.
- [ ] A checkpoint-granularity rewind with `revert_file_changes:true` post-/resume proceeds to
      `store.restore()` and reverts files (NOT the "no working-tree snapshot" skip).
- [ ] Malformed control entries are skipped (fail-open), never thrown.
- [ ] A control entry whose ref is absent from the store (`has(ref)===false` / NoOpStore) is skipped.
- [ ] The rebuild runs AFTER `gcTurnSnapshots` (checkpoint `ckpt:*` refs are exempt from GC, so they survive).
- [ ] `npm run typecheck` clean; `npm test` green; NO file other than `src/index.ts` is modified.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?"
YES. The exact handler to modify (`src/index.ts` session_start), the exact insert line (`await gcTurnSnapshots(rt);`
→ add AFTER it), the persisted control-entry shape (`{type:"custom", customType:"mulligan:revert-checkpoint",
data:{label,ref,backend}}`), the `RevertCheckpoint` interface, the defensive entry-scan idiom to mirror
(`clearCheckpointByName` in commands.ts — quoted verbatim below), the `has()` contract, and the verbatim
rebuild code are all specified. The implementer needs only `src/index.ts` (+ a glance at commands.ts for
the idiom) — no spec archaeology required.

### Documentation & References

```yaml
# MUST READ — the authoritative root-cause + fix strategy for THIS bug
- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  why: "§BUG-002 gives the root cause (write-only: commands.ts:226 persists, session_start never reads),
        the exact change site (session_start, after detectAndCreate), the fix strategy (scan getEntries for
        customType==='mulligan:revert-checkpoint', reconstruct RevertCheckpoint, optional has() verify,
        rt.snapshots.set), and the 'Existing Test Impact' (F-revert-reload manually simulates the rebuild)."
  section: "BUG-002 (Major): E32 cross-reload checkpoint snapshots write-only"
  critical: "The fix MUST run AFTER gcTurnSnapshots (which only clears turn* keys, exempts ckpt:*) so the
             rebuilt checkpoint refs are still present for has() to confirm."

# MUST READ — the file being modified (read it FULLY before editing)
- file: src/index.ts
  why: "The session_start handler is the modify target. The insert point is the existing
        `if (!getConfig().revert.enabled) return;` → `try { rt.store = await detectAndCreate(...);
        await gcTurnSnapshots(rt); } catch {...}` block (~lines 113-126). The rebuild goes INSIDE the try,
        AFTER gcTurnSnapshots."
  pattern: "The handler's discipline: FRESH `sid` via `ctx.sessionManager.getSessionId()` (read once, C12),
            `resetRuntime(sid)`, then the revert block gated on `getConfig().revert.enabled`. The rebuild
            reuses the SAME `ctx` (for getEntries) and `rt` (for snapshots/store) already in scope."
  gotcha: "Do NOT add a new `pi.on` handler or a new try/catch wrapper outside the existing one. The rebuild
           is a few lines INSIDE the existing try block, sharing its outer catch. See 'Known Gotchas' #1/#2."

# MUST READ — the WRITE site (the other half of the pair this fix completes)
- file: src/commands.ts
  why: "makeCheckpointCommand step 4b (~lines 200-228) writes BOTH `rt.snapshots.set(\"ckpt:\"+name, …)`
        (in-memory) AND `pi.appendEntry(\"mulligan:revert-checkpoint\", {label, ref, backend})` (persisted).
        This fix reconstructs EXACTLY that in-memory shape from the persisted data, so read≡write."
  section: "makeCheckpointCommand step 4b (~200-228)"
  critical: "The persisted data is { label, ref, backend } (NOT beforeRef/turnIndex/ts — those are
             reconstructed). turnIndex:-1 is the checkpoint sentinel (matches the write site). The label is
             `\"ckpt:\"+name` (namespaced) — set rt.snapshots under that SAME key."

# Pattern to mirror — the defensive entry-scan idiom (verbatim source for the loop body)
- file: src/commands.ts
  why: "`clearCheckpointByName` (~lines 120-145) scans `ctx.sessionManager.getEntries()` with the EXACT
        defensive shape this fix must copy: `try { entries = ctx.sessionManager.getEntries(); } catch {
        return; }` → `if (!Array.isArray(entries)) return;` → `for (const e of entries) { if (typeof e !==
        \"object\" || e === null || Array.isArray(e)) continue; try { … } catch { /* throwing-Proxy */ } }`.
        Mirror this verbatim (it is the codebase's house style for raw-entry scanning)."
  pattern: "Array.isArray guard → per-entry object guard → try { narrowed field reads with typeof checks }
            catch { skip }. The contract explicitly demands this idiom ('per-entry typeof guards, try/catch
            per entry')."
  gotcha: "readOwn/isRecord from filter.ts are NOT exported (module-private) — do NOT import them. Use inline
           `typeof`/`as {…}` guards exactly like clearCheckpointByName does."

# The RevertCheckpoint interface (the value type to construct)
- file: src/markers.ts
  why: "`export interface RevertCheckpoint { label: string; backend: \"git\"|\"cas\"; beforeRef: string;
        afterRef?: string; turnIndex: number; ts: number; }` (~lines 121-128). The rebuild constructs a
        member of this interface. NO afterRef (checkpoints capture once). turnIndex:-1 sentinel."
  pattern: "tsc infers the shape from `rt.snapshots?.set(label, …)` (the Map is `Map<string, RevertCheckpoint>`);
            an inline object literal type-checks against it with NO explicit RevertCheckpoint import. If tsc
            complains, add `import type { RevertCheckpoint } from \"./markers.js\";` (type-only, erased)."

# The has() contract (the optional ref verification)
- file: src/snapshot/store.ts
  why: "`has(ref: string): Promise<boolean>` (interface ~line 109; NoOpStore ~line 358 returns false). Used
        to skip a control entry whose ref was GC'd / storage lost / backend is 'none'. The session_start
        comment at ~line 109 already documents has() as 'the cross-reload (E32) check'."
  pattern: "`try { present = await rt.store.has(d.ref); } catch { present = false; }` then `if (!present)
            continue;`. NoOpStore.has→false ⇒ all entries skipped (correct: no real storage = nothing to
            restore). rt.store is guaranteed assigned (detectAndCreate runs first and never rejects)."

# The test that PROVES the gap (and that P1.M2.T1.S2 will later convert)
- file: test/integration/revert-edge.test.ts
  why: "F-revert-reload (~lines 590-625) MANUALLY rebuilds rt2.snapshots from control entries (the logic
        this fix moves into production). Reading it confirms the EXACT entry shape + reconstruction to
        replicate. The test does NOT call the production session_start handler (it builds its own ctx), so
        this fix does NOT change the test's behavior — sibling P1.M2.T1.S2 owns converting it."
  pattern: "filter appended for customType==='mulligan:revert-checkpoint' → for each: rt2.snapshots.set(
            ce.data.label, { label:ce.data.label, backend:ce.data.backend, beforeRef:ce.data.ref,
            turnIndex:-1, ts:Date.now() }). The production code is this exact loop + defensive guards."

# Spec authority
- file: spec/14-working-tree-revert.md
  why: "§5 (capture lifecycle & retention) + E32 ('post-reload snapshot loss → RESOLVED in v1.2') are the
        contract this fix finally satisfies. §2 (RevertCheckpoint definition + 'persisted for cross-reload')."
  section: "§5 Capture lifecycle & retention; §2 Architecture (RevertCheckpoint); spec/08 E32"

# Cross-references to sibling tasks (do NOT do their work)
- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M1T1S2/PRP.md
  why: "The BUG-001 test task. Its PRP RETAINS the F-revert-reload manual rebuild with a comment naming
        BUG-002/P1.M2 as the future production fix. THIS task (S1) IS that production fix; S1 does not
        touch the test. Sibling P1.M2.T1.S2 will later convert the test to verify the production path."
```

### Current Codebase tree (the slice that matters)

```bash
src/
├── index.ts            # <-- THE file modified (session_start handler: add rebuild pass + JSDoc)
├── commands.ts         # READ-ONLY — write site (commands.ts:226) + clearCheckpointByName idiom to mirror
├── markers.ts          # READ-ONLY — RevertCheckpoint interface
├── runtime.ts          # READ-ONLY — SessionRuntime.snapshots?: Map<string, RevertCheckpoint>
└── snapshot/store.ts   # READ-ONLY — SnapshotStore.has() (NoOpStore→false); detectAndCreate (used already)
test/integration/
└── revert-edge.test.ts # UNCHANGED here (sibling P1.M2.T1.S2 owns the test conversion)
```

### Desired Codebase tree (files this task changes)

```bash
src/
└── index.ts            # MODIFIED: +rebuild pass in session_start (after gcTurnSnapshots) + JSDoc update
# (no new files; no test/config/api changes)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — insert INSIDE the existing try block, AFTER gcTurnSnapshots. Do NOT add a new pi.on handler
// or a new try/catch. The current block is:
//     if (!getConfig().revert.enabled) return;
//     try {
//       const rt = getRuntime(sid);
//       rt.store = await detectAndCreate(ctx.cwd, getConfig().revert);
//       await gcTurnSnapshots(rt);
//       // <-- ADD THE REBUILD HERE (rt.store is assigned; rt.snapshots is fresh-empty from resetRuntime) -->
//     } catch (e) { try { log("error", "session_start.store", sid, { error: String(e) }); } catch {} }
// The outer catch already guarantees a rebuild failure NEVER blocks session_start. Per-entry try/catch is
// ADDITIONAL defense (a throwing-Proxy entry is skipped, not surfaced to the outer catch).

// GOTCHA #2 — ORDER: rebuild MUST run AFTER gcTurnSnapshots. gcTurnSnapshots drops turn/* refs but EXEMPTS
// ckpt:* checkpoint refs (spec/14 §5). If the rebuild ran BEFORE gc, a gc that (hypothetically) reclaimed a
// ref right after would leave a stale rt.snapshots entry pointing at a gone ref. After gc, the surviving
// ckpt:* refs are stable → has() confirms them truthfully. (The contract is explicit on this ordering.)

// GOTCHA #3 — readOwn/isRecord are module-private in filter.ts (NOT exported). Do NOT import them. Use
// INLINE typeof guards exactly like clearCheckpointByName (commands.ts ~120-145): `typeof e !== "object" ||
// e === null || Array.isArray(e)` → `as { type?; customType?; data? }` → per-field `typeof` checks. This is
// the codebase house style for raw-entry scanning; mirroring it keeps the patch consistent + reviewable.

// GOTCHA #4 — the existing F-revert-reload test does its OWN manual rebuild on a SEPARATE rt2 (it builds a
// custom ctx and never calls the production session_start handler). So this production fix does NOT change
// that test's behavior — both rebuilds are independent. The test still passes. (Sibling P1.M2.T1.S2 later
// converts the test to exercise the production path; that is NOT this task.) DO NOT edit the test.

// GOTCHA #5 — the persisted data is { label, ref, backend } — the MINIMAL restore set (NOT beforeRef/
// turnIndex/ts). Map them: beforeRef ← data.ref; turnIndex ← -1 (checkpoint sentinel); ts ← Date.now() (the
// rebuild timestamp — the original capture ts is not persisted; this is fine, ts is advisory/monotonic). The
// label key in rt.snapshots is data.label (already namespaced "ckpt:<name>" at write time) — set under the
// SAME key the rewind tool looks up (`rt.snapshots.get("ckpt:"+name)`).

// GOTCHA #6 — NO afterRef for rebuilt checkpoints. Checkpoints capture ONCE (commands.ts step 4b sets only
// beforeRef). So the rebuilt RevertCheckpoint has NO afterRef field. This is correct AND required for the
// BUG-001 fix (rewind.ts step 6b: `const afterRef = checkpoint.afterRef;` — undefined → skip dirty guard →
// proceed to restore). Do NOT synthesize an afterRef.

// GOTCHA #7 — the optional has() verification is fail-open. Wrap it: `let present = true; try { present =
// await rt.store.has(d.ref); } catch { present = false; } if (!present) continue;`. A throw (shouldn't
// happen — NoOpStore.has returns false, git/cas has() catch internally) → skip the entry. has()===false
// (ref GC'd / storage lost / NoOpStore) → skip. This prevents a dangling rt.snapshots entry that would make
// restore() fail later. Cheap: one git rev-parse / one CAS file-stat per checkpoint, once at session_start.

// GOTCHA #8 — duplicate labels → last valid+present wins. A checkpoint set twice writes two control entries
// with the same label. Iterate IN ORDER; each valid+present entry calls set(), so the LAST one overwrites.
// (Edge: if the latest ref is gone but an earlier survives, the stale earlier ref wins — acceptable: a
// revoked-then-reset checkpoint is a rare manual action, and the inconsistency is "stale snapshot" not
// "data loss". Do NOT add reverse-iterate/break complexity.)

// GOTCHA #9 — rt.store is guaranteed assigned when the rebuild runs (detectAndCreate runs first and NEVER
// rejects → NoOpStore on any error). rt.snapshots is fresh-empty (resetRuntime just recreated it). The
// rebuild POPULATES it. Use `rt.snapshots?.set(...)` (optional chaining) for robustness against a hand-built
// runtime, but in production rt.snapshots is always a Map here (freshRuntime initializes it).

// GOTCHA #10 — no new imports needed (almost certainly). The inline object literal `{ label, backend,
// beforeRef, turnIndex, ts }` type-checks against RevertCheckpoint via the Map's value type. ONLY if tsc
// complains (it shouldn't — the literal is structurally complete) add `import type { RevertCheckpoint } from
// "./markers.js";` (type-only, erased, no runtime coupling). Do NOT import runtime/store symbols (already
// imported in index.ts). ctx and rt are already in the session_start closure scope.
```

## Implementation Blueprint

### Data models and structure

No new data models. The rebuild constructs members of the existing exported
`RevertCheckpoint` interface (src/markers.ts:121) from the persisted control-entry data. The reconstruction
mapping (persisted → in-memory) is:

```typescript
// Persisted (commands.ts:226 — pi.appendEntry 2nd arg):
//   { label: "ckpt:<name>", ref: <captured sha>, backend: "git" | "cas" }
//
// Reconstructed RevertCheckpoint (markers.ts:121):
//   { label:      data.label,      // ← verbatim (namespaced "ckpt:<name>")
//     backend:    data.backend,    // ← verbatim ("git" | "cas")
//     beforeRef:  data.ref,        // ← the captured snapshot ref (renamed ref → beforeRef)
//     turnIndex:  -1,              // ← sentinel: checkpoint, not turn-bound (matches write site)
//     ts:         Date.now() }     // ← rebuild timestamp (original capture ts not persisted; advisory)
//   // afterRef is OMITTED (checkpoints capture once) — see GOTCHA #6.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/index.ts — add the checkpoint-rebuild pass in session_start
  - LOCATE the session_start handler's revert block:
        if (!getConfig().revert.enabled) return; // layer-1 gate
        try {
          const rt = getRuntime(sid);
          rt.store = await detectAndCreate(ctx.cwd, getConfig().revert); // create + cache (never rejects → NoOpStore)
          await gcTurnSnapshots(rt); // REUSE capture.ts's pass — gc() drops all turn/* refs on disk
          // >>> INSERT THE REBUILD PASS HERE <<<
        } catch (e) { try { log("error", "session_start.store", sid, { error: String(e) }); } catch {} }
  - INSERT (exact code — mirrors clearCheckpointByName's defensive idiom; GOTCHA #1/#2/#3/#5/#7/#8):
        // [P1.M2.T1.S1 / spec/14 §5 / E32] BUG-002 fix: rebuild rt.snapshots from the persisted
        // mulligan:revert-checkpoint control entries that /mulligan_checkpoint wrote (commands.ts step 4b).
        // resetRuntime above wiped rt.snapshots to a fresh empty Map; a /resume must RE-read the refs so a
        // later checkpoint-granularity rewind finds its snapshot (E32 "post-reload snapshot loss → RESOLVED
        // in v1.2"). Runs AFTER gcTurnSnapshots (which exempts ckpt:* refs) so surviving checkpoint refs are
        // confirmed by has(). Purely additive; a malformed/absent ref is skipped (fail-open) — a rebuild
        // failure NEVER blocks session_start (the outer try/catch + per-entry try/catch both cover it).
        try {
          let entries: unknown;
          try {
            entries = ctx.sessionManager.getEntries(); // read FRESH (C12)
          } catch {
            entries = undefined; // getEntries threw → no rebuild (fail-open)
          }
          if (Array.isArray(entries)) {
            for (const e of entries) {
              if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
              try {
                const ee = e as { type?: unknown; customType?: unknown; data?: unknown };
                if (ee.type !== "custom") continue;
                if (ee.customType !== "mulligan:revert-checkpoint") continue;
                const data = ee.data;
                if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
                const d = data as { label?: unknown; ref?: unknown; backend?: unknown };
                if (typeof d.label !== "string" || d.label.length === 0) continue;
                if (typeof d.ref !== "string" || d.ref.length === 0) continue;
                if (d.backend !== "git" && d.backend !== "cas") continue;
                // optional E32 verification: the ref must STILL exist in the store (survived gc / storage
                // intact). NoOpStore.has→false (backend 'none' ⇒ nothing to restore); a throw ⇒ skip.
                let present = true;
                try {
                  present = await rt.store!.has(d.ref);
                } catch {
                  present = false;
                }
                if (!present) continue;
                rt.snapshots?.set(d.label, {
                  label: d.label,
                  backend: d.backend,
                  beforeRef: d.ref,
                  turnIndex: -1, // checkpoint sentinel (matches commands.ts step 4b)
                  ts: Date.now(),
                });
              } catch {
                // a throwing-Proxy entry → skip (fail-open, never throw on the session_start path)
              }
            }
          }
        } catch {
          // belt-and-suspenders — the outer session_start catch already covers this; keep the rebuild isolated
        }
  - NAMING/KEY: set rt.snapshots under d.label (already namespaced "ckpt:<name>" — the SAME key the rewind
    tool looks up via rt.snapshots.get("ckpt:"+name)).
  - FOLLOW pattern: clearCheckpointByName (commands.ts ~120-145) for the Array.isArray + per-entry object
    guard + try/catch-per-entry shape.
  - GOTCHA: all of #1–#9 above.

Task 2: MODIFY src/index.ts — update the session_start revert-block JSDoc (Mode A)
  - LOCATE the comment immediately above the `if (!getConfig().revert.enabled) return;` line (the
    `[P3.M1.T2.S1 / spec/14 §5] v1.2 working-tree revert: create the per-session store …` block).
  - EXTEND it (add a bullet/paragraph) documenting the new checkpoint-rebuild pass:
        "[P1.M2.T1.S1 / spec/14 §5 / E32] BUG-002 fix: AFTER gcTurnSnapshots, rebuild rt.snapshots from the
        persisted mulligan:revert-checkpoint control entries (/mulligan_checkpoint's step 4b write). E32
        ('post-reload snapshot loss → RESOLVED in v1.2') requires the read-side: resetRuntime wiped
        rt.snapshots, so a /resume re-reads the {label, ref, backend} control data, reconstructs each
        RevertCheckpoint (beforeRef←ref, turnIndex:-1, no afterRef — checkpoints capture once), verifies the
        ref still exists via store.has(ref) (fail-open skip on absent/NoOpStore), and repopulates the Map so
        a checkpoint-granularity rewind finds its snapshot. Best-effort: a malformed entry or missing ref is
        skipped; a rebuild failure never blocks session_start."
  - WHY: Mode-A docs ride WITH the work (the work-item contract). Keeps the next reader oriented.
  - DO NOT rewrite the existing comment — EXTEND it (the detectAndCreate + gcTurnSnapshots description stays).

Task 3 (VERIFY-ONLY): confirm no type-only import is needed
  - After Task 1, run `npm run typecheck`. The inline object literal assigned via rt.snapshots?.set(...)
    type-checks structurally against RevertCheckpoint (the Map is `Map<string, RevertCheckpoint>`). EXPECTED:
    clean, NO new import. ONLY if tsc flags it (it should not — the literal is structurally complete) add
    `import type { RevertCheckpoint } from "./markers.js";` at the top of index.ts (type-only, erased).
  - DO NOT add the import preemptively (YAGNI; the codebase prefers inference).
```

### Implementation Patterns & Key Details

```typescript
// THE pattern to mirror — clearCheckpointByName (src/commands.ts ~120-145), the codebase's canonical
// raw-getEntries() defensive scan. The rebuild loop is this idiom + customType filter + RevertCheckpoint set:
//
//   let entries; try { entries = ctx.sessionManager.getEntries(); } catch { return; }  // fail-open read
//   if (!Array.isArray(entries)) return;
//   for (const e of entries) {
//     if (typeof e !== "object" || e === null || Array.isArray(e)) continue;   // entry-kind guard
//     try {
//       const ee = e as { type?: unknown; customType?: unknown; data?: unknown };
//       // …field reads with typeof guards; skip on any bad/missing field…
//     } catch { /* throwing-Proxy entry → skip */ }
//   }
//
// CRITICAL INVARIANTS for the rebuild copy:
//   - getEntries() wrapped in try/catch → fail-open (no rebuild on a throwing sessionManager). C12: read FRESH.
//   - Array.isArray(entries) guard (a non-array → skip the whole pass).
//   - Per-entry: object-kind guard → try { narrowed reads } catch { skip }. A throwing Proxy `get` trap is
//     swallowed, never thrown.
//   - Custom-type filter: type==="custom" && customType==="mulligan:revert-checkpoint" (anything else: skip).
//   - Field guards: label/ref are non-empty strings; backend is literally "git"|"cas" (NOT "none" — commands.ts
//     only writes when backend!=="none"). Anything else: skip (fail-open).
//   - has() verification (the only await in the loop): try/catch → present boolean; skip when false.
//   - rt.snapshots?.set(label, {…}) — optional chaining for a hand-built-runtime safety net.
//
// NON-GOALS (explicitly out of scope — owned by other tasks):
//   - DO NOT touch test/integration/revert-edge.test.ts (sibling P1.M2.T1.S2 converts the manual rebuild).
//   - DO NOT change the persisted control-entry shape (commands.ts:226) — read≡write, no migration.
//   - DO NOT add afterRef (checkpoints capture once; BUG-001 relies on its absence).
//   - DO NOT add a config knob or a new event handler (purely additive inside the existing session_start try).
//   - DO NOT import readOwn/isRecord (module-private) — inline guards only.
```

### Integration Points

```yaml
PRODUCTION (src/index.ts — the ONLY source change):
  - session_start handler: +rebuild pass inside the existing try block, after `await gcTurnSnapshots(rt);`
  - session_start JSDoc: +Mode-A paragraph documenting the rebuild (spec/14 §5 / E32 / BUG-002)
  - imports: NONE added (the inline literal type-checks structurally); OPTIONALLY `import type { RevertCheckpoint }`
    ONLY if tsc requires it (it should not)

NO CHANGES TO: src/commands.ts (write site — read≡write), src/markers.ts (RevertCheckpoint), src/runtime.ts,
  src/snapshot/store.ts (has/NoOpStore), any src/tools/*, any test file (P1.M2.T1.S2 owns the test conversion),
  config, package.json, tsconfig.json. This task is strictly ONE production file, additive.
```

## Validation Loop

> NOTE: TypeScript + vitest project. Gates are `npm run typecheck` (tsc --noEmit, strict) and
> `npm test` (vitest run). There is NO ruff/mypy/eslint (those are Python/template tools — DO NOT APPLY).
> package.json scripts: `test`, `typecheck`, `smoke`, `prepublishonly`.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # = tsc --noEmit (strict). MUST be clean.
# Expected: zero errors. If tsc flags the inline object literal, add `import type { RevertCheckpoint } from
# "./markers.js";` (type-only). Confirm NO other new import was added:
grep -nE '^import ' src/index.ts | tail -5
# Expected: the existing imports unchanged (+ at most the one optional type-only RevertCheckpoint import).
```

### Level 2: Unit / Integration Tests (Component Validation)

```bash
# Full suite — the existing F-revert-reload test still passes (it does its own manual rebuild on rt2 and
# never invokes the production session_start handler; see GOTCHA #4). No test should regress.
npm test                 # = vitest run
# Expected: all green (1277+ tests). If a snapshot/revert test regressed, the rebuild pass likely has a bug.

# Targeted run of the cross-reload test for fast feedback:
npx vitest run test/integration/revert-edge.test.ts
# Expected: both it-cases green (F-revert-granularity + F-revert-reload).
```

### Level 3: Cross-Reload Behavior Verification (THE key check for this bug)

```bash
# Prove the PRODUCTION rebuild populates rt.snapshots after a simulated /resume. This script drives the real
# session_start handler via the extension factory against a temp git repo + a fake ctx that replays a
# persisted mulligan:revert-checkpoint entry. (If a standalone harness is awkward, the definitive proof is
# sibling P1.M2.T1.S2's converted F-revert-reload test — but a quick sanity check here:)
#
# Conceptually (the assertion that must now hold in production):
#   1. /mulligan_checkpoint x  →  commands.ts:226 writes {customType:"mulligan:revert-checkpoint", data:{label:"ckpt:x", ref:R0, backend:"git"}}
#   2. simulate /resume: resetRuntime(sid) (as session_start does) + re-detectAndCreate(same storage) → rt.store set, rt.snapshots FRESH EMPTY
#   3. the production session_start rebuild pass (THIS task) runs → scans getEntries() → rt.snapshots.set("ckpt:x", {beforeRef:R0, backend:"git", turnIndex:-1, …})
#   4. assert: rt.snapshots.get("ckpt:x").beforeRef === R0   (was UNDEFINED before this fix)
#   5. mulligan_rewind(granularity:"checkpoint", checkpoint:"x", revert_file_changes:true) → proceeds to store.restore(R0) (NOT the "no snapshot" skip)

# A minimal Node sanity that the rebuild logic (extracted) behaves on a fixture entry stream:
node --input-type=module -e '
  // Fixture: the exact control-entry shape commands.ts:226 writes
  const entries = [
    { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:x", ref: "abc123", backend: "git" } },
    { type: "custom", customType: "mulligan:rewind", data: { kind: "rewind" } },          // unrelated → skipped
    { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:bad", ref: "", backend: "git" } }, // empty ref → skipped
    "not-an-object",                                                                       // skipped
    { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:y", ref: "def456", backend: "cas" } },
  ];
  const rebuilt = new Map();
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    const ee = e;
    if (ee.type !== "custom" || ee.customType !== "mulligan:revert-checkpoint") continue;
    const d = ee.data;
    if (typeof d.label !== "string" || !d.label) continue;
    if (typeof d.ref !== "string" || !d.ref) continue;
    if (d.backend !== "git" && d.backend !== "cas") continue;
    rebuilt.set(d.label, { label: d.label, backend: d.backend, beforeRef: d.ref, turnIndex: -1, ts: Date.now() });
  }
  console.log("rebuilt keys:", [...rebuilt.keys()]);                 // [ "ckpt:x", "ckpt:y" ]
  console.log("ckpt:x:", JSON.stringify(rebuilt.get("ckpt:x")));      // beforeRef abc123, backend git, turnIndex -1
  console.assert(rebuilt.has("ckpt:x") && rebuilt.has("ckpt:y") && !rebuilt.has("ckpt:bad"), "filter OK");
'
# Expected: rebuilt keys [ckpt:x, ckpt:y]; ckpt:x has beforeRef abc123/backend git/turnIndex -1; ckpt:bad excluded.
```

### Level 4: Adversarial / Fail-Open Verification

```bash
# Prove the rebuild NEVER throws + skips bad entries, on adversarial input (the never-block-session_start guarantee):
node --input-type=module -e '
  const throwingProxy = new Proxy({}, { get() { throw new Error("boom"); } });
  const entries = [
    throwingProxy,                                                       // throwing get trap → per-entry catch → skip
    null, undefined, 42, "str", [],                                      // non-objects / arrays → skip
    { type: "custom", customType: "mulligan:revert-checkpoint", data: null },          // null data → skip
    { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: 123 } },// non-string label → skip
    { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ok", ref: "r", backend: "NONE" } }, // bad backend → skip
  ];
  let rebuilt = 0;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e;
      if (ee.type !== "custom" || ee.customType !== "mulligan:revert-checkpoint") continue;
      const d = ee.data;
      if (typeof d !== "object" || d === null || Array.isArray(d)) continue;
      if (typeof d.label !== "string" || typeof d.ref !== "string" || (d.backend !== "git" && d.backend !== "cas")) continue;
      rebuilt++;
    } catch { /* throwing entry → skip */ }
  }
  console.log("rebuilt count:", rebuilt, "(expected 0 — all entries adversarial)");   // 0
  console.log("adversarial OK — no throw");
'
# Expected: rebuilt count 0; "adversarial OK — no throw" (the throwingProxy is caught per-entry, never escapes).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (no TS errors; at most one optional `import type { RevertCheckpoint }`).
- [ ] `npm test` full suite green — including the UNCHANGED F-revert-reload (GOTCHA #4).
- [ ] `npx vitest run test/integration/revert-edge.test.ts` — both it-cases pass.
- [ ] Confirmed ONLY `src/index.ts` modified (`git diff --name-only` shows exactly that one file).

### Feature Validation

- [ ] The rebuild pass is INSIDE the existing session_start try block, AFTER `await gcTurnSnapshots(rt);`.
- [ ] It scans `ctx.sessionManager.getEntries()` for `type==="custom" && customType==="mulligan:revert-checkpoint"`.
- [ ] Each match reconstructs a RevertCheckpoint: beforeRef←data.ref, backend←data.backend, turnIndex:-1, ts←Date.now(), NO afterRef.
- [ ] rt.snapshots is set under data.label (the "ckpt:<name>" key the rewind tool looks up).
- [ ] The optional `rt.store.has(ref)` verification skips absent/NoOpStore/throwing refs (fail-open).
- [ ] Malformed entries (non-string fields, bad backend, throwing-Proxy) are skipped, never thrown.
- [ ] Last-wins for duplicate labels (iterate in order).

### Code Quality Validation

- [ ] Mirrors the `clearCheckpointByName` defensive entry-scan idiom (Array.isArray + per-entry object guard + try/catch-per-entry + typeof field guards).
- [ ] NO readOwn/isRecord import (module-private — inline guards only).
- [ ] Mode-A JSDoc paragraph added to the session_start revert block citing spec/14 §5 / E32 / BUG-002.
- [ ] Strictly additive — no new event handler, no new config knob, no behavior change to detectAndCreate/gcTurnSnapshots/resetRuntime.

### Documentation & Deployment

- [ ] JSDoc documents the rebuild pass (Mode A — rides WITH the work).
- [ ] No user-facing/config/API/docs surface change (nothing to deploy beyond the code).

---

## Anti-Patterns to Avoid

- ❌ Don't add a NEW `pi.on("session_start", …)` or a new try/catch OUTSIDE the existing block — the rebuild
  is a few lines INSIDE the existing try, sharing its outer catch (GOTCHA #1).
- ❌ Don't run the rebuild BEFORE `gcTurnSnapshots` — order matters (ckpt:* refs must survive gc first; GOTCHA #2).
- ❌ Don't import `readOwn`/`isRecord` from filter.ts — they're module-private. Use inline typeof guards
  exactly like `clearCheckpointByName` (GOTCHA #3).
- ❌ Don't edit `test/integration/revert-edge.test.ts` — that's sibling P1.M2.T1.S2's job (GOTCHA #4).
- ❌ Don't synthesize an `afterRef` — checkpoints capture once; its ABSENCE is required by the BUG-001 fix
  (GOTCHA #6).
- ❌ Don't skip the `has()` verification to "save a call" — it's the cheap guard that prevents dangling
  rt.snapshots entries pointing at GC'd/lost refs (fail-open on false/throw; GOTCHA #7).
- ❌ Don't add reverse-iterate/break logic for duplicate labels — in-order `set()` already gives last-wins
  (GOTCHA #8).
- ❌ Don't touch commands.ts:226 (the write site) or the persisted `{label, ref, backend}` shape — read≡write,
  no migration. The label is already namespaced "ckpt:<name>" at write time.
- ❌ Don't expand scope into BUG-001 (afterRef) or BUG-004 (changedPaths) — those are separate fixes. This
  task is ONLY the BUG-002 read-side rebuild.
- ❌ Don't add a config gate or a backend==="none" branch — `has()` on NoOpStore returns false and skips all
  entries, which is the correct fail-open behavior (no real storage = nothing to restore).

---

## Confidence Score: 9/10

**Why high**: This is the missing read-half of an already-shipped write/read pair — small, surgical,
purely additive (one production file, ~25 lines + a JSDoc paragraph). The fix strategy is pinned in
`bug_fix_analysis.md §BUG-002`; the exact insert point (session_start, after gcTurnSnapshots), the exact
control-entry shape (`{type:"custom", customType:"mulligan:revert-checkpoint", data:{label,ref,backend}}`),
the `RevertCheckpoint` reconstruction mapping, and the defensive entry-scan idiom to mirror
(`clearCheckpointByName`) are all specified verbatim. The verbatim implementation is given. No new types,
no new imports (beyond an optional type-only one), no config/API surface. The existing test still passes
(it does its own independent manual rebuild on a separate runtime).

**Residual risk (the 1 point)**: the definitive end-to-end proof that the PRODUCTION session_start handler
rebuilds `rt.snapshots` (vs. the test's manual simulation) lands in sibling **P1.M2.T1.S2** (the test
conversion) — this task's Level 3 sanity checks the rebuild LOGIC on a fixture entry stream and confirms the
full suite stays green, but does not itself add an integration test that invokes the real session_start
handler. Mitigated by: the rebuild is a faithful production-ization of the exact manual rebuild the
F-revert-reload test already proves correct, and the fail-open guarantees (Level 4) ensure it cannot break
session_start regardless.