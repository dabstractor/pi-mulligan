import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  getRuntime,
  nextSeq,
  resetRuntime,
  clearAll,
  type SessionRuntime,
  type BloatHit,
  type AgentMessage,
} from "../src/runtime.js";
import { type RevertCheckpoint } from "../src/markers.js";

// GOTCHA #7: the runtime Map is module-scoped and is NOT reset between tests. Clear it before AND after each
// test so a previous test's session state can't leak in (or out).
beforeEach(() => {
  clearAll();
});

afterEach(() => {
  clearAll();
});

describe("fresh runtime defaults (spec/04 §8 + spec/06 §7)", () => {
  it("getRuntime creates a runtime with the exact default shape on first access", () => {
    const rt = getRuntime("s1");
    expect(rt).toEqual({
      sessionId: "s1",
      seq: 0,
      tokenBaseline: null,
      lastTurnIndex: null,
      lastFiltered: null,
      lastFilterTs: null,
      pendingBloatHits: [],
      shrinkMissCounts: new Map(),
      aboveHighWater: false,
      rewindRefusedTurnIndex: null,
      snapshots: new Map(),
      captureArmed: true, // VALIDATION-FIX #2 — armed so turn_start (no prior agent_start) captures
      pendingExplicitPaths: [], // P1.M3.T1.S1 / BUG-003
    });
  });

  it("getRuntime is idempotent: the same sessionId returns the SAME live reference (GOTCHA #3)", () => {
    const a = getRuntime("s1");
    const b = getRuntime("s1");
    expect(a).toBe(b); // reference equality — callers mutate the shared object
  });

  it("each fresh runtime gets its OWN pendingBloatHits array — no cross-session sharing (GOTCHA #5)", () => {
    const a = getRuntime("s1");
    const b = getRuntime("s2");
    expect(a.pendingBloatHits).not.toBe(b.pendingBloatHits);
    a.pendingBloatHits.push({ toolName: "read", approxTokens: 9000 });
    expect(b.pendingBloatHits).toHaveLength(0); // b unaffected
  });

  it("each fresh runtime gets its OWN shrinkMissCounts Map — no cross-session sharing (GOTCHA #5)", () => {
    const a = getRuntime("s1");
    const b = getRuntime("s2");
    expect(a.shrinkMissCounts).not.toBe(b.shrinkMissCounts);
    a.shrinkMissCounts.set("shrink-1", 1);
    expect(b.shrinkMissCounts.get("shrink-1")).toBeUndefined(); // b unaffected
  });

  it("each fresh runtime gets its OWN pendingExplicitPaths array — no cross-session sharing (P1.M3.T1.S1 / GOTCHA #5)", () => {
    const a = getRuntime("s1");
    const b = getRuntime("s2");
    expect(a.pendingExplicitPaths).not.toBe(b.pendingExplicitPaths);
    a.pendingExplicitPaths!.push("src/a.ts");
    expect(b.pendingExplicitPaths).toHaveLength(0); // b unaffected
  });

  it("rewindRefusedTurnIndex is mutable and isolated per session (P4.M1.T2.S3)", () => {
    const a = getRuntime("A");
    const b = getRuntime("B");
    a.rewindRefusedTurnIndex = 7;
    expect(a.rewindRefusedTurnIndex).toBe(7);
    expect(b.rewindRefusedTurnIndex).toBeNull(); // B untouched
    expect(getRuntime("A").rewindRefusedTurnIndex).toBe(7); // live ref reflects the write
  });

  it("fresh runtime gets its OWN empty snapshots Map; reset clears it (GOTCHA #5; spec/14 §2)", () => {
    const a = getRuntime("s1");
    expect(a.snapshots).toBeInstanceOf(Map);
    expect(a.snapshots!.size).toBe(0);
    a.snapshots!.set("turn", { label: "turn", backend: "git", beforeRef: "r1", turnIndex: 0, ts: 1 });
    expect(a.snapshots!.size).toBe(1);
    // different session → its own Map (no leak)
    const b = getRuntime("s2");
    expect(b.snapshots!.size).toBe(0);
    expect(b.snapshots).not.toBe(a.snapshots);
    // reset wipes the session's runtime; next getRuntime is fresh
    resetRuntime("s1");
    expect(getRuntime("s1").snapshots!.size).toBe(0);
  });
});

describe("nextSeq — monotonic per-session marker counter (GOTCHA #4)", () => {
  it("first call returns 1 (pre-increment from the fresh seq 0 baseline)", () => {
    expect(nextSeq("s1")).toBe(1);
  });

  it("increments monotonically: 1, 2, 3, …", () => {
    expect(nextSeq("s1")).toBe(1);
    expect(nextSeq("s1")).toBe(2);
    expect(nextSeq("s1")).toBe(3);
  });

  it("persists the incremented seq on the live runtime (read back via getRuntime)", () => {
    nextSeq("s1");
    nextSeq("s1");
    expect(getRuntime("s1").seq).toBe(2);
  });
});

