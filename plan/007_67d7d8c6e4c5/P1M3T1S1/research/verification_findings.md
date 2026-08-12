# Verification Findings — P1.M3.T1.S1 (index.ts: stop registering the checkpoint agent tool)

**Task**: Remove `mulligan_checkpoint` from the agent-tool registrations in `src/index.ts` (v1.1: checkpoint
moves to a human slash command — spec/05 §3 REMOVED, E23 RESOLVED). 4 contract edits + 2 coherence edits.
Do NOT delete `src/tools/checkpoint.ts` (Phase 2 reuses `validCheckpointName` + `NAME_RE`).

Ground truth read: `src/index.ts` (full), `architecture/change_surface.md` §Change 1, P1M2T1S3/PRP.md (parallel
sibling — test-only, zero overlap), spec §h2.58 (checkpoint REMOVED) + §h2.132 (tool count 5→4).

---

## A. THE EDITS (verbatim current → new)

### Edit 1 — line 10 (the import) — REMOVE
**FIND**: `import { makeCheckpointTool } from "./tools/checkpoint.js";`
**ACTION**: delete the whole line. After removal the tool imports are rewind/shrink/audit/cancel (4).

### Edit 2 — line 49 (the registration) — REMOVE
**FIND**: `  pi.registerTool(makeCheckpointTool(pi));`
**ACTION**: delete the whole line. After removal exactly 4 `pi.registerTool(...)` calls remain (rewind/shrink/audit/cancel).

### Edit 3 — line 17 (JSDoc) — "5" → "4"
**FIND** (substring): `Wires all 5 agent-callable tools,`
**REPLACE**: `Wires all 4 agent-callable tools,`

### Edit 4 — line 44 (the registration comment block) — "5" → "4" + drop checkpoint refs
**FIND** (verbatim, 3-line comment):
```
  // 3. Register all 5 agent-callable tools. rewind/shrink/checkpoint/cancel are FACTORIES capturing `pi`
  //    via closure (their execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …)/setCheckpoint(pi, …)
  //    but execute() does NOT receive pi). auditTool is a PLAIN const (audit needs no pi).
```
**REPLACE** (coherent post-removal: 4 tools, rewind/shrink/cancel factories, no setCheckpoint):
```
  // 3. Register all 4 agent-callable tools (spec/03 §2.1; v1.1: mulligan_checkpoint moved to a human
  //    slash command — spec/05 §3). rewind/shrink/cancel are FACTORIES capturing `pi` via closure (their
  //    execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …) but execute() does NOT receive pi).
  //    auditTool is a PLAIN const (audit needs no pi).
```

### Edit 5 (coherence) — line 13 (cancel import comment) — "5th" → "4th"
**FIND**: `import { makeCancelTool } from "./tools/cancel.js"; // 5th agent-callable tool (P3.M1.T3.S1)`
**REPLACE**: `import { makeCancelTool } from "./tools/cancel.js"; // 4th agent-callable tool (P3.M1.T3.S1)`
**Why**: with checkpoint gone, cancel is the 4th (last) registered tool; "5th" is now contradictory.

### Edit 6 (coherence) — line 51 (cancel registration comment) — "5th" → "4th"
**FIND**: `  pi.registerTool(makeCancelTool(pi)); // 5th tool — marker retraction (P3.M1.T3.S1 / E21)`
**REPLACE**: `  pi.registerTool(makeCancelTool(pi)); // 4th tool — marker retraction (P3.M1.T3.S1 / E21)`
**Why**: same — cancel is the 4th tool now. (Leaving "4 agent-callable tools" in the JSDoc alongside "5th tool"
on line 51 is an internal contradiction a reviewer would flag.)

## B. CRITICAL — DO NOT DELETE src/tools/checkpoint.ts
- Contract step 3: "Do NOT delete src/tools/checkpoint.ts — Phase 2 reuses validCheckpointName + NAME_RE."
- Verified consumers that still import from it (these keep the file alive; S1 touches NONE of them):
  - `test/integration/smoke.ts:40` imports `makeCheckpointTool` (calls it at 252/268 — independent of index.ts).
  - `test/edge-cases.test.ts:45` imports `makeCheckpointTool` + `validCheckpointName`.
  - `test/tools/checkpoint.test.ts` — the unit-test file (S2/Phase-2 territory; leave it).
- After S1, checkpoint.ts becomes **unregistered dead code** (no production import) but its exports are still
  referenced by tests → tsc stays clean (no unused-export error; tsconfig has NO noUnusedLocals). Phase 2
  (P2.M1.T1) extracts `validCheckpointName`/`NAME_RE` into commands.ts and may then delete it.

## C. THE ONE TEST THAT BREAKS (S2's job, NOT S1's)
S1 edits index.ts ONLY. The single test that breaks from this edit:
- **`test/index.test.ts`** — line 66 `it("registers all 5 tools with the exact names"…)`, line 70
  `expect(tools).toHaveLength(5)`, line 72 the sorted-name array includes `"mulligan_checkpoint"`. After S1
  the factory registers 4 tools → `toHaveLength(5)` FAILS and the array no longer contains `mulligan_checkpoint`.
  **This is the expected handoff to P1.M3.T1.S2** ("Tests: drop the checkpoint-tool registration assertion +
  update tool-count references"). S1 does NOT touch any test.
- Other test files that import `makeCheckpointTool` (smoke.ts:40, edge-cases.test.ts:45) import it DIRECTLY
  from `src/tools/checkpoint.js` — they do NOT go through index.ts, so they still compile + run. S2/Phase-2
  owns repurposing/removing those; S1 leaves them alone.

## D. VALIDATION (S1 cannot gate on full `npm test` — it's RED until S2 lands)
- **`npm run typecheck`** (tsc --noEmit) → **clean**. Removing the import + registration does NOT break types:
  makeCheckpointTool is still exported from checkpoint.ts; index.ts just stops importing/calling it. tsconfig
  has NO `noUnusedLocals`, so checkpoint.ts's now-unregistered exports don't error.
- **grep confirms**: 0 `makeCheckpointTool` in index.ts; exactly 4 `pi.registerTool` calls; JSDoc says "4".
- **`npx vitest run test/index.test.ts`** → EXPECTED RED on the registration-count assertion (proves the edit
  landed; the ONLY failure should be the 5-tool / sorted-array assertion — NOT a type error or unrelated test).
  Document this as the S2 handoff; do NOT fix it here.

## E. SCOPE
- EDIT: `src/index.ts` ONLY (4 contract edits + 2 coherence edits). [Mode A — factory JSDoc rides with the work.]
- DO NOT delete/edit `src/tools/checkpoint.ts` (Phase 2 reuses it; tests still import it).
- DO NOT touch any `test/*` (S2 owns test fallout; parallel sibling P1.M2.T1.S3 owns tokens/turn_metric/drift_nudge tests).
- DO NOT edit commands.ts/banner.ts (those are P2, not yet built).

## F. FILES READ (evidence)
src/index.ts (full — lines 10, 13, 17, 44-51), architecture/change_surface.md §Change 1, P1M2T1S3/PRP.md
(parallel sibling — test-only, no overlap), spec §h2.58 (checkpoint REMOVED) + §h2.132 (count 5→4),
grep of makeCheckpointTool/registerTool references across src/ + test/.