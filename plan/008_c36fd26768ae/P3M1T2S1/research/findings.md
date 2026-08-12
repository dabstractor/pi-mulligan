# Research Notes — P3.M1.T2.S1 (Wire store into index.ts + session_start GC + session_shutdown teardown)

## Verified codebase facts (read 2025-01 via the source)

### runtime.ts — `store?` field ALREADY EXISTS
`SessionRuntime` already declares `store?: SnapshotStore` (with the type-only import
`import type { SnapshotStore } from "./snapshot/store.js"`). `freshRuntime()` leaves it `undefined`
(assigned by index.ts session_start). So **contract part (a) is already satisfied** — this task only
VERIFIES it (Task 0). `snapshots?: Map<string, RevertCheckpoint>` also present + always a live Map.
Exports: `getRuntime(sid: string)`, `resetRuntime(sid)`, `clearAll()`, `nextSeq(sid)`. The `runtimes`
Map is MODULE-PRIVATE (not exported) → enumerating stores at shutdown needs a NEW helper.

### ExtensionContext (pi types.d.ts:209-251) — NO sessionDir
Has `cwd: string`, `sessionManager: ReadonlySessionManager`, `model`, `ui`, `mode`, etc. — but
**NO `sessionDir` field**. So `detectAndCreate(ctx.cwd, getConfig().revert)` is a 2-ARG call (the
contract's exact form). Consequence: when `revertConfig.storageDir` is `null`, detectAndCreate cannot
resolve a path (GitBackend/CasBackend both throw "storageDir is null and no sessionDir provided" →
detectAndCreate catches → NoOpStore, fail-open). **GOTCHA: a non-NoOp store requires the user to
configure `revert.storageDir`.** This is inherent to the 2-arg call the contract specifies.

### capture.ts — `gcTurnSnapshots(rt)` ALREADY EXPORTED (reusable by session_start)
```ts
export async function gcTurnSnapshots(rt: SessionRuntime): Promise<void> {
  if (!rt.store) return;
  try { await rt.store.gc(); } catch {}            // drop all turn/* refs on disk + reclaim
  for (const key of [...(rt.snapshots?.keys() ?? [])]) {
    if (key.startsWith("turn")) rt.snapshots?.delete(key);   // clear in-memory turn/* (checkpoint/* exempt)
  }
}
```
session_start reuses this verbatim for the E32 stale-`turn/*` cleanup. NoOpStore.gc() is a no-op →
harmless when the store is NoOp.

### store.ts — NO `destroy()` method; `shadowKey`/`shadowDir` are git.ts-private
The SnapshotStore interface has: `describe`, `capture`, `dirtyCheck`, `restore`, `has`, `retire`, `gc`.
**No destroy/wipe/teardown.** `detectAndCreate(cwd, revertConfig, sessionDir?)` NEVER rejects (→ NoOpStore).
GitBackend holds `private shadowDir = join(this.storageDir, shadowKey(this.repoRoot))` where `shadowKey`
is module-private in git.ts (line 134) + `repoRoot` is resolved via async `rev-parse` in `ensureInit()`
(memoized, `this.initPromise`). CasBackend holds `private storageDir` (known at construction).
→ **Contract (d)'s literal "fs.rm <storageDir>/<key> in index.ts" is INFEASIBLE** (index.ts cannot
reconstruct the git shadow path without breaking encapsulation). **DECISION: add `destroy(): Promise<void>`
to the SnapshotStore interface** — backend-agnostic, mirrors the existing `gc()` pattern, reuses each
backend's private path field. index.ts calls `await store.destroy()` best-effort.

### index.ts — current shape (factory)
- Step 5 registers handlers; `registerTurnStartCapture(pi)` present (S1 landed). `registerAgentEndCapture`
  NOT yet present (S2 in flight — parallel). **This task does NOT add it (S2 owns it).**
- `session_start` handler is currently SYNC: `setConfig → setLogFile → resetRuntime(sid) → reconcileBanner`.
  No try/catch (callees are fail-open). `_event` unused.
- `session_shutdown` handler is `() => { clearAll(); }` — wipes ALL runtimes (treated as full teardown).

### Test idiom
- `test/index.test.ts`: vitest flat describe/it; `vi.mock("../src/settings.js")` + `vi.mock("../src/log.js")`;
  hand-rolled fake `ExtensionAPI` capturing `.on`/`.registerTool`/`.registerCommand` (makeFakePi); `makeCtx(sid,
  cwd)`, `makeStartEvent(reason)`; `beforeEach: clearAll()`. Existing session_start tests use DEFAULT_CONFIG
  (revert.enabled=false) → store block skipped → still pass when handler goes async. The "sync factory" test
  checks the FACTORY return (stays sync) — unaffected.
- `test/capture.test.ts`: mkdtempSync dir + RecordingStore fake (calls[] log; describe/capture/gc spies) +
  makePi/makeCtx/beforeEach (clearAll + setConfig revert.enabled=true). Reusable pattern for index store tests.

## Design decisions (justified)
1. **`destroy()` on the interface** (not fs.rm in index.ts) — encapsulation + backend-agnostic + mirrors gc().
2. **`getActiveStores(): SnapshotStore[]` in runtime.ts** — enumerate the private Map for teardown (4 lines).
3. **session_start + session_shutdown go ASYNC** — Pi awaits event handlers; async is allowed (turn_start is).
4. **session_start store block wrapped in try/catch** — belt-and-suspenders (detectAndCreate never rejects,
   gcTurnSnapshots never throws) but session_start is critical → never let a store failure block config reload.
5. **registerAgentEndCapture deferred to S2** — parallel task owns it; my task only verifies presence.