describe("session isolation (independent runtimes per sessionId — GOTCHA #8)", () => {
  it("nextSeq is isolated per session — A's increments never affect B", () => {
    expect(nextSeq("A")).toBe(1);
    expect(nextSeq("A")).toBe(2);
    expect(nextSeq("B")).toBe(1); // B starts fresh at 1
    expect(nextSeq("A")).toBe(3); // A continues its own sequence
    expect(nextSeq("B")).toBe(2);
  });

  it("mutating one session's fields never touches another", () => {
    const a = getRuntime("A");
    const b = getRuntime("B");
    a.tokenBaseline = 12345;
    a.lastTurnIndex = 7;
    a.lastFiltered = [{ role: "user", content: "hi" }];
    a.lastFilterTs = 9_999;
    expect(b.tokenBaseline).toBeNull();
    expect(b.lastTurnIndex).toBeNull();
    expect(b.lastFiltered).toBeNull();
    expect(b.lastFilterTs).toBeNull();
  });

  it("getRuntime returns distinct objects for distinct ids", () => {
    expect(getRuntime("A")).not.toBe(getRuntime("B"));
  });
});

describe("resetRuntime — session_start re-initialization (GOTCHA #6)", () => {
  it("clears the entry so the next getRuntime returns a FRESH runtime", () => {
    nextSeq("s1");
    nextSeq("s1");
    getRuntime("s1").tokenBaseline = 999;
    resetRuntime("s1");
    const rt = getRuntime("s1");
    expect(rt.seq).toBe(0);
    expect(rt.tokenBaseline).toBeNull();
    expect(rt).toEqual({
      sessionId: "s1",
      seq: 0,
      tokenBaseline: null,
      lastTurnIndex: null,
      lastFiltered: null,
      lastFilterTs: null,
      pendingBloatHits: [],
      shrinkMissCounts: new Map(),
      aboveHighWater: false,
      rewindRefusedTurnIndex: null,
      snapshots: new Map(),
      captureArmed: true, // VALIDATION-FIX #2 — armed so turn_start (no prior agent_start) captures
      pendingExplicitPaths: [], // P1.M3.T1.S1 / BUG-003
    });
  });

  it("returns a NEW reference after reset (stale references are abandoned — C12 discipline)", () => {
    const before = getRuntime("s1");
    resetRuntime("s1");
    const after = getRuntime("s1");
    expect(after).not.toBe(before);
  });

  it("is a no-op (never throws) for a session that had no runtime", () => {
    expect(() => resetRuntime("never-existed")).not.toThrow();
  });

  it("does not affect OTHER sessions' runtimes", () => {
    nextSeq("A");
    nextSeq("B");
    resetRuntime("A");
    expect(getRuntime("B").seq).toBe(1); // B untouched (one nextSeq("B") call → seq 1)
    expect(getRuntime("A").seq).toBe(0); // A reset to fresh
  });

  it("nextSeq restarts at 1 after a reset (seq is per-session-runtime, not global)", () => {
    expect(nextSeq("s1")).toBe(1);
    expect(nextSeq("s1")).toBe(2);
    resetRuntime("s1");
    expect(nextSeq("s1")).toBe(1);
  });

  it("shrinkMissCounts is a fresh empty Map after resetRuntime", () => {
    const a = getRuntime("s1");
    a.shrinkMissCounts.set("shrink-1", 2);
    resetRuntime("s1");
    const fresh = getRuntime("s1");
    expect(fresh.shrinkMissCounts).not.toBe(a.shrinkMissCounts); // new Map instance (C12: stale ref abandoned)
    expect(fresh.shrinkMissCounts.size).toBe(0);
  });

  it("aboveHighWater resets to false after resetRuntime", () => {
    const a = getRuntime("s1");
    a.aboveHighWater = true;
    resetRuntime("s1");
    const fresh = getRuntime("s1");
    expect(fresh.aboveHighWater).toBe(false); // entry was deleted → fresh runtime → default false
    expect(fresh).not.toBe(a); // new reference (C12: stale ref abandoned) — same as the shrinkMissCounts test
  });
});

describe("clearAll — shutdown cleanup", () => {
  it("wipes every session's runtime", () => {
    nextSeq("A");
    nextSeq("B");
    getRuntime("A").tokenBaseline = 5;
    clearAll();
    // every session is now fresh again:
    expect(getRuntime("A").seq).toBe(0);
    expect(getRuntime("B").seq).toBe(0);
    expect(getRuntime("A").tokenBaseline).toBeNull();
  });

  it("is a no-op (never throws) when the map is already empty", () => {
    expect(() => clearAll()).not.toThrow();
  });

  it("clearAll wipes shrinkMissCounts for all sessions", () => {
    getRuntime("A").shrinkMissCounts.set("s", 3);
    clearAll();
    expect(getRuntime("A").shrinkMissCounts.size).toBe(0);
  });

  it("clearAll resets aboveHighWater for all sessions", () => {
    getRuntime("A").aboveHighWater = true;
    clearAll();
    expect(getRuntime("A").aboveHighWater).toBe(false); // map wiped → fresh runtime → default false
  });
});

