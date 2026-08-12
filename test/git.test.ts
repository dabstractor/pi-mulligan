import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { GitBackend, type GitExec, type CapScan } from "../src/snapshot/git.js";
import type { MulliganConfig } from "../src/config.js";

// spec/14-working-tree-revert.md §3 (GitBackend capture flow + the FIVE git-safety guarantees),
// §5 (capture lifecycle & retention / caps), §4.3 (AsyncMutex serialization contract); task
// P2.M2.T1.S1 scope: init() + capture() + S2-method stubs throw.
//
// What is mocked (DI seam via constructor deps) vs what is real:
//   - exec (deps.exec): a recording fake returning canned stdout for rev-parse/write-tree/commit-tree
//     so capture reaches its pipeline WITHOUT real git. Tests assert on the recorded calls.
//   - scan (deps.scan): a canned CapScan so the real fs walk (against a non-existent /fake/repo)
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
 * Build a recording exec fake. Returns canned stdout for the read-only rev-parse calls + the
 * write-tree/commit-tree pipeline steps so capture can proceed without real git. Records every
 * invocation into `calls` for assertion.
 */
function makeExec(calls: Call[]): GitExec {
  return async (file, args, opts) => {
    calls.push({ file, args: [...args], opts });
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { stdout: "/fake/repo\n", stderr: "" };
    if (args[0] === "rev-parse" && args[1] === "--absolute-git-dir")
      return { stdout: "/fake/repo/.git\n", stderr: "" };
    if (args[0] === "write-tree") return { stdout: "TREE123\n", stderr: "" };
    if (args[0] === "commit-tree") return { stdout: "COMMIT456\n", stderr: "" };
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
): GitBackend {
  return new GitBackend("/fake/cwd", cfg, null, { exec: makeExec(calls), scan });
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

/** The expected shadow dir for the /fake/repo fixture: <storageDir>/<sha256("/fake/repo").slice(0,16)>. */
function expectedShadow(storageDir: string, repoRoot = "/fake/repo"): string {
  return `${storageDir}/${createHash("sha256").update(repoRoot).digest("hex").slice(0, 16)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("GitBackend.capture — command construction (spec/14 §3)", () => {
  it("issues rev-parse --show-toplevel against the USER repo (cwd, NO shadow GIT_DIR)", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await gb.capture("turn");
    const showTop = findCmd(calls, "rev-parse");
    expect(showTop).toBeDefined();
    expect(showTop!.opts?.cwd).toBe("/fake/cwd"); // resolved cwd, NOT the shadow env
    // NO shadow GIT_DIR override on the read-only rev-parse (guarantee #1).
    expect(showTop!.opts?.env?.GIT_DIR).toBeUndefined();
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
      expect(c.opts?.env?.GIT_WORK_TREE).toBe("/fake/repo");
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
      expect(c.opts?.env?.GIT_DIR).not.toBe("/fake/repo/.git"); // NEVER the source git dir
    }
  });

  it("the ONLY command without the shadow env is the read-only rev-parse", async () => {
    const calls: Call[] = [];
    const gb = makeBackend(calls);
    await gb.capture("turn");
    const revParses = calls.filter((c) => c.args[0] === "rev-parse");
    expect(revParses.length).toBeGreaterThan(0);
    for (const rp of revParses) {
      expect(rp.opts?.cwd).toBe("/fake/cwd");
      expect(rp.opts?.env?.GIT_DIR).toBeUndefined(); // no shadow override on the source read
    }
    // Every NON-rev-parse call carries the shadow env.
    for (const c of calls.filter((c) => c.args[0] !== "rev-parse")) {
      expect(c.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GitBackend.capture — best-effort + caps (E29/E27)", () => {
  it("returns null when git add fails (exec rejects) — capture does NOT reject", async () => {
    const calls: Call[] = [];
    const throwingExec: GitExec = async (file, args, opts) => {
      calls.push({ file, args: [...args], opts });
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { stdout: "/fake/repo\n", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--absolute-git-dir")
        return { stdout: "/fake/repo/.git\n", stderr: "" };
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
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { stdout: "/fake/repo\n", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "--absolute-git-dir")
        return { stdout: "/fake/repo/.git\n", stderr: "" };
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
describe("GitBackend — S2 stubs throw (P2.M2.T1.S2 scope)", () => {
  it("dirtyCheck/restore/has/retire throw 'not implemented — see P2.M2.T1.S2'", async () => {
    const gb = new GitBackend("/fake/cwd", BASE_CFG, null, { exec: makeExec([]), scan: emptyScan });
    await expect(gb.dirtyCheck("r", [])).rejects.toThrow(/P2\.M2\.T1\.S2/);
    await expect(gb.restore("r", { revertFileChanges: true, deleteCreatedFiles: false })).rejects.toThrow(
      /P2\.M2\.T1\.S2/,
    );
    await expect(gb.has("r")).rejects.toThrow(/P2\.M2\.T1\.S2/);
    await expect(gb.retire("r")).rejects.toThrow(/P2\.M2\.T1\.S2/);
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