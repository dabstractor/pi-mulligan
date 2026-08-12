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
import { mkdtemp, mkdir, rm, chmod, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

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
//   - The git branch's dynamic `import("./git.js")` REJECTS today (git.ts ships in P2.M2.T1) →
//     detectAndCreate fail-opens to NoOpStore (backend "none"). After P2.M2.T1 this flips to "git".
//   - The cas branch's dynamic `import("./cas.js")` REJECTS today (cas.ts ships in P2.M3.T1) →
//     detectAndCreate fail-opens to NoOpStore (backend "none"). After P2.M3.T1 this flips to "cas".
// These tests pin CURRENT behavior so the suite stays green now AND act as regression sentinels later.
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

describe("detectAndCreate() — spec/14 §2 detection tree + E28 fail-open", () => {
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

  it("(a) NEVER throws — a non-existent cwd returns NoOpStore (E28)", async () => {
    const badCwd = join(tmpdir(), `nonexistent-det-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // badCwd does NOT exist on disk → execFile rejects (ENOENT on cwd) → fail-open.
    const store = await detectAndCreate(badCwd, REVERT_CFG, await mkdtemp(join(tmpdir(), "sess-")));
    expect(store).toBeInstanceOf(NoOpStore);
    expect(store.describe().backend).toBe("none");
  });

  it("(b) non-git dir + UNWRITABLE storage → NoOpStore, reason mentions 'writable'", async () => {
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

  it("(c) non-git dir + WRITABLE storage → reaches cas branch → NoOpStore TODAY (./cas.js absent)",
    async () => {
      // TODAY: the dynamic import("./cas.js") rejects (cas.ts ships in P2.M3.T1) → fail-open to NoOpStore.
      // AFTER P2.M3.T1: this returns a CasBackend and describe().backend === "cas".
      const cwd = await mkdtemp(join(tmpdir(), "nongit-w-"));
      dirs.push(cwd);
      const storageDir = await mkdtemp(join(tmpdir(), "rw-store-"));
      dirs.push(storageDir);
      const cfg = { ...REVERT_CFG, storageDir };
      const store = await detectAndCreate(cwd, cfg, null);
      expect(store).toBeInstanceOf(NoOpStore);
      expect(store.describe().backend).toBe("none");
    });

  it("(d) real `git init` dir → reaches git branch → NoOpStore TODAY (./git.js absent)", async () => {
    // Guard: skip if `git` is not on PATH (rare in CI; real `git init` requires the binary).
    let gitOk = true;
    try {
      await execFile("git", ["--version"]);
    } catch {
      gitOk = false;
    }
    if (!gitOk) {
      console.warn("[store.test] git not on PATH — skipping real-`git init` detection test");
      return; // vitest treats a returned-pending test as passed (no assertion); acceptable skip.
    }

    const gitDir = await mkdtemp(join(tmpdir(), "gitinit-"));
    dirs.push(gitDir);
    await execFile("git", ["init"], { cwd: gitDir });
    const storageDir = await mkdtemp(join(tmpdir(), "git-store-"));
    dirs.push(storageDir);
    const cfg = { ...REVERT_CFG, storageDir };
    // BEFORE P2.M2.T1: detection reached the git branch (rev-parse exit 0) but import("./git.js")
    // rejected (git.ts absent) → fail-open to NoOpStore. AFTER P2.M2.T1: git.ts exists → the dynamic
    // import resolves → detectAndCreate constructs a GitBackend → backend === "git" (the intended flip;
    // this test now pins that forward-compat contract landed correctly).
    const store = await detectAndCreate(gitDir, cfg, null);
    expect(store.describe().backend).toBe("git");
  });

  it("(e) storageDir===null + sessionDir → default <sessionDir>/mulligan/ resolved (no throw)", async () => {
    // cwd non-git; sessionDir writable → resolveStorageDir yields <sessionDir>/mulligan/, mkdir+access
    // succeed → reaches cas branch → NoOpStore TODAY (./cas.js absent). AFTER P2.M3.T1: backend "cas".
    const cwd = await mkdtemp(join(tmpdir(), "nongit-sess-"));
    dirs.push(cwd);
    const sessionDir = await mkdtemp(join(tmpdir(), "sess-"));
    dirs.push(sessionDir);
    const cfg = { ...REVERT_CFG, storageDir: null }; // null ⇒ default <sessionDir>/mulligan/
    const store = await detectAndCreate(cwd, cfg, sessionDir);
    // No throw; reaches the cas branch (fail-open NoOpStore today because ./cas.js is absent).
    expect(store).toBeInstanceOf(NoOpStore);
    expect(store.describe().backend).toBe("none");
    // Side-check: the default <sessionDir>/mulligan/ was actually created (mkdir recursive ran).
    const mulliganDir = join(sessionDir, "mulligan");
    let created = false;
    try {
      await access(mulliganDir); // exists ⇒ resolveStorageDir + mkdir ran the default path
      created = true;
    } catch {
      created = false;
    }
    expect(created).toBe(true);
  });

  it("(f) storageDir resolving INSIDE cwd → fail-open NoOpStore (belt-and-suspenders containment)", async () => {
    // config.ts rejects inside-cwd storageDir at validation time, but resolveStorageDir re-checks
    // (covers the sessionDir-default path). A storageDir inside cwd must fail-open, not pollute.
    const cwd = await mkdtemp(join(tmpdir(), "inside-cwd-"));
    dirs.push(cwd);
    const insideDir = join(cwd, "nested-store");
    await mkdir(insideDir, { recursive: true });
    const cfg = { ...REVERT_CFG, storageDir: insideDir };
    const store = await detectAndCreate(cwd, cfg, null);
    expect(store).toBeInstanceOf(NoOpStore);
    expect(store.describe().backend).toBe("none");
  });
});