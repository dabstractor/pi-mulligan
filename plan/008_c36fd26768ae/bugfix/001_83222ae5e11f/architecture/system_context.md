# System Context — v1.2 Working-Tree-Revert Bugfix

## Project Overview

**pi-mulligan** is a Pi coding-agent extension providing autonomous, token-cheap context self-rewind.
The agent can shed context produced by mistake (a bloated tool result, or a wrong-direction turn)
and leave itself a note to retry. The v1.2 release added **working-tree revert**: opt-in file
restoration on rewind so the agent doesn't re-read entire files after a rewind.

The v1.2 working-tree-revert feature is specified in `spec/14-working-tree-revert.md` and spans:
- A backend-pluggable `SnapshotStore` (`src/snapshot/store.ts`) with two backends:
  - `GitBackend` (`src/snapshot/git.ts`) — external shadow repository
  - `CasBackend` (`src/snapshot/cas.ts`) — content-addressed store
- Capture hooks (`src/capture.ts`) — turn_start/agent_end snapshot lifecycle
- The rewind tool integration (`src/tools/rewind.ts`) — dirty guard + restore orchestration
- Runtime state (`src/runtime.ts`) — per-session in-memory `rt.snapshots` Map

## Architecture: Snapshot/Restore Flow

```
session_start
  ├── detectAndCreate(cwd, config) → SnapshotStore (git/cas/none)
  ├── rt.store = store (cached on SessionRuntime)
  └── gcTurnSnapshots(rt)  ← prompt-boundary GC (drops turn/* refs)

turn_start (capture.ts)
  ├── gcTurnSnapshots(rt)  ← drop prior turn/* refs + reclaim
  └── rt.store.capture("turn") → beforeRef stored in rt.snapshots.get("turn")

[multiple tool_calls happen here — write/edit/bash modify files]

agent_end (capture.ts)
  └── rt.store.capture("turn-after") → afterRef stored on rt.snapshots.get("turn").afterRef

mulligan_rewind(revert_file_changes:true) (rewind.ts step 6b)
  ├── resolve RevertCheckpoint from rt.snapshots (key "turn" or "ckpt:<name>")
  ├── affectedPaths = ledger.modifiedFiles  ← BUG-004: should use snapshot diff
  ├── afterRef = checkpoint.afterRef ?? checkpoint.beforeRef  ← BUG-001: wrong for checkpoints
  ├── store.dirtyCheck(afterRef, affectedPaths) → driftedPaths
  │     if drifted → REFUSE file revert (E30)
  └── store.restore(checkpoint.beforeRef, opts) → RestoreResult
        ├── reverted[] ← files written back to beforeRef content
        ├── deleted[]  ← span-created files removed
        ├── failed[]   ← per-path I/O failures
        ├── skipped[]  ← BUG-005: never populated
        └── refused[]  ← dirty-guard refuse (not used — rewind.ts does the refuse)
```

## Key Files & Responsibilities

| File | Role |
|------|------|
| `src/snapshot/store.ts` | `SnapshotStore` interface + `detectAndCreate()` factory + `AsyncMutex` + `NoOpStore` |
| `src/snapshot/git.ts` | `GitBackend` — shadow-repo capture/restore/dirtyCheck/gc/has/retire/destroy |
| `src/snapshot/cas.ts` | `CasBackend` — content-addressed store + `captureExplicitPaths()` mode |
| `src/capture.ts` | turn_start/agent_end capture hooks + `gcTurnSnapshots()` helper |
| `src/index.ts` | Extension factory: wires all hooks, session_start/shutdown lifecycle |
| `src/commands.ts` | `/mulligan_checkpoint` — writes `mulligan:revert-checkpoint` control entry |
| `src/tools/rewind.ts` | `mulligan_rewind` tool — step 6b dirty guard + restore orchestration |
| `src/runtime.ts` | `SessionRuntime` — per-session in-memory state incl. `rt.snapshots` Map + `rt.store` |
| `src/markers.ts` | `RevertCheckpoint` interface + rewind marker persistence |
| `src/ledger.ts` | `extractFileLedger()` — heuristic file-modification classification |
| `src/config.ts` | `MulliganConfig["revert"]` — 8-field config block |

