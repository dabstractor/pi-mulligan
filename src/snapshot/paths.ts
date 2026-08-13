/**
 * Workspace path-safety helpers — the lexical safety floor for the v1.2 working-tree-revert snapshot
 * backends. spec/14-working-tree-revert.md §4.3 (the contract), spec/14 line 73 (placement tree:
 * src/snapshot/paths.ts, PURE), spec/03-architecture.md §2.3/§7 (foundation-tier pure helper;
 * snapshot/ is a NEW subsystem — this is its first file), spec/10-testing.md Tier 1 (pure-helper
 * unit-test tier: vitest, .js imports, no fs).
 *
 * DESIGN (read GOTCHA #1–#13 in the P1.M2.T1.S1 PRP):
 * - Pi-FREE + project-module-FREE. The ONLY imports are `node:path` + `node:os` (`homedir`, for the
 *   forbidden-root predicate — pure: reads an env var, not the fs; GOTCHA #1). This module does NOT
 *   read `config.revert.*` — DANGEROUS_DIRS is HARDCODED below (GOTCHA #9). The snapshot backends
 *   (git.ts/cas.ts, built in P2) consume config; paths.ts does not.
 * - PURE. No `fs.*`, no network, no module-scoped mutable state. Deterministic: same inputs always
 *   yield the same outputs (the full path-correctness of the feature lives here — spec/10 §1
 *   Tier 1 philosophy).
 * - LEXICAL only. Symlink resolution is OUT OF SCOPE here (GOTCHA #11) — `path.*` ops are string
 *   math. A symlink under the workspace pointing outside is undetectable at this layer; the
 *   fs-layer complement (`fs.realpathSync(root)` + `fs.realpathSync(resolved)` then re-check
 *   containment) runs in the BACKENDS (git.ts/cas.ts, P2). This module is the lexical floor, not
 *   the only defense.
 * - Consumers: `GitBackend` (git.ts, P2.M2.T1) and `CasBackend` (cas.ts, P2.M3.T1). On every
 *   candidate path they call `normalizeRelPath` → `isDangerousWorkspaceRel` →
 *   `resolveSafeWorkspacePath` (cheap syntactic gate first, authoritative containment throw second).
 *   `isForbiddenRoot` is ALSO consumed at the ROOT level — a one-shot gate distinct from the per-path
 *   flow — by `detectAndCreate` (store.ts, P1.M1.T2.S1) and both `restore()` guards (git.ts
 *   P1.M1.T3.S2 / cas.ts P1.M1.T4.S1).
 */

import { resolve, relative, isAbsolute, sep, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Workspace directories that must NEVER be captured into a snapshot or restored into the working
 * tree, regardless of config. Hardcoded (paths.ts imports NOTHING from config) — this is the SAFETY
 * floor, distinct from the backends' walk-level `config.revert.excludeGlobs` (GOTCHA #9).
 * Case-insensitive SEGMENT match (GOTCHA #8). spec/14 §4.3.
 *
 * Note: `.pi` is protected here even though it is NOT in the default `config.revert.excludeGlobs`
 * (the two layers overlap but are independent — excludeGlobs is a walk-level size/perf filter applied
 * by the backends; DANGEROUS_DIRS is an always-enforced safety reject-list).
 */
export const DANGEROUS_DIRS: readonly string[] = [".git", ".pi", "node_modules"];

/**
 * Resolve `relPath` against `workspaceRoot` and VERIFY the result is at-or-inside the workspace
 * (no `..` escape, no cross-drive absolute override). Returns the absolute path; THROWS on any
 * escape attempt. spec/14 §4.3.
 *
 * PURE — no fs calls, no symlink resolution (lexical containment only; the fs-layer
 * `fs.realpathSync` complement runs in the snapshot backends, out of scope here — GOTCHA #11).
 *
 * Escape vectors caught: (a) `../` segments lexically collapsed outside the root; (b) an absolute
 * `relPath` (e.g. "/etc/passwd") whose absolute-segment OVERRIDE in path.resolve discards
 * `workspaceRoot` (GOTCHA #4); (c) Windows cross-drive where path.relative returns an absolute path
 * (GOTCHA #2). At-root (relPath "." or "") is NOT an escape and returns the root (GOTCHA #3).
 *
 * @throws {Error} when the resolved path is not at-or-inside `workspaceRoot`.
 */
export function resolveSafeWorkspacePath(workspaceRoot: string, relPath: string): string {
  const root = resolve(workspaceRoot); // absolute, normalized
  const resolved = resolve(root, relPath); // absolute relPath overrides root; `..` collapsed
  const rel = relative(root, resolved); // '' at-root | '../..' escaped | absolute cross-drive
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return resolved; // at-or-inside the workspace — safe
  }
  throw new Error(
    `resolveSafeWorkspacePath: path escapes workspace root: ${JSON.stringify(relPath)} -> ${JSON.stringify(resolved)}`,
  );
}

/**
 * Convert `absPath` to a workspace-relative POSIX (forward-slash) string. Uses the platform-native
 * `path.relative` (correct on Windows — handles drive letters; do NOT use path.posix.relative for
 * input, GOTCHA #5), then coerces the platform separator to `/` for stable cross-platform snapshot
 * keys. PURE. spec/14 §4.3 ("Windows-style paths normalize to /-separated relative paths").
 *
 * An `absPath` OUTSIDE the workspace yields a `"../…"` string here; the caller should gate it with
 * `isDangerousWorkspaceRel` (whose `..` check then fires) before use.
 */
export function normalizeRelPath(workspaceRoot: string, absPath: string): string {
  const rel = relative(resolve(workspaceRoot), resolve(absPath));
  return rel.split(sep).join("/"); // POSIX: no-op; Windows: '\\' -> '/'
}

/**
 * Return true for a workspace-relative path that must NEVER be captured into a snapshot or restored
 * into the working tree: a NUL byte, an absolute string, a trailing separator (directory), any
 * `..` segment (escape), or any segment under a dangerous dir (`.git`/`.pi`/`node_modules`,
 * case-insensitive). PURE syntactic check — no `workspaceRoot`, no fs. spec/14 §4.3.
 *
 * The "absolute path that resolves outside the workspace" criterion is met two ways: directly (a
 * workspace-rel string that is still absolute is rejected) and transitively (the backends call
 * `normalizeRelPath` first, which turns an outside-absolute path into `../…`, caught by the `..`
 * check). GOTCHA #6/#7/#8/#10.
 */
export function isDangerousWorkspaceRel(relPath: string): boolean {
  if (relPath.includes("\0")) return true; // NUL byte — CWE-158 (GOTCHA #6)
  if (isAbsolute(relPath)) return true; // a workspace-rel is never absolute
  if (relPath.endsWith("/") || relPath.endsWith(sep)) return true; // directory marker (#10)
  const segments = relPath.split(/[\\/]/); // split on BOTH separators
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower === "..") return true; // any `..` segment — fail-closed (#7)
    if (DANGEROUS_DIRS.includes(lower)) return true; // under a dangerous dir (#8)
  }
  return false;
}

