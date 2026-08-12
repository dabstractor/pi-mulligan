/**
 * The backend-pluggable working-tree snapshot STORE contract + the serialization primitive for the
 * v1.2 snapshot subsystem. spec/14-working-tree-revert.md §2 (placement: "src/snapshot/store.ts //
 * the SnapshotStore interface + detectAndCreate() factory + the AsyncMutex"), §4.3 (the AsyncMutex
 * serialization contract), spec/03-architecture.md §7 (the new src/snapshot/ subtree), spec/10
 * Tier 1 (pure-helper unit-test tier — though AsyncMutex has internal state, it is deterministic +
 * fully unit-testable in isolation).
 *
 * DESIGN (read GOTCHA #1–#8 in the P2.M1.T1.S1 PRP):
 * - Pi-FREE + project-module-FREE. This module imports NOTHING — contrast the sibling `paths.ts`,
 *   which imports `node:path`. store.ts is PURE TypeScript: three self-contained interfaces (fields
 *   are primitives + the other two interfaces) and one promise-chain class that uses only the global
 *   Promise + a private field (GOTCHA #2). It does NOT import `RevertCheckpoint` from markers.js —
 *   the interface exchanges OPAQUE `string` refs, not RevertCheckpoint (the two types meet in
 *   SessionRuntime, P1.M2.T2.S2, not here).
 * - Defines the BACKEND-AGNOSTIC contract BOTH backends implement (`GitBackend` git.ts P2.M2.T1,
 *   `CasBackend` cas.ts P2.M3.T1 `implements SnapshotStore`) + the serialization primitive
 *   (`AsyncMutex`) each backend's constructor constructs so capture/dirtyCheck/restore/retire never
 *   overlap (spec §4.3). The rewind tool (rewindExecute, P4.M2.T1) orchestrates `dirtyCheck` +
 *   `restore` and NEVER knows which backend ran (mode-agnostic).
 * - SYNCHRONOUS interface + ASYNC mutex are DECOUPLED exports (GOTCHA #1). The interface method
 *   signatures are SYNC per spec §2 + the work-item contract (`capture(label): string | null`,
 *   NOT `Promise<string | null>`); each backend wraps its own method bodies with its own
 *   `AsyncMutex`. store.ts EXPORTS both; it does NOT make the interface async, and it does NOT use
 *   the mutex itself.
 * - Leaves clean room for `detectAndCreate()` (P2.M1.T1.S2, the NEXT task — the factory does
 *   git-detection I/O via `child_process`; it APPENDS to this same file). store.ts does NOT define
 *   it (GOTCHA #3), nor any backend implementation.
 * - Consumers: `GitBackend` (git.ts, P2.M2.T1), `CasBackend` (cas.ts, P2.M3.T1) `implements
 *   SnapshotStore` + construct `new AsyncMutex()`; `rewindExecute` (rewind.ts, P4.M2.T1.S2)
 *   imports `RestoreOpts`/`RestoreResult`; `index.ts` (P3.M1.T2) imports the `SnapshotStore` type
 *   (the threaded store + the `detectAndCreate` factory return).
 */

/**
 * The backend-pluggable working-tree snapshot abstraction. BOTH backends implement this:
 * `GitBackend` (src/snapshot/git.ts, P2.M2.T1 — external shadow repository) and `CasBackend`
 * (src/snapshot/cas.ts, P2.M3.T1 — content-addressed store + explicit-paths mode). The rewind tool
 * (rewindExecute, P4.M2.T1) orchestrates `dirtyCheck` + `restore` and NEVER knows which backend ran
 * (mode-agnostic — spec/14 §2). `index.ts` (P3.M1.T2) creates ONE store via the `detectAndCreate()`
 * factory (P2.M1.T1.S2) and threads it into the rewind tool + capture hooks.
 *
 * METHOD SIGNATURES ARE SYNCHRONOUS (spec/14 §2 + the work-item contract — GOTCHA #1) — e.g.
 * `capture()` returns `string | null`, NOT `Promise<string | null>`. Each backend constructs its
 * own `AsyncMutex` (below) in its constructor and serializes its operations internally (spec §4.3);
 * the interface itself is a pure type contract, decoupled from the mutex. See
 * `@14-working-tree-revert.md` §2 (architecture), §3 (GitBackend), §4 (CasBackend), §5 (capture
 * lifecycle), §6 (restore semantics).
 *
 * EXPORTED so git.ts/cas.ts (P2.M2/P2.M3) `implements SnapshotStore` and index.ts (P3.M1.T2) +
 * rewind.ts (P4.M2.T1) type against the ONE canonical contract.
 */
