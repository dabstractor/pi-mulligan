import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { GitBackend, type GitExec, type CapScan } from "../src/snapshot/git.js";
import type { MulliganConfig } from "../src/config.js";

// spec/14-working-tree-revert.md §3 (GitBackend capture flow + the FIVE git-safety guarantees),
// §5 (capture lifecycle & retention / caps), §4.3 (AsyncMutex serialization contract); task
// P2.M2.T1.S1 scope: init() + capture() + S2-method stubs throw.
//
// What is mocked (DI seam via constructor deps) vs what is real:
//   - exec (deps.exec): a recording fake returning canned stdout for rev-parse/write-tree/commit-tree
//     so capture reaches its pipeline WITHOUT real git. Tests assert on the recorded calls.
//   - scan (deps.scan): a canned CapScan so the real fs walk (against a non-existent /fake/cwd)
//     never runs. ALWAYS inject BOTH exec + scan.
//   - AsyncMutex: REAL (the serialization test exercises the genuine promise-chain mutex).
//
// House idiom: vitest, .js imports (the git.ts under-test is imported via .ts here for the vitest
// ESM transform — matches the repo's vitest setup), no fs. No beforeEach (each test constructs its
// own GitBackend; the only state — mutex + capturesThisTurn — is per-instance).

// A canonical valid revert config used across tests (mirrors DEFAULT_CONFIG.revert).
const BASE_CFG: MulliganConfig["revert"] = {
  enabled: true,
  allowDeleteCreatedFiles: false,
  nonGitMode: "cas",
  storageDir: "/fake/store",
  maxFileBytes: 262144,
  maxTotalBytes: 33554432,
  maxSnapshotsPerTurn: 64,
  excludeGlobs: [".git", "node_modules"],
};

/** The 6-command pipeline needs excludeGlobs to be visible in the add pathspec assertions. */
const CFG_WITH_EXCLUDES: MulliganConfig["revert"] = {
  ...BASE_CFG,
  excludeGlobs: ["node_modules", ".venv"],
};

type Call = {
  file: string;
  args: string[];
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number };
};

/**
 * Options bag for makeExec — canned stdout keyed by command (args[0]) or a richer matcher. The S2
 * methods (dirtyCheck/restore/has/retire) issue diff/read-tree/checkout/ls-files/rev-parse/
 * for-each-ref/update-ref, whose stdout a test controls via this bag (e.g. diff returns two drifted
 * paths; ls-files returns a list of created files). Unknown commands fall through to "".
 */
interface ExecCanned {
  /** Canned stdout keyed by args[0] (e.g. { diff: "a.ts\nb.ts\n" }). Used when args[0] alone disambiguates. */
  stdoutByCmd?: Record<string, string>;
  /** Throw on the Nth call matching args[0]===cmd (simulates a non-zero exit / a failing read-tree). */
  throwOn?: { cmd: string; call: number };
}

/**
 * Build a recording exec fake. Returns canned stdout for the read-only rev-parse calls + the
 * write-tree/commit-tree pipeline steps so capture can proceed without real git. Records every
 * invocation into `calls` for assertion. `canned` (optional) overrides/adds stdout for S2 commands
 * (diff/read-tree/checkout/ls-files/rev-parse/for-each-ref/update-ref) so the S2 tests control
 * branch inputs without real git.
 */
function makeExec(calls: Call[], canned: ExecCanned = {}): GitExec {
  const throwCounts: Record<string, number> = {};
  return async (file, args, opts) => {
    calls.push({ file, args: [...args], opts });
    const cmd = args[0];
    // Simulate a non-zero exit / failing command (e.g. a bad beforeRef read-tree).
    if (canned.throwOn && cmd === canned.throwOn.cmd) {
      throwCounts[cmd] = (throwCounts[cmd] ?? 0) + 1;
      if (throwCounts[cmd] === canned.throwOn.call) throw new Error(`mock ${cmd} failure`);
    }
    if (cmd === "write-tree") return { stdout: "TREE123\n", stderr: "" };
    if (cmd === "commit-tree") return { stdout: "COMMIT456\n", stderr: "" };
    if (canned.stdoutByCmd && cmd in canned.stdoutByCmd) return { stdout: canned.stdoutByCmd[cmd], stderr: "" };
    return { stdout: "", stderr: "" };
  };
}

/** A scan fake returning no oversize files + zero total bytes (the safe default for pipeline tests). */
const emptyScan = async (): Promise<CapScan> => ({ oversizePaths: [], totalBytes: 0 });

/** Build a GitBackend wired to the recording exec + a canned scan. */
function makeBackend(
  calls: Call[],
  cfg: MulliganConfig["revert"] = BASE_CFG,
  scan: (root: string, globs: readonly string[], maxFileBytes: number) => Promise<CapScan> = emptyScan,
  canned: ExecCanned = {},
): GitBackend {
  return new GitBackend("/fake/cwd", cfg, null, { exec: makeExec(calls, canned), scan });
}

/**
 * Build a GitBackend wired to a recording exec + scan + a recording `unlink` fake (the S2 DI seam).
 * Returns the backend AND the list of paths passed to unlink so a test can assert unlink targets.
 */
function makeBackendWithUnlink(
  calls: Call[],
  unlinked: string[],
  cfg: MulliganConfig["revert"] = BASE_CFG,
  canned: ExecCanned = {},
  // BUG-001 R1: optional stat DI seam (production omits → real fs.stat; tests inject a fake to
  // assert the defense-in-depth size guard without a real filesystem).
  stat?: (path: string) => Promise<{ size: number }>,
): GitBackend {
  const unlink = async (p: string): Promise<void> => {
    unlinked.push(p);
  };
  return new GitBackend("/fake/cwd", cfg, null, { exec: makeExec(calls, canned), scan: emptyScan, unlink, stat });
}

/** Find the first recorded call whose args[0] === cmd (e.g. "add", "write-tree"). */
function findCmd(calls: Call[], cmd: string): Call | undefined {
  return calls.find((c) => c.args[0] === cmd);
}

/** All recorded calls whose args[0] is one of the given write commands, in order. */
function writeCalls(calls: Call[]): Call[] {
  return calls.filter((c) =>
    ["init", "add", "write-tree", "commit-tree", "update-ref"].includes(c.args[0]),
  );
}