/**
 * Forbidden workspace-root predicate — the lexical floor of the spec/14 §2 SAFETY INVARIANT.
 * Returns true for a resolved (canonicalized) workspace root that the snapshot subsystem must
 * NEVER capture into or restore files into, because a wholesale working-tree restore there would
 * be catastrophic. spec/14 §2 SAFETY INVARIANT + §10 (testing safety clause).
 *
 * TRUE iff ANY of (any-true; order is cosmetic):
 *   (a) root === os.homedir()       — the user's home (typically depth-2, e.g. /home/<user>);
 *                                     caught explicitly because the depth-1 check below does not.
 *   (b) root === "/"                — the filesystem root (depth 0).
 *   (c) dirname(root) === "/"       — ANY depth-1 system dir: /home /etc /usr /var /bin /sbin
 *                                     /opt /tmp /root … (spec §2's "too shallow to be a real
 *                                     project" = depth ≤ 1; the named dirs are illustrative —
 *                                     this check is comprehensive and forbids ALL depth-1 paths).
 *   (d) root === "" || root === "." — defensive: degenerate / non-canonical input.
 * FALSE for any depth-≥-2, non-home path (a plausibly-real project root). Note: a depth-2
 * non-home path under a system dir (e.g. "/etc/foo") is ALLOWED by this depth rule by design.
 *
 * PURE — no fs, no network, no module state, no config. os.homedir() reads an env var, not the
 * filesystem, so this module's purity promise (header GOTCHA #1) holds. POSIX-oriented by design:
 * `dirname(root) === "/"` is the POSIX depth-1 test; on Windows the home is still caught by (a)
 * but drive-roots (C:\\, C:\\Windows) are not — a documented limitation of this lexical gate (the
 * authoritative containment is the backends' fs.realpathSync complement; see paths.ts GOTCHA #11).
 *
 * Consumers (P1.M1 detection-safety hardening): `detectAndCreate` (store.ts, P1.M1.T2.S1) refuses
 * → NoOp when the root is forbidden; `GitBackend.restore` (git.ts, P1.M1.T3.S2) and
 * `CasBackend.restore` (cas.ts, P1.M1.T4.S1) each re-check at entry and return a refused result
 * with ZERO filesystem mutation — the last line of defense independent of detection (spec/14 §2).
 *
 * @param root an absolute, CANONICALIZED path string — the realpath of the workspace root
 *             (the result of fs.realpathSync(cwd)). Do NOT pass un-resolved cwd.
 * @returns true iff the root is forbidden (home / `/` / depth-1 / degenerate).
 */
export function isForbiddenRoot(root: string): boolean {
  return (
    root === "" ||            // (d) defensive — degenerate input
    root === "." ||           // (d) defensive — degenerate input
    root === "/" ||           // (b) filesystem root (depth 0)
    dirname(root) === "/" ||  // (c) depth-1 system dir (/home /etc /usr /var …)
    root === homedir()        // (a) the user's home (typically depth-2)
  );
}