## Data Structures

### RevertCheckpoint (src/markers.ts:121)
```ts
interface RevertCheckpoint {
  label: string;             // "turn" | "ckpt:<name>"
  backend: "git" | "cas";
  beforeRef: string;         // snapshot at turn_start / checkpoint-set
  afterRef?: string;         // snapshot at agent_end (turn only; UNDEFINED for checkpoints)
  turnIndex: number;         // -1 sentinel for checkpoints
  ts: number;
}
```

### RestoreResult (src/snapshot/store.ts)
```ts
interface RestoreResult {
  reverted: string[];  // files restored to beforeRef content
  deleted: string[];   // span-created files removed
  failed: string[];    // per-path I/O failures
  skipped: string[];   // E29 — files uncaptured due to caps (BUG-005: NEVER populated)
  refused: string[];   // dirty-guard refuse (unused — rewind.ts does the refuse)
}
```

### SessionRuntime.snapshots (src/runtime.ts)
```ts
// Map<string, RevertCheckpoint> keyed by label
// "turn"     → the current turn's {beforeRef, afterRef?} checkpoint
// "ckpt:X"   → a named checkpoint's {beforeRef} checkpoint (no afterRef — captures once)
// Cleared on session_start (resetRuntime deletes the entry)
// NOT rebuilt from persisted mulligan:revert-checkpoint entries (BUG-002)
```

## External Dependencies

- **Pi Extension API** (`@earendil-works/pi-coding-agent` v0.84.1):
  - `pi.on("tool_call", handler)` — available; fires BEFORE tool runs with `event.input.path` for write/edit
  - `WriteToolInput = { path: string, content: string }`
  - `EditToolInput = { path: string, edits: Array<{oldText, newText}> }`
  - `isToolCallEventType("write"/"edit", event)` type guard available
  - `pi.appendEntry("mulligan:revert-checkpoint", data)` — writes control entries
  - `ctx.sessionManager.getEntries()` — reads raw entry stream (for rebuilding rt.snapshots)
- **Node built-ins only** for snapshot backends: `node:crypto`, `node:fs/promises`, `node:path`, `node:child_process`
- **vitest** v1 for testing; tests run via `npm test` (`vitest run`)
- **No new npm dependencies required** for any of the seven bug fixes

## Testing Infrastructure

- Unit tests: `test/*.test.ts` (vitest, co-located per module)
- Integration tests: `test/integration/revert-{git,cas,edge}.test.ts`
- Test convention: `vitest run` from project root; integration tests use temp dirs + real git/CAS backends
- DI seams: both backends accept `deps` constructor args for mock exec/fs
- The existing 1277-test suite passes; the integration tests pass only because they exercise degenerate/contrived paths

## The Seven Bugs at a Glance

| ID | Severity | Root Cause | Affected File(s) |
|----|----------|-----------|------------------|
| BUG-001 | Critical | Checkpoint dirty-guard baseline falls back to beforeRef instead of skipping guard | `rewind.ts:~848` |
| BUG-002 | Major | session_start never reads persisted mulligan:revert-checkpoint entries | `index.ts:~113-126` |
| BUG-003 | Major | No tool_call hook feeds write/edit paths to captureExplicitPaths | `index.ts`, `capture.ts`, `cas.ts` |
| BUG-004 | Major | Dirty-guard affected set uses ledger heuristic, not snapshot diff | `rewind.ts:~844` |
| BUG-005 | Minor | RestoreResult.skipped bucket never populated | `git.ts:~650`, `cas.ts:~749` |
| BUG-006 | Minor | GitBackend lastCommit chains all commits, defeating GC | `git.ts:~366-377` |
| BUG-007 | Minor | has() not mutex-serialized per spec §4.3 | `git.ts:~560`, `cas.ts:~855` |