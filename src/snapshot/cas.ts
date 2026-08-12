import { createHash } from "node:crypto";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir as fsMkdir,
  access as fsAccess,
  stat as fsStat,
  readdir as fsReaddir,
  unlink as fsUnlink,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "./store.js";
import { normalizeRelPath, isDangerousWorkspaceRel, resolveSafeWorkspacePath } from "./paths.js";
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
  /** readdir({withFileTypes:true}) — S2's capture walks the cwd tree. */
  readdir(path: string, opts: { withFileTypes: true }): Promise<import("node:fs").Dirent[]>;
  /** unlink — S3's restore deleteCreatedFiles removes span-created worktree files (external_deps §2). */
  unlink(path: string): Promise<void>;
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
  readdir: fsReaddir,
  unlink: fsUnlink,
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
  /** maxSnapshotsPerTurn cap; incremented per successful capture. Reset by lifecycle P3 at turn
   *  boundary (parity with GitBackend — spec §4.3). */
  private capturesThisTurn = 0;
  /** Once-per-turn bash-not-captured warning latch (explicit-paths mode, §4.2). Reset by lifecycle
   *  P3 at the turn boundary (parity with capturesThisTurn). */
  private bashWarnedThisTurn = false;

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

  /**
   * @internal Load the previous manifest's per-file entries for `label` into a Map keyed by
   * workspace-relative path, for the mtime/size short-circuit (spec/14 §4.1: "if (mtime,size) matches
   * the previous manifest, reuse its hash and skip re-read/re-hash"). Returns an EMPTY map when the
   * label has no manifest yet OR the stored manifest is missing/corrupt (parseManifest throws on a
   * bad version → swallowed → full capture with NO short-circuit). NEVER throws — a failure here is
   * a benign fall-back to a full read/hash/store pass. The manifest is read from
   * `<storageDir>/manifests/<label>.json` (consecutive capture('turn') overwrites it; this reads the
   * prior turn's entry map). spec/14 §4.1.
   */
  private async loadPrevEntries(
    label: string,
  ): Promise<Map<string, { hash: string; size: number; mtime: number }>> {
    const map = new Map<string, { hash: string; size: number; mtime: number }>();
    try {
      const p = this.manifestPath(label);
      await this.fs.access(p); // rejects if absent → empty map (first capture for this label)
      const buf = await this.fs.readFile(p); // CasFs.readFile returns a Buffer
      const m = parseManifest(buf.toString("utf8")); // parseManifest takes a STRING; throws on bad version
      for (const [path, e] of Object.entries(m.files)) {
        map.set(path, { hash: e.hash, size: e.size, mtime: e.mtime });
      }
    } catch {
      // missing label OR corrupt JSON → no short-circuit (full capture). Silent — first capture.
    }
    return map;
  }

  /**
   * @internal Recursively walk `absDir`, invoking `visit(rel, abs, stat)` for every allowed FILE
   * (dirs recurse; symlinks/sockets/etc. are ignored — only `isFile()` is captured, mirroring
   * git.ts's scanForCaps walk exactly so the two backends share lexical safety + exclusion
   * semantics, spec §4.3 backend parity). PRUNES any subtree rooted at a dangerous dir
   * (`.git`/`.pi`/`node_modules` — isDangerousWorkspaceRel, paths.ts safety floor) or whose rel
   * path has a `/`-segment case-insensitively matching an excludeGlob (config perf filter). An
   * unreadable dir/file is SKIPPED (best-effort — never throws from the walk itself; visitor errors
   * propagate to capture's single try/catch). spec/14 §4.1 (walk cwd recursively), §4.3 (path safety).
   */
  private async walkTree(
    absDir: string,
    excludeSet: Set<string>,
    visit: (rel: string, abs: string, st: { size: number; mtimeMs: number }) => Promise<void>,
  ): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await this.fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return; // unreadable dir → skip subtree (mirror git.ts)
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name);
      const rel = normalizeRelPath(this.cwd, abs);
      if (isDangerousWorkspaceRel(rel)) continue; // safety floor — PRUNE subtree
      if (rel.split("/").some((s) => excludeSet.has(s.toLowerCase()))) continue; // perf filter — PRUNE
      if (entry.isDirectory()) {
        await this.walkTree(abs, excludeSet, visit);
      } else if (entry.isFile()) {
        let st: { size: number; mtimeMs: number };
        try {
          st = await this.fs.stat(abs);
        } catch {
          continue; // unreadable file → skip
        }
        await visit(rel, abs, st);
      }
      // symlinks/sockets/etc. → ignored (only real files captured; symlinked dirs NOT recursed —
      // entry.isDirectory() is false for symlinks, mirroring git.ts).
    }
  }

  /**
   * Seam for the P3 tool_call hook: call when a bash tool_call runs in explicit-paths mode. Emits
   * the once-per-turn "bash changes NOT captured" warning (spec/14 §4.2) + latches so the 2nd call
   * is silent. No-op in 'cas' mode (bash is captured there — whole-tree walk). Idempotent within a
   * turn (the P3 hook resets `bashWarnedThisTurn` at the turn boundary, parity with capturesThisTurn).
   *
   * PUBLIC so the P3 tool_call hook calls it on a CasBackend-typed ref (a SnapshotStore-typed ref
   * cannot reach it — the explicit-paths mode is CasBackend-specific; the P3 hook casts
   * `store as CasBackend`). @14 §4.2.
   */
  notifyBashUsed(): void {
    if (this.cfg.nonGitMode !== "explicit-paths") return; // only the conservative mode warns
    if (this.bashWarnedThisTurn) return; // once-per-turn dedup
    this.bashWarnedThisTurn = true;
    console.warn(
      "[mulligan] snapshot: a bash tool ran in explicit-paths mode — its file changes are NOT captured and will NOT be restored on undo; use a git repo or 'cas' mode for full coverage",
    );
  }

  /**
   * Capture ONLY the explicit write/edit tool paths (the conservative pi-undo-redo model — spec/14
   * §4.2). Does NOT scan the workspace (contrast S2's whole-tree walk). For each workspace-rel
   * posix path in `explicitPaths` (deduped): dangerous-path skip; `resolveSafeWorkspacePath` (a
   * `..`/absolute escape throws → propagates to capture()'s outer catch → null); stat → ENOENT ⇒
   * record `{hash:"", size:0, mtime:0, existed:false}` (the file is about to be CREATED by the
   * upcoming write — no blob, no content; S1 existed contract); else oversize (`> maxFileBytes`)
   * skip+warn, byte-budget (`> maxTotalBytes`) partial-skip, otherwise `readFile` → `hashContent` →
   * `storeBlob` (deduped) → `{hash, size, mtime, existed:true}`. Caps (§4.3/E29): maxFileBytes ⇒
   * skip+warn; maxTotalBytes ⇒ partial-skip (STILL returns label); maxSnapshotsPerTurn ⇒ null (the
   * count-cap gate in capture() aborts BEFORE dispatch). Bash paths are NEVER in `explicitPaths`
   * (the P3 hook passes only write/edit tool paths); the once-per-turn bash warning is
   * {@link notifyBashUsed}.
   *
   * RUNS INSIDE capture()'s mutex + try — do NOT re-acquire the mutex or re-check capturesThisTurn
   * (it shares both). It DOES increment capturesThisTurn + write the manifest itself (it IS the
   * whole explicit-paths path). BEST-EFFORT: any thrown error propagates to capture()'s outer
   * catch ⇒ null (capture never rejects). @14 §4.2.
   *
   * @returns the manifest label (ref === label).
   */
  private async captureExplicitPaths(
    label: string,
    explicitPaths?: string[],
  ): Promise<string | null> {
    const files: Record<string, CasManifestEntry> = {};
    const seen = new Set<string>();
    let totalBytes = 0;
    let partial = false;
    for (const rel of explicitPaths ?? []) {
      if (seen.has(rel)) continue; // dedupe (a path written twice is captured once)
      seen.add(rel);
      if (isDangerousWorkspaceRel(rel)) continue; // safety floor — .git/.pi/node_modules/../dir
      const abs = resolveSafeWorkspacePath(this.cwd, rel); // THROWS on escape ⇒ capture's catch ⇒ null
      let st: { size: number; mtimeMs: number };
      try {
        st = await this.fs.stat(abs);
      } catch {
        // file does not exist yet (the upcoming write will CREATE it) ⇒ record absence, NO blob
        // (S1 existed contract: existed:false ⇒ restore DELETES it to recreate the pre-span absence).
        files[rel] = { hash: "", size: 0, mtime: 0, existed: false };
        continue;
      }
      if (st.size > this.cfg.maxFileBytes) {
        // fail-closed (§4.3) — never silently claim restorable
        console.warn(
          `[mulligan] snapshot.capture: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${rel}`,
        );
        continue;
      }
      if (totalBytes + st.size > this.cfg.maxTotalBytes) {
        // partial — stop accepting new data (E29). NOT abort (CAS is file-by-file; git.ts aborts
        // because git is atomic — this is the deliberate divergence, §4.3).
        partial = true;
        console.warn(
          `[mulligan] snapshot.capture: maxTotalBytes (${this.cfg.maxTotalBytes}) reached — partial snapshot, skipping: ${rel}`,
        );
        continue;
      }
      const content = await this.fs.readFile(abs);
      const hash = await this.hashContent(content);
      await this.storeBlob(content); // deduped via access (S1)
      files[rel] = { hash, size: st.size, mtime: st.mtimeMs, existed: true };
      totalBytes += st.size;
    }
    const manifest: CasManifest = { version: 1, label, turnIndex: 0, ts: Date.now(), files };
    await this.fs.mkdir(join(this.storageDir, "manifests"), { recursive: true });
    await this.fs.writeFile(this.manifestPath(label), Buffer.from(serializeManifest(manifest), "utf8"));
    this.capturesThisTurn++;
    if (partial) {
      console.warn(`[mulligan] snapshot.capture: wrote PARTIAL manifest for ${label} (maxTotalBytes cap)`);
    }
    return label; // ref === label
  }

  /**
   * Snapshot the whole working set NOW (the 'cas' default non-git mode) and return `label` as the
   * ref. Walks cwd (minus excludeGlobs + dangerous dirs), stats every file, and:
   *  - reuses the previous manifest's hash when (mtimeMs,size) is unchanged (git's index-refresh
   *    trick — O(changed-files) steady-state I/O, spec/14 §4.1);
   *  - else reads + hashes + stores (deduped) the content into the blob store.
   * Caps (spec §5, E29): maxFileBytes → skip+warn (fail-closed); maxTotalBytes → skip files beyond
   * the budget + mark the manifest PARTIAL (capture STILL returns the label — CAS is file-by-file,
   * NOT atomic, so it diverges from git.ts which ABORTS here; this divergence is the deliberate
   * design — E29); maxSnapshotsPerTurn → return null (abort). Serialized by the per-instance
   * AsyncMutex (§4.3) — max-in-flight 1 across capture/dirtyCheck/restore/retire/gc.
   *
   * MODE DISPATCH (§4.2): if `cfg.nonGitMode === "explicit-paths"`, this delegates to
   * {@link captureExplicitPaths} (bounded scope — only the write/edit tool paths) AFTER the shared
   * count-cap gate; the explicit-paths dispatch runs INSIDE this method's mutex + try, so its errors
   * are covered by the outer catch → null + the release is in the finally. Else (the 'cas' default)
   * the whole-tree walk below runs unchanged. The widened `explicitPaths` param is CasBackend-
   * specific (a SnapshotStore-typed ref cannot see it — the P3 tool_call hook casts to CasBackend).
   *
   * BEST-EFFORT: any thrown error → console.warn + return null (never rejects). @14 §4.1/§4.2.
   *
   * @param label          the capture-namespace key ("turn" | "turn-after" | "ckpt:<name>").
   * @param explicitPaths  (CasBackend-specific, §4.2) the write/edit tool paths to capture in
   *                       explicit-paths mode. IGNORED in 'cas' mode (whole-tree walk runs instead).
   * @returns the manifest label (ref === label; `<storageDir>/manifests/<label>.json` is resolvable
   *          by S3's has/retire/dirtyCheck/restore). `null` only on count-cap abort OR a thrown error.
   */
  async capture(label: string, explicitPaths?: string[]): Promise<string | null> {
    const release = await this.mutex.acquire(); // spec §4.3 — whole body serialized
    try {
      // Cap 1 — per-turn snapshot count (parity with GitBackend; reset by lifecycle P3).
      if (this.capturesThisTurn >= this.cfg.maxSnapshotsPerTurn) {
        console.warn(
          `[mulligan] snapshot.capture: maxSnapshotsPerTurn (${this.cfg.maxSnapshotsPerTurn}) reached — skipping ${label}`,
        );
        return null;
      }
      // Mode dispatch (§4.2): explicit-paths delegates to the bounded-scope capture (inside this
      // method's mutex + try — its errors ⇒ null via this catch; the release is in the finally).
      if (this.cfg.nonGitMode === "explicit-paths") {
        return await this.captureExplicitPaths(label, explicitPaths);
      }
      const prev = await this.loadPrevEntries(label); // short-circuit source; empty on miss/corrupt
      const files: Record<string, CasManifestEntry> = {};
      let totalBytes = 0;
      let partial = false;
      const excludeSet = new Set(this.cfg.excludeGlobs.map((g) => g.toLowerCase()));

      await this.walkTree(this.cwd, excludeSet, async (rel, abs, st) => {
        // oversize → fail-closed skip+warn (never silently claim restorable)
        if (st.size > this.cfg.maxFileBytes) {
          console.warn(
            `[mulligan] snapshot.capture: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${rel}`,
          );
          return;
        }
        // mtime/size short-circuit — reuse stored hash, NO read/re-hash/store
        const pe = prev.get(rel);
        if (pe && pe.size === st.size && pe.mtime === st.mtimeMs) {
          files[rel] = { hash: pe.hash, size: st.size, mtime: st.mtimeMs, existed: true };
          return;
        }
        // byte budget → stop accepting NEW data, mark PARTIAL (E29). NOT abort (CAS is file-by-file;
        // git.ts aborts here because git is atomic — this is the deliberate divergence, §4.3).
        if (totalBytes + st.size > this.cfg.maxTotalBytes) {
          partial = true;
          console.warn(
            `[mulligan] snapshot.capture: maxTotalBytes (${this.cfg.maxTotalBytes}) reached — partial snapshot, skipping: ${rel}`,
          );
          return;
        }
        const content = await this.fs.readFile(abs);
        const hash = await this.hashContent(content);
        await this.storeBlob(content); // deduped via access (S1)
        files[rel] = { hash, size: st.size, mtime: st.mtimeMs, existed: true };
        totalBytes += st.size;
      });

      const manifest: CasManifest = { version: 1, label, turnIndex: 0, ts: Date.now(), files };
      await this.fs.mkdir(join(this.storageDir, "manifests"), { recursive: true });
      await this.fs.writeFile(this.manifestPath(label), Buffer.from(serializeManifest(manifest), "utf8"));
      this.capturesThisTurn++;
      if (partial) {
        console.warn(`[mulligan] snapshot.capture: wrote PARTIAL manifest for ${label} (maxTotalBytes cap)`);
      }
      return label; // ref === label
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mulligan] snapshot.capture failed: ${msg}`);
      return null;
    } finally {
      release();
    }
  }

  /**
   * Return the subset of `paths` whose CURRENT work-tree content differs from the `afterRef`
   * snapshot — files that drifted AFTER the agent's turn (a human/other-process edit since
   * `agent_end`). spec/14 §6 step 3 (the dirty guard REFUSE), §2 (the interface). The restore
   * dirty-guard calls this BEFORE restore: if ANY affected path is dirty, the WHOLE file-revert is
   * refused (not silently clobbered — E30).
   *
   * Implementation (CAS = content-hash compare, contrast git.ts `git diff`): read the afterRef
   * manifest; for each path re-hash the CURRENT file + compare to the manifest entry. Dirty cases:
   *   - entry.existed && currentHash ≠ entry.hash  (content drifted since afterRef)
   *   - entry.existed && file gone now              (deleted since afterRef)
   *   - !entry (no afterRef baseline) && exists now  (conservative — mirrors `git diff` on an
   *                                                  unknown path)
   *   - entry.existed === false && exists now        (created since afterRef)
   * null/empty `afterRef` (no drift baseline — e.g. a mid-turn rewind with no after-ref yet) OR
   * empty `paths` ⇒ `[]` (allow). Serialized by the mutex (spec §4.3).
   *
   * BEST-EFFORT (E27): NEVER rejects — a missing/corrupt afterRef manifest OR any error is caught,
   * warned, and returns `[]` (no drift detected ⇒ allow restore). The refuse/allow decision is the
   * caller's (rewindExecute, P4.M2.T1). @14 §6 step 3 + §4.3.
   */
  async dirtyCheck(afterRef: string, paths: string[]): Promise<string[]> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    try {
      if (!afterRef || paths.length === 0) return []; // no drift baseline / nothing to check ⇒ allow
      let manifest: CasManifest;
      try {
        const buf = await this.fs.readFile(this.manifestPath(afterRef));
        manifest = parseManifest(buf.toString("utf8")); // throws on bad version — caught below ⇒ []
      } catch {
        return []; // missing/corrupt afterRef ⇒ allow (best-effort)
      }
      const dirty: string[] = [];
      for (const rel of paths) {
        if (isDangerousWorkspaceRel(rel)) continue; // never report/operate on a dangerous path
        const entry = manifest.files[rel];
        let currentHash: string | null = null;
        let existsNow = false;
        try {
          const abs = resolveSafeWorkspacePath(this.cwd, rel); // escape ⇒ existsNow stays false
          currentHash = await this.hashContent(await this.fs.readFile(abs));
          existsNow = true;
        } catch {
          existsNow = false; // ENOENT or escape ⇒ file not (safely) readable now
        }
        if (existsNow) {
          if (!entry) {
            dirty.push(rel); // exists now, no afterRef baseline ⇒ dirty (conservative)
          } else if (!entry.existed) {
            dirty.push(rel); // afterRef said absent, exists now ⇒ created since ⇒ dirty
          } else if (currentHash !== entry.hash) {
            dirty.push(rel); // content drifted ⇒ dirty
          }
          // else: clean
        } else if (entry && entry.existed) {
          dirty.push(rel); // was at afterRef, now gone ⇒ deleted since ⇒ dirty
        }
        // entry absent or existed:false + gone now ⇒ correctly absent ⇒ not dirty
      }
      return dirty;
    } catch (err) {
      // E27 best-effort: any error ⇒ [] (no drift detected ⇒ allow restore). Never rejects.
      console.warn(
        `[mulligan] snapshot.dirtyCheck failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    } finally {
      release();
    }
  }

  /**
   * Write working-tree files FROM the `beforeRef` snapshot (restore the pre-span file state).
   * spec/14 §6 (restore semantics), §2 (the interface). Serialized by the mutex (spec §4.3).
   * CONSUMED BY: rewindExecute step 6b (P4.M2.T1.S2) after the dirty guard passes.
   *
   * INTERFACE: `restore(beforeRef, opts)` has NO `afterRef` param (LOCKED by store.ts). The
   * "after-manifest but not before" reconcile is MODE-AWARE (research D2):
   *   - explicit-paths: the created-during-span files are the manifest's `existed:false` entries
   *     (the P3 hook captured not-yet-existing paths as existed:false just before their creating
   *     write). The manifest loop below deletes those — NO tree walk (explicit-paths is conservative;
   *     walking would over-delete, and bash-created files are deliberately NOT promised restorable
   *     per §4.2).
   *   - 'cas' mode: a comprehensive tree walk (S2's walkTree) deletes files present NOW but NOT in
   *     the beforeRef manifest (the git.ts `ls-files --others` analog). The dirty guard (rewindExecute,
   *     P4) REFUSES if the worktree drifted from afterRef, so present-now ≈ afterRef at restore time.
   *
   * RECIPE (spec/14 §6 — working-tree ONLY):
   *  (b) MANIFEST LOOP (mode-agnostic): for each {path, entry}:
   *      - entry.existed && opts.revertFileChanges ⇒ readBlob(hash) + writeFile(worktree) ⇒ reverted[].
   *      - !entry.existed && opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles ⇒ unlink(worktree)
   *        ⇒ deleted[] (ENOENT ⇒ silent; other error ⇒ failed[]).
   *  (c) 'cas'-MODE-ONLY tree-walk deleteCreatedFiles (two-flag AND + nonGitMode==='cas'): walkTree;
   *      unlink every present file whose rel is NOT in the beforeRef manifest (+ not dangerous).
   *      explicit-paths does NOT walk (its created files are the existed:false entries above).
   *
   * BEST-EFFORT (E27): NEVER rejects. Per-path read/write/unlink failures land in `failed[]`; a
   * missing/corrupt beforeRef manifest ⇒ warn + return whatever was collected (5 buckets). The
   * feature's overriding rule: revert degradation never blocks the context rewind (PRD §6 step 1).
   * @14 §6 + §4.3.
   */
  async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    const result: RestoreResult = { reverted: [], deleted: [], failed: [], skipped: [], refused: [] };
    try {
      // Neither flag set ⇒ nothing to do (rewindExecute normally guards this, but restore is
      // best-effort + defensive — return the 5 empty buckets without touching the fs).
      if (!opts.revertFileChanges && !opts.deleteCreatedFiles) return result;

      let manifest: CasManifest;
      try {
        const buf = await this.fs.readFile(this.manifestPath(beforeRef));
        manifest = parseManifest(buf.toString("utf8"));
      } catch (err) {
        // missing/corrupt beforeRef ⇒ nothing restorable; return the (all-empty) result. Never rejects.
        console.warn(
          `[mulligan] snapshot.restore: cannot read beforeRef manifest: ${err instanceof Error ? err.message : String(err)}`,
        );
        return result;
      }

      // (b) REVERT pre-existing files + DELETE span-created files from the manifest (mode-agnostic).
      for (const [rel, entry] of Object.entries(manifest.files)) {
        if (isDangerousWorkspaceRel(rel)) continue; // safety floor — never touch .git/.pi/node_modules
        let abs: string;
        try {
          abs = resolveSafeWorkspacePath(this.cwd, rel); // escape ⇒ failed[]
        } catch {
          result.failed.push(rel);
          continue;
        }
        if (entry.existed && opts.revertFileChanges) {
          try {
            const content = await this.readBlob(entry.hash); // pre-span bytes (S1)
            await this.fs.writeFile(abs, content); // write the working-tree FILE (never git index)
            result.reverted.push(rel);
          } catch {
            result.failed.push(rel); // per-path best-effort (E27) — restore still resolves
          }
        } else if (!entry.existed && opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles) {
          // TWO-FLAG AND: existed:false = created during span (captured by the P3 hook just before
          // the creating write). Delete to recreate the pre-span absence. explicit-paths path (no walk).
          try {
            await this.fs.unlink(abs);
            result.deleted.push(rel);
          } catch (e) {
            // ENOENT (already gone — e.g. deleted twice) ⇒ silent; any other error ⇒ failed[].
            const code = (e as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") result.failed.push(rel);
          }
        }
      }

      // (c) 'cas'-MODE-ONLY comprehensive deleteCreatedFiles: walk + delete present-not-in-beforeRef.
      //     explicit-paths does NOT walk (its created files are the existed:false entries above; bash-
      //     created files are deliberately NOT promised restorable — §4.2). Mirrors git.ts ls-files
      //     --others. Belt-and-suspenders: walkTree already prunes dangerous dirs + excludeGlobs.
      if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles && this.cfg.nonGitMode === "cas") {
        const excludeSet = new Set(this.cfg.excludeGlobs.map((g) => g.toLowerCase()));
        await this.walkTree(this.cwd, excludeSet, async (rel, abs) => {
          if (manifest.files[rel]) return; // in beforeRef ⇒ not created during span
          if (isDangerousWorkspaceRel(rel)) return; // belt-and-suspenders (walkTree already prunes)
          try {
            await this.fs.unlink(abs);
            result.deleted.push(rel);
          } catch (e) {
            const code = (e as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") result.failed.push(rel); // already gone ⇒ silent
          }
        });
      }

      return result;
    } catch (err) {
      // E27 — never rejects; return whatever was collected so far.
      console.warn(
        `[mulligan] snapshot.restore partial: ${err instanceof Error ? err.message : String(err)}`,
      );
      return result;
    } finally {
      release();
    }
  }

  /**
   * Does a snapshot ref still exist (resolvable) in the CAS store? Used by the capture lifecycle /
   * cross-reload (E32) to decide whether a persisted RevertCheckpoint's refs are still honored.
   * spec/14 §2.
   *
   * Implementation: `fs.access(manifestPath(ref))` (resolves ⇒ true; rejects ⇒ false). `ref` is a
   * manifest label (capture()'s return — the manifest filename, NOT a hash).
   *
   * NOT mutex-serialized (spec §4.3 omits `has` from the serialized list — parity with git.ts — it
   * is a fast read-only existence check; serializing it would add latency to the cross-reload
   * ref-honoring path for no correctness benefit, since it writes nothing and mutates no state).
   * BEST-EFFORT: never rejects. @14 §2.
   */
  async has(ref: string): Promise<boolean> {
    try {
      await this.fs.access(this.manifestPath(ref)); // rejects if absent
      return true;
    } catch {
      return false; // missing/corrupt ⇒ false. Never rejects.
    }
  }

  /**
   * Drop a manifest ref so its underlying blobs can be reclaimed by the next GC pass. Called when a
   * checkpoint is revoked/consumed; the prompt-boundary GC pass (spec §5) retires turn/* refs en
   * masse. spec/14 §2, §5. Serialized by the mutex (spec §4.3).
   *
   * Implementation: `unlink(manifestPath(ref))`. ENOENT (already retired — a 2nd retire) ⇒ silent;
   * any other error ⇒ warn. **Blob mark-sweep is DEFERRED** to the prompt-boundary GC pass (P3, §5)
   * — `retire` only drops the manifest ref so its blobs become reclaimable later (mirrors git.ts
   * `retire` which only does `update-ref -d`, letting `git gc` reclaim). BEST-EFFORT: never rejects
   * (returns void). @14 §2/§5.
   */
  async retire(ref: string): Promise<void> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    try {
      await this.fs.unlink(this.manifestPath(ref));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        // already retired (2nd call) ⇒ silent (ENOENT); any other error ⇒ warn + void.
        console.warn(
          `[mulligan] snapshot.retire failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } finally {
      release();
    }
  }
}