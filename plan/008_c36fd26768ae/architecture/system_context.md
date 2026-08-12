# System Context — v1.2 Working-Tree Revert

## Overview
The v1.2 delta adds an **opt-in working-tree revert** capability to `mulligan_rewind`. When enabled, the extension captures snapshots of the working-tree files before each turn (and before checkpoints), so a rewind can restore those files to their pre-span state — preventing weaker models from re-reading files after a rewind (which *adds* context instead of shedding it).

## Existing Architecture (v1.1 baseline)
The extension is a Pi coding-agent extension (`src/index.ts` factory function). Key components:

| Component | File | Role |
|-----------|------|------|
| Config | `src/config.ts` | `MulliganConfig` interface + `DEFAULT_CONFIG` + `validateConfig` (never throws) |
| Markers | `src/markers.ts` | `RewindMarker`/`ShrinkMarker`/`TurnMetric`/`CancelMarker` + `appendRewindMarker`/`leaveNote`/`setCheckpoint` |
| Runtime | `src/runtime.ts` | Module-scoped `Map<string, SessionRuntime>` + `freshRuntime`/`getRuntime`/`resetRuntime`/`clearAll` |
| Filter | `src/filter.ts` | `readMarkers` (active markers) + the session-tree filtering |
| Transforms | `src/transforms.ts` | Pure pipeline: `resolveLastToolCallGroup`/`resolveLastTurn`/`applyRewind`/`applyShrink` |
| Tools | `src/tools/*.ts` | `rewind.ts`/`shrink.ts`/`audit.ts`/`cancel.ts`/`checkpoint.ts` — typebox-schema'd, factory-pattern |
| Commands | `src/commands.ts` | Human-facing slash commands: `/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit` |
| Wiring | `src/index.ts` | Factory function: registers tools, commands, and event handlers |
| Nudges | `src/nudges.ts` | `registerBloatReminder` (tool_result), `registerTurnEndMetric` (turn_end) |
| Banner | `src/banner.ts` | Active-checkpoint persistent reminder |
| Settings | `src/settings.ts` | Deep-merge of user settings.json over defaults |
| Ledger | `src/ledger.ts` | `extractFileLedger` (deterministic file-list extraction from span) |
| Notes | `src/notes.ts` | `validateNote`/`renderNote` (the agent's self-authored resume note) |
| Tokens | `src/tokens.ts` | `estimateTokens` (heuristic per-message token estimation) |
| Log | `src/log.ts` | `setLogFile`/`log` (file-based structured logging) |

## New Subsystem: `src/snapshot/` (4 files)
| File | Role |
|------|------|
| `paths.ts` | Pure path-safety helpers (0 Pi imports, fully unit-testable) |
| `store.ts` | `SnapshotStore` interface + `detectAndCreate` factory + `AsyncMutex` |
| `git.ts` | `GitBackend` — external shadow repository (preferred in a git repo) |
| `cas.ts` | `CasBackend` — content-addressed store (universal, non-git) + explicit-paths mode |

## Integration Points (where the new code touches existing files)
1. **`config.ts`** — add `revert` block (8 fields) to `MulliganConfig`, `DEFAULT_CONFIG`, `validateConfig`
2. **`markers.ts`** — add optional `revert` field to `RewindMarker` + new `RevertCheckpoint` type
3. **`runtime.ts`** — add `snapshots?: Map<string, RevertCheckpoint>` to `SessionRuntime` + init in `freshRuntime`
4. **`index.ts`** — register `turn_start`/`agent_end` handlers, create store, thread into rewind tool, teardown on shutdown
5. **`tools/rewind.ts`** — add `revert_file_changes`/`delete_created_files` params, step 6b revert logic, E5 warning reword, desc update
6. **`commands.ts`** — add step 4b (capture `ckpt:<name>`) to `makeCheckpointCommand`

## Pi Event Surface (verified)
- `pi.on("turn_start", handler)` — `{ type, turnIndex, timestamp }` → before-snapshot capture
- `pi.on("agent_end", handler)` — `{ type, messages }` → after-snapshot capture (drift detection)
- `ctx.cwd: string` — the working-tree root
- `ctx.sessionManager` (readonly) — session tree access
- Both `turn_start` and `agent_end` are confirmed real in the Pi types.d.ts and used in Pi's own `git-checkpoint.ts` example

## Key Design Decisions
1. **Opt-in by default** — `config.revert.enabled: false`; three consent layers (config → per-call flags → delete gate)
2. **External shadow repo** — git writes NEVER touch the user's `.git`; all writes go to `GIT_DIR=<storageDir>/<key>`
3. **Boundary-granular only** — file revert works at `last_turn`/`checkpoint`; `last_tool_call_group` is refused (noted)
4. **Refuse-on-dirty** — the dirty guard refuses the WHOLE file-revert if any affected path drifted since `agent_end`
5. **Best-effort, never throws** — all revert failures are logged + folded into marker; context rewind always proceeds
6. **Session-tree untouched** — working-tree revert is orthogonal to the append-only session tree model

## Discrepancy: driftThresholdTokens
The spec (§04 §7) says `6000` but the code has `4000` due to BUG-003 ("at 6000 with >, criterion (b) never fired"). This is a verification item, NOT a new task — the BUG-003 fix takes precedence. Noted here for downstream agents.