export interface SnapshotStore {
  /**
   * Report which backend is active (for logging / the rewind notice). backend is 3-valued: `"git"`
   * | `"cas"` | `"none"`. `"none"` = revert unavailable (no git AND CAS unwritable — E28; the rewind
   * proceeds without file revert). `reason?` is a human-readable one-liner, populated for `"none"` /
   * degraded backends (omitted for healthy git/cas) — GOTCHA #8. spec/14 §2 ("Detection").
   * IMPLEMENTED BY: GitBackend/CasBackend (P2.M2/P2.M3).
   */
  describe(): { backend: "git" | "cas" | "none"; reason?: string };

  /**
   * Snapshot the working set NOW and return an OPAQUE ref string (a commit SHA for the GitBackend's
   * shadow repo; a manifest hash for the CasBackend). `null` = capture failed (caps exceeded — E29,
   * I/O error) → the rewind treats the boundary as "revert unavailable, proceed without". The ref is
   * stored as `RevertCheckpoint.beforeRef` (turn_start / checkpoint-set) or `.afterRef` (agent_end).
   * `label` is the capture-namespace key (`"turn"` | `"turn-after"` | `"ckpt:<name>"`) — governs
   * the ref's retention namespace (turn/* GC'd at prompt-boundary; checkpoint/* exempt — spec §5).
   * spec/14 §2, §5. IMPLEMENTED BY: GitBackend/CasBackend.
   */
  capture(label: string): string | null;

  /**
   * Return the subset of `paths` whose CURRENT work-tree content differs from the `afterRef`
   * snapshot — i.e. files that drifted AFTER the agent's turn (a human/other-process edit since
   * `agent_end`). The restore dirty-guard (spec §6 step 3) calls this BEFORE restore: if ANY
   * affected path is dirty, the WHOLE file-revert is REFUSED (not silently clobbered — E30). Compare
   * is content-equality (git diff against the afterRef tree / CAS hash equality). spec/14 §2, §6.
   * IMPLEMENTED BY: git/cas.
   */
  dirtyCheck(afterRef: string, paths: string[]): string[];

  /**
   * Write working-tree files FROM the `beforeRef` snapshot (restore the pre-span file state). `opts`
   * gates the two actions: revert modified files (revertFileChanges) and delete span-created files
   * (deleteCreatedFiles — honored only when BOTH the per-call flag AND
   * config.revert.allowDeleteCreatedFiles, spec §1 layer 3). Returns a RestoreResult (5 buckets). The
   * op NEVER throws — per-path failures land in `failed[]` (E27, best-effort); the dirty-guard
   * refuse lands in `refused[]` (E30); uncaptured-due-to-caps files land in `skipped[]` (E29).
   * Working-tree ONLY — never touches the source git index/refs. spec/14 §2, §6. CONSUMED BY:
   * rewindExecute step 6b (P4.M2.T1.S2). IMPLEMENTED BY: git/cas.
   */
  restore(beforeRef: string, opts: RestoreOpts): RestoreResult;

  /**
   * Does a snapshot ref still exist (resolvable) in the backend's store? Used by the capture
   * lifecycle / cross-reload (E32) to decide whether a persisted RevertCheckpoint's refs are still
   * honored. spec/14 §2. IMPLEMENTED BY: git/cas.
   */
  has(ref: string): boolean;

  /**
   * Drop a protected ref so its underlying objects can be reclaimed by the next GC pass (git
   * shadow-repo `update-ref -d` / CAS manifest delete). Called when a checkpoint is revoked/consumed
   * (spec §5 "Checkpoints are exempt… held until revoked or consumed"). The prompt-boundary GC pass
   * (spec §5) retires turn/* refs en masse. spec/14 §2, §5. IMPLEMENTED BY: git/cas.
   */
  retire(ref: string): void;
}

/**
 * Per-call revert flags passed to `SnapshotStore.restore()` — consent layer 2 of the three-layer
 * opt-in (spec/14 §1: config.enabled (layer 1) → these per-call flags (layer 2) →
 * allowDeleteCreatedFiles (layer 3, delete-only)). The agent MUST set at least one; they are NEVER
 * inferred. Mirrors the `mulligan_rewind` tool params `revert_file_changes` / `delete_created_files`
 * (P4.M1.T1.S1). CONSUMED BY: rewindExecute builds this from the tool params (P4.M2.T1.S2).
 * spec/14 §1, §6.
 *
 * EXPORTED so rewind.ts (P4.M2.T1.S2) imports it to build opts from the tool params; SnapshotStore
 * (above) references it in its `restore` signature.
 */
