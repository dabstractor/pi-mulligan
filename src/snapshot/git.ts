import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "./store.js";
import { normalizeRelPath, isDangerousWorkspaceRel } from "./paths.js";
import type { MulliganConfig } from "../config.js";

const execFileDefault = promisify(execFileCb);

/**
 * GitBackend — the EXTERNAL-SHADOW-REPOSITORY snapshot backend for the v1.2 working-tree-revert
 * feature. spec/14-working-tree-revert.md §3 (GitBackend + the FIVE git-safety guarantees), §5
 * (capture lifecycle & retention), §4.3 (AsyncMutex serialization contract); architecture/
 * external_deps.md §1 (Git CLI shadow-repo command shape + zero new npm deps — Node built-ins only).
 *
 * DESIGN:
 * - SHADOW-REPO ISOLATION (the five git-safety guarantees, spec §3):
 *   1. No ref-moving or write command is ever issued against the USER's git. The ONLY command run
 *      against the source repo is the READ-ONLY `git rev-parse --show-toplevel` /
 *      `--absolute-git-dir` (cwd, NO shadow env). All writes (`add`/`write-tree`/`commit-tree`/
 *      `update-ref`/`init`/`gc`) target the SHADOW repo via the `shadowEnv()` helper.
 *   2. The user's `.git` is never written — not even a dangling object. Every blob/tree/commit/ref
 *      lives in the external shadow repo (strictly cleaner than a `git stash create`-in-source
 *      design, which leaves reclaimable dangling objects in the user's `.git/objects`). Enforced
 *      mechanically: every write command's `env.GIT_DIR === shadowDir`.
 *   3. Restore (P2.M2.T1.S2) writes only working-tree files; the source index + refs are untouched.
 *   4. `delete_created_files` only deletes span-created files, behind the per-call flag AND
 *      config.revert.allowDeleteCreatedFiles (restored by S2).
 *   5. Pre-flight refuse-on-dirty (§6): `dirtyCheck` before restore; if any affected path drifted
 *      since the after-snapshot, the whole file-revert is refused (S2).
 * - REPO-ROOT KEYING (PRD §3 / spec §3): the shadow repo is keyed by the resolved repo root
 *   (`git rev-parse --show-toplevel` → `sha256(root).slice(0,16)`), so subdirectory launches of the
 *   same repo SHARE one shadow repo. Fall back to resolved cwd if rev-parse fails.
 * - LAZY IDEMPOTENT INIT: the shadow `git init --bare` runs ONCE (memoized in `initPromise`; a
 *   second `capture()` does NOT re-init). Concurrent first-captures share ONE init. A transient
 *   init failure resets the memo so the next call retries.
 * - CAPTURE PIPELINE (spec §3): caps pre-walk → `add --all -f -- . :!<excludeGlobs> :!<oversize>` →
 *   `write-tree` → `commit-tree <tree> [-p <parent>] -m "snapshot:<label>"` → `update-ref
 *   refs/mulligan/snapshots/<ns>/<part> <commit>`. `commit-tree` writes ONE object + prints its SHA
 *   (moves NO ref — this two-step object-then-ref write is WHY capture is git-safe); `update-ref`
 *   pins it as a protected ref so it survives the shadow repo's own `gc`. `-f` forces gitignored
 *   files IN (a gitignored `.env` is exactly the file a revert must restore; `.gitignore` is
 *   deliberately NOT consulted). Captured set = everything except `excludeGlobs` (+ oversize +
 *   DANGEROUS_DIRS). `commit-tree`'s optional `-p <parent>` chains captures into a history.
 * - CAPS PRE-WALK (spec §5 / E29): before staging, a recursive readdir walk sums file sizes. Files
 *   > maxFileBytes → added as `:!` pathspec negations + warned (skipped); totalBytes >
 *   maxTotalBytes → abort (null); capturesThisTurn >= maxSnapshotsPerTurn → abort (null). DANGEROUS
 *   dirs are skipped in ADDITION to excludeGlobs (two independent layers — safety floor + perf filter).
 * - BEST-EFFORT (E27): capture NEVER rejects — the whole body is one try/catch that logs + returns
 *   null on ANY git error. The SnapshotStore contract is "null on failure".
 * - ASYNC + DI SEAM: the five IO-bearing methods are async (Promise return) so the constructor-built
 *   `AsyncMutex` can serialize them (spec §4.3). The `deps.exec` (default: promisify(execFile)) +
 *   `deps.scan` (default: the real caps walk) constructor args are the DI TEST SEAM — production
 *   construction (detectAndCreate, P2.M1.T1.S2) omits `deps` and gets the real implementations.
 * - NO sessionId at capture time: the rare caps warnings use `console.warn` (matches config.ts's
 *   warnConfig idiom); structured log.ts logging is added in P3 when sessionId is threaded in.
 *
 * EXPORTED so detectAndCreate (P2.M1.T1.S2) dynamic-imports `./git.js` and constructs
 * `new GitBackend(cwd, revertConfig, sessionDir)` for any git workspace — flipping real git
 * workspaces from backend "none" (fail-open today) to backend "git" with ZERO edits to store.ts
 * (the forward-compat dynamic import already points here).
 */

