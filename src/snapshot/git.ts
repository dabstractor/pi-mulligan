import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  readdir,
  stat,
  unlink as fsUnlink,
  rm as fsRm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AsyncMutex,
  type SnapshotStore,
  type RestoreOpts,
  type RestoreResult,
} from "./store.js";
import {
  normalizeRelPath,
  isDangerousWorkspaceRel,
  resolveSafeWorkspacePath,
  DANGEROUS_DIRS,
} from "./paths.js";
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
  scan?: (
    repoRoot: string,
    excludeGlobs: readonly string[],
    maxFileBytes: number,
  ) => Promise<CapScan>;
  /**
   * Default: node:fs/promises.unlink. The delete-created-files path in restore() (S2) calls this;
   * tests inject a recording fake to assert unlink targets (never node_modules/.git). Optional +
   * backward-compatible — production construction omits it → real fsUnlink.
   */
  unlink?: (path: string) => Promise<void>;
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
  if (label.startsWith("ckpt:"))
    return `refs/mulligan/snapshots/checkpoint/${label.slice(5)}`;
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
 * GitBackend — the shadow-repo snapshot backend. Implements the FULL `SnapshotStore` interface (the
 * 5 IO-bearing methods are async). `describe()` returns `{ backend: "git" }` (sync metadata). S1
 * (P2.M2.T1.S1) shipped `init()` + `capture()`; S2 (P2.M2.T1.S2) shipped `dirtyCheck` + `restore` +
 * `has` + `retire` (real, working-tree-only, git-safe, mutex-serialized implementations).
 */