export interface RestoreOpts {
  /** Restore modified files to their beforeRef content. (spec §1, §6 step 4) */
  revertFileChanges: boolean;
  /** Delete files the span newly created (honored only when ALSO config.revert.allowDeleteCreatedFiles). (spec §1, §6) */
  deleteCreatedFiles: boolean;
}

/**
 * The five-bucket outcome of `SnapshotStore.restore()`. rewindExecute (P4.M2.T1.S2) folds these into
 * the rewind success text ("Reverted <X> file(s), deleted <Y>; <Z> skipped/failed, <W> refused") AND
 * the rewind marker's `revert` block (P1.M2.T2.S1: {revertedFiles, deletedFiles, failedFiles,
 * refusedFiles, skipped, backend}) for auditability. Every bucket is a workspace-relative POSIX path
 * list. spec/14 §6.
 *  - reverted: files written back to beforeRef content (success).
 *  - deleted:  span-created files removed (success; only when deleteCreatedFiles + allowDeleteCreatedFiles).
 *  - failed:   E27 — best-effort I/O failure (locked file, permission); the op NEVER throws.
 *  - skipped:  E29 — file uncaptured because a cap (maxFileBytes/maxTotalBytes/maxSnapshotsPerTurn) was hit.
 *  - refused:  E30 — dirty-guard refuse; the WHOLE file-revert refused (paths that drifted since agent_end).
 *
 * EXPORTED so rewind.ts (P4.M2.T1.S2) imports it to fold the buckets into success text + the marker;
 * SnapshotStore (above) references it in its `restore` return type.
 */
export interface RestoreResult {
  reverted: string[];
  deleted: string[];
  failed: string[];
  skipped: string[];
  refused: string[];
}

/**
 * A promise-chain mutex that serializes async operations on a single store instance. spec/14 §4.3:
 * "a single mutex per store serializes ALL store operations (capture/dirtyCheck/restore/retire/gc).
 * Pi preflights sibling tool_calls sequentially then runs them concurrently; the mutex makes
 * capture/restore race-free regardless. The prompt-boundary GC pass ALSO acquires the mutex, so a
 * git gc / CAS mark-sweep can never overlap an in-flight capture/restore/retire straddling a turn
 * boundary."
 *
 * USAGE: each backend (GitBackend P2.M2.T1, CasBackend P2.M3.T1) constructs `new AsyncMutex()` in
 * its constructor and wraps each serialized method body as:
 *     const release = await this.mutex.acquire();
 *     try { …do the op… } finally { release(); }
 * FIFO + strict mutual exclusion are guaranteed by the promise-chain: each acquire() awaits the
 * previous holder's release-promise, so holders never overlap and wake in arrival order.
 * CONSUMERS: git.ts/cas.ts constructors (P2.M2.T1/P2.M3.T1) + the prompt-boundary GC pass.
 * spec/14 §4.3. (Decoupled from the synchronous SnapshotStore interface — see that interface's
 * JSDoc + GOTCHA #1.)
 *
 * EXPORTED so the backends (git.ts/cas.ts) construct one per store instance. NOT used by store.ts
 * itself (the interface is sync; the mutex is an opt-in utility for backends with async hazards).
 */
export class AsyncMutex {
  /** The release-promise of the CURRENT holder (resolved on the next acquire). Starts resolved (unlocked). */
  private _tail: Promise<void> = Promise.resolve();

  /**
   * Acquire the lock. Resolves (in arrival/FIFO order) once all prior holders have released; the
   * resolved value is THIS caller's release function. The caller MUST call it (typically in a
   * `finally`) — a forgotten release deadlocks all later acquire()s (expected; the contract is
   * manual acquire/release, like a lock — GOTCHA #5). Double-release is a safe no-op (a Promise
   * settles once). spec/14 §4.3.
   *
   * The promise-chain algorithm (GOTCHA #4): each caller chains onto the then-current `_tail` and
   * REPLACES `_tail` with its own (unresolved) release-promise. So caller B (arriving after A) awaits
   * A's release-promise; when A calls release(), A's promise resolves → B's `.then` wakes → B
   * proceeds. A and B can never both be past their `await` at once (mutual exclusion); B always
   * wakes after A (FIFO — the JS microtask queue is FIFO).
   */
  acquire(): Promise<() => void> {
    let release!: () => void; // assigned synchronously inside the Promise executor
    const prev = this._tail; // snapshot the CURRENT tail (previous holder's release-promise)
    this._tail = new Promise<void>((resolve) => {
      release = resolve; // THIS caller's release fn = resolve its own tail promise
    });
    return prev.then(() => release); // await the prev holder, then hand back our release fn
  }
}