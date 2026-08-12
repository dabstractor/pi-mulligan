import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, constants } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { MulliganConfig } from "../config.js";

const execFile = promisify(execFileCb);

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
 * METHOD SIGNATURES ARE ASYNC (Promise return; serialized via AsyncMutex — spec/14 §4.3). The five
 * IO-bearing methods (`capture`/`dirtyCheck`/`restore`/`has`/`retire`) return Promises so each
 * backend can acquire its own `AsyncMutex` (below) and await `child_process.execFile` without
 * freezing the Pi event loop (execFileSync would). `describe()` stays SYNC (pure metadata — no IO).
 * See `@14-working-tree-revert.md` §2 (architecture), §3 (GitBackend), §4 (CasBackend), §5 (capture
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
  capture(label: string): Promise<string | null>;

  /**
   * Return the subset of `paths` whose CURRENT work-tree content differs from the `afterRef`
   * snapshot — i.e. files that drifted AFTER the agent's turn (a human/other-process edit since
   * `agent_end`). The restore dirty-guard (spec §6 step 3) calls this BEFORE restore: if ANY
   * affected path is dirty, the WHOLE file-revert is REFUSED (not silently clobbered — E30). Compare
   * is content-equality (git diff against the afterRef tree / CAS hash equality). spec/14 §2, §6.
   * IMPLEMENTED BY: git/cas.
   */
  dirtyCheck(afterRef: string, paths: string[]): Promise<string[]>;

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
  restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult>;

  /**
   * Does a snapshot ref still exist (resolvable) in the backend's store? Used by the capture
   * lifecycle / cross-reload (E32) to decide whether a persisted RevertCheckpoint's refs are still
   * honored. spec/14 §2. IMPLEMENTED BY: git/cas.
   */
  has(ref: string): Promise<boolean>;

  /**
   * Drop a protected ref so its underlying objects can be reclaimed by the next GC pass (git
   * shadow-repo `update-ref -d` / CAS manifest delete). Called when a checkpoint is revoked/consumed
   * (spec §5 "Checkpoints are exempt… held until revoked or consumed"). The prompt-boundary GC pass
   * (spec §5) retires turn/* refs en masse. spec/14 §2, §5. IMPLEMENTED BY: git/cas.
   */
  retire(ref: string): Promise<void>;

  /**
   * The prompt-boundary reclamation pass (spec/14 §5). Drops ALL `turn/*` snapshot refs/manifests
   * (the whole namespace — reclaims prior turns whose in-memory entry no longer exists) AND
   * physically reclaims (`git gc --auto --prune=now` for git / blob mark-sweep for cas).
   * `checkpoint/*` is EXEMPT (separate namespace). Serialized by the mutex (§4.3). BEST-EFFORT
   * (E27): NEVER rejects — failure logs + degrades only to slower reclamation; never blocks the
   * turn. Called by the turn_start capture hook (P3.M1.T1.S1) + the session_start GC (P3.M1.T2.S1).
   */
  gc(): Promise<void>;

  /**
   * Best-effort full teardown (spec/14 §5: "Both stores are deleted entirely on
   * session_shutdown — no cross-session buildup"). Wipes the backend's on-disk storage: GitBackend
   * deletes its shadow repo dir; CasBackend deletes its CAS dir; NoOpStore is a no-op. Serialized
   * by the mutex (like gc()). NEVER rejects — a failure is swallowed (teardown must never block).
   * Called by index.ts session_shutdown BEFORE clearAll(). IMPLEMENTED BY:
   * GitBackend/CasBackend/NoOpStore. @14 §5.
   */
  destroy(): Promise<void>;
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

// ─────────────────────────────────────────────────────────────────────────────
// S2 (P2.M1.T1.S2) — detectAndCreate() factory + NoOpStore + module-private helpers.
// APPENDED below the S1 exports (SnapshotStore / RestoreOpts / RestoreResult / AsyncMutex), which are
// UNCHANGED. This is the ONLY git I/O in detection (a read-only `git rev-parse --git-dir`); all writes
// live in the SHADOW repo inside GitBackend (P2.M2.T1). spec/14 §2 ("Detection"), spec/14 §8.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructor shape GitBackend (src/snapshot/git.ts, P2.M2.T1) MUST satisfy. LOCAL + UN-EXPORTED —
 * exists ONLY to type the forward-compat dynamic-import cast below (not a public contract; P2.M2 may
 * widen `implements` details freely as long as the ctor takes `(cwd, revertConfig, sessionDir?)`).
 * `sessionDir?` is used ONLY when `storageDir` is null, to resolve `<sessionDir>/mulligan/`.
 * Repo-root resolution happens INSIDE GitBackend (its own `rev-parse --show-toplevel`); detectAndCreate
 * only proves the workspace is a git repo, it does NOT locate the repo root.
 */
interface GitBackendCtor {
  new (
    cwd: string,
    revertConfig: MulliganConfig["revert"],
    sessionDir?: string | null,
  ): SnapshotStore;
}

/**
 * Constructor shape CasBackend (src/snapshot/cas.ts, P2.M3.T1) MUST satisfy. LOCAL + UN-EXPORTED.
 * `sessionDir` is threaded so the CAS can resolve its blob-store path when `storageDir` is null.
 * (If P2.M3 prefers to resolve storage internally from sessionDir alone, dropping the 3rd arg is a
 * safe, compatible narrowing of this cast — see detectAndCreate's "Integration contract note".)
 */
interface CasBackendCtor {
  new (
    cwd: string,
    revertConfig: MulliganConfig["revert"],
    sessionDir?: string | null,
  ): SnapshotStore;
}

/**
 * Resolve the snapshot storage dir from config + the optional session dir. spec/14 §8
 * (storageDir: null ⇒ default `<sessionDir>/mulligan/`). PURE-ish (only path math) EXCEPT the final
 * containment throw — no fs touched here; mkdir/access run in detectAndCreate. MODULE-PRIVATE.
 *
 * Belt-and-suspenders containment guard: config.ts already rejects a storageDir resolving inside cwd
 * (coerceStorageDir), but that check does NOT cover the sessionDir-default path. This re-validates the
 * resolved dir against cwd (mirroring coerceStorageDir's exact relative()/isAbsolute() containment test)
 * so a sessionDir resolved under the workspace still fails-open to NoOpStore rather than polluting the
 * working tree. (paths.ts lexical helpers cover the walk-level per-file containment inside the backends;
 * this is the single storage-dir gate.)
 *
 * @throws {Error} when no storage dir can be resolved, or the resolved dir is inside cwd.
 */
function resolveStorageDir(
  storageDir: string | null,
  sessionDir: string | null | undefined,
  cwd: string,
): string {
  let candidate: string;
  if (storageDir !== null) {
    candidate = resolve(storageDir);
  } else if (sessionDir) {
    candidate = resolve(sessionDir, "mulligan"); // default <sessionDir>/mulligan/
  } else {
    throw new Error("no storage dir configured and no session dir provided");
  }
  // Containment check: resolved storage must NOT be at-or-inside cwd (would pollute the workspace).
  // Mirrors coerceStorageDir's exact relative()/isAbsolute() test (config.ts) for consistency; covers
  // the sessionDir-default path that config.ts cannot see. insideCwd → throw → detectAndCreate fail-open.
  const root = resolve(cwd);
  const rel = relative(root, candidate); // '' at-root | '../..' escaped | absolute cross-drive
  const insideCwd = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (insideCwd) {
    throw new Error("resolved storage dir is inside the workspace cwd");
  }
  return candidate;
}

/**
 * Crush an error message into a short, newline-free one-liner for NoOpStore.describe().reason (which
 * feeds the rewind notice/log line, not a stack dump). Trims to ~120 chars. MODULE-PRIVATE.
 */
function summarize(msg: string): string {
  const oneLine = msg.replace(/[\r\n]+/g, " ").trim();
  const MAX = 120;
  return oneLine.length > MAX ? oneLine.slice(0, MAX) : oneLine;
}

/**
 * The fail-open TERMINAL store: backend "none", every op a no-op. The ONLY store whose describe()
 * reports `backend: "none"`. Constructed by `detectAndCreate` when (a) the workspace is non-git AND
 * the storage dir is unwritable, OR (b) ANY detection/initialization error was caught (E28 fail-open:
 * "the session MUST still work — context rewind proceeds without file revert"). Never participates in
 * RevertCheckpoint (src/markers.ts: RevertCheckpoint.backend is "git"|"cas" only — checkpoints exist
 * solely for real backends). spec/14 §2 ("Detection"), §6 (rewind proceeds without file revert),
 * spec/14 E28 (fail-open), spec/14 §1 layer 1 (revert is opt-in — its absence is always non-fatal).
 *
 * The 6 methods mirror the async SnapshotStore interface: `capture` is an async no-op returning null
 * (revert unavailable), `dirtyCheck` is an async no-op returning `[]` (no drift info), `restore` is an
 * async no-op returning the 5 empty buckets (nothing was done), `has` is an async no-op returning
 * false, `retire` is an async no-op void. `describe()` stays sync (pure metadata). detectAndCreate is
 * ASYNC (it awaits execFile + import + mkdir); the store it returns exposes the async interface.
 *
 * EXPORTED so the rewind tool (rewindExecute, P4.M2.T1.S2) can read `store.describe().backend` and
 * skip the file-revert branch when it is "none", and so tests + index.ts (P3.M1.T2) can observe the
 * fail-open state directly.
 */
export class NoOpStore implements SnapshotStore {
  /** Human-readable one-liner set by detectAndCreate ("no git repo and storage dir not writable",
   * "detection unavailable: <short msg>"). Surfaces via describe().reason into the rewind notice/log. */
  constructor(private readonly reason: string) {}

  describe(): { backend: "none"; reason: string } {
    return { backend: "none", reason: this.reason };
  }

  async capture(_label: string): Promise<null> {
    return null; // revert unavailable — capture never succeeds
  }

  async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> {
    return []; // no drift info available from a no-op store
  }

  async restore(
    _beforeRef: string,
    _opts: RestoreOpts,
  ): Promise<RestoreResult> {
    return { reverted: [], deleted: [], failed: [], skipped: [], refused: [] };
  }

  async has(_ref: string): Promise<boolean> {
    return false; // NoOpStore holds no refs
  }

  async retire(_ref: string): Promise<void> {
    /* no-op — nothing to retire */
  }

  async gc(): Promise<void> {
    /* no-op — nothing to reclaim in a no-op store */
  }

  async destroy(): Promise<void> {
    /* no-op — nothing to reclaim in a no-op store */
  }
}

/**
 * Detect the correct `SnapshotStore` backend for `cwd` and construct it, OR fail-open to `NoOpStore`.
 * THE FRONT DOOR to the v1.2 working-tree-revert feature: index.ts (P3.M1.T2.S1) calls this ONCE at
 * session_start and caches the result on SessionRuntime (PRD h2.142 "Detection, cached per session").
 * The rewind tool (rewindExecute, P4.M2.T1) then operates on whatever store it is handed — mode-agnostic.
 *
 * DECISION TREE (spec/14 §2 "Detection" + work-item contract step 3):
 *   1. `git rev-parse --git-dir` (read-only — the ONLY git command run against the user's repo here;
 *      NEVER a write) exit 0 ⇒ `GitBackend` (P2.M2.T1). git missing / non-zero ⇒ not git, fall through.
 *   2. resolve storageDir (revertConfig.storageDir ?? `<sessionDir>/mulligan/`), `mkdir -p`, check
 *      `W_OK`. Writable ⇒ `CasBackend` (P2.M3.T1). Unwritable ⇒ `NoOpStore`.
 *   3. ANY thrown error (bad cwd, missing git binary, dynamic-import failure, backend ctor throw)
 *      ⇒ `NoOpStore`. **detectAndCreate NEVER rejects** (E28 fail-open is the contract).
 *
 * FORWARD-COMPATIBILITY (the crux): git.ts (P2.M2.T1) and cas.ts (P2.M3.T1) DO NOT EXIST yet. A
 * static `import { GitBackend } from "./git.js"` makes `tsc --noEmit` FAIL today and rollup/vitest
 * fail at transform time. So the backends are loaded via a DYNAMIC import with a NON-LITERAL
 * specifier (`const spec = "./git.js"; await import(spec)`) — TypeScript only statically resolves
 * STRING-LITERAL import() args, and rollup/vitest skip static analysis of non-literal specifiers.
 * Today the import rejects (module absent) ⇒ caught ⇒ NoOpStore (fail-open). After P2.M2/P2.M3 land
 * it resolves to the real backend with ZERO edits to this file. Do NOT add `// @ts-expect-error` on
 * a literal dynamic import (fragile — breaks if the error shape changes) — use the non-literal form.
 *
 * Integration contract note: the CasBackend ctor is called as `(cwd, revertConfig, sessionDir)`.
 * If P2.M3.T1 settles on a different arity (e.g. resolving storage from sessionDir alone), only the
 * `CasBackendCtor` cast + the `new mod.CasBackend(...)` line need tweak — a localized, trivial change.
 *
 * spec/14 §2 (Detection), spec/14 E28 (fail-open), spec/14 §8 (storageDir resolution), spec/14 §1
 * layer 1 (revert is opt-in — detection failure is non-fatal). EXPORTED so index.ts (P3.M1.T2) is
 * the single caller at session_start.
 *
 * @param cwd           the workspace root to detect + snapshot against.
 * @param revertConfig  `MulliganConfig["revert"]` (the 8-field block; storageDir/null drives default).
 * @param sessionDir    optional — used ONLY when storageDir is null, to resolve `<sessionDir>/mulligan/`.
 * @returns a `SnapshotStore`; NEVER rejects (always resolves, failing open to NoOpStore on any error).
 */
export async function detectAndCreate(
  cwd: string,
  revertConfig: MulliganConfig["revert"],
  sessionDir?: string | null,
): Promise<SnapshotStore> {
  try {
    // (1) git detection — NARROW try/catch so its catch unambiguously means ONLY "not git"
    //     (non-zero exit OR `git` binary absent → execFile rejects). Read-only rev-parse: no writes.
    try {
      await execFile("git", ["rev-parse", "--git-dir"], { cwd });
      // exit 0 ⇒ is a git repo ⇒ construct the GitBackend (P2.M2.T1).
      const spec = "./git.js"; // NON-LITERAL specifier → not statically resolved by tsc/rollup
      const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
      return new mod.GitBackend(cwd, revertConfig, sessionDir);
    } catch {
      // not git — fall through to the CAS branch.
    }

    // (2) resolve storage dir + writability check. DISTINCT-reason variant: a NARROW catch around
    //     just mkdir+access yields the crisp "not writable" reason (vs a generic fail-open message).
    const storageDir = resolveStorageDir(
      revertConfig.storageDir,
      sessionDir,
      cwd,
    );
    try {
      await mkdir(storageDir, { recursive: true }); // mkdir -p (idempotent — recursive:true)
      await access(storageDir, constants.W_OK); // rejects if not writable
    } catch {
      // non-git AND storage not writable ⇒ NoOpStore with the distinct reason.
      return new NoOpStore("no git repo and storage dir not writable");
    }
    // writable ⇒ construct the CasBackend (P2.M3.T1).
    const spec = "./cas.js"; // NON-LITERAL specifier → not statically resolved by tsc/rollup
    const mod = (await import(spec)) as { CasBackend: CasBackendCtor };
    return new mod.CasBackend(cwd, revertConfig, sessionDir);
  } catch (err) {
    // (3) E28 fail-open — ANY error (unwritable storage already handled above; this catches import
    //     failure, backend ctor throw, bad cwd, etc.). detectAndCreate NEVER rethrows.
    const msg = err instanceof Error ? err.message : String(err);
    return new NoOpStore(summarize(msg));
  }
}
