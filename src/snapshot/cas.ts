import { createHash } from "node:crypto";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir as fsMkdir,
  access as fsAccess,
  stat as fsStat,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "./store.js";
import type { MulliganConfig } from "../config.js";

/**
 * CasBackend — the CONTENT-ADDRESSED-STORE snapshot backend (the universal non-git fallback for
 * the v1.2 working-tree-revert feature). spec/14-working-tree-revert.md §4.1 ("cas" default —
 * comprehensive, whole-tree: content keyed by hash, identical content stored once globally —
 * dedupe; storage strictly OUTSIDE cwd/.git), §4.3 (cross-cutting: path-safety + AsyncMutex +
 * fail-closed caps), §2 (the SnapshotStore interface this implements), §5 (capture lifecycle &
 * retention — for the stub JSDoc); architecture/external_deps.md §2 (the blob/manifest layout +
 * the manifest JSON format + sha256 via node:crypto + node:fs/promises), §4 (Node built-ins only —
 * no new npm deps).
 *
 * DESIGN:
 * - NODE-BUILT-INS-ONLY — imports `node:crypto` + `node:fs/promises` + `node:path` + the existing
 *   `AsyncMutex`/`SnapshotStore` (etc.) from `./store.js` + the `MulliganConfig` type (type-only,
 *   erased). No Pi, no new deps (architecture/external_deps.md §4 — sha256 + node:fs/promises are
 *   the sanctioned Node built-ins already proven in the sibling git.ts).
 * - CONTENT-DEDUPED BLOB STORE (spec §4.1: "identical content stored once globally"): same content
 *   → same sha256 → same blob path → stored ONCE. `storeBlob` short-circuits on `fs.access`
 *   (EXISTENT → return the hash WITHOUT re-writing); absent → `mkdir -p` the 2-hex prefix dir +
 *   `writeFile` the blob ONCE. The load-bearing invariant is mechanical: an existing blob path
 *   never reaches writeFile.
 * - SHARDED BLOB LAYOUT (external_deps §2 + work-item contract): `<storageDir>/blobs/<2-hex-prefix>/
 *   <sha256>` — the first 2 hex chars fan blobs out across 256 dirs (git's `.git/objects/ab/cdef…`
 *   style), keeping any single dir scannable on large stores. Manifests at
 *   `<storageDir>/manifests/<label>.json` (versioned JSON mapping posix-rel path →
 *   {hash,size,mtime,existed}).
 * - MANIFEST FORMAT (external_deps §2): versioned JSON. `version` is the literal type `1`
 *   (parseManifest enforces === 1 at runtime — a future v2 manifest is rejected loudly, not
 *   silently mis-parsed). `files` keys are workspace-relative POSIX paths (forward-slash), the
 *   output of paths.ts `normalizeRelPath` (S2 produces them on the walk) — documented in the
 *   CasManifest JSDoc so S2/S3 know the key shape; S1 does NOT import paths.ts (no walking, no
 *   per-path validation).
 * - ASYNC INTERFACE + PER-INSTANCE AsyncMutex (spec §4.3: "a single mutex per store serializes ALL
 *   store operations (capture/dirtyCheck/restore/retire/gc)"). The five IO-bearing methods are
 *   async (Promise return); `describe()` is SYNC (pure metadata). The mutex FIELD is constructed in
 *   the constructor so S2's capture + S3's restore/dirtyCheck/retire find `this.mutex.acquire()`
 *   ready (S1's stubs throw before acquiring it — but the field MUST exist so S2/S3 do not have to
 *   edit the constructor; purely-additive skeleton contract). Contrast the sibling git.ts which
 *   has the identical mutex field.
 * - S1 = SKELETON: `describe()` + the blob/manifest internals (`hashContent`/`storeBlob`/`readBlob`/
 *   `blobPath`/`manifestPath`) + the pure `serializeManifest`/`parseManifest` are REAL + unit-tested.
 *   The five IO-bearing SnapshotStore methods are ASYNC THROWING STUBS — `capture` lands in
 *   P2.M3.T1.S2 (whole-tree walk + mtime/size short-circuit); `dirtyCheck`/`restore`/`has`/`retire`
 *   land in P2.M3.T1.S3. Same split shape as GitBackend S1→S2 (src/snapshot/git.ts). No
 *   `init()`/`ensureInit()` — CasBackend has no shadow repo to create; the storageDir root already
 *   exists (detectAndCreate mkdir'd it) and the blob/manifest SUBDIRECTORIES are created lazily by
 *   `storeBlob` (`mkdir -p <storageDir>/blobs/<prefix>`).
 * - ASYNC hashContent (even though createHash is SYNC) keeps the signature stable for a future
 *   non-crypto hash swap (blake3/xxhash — spec §4.1 flags as a FUTURE option; do NOT add the dep).
 *
 * EXPORTED so detectAndCreate (store.ts, P2.M1.T1.S2) dynamic-imports `./cas.js` and constructs
 * `new CasBackend(cwd, revertConfig, sessionDir)` for any non-git workspace — flipping real
 * non-git workspaces from backend "none" (fail-open today, because the dynamic import rejects
 * while cas.ts is absent) to backend "cas" with ZERO edits to store.ts (the forward-compat dynamic
 * import already points here). capture/restore stay inert (stubs) until S2/S3 land; detectAndCreate
 * is not wired into index.ts until P3.M1.T2, so no live code hits the stubs.
 */