/** The expected shadow dir for the /fake/cwd fixture (realpathSafe falls back to resolve since
 * /fake/cwd does not exist on disk): <storageDir>/<sha256("/fake/cwd").slice(0,16)>. */
function expectedShadow(storageDir: string, repoRoot = "/fake/cwd"): string {
  return `${storageDir}/${createHash("sha256").update(repoRoot).digest("hex").slice(0, 16)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("GitBackend.capture — command construction (spec/14 §3)", () => {
  it("issues ZERO commands against the user's git (no rev-parse --show-toplevel/--absolute-git-dir)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await gb.capture("turn");
    // NO rev-parse --show-toplevel / --absolute-git-dir is ever issued (spec/14 §3 guarantee #1).
    const showTop = calls.find((c) => c.args[0] === "rev-parse" && c.args[1] === "--show-toplevel");
    const absGitDir = calls.find((c) => c.args[0] === "rev-parse" && c.args[1] === "--absolute-git-dir");
    expect(showTop).toBeUndefined();
    expect(absGitDir).toBeUndefined();
    // NO command runs against the user's repo at all — every capture command carries the shadow env.
    for (const c of calls) {
      expect(c.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    }
  });

  it("issues git init --bare ONCE against the SHADOW repo (GIT_DIR=shadow), then NOT again", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await gb.capture("turn"); // first capture → init --bare
    await gb.capture("turn"); // second capture → init NOT re-run
    const inits = calls.filter((c) => c.args[0] === "init");
    expect(inits).toHaveLength(1);
    expect(inits[0]!.args).toEqual(["init", "--bare"]);
    expect(inits[0]!.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
  });

  it("capture('turn') runs add → write-tree → commit-tree → update-ref in order, ALL with GIT_DIR=shadow", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, CFG_WITH_EXCLUDES);
    await gb.capture("turn");
    const w = writeCalls(calls)
      .filter((c) => ["add", "write-tree", "commit-tree", "update-ref"].includes(c.args[0]))
      .map((c) => c.args[0]);
    expect(w).toEqual(["add", "write-tree", "commit-tree", "update-ref"]);
    for (const cmd of ["add", "write-tree", "commit-tree", "update-ref"]) {
      const c = findCmd(calls, cmd)!;
      expect(c.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
      expect(c.opts?.env?.GIT_WORK_TREE).toBe("/fake/cwd");
    }
  });

  it("add pathspec includes '.' and ':!<each excludeGlob>'", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, CFG_WITH_EXCLUDES);
    await gb.capture("turn");
    const add = findCmd(calls, "add")!;
    expect(add.args).toContain("--");
    expect(add.args).toContain(".");
    expect(add.args).toContain(":!node_modules");
    expect(add.args).toContain(":!.venv");
  });

  it("commit-tree carries -m 'snapshot:<label>' and -p <prevCommit> on the 2nd capture", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, CFG_WITH_EXCLUDES);
    await gb.capture("turn"); // 1st: no parent
    const ct1 = calls.filter((c) => c.args[0] === "commit-tree")[0]!;
    expect(ct1.args).toEqual(["commit-tree", "TREE123", "-m", "snapshot:turn"]);
    expect(ct1.args).not.toContain("-p");
    await gb.capture("turn-after"); // 2nd: -p COMMIT456
    const ct2 = calls.filter((c) => c.args[0] === "commit-tree")[1]!;
    expect(ct2.args).toEqual(["commit-tree", "TREE123", "-p", "COMMIT456", "-m", "snapshot:turn-after"]);
  });

  it("update-ref writes refs/mulligan/snapshots/turn/<label> for turn, checkpoint/<name> for ckpt:", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await gb.capture("turn");
    expect(findCmd(calls, "update-ref")!.args).toEqual([
      "update-ref",
      "refs/mulligan/snapshots/turn/turn",
      "COMMIT456",
    ]);
    calls.length = 0;
    await gb.capture("ckpt:foo");
    expect(findCmd(calls, "update-ref")!.args).toEqual([
      "update-ref",
      "refs/mulligan/snapshots/checkpoint/foo",
      "COMMIT456",
    ]);
  });

  it("returns the commit SHA (trimmed commit-tree stdout)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    expect(await gb.capture("turn")).toBe("COMMIT456");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GitBackend — the five git-safety guarantees (spec/14 §3)", () => {
  it("GUARANTEE #1/#2: NO write command's env.GIT_DIR is the SOURCE git dir", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await gb.capture("turn");
    const shadow = expectedShadow(BASE_CFG.storageDir!);
    // Every write command (init/add/write-tree/commit-tree/update-ref) must target the SHADOW repo.
    for (const c of writeCalls(calls)) {
      expect(c.opts?.env?.GIT_DIR).toBe(shadow);
      expect(c.opts?.env?.GIT_DIR).not.toBe("/fake/cwd/.git"); // NEVER the source git dir
    }
  });

  it("ZERO commands run without the shadow env (no command touches the user's git)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await gb.capture("turn");
    // spec/14 §3 guarantee #1: NO command of any kind — read or write — against the user's git.
    // Every recorded command (init/add/write-tree/commit-tree/update-ref) carries the shadow GIT_DIR.
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
      expect(c.opts?.cwd).toBeUndefined(); // no cwd-only (user-repo) command exists anymore
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GitBackend.capture — best-effort + caps (E29/E27)", () => {
  it("returns null when git add fails (exec rejects) — capture does NOT reject", async () => {
    const calls: Call[] = [];
    const throwingExec: GitExec = async (file, args, opts) => {
      calls.push({ file, args: [...args], opts });
      if (args[0] === "add") throw new Error("mock add failure");
      return { stdout: "", stderr: "" };
    };
    const gb = new GitBackend("/fake/cwd", BASE_CFG, null, { exec: throwingExec, scan: emptyScan });
    await expect(gb.capture("turn")).resolves.toBeNull(); // null, NOT a rejection
  });

  it("skips oversize files via :! negation + still captures", async () => {
    const calls: Call[] = [];
    const oversizeScan = async (): Promise<CapScan> => ({ oversizePaths: ["big.bin"], totalBytes: 10 });
    const gb = makeBackend(calls, BASE_CFG, oversizeScan);
    const sha = await gb.capture("turn");
    expect(sha).toBe("COMMIT456");
    expect(findCmd(calls, "add")!.args).toContain(":!big.bin");
  });

  it("returns null when totalBytes > maxTotalBytes (aborts before add)", async () => {
    const calls: Call[] = [];
    const bigScan = async (): Promise<CapScan> => ({ oversizePaths: [], totalBytes: 999 });
    const cfg = { ...BASE_CFG, maxTotalBytes: 100 };
    const gb = makeBackend(calls, cfg, bigScan);
    expect(await gb.capture("turn")).toBeNull();
    // No add/write-tree/commit-tree issued — the cap aborted capture before staging.
    expect(findCmd(calls, "add")).toBeUndefined();
    expect(findCmd(calls, "write-tree")).toBeUndefined();
    expect(findCmd(calls, "commit-tree")).toBeUndefined();
  });

  it("returns null when capturesThisTurn >= maxSnapshotsPerTurn (no git calls beyond ensureInit)", async () => {
    const calls: Call[] = [];
    const cfg = { ...BASE_CFG, maxSnapshotsPerTurn: 0 };
    const gb = makeBackend(calls, cfg);
    expect(await gb.capture("turn")).toBeNull();
    expect(findCmd(calls, "add")).toBeUndefined();
    expect(findCmd(calls, "write-tree")).toBeUndefined();
    expect(findCmd(calls, "commit-tree")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GitBackend — mutex serialization (spec/14 §4.3)", () => {
  it("concurrent capture() never overlap (max-in-flight 1)", async () => {
    let active = 0;
    let maxActive = 0;
    const calls: Call[] = [];
    const racingExec: GitExec = async (file, args, opts) => {
      calls.push({ file, args: [...args], opts });
      if (args[0] === "write-tree") return { stdout: "TREE123\n", stderr: "" };
      if (args[0] === "commit-tree") return { stdout: "COMMIT456\n", stderr: "" };
      // Yield on every OTHER call (add/update-ref/init) so overlap would be observable if the mutex
      // were absent — mirrors the AsyncMutex concurrency idiom in test/store.test.ts.
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((r) => setTimeout(r, 0));
      active--;
      return { stdout: "", stderr: "" };
    };
    const gb = new GitBackend("/fake/cwd", BASE_CFG, null, { exec: racingExec, scan: emptyScan });
    // NOTE: capturesThisTurn chains -p parents, but the serialization claim is independent of that.
    await Promise.all([
      gb.capture("turn-a"),
      gb.capture("turn-b"),
      gb.capture("turn-c"),
      gb.capture("turn-d"),
      gb.capture("turn-e"),
    ]);
    expect(maxActive).toBe(1); // no two capture bodies ever overlapped — mutex held mutual exclusion
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2.M2.T1.S2 — dirtyCheck / restore / has / retire real-behavior tests.
// ─────────────────────────────────────────────────────────────────────────────

describe("GitBackend.dirtyCheck — spec/14 §3/§6", () => {
  it("issues `git diff --name-only <afterRef> -- <paths>` with env.GIT_DIR===shadow", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\nb.ts\n" } });
    const drifted = await gb.dirtyCheck("AFTER1", ["a.ts", "b.ts", "c.ts"]);
    expect(drifted).toEqual(["a.ts", "b.ts"]);
    const diff = findCmd(calls, "diff")!;
    expect(diff.args).toEqual(["diff", "--name-only", "AFTER1", "--", "a.ts", "b.ts", "c.ts"]);
    expect(diff.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
  });

  it("returns [] when afterRef is null/empty", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await expect(gb.dirtyCheck("", ["a.ts"])).resolves.toEqual([]);
    expect(findCmd(calls, "diff")).toBeUndefined(); // no diff issued
  });

  it("returns [] when paths is empty", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await expect(gb.dirtyCheck("AFTER1", [])).resolves.toEqual([]);
    expect(findCmd(calls, "diff")).toBeUndefined();
  });

  it("never rejects on a git error (warn + [])", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "diff", call: 1 } });
    await expect(gb.dirtyCheck("AFTER1", ["a.ts"])).resolves.toEqual([]); // NOT a rejection
  });
});

describe("GitBackend.changedPaths — spec/14 §6 step 2 / BUG-004", () => {
  it("issues `git diff --name-only <beforeRef>` (NO --, NO paths, NO --diff-filter) with env.GIT_DIR===shadow", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\nb.ts\n" } });
    const changed = await gb.changedPaths("BEFORE1");
    expect(changed).toEqual(["a.ts", "b.ts"]);
    const diff = findCmd(calls, "diff")!;
    expect(diff.args).toEqual(["diff", "--name-only", "BEFORE1"]);
    expect(diff.args).not.toContain("--diff-filter"); // CRITICAL: full A/D/M coverage, not just MD
    expect(diff.args).not.toContain("--"); // CRITICAL: no path filter (unlike dirtyCheck)
    expect(diff.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    expect(diff.opts?.env?.GIT_WORK_TREE).toBe("/fake/cwd");
  });

  it("returns [] when beforeRef is empty (no diff issued)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await expect(gb.changedPaths("")).resolves.toEqual([]);
    expect(findCmd(calls, "diff")).toBeUndefined(); // no diff issued
  });

  it("trims + drops blank stdout lines", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: " a.ts \n\nb.ts\n  \n" } });
    expect(await gb.changedPaths("BEFORE1")).toEqual(["a.ts", "b.ts"]);
  });

  it("never rejects on a git error (warn + [])", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "diff", call: 1 } });
    await expect(gb.changedPaths("BEFORE1")).resolves.toEqual([]); // NOT a rejection
  });

  it("acquires the mutex (two concurrent both complete — §4.3)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\n" } });
    await Promise.all([gb.changedPaths("B1"), gb.changedPaths("B2")]); // must not hang
    expect(calls.filter((c) => c.args[0] === "diff")).toHaveLength(2);
  });
});

describe("GitBackend.has — spec/14 §2", () => {
  it("issues `git rev-parse --verify <ref>` (shadow); exit0⇒true", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    expect(await gb.has("COMMIT456")).toBe(true);
    const rp = calls.filter((c) => c.args[0] === "rev-parse").find((c) => c.args[1] === "--verify")!;
    expect(rp.args).toEqual(["rev-parse", "--verify", "COMMIT456"]);
    expect(rp.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
  });

  it("returns false when rev-parse --verify rejects (missing ref ⇒ exit 128)", async () => {
    const calls: Call[] = [];
    // ensureInit issues NO rev-parse; has()'s --verify is the FIRST rev-parse call → throwOn call:1
    // makes it throw → has returns false.
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "rev-parse", call: 1 } });
    expect(await gb.has("MISSING")).toBe(false);
  });

  it("never rejects", async () => {
    const gb = makeBackend([], BASE_CFG, emptyScan, { throwOn: { cmd: "rev-parse", call: 1 } });
    await expect(gb.has("MISSING")).resolves.toBe(false);
  });

  it("acquires the mutex (two concurrent both complete — §4.3 / BUG-007)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    // two concurrent has() must BOTH resolve — a forgotten release() (GOTCHA #5) would deadlock
    // the 2nd acquire forever. Both issuing rev-parse --verify proves acquire+release each.
    await Promise.all([gb.has("COMMIT456"), gb.has("COMMIT456")]);
    const verify = calls
      .filter((c) => c.args[0] === "rev-parse")
      .filter((c) => c.args[1] === "--verify");
    expect(verify).toHaveLength(2); // both ran (mutex acquired + released per call)
  });
});

describe("GitBackend.retire — SHA→refname resolution", () => {
  it("issues for-each-ref --points-at <sha> then update-ref -d <each refname> (shadow)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: {
        "for-each-ref": "refs/mulligan/snapshots/turn/turn\nrefs/mulligan/snapshots/checkpoint/foo\n",
      },
    });
    await gb.retire("COMMIT456");
    const fer = findCmd(calls, "for-each-ref")!;
    expect(fer.args).toEqual([
      "for-each-ref",
      "--points-at",
      "COMMIT456",
      "--format=%(refname)",
      "refs/mulligan/snapshots/",
    ]);
    expect(fer.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    const updates = calls.filter((c) => c.args[0] === "update-ref" && c.args[1] === "-d");
    expect(updates).toHaveLength(2);
    expect(updates[0]!.args).toEqual(["update-ref", "-d", "refs/mulligan/snapshots/turn/turn"]);
    expect(updates[1]!.args).toEqual(["update-ref", "-d", "refs/mulligan/snapshots/checkpoint/foo"]);
    for (const u of updates) expect(u.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
  });

  it("update-ref -d receives a refname (refs/mulligan/…), NEVER the raw SHA", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { "for-each-ref": "refs/mulligan/snapshots/turn/turn\n" },
    });
    await gb.retire("COMMIT456");
    const update = calls.find((c) => c.args[0] === "update-ref" && c.args[1] === "-d")!;
    expect(update.args[2]).not.toBe("COMMIT456");
    expect(update.args[2]).toMatch(/^refs\/mulligan\/snapshots\//);
  });

  it("empty for-each-ref result ⇒ no update-ref issued (already retired)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { "for-each-ref": "" } });
    await gb.retire("COMMIT456");
    expect(calls.some((c) => c.args[0] === "update-ref" && c.args[1] === "-d")).toBe(false);
  });

  it("never rejects (for-each-ref failure ⇒ warn + void)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "for-each-ref", call: 1 } });
    await expect(gb.retire("COMMIT456")).resolves.toBeUndefined(); // NOT a rejection
  });
});

describe("GitBackend.gc — prompt-boundary namespace-delete + reclaim (spec/14 §5)", () => {
  it("issues for-each-ref --format <prefix> (turn/) then update-ref -d <each turn refname> then gc --auto --prune=now", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: {
        "for-each-ref": "refs/mulligan/snapshots/turn/turn\nrefs/mulligan/snapshots/turn/turn-after\n",
      },
    });
    await gb.gc();
    const fer = findCmd(calls, "for-each-ref")!;
    // the PREFIX arg targets the WHOLE turn namespace (turn/turn + turn/turn-after) — NOT checkpoint/*
    expect(fer.args).toEqual(["for-each-ref", "--format=%(refname)", "refs/mulligan/snapshots/turn/"]);
    expect(fer.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    const updates = calls.filter((c) => c.args[0] === "update-ref" && c.args[1] === "-d");
    expect(updates).toHaveLength(2);
    expect(updates[0]!.args).toEqual(["update-ref", "-d", "refs/mulligan/snapshots/turn/turn"]);
    expect(updates[1]!.args).toEqual(["update-ref", "-d", "refs/mulligan/snapshots/turn/turn-after"]);
    for (const u of updates) expect(u.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    // physical reclaim: git gc --auto --prune=now (self-throttling)
    const gcCmd = findCmd(calls, "gc")!;
    expect(gcCmd.args).toEqual(["gc", "--auto", "--prune=now"]);
    expect(gcCmd.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
  });

  it("the for-each-ref PREFIX never matches checkpoint/* (checkpoint namespace exempt)", async () => {
    // Even if checkpoint refs exist on disk, the turn/ prefix arg excludes them from the enumeration,
    // so no update-ref -d is ever issued for a checkpoint refname here.
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { "for-each-ref": "refs/mulligan/snapshots/turn/turn\n" }, // only turn/ returned
    });
    await gb.gc();
    const updates = calls.filter((c) => c.args[0] === "update-ref" && c.args[1] === "-d");
    expect(updates.every((u) => !u.args[2]!.includes("checkpoint"))).toBe(true);
  });

  it("empty for-each-ref result ⇒ still runs git gc (reclaim is unconditional); no update-ref", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { "for-each-ref": "" } });
    await gb.gc();
    expect(calls.some((c) => c.args[0] === "update-ref" && c.args[1] === "-d")).toBe(false);
    // gc --auto --prune=now runs regardless (physical reclaim is part of the pass)
    expect(findCmd(calls, "gc")).toBeDefined();
  });

  it("never rejects (for-each-ref failure ⇒ warn + void)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "for-each-ref", call: 1 } });
    await expect(gb.gc()).resolves.toBeUndefined(); // NOT a rejection
  });

  it("never rejects (git gc failure ⇒ warn + void)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { "for-each-ref": "refs/mulligan/snapshots/turn/turn\n" },
      throwOn: { cmd: "gc", call: 1 },
    });
    await expect(gb.gc()).resolves.toBeUndefined(); // NOT a rejection
  });

  it("acquires the mutex (serialized with capture/restore/retire — §4.3)", async () => {
    // The mutex is real; this is a smoke that gc reaches + releases it (no deadlock). A capture
    // running concurrently would serialize; here we just confirm gc does not hang.
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { "for-each-ref": "refs/mulligan/snapshots/turn/turn\n" },
    });
    await Promise.all([gb.gc(), gb.gc()]); // two concurrent gc's must both complete (mutex serializes)
    // both ran a for-each-ref (each acquired the mutex in turn)
    const fers = calls.filter((c) => c.args[0] === "for-each-ref");
    expect(fers.length).toBe(2);
  });

  // BUG-006: gc() must reset the in-memory commit-chain `lastCommit` so that turn/* commits
  // deleted by the namespace-delete step become UNREACHABLE from future `commit-tree -p` children
  // (otherwise git gc can never reclaim them → unbounded shadow-repo growth, contradicting spec §5
  // "physically reclaims"). `lastCommit` is PRIVATE → assert behaviorally via the commit-tree argv.
  it("BUG-006: gc() breaks the commit chain — the post-gc capture's commit-tree has NO -p parent", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan);
    // (1) first capture: no parent yet (lastCommit starts null)
    await gb.capture("turn");
    // (2) second capture: chains onto the first via `-p COMMIT456` (makeExec returns COMMIT456)
    await gb.capture("turn");
    // (3) gc() is the turn boundary → resets lastCommit to null
    await gb.gc();
    // (4) third capture: must NOT chain (no -p) — proves lastCommit was reset
    await gb.capture("turn");

    const cts = calls.filter((c) => c.args[0] === "commit-tree");
    expect(cts.length).toBe(3);
    // the first two captures chain (each subsequent one reuses lastCommit = COMMIT456)
    expect(cts[0]!.args).not.toContain("-p");
    expect(cts[1]!.args).toContain("-p");
    expect(cts[1]!.args).toContain("COMMIT456");
    // the post-gc capture MUST NOT chain — the reset broke the reachability chain
    expect(cts[2]!.args).not.toContain("-p");
  });

  // BUG-006: gc() must reset the per-turn `capturesThisTurn` counter (this GC pass IS the spec'd
  // turn-boundary reset point). Without the reset, after maxSnapshotsPerTurn captures EVERY later
  // capture() returns null (the cap check is before scan/add). `capturesThisTurn` is PRIVATE →
  // assert behaviorally: with maxSnapshotsPerTurn:1, a 2nd capture returns null, then gc() resets,
  // then a 3rd capture succeeds again.
  it("BUG-006: gc() resets capturesThisTurn — a capped-out capture succeeds again after gc()", async () => {
    const calls: Call[] = [];
    const cfg = { ...BASE_CFG, maxSnapshotsPerTurn: 1 };
    const gb = makeBackend(calls, cfg, emptyScan);
    // (1) first capture of the turn: succeeds (capturesThisTurn 0 → 1)
    const c1 = await gb.capture("turn");
    expect(c1).toBe("COMMIT456");
    expect(calls.filter((c) => c.args[0] === "write-tree")).toHaveLength(1);
    // (2) second capture: capped (capturesThisTurn 1 >= maxSnapshotsPerTurn 1) → null, NO pipeline
    const c2 = await gb.capture("turn");
    expect(c2).toBeNull();
    // the cap check fires BEFORE scan/add, so the capped capture issues NO write-tree
    expect(calls.filter((c) => c.args[0] === "write-tree")).toHaveLength(1);
    // (3) gc() resets capturesThisTurn to 0
    await gb.gc();
    // (4) third capture: succeeds again — proves the counter was reset
    const c3 = await gb.capture("turn");
    expect(c3).toBe("COMMIT456");
    // now TWO write-tree calls total (1 from capture #1 + 1 from capture #3)
    expect(calls.filter((c) => c.args[0] === "write-tree")).toHaveLength(2);
  });
});

describe("GitBackend.restore — working-tree only (spec/14 §3/§6)", () => {
  it("issues read-tree <beforeRef> then per-path checkout -- <path>, BOTH with env.GIT_DIR===shadow", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { diff: "a.ts\nb.ts\n" }, // two modified/deleted paths to revert
    });
    const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.reverted).toEqual(["a.ts", "b.ts"]);
    const rt = findCmd(calls, "read-tree")!;
    expect(rt.args).toEqual(["read-tree", "BEFORE1"]);
    expect(rt.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    const checkouts = calls.filter((c) => c.args[0] === "checkout");
    expect(checkouts).toHaveLength(2);
    expect(checkouts[0]!.args).toEqual(["checkout", "--", "a.ts"]);
    expect(checkouts[1]!.args).toEqual(["checkout", "--", "b.ts"]);
    for (const c of checkouts) {
      expect(c.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
      // GUARANTEE #1/#2: never the SOURCE git dir.
      expect(c.opts?.env?.GIT_DIR).not.toBe("/fake/cwd/.git");
    }
  });

  it("GUARANTEE #1/#2: NO write command's env.GIT_DIR is the SOURCE git dir", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\n" } });
    await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: false });
    // Every shadow-env write command must target the SHADOW dir, NEVER the source git dir.
    const writes = calls.filter((c) =>
      ["read-tree", "checkout", "ls-files", "update-ref"].includes(c.args[0]),
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
      expect(w.opts?.env?.GIT_DIR).not.toBe("/fake/cwd/.git");
    }
  });

  it("GUARANTEE #3: restore issues read-tree + checkout -- <path>, NEVER reset/commit/merge/stash", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\n" } });
    await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: false });
    const forbidden = calls.filter((c) =>
      ["reset", "commit", "merge", "stash", "rebase"].includes(c.args[0]),
    );
    expect(forbidden).toEqual([]);
    // And the read-tree + checkout-from-index two-step (the spec's exact recipe).
    expect(findCmd(calls, "read-tree")).toBeDefined();
    expect(calls.some((c) => c.args[0] === "checkout" && c.args[1] === "--")).toBe(true);
  });

  it("GUARANTEE #4 (delete two-flag AND): deleteCreatedFiles:false ⇒ no ls-files/unlink", async () => {
    const calls: Call[] = [];
    const unlinked: string[] = [];
    const cfgAllowDelete = { ...BASE_CFG, allowDeleteCreatedFiles: true }; // config gate OPEN
    const gb = makeBackendWithUnlink(calls, unlinked, cfgAllowDelete);
    await gb.restore("BEFORE1", { revertFileChanges: false, deleteCreatedFiles: false }); // per-call OFF
    expect(findCmd(calls, "ls-files")).toBeUndefined();
    expect(unlinked).toEqual([]);
  });

  it("GUARANTEE #4 (delete two-flag AND): allowDeleteCreatedFiles:false ⇒ no unlink even if per-call ON", async () => {
    const calls: Call[] = [];
    const unlinked: string[] = [];
    // BASE_CFG has allowDeleteCreatedFiles:false (config gate CLOSED) + per-call deleteCreatedFiles:true.
    const gb = makeBackendWithUnlink(calls, unlinked, BASE_CFG);
    await gb.restore("BEFORE1", { revertFileChanges: false, deleteCreatedFiles: true });
    expect(findCmd(calls, "ls-files")).toBeUndefined(); // the AND short-circuits before ls-files
    expect(unlinked).toEqual([]);
  });

  it("when delete runs: ls-files --others -- . :!<excludeGlobs> :!<DANGEROUS_DIRS>; unlink only non-dangerous", async () => {
    const calls: Call[] = [];
    const unlinked: string[] = [];
    const cfgWithExcludes = { ...CFG_WITH_EXCLUDES, allowDeleteCreatedFiles: true };
    const gb = makeBackendWithUnlink(calls, unlinked, cfgWithExcludes, {
      stdoutByCmd: { "ls-files": "src/a.ts\nnew.txt\n" }, // created files (none dangerous)
    });
    const res = await gb.restore("BEFORE1", { revertFileChanges: false, deleteCreatedFiles: true });
    const ls = findCmd(calls, "ls-files")!;
    expect(ls.args[0]).toBe("ls-files");
    expect(ls.args).toContain("--others");
    expect(ls.args).toContain("--");
    expect(ls.args).toContain(".");
    expect(ls.args).toContain(":!node_modules");
    expect(ls.args).toContain(":!.venv");
    expect(ls.args).toContain(":!.git"); // DANGEROUS_DIRS
    expect(ls.args).toContain(":!.pi");
    expect(ls.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    expect(res.deleted).toEqual(["src/a.ts", "new.txt"]);
    expect(unlinked).toHaveLength(2);
    for (const p of unlinked) {
      expect(p).toMatch(/\/fake\/cwd\/(src\/a\.ts|new\.txt)$/); // absolute, inside the workspace
    }
  });

  it("node_modules/.git are NEVER unlink targets (even if ls-files hypothetically listed them)", async () => {
    // ls-files :! should already filter these; the isDangerousWorkspaceRel gate is belt-and-suspenders.
    // Simulate a hostile ls-files output that DID list node_modules/.git entries and assert the gate blocks them.
    const calls: Call[] = [];
    const unlinked: string[] = [];
    const cfgAllowDelete = { ...BASE_CFG, allowDeleteCreatedFiles: true };
    const gb = makeBackendWithUnlink(calls, unlinked, cfgAllowDelete, {
      stdoutByCmd: { "ls-files": "node_modules/evil.js\n.git/config\n.pi/x\nsrc/clean.ts\n" },
    });
    await gb.restore("BEFORE1", { revertFileChanges: false, deleteCreatedFiles: true });
    expect(unlinked).toEqual([expect.stringMatching(/\/fake\/cwd\/src\/clean\.ts$/)]);
    for (const p of unlinked) {
      expect(p).not.toMatch(/node_modules/);
      expect(p).not.toMatch(/[\\/]\.git[\\/]/);
      expect(p).not.toMatch(/[\\/]\.pi[\\/]/);
    }
  });

  it("OVERSIZE-DELETE: deleteCreatedFiles SPARES oversize pre-existing files — paths in the oversize note (result.skipped) are NOT unlinked even though ls-files --others lists them", async () => {
    // spec/14 §2 guarantee #4: "delete_created_files only deletes files the span created". A
    // pre-existing file > maxFileBytes is skipped at capture (excluded via :! pathspec, NEVER
    // staged), so it lands in the oversize NOTE (read into result.skipped at restore step a.5) —
    // NOT in the beforeRef tree. `git ls-files --others` therefore lists it alongside a genuine
    // span creation. Before the fix the delete step unlinked it (irreversible data loss). The fix
    // spares any path present in result.skipped (the oversize note).
    const calls: Call[] = [];
    const unlinked: string[] = [];
    const cfgAllowDelete = { ...BASE_CFG, allowDeleteCreatedFiles: true };
    const gb = makeBackendWithUnlink(calls, unlinked, cfgAllowDelete, {
      stdoutByCmd: {
        notes: JSON.stringify(["big.bin"]), // oversize note written at capture
        "ls-files": "big.bin\nnew.ts\n", // big.bin (pre-existing oversize) + new.ts (span-created)
      },
    });
    const res = await gb.restore("BEFORE1", { revertFileChanges: false, deleteCreatedFiles: true });
    // the oversize file was surfaced into result.skipped from the note (step a.5)
    expect(res.skipped).toContain("big.bin");
    // ONLY the genuine span creation is deleted — the pre-existing oversize file is SPARED
    expect(res.deleted).toEqual(["new.ts"]);
    expect(res.deleted).not.toContain("big.bin");
    // big.bin was NEVER unlinked; new.ts WAS
    expect(unlinked.some((p) => /big\.bin$/.test(p))).toBe(false);
    expect(unlinked.some((p) => /new\.ts$/.test(p))).toBe(true);
  });

  it("BUG-001 R1: spares an oversize delete-candidate when the oversize note is ABSENT (note-write-failure window)", async () => {
    // The OVERSIZE-DELETE test above covers the happy path (note present → spare Set populated →
    // big.bin spared). This closes the RESIDUAL window (residual_risk_analysis.md § R1): the oversize
    // note is a best-effort side channel (its write is try/catch-swallowed at capture). If that write
    // FAILED, restore reads no note → result.skipped empty → spare Set empty → `git ls-files --others`
    // lists the pre-existing oversize file → `unlink` → irreversible data loss. The defense-in-depth
    // size guard (stat().size > maxFileBytes) spares it INDEPENDENT of the note.
    const calls: Call[] = [];
    const unlinked: string[] = [];
    // stat fake: big.bin is oversize (>256); new.ts is small. stat receives the ABS path
    // (resolveSafeWorkspacePath result), so match on the suffix (GOTCHA #4).
    const stat = async (p: string): Promise<{ size: number }> =>
      p.endsWith("big.bin") ? { size: 1000 } : { size: 10 };
    const cfg: MulliganConfig["revert"] = {
      ...BASE_CFG,
      allowDeleteCreatedFiles: true,
      maxFileBytes: 256,
    };
    const gb = makeBackendWithUnlink(
      calls,
      unlinked,
      cfg,
      {
        // makeExec's throwOn REQUIRES `call` (GOTCHA #2). restore() is called DIRECTLY (no capture),
        // so the ONLY `git notes` call is restore step (a.5)'s `notes … show BEFORE1` — call 1.
        // Throwing it → restore's try/catch swallows → result.skipped stays empty → spare Set empty
        // → (without the guard) big.bin would be unlinked. ls-files lists both candidates.
        throwOn: { cmd: "notes", call: 1 },
        stdoutByCmd: { "ls-files": "big.bin\nnew.ts\n" },
      },
      stat,
    );

    const res = await gb.restore("BEFORE1", { revertFileChanges: false, deleteCreatedFiles: true });

    // The small span-created file IS deleted; the oversize candidate is SPARED.
    expect(res.deleted).toEqual(["new.ts"]);
    expect(res.deleted).not.toContain("big.bin");
    // The spared oversize path is surfaced for agent visibility (independent of the note).
    expect(res.skipped).toContain("big.bin");
    // The recording unlink fake got new.ts but NOT big.bin.
    expect(unlinked.some((p) => /new\.ts$/.test(p))).toBe(true);
    expect(unlinked.some((p) => /big\.bin$/.test(p))).toBe(false);
  });

  it("per-path checkout failure ⇒ path lands in failed[]; restore still resolves (never rejects)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { diff: "a.ts\nb.ts\n" },
      throwOn: { cmd: "checkout", call: 1 }, // the 1st checkout throws; the 2nd succeeds
    });
    const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.failed).toEqual(["a.ts"]);
    expect(res.reverted).toEqual(["b.ts"]);
  });

  it("read-tree failure (exec rejects) ⇒ restore resolves to a 5-bucket result, never rejects", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "read-tree", call: 1 } });
    const res = await gb.restore("BADREF", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [] });
  });

  it("neither flag set ⇒ returns 5 empty buckets, issues no read-tree", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    const res = await gb.restore("BEFORE1", { revertFileChanges: false, deleteCreatedFiles: false });
    expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [] });
    expect(findCmd(calls, "read-tree")).toBeUndefined();
    expect(findCmd(calls, "ls-files")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// spec/14 §2 SAFETY INVARIANT — restore() forbidden-root entry guard (task P1.M1.T3.S2).
// §10 testing safety clause: "restore() against a forbidden root returns refused with zero
// filesystem mutation". The guard fires BEFORE ensureInit() and BEFORE any fs/git mutation, so the
// recording exec fake is NEVER invoked (calls.length === 0) — that empty call log IS the
// zero-mutation proof. makeBackend() hardcodes cwd="/fake/cwd" (NOT forbidden), so the home/"/"
// cases construct GitBackend DIRECTLY (mirroring the describe() test's direct-construction idiom).
describe("GitBackend.restore — forbidden-root entry guard (spec/14 §2 SAFETY INVARIANT)", () => {
  it("refuses when cwd is the user's home — refused:[home], other buckets empty, ZERO mutation", async () => {
    const home = homedir();
    const calls: Call[] = [];
    const gb = new GitBackend(home, BASE_CFG, null, { exec: makeExec(calls), scan: emptyScan });
    const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: true });
    expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [home] });
    // ZERO mutation: the guard fired before ensureInit() and before any this.exec() / unlink().
    expect(calls).toHaveLength(0);
    expect(findCmd(calls, "read-tree")).toBeUndefined();
    expect(findCmd(calls, "checkout")).toBeUndefined();
    expect(findCmd(calls, "ls-files")).toBeUndefined();
  });

  it("refuses when cwd is '/' (filesystem root) — same refused shape, ZERO mutation", async () => {
    const calls: Call[] = [];
    const gb = new GitBackend("/", BASE_CFG, null, { exec: makeExec(calls), scan: emptyScan });
    const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: true });
    expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: ["/"] });
    expect(calls).toHaveLength(0);
  });

  it("does NOT fire for a normal (non-forbidden) cwd — restore proceeds (negative control)", async () => {
    // makeBackend → cwd="/fake/cwd" (depth-2, not home, not "/") → isForbiddenRoot === false.
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\n" } });
    const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.refused).toEqual([]); // guard did NOT fire
    expect(res.reverted).toEqual(["a.ts"]); // restore ran the recipe
    expect(findCmd(calls, "read-tree")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GitBackend.describe()", () => {
  it("returns { backend: 'git' } (sync metadata)", () => {
    const gb = new GitBackend("/fake/cwd", BASE_CFG, null, { exec: makeExec([]), scan: emptyScan });
    expect(gb.describe()).toEqual({ backend: "git" });
  });
});

// AsyncMutex is exercised indirectly via the mutex-serialization test above (GitBackend constructs
// its own); no direct import needed here.

// ── oversize-skipped tracking via git notes (BUG-005 / E29) ─────────────────────────────────
// capture() writes JSON.stringify(oversizePaths) as a git NOTE on the commit under
// refs/mulligan/oversize (only when oversizePaths is non-empty); restore() best-effort reads it
// + parses it into result.skipped. rewind.ts already consumes result.skipped (L889/899/907) so the
// signal propagates to the success text + marker with ZERO upstream change. spec/14 §4.3 (caps),
// §6 (restore). Git capture is ATOMIC on maxTotalBytes overrun (returns null → no snapshot →
// restore never runs), so ONLY the oversize files (excluded via :! while the snapshot still
// succeeds) are git's meaningful skipped set.
describe("GitBackend — oversize-skipped tracking via git notes (BUG-005 / E29)", () => {
  it("capture: writes JSON.stringify(oversizePaths) as a note under refs/mulligan/oversize on the commit", async () => {
    const calls: Call[] = [];
    const oversizeScan = async (): Promise<CapScan> => ({
      oversizePaths: ["big.bin", "huge.dat"],
      totalBytes: 100,
    });
    const gb = makeBackend(calls, BASE_CFG, oversizeScan);
    const sha = await gb.capture("turn");
    expect(sha).toBe("COMMIT456");
    const note = findCmd(calls, "notes")!;
    expect(note).toBeDefined();
    expect(note.args).toEqual([
      "notes",
      "--ref=refs/mulligan/oversize",
      "add",
      "-f",
      "-m",
      JSON.stringify(["big.bin", "huge.dat"]),
      "COMMIT456", // the commit-tree SHA (=== the value restore receives as beforeRef)
    ]);
    // BEST-EFFORT + SAME shadow-env seam as update-ref (no new imports; guarantee #1/#2).
    expect(note.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    expect(note.opts?.env?.GIT_DIR).not.toBe("/fake/cwd/.git");
  });

  it("capture: writes NO note when oversizePaths is empty (a clean capture)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan); // emptyScan ⇒ no oversize
    const sha = await gb.capture("turn");
    expect(sha).toBe("COMMIT456");
    expect(findCmd(calls, "notes")).toBeUndefined();
  });

  it("capture: a note-add FAILURE does NOT fail capture (best-effort; commitSha already pinned)", async () => {
    const calls: Call[] = [];
    const oversizeScan = async (): Promise<CapScan> => ({ oversizePaths: ["big.bin"], totalBytes: 0 });
    // sabotage: make `notes add` throw (e.g. notes machinery unavailable).
    const gb = makeBackend(calls, BASE_CFG, oversizeScan, { throwOn: { cmd: "notes", call: 1 } });
    const sha = await gb.capture("turn");
    expect(sha).toBe("COMMIT456"); // capture STILL succeeded — the note failure was swallowed
    expect(findCmd(calls, "notes")).toBeDefined();
  });

  it("restore: reads the note + parses it into result.skipped", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { notes: JSON.stringify(["big.bin", "huge.dat"]) },
    });
    const res = await gb.restore("COMMIT456", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toEqual(["big.bin", "huge.dat"]);
    const note = findCmd(calls, "notes")!;
    expect(note.args).toEqual([
      "notes",
      "--ref=refs/mulligan/oversize",
      "show",
      "COMMIT456", // keyed by beforeRef === commitSha
    ]);
    expect(note.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
  });

  it("restore: NO note (non-zero exit) ⇒ result.skipped is [] + restore still completes (own try/catch)", async () => {
    const calls: Call[] = [];
    // throwOn:notes ⇒ `git notes show` exits non-zero (the common no-note case). restore MUST swallow it.
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "notes", call: 1 } });
    const res = await gb.restore("COMMIT456", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toEqual([]); // no note ⇒ no skipped signal
    // read-tree still ran (the note failure did NOT abort the restore pipeline).
    expect(findCmd(calls, "read-tree")).toBeDefined();
    expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [] });
  });

  it("restore: empty note stdout (no canned) ⇒ result.skipped is []", async () => {
    const calls: Call[] = [];
    // No canned notes stdout → makeExec returns "" for the `notes show` call → noteOut is empty → no parse.
    const gb = makeBackend(calls, BASE_CFG, emptyScan);
    const res = await gb.restore("COMMIT456", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toEqual([]);
    expect(findCmd(calls, "notes")).toBeDefined(); // the read still issued (best-effort)
  });

  it("restore: unparseable note JSON ⇒ swallowed, result.skipped stays [] (restore still runs)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { notes: "this is not json" },
    });
    const res = await gb.restore("COMMIT456", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toEqual([]); // unparseable → swallowed, no skipped signal
    expect(findCmd(calls, "read-tree")).toBeDefined(); // restore pipeline unaffected
  });

  it("restore: a non-array note JSON payload is ignored (skipped stays [])", async () => {
    const calls: Call[] = [];
    // a malformed payload (valid JSON but not an array) must NOT push garbage into skipped.
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { notes: JSON.stringify({ not: "an array" }) },
    });
    const res = await gb.restore("COMMIT456", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toEqual([]);
  });

  it("restore: neither flag set ⇒ the note is NOT read (the early-return guard fires before it)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls, BASE_CFG, emptyScan, {
      stdoutByCmd: { notes: JSON.stringify(["big.bin"]) },
    });
    const res = await gb.restore("COMMIT456", { revertFileChanges: false, deleteCreatedFiles: false });
    expect(res.skipped).toEqual([]);
    expect(findCmd(calls, "notes")).toBeUndefined(); // the note-read is past the guard
    expect(findCmd(calls, "read-tree")).toBeUndefined();
  });

  it("round-trip: capture(oversize) → restore reads the SAME paths back into result.skipped", async () => {
    const calls: Call[] = [];
    const oversizeScan = async (): Promise<CapScan> => ({
      oversizePaths: ["big.bin", "huge.dat"],
      totalBytes: 100,
    });
    // makeExec: commit-tree returns COMMIT456 (the SHA restore will pass as beforeRef); the note-show
    // round-trips the note-write payload. We pre-seed `notes` stdout with what capture would write.
    const gb = makeBackend(calls, BASE_CFG, oversizeScan, {
      stdoutByCmd: { notes: JSON.stringify(["big.bin", "huge.dat"]) },
    });
    const sha = await gb.capture("turn");
    expect(sha).toBe("COMMIT456");
    // the note add was recorded during capture...
    const noteAdd = calls.find(
      (c) => c.args[0] === "notes" && c.args.includes("add"),
    )!;
    expect(noteAdd.args).toContain("COMMIT456");
    // ...and restore reads it back for the SAME ref (sha === "COMMIT456" per makeExec).
    const res = await gb.restore("COMMIT456", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toEqual(["big.bin", "huge.dat"]);
  });
});