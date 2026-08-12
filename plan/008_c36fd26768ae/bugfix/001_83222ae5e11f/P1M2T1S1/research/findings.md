# P1.M2.T1.S1 (BUG-002) — Cross-reload snapshot rebuild: research notes

Source: bug_fix_analysis.md §BUG-002, src/index.ts (session_start handler), src/commands.ts
(write site + clearCheckpointByName entry-scan idiom), src/markers.ts (RevertCheckpoint),
src/snapshot/store.ts (has/NoOpStore), test/integration/revert-edge.test.ts (manual rebuild sim).

## 1. The bug (one paragraph)
`/mulligan_checkpoint x` captures a snapshot ref and (a) sets `rt.snapshots.set("ckpt:x", …)` in
memory AND (b) persists `pi.appendEntry("mulligan:revert-checkpoint", {label, ref, backend})` for
cross-reload (commands.ts:226). But session_start (index.ts, the only /resume entry point) calls
`resetRuntime(sid)` → `rt.snapshots` becomes a FRESH empty Map, then `detectAndCreate` + `gcTurnSnapshots`
— and NEVER reads the persisted control entries back. So after /resume, `rt.snapshots.get("ckpt:x")` is
`undefined`, and a `mulligan_rewind(granularity:"checkpoint", revert_file_changes:true)` hits rewind.ts
step 6b branch 4 ("no working-tree snapshot for this boundary") → 0 files reverted. E32 is therefore
NOT resolved in shipped code. The fix: add the missing READ side in session_start.

## 2. The exact insert point (src/index.ts session_start handler)
Inside the `if (!getConfig().revert.enabled) return;` → `try { … }` block, AFTER
`await gcTurnSnapshots(rt);` (which only clears `turn*` keys, NOT `ckpt:*`), ADD the rebuild pass.
Order matters: gcTurnSnapshots must run FIRST (it drops stale turn refs but exempts checkpoints), so
the rebuilt checkpoint refs are still present when `has()` verifies them.

## 3. The data shapes
- **Control entry** (persisted by commands.ts:226): `{ type: "custom", customType: "mulligan:revert-checkpoint",
  data: { label: "ckpt:<name>", ref: <sha>, backend: "git" | "cas" } }` — confirmed by the test's filter
  (`(e as {customType?}).customType === "mulligan:revert-checkpoint"` + `ce.data.{label,ref,backend}`).
- **RevertCheckpoint** (markers.ts:121): `{ label, backend, beforeRef, afterRef?, turnIndex, ts }`.
  The rebuild constructs `{ label: data.label, backend: data.backend, beforeRef: data.ref, turnIndex: -1,
  ts: Date.now() }` — turnIndex:-1 is the checkpoint sentinel (matches commands.ts; rewind resolves by label).
  NO afterRef (checkpoints capture once).

## 4. The entry-scan idiom to mirror (commands.ts clearCheckpointByName, lines 120-145)
```
let entries; try { entries = ctx.sessionManager.getEntries(); } catch { return; }   // fail-open
if (!Array.isArray(entries)) return;
for (const e of entries) {
  if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
  try {
    const ee = e as { type?; customType?; data? };
    if (ee.type !== "custom") continue;
    if (ee.customType !== "mulligan:revert-checkpoint") continue;
    const data = ee.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    const d = data as { label?; ref?; backend? };
    if (typeof d.label !== "string" || !d.label) continue;
    if (typeof d.ref !== "string" || !d.ref) continue;
    if (d.backend !== "git" && d.backend !== "cas") continue;
    // optional has() verification (ref survived gc / storage intact)
    let present = true; try { present = await rt.store.has(d.ref); } catch { present = false; }
    if (!present) continue;
    rt.snapshots?.set(d.label, { label: d.label, backend: d.backend, beforeRef: d.ref, turnIndex: -1, ts: Date.now() });
  } catch { /* throwing-Proxy entry → skip */ }
}
```
This is the EXACT defensive shape the contract demands ("per-entry typeof guards, try/catch per entry").

## 5. Design decisions
- **has() verification IS included** (the contract's OPTIONAL step). It's cheap (one git rev-parse / one
  CAS file check), runs once per checkpoint at session_start, and prevents rebuilding a checkpoint whose
  ref was GC'd or whose storage was lost (E28 fail-open — NoOpStore.has→false skips all entries, correct).
  Implemented fail-open: `present=false` on a throw → skip the entry.
- **Last-wins for duplicate labels**: iterate IN ORDER; the final `set()` wins naturally. (A re-set
  checkpoint writes a new control entry; the later one overwrites. Edge: if the latest ref is gone but an
  earlier survives, the stale earlier ref wins — acceptable, not data loss, and rare.)
- **Wrap the whole pass defensively**: it sits INSIDE the existing session_start `try/catch` (which logs
  "session_start.store"), AND each entry has its own try/catch. A rebuild failure NEVER blocks session_start.
- **No backend === "none" guard needed**: `has()` on NoOpStore returns false → no entries rebuilt → correct
  (no real storage = nothing to restore). Mirrors how commands.ts gates on backend !== "none" at WRITE time.
- **No new imports needed in index.ts**: `RevertCheckpoint` is constructed inline as an object literal
  assigned to the already-typed `rt.snapshots?.set(label, …)` — tsc infers the shape from the Map's value
  type (`Map<string, RevertCheckpoint>`). `getEntries/has` use existing `ctx`/`rt`. (If tsc needs the type,
  a `import type { RevertCheckpoint } from "./markers.js"` is the only addition — type-only, erased.)

## 6. Relationship to siblings (do NOT do their work)
- **P1.M1.T1.S2** (test task, parallel/just-done): strengthened F-revert-reload to exercise a REAL write
  (BUG-001 guard). It RETAINS the manual rebuild simulation with a comment naming BUG-002/P1.M2 as the
  future production fix. THIS task (S1) implements that production fix; S2 does NOT remove the manual sim.
- **P1.M2.T1.S2** (sibling, separate): will UPDATE the F-revert-reload test to verify the PRODUCTION
  rebuild path (remove the manual simulation now that session_start does the read). I must NOT touch the
  test — only src/index.ts production code.
- **Scope**: production-only (src/index.ts). No test changes, no config/API/docs surface change.

## 7. Validation
- `npm run typecheck` clean.
- `npm test` green (the EXISTING F-revert-reload test still passes — it manually rebuilds AND now
  production also rebuilds; the extra production rebuild is a harmless superset that produces the same
  rt2.snapshots state the test then overwrites with its manual sim. Actually — see GOTCHA in the PRP:
  the test assigns rt2.store + calls gcTurnSnapshots + does its OWN manual rebuild on rt2; production's
  rebuild runs in the REAL session_start handler, which the test does NOT invoke. So no conflict until S2.)