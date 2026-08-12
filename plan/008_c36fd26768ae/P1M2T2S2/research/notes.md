# Research Notes — P1.M2.T2.S2 (SessionRuntime.snapshots)

## Source of truth (read in full)
- **src/runtime.ts** — the ONLY source file modified. Module-scoped `runtimes = new Map<string, SessionRuntime>()`.
  - `SessionRuntime` interface currently has 10 fields: sessionId, seq, tokenBaseline, lastTurnIndex,
    lastFiltered, lastFilterTs, pendingBloatHits, shrinkMissCounts, aboveHighWater, rewindRefusedTurnIndex.
  - `freshRuntime(sessionId)` returns the default object literal (the place to init `snapshots: new Map()`).
  - `resetRuntime(sessionId)` → `runtimes.delete(sessionId)` (entry drop → snapshots Map GC'd automatically — NO edit needed).
  - `clearAll()` → `runtimes.clear()` (NO edit needed).
  - `getRuntime(sessionId)` returns the LIVE mutable ref (callers mutate fields in place).
- **test/runtime.test.ts** — vitest. `beforeEach/afterEach` call `clearAll()`. **CONTAINS AN EXACT-SHAPE TEST**:
  `it("getRuntime creates a runtime with the exact default shape on first access", () => { expect(rt).toEqual({...}); })`.
  This expected object literal does NOT include `snapshots` → will BREAK when freshRuntime gains `snapshots`. MUST update.
- **src/markers.ts** (parallel sibling P1.M2.T2.S1 adds the type) — exports `interface RevertCheckpoint`.
  Pure self-contained shape: `{ label; backend:"git"|"cas"; beforeRef; afterRef?; turnIndex; ts }`.

## Toolchain (verified from package.json)
- `npm run typecheck` → `tsc --noEmit` (strict — PRIMARY gate)
- `npm test` → `vitest run`
- **NO eslint/ruff/mypy/uv** (those are Python tools; this is a pure TypeScript project).

## Import convention (verified via grep across src/)
- Source files: `import type { X } from "./peer.js"` — `.js` extension (ESM + tsc output convention).
- Test files: `import { type X } from "../src/peer.js"`.
- `import type` is used pervasively (filter.ts, nudges.ts, commands.ts, markers.ts). runtime.ts currently has NONE.

## The 6 gotchas (full rationale in PRP §"Known Gotchas")
1. `import type` is ERASED by tsc — zero runtime coupling. The header "Imports NOTHING" note is about RUNTIME
   imports (Pi/config/log), NOT type-only imports. Refine the header note so it stays truthful after adding the import.
2. The exact-shape `toEqual` test in runtime.test.ts BREAKS when `snapshots` is added to freshRuntime — MUST update
   the expected literal (run `npm test -- test/runtime.test.ts` to surface ALL shape assertions).
3. `snapshots?` is OPTIONAL in the interface (so `{ } as SessionRuntime` type-checks) but ALWAYS initialized in
   freshRuntime (so hooks can rely on a live Map). Type test asserts the INTERFACE type `... | undefined`.
4. Each fresh runtime gets its OWN `new Map()` — NEVER a module-level shared Map (mirrors existing
   shrinkMissCounts GOTCHA #5 / pendingBloatHits GOTCHA #5 "never leak across sessions").
5. resetRuntime/clearAll need NO change — `delete`/`clear` drop the whole runtime object (Map included).
6. RevertCheckpoint.backend is `"git" | "cas"` ONLY (no "none") — the parallel sibling's contract.

## Parallel-execution safety
- P1.M2.T2.S1 edits src/markers.ts (+RevertCheckpoint export). This task edits src/runtime.ts + test/runtime.test.ts.
  DISJOINT files. This task IMPORTS the type S1 produces — treat S1's PRP as the contract (assume it lands exactly).
- P1.M2.T1.S1 (src/snapshot/paths.ts) is complete and untouched.