import { describe, it, expect, expectTypeOf, afterEach } from "vitest";
import {
  AsyncMutex,
  NoOpStore,
  detectAndCreate,
  type SnapshotStore,
  type RestoreOpts,
  type RestoreResult,
} from "../src/snapshot/store.js";
import type { MulliganConfig } from "../src/config.js";
import { mkdtemp, mkdir, rm, chmod, access, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// A canonical valid revert config used across detectAndCreate tests (mirrors DEFAULT_CONFIG.revert).
const REVERT_CFG: MulliganConfig["revert"] = {
  enabled: true,
  allowDeleteCreatedFiles: false,
  nonGitMode: "cas",
  storageDir: null,
  maxFileBytes: 262144,
  maxTotalBytes: 33554432,
  maxSnapshotsPerTurn: 64,
  excludeGlobs: [".git", "node_modules"],
};

// spec/14 §2 (the SnapshotStore interface + RestoreOpts + RestoreResult — verbatim), §4.3 (the
// AsyncMutex serialization contract), spec/10 Tier 1 (pure-helper unit-test tier: vitest, .js
// imports), task P2.M1.T1.S1.
// No beforeEach needed: each test constructs its own AsyncMutex (the store.ts types are stateless;
// only AsyncMutex holds state and it is per-instance).

// Yield the event loop so concurrent tasks actually race for the lock — without a macrotask yield,
// a sync body would hold the lock across no await and the overlap/FIFO could not be observed
// (false green). setTimeout(…, 0) schedules a macrotask, safely draining the microtask queue first.
async function microDelay(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}

describe("AsyncMutex — spec/14 §4.3 serialization contract", () => {
  it("(a) acquire() returns a release function; a lone acquire/release pair completes", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    expect(typeof release).toBe("function");
    expect(() => release()).not.toThrow(); // releasing an uncontended lock is a no-op-ish success
  });

  it("(b) serializes concurrent acquire(): holders NEVER overlap (maxActive === 1)", async () => {
    const mutex = new AsyncMutex();
    let active = 0;
    let maxActive = 0;

    async function task(name: string): Promise<string> {
      const release = await mutex.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await microDelay(); // yield so a buggy (non-chaining) impl would let a sibling slip in
      active--;
      release();
      return name;
    }

    await Promise.all([task("a"), task("b"), task("c"), task("d"), task("e")]);
    expect(maxActive).toBe(1); // no two holders ever overlapped — proves mutual exclusion
  });

  it("(c) is FIFO: concurrent acquire() wake in arrival order with no overlap", async () => {
    const mutex = new AsyncMutex();
    const log: string[] = [];

    async function task(name: string): Promise<void> {
      const release = await mutex.acquire();
      log.push(`start:${name}`);
      await microDelay(); // yield so the interleaving is observable
      log.push(`end:${name}`);
      release();
    }

    await Promise.all([task("a"), task("b"), task("c"), task("d")]);
    // exact start/end interleaving proves BOTH mutual exclusion (no start:b before end:a) AND
    // arrival-order fairness (a fully before b before c before d — not LIFO, not resolve-all).
    expect(log).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
      "start:d",
      "end:d",
    ]);
  });

  it("(d) re-acquire works after release (the mutex is reusable)", async () => {
    const mutex = new AsyncMutex();
    const r1 = await mutex.acquire();
    r1();
    // second acquire on a released mutex must complete immediately
    const r2 = await mutex.acquire();
    expect(typeof r2).toBe("function");
    r2();
    // and a third, to be sure the chain tail stays clean after a release
    const r3 = await mutex.acquire();
    r3();
  });

  it("(e) double-release is a safe no-op (does not corrupt subsequent serialization)", async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    release();
    expect(() => release()).not.toThrow(); // Promise settles once — second resolve is a no-op

    let active = 0;
    let maxActive = 0;
    async function task(name: string): Promise<void> {
      const rel = await mutex.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await microDelay();
      active--;
      rel();
    }
    await Promise.all([task("a"), task("b"), task("c")]);
    // serialization still holds after a double-release: the chain was not corrupted.
    expect(maxActive).toBe(1);
  });

  it("(f) holds serialization under higher concurrency (50 concurrent tasks)", async () => {
    const mutex = new AsyncMutex();
    let active = 0;
    let maxActive = 0;
    async function task(): Promise<void> {
      const release = await mutex.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await microDelay();
      active--;
      release();
    }
    await Promise.all(Array.from({ length: 50 }, () => task()));
    expect(maxActive).toBe(1);
  });
});

