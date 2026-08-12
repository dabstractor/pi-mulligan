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
    if (cmd === "rev-parse" && args[1] === "--show-toplevel") return { stdout: "/fake/repo\n", stderr: "" };
    if (cmd === "rev-parse" && args[1] === "--absolute-git-dir")
      return { stdout: "/fake/repo/.git\n", stderr: "" };
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
): GitBackend {
  const unlink = async (p: string): Promise<void> => {
    unlinked.push(p);
  };
  return new GitBackend("/fake/cwd", cfg, null, { exec: makeExec(calls, canned), scan: emptyScan, unlink });
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
    expect(diff.opts?.env?.GIT_WORK_TREE).toBe("/fake/repo");
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
    // The first two rev-parse calls (show-toplevel, absolute-git-dir) in ensureInit succeed; the
    // 3rd rev-parse (--verify) throws → has returns false.
    const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "rev-parse", call: 3 } });
    expect(await gb.has("MISSING")).toBe(false);
  });

  it("never rejects", async () => {
    const gb = makeBackend([], BASE_CFG, emptyScan, { throwOn: { cmd: "rev-parse", call: 3 } });
    await expect(gb.has("MISSING")).resolves.toBe(false);
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
      expect(c.opts?.env?.GIT_DIR).not.toBe("/fake/repo/.git");
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
      expect(w.opts?.env?.GIT_DIR).not.toBe("/fake/repo/.git");
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
      expect(p).toMatch(/\/fake\/repo\/(src\/a\.ts|new\.txt)$/); // absolute, inside the workspace
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
    expect(unlinked).toEqual([expect.stringMatching(/\/fake\/repo\/src\/clean\.ts$/)]);
    for (const p of unlinked) {
      expect(p).not.toMatch(/node_modules/);
      expect(p).not.toMatch(/[\\/]\.git[\\/]/);
      expect(p).not.toMatch(/[\\/]\.pi[\\/]/);
    }
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
describe("GitBackend.describe()", () => {
  it("returns { backend: 'git' } (sync metadata)", () => {
    const gb = new GitBackend("/fake/cwd", BASE_CFG, null, { exec: makeExec([]), scan: emptyScan });
    expect(gb.describe()).toEqual({ backend: "git" });
  });
});

// AsyncMutex is exercised indirectly via the mutex-serialization test above (GitBackend constructs
// its own); no direct import needed here.