export class GitBackend implements SnapshotStore {
  private readonly cwd: string;
  private readonly cfg: MulliganConfig["revert"];
  private readonly storageDir: string;
  private readonly sessionDir: string | null;
  private readonly mutex = new AsyncMutex();
  private readonly exec: GitExec;
  private readonly scan: (
    root: string,
    globs: readonly string[],
    maxFileBytes: number,
  ) => Promise<CapScan>;
  private readonly unlink: (path: string) => Promise<void>;
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
   * @param deps           DI test seam (optional exec + scan + unlink; production omits → real impls).
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
      throw new Error(
        "GitBackend: storageDir is null and no sessionDir provided",
      );
    }
    this.exec = deps?.exec ?? (execFileDefault as GitExec);
    this.scan = deps?.scan ?? scanForCaps;
    this.unlink = deps?.unlink ?? fsUnlink;
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
        await this.exec("git", ["rev-parse", "--show-toplevel"], {
          cwd: this.cwd,
        })
      ).stdout.trim();
      const gitDir = (
        await this.exec("git", ["rev-parse", "--absolute-git-dir"], {
          cwd: this.cwd,
        })
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
        console.warn(
          `[mulligan] snapshot.capture: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${p}`,
        );
      // PATHSPECS: include all (.), then exclude globs + oversize, as `:!` single-argv elements.
      const pathspecs = [
        ".",
        ...this.cfg.excludeGlobs.map((g) => `:!${g}`),
        ...oversizePaths.map((p) => `:!${p}`),
      ];
      // (3) stage into the SHADOW index — gitignored files INCLUDED via -f (spec §3).
      await this.exec(
        "git",
        ["add", "--all", "-f", "--", ...pathspecs],
        this.shadowEnv(),
      );
      // (4) write-tree → tree SHA (shadow DB).
      const treeSha = (
        await this.exec("git", ["write-tree"], this.shadowEnv())
      ).stdout.trim();
      // (5) commit-tree → commit SHA (shadow DB; NO ref moved). Optional -p parent for history.
      const commitArgs = ["commit-tree", treeSha];
      if (this.lastCommit) commitArgs.push("-p", this.lastCommit);
      commitArgs.push("-m", `snapshot:${label}`);
      const commitSha = (
        await this.exec("git", commitArgs, this.shadowEnv())
      ).stdout.trim();
      // (6) pin via a protected ref in the SHADOW repo (namespace: turn/* | checkpoint/<name>).
      await this.exec(
        "git",
        ["update-ref", refForLabel(label), commitSha],
        this.shadowEnv(),
      );
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
      env: {
        ...process.env,
        GIT_DIR: this.shadowDir,
        GIT_WORK_TREE: this.repoRoot,
      },
      maxBuffer: 16 * 1024 * 1024,
    };
  }

  /**
   * Return the subset of `paths` whose CURRENT work-tree content differs from the `afterRef`
   * snapshot — files that drifted AFTER the agent's turn (a human/other-process edit since
   * `agent_end`). spec/14 §3 (GitBackend dirty-check), §6 step 3 (the dirty guard REFUSE). The
   * restore dirty-guard calls this BEFORE restore: if ANY affected path is dirty, the WHOLE
   * file-revert is refused (not silently clobbered — E30).
   *
   * Implementation: `git diff --name-only <afterRef> -- <paths>` against the SHADOW repo
   * (env.GIT_DIR=shadowDir). Compares the afterRef tree to the WORKING TREE scoped to `paths`;
   * the stdout lines are the drifted paths. null/empty `afterRef` (no drift baseline — e.g. a
   * mid-turn rewind with no after-ref yet) ⇒ `[]` (allow). Serialized by the mutex (spec §4.3).
   *
   * BEST-EFFORT (E27): NEVER rejects — any git error (bad ref, exec failure) is caught, warned,
   * and returns `[]` (no drift detected ⇒ allow restore). The refuse/allow decision is the
   * caller's (rewindExecute, P4.M2.T1); this method only reports drift.
   */
  async dirtyCheck(afterRef: string, paths: string[]): Promise<string[]> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    try {
      await this.ensureInit();
      if (!afterRef || paths.length === 0) return []; // no drift baseline / nothing to check ⇒ allow
      const out = await this.exec(
        "git",
        [
          "diff",
          "--name-only",
          afterRef,
          "--",
          ...paths.filter((p) => p.length > 0),
        ],
        this.shadowEnv(),
      );
      return out.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } catch (err) {
      // E27 best-effort: any git error ⇒ [] (no drift detected ⇒ allow restore). Never rejects.
      console.warn(
        `[mulligan] snapshot.dirtyCheck failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    } finally {
      release();
    }
  }

  /**
   * Return the WORKSPACE-RELATIVE POSIX paths that differ between the `beforeRef` snapshot (a
   * shadow-repo commit SHA from `capture()`) and the CURRENT working tree — EXACTLY the set
   * `restore()` would touch. This is the spec-mandated AFFECTED SET for the dirty guard (BUG-004):
   * spec/14 §6 step 2 defines it VERBATIM as "paths that differ between `beforeRef` and the
   * current tree (the files restore would touch)".
   *
   * git algorithm: `git diff --name-only <beforeRef>` via `shadowEnv()` (env.GIT_DIR=shadowDir +
   * GIT_WORK_TREE=repoRoot). A single-commit-arg `git diff` compares the named COMMIT'S TREE
   * against the WORKING TREE WITHOUT consulting the index (git docs: "the changes you have in
   * your working tree relative to the named <commit>") — so it is ROBUST to a polluted shadow
   * index, e.g. a prior restore()'s `read-tree` (which loads beforeRef into the shadow index).
   *
   * NO `--diff-filter` is applied. The default filter includes Added/Deleted/Modified (and
   * Rename/Copy) → FULL coverage of what restore touches. Do NOT use `--diff-filter=MD`: that is
   * restore()'s INDEX-vs-WORKTREE step AFTER read-tree (where the shadow index === beforeRef, so
   * MD = modified/deleted vs beforeRef); for this standalone beforeRef-vs-worktree query it would
   * MISS span-created (Added) files. Created files ARE reverted (deleted) by restore step (c) but
   * would NEVER be inspected by the dirty guard — re-introducing the EXACT BUG-004 under-coverage
   * gap this method exists to close (bash/python/perl/heredoc-modified files absent from
   * `ledger.modifiedFiles`). NO path filter (no `--`, no pathspec tail) — changedPaths has no
   * path scope (unlike `dirtyCheck`, which scopes to caller paths).
   *
   * CONSUMED BY: rewindExecute step 6b (the BUG-004 fix, P1.M4.T2.S1) — REPLACES the heuristic
   * `ledger.modifiedFiles` so the dirty guard inspects EVERY file restore would touch, closing the
   * E30 gap for files mutated via `python -c` / `node script.js` / `perl -i` / heredocs /
   * `awk -i inplace` (which land in `ledger.bashSideEffects`, not `modifiedFiles`).
   *
   * BEST-EFFORT (E27): NEVER rejects — any git error (bad beforeRef → git exits 128, exec failure)
   * is caught, warned, and returns `[]` (the dirty guard's own refuse/allow decision is the
   * caller's). Serialized by the per-backend AsyncMutex (spec §4.3 — every IO-bearing store op).
   * IMPLEMENTED BY: git/cas.
   */
  async changedPaths(beforeRef: string): Promise<string[]> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    try {
      await this.ensureInit();
      if (!beforeRef) return []; // no baseline ⇒ no changed paths (mirrors dirtyCheck's empty-ref guard)
      const out = await this.exec(
        "git",
        ["diff", "--name-only", beforeRef],
        this.shadowEnv(),
      );
      return out.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } catch (err) {
      // E27 best-effort: any git error ⇒ [] (no changed paths detected). Never rejects.
      console.warn(
        `[mulligan] snapshot.changedPaths failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    } finally {
      release();
    }
  }

  /**
   * Does a snapshot ref still exist (resolvable) in the SHADOW repo? Used by the capture lifecycle /
   * cross-reload (E32) to decide whether a persisted RevertCheckpoint's refs are still honored.
   * spec/14 §2, §5.
   *
   * Implementation: `git rev-parse --verify <ref>` (shadow). exit 0 ⇒ the object exists in the
   * shadow DB ⇒ `true`; a non-zero exit (rev-parse --verify of a missing ref ⇒ exit 128) is caught
   * ⇒ `false`. `ref` is a commit SHA (capture()'s return — a SHA, NOT a refname).
   *
   * NOT mutex-serialized (spec §4.3 omits `has` from the serialized list — it is a fast read-only
   * existence check; serializing it would add latency to the cross-reload ref-honoring path for no
   * correctness benefit, since it writes nothing and mutates no state). BEST-EFFORT: never rejects.
   */
  async has(ref: string): Promise<boolean> {
    try {
      await this.ensureInit();
      await this.exec("git", ["rev-parse", "--verify", ref], this.shadowEnv());
      return true;
    } catch {
      // non-zero exit (missing ref ⇒ exit 128) or init failure ⇒ false. Never rejects.
      return false;
    }
  }

  /**
   * Drop a protected ref so its underlying objects can be reclaimed by the next GC pass. Called when
   * a checkpoint is revoked (`/mulligan_checkpoint_revoke`) or consumed (a rewind targets it);
   * spec/14 §5. Serialized by the mutex (spec §4.3).
   *
   * CRITICAL — SHA→refname resolution: `ref` is a commit SHA (capture()'s return), but
   * `git update-ref -d <SHA>` is INVALID (update-ref -d deletes a REFERENCE NAME, not an object).
   * So retire MUST first resolve the SHA → refname(s) via `git for-each-ref --points-at <sha>`
   * scoped to `refs/mulligan/snapshots/` (the ONLY namespace capture pins refs into, via
   * `refForLabel`), THEN `update-ref -d <each refname>`. This is robust to a SHA pinned under
   * multiple labels (revokes all) and to an already-retired SHA (empty result ⇒ no-op). S1's own
   * design note (refForLabel JSDoc) anticipates exactly this two-step resolution.
   *
   * BEST-EFFORT (E27): NEVER rejects — any git error is caught, warned, and returns void. retire
   * failure degrades only to slower GC reclamation (objects linger), never blocks the rewind.
   */
  async retire(ref: string): Promise<void> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    try {
      await this.ensureInit();
      const out = await this.exec(
        "git",
        [
          "for-each-ref",
          "--points-at",
          ref,
          "--format=%(refname)",
          "refs/mulligan/snapshots/",
        ],
        this.shadowEnv(),
      );
      const refnames = out.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const rn of refnames) {
        await this.exec("git", ["update-ref", "-d", rn], this.shadowEnv());
      }
    } catch (err) {
      // E27 best-effort: any git error ⇒ warn + void (objects linger until next GC; never blocks).
      console.warn(
        `[mulligan] snapshot.retire failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      release();
    }
  }

  /**
   * Best-effort full teardown (spec/14 §5: "Both stores are deleted entirely on
   * session_shutdown — no cross-session buildup"). Deletes the per-repo SHADOW repo subdir
   * (`join(storageDir, shadowKey(repoRoot))`) — NOT the shared storageDir + NOT other repos'
   * shadow dirs. The shadow repo is keyed by `repoRoot` (stable per cwd) so deleting it at
   * shutdown is correct; it is recreated on the next session's first capture (idempotent init).
   *
   * Serialized by the mutex (§4.3) — a destroy racing an in-flight capture/restore/gc would
   * corrupt state, so it acquires the SAME mutex the other ops do. BEST-EFFORT (E27): NEVER
   * rejects — a locked file / permission / transient IO failure is swallowed (teardown must
   * never block clearAll/exit). `shadowDir` is `!`-asserted + assigned only inside the memoized
   * `ensureInit()`, so this guards on `if (this.shadowDir)` + force:true (no-op on a missing
   * dir) to tolerate a never-init'd backend. Called by index.ts session_shutdown BEFORE
   * clearAll(). @14 §5 + §4.3.
   */
  async destroy(): Promise<void> {
    const release = await this.mutex.acquire(); // §4.3 — serialize vs in-flight capture/restore/gc
    try {
      try {
        await this.ensureInit(); // resolve shadowDir (idempotent + memoized; may init-then-we-delete — harmless)
      } catch {
        /* never initialized / transient failure — shadowDir unset → nothing to reclaim */
      }
      if (this.shadowDir) {
        try {
          await fsRm(this.shadowDir, { recursive: true, force: true }); // force:true → no-op if absent
        } catch {
          /* best-effort — never reject teardown */
        }
      }
    } finally {
      release(); // AsyncMutex GOTCHA #5 — forgotten release deadlocks all later acquire()s
    }
  }

  /**
   * The prompt-boundary reclamation pass (spec/14 §5). Drops EVERY `refs/mulligan/snapshots/turn/*`
   * ref (the whole turn namespace — reclaims prior turns whose in-memory entry no longer exists;
   * `checkpoint/*` is EXEMPT via the for-each-ref PREFIX arg) AND physically reclaims via
   * `git gc --auto --prune=now` (self-throttling — a cheap no-op under the loose-object threshold).
   * Serialized by the mutex (spec §4.3).
   *
   * BEST-EFFORT (E27): NEVER rejects — any git error (incl. a missing shadow repo on a fresh
   * session — ensureInit runs first, mirroring capture/retire) is caught, warned, and returns void
   * (objects linger until the next GC pass or `session_shutdown`; never blocks the turn). The
   * for-each-ref PREFIX `refs/mulligan/snapshots/turn/` matches the WHOLE turn namespace
   * (turn/turn + turn/turn-after) but NOT checkpoint/* — that is the exempt boundary. Called by the
   * turn_start capture hook (P3.M1.T1.S1) + the session_start GC (P3.M1.T2.S1). @14 §5 + §4.3.
   */
  async gc(): Promise<void> {
    const release = await this.mutex.acquire(); // §4.3 — serialize ALL store ops incl. gc
    try {
      await this.ensureInit();
      // (1) namespace-delete: drop EVERY refs/mulligan/snapshots/turn/* (checkpoint/* exempt).
      const out = await this.exec(
        "git",
        [
          "for-each-ref",
          "--format=%(refname)",
          "refs/mulligan/snapshots/turn/",
        ],
        this.shadowEnv(),
      );
      const refnames = out.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const rn of refnames) {
        await this.exec("git", ["update-ref", "-d", rn], this.shadowEnv());
      }
      // (2) physical reclaim — self-throttling (cheap no-op under the loose-object threshold).
      await this.exec("git", ["gc", "--auto", "--prune=now"], this.shadowEnv());
    } catch (err) {
      // E27 best-effort: any git error ⇒ warn + void (objects linger until next gc / shutdown).
      console.warn(
        `[mulligan] snapshot.gc failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      release();
    }
  }

  /**
   * Write working-tree files FROM the `beforeRef` snapshot (restore the pre-span file state).
   * spec/14 §3 (the FIVE git-safety guarantees), §6 (restore semantics). Serialized by the mutex
   * (spec §4.3). CONSUMED BY: rewindExecute step 6b (P4.M2.T1.S2) after the dirty guard passes.
   *
   * INTERFACE: `restore(beforeRef, opts)` has NO `afterRef` param (fixed by S1/store.ts). The
   * delete-created set therefore uses "files present NOW but absent from the beforeRef tree"
   * (PRD §6 step 4), which reconciles the work-item's "afterRef-but-not-beforeRef" wording: the
   * dirty guard (rewindExecute, P4) REFUSES if the worktree drifted from afterRef, so present-now
   * ≈ afterRef at restore time.
   *
   * RECIPE (spec/14 §3 — working-tree ONLY, never the source index/refs):
   *  (a) `git read-tree <beforeRef>` (shadow) — loads the beforeRef tree into the SHADOW index.
   *  (b) REVERT modified + deleted-from-worktree files: `git diff --name-only --diff-filter=MD`
   *      (shadow; index-vs-worktree — after read-tree the index === beforeRef, so M=modified vs
   *      beforeRef, D=deleted-from-worktree vs beforeRef) lists them; per path `git checkout -- <path>`
   *      (the `--` form, NO tree/commit arg — checks out FROM THE INDEX into the working tree, so it
   *      writes beforeRef's content). The read-tree-then-checkout-from-index two-step is the spec's
   *      exact recipe and is INDEX-LOCAL (never moves a ref). Do NOT use `git checkout <beforeRef>
   *      -- <path>` (heavier, can be mistaken for ref ops — see gotchas).
   *  (c) DELETE span-created files (present now, absent from beforeRef) — TWO-flag AND
   *      (opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles): `git ls-files --others`
   *      (shadow; untracked files) with `:!` pathspec negations for excludeGlobs + DANGEROUS_DIRS,
   *      then per safe path `unlink(resolveSafeWorkspacePath(repoRoot, rel))`. The `:!` pathspecs
   *      + the per-path isDangerousWorkspaceRel gate are TWO safety layers (mirrors capture's
   *      caps-walk two-layer approach) — WITHOUT them node_modules/.git would be enumerated and
   *      unlinked (catastrophic).
   *
   * BEST-EFFORT (E27): NEVER rejects. Per-path checkout/unlink failures land in `failed[]`; a
   * read-tree failure (bad beforeRef) ⇒ warn + return whatever was collected (5 buckets, possibly
   * all-empty). The feature's overriding rule: revert degradation never blocks the context rewind
   * (PRD §6 step 1 — the refuse/allow decision is rewindExecute's, P4). Returns a RestoreResult.
   */
  async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    const result: RestoreResult = {
      reverted: [],
      deleted: [],
      failed: [],
      skipped: [],
      refused: [],
    };
    try {
      await this.ensureInit();
      // Neither flag set ⇒ nothing to do (rewindExecute normally guards this, but restore is
      // best-effort + defensive — return the 5 empty buckets without touching git).
      if (!opts.revertFileChanges && !opts.deleteCreatedFiles) return result;

      // (a) Load beforeRef into the SHADOW index (NEVER the source index — shadowEnv, guarantee #2).
      //     Best-effort: a bad beforeRef rejects here → the outer catch returns the (all-empty) result.
      await this.exec("git", ["read-tree", beforeRef], this.shadowEnv());

      // (b) REVERT modified + deleted-from-worktree files vs beforeRef (index===beforeRef after read-tree).
      if (opts.revertFileChanges) {
        const diff = (
          await this.exec(
            "git",
            ["diff", "--name-only", "--diff-filter=MD"],
            this.shadowEnv(),
          )
        ).stdout;
        for (const rel of diff
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)) {
          // Safety floor: never revert a dangerous path (belt-and-suspenders; the spec excludes these
          // at capture, but defend here too so a hand-crafted beforeRef cannot wedge .git/.pi/node_modules).
          if (isDangerousWorkspaceRel(rel)) continue;
          try {
            // `git checkout -- <path>`: the `--` form, NO tree arg — checks out FROM THE SHADOW INDEX
            // (=== beforeRef after read-tree) into the working tree. Index-local; never moves a ref.
            await this.exec("git", ["checkout", "--", rel], this.shadowEnv());
            result.reverted.push(rel);
          } catch {
            result.failed.push(rel); // per-path best-effort (E27) — restore still resolves
          }
        }
      }

      // (c) DELETE span-created files (present now, absent from beforeRef) — TWO-flag AND.
      //     Missing EITHER flag ⇒ zero deletions. The `:!` pathspecs exclude heavy/dangerous dirs so
      //     ls-files never lists node_modules/.git; the isDangerousWorkspaceRel gate is belt-and-suspenders.
      if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles) {
        const othersSpecs = [
          ".",
          ...this.cfg.excludeGlobs.map((g) => `:!${g}`),
          ...DANGEROUS_DIRS.map((d) => `:!${d}`),
        ];
        const others = (
          await this.exec(
            "git",
            ["ls-files", "--others", "--", ...othersSpecs],
            this.shadowEnv(),
          )
        ).stdout;
        for (const rel of others
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)) {
          if (isDangerousWorkspaceRel(rel)) continue; // belt-and-suspenders (ls-files :! already filters)
          try {
            // resolveSafeWorkspacePath throws on `..`/absolute escape → caught below ⇒ failed[] (E27).
            const abs = resolveSafeWorkspacePath(this.repoRoot, rel);
            await this.unlink(abs);
            result.deleted.push(rel);
          } catch (e) {
            // ENOENT (already gone — e.g. deleted twice) ⇒ silent skip; any other error ⇒ failed[].
            const code = (e as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") result.failed.push(rel);
          }
        }
      }

      return result;
    } catch (err) {
      // read-tree failed (bad beforeRef) or resolveSafeWorkspacePath escape — best-effort (E27).
      // Return whatever was collected so far (possibly all-empty); NEVER rejects.
      console.warn(
        `[mulligan] snapshot.restore partial: ${err instanceof Error ? err.message : String(err)}`,
      );
      return result;
    } finally {
      release();
    }
  }
}