describe("in-place mutation contract (consumers mutate the live object)", () => {
  it("filter.ts-style writes to lastFiltered/lastFilterTs persist and are read back via getRuntime", () => {
    const rt = getRuntime("s1");
    const msgs: AgentMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [] },
    ];
    rt.lastFiltered = msgs;
    rt.lastFilterTs = 1234;
    expect(getRuntime("s1").lastFiltered).toBe(msgs); // same array reference (no defensive copy)
    expect(getRuntime("s1").lastFilterTs).toBe(1234);
  });

  it("nudges.ts-style pushes to pendingBloatHits accumulate, then turn_end clears them", () => {
    const hit: BloatHit = { toolName: "bash", approxTokens: 12000 };
    getRuntime("s1").pendingBloatHits.push(hit);
    expect(getRuntime("s1").pendingBloatHits).toEqual([hit]);
    getRuntime("s1").pendingBloatHits.length = 0; // turn_end clears the array
    expect(getRuntime("s1").pendingBloatHits).toEqual([]);
  });

  it("turn_end-style writes to tokenBaseline/lastTurnIndex persist", () => {
    const rt = getRuntime("s1");
    rt.tokenBaseline = 2048;
    rt.lastTurnIndex = 3;
    expect(getRuntime("s1").tokenBaseline).toBe(2048);
    expect(getRuntime("s1").lastTurnIndex).toBe(3);
  });

  it("filter.ts-style set/get/delete on shrinkMissCounts persists and is read back via getRuntime", () => {
    // Documents the P3.M2.T3 consumption contract: increment on miss, delete on hit/retire.
    getRuntime("s1").shrinkMissCounts.set("shrink-7", 1);
    expect(getRuntime("s1").shrinkMissCounts.get("shrink-7")).toBe(1);
    getRuntime("s1").shrinkMissCounts.set("shrink-7", 2); // consecutive miss increment
    expect(getRuntime("s1").shrinkMissCounts.get("shrink-7")).toBe(2);
    getRuntime("s1").shrinkMissCounts.delete("shrink-7"); // hit/retire resets
    expect(getRuntime("s1").shrinkMissCounts.has("shrink-7")).toBe(false);
  });

  it("shouldHighWater-style set of aboveHighWater persists across getRuntime calls (edge latches, not per-turn)", () => {
    // Documents the P3.M3.T5.S1 consumption contract: set true on rising edge, persists until cleared.
    const rt = getRuntime("s1");
    expect(rt.aboveHighWater).toBe(false); // fresh default
    rt.aboveHighWater = true; // shouldHighWater sets it on the rising edge
    expect(getRuntime("s1").aboveHighWater).toBe(true); // persists (same live reference)
  });
});

describe("types", () => {
  it("exports SessionRuntime / BloatHit / AgentMessage with the correct field types", () => {
    const rt: SessionRuntime = {} as SessionRuntime;
    expectTypeOf(rt.sessionId).toEqualTypeOf<string>();
    expectTypeOf(rt.seq).toEqualTypeOf<number>();
    expectTypeOf(rt.tokenBaseline).toEqualTypeOf<number | null>();
    expectTypeOf(rt.lastTurnIndex).toEqualTypeOf<number | null>();
    expectTypeOf(rt.lastFiltered).toEqualTypeOf<AgentMessage[] | null>();
    expectTypeOf(rt.lastFilterTs).toEqualTypeOf<number | null>();
    expectTypeOf(rt.pendingBloatHits).toEqualTypeOf<BloatHit[]>();
    expectTypeOf(rt.shrinkMissCounts).toEqualTypeOf<Map<string, number>>();
    expectTypeOf(rt.aboveHighWater).toEqualTypeOf<boolean>();
    expectTypeOf(rt.pendingExplicitPaths).toEqualTypeOf<string[] | undefined>(); // P1.M3.T1.S1 / BUG-003
    expectTypeOf<BloatHit>().toEqualTypeOf<{ toolName: string; approxTokens: number }>();
  });

  it("SessionRuntime.snapshots is Map<string, RevertCheckpoint> | undefined (spec/14 §2, spec/04 §8)", () => {
    const rt = {} as SessionRuntime;
    expectTypeOf(rt.snapshots).toEqualTypeOf<Map<string, RevertCheckpoint> | undefined>();
  });
});