/**
 * Per-file record in a CAS manifest. The `files` value type in {@link CasManifest}. `existed` =
 * the file was present in the working tree at capture (false ⇒ restore DELETES it to recreate the
 * pre-span absence). `mtime`/`size` backstop S2's mtime/size short-circuit (re-skip a file whose
 * stat did not drift since capture). spec/14 §4.1, architecture/external_deps.md §2.
 *
 * EXPORTED so S2 (capture) + S3 (restore) import + reference it directly.
 */
export interface CasManifestEntry {
  /** sha256 hex of the file content (the blob key — {@link CasBackend.hashContent}). */
  hash: string;
  /** File size in bytes (stat.size — the mtime/size short-circuit backstop, spec §4.1). */
  size: number;
  /** stat.mtimeMs (the mtime/size short-circuit compares this — spec §4.1). */
  mtime: number;
  /** Was the file present at capture? (false ⇒ restore deletes it; S3.) */
  existed: boolean;
}

/**
 * A CAS snapshot manifest. The `files` keys are workspace-relative POSIX paths (forward-slash
 * relative, e.g. `"src/foo.ts"` — NOT `"src\foo.ts"`, NOT `/abs/src/foo.ts`, NOT `"./src/foo.ts"`) —
 * the output of paths.ts `normalizeRelPath` (S2 produces them on the walk; S1 does NOT import
 * paths.ts — it only documents this key contract). Stored at
 * `<storageDir>/manifests/<label>.json` (the {@link CasBackend.manifestPath} helper). `capture`
 * (S2) returns a ref resolving to it. `version` is the literal type `1` (parseManifest enforces
 * === 1). spec/14 §4.1, architecture/external_deps.md §2.
 *
 * NOTE: the 3-valued `describe().backend` union ("git"|"cas"|"none") is DISTINCT from
 * RevertCheckpoint.backend (markers.ts: "git"|"cas" — 2-valued; a checkpoint exists ONLY when a
 * real backend captured). A CasBackend never reports "none".
 *
 * EXPORTED so S2/S3 construct + read manifests via the canonical shape, and so
 * serializeManifest/parseManifest type-check against it.
 */
export interface CasManifest {
  /** Schema version (parseManifest enforces === 1). */
  version: 1;
  /** The capture-namespace key ("turn" | "turn-after" | "ckpt:<name>"). */
  label: string;
  /** The turn the snapshot brackets (S2 sets from ctx). */
  turnIndex: number;
  /** Date.now() at capture (S2 sets). */
  ts: number;
  /** path → per-file record (keys = workspace-relative POSIX paths — see class JSDoc). */
  files: Record<string, CasManifestEntry>;
}

/**
 * Serialize a manifest to canonical JSON (stable via JSON.stringify of a plain object). PURE (no fs)
 * — the round-trip test is a pure unit test. spec/14 §4.1, architecture/external_deps.md §2.
 *
 * EXPORTED so S2 (capture) writes manifests via this canonical serializer (and so the round-trip
 * test exercises it directly).
 */
export function serializeManifest(m: CasManifest): string {
  return JSON.stringify(m);
}

/**
 * Parse + validate a manifest JSON string. Throws if `version !== 1` (the forward-compat backstop —
 * a future v2 manifest is rejected loudly, not silently mis-parsed). PURE (no fs). The cast after
 * the version check is the runtime validation that justifies it (strict + noImplicitAny satisfied).
 * spec/14 §4.1, architecture/external_deps.md §2.
 *
 * EXPORTED so S3 (restore/dirtyCheck) reads manifests via this canonical parser (and so the
 * round-trip + version-guard test exercises it directly).
 */
export function parseManifest(json: string): CasManifest {
  const m = JSON.parse(json) as CasManifest;
  if (m.version !== 1) throw new Error(`unsupported CAS manifest version: ${m.version}`);
  return m;
}