/** A promisified-execFile shape — the DI test seam (real default = promisify(execFile)). */
export type GitExec = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Result of the caps pre-walk (sizes only — no content read). */
export interface CapScan {
  /** Workspace-relative POSIX paths exceeding maxFileBytes (added as `:!` negations). */
  oversizePaths: string[];
  /** Sum of NON-oversize file sizes (compared against maxTotalBytes). */
  totalBytes: number;
}

/** Constructor DI seam (all optional; production omits → real impls). */
export interface GitBackendDeps {
  /** Default: promisify(execFile). Tests inject a recording fake asserting argv + env. */
  exec?: GitExec;
  /**
   * Default: real recursive fs walk. Tests inject a canned {oversizePaths, totalBytes}. Takes
   * maxFileBytes so the DI seam signature stays clean (the scan owns the per-file-size decision).
   */
  scan?: (repoRoot: string, excludeGlobs: readonly string[], maxFileBytes: number) => Promise<CapScan>;
}

/**
 * Map a capture `label` to its protected ref in the SHADOW repo (spec §5). The namespace is the
 * retention contract: `turn`/`turn-after` → `refs/mulligan/snapshots/turn/*` (GC'd at the
 * prompt boundary by the P3.M1.T1.S1 GC pass); `ckpt:<name>` → `…/checkpoint/<name>`
 * (GC-exempt until revoked/consumed by P2.M2.T1.S2 retire). The prompt-boundary GC pass +
 * retire (S2) MUST agree on these exact prefixes — documented here as the shared contract.
 *
 * Non-`ckpt:` labels (e.g. `"turn"`, `"turn-after"`) all land under `turn/<label>` so the GC
 * `update-ref -d refs/mulligan/snapshots/turn/*` reclaims every turn-scoped snapshot in one pass.
 */
function refForLabel(label: string): string {
  if (label.startsWith("ckpt:")) return `refs/mulligan/snapshots/checkpoint/${label.slice(5)}`;
  return `refs/mulligan/snapshots/turn/${label}`;
}

/**
 * Derive the 16-hex shadow-repo storage key from the resolved repo root (sha256, first 16 hex
 * chars). Repo-root-keyed (NOT cwd) so subdirectory launches of the same repo SHARE one shadow
 * repo (PRD §3 / spec §3). MODULE-PRIVATE.
 */
function shadowKey(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
}

