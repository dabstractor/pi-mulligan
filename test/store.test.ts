import { describe, it, expect, expectTypeOf } from "vitest";
import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "../src/snapshot/store.js";

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
  it("(type) capture(label) takes one string and returns a SYNCHRONOUS string | null (GOTCHA #1)", () => {
    expectTypeOf<SnapshotStore["capture"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SnapshotStore["capture"]>().returns.toEqualTypeOf<string | null>();
  });

  it("(type) restore(beforeRef, opts) returns RestoreResult (sync — GOTCHA #1)", () => {
    expectTypeOf<SnapshotStore["restore"]>().parameters.toEqualTypeOf<[string, RestoreOpts]>();
    expectTypeOf<SnapshotStore["restore"]>().returns.toEqualTypeOf<RestoreResult>();
  });

  it("(type) describe() returns { backend: 'git'|'cas'|'none'; reason?: string } (3-valued — GOTCHA #6)", () => {
    expectTypeOf<SnapshotStore["describe"]>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<SnapshotStore["describe"]>().returns.toEqualTypeOf<{
      backend: "git" | "cas" | "none";
      reason?: string;
    }>();
  });

  it("(type) dirtyCheck(afterRef, paths) returns string[] (sync)", () => {
    expectTypeOf<SnapshotStore["dirtyCheck"]>().parameters.toEqualTypeOf<[string, string[]]>();
    expectTypeOf<SnapshotStore["dirtyCheck"]>().returns.toEqualTypeOf<string[]>();
  });

  it("(type) has(ref) returns boolean; retire(ref) returns void (sync)", () => {
    expectTypeOf<SnapshotStore["has"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SnapshotStore["has"]>().returns.toEqualTypeOf<boolean>();
    expectTypeOf<SnapshotStore["retire"]>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<SnapshotStore["retire"]>().returns.toEqualTypeOf<void>();
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