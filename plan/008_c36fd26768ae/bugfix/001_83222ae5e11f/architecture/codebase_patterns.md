# Codebase Patterns — Conventions to Follow

## 1. Event Handler Registration Pattern

All event hooks follow the `registerXxxHandler(pi)` factory pattern in dedicated modules:

```ts
// src/capture.ts pattern
export async function xxxHandler(event, ctx): Promise<void> {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so catch can log
    if (!getConfig().revert.enabled) return; // layer-1 gate — FIRST check
    const rt = getRuntime(sessionId);
    if (!rt.store) return; // store not created
    // ... do work ...
  } catch (e) {
    try { log("error", "capture.xxx", sessionId, { error: String(e) }); } catch {}
  }
}

export function registerXxx(pi: ExtensionAPI): void {
  pi.on("event_name", xxxHandler);
}
```

Registered in `src/index.ts` step 5:
```ts
registerTurnStartCapture(pi);  // pi.on("turn_start", ...)
registerAgentEndCapture(pi);   // pi.on("agent_end", ...)
```

**For BUG-003:** The new tool_call hook follows this exact pattern:
```ts
export function registerToolCallCapture(pi: ExtensionAPI): void {
  pi.on("tool_call", toolCallCaptureHandler);
}
```

## 2. AsyncMutex Serialization Pattern

Every store operation (capture/dirtyCheck/restore/retire/gc/destroy) acquires the per-instance mutex:

```ts
async someOp(...): Promise<...> {
  const release = await this.mutex.acquire();
  try {
    // ... serialized work ...
  } catch (err) {
    // best-effort (E27): log + return safe default
  } finally {
    release(); // GOTCHA #5 — forgotten release deadlocks all later acquire()s
  }
}
```

**For BUG-007:** `has()` must follow this same pattern in both GitBackend and CasBackend.

## 3. Best-Effort Fail-Open Pattern (E13/E27)

- Store operations NEVER reject — they catch + return safe defaults (null, [], empty RestoreResult)
- Event handlers NEVER throw — they catch + log
- The rewind tool NEVER throws — its whole body is one try/catch → refusal text
- Every operation degrades gracefully rather than blocking the turn/rewind

## 4. DI Test Seam Pattern

Both backends accept optional `deps` constructor args for unit testing:

```ts
// GitBackend
new GitBackend(cwd, config, sessionDir?, deps?: GitBackendDeps)
// deps.exec?: GitExec (fake execFile)
// deps.scan?: scan function (fake caps walk)
// deps.unlink?: fake unlink

// CasBackend
new CasBackend(cwd, config, sessionDir?, deps?: CasBackendDeps)
// deps.fs?: CasFs (fake fs — readFile/writeFile/mkdir/access/stat/readdir/unlink)
```

Unit tests inject recording fakes; integration tests use real implementations.

## 5. Shadow Repository Git Safety (GitBackend only)

Every write command carries `env.GIT_DIR=shadowDir + GIT_WORK_TREE=repoRoot` via `shadowEnv()`:
```ts
private shadowEnv(): { env: NodeJS.ProcessEnv; maxBuffer: number } {
  return {
    env: { ...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot },
    maxBuffer: 16 * 1024 * 1024,
  };
}
```

The ONLY command against the USER's git is read-only `rev-parse` (no shadow env).

## 6. Checkpoint Label Map Pattern

Pi's label map is append-only. Checking checkpoint existence / consuming labels uses a two-phase
discovery+confirm pattern:
1. Scan raw `getEntries()` for `type:"label"` entries whose `label === needle`
2. Confirm each candidate via `getLabel(id) === needle` (latest-wins)

## 7. Config Gating Order

Three-layer consent model (spec §1):
1. `config.revert.enabled` (master switch, default false) — checked FIRST
2. Per-call flags (`revert_file_changes`, `delete_created_files`) — set by the agent
3. `config.revert.allowDeleteCreatedFiles` (kill-switch, default false) — for deletion only

## 8. Test Conventions

- Unit tests: `test/<module>.test.ts` using vitest `describe/it/expect`
- Integration tests: `test/integration/revert-*.test.ts` — create temp dirs, real backends
- Tests verify git safety (no objects written to source repo, no reflog changes)
- Tests use DI seams for mock exec/fs where deterministic assertions are needed
- `npm test` runs `vitest run` (all tests); `npm run typecheck` runs `tsc --noEmit`

## 9. Key Type Imports

```ts
// From Pi
import type { ExtensionAPI, ExtensionContext, ToolCallEvent,
  WriteToolCallEvent, EditToolCallEvent, BashToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

// From project
import type { SnapshotStore, RestoreResult, RestoreOpts } from "./store.js";
import type { RevertCheckpoint } from "./markers.js";
import type { SessionRuntime } from "./runtime.js";
import type { MulliganConfig } from "./config.js";
import type { FileLedger } from "./ledger.js";
```

## 10. Comment Style

The codebase uses extensive inline JSDoc-style comments explaining:
- WHY each design decision was made (spec references, edge case IDs)
- What each block does in the context of the overall flow
- Cross-references between modules (e.g., "CONSUMED BY: rewindExecute step 6b")
- Gotchas (numbered: "CRITICAL #1", "GOTCHA #5")

New code should follow this comment density — downstream agents need to understand WHY, not just WHAT.