/**
 * The caps pre-walk (real `scan` default). Recursive readdir of `repoRoot`; skip entries whose
 * normalizeRelPath is `isDangerousWorkspaceRel` (safety floor) OR whose name matches an
 * `excludeGlobs` segment (perf filter — two independent layers). For each file, stat().size; if
 * > maxFileBytes → push to `oversizePaths` (staged as `:!` negations); else add to `totalBytes`.
 * Returns sizes only — no file CONTENT is read. MODULE-PRIVATE.
 */
async function scanForCaps(
  repoRoot: string,
  excludeGlobs: readonly string[],
  maxFileBytes: number,
): Promise<CapScan> {
  const oversizePaths: string[] = [];
  let totalBytes = 0;
  const excludeSet = new Set(excludeGlobs.map((g) => g.toLowerCase()));

  async function walk(absDir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip (best-effort; capture never rejects at this layer)
    }
    for (const entry of entries) {
      const rel = normalizeRelPath(repoRoot, join(absDir, entry.name));
      if (isDangerousWorkspaceRel(rel)) continue; // safety floor: .git/.pi/node_modules/.. etc.
      // perf filter: skip if any segment matches an excludeGlob (case-insensitive segment test).
      const segments = rel.split("/");
      if (segments.some((s) => excludeSet.has(s.toLowerCase()))) continue;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = (await stat(abs)).size;
        } catch {
          continue; // unreadable file — skip
        }
        if (size > maxFileBytes) {
          oversizePaths.push(rel);
        } else {
          totalBytes += size;
        }
      }
    }
  }

  await walk(repoRoot);
  return { oversizePaths, totalBytes };
}

/**
 * GitBackend — the shadow-repo snapshot backend. Implements `SnapshotStore` (the 5 IO-bearing
 * methods are async). `describe()` returns `{ backend: "git" }` (sync metadata). This task (S1)
 * ships `init()` + `capture()`; the four remaining methods (`dirtyCheck`/`restore`/`has`/`retire`)
 * are throwing stubs implemented in P2.M2.T1.S2.
 */
export class GitBackend implements SnapshotStore {
  private readonly cwd: string;
  private readonly cfg: MulliganConfig["revert"];
  private readonly storageDir: string;
  private readonly sessionDir: string | null;
  private readonly mutex = new AsyncMutex();
  private readonly exec: GitExec;
  private readonly scan: (root: string, globs: readonly string[], maxFileBytes: number) => Promise<CapScan>;
  // resolved lazily by ensureInit():
  private repoRoot!: string;
  private sourceGitDir!: string;
  private shadowDir!: string;
  private lastCommit: string | null = null; // optional -p <parent> chaining across captures
  private capturesThisTurn = 0; // maxSnapshotsPerTurn cap (reset by lifecycle P3 at turn boundary)
  private initPromise: Promise<void> | null = null;

  /**
   * @param cwd            the workspace root to snapshot (resolved).
   * @param revertConfig   `MulliganConfig["revert"]` (the 8-field block).
   * @param sessionDir     optional — used ONLY when `storageDir` is null, to resolve `<sessionDir>/mulligan/`.
   * @param deps           DI test seam (optional exec + scan; production omits → real impls).
   * @throws when `storageDir` is null AND `sessionDir` is absent (cannot resolve a storage path).
   */
  constructor(
    cwd: string,
    revertConfig: MulliganConfig["revert"],
    sessionDir?: string | null,
    deps?: GitBackendDeps,
  ) {
    this.cwd = resolve(cwd);
    this.cfg = revertConfig;
    this.sessionDir = sessionDir ?? null;
    if (revertConfig.storageDir) {
      this.storageDir = resolve(revertConfig.storageDir);
    } else if (sessionDir) {
      this.storageDir = resolve(sessionDir, "mulligan");
    } else {
      throw new Error("GitBackend: storageDir is null and no sessionDir provided");
    }
    this.exec = deps?.exec ?? (execFileDefault as GitExec);
    this.scan = deps?.scan ?? scanForCaps;
  }

  /** Report the active backend (sync metadata for logging / the rewind notice). */
  describe(): { backend: "git" } {
    return { backend: "git" };
  }