/**
 * The fs surface CasBackend uses. Default binds `node:fs/promises` (bound in `realFs`); tests inject
 * a recording fake — notably to assert `storeBlob` DEDUPE (writeFile invoked exactly ONCE for
 * identical content via an `access` short-circuit — spec §4.1 "identical content stored once
 * globally"). `access` rejects if absent (the dedupe gate); `readFile` returns a Buffer (no encoding
 * arg). spec/14 §4.1, architecture/external_deps.md §2.
 *
 * EXPORTED so the unit test declares a recording fake that satisfies this exact shape.
 */
export interface CasFs {
  /** Read a blob by path. Returns a Buffer (NO encoding arg). */
  readFile(path: string): Promise<Buffer>;
  /** Write a blob (Buffer in, void out). */
  writeFile(path: string, data: Buffer): Promise<void>;
  /** mkdir -p (recursive:true). fs.mkdir returns string|undefined; we ignore it. */
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
  /** Rejects if absent (the storeBlob dedupe gate). */
  access(path: string): Promise<void>;
  /** stat() — S2's capture reads size/mtimeMs (S1's storeBlob does NOT stat). */
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

/**
 * Constructor DI seam (all optional; production omits → real impls). Mirrors git.ts's
 * `GitBackendDeps` tone: the `fs` default binds `node:fs/promises`; tests inject a recording fake.
 * spec/14 §4.1 (the CAS store), §4.3 (the AsyncMutex + caps context).
 *
 * EXPORTED so detectAndCreate production construction (`new CasBackend(cwd, revertConfig, sessionDir)`
 * — omits deps) + the unit-test construction (`new CasBackend(cwd, cfg, null, { fs: fakeFs })`) both
 * type-check.
 */
export interface CasBackendDeps {
  /** Default: real node:fs/promises (bound in realFs). Tests inject a recording fake. */
  fs?: CasFs;
}

// module-private binding of the real fs. readFile is wrapped to drop the default encoding so it
// returns a Buffer (node:fs/promises.readFile returns Buffer when no encoding is passed — wrapping
// it makes the binding satisfy CasFs.readFile's exact `Promise<Buffer>` shape); writeFile/mkdir/
// access/stat bind 1:1. architecture/external_deps.md §2 (the CAS backend uses node:fs/promises).
const realFs: CasFs = {
  readFile: (p) => fsReadFile(p),
  writeFile: fsWriteFile,
  mkdir: fsMkdir,
  access: fsAccess,
  stat: fsStat,
};

/**
 * CasBackend — the content-addressed-store snapshot backend. Implements the FULL `SnapshotStore`
 * interface (the 5 IO-bearing methods are async; `describe()` is sync). S1 (P2.M3.T1.S1 — THIS TASK)
 * ships `describe()` + the blob/manifest internals; the 5 IO methods are ASYNC THROWING STUBS —
 * `capture` lands in P2.M3.T1.S2, the rest in P2.M3.T1.S3. The per-instance `AsyncMutex` field is
 * constructed in the constructor (spec §4.3) so S2/S3 find `this.mutex.acquire()` ready (S1's stubs
 * throw before acquiring it — they never need to — but the field MUST exist so S2/S3 do not have to
 * edit the constructor).
 */
export class CasBackend implements SnapshotStore {
  private readonly cwd: string;
  private readonly cfg: MulliganConfig["revert"];
  private readonly storageDir: string;
  private readonly sessionDir: string | null;
  private readonly mutex = new AsyncMutex();
  private readonly fs: CasFs;

  /**
   * @param cwd            the workspace root to snapshot (resolved).
   * @param revertConfig   `MulliganConfig["revert"]` (the 8-field block; storageDir/null drives resolution).
   * @param sessionDir     optional — used ONLY when `storageDir` is null, to resolve `<sessionDir>/mulligan/`.
   * @param deps           DI test seam (optional fs; production omits → real node:fs/promises).
   * @throws when `storageDir` is null AND `sessionDir` is absent (cannot resolve a storage path).
   */
  constructor(
    cwd: string,
    revertConfig: MulliganConfig["revert"],
    sessionDir?: string | null,
    deps?: CasBackendDeps,
  ) {
    this.cwd = resolve(cwd);
    this.cfg = revertConfig;
    this.sessionDir = sessionDir ?? null;
    // Re-resolve storageDir inline (store.ts's resolveStorageDir is module-private — cannot import).
    // detectAndCreate already mkdir'd + W_OK-checked it; this is belt-and-suspenders + the instance
    // path source for blobPath/manifestPath. Mirrors git.ts's constructor block exactly.
    if (revertConfig.storageDir) {
      this.storageDir = resolve(revertConfig.storageDir);
    } else if (sessionDir) {
      this.storageDir = resolve(sessionDir, "mulligan");
    } else {
      throw new Error("CasBackend: storageDir is null and no sessionDir provided");
    }
    this.fs = deps?.fs ?? realFs;
  }