describe("SnapshotStore / RestoreOpts / RestoreResult / AsyncMutex — type shapes (spec/14 §2)", () => {
  it("(type) capture(label) takes one string and returns an ASYNC Promise<string | null> (spec §4.3)", () => {
    expectTypeOf<SnapshotStore["capture"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SnapshotStore["capture"]>().returns.toEqualTypeOf<Promise<string | null>>();
  });

  it("(type) restore(beforeRef, opts) returns Promise<RestoreResult> (async — spec §4.3)", () => {
    expectTypeOf<SnapshotStore["restore"]>().parameters.toEqualTypeOf<[string, RestoreOpts]>();
    expectTypeOf<SnapshotStore["restore"]>().returns.toEqualTypeOf<Promise<RestoreResult>>();
  });

  it("(type) describe() returns { backend: 'git'|'cas'|'none'; reason?: string } (3-valued — GOTCHA #6)", () => {
    expectTypeOf<SnapshotStore["describe"]>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<SnapshotStore["describe"]>().returns.toEqualTypeOf<{
      backend: "git" | "cas" | "none";
      reason?: string;
    }>();
  });

  it("(type) dirtyCheck(afterRef, paths) returns Promise<string[]> (async — spec §4.3)", () => {
    expectTypeOf<SnapshotStore["dirtyCheck"]>().parameters.toEqualTypeOf<[string, string[]]>();
    expectTypeOf<SnapshotStore["dirtyCheck"]>().returns.toEqualTypeOf<Promise<string[]>>();
  });

  it("(type) changedPaths(beforeRef) returns Promise<string[]> (async — spec/14 §6 step 2, BUG-004)", () => {
    expectTypeOf<SnapshotStore["changedPaths"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SnapshotStore["changedPaths"]>().returns.toEqualTypeOf<Promise<string[]>>();
  });

  it("(type) has(ref) returns Promise<boolean>; retire(ref) returns Promise<void> (async — spec §4.3)", () => {
    expectTypeOf<SnapshotStore["has"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SnapshotStore["has"]>().returns.toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<SnapshotStore["retire"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SnapshotStore["retire"]>().returns.toEqualTypeOf<Promise<void>>();
  });

  it("(type) RestoreOpts = { revertFileChanges: boolean; deleteCreatedFiles: boolean }", () => {
    expectTypeOf<RestoreOpts>().toEqualTypeOf<{
      revertFileChanges: boolean;
      deleteCreatedFiles: boolean;
    }>();
  });

  it("(type) RestoreResult = the 5 string[] buckets (reverted/deleted/failed/skipped/refused)", () => {
    expectTypeOf<RestoreResult>().toEqualTypeOf<{
      reverted: string[];
      deleted: string[];
      failed: string[];
      skipped: string[];
      refused: string[];
    }>();
  });

  it("(type) AsyncMutex.acquire() returns Promise<() => void>", () => {
    expectTypeOf<AsyncMutex["acquire"]>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<AsyncMutex["acquire"]>().returns.toEqualTypeOf<Promise<() => void>>();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2.M1.T1.S2 — NoOpStore + detectAndCreate() factory tests.
// spec/14 §2 ("Detection"), spec/14 E28 (fail-open), spec/14 §8 (storageDir resolution).
//
// TODAY-vs-AFTER behavior (document so future maintainers know the "backend none today" assertions
// are INTENTIONAL, not bugs):
//   - The git branch's dynamic `import("./git.js")` REJECTED before P2.M2.T1 (git.ts absent) →
//     detectAndCreate fail-opened to NoOpStore (backend "none"). After P2.M2.T1 this flipped to "git"
//     (test (d) pins the landed forward-compat contract).
//   - The cas branch's dynamic `import("./cas.js")` REJECTED before P2.M3.T1 (cas.ts absent) →
//     detectAndCreate fail-opened to NoOpStore (backend "none"). After P2.M3.T1 this flipped to "cas"
//     (tests (a)/(c)/(e) pin the landed forward-compat contract).
// These tests pin CURRENT behavior so the suite stays green AND act as regression sentinels later.
//
// House idiom: REAL temp dirs (os.mkdtemp) + a REAL `git init` — NOT mocks — so the genuine fail-open
// path (including the real import-reject of an absent module) is exercised. afterEach restores
// chmod 0o755 before rm() (read-only dirs block rm on some platforms). No module-scoped mutable
// state in the SUT, so no beforeEach needed.
// ─────────────────────────────────────────────────────────────────────────────

describe("NoOpStore — fail-open terminal store (spec/14 §2, E28)", () => {
  it("(a) describe() reports backend 'none' + the constructor reason", () => {
    const store = new NoOpStore("no git repo and storage dir not writable");
    expect(store.describe()).toEqual({
      backend: "none",
      reason: "no git repo and storage dir not writable",
    });
  });

  it("(b) capture() returns null (ASYNC no-op — revert unavailable; spec §4.3)", async () => {
    const store = new NoOpStore("x");
    expect(await store.capture("turn")).toBeNull();
  });

  it("(c) dirtyCheck() returns [] (async no-op — no drift info available)", async () => {
    const store = new NoOpStore("x");
    expect(await store.dirtyCheck("after-ref", ["a.ts", "b.ts"])).toEqual([]);
  });

  it("(d) restore() returns the 5 EMPTY buckets (async no-op — nothing was done)", async () => {
    const store = new NoOpStore("x");
    expect(await store.restore("before-ref", { revertFileChanges: true, deleteCreatedFiles: true })).toEqual({
      reverted: [],
      deleted: [],
      failed: [],
      skipped: [],
      refused: [],
    });
  });

  it("(e) has() returns false (async no-op — NoOpStore holds no refs)", async () => {
    const store = new NoOpStore("x");
    expect(await store.has("any-ref")).toBe(false);
  });

  it("(f) retire() is an async no-op void (never throws)", async () => {
    const store = new NoOpStore("x");
    await expect(store.retire("any-ref")).resolves.toBeUndefined();
  });

  it("(g) satisfies the full SnapshotStore interface (all 6 methods present)", () => {
    const store: SnapshotStore = new NoOpStore("reason"); // assignability proves interface conformance
    expect(typeof store.describe).toBe("function");
    expect(typeof store.capture).toBe("function");
    expect(typeof store.dirtyCheck).toBe("function");
    expect(typeof store.restore).toBe("function");
    expect(typeof store.has).toBe("function");
    expect(typeof store.retire).toBe("function");
  });
});

describe("detectAndCreate() — spec/14 §2 Detection + SAFETY INVARIANT + §10 (lexical .git; no rev-parse)", () => {
  // spec/14 §2 'Detection' + SAFETY INVARIANT + §10 'Safety (non-negotiable)'. task P1.M1.T2.S1.
  //
  // BEHAVIOR CHANGE (vs the old P2.M1.T1.S2 block): a NON-EXISTENT cwd used to fall through to the
  // cas branch (execFile rejected on the bad cwd → "not git" → cas). With the new lexical detection
  // realpathSync(cwd) throws on ENOENT → NoOpStore 'none' (test (g) pins the NEW fail-safe behavior).
  // The git binary is no longer invoked at all — detection is realpathSync + isForbiddenRoot +
  // existsSync only; `.git` is created via mkdir (binary-free), which itself proves no git command ran.
  //
  // Tracks temp dirs to chmod-restore + rm in afterEach (read-only dirs block rm on some platforms).
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      try {
        await chmod(d, 0o755); // restore writability so rm() can clean up
      } catch {
        /* dir may already be gone */
      }
      try {
        await rm(d, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    dirs.length = 0;
  });

  // (a) LEXICAL .git detection — binary-free (mkdir, NOT git init; NO rev-parse).
  it("(a) temp dir WITH .git (mkdir) + writable storage → GitBackend (lexical .git; no rev-parse, no git init)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hasgit-"));
    dirs.push(dir);
    await mkdir(join(dir, ".git")); // lexical .git (empty dir is enough; no git binary needed)
    const storageDir = await mkdtemp(join(tmpdir(), "git-store-"));
    dirs.push(storageDir);
    const cfg = { ...REVERT_CFG, storageDir };
    const store = await detectAndCreate(dir, cfg, null);
    expect(store.describe().backend).toBe("git");
  });

  // (a2) `.git` as a FILE (worktree/submodule gitdir pointer) — existsSync covers file-or-dir (GOTCHA #7).
  it("(a2) .git as a FILE (worktree/submodule) → GitBackend (existsSync covers file-or-dir)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wtgit-"));
    dirs.push(dir);
    // overwrite .git with a FILE containing a gitdir pointer (as a real worktree's .git looks):
    await writeFile(join(dir, ".git"), "gitdir: /tmp/whatever/.git/wt\n");
    const cfg = { ...REVERT_CFG, storageDir: await mkdtemp(join(tmpdir(), "wt-store-")) };
    dirs.push(cfg.storageDir!);
    const store = await detectAndCreate(dir, cfg, null);
    expect(store.describe().backend).toBe("git");
  });

  // (b) non-git dir (no .git) + writable storage → cas branch.
  it("(b) temp dir WITHOUT .git + writable storage → CasBackend (.git absent → cas branch)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nogit-"));
    dirs.push(cwd);
    const storageDir = await mkdtemp(join(tmpdir(), "cas-store-"));
    dirs.push(storageDir);
    const cfg = { ...REVERT_CFG, storageDir };
    const store = await detectAndCreate(cwd, cfg, null);
    expect(store.describe().backend).toBe("cas");
  });

  // (c) forbidden home → NoOpStore 'none' (forbidden-root gate — spec/14 §2 + §10).
  it("(c) detectAndCreate(os.homedir(), …) → NoOpStore 'none' (forbidden root gate — spec §2/§10)", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "sess-"));
    dirs.push(sessionDir);
    const store = await detectAndCreate(homedir(), { ...REVERT_CFG, storageDir: null }, sessionDir);
    expect(store).toBeInstanceOf(NoOpStore);
    const desc = store.describe();
    expect(desc.backend).toBe("none");
    expect((desc.reason ?? "").toLowerCase()).toContain("forbidden");
  });

  // (d) forbidden '/' → NoOpStore 'none' (forbidden-root gate — spec/14 §2 + §10).
  it("(d) detectAndCreate('/', …) → NoOpStore 'none' (forbidden root gate — spec §2/§10)", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "sess-root-"));
    dirs.push(sessionDir);
    const store = await detectAndCreate("/", { ...REVERT_CFG, storageDir: null }, sessionDir);
    expect(store).toBeInstanceOf(NoOpStore);
    const desc = store.describe();
    expect(desc.backend).toBe("none");
    expect((desc.reason ?? "").toLowerCase()).toContain("forbidden");
  });

  // (e) non-git dir + UNWRITABLE storage → NoOpStore (cas-branch fail-open path — UNCHANGED).
  it("(e) non-git dir + UNWRITABLE storage (chmod 0o555) → NoOpStore, reason mentions 'writable'", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nongit-"));
    dirs.push(cwd);
    const storageDir = await mkdtemp(join(tmpdir(), "ro-store-"));
    dirs.push(storageDir);
    await chmod(storageDir, 0o555); // read-only (no write/exec for owner) → access(W_OK) rejects
    const cfg = { ...REVERT_CFG, storageDir };
    const store = await detectAndCreate(cwd, cfg, null);
    expect(store).toBeInstanceOf(NoOpStore);
    const desc = store.describe();
    expect(desc.backend).toBe("none");
    expect((desc.reason ?? "").toLowerCase()).toContain("writable");
  });

  // (f) subdir whose PARENT has .git but subdir does NOT → cas. Proves NO upward walk — the
  //     regression vector this whole task closes (spec/14 §2 SAFETY INVARIANT + §10).
  it("(f) subdir whose PARENT has .git but subdir does NOT → 'cas' (NO upward walk — spec §2 SAFETY INVARIANT)", async () => {
    const parent = await mkdtemp(join(tmpdir(), "gitparent-"));
    dirs.push(parent);
    await mkdir(join(parent, ".git")); // parent IS a git repo (lexically)
    const subdir = join(parent, "subdir");
    await mkdir(subdir); // subdir is NOT a git repo (no .git inside it)
    dirs.push(subdir);
    const cfg = { ...REVERT_CFG, storageDir: await mkdtemp(join(tmpdir(), "sub-store-")) };
    dirs.push(cfg.storageDir!);
    const store = await detectAndCreate(subdir, cfg, null);
    expect(store.describe().backend).toBe("cas"); // NOT promoted to parent → proves no upward walk
  });

  // (g) NON-EXISTENT cwd → NoOpStore 'none' (realpathSync ENOENT → fail-safe). DOCUMENTS the behavior
  //     change (old (a) asserted 'cas' via execFile ENOENT → not git).
  it("(g) NON-EXISTENT cwd → NoOpStore 'none' (realpathSync ENOENT → fail-safe)", async () => {
    const badCwd = join(tmpdir(), `nonexistent-det-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const sessionDir = await mkdtemp(join(tmpdir(), "sess-noexist-"));
    dirs.push(sessionDir);
    const store = await detectAndCreate(badCwd, { ...REVERT_CFG, storageDir: null }, sessionDir);
    expect(store).toBeInstanceOf(NoOpStore);
    const desc = store.describe();
    expect(desc.backend).toBe("none");
    expect((desc.reason ?? "").toLowerCase()).toMatch(/resolved|exist|unread/);
  });

  // (h) detection issues ZERO git/child_process calls (no rev-parse — spec/14 §2 SAFETY INVARIANT).
  //     The PRP's primary sentinel was vi.spyOn(child_process, "execFile"), but Node built-in exports
  //     are non-configurable ("Cannot redefine property: execFile") in this vitest version, so the spy
  //     is flaky. FALLBACK (per the PRP Confidence −1 note): the binary-free framing — run detection
  //     with PATH emptied. Detection is realpathSync + isForbiddenRoot + existsSync ONLY (none consult
  //     PATH), and GitBackend's constructor defers git init to first capture, so an empty PATH cannot
  //     affect backend selection here. IF detection still shelled out to `git` (the old rev-parse
  //     probe), the empty PATH would make that exec ENOENT → fail-open to NoOpStore → backend 'none',
  //     NOT 'git'. Asserting backend 'git' under an empty PATH therefore PROVES no git binary was run.
  it("(h) detection selects 'git' even with an EMPTY PATH (proves no git binary is invoked — spec §2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "noexec-"));
    dirs.push(dir);
    await mkdir(join(dir, ".git"));
    const cfg = { ...REVERT_CFG, storageDir: await mkdtemp(join(tmpdir(), "ne-store-")) };
    dirs.push(cfg.storageDir!);
    const origPath = process.env.PATH;
    process.env.PATH = ""; // provably no git on PATH for this process
    try {
      const store = await detectAndCreate(dir, cfg, null);
      expect(store.describe().backend).toBe("git"); // lexical .git selected WITHOUT invoking git
    } finally {
      process.env.PATH = origPath;
    }
  });

  // ── [VALIDATION-FIX #1] the default-config sessionDir regression ──────────────────────────
  // Reproduces the report's Issue #1: with the documented default config (revert.enabled:true, NO
  // explicit storageDir) index.ts used to call detectAndCreate WITHOUT sessionDir, so both backends
  // threw "no storage dir" → NoOpStore → revert silently inert. The fix threads sessionDir at the
  // call site; these tests pin that detectAndCreate honors a sessionDir default (git + cas).
  it("(VALIDATION-FIX #1a) git workspace + storageDir:null + sessionDir → GitBackend (NOT NoOpStore)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-git-"));
    dirs.push(dir);
    await mkdir(join(dir, ".git"));
    const sessionDir = await mkdtemp(join(tmpdir(), "sess-dir-git-"));
    dirs.push(sessionDir);
    // storageDir:null — the documented default; sessionDir must drive <sessionDir>/mulligan/.
    const cfg = { ...REVERT_CFG, storageDir: null };
    const store = await detectAndCreate(dir, cfg, sessionDir);
    expect(store.describe().backend).toBe("git"); // NOT 'none' (the bug)
  });

  it("(VALIDATION-FIX #1b) non-git workspace + storageDir:null + sessionDir → CasBackend (NOT NoOpStore)", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sess-cas-"));
    dirs.push(cwd);
    const sessionDir = await mkdtemp(join(tmpdir(), "sess-dir-cas-"));
    dirs.push(sessionDir);
    const cfg = { ...REVERT_CFG, storageDir: null };
    const store = await detectAndCreate(cwd, cfg, sessionDir);
    expect(store.describe().backend).toBe("cas"); // NOT 'none' (the bug)
  });
});