  /**
   * Initialize the shadow repo (idempotent — safe to call multiple times). Resolves repoRoot +
   * sourceGitDir via read-only rev-parse against the USER's repo, derives the shadow key, and runs
   * `git init --bare` against the SHADOW repo if it does not yet exist. Delegates to the memoized
   * `ensureInit()` so concurrent first-captures share ONE init.
   */
  async init(): Promise<void> {
    await this.ensureInit();
  }

  /**
   * Lazy memoized init — the SINGLE source of repoRoot/sourceGitDir/shadowDir resolution. Concurrent
   * first-captures share ONE init (the memoized `initPromise`). A FAILED init resets the memo so the
   * NEXT capture retries rather than permanently bricking the backend (e.g. a transient disk-full).
   * MODULE-PRIVATE.
   *
   * Step (1) is the ONLY command against the USER's repo — read-only rev-parse, cwd, NO shadow env
   * (guarantee #1). Step (2) runs `git init --bare` against the SHADOW repo only if `shadowDir` does
   * not already exist (idempotent — `existsSync` gate so a second capture never re-inits).
   */
  private ensureInit(): Promise<void> {
    if (this.initPromise) return this.initPromise; // memoize: concurrent first-calls share ONE init
    this.initPromise = (async () => {
      // (1) READ-ONLY resolve against the USER's repo — cwd, NO shadow env. Guarantee #1.
      const top = (
        await this.exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.cwd })
      ).stdout.trim();
      const gitDir = (
        await this.exec("git", ["rev-parse", "--absolute-git-dir"], { cwd: this.cwd })
      ).stdout.trim();
      this.repoRoot = top || this.cwd; // PRD: repo-root-keyed; fall back to resolved cwd
      this.sourceGitDir = gitDir;
      this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot));
      // (2) lazily init the SHADOW repo (idempotent — skip if it already exists on disk).
      //     `git init --bare` needs ONLY GIT_DIR (git forbids GIT_WORK_TREE on a bare init — it is
      //     meaningless for a bare repo). The work-tree association is established per-command later
      //     via shadowEnv() (add/commit-tree/etc.). GIT_DIR alone redirects the new object DB + refs to
      //     the shadow repo → guarantee #2 (the user's .git is never written).
      if (!existsSync(this.shadowDir)) {
        await this.exec("git", ["init", "--bare"], {
          env: { ...process.env, GIT_DIR: this.shadowDir },
          maxBuffer: 16 * 1024 * 1024,
        });
      }
    })().catch((e) => {
      this.initPromise = null; // a failed init can retry next call (transient failure → not permanent)
      throw e;
    });
    return this.initPromise;
  }

  /**
   * Snapshot the working set NOW → opaque commit SHA ref, or `null` on ANY failure (best-effort,
   * E27 — capture NEVER rejects). Serialized by the per-backend AsyncMutex (spec §4.3).
   *
   * Pipeline: acquire mutex → ensureInit → caps pre-walk (skip oversize via `:!`; abort on budget/
   * count cap) → `add --all -f -- . :!<excludeGlobs> :!<oversize>` (gitignored files INCLUDED via
   * `-f`) → `write-tree` → `commit-tree <tree> [-p <parent>] -m "snapshot:<label>"` → `update-ref
   * refs/mulligan/snapshots/<ns>/<part> <commit>` → return commitSha. Every write command carries
   * `env.GIT_DIR=shadowDir` + `GIT_WORK_TREE=repoRoot` (guarantees #1/#2).
   */
  async capture(label: string): Promise<string | null> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    try {
      await this.ensureInit();
      // CAPS (E29): pre-walk for sizes. Oversize → pathspec negation + warn; budget/count → abort.
      if (this.capturesThisTurn >= this.cfg.maxSnapshotsPerTurn) {
        console.warn(
          `[mulligan] snapshot.capture: maxSnapshotsPerTurn (${this.cfg.maxSnapshotsPerTurn}) reached — skipping`,
        );
        return null;
      }
      const { oversizePaths, totalBytes } = await this.scan(
        this.repoRoot,
        this.cfg.excludeGlobs,
        this.cfg.maxFileBytes,
      );
      if (totalBytes > this.cfg.maxTotalBytes) {
        console.warn(
          `[mulligan] snapshot.capture: maxTotalBytes (${this.cfg.maxTotalBytes}) exceeded (${totalBytes}) — aborting`,
        );
        return null;
      }
      for (const p of oversizePaths)
        console.warn(`[mulligan] snapshot.capture: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${p}`);
      // PATHSPECS: include all (.), then exclude globs + oversize, as `:!` single-argv elements.
      const pathspecs = [
        ".",
        ...this.cfg.excludeGlobs.map((g) => `:!${g}`),
        ...oversizePaths.map((p) => `:!${p}`),
      ];
      // (3) stage into the SHADOW index — gitignored files INCLUDED via -f (spec §3).
      await this.exec("git", ["add", "--all", "-f", "--", ...pathspecs], this.shadowEnv());
      // (4) write-tree → tree SHA (shadow DB).
      const treeSha = (await this.exec("git", ["write-tree"], this.shadowEnv())).stdout.trim();
      // (5) commit-tree → commit SHA (shadow DB; NO ref moved). Optional -p parent for history.
      const commitArgs = ["commit-tree", treeSha];
      if (this.lastCommit) commitArgs.push("-p", this.lastCommit);
      commitArgs.push("-m", `snapshot:${label}`);
      const commitSha = (await this.exec("git", commitArgs, this.shadowEnv())).stdout.trim();
      // (6) pin via a protected ref in the SHADOW repo (namespace: turn/* | checkpoint/<name>).
      await this.exec("git", ["update-ref", refForLabel(label), commitSha], this.shadowEnv());
      this.lastCommit = commitSha;
      this.capturesThisTurn++;
      return commitSha;
    } catch (err) {
      // E27 best-effort: ANY git error → null (capture never rejects). Guarantees capture is non-fatal.
      console.warn(
        `[mulligan] snapshot.capture failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      release();
    }
  }

  /**
   * Build the shadow-repo env for a write command. EVERY write (`add`/`write-tree`/`commit-tree`/
   * `update-ref`/`init`/`gc`) goes through this helper — it is guarantees #1/#2 made mechanical:
   * `GIT_DIR=shadowDir` redirects the object DB + refs to the shadow repo; `GIT_WORK_TREE=repoRoot`
   * points the index at the user's working tree (so `add` stages real files into the shadow index).
   * `maxBuffer` is raised to 16 MB so a large repo never aborts capture spuriously (default 1 MB).
   * MODULE-PRIVATE.
   */
  private shadowEnv(): { env: NodeJS.ProcessEnv; maxBuffer: number } {
    return {
      env: { ...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot },
      maxBuffer: 16 * 1024 * 1024,
    };
  }

  // ── P2.M2.T1.S2 stubs (dirtyCheck/restore/has/retire) — NOT implemented here. ──
  // Throwing (not silent no-ops) so a premature caller fails loud. detectAndCreate is not wired into
  // index.ts until P3.M1.T2 (after S2 lands), so no live code hits these.
  async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> {
    throw new Error("GitBackend.dirtyCheck not implemented — see P2.M2.T1.S2");
  }
  async restore(_beforeRef: string, _opts: RestoreOpts): Promise<RestoreResult> {
    throw new Error("GitBackend.restore not implemented — see P2.M2.T1.S2");
  }
  async has(_ref: string): Promise<boolean> {
    throw new Error("GitBackend.has not implemented — see P2.M2.T1.S2");
  }
  async retire(_ref: string): Promise<void> {
    throw new Error("GitBackend.retire not implemented — see P2.M2.T1.S2");
  }
}