  /**
   * Report the active backend (SYNC metadata for logging / the rewind notice). `backend: "cas"` with
   * NO `reason` (healthy backend — `reason` is populated only for "none"/degraded, e.g. NoOpStore).
   * The 3-valued describe() union ("git"|"cas"|"none") is distinct from RevertCheckpoint.backend
   * (markers.ts: "git"|"cas" — 2-valued). spec/14 §2.
   */
  describe(): { backend: "cas" } {
    return { backend: "cas" };
  }

  /**
   * @internal sha256(content) hex — the blob key + the dedupe identity. spec/14 §4.1. Async (not
   * sync) to keep the signature stable for a future non-crypto hash swap (blake3/xxhash — a future
   * option per spec §4.1; do NOT add the dep — architecture/external_deps.md §4). PUBLIC-for-testing
   * (the work-item contract requires a hashContent determinism unit test that calls it directly;
   * TypeScript has no `internal` keyword).
   */
  async hashContent(content: Buffer): Promise<string> {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * @internal the blob path: `<storageDir>/blobs/<2-hex-prefix>/<sha256>`. The 2-hex prefix shards
   * blobs across 256 dirs (git's `.git/objects/ab/cdef…` style) so a large store stays scannable.
   * spec/14 §4.1, architecture/external_deps.md §2.
   */
  private blobPath(hash: string): string {
    return join(this.storageDir, "blobs", hash.slice(0, 2), hash);
  }

  /**
   * @internal the manifest path: `<storageDir>/manifests/<label>.json`. S2's capture writes the
   * serialized manifest here; S3's restore/has/retire read/delete it. architecture/external_deps.md §2.
   */
  private manifestPath(label: string): string {
    return join(this.storageDir, "manifests", `${label}.json`);
  }

  /**
   * @internal Store a content blob, DEDUPED. hash → blobPath → if the blob already exists
   * (`fs.access` resolves), return the hash WITHOUT re-writing (spec §4.1: "identical content stored
   * once globally"). Else `mkdir -p` the prefix dir (recursive — idempotent) + `writeFile` the blob
   * ONCE. Returns the hash (the blob key). Never throws on the common path; an fs error propagates
   * (S2's capture wraps storeBlob in best-effort try/catch — E27). The access-then-write ordering is
   * what makes dedupe mechanical: an existing blob path never reaches writeFile. spec/14 §4.1.
   * PUBLIC-for-testing (the dedupe unit test asserts writeFile is invoked exactly ONCE for two
   * identical-content calls via a recording fs fake).
   */
  async storeBlob(content: Buffer): Promise<string> {
    const hash = await this.hashContent(content); // sha256 hex — the dedupe identity
    const p = this.blobPath(hash); // <storageDir>/blobs/<2-hex>/<hash>
    try {
      await this.fs.access(p); // EXISTS → dedupe (NO write)
      return hash;
    } catch {
      // absent → create the prefix dir + write the blob ONCE.
      await this.fs.mkdir(dirname(p), { recursive: true }); // <storageDir>/blobs/<2-hex>/ (idempotent)
      await this.fs.writeFile(p, content);
      return hash;
    }
  }

  /**
   * @internal Read a content blob by hash. Used by S3's restore (write the beforeRef content back).
   * spec/14 §4.1. PUBLIC-for-testing (the round-trip unit test asserts readBlob returns the bytes
   * storeBlob wrote).
   */
  async readBlob(hash: string): Promise<Buffer> {
    return this.fs.readFile(this.blobPath(hash));
  }

  // ── P2.M3.T1.S2 stub (capture) — NOT implemented here. ─────────────────────────────────────
  // Throwing (not a silent no-op) so a premature caller fails loud. detectAndCreate is not wired
  // into index.ts until P3.M1.T2 (after S2/S3 land), so no live code hits this. Async (the interface
  // is async — a sync stub would fail `implements SnapshotStore`).
  async capture(_label: string): Promise<string | null> {
    throw new Error("CasBackend.capture not implemented — see P2.M3.T1.S2");
  }

  // ── P2.M3.T1.S3 stubs (dirtyCheck/restore/has/retire) — NOT implemented here. ──────────────
  async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> {
    throw new Error("CasBackend.dirtyCheck not implemented — see P2.M3.T1.S3");
  }
  async restore(_beforeRef: string, _opts: RestoreOpts): Promise<RestoreResult> {
    throw new Error("CasBackend.restore not implemented — see P2.M3.T1.S3");
  }
  async has(_ref: string): Promise<boolean> {
    throw new Error("CasBackend.has not implemented — see P2.M3.T1.S3");
  }
  async retire(_ref: string): Promise<void> {
    throw new Error("CasBackend.retire not implemented — see P2.M3.T1.S3");
  }
}