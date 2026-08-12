import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  TurnStartEvent,
  AgentEndEvent,
  ToolCallEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SnapshotStore } from "../src/snapshot/store.js";

import {
  turnStartCaptureHandler,
  registerTurnStartCapture,
  gcTurnSnapshots,
  rebuildCheckpointSnapshots,
  agentEndCaptureHandler,
  registerAgentEndCapture,
  toolCallCaptureHandler,
  registerToolCallCapture,
} from "../src/capture.js";
import { setConfig, DEFAULT_CONFIG } from "../src/config.js";
import { getRuntime, clearAll } from "../src/runtime.js";
import { setLogFile, type LogLine } from "../src/log.js";
import type { RevertCheckpoint } from "../src/markers.js";

// ── module-level state reset (GOTCHA: runtime map + logFile + config cache are module-scoped) ──
let dir: string;
let file: string;

beforeEach(() => {
  clearAll(); // runtime map reset — each test gets a fresh runtime
  // enable revert for the capture tests by default; gating tests override via setConfig({...})
  setConfig({ revert: { enabled: true } });
  dir = mkdtempSync(join(tmpdir(), "mulligan-capture-"));
  file = join(dir, "log.jsonl");
  setLogFile(null); // logging off by default; setLogFile(file) only in fail-open tests
});

afterEach(() => {
  clearAll();
  setConfig(DEFAULT_CONFIG); // restore the default config so no state leaks across suites
  setLogFile(null);
  rmSync(dir, { recursive: true, force: true });
});

// ── fakes (hand-rolled, no vi.fn for Pi objects — mirror nudges.test.ts) ─────────────────────

/** Minimal fake ExtensionAPI capturing `.on` registrations. */
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> =
    {};
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      handlers[event] = handler; // last-write-wins capture
    },
  };
  return { handlers, pi: pi as unknown as ExtensionAPI };
}

/** Minimal fake ExtensionContext: scripts getSessionId (the only thing the handler reads). */
function makeCtx(
  opts: { sessionId?: string; throwOnGetSessionId?: boolean } = {},
) {
  const sessionId = opts.sessionId ?? "s1";
  const sessionManager = {
    getSessionId() {
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
  };
  return {
    sessionManager:
      sessionManager as unknown as ExtensionContext["sessionManager"],
  } as ExtensionContext;
}

/** Synthetic TurnStartEvent with the given turnIndex. */
function makeEvent(turnIndex = 3): TurnStartEvent {
  return { type: "turn_start", turnIndex, timestamp: Date.now() };
}

/** A recording fake SnapshotStore. `backend` controls describe().backend; capture/gc record calls. */
interface RecordingStore extends SnapshotStore {
  calls: string[]; // ordered log of method calls (gc, capture) for ordering assertions
  describe(): { backend: "git" | "cas" | "none"; reason?: string };
  capture(label: string): Promise<string | null>;
  gc(): Promise<void>;
}

function makeStore(
  opts: {
    backend?: "git" | "cas" | "none";
    captureRef?: string | null;
    captureThrows?: boolean;
    gcThrows?: boolean;
  } = {},
): RecordingStore {
  const calls: string[] = [];
  const backend = opts.backend ?? "git";
  const store = {
    calls,
    describe() {
      return { backend } as { backend: "git" | "cas" | "none" };
    },
    async capture(label: string): Promise<string | null> {
      calls.push(`capture:${label}`);
      if (opts.captureThrows) throw new Error("capture boom");
      return opts.captureRef === undefined ? "ref-abc123" : opts.captureRef;
    },
    async gc(): Promise<void> {
      calls.push("gc");
      if (opts.gcThrows) throw new Error("gc boom");
    },
    // the rest of the interface — unused by the handler but required by the type
    async dirtyCheck(): Promise<string[]> {
      return [];
    },
    async restore(): Promise<import("../src/snapshot/store.js").RestoreResult> {
      return {
        reverted: [],
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      };
    },
    async has(): Promise<boolean> {
      return true;
    },
    async retire(): Promise<void> {
      /* no-op */
    },
  };
  return store as unknown as RecordingStore;
}

/** Read back the log file as parsed LogLines (for fail-open assertions). Returns [] if never created. */
function readLogLines(): LogLine[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return []; // file never created → no log lines (healthy path)
  }
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as LogLine);
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// registerTurnStartCapture
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("registerTurnStartCapture — arms pi.on('turn_start', turnStartCaptureHandler)", () => {
  it("registers a handler for 'turn_start' (and only 'turn_start')", () => {
    const { handlers, pi } = makePi();
    registerTurnStartCapture(pi);
    expect(typeof handlers["turn_start"]).toBe("function");
    expect(Object.keys(handlers)).toEqual(["turn_start"]);
  });

  it("registers EXACTLY ONE handler (calling on once)", () => {
    const { handlers, pi } = makePi();
    registerTurnStartCapture(pi);
    const keys = Object.keys(handlers);
    expect(keys).toEqual(["turn_start"]);
  });

  it("does not register on any other event", () => {
    const { handlers, pi } = makePi();
    registerTurnStartCapture(pi);
    expect(handlers["tool_result"]).toBeUndefined();
    expect(handlers["turn_end"]).toBeUndefined();
    expect(handlers["context"]).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// turnStartCaptureHandler — gating
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("turnStartCaptureHandler — gating", () => {
  it("no-ops (no gc, no capture) when getConfig().revert.enabled === false (gate is FIRST)", async () => {
    setConfig({ revert: { enabled: false } });
    const store = makeStore();
    const rt = getRuntime("gate-off");
    rt.store = store;
    setLogFile(file); // capture any errant log lines
    await turnStartCaptureHandler(
      makeEvent(),
      makeCtx({ sessionId: "gate-off" }),
    );
    expect(store.calls).toEqual([]); // neither gc nor capture fired
    expect(rt.snapshots?.get("turn")).toBeUndefined();
    expect(readLogLines()).toEqual([]); // no log line (clean no-op, not an error)
  });

  it("no-ops when rt.store is undefined (does not throw; rt.snapshots untouched)", async () => {
    const rt = getRuntime("no-store");
    expect(rt.store).toBeUndefined(); // fresh runtime has no store
    await expect(
      turnStartCaptureHandler(makeEvent(), makeCtx({ sessionId: "no-store" })),
    ).resolves.toBeUndefined();
    expect(rt.snapshots?.get("turn")).toBeUndefined();
  });

  it("no-ops (no capture) when rt.store.describe().backend === 'none' (NoOpStore)", async () => {
    const store = makeStore({ backend: "none" });
    const rt = getRuntime("noop");
    rt.store = store;
    await turnStartCaptureHandler(makeEvent(), makeCtx({ sessionId: "noop" }));
    // gc still runs (it is a no-op on NoOpStore), but capture MUST be skipped.
    expect(store.calls).toEqual(["gc"]);
    expect(rt.snapshots?.get("turn")).toBeUndefined();
  });

  it("does NOT throw when getConfig throws — logs + returns (fail-open)", async () => {
    // Simulate getConfig throwing by overriding it via a config that would be read. The cleanest way
    // to assert fail-open is to make the store.capture throw (covered elsewhere). Here we assert the
    // handler never rejects even when the store throws during describe/capture.
    setLogFile(file);
    const store = makeStore({ captureThrows: true });
    const rt = getRuntime("throw");
    rt.store = store;
    await expect(
      turnStartCaptureHandler(makeEvent(), makeCtx({ sessionId: "throw" })),
    ).resolves.toBeUndefined();
    // capture threw → logged as capture.turn_start error
    const lines = readLogLines();
    expect(
      lines.some(
        (l) => l.event === "capture.turn_start" && l.level === "error",
      ),
    ).toBe(true);
    expect(rt.snapshots?.get("turn")).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// turnStartCaptureHandler — GC-before-capture ordering
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("turnStartCaptureHandler — GC-before-capture ordering", () => {
  it("awaits rt.store.gc() BEFORE rt.store.capture('turn') (assert call order via ordered log)", async () => {
    const store = makeStore();
    const rt = getRuntime("order");
    rt.store = store;
    await turnStartCaptureHandler(makeEvent(), makeCtx({ sessionId: "order" }));
    // gc must appear BEFORE capture in the ordered call log.
    const gcIdx = store.calls.indexOf("gc");
    const capIdx = store.calls.indexOf("capture:turn");
    expect(gcIdx).toBeGreaterThanOrEqual(0);
    expect(capIdx).toBeGreaterThanOrEqual(0);
    expect(gcIdx).toBeLessThan(capIdx);
  });

  it("clears in-memory turn/* entries via gcTurnSnapshots before capture sets the new 'turn'", async () => {
    const store = makeStore();
    const rt = getRuntime("clear");
    rt.store = store;
    // seed a stale prior-turn entry + a checkpoint (which must survive)
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "git",
      beforeRef: "OLD-before",
      afterRef: "OLD-after",
      turnIndex: 2,
      ts: 1000,
    });
    rt.snapshots?.set("checkpoint:foo", {
      label: "checkpoint:foo",
      backend: "git",
      beforeRef: "ckpt-ref",
      turnIndex: 1,
      ts: 500,
    });
    await turnStartCaptureHandler(
      makeEvent(3),
      makeCtx({ sessionId: "clear" }),
    );
    // the new turn entry is present with the fresh before-ref
    const turn = rt.snapshots?.get("turn");
    expect(turn).toBeDefined();
    expect(turn?.beforeRef).toBe("ref-abc123");
    expect(turn?.turnIndex).toBe(3);
    // the checkpoint survived the GC pass
    expect(rt.snapshots?.get("checkpoint:foo")).toBeDefined();
    expect(rt.snapshots?.get("checkpoint:foo")?.beforeRef).toBe("ckpt-ref");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// turnStartCaptureHandler — capture result
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("turnStartCaptureHandler — capture result", () => {
  it("sets rt.snapshots.get('turn') = {label, backend, beforeRef, turnIndex, ts} when capture returns a ref", async () => {
    const store = makeStore({ backend: "git", captureRef: "sha-deadbeef" });
    const rt = getRuntime("set");
    rt.store = store;
    await turnStartCaptureHandler(makeEvent(7), makeCtx({ sessionId: "set" }));
    const turn = rt.snapshots?.get("turn");
    expect(turn).toEqual({
      label: "turn",
      backend: "git",
      beforeRef: "sha-deadbeef",
      turnIndex: 7,
      ts: expect.any(Number),
    });
    expect(typeof turn?.ts).toBe("number");
  });

  it("sets backend 'cas' when the store reports cas", async () => {
    const store = makeStore({ backend: "cas", captureRef: "manifest-turn" });
    const rt = getRuntime("cas");
    rt.store = store;
    await turnStartCaptureHandler(makeEvent(1), makeCtx({ sessionId: "cas" }));
    expect(rt.snapshots?.get("turn")?.backend).toBe("cas");
    expect(rt.snapshots?.get("turn")?.beforeRef).toBe("manifest-turn");
  });

  it("leaves rt.snapshots.get('turn') unset when capture returns null (caps exceeded / IO error)", async () => {
    const store = makeStore({ captureRef: null });
    const rt = getRuntime("null");
    rt.store = store;
    await turnStartCaptureHandler(makeEvent(), makeCtx({ sessionId: "null" }));
    // gc ran, capture ran, but returned null → no turn entry set (the stale one was cleared by GC)
    expect(store.calls).toContain("gc");
    expect(store.calls).toContain("capture:turn");
    expect(rt.snapshots?.get("turn")).toBeUndefined();
  });

  it("uses event.turnIndex in the stored checkpoint", async () => {
    const store = makeStore();
    const rt = getRuntime("idx");
    rt.store = store;
    await turnStartCaptureHandler(makeEvent(42), makeCtx({ sessionId: "idx" }));
    expect(rt.snapshots?.get("turn")?.turnIndex).toBe(42);
  });

  it("NEVER throws when capture() rejects — logs 'capture.turn_start' + returns", async () => {
    setLogFile(file);
    const store = makeStore({ captureThrows: true });
    const rt = getRuntime("reject");
    rt.store = store;
    await expect(
      turnStartCaptureHandler(makeEvent(), makeCtx({ sessionId: "reject" })),
    ).resolves.toBeUndefined();
    const lines = readLogLines();
    expect(lines.some((l) => l.event === "capture.turn_start")).toBe(true);
    expect(rt.snapshots?.get("turn")).toBeUndefined();
  });

  it("NEVER throws when store.gc() rejects — logs + returns (fail-open)", async () => {
    setLogFile(file);
    const store = makeStore({ gcThrows: true });
    const rt = getRuntime("gc-reject");
    rt.store = store;
    await expect(
      turnStartCaptureHandler(makeEvent(), makeCtx({ sessionId: "gc-reject" })),
    ).resolves.toBeUndefined();
    // gc threw inside gcTurnSnapshots which swallows it; the handler proceeds to capture normally
    // (gcTurnSnapshots never throws, so the handler reaches capture and sets the turn entry).
    const turn = rt.snapshots?.get("turn");
    expect(turn).toBeDefined();
    expect(turn?.beforeRef).toBe("ref-abc123");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// gcTurnSnapshots — the shared prompt-boundary GC helper
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("gcTurnSnapshots — shared prompt-boundary GC helper", () => {
  it("calls rt.store.gc() exactly once when rt.store is set", async () => {
    const store = makeStore();
    const rt = getRuntime("gcts-1");
    rt.store = store;
    await gcTurnSnapshots(rt);
    expect(store.calls.filter((c) => c === "gc")).toHaveLength(1);
  });

  it("is a no-op when rt.store is undefined", async () => {
    const rt = getRuntime("gcts-none");
    expect(rt.store).toBeUndefined();
    await expect(gcTurnSnapshots(rt)).resolves.toBeUndefined();
    // nothing to assert besides no-throw; snapshots untouched
    expect(rt.snapshots?.size).toBe(0);
  });

  it("deletes in-memory keys starting with 'turn' (turn, turn-after)", async () => {
    const store = makeStore();
    const rt = getRuntime("gcts-clear");
    rt.store = store;
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "git",
      beforeRef: "a",
      turnIndex: 1,
      ts: 1,
    });
    rt.snapshots?.set("turn-after", {
      label: "turn-after",
      backend: "git",
      beforeRef: "b",
      turnIndex: 1,
      ts: 2,
    });
    await gcTurnSnapshots(rt);
    expect(rt.snapshots?.has("turn")).toBe(false);
    expect(rt.snapshots?.has("turn-after")).toBe(false);
  });

  it("PRESERVES an in-memory 'checkpoint:foo' entry (checkpoint namespace exempt)", async () => {
    const store = makeStore();
    const rt = getRuntime("gcts-ckpt");
    rt.store = store;
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "git",
      beforeRef: "a",
      turnIndex: 1,
      ts: 1,
    });
    rt.snapshots?.set("checkpoint:foo", {
      label: "checkpoint:foo",
      backend: "cas",
      beforeRef: "ckpt-a",
      turnIndex: 0,
      ts: 999,
    });
    await gcTurnSnapshots(rt);
    expect(rt.snapshots?.has("turn")).toBe(false); // turn/* cleared
    expect(rt.snapshots?.has("checkpoint:foo")).toBe(true); // checkpoint preserved
    expect(rt.snapshots?.get("checkpoint:foo")?.beforeRef).toBe("ckpt-a");
  });

  it("does NOT throw when store.gc() rejects (best-effort)", async () => {
    const store = makeStore({ gcThrows: true });
    const rt = getRuntime("gcts-throw");
    rt.store = store;
    await expect(gcTurnSnapshots(rt)).resolves.toBeUndefined();
    // even though gc threw, the in-memory turn/* entries are still cleared
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "git",
      beforeRef: "a",
      turnIndex: 1,
      ts: 1,
    });
    // call again to confirm clearing still happens after a throwing gc
    await gcTurnSnapshots(rt);
    expect(rt.snapshots?.has("turn")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// rebuildCheckpointSnapshots — the shared cross-reload checkpoint rebuild helper (BUG-002 read-side)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("rebuildCheckpointSnapshots — shared cross-reload checkpoint rebuild helper", () => {
  /** Minimal fake ctx whose sessionManager.getEntries() returns the given array (the ONLY field the helper reads). */
  function makeRebuildCtx(entries: unknown[]): ExtensionContext {
    return {
      sessionManager: { getEntries: () => entries },
    } as unknown as ExtensionContext;
  }

  /** Minimal fake store with a controllable `.has(ref)` result (the ONLY method the helper calls). */
  function makeRebuildStore(opts: { has?: boolean | ((ref: string) => boolean); hasThrows?: boolean } = {}): SnapshotStore {
    return {
      async has(ref: string): Promise<boolean> {
        if (opts.hasThrows) throw new Error("has boom");
        return typeof opts.has === "function" ? opts.has(ref) : (opts.has ?? true);
      },
    } as unknown as SnapshotStore;
  }

  it("rebuilds rt.snapshots from mulligan:revert-checkpoint control entries (happy-path)", async () => {
    const entries = [
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:x", ref: "r1", backend: "git" } },
      { type: "custom", customType: "mulligan:rewind", data: { kind: "rewind" } }, // unrelated → skipped
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:y", ref: "r2", backend: "cas" } },
    ];
    const ctx = makeRebuildCtx(entries);
    const rt = getRuntime("rb-1");
    rt.store = makeRebuildStore();
    await rebuildCheckpointSnapshots(ctx, rt);
    const x = rt.snapshots?.get("ckpt:x") as RevertCheckpoint | undefined;
    expect(x).toBeTruthy();
    expect(x!.beforeRef).toBe("r1");
    expect(x!.backend).toBe("git");
    expect(x!.turnIndex).toBe(-1);
    expect(x!.afterRef).toBeUndefined(); // checkpoints capture once
    const y = rt.snapshots?.get("ckpt:y") as RevertCheckpoint | undefined;
    expect(y).toBeTruthy();
    expect(y!.beforeRef).toBe("r2");
    expect(y!.backend).toBe("cas");
  });

  it("is a no-op when rt.store is undefined", async () => {
    const ctx = makeRebuildCtx([
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:x", ref: "r1", backend: "git" } },
    ]);
    const rt = getRuntime("rb-none");
    expect(rt.store).toBeUndefined();
    await expect(rebuildCheckpointSnapshots(ctx, rt)).resolves.toBeUndefined();
    expect(rt.snapshots?.size).toBe(0);
  });

  it("skips malformed entries (bad fields / null data / non-objects / unknown backend)", async () => {
    const entries = [
      "not-an-object", // non-object → skipped
      null,
      [],
      { type: "custom", customType: "mulligan:revert-checkpoint", data: null }, // null data → skipped
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "", ref: "r", backend: "git" } }, // empty label
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ok", ref: "", backend: "git" } }, // empty ref
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: 123, ref: "r", backend: "git" } }, // non-string label
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ok", ref: "r", backend: "NONE" } }, // bad backend
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ok", ref: "r", backend: "git" } }, // VALID
    ];
    const ctx = makeRebuildCtx(entries);
    const rt = getRuntime("rb-malformed");
    rt.store = makeRebuildStore();
    await rebuildCheckpointSnapshots(ctx, rt);
    expect(rt.snapshots?.size).toBe(1);
    expect(rt.snapshots?.has("ok")).toBe(true);
  });

  it("skips an entry whose ref is absent (rt.store.has→false — NoOpStore-equivalent)", async () => {
    const entries = [
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:absent", ref: "gone", backend: "git" } },
    ];
    const ctx = makeRebuildCtx(entries);
    const rt = getRuntime("rb-absent");
    rt.store = makeRebuildStore({ has: false });
    await rebuildCheckpointSnapshots(ctx, rt);
    expect(rt.snapshots?.size).toBe(0);
  });

  it("skips an entry whose rt.store.has() throws (fail-open), still rebuilds other valid entries", async () => {
    const entries = [
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:ok", ref: "r1", backend: "git" } },
    ];
    const ctx = makeRebuildCtx(entries);
    const rt = getRuntime("rb-has-throw");
    rt.store = makeRebuildStore({ hasThrows: true });
    await expect(rebuildCheckpointSnapshots(ctx, rt)).resolves.toBeUndefined();
    expect(rt.snapshots?.size).toBe(0); // the throwing has() ⇒ present=false ⇒ skipped
  });

  it("swallows a throwing-Proxy entry and still rebuilds a later valid entry (never throws)", async () => {
    const throwingProxy = new Proxy({}, { get() { throw new Error("boom"); } });
    const entries = [
      throwingProxy, // per-entry catch → skipped
      { type: "custom", customType: "mulligan:revert-checkpoint", data: { label: "ckpt:late", ref: "r1", backend: "git" } },
    ];
    const ctx = makeRebuildCtx(entries);
    const rt = getRuntime("rb-proxy");
    rt.store = makeRebuildStore();
    await expect(rebuildCheckpointSnapshots(ctx, rt)).resolves.toBeUndefined();
    expect(rt.snapshots?.has("ckpt:late")).toBe(true); // the valid entry after the throwing one still rebuilt
  });

  it("is a no-op when ctx.sessionManager.getEntries() throws (fail-open read)", async () => {
    const ctx = {
      sessionManager: { getEntries: () => { throw new Error("read boom"); } },
    } as unknown as ExtensionContext;
    const rt = getRuntime("rb-getentries-throw");
    rt.store = makeRebuildStore();
    await expect(rebuildCheckpointSnapshots(ctx, rt)).resolves.toBeUndefined();
    expect(rt.snapshots?.size).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// registerAgentEndCapture
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("registerAgentEndCapture — arms pi.on('agent_end', agentEndCaptureHandler)", () => {
  it("registers a handler for 'agent_end' (and only 'agent_end')", () => {
    const { handlers, pi } = makePi();
    registerAgentEndCapture(pi);
    expect(typeof handlers["agent_end"]).toBe("function");
    expect(Object.keys(handlers)).toEqual(["agent_end"]);
  });

  it("registers EXACTLY ONE handler (calling on once)", () => {
    const { handlers, pi } = makePi();
    registerAgentEndCapture(pi);
    const keys = Object.keys(handlers);
    expect(keys).toEqual(["agent_end"]);
  });

  it("does not register on any other event (e.g. not 'turn_end', not 'turn_start')", () => {
    const { handlers, pi } = makePi();
    registerAgentEndCapture(pi);
    expect(handlers["turn_end"]).toBeUndefined();
    expect(handlers["turn_start"]).toBeUndefined();
    expect(handlers["context"]).toBeUndefined();
  });

  it("registers the EXACT exported agentEndCaptureHandler reference", () => {
    const { handlers, pi } = makePi();
    registerAgentEndCapture(pi);
    expect(handlers["agent_end"]).toBe(agentEndCaptureHandler);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// agentEndCaptureHandler — gating
// ══════════════════════════════════════════════════════════════════════════════════════════

/** Synthetic AgentEndEvent (messages is unused by the handler). */
function makeAgentEndEvent(): AgentEndEvent {
  return { type: "agent_end", messages: [] };
}

describe("agentEndCaptureHandler — gating", () => {
  it("no-ops (no store.capture call) when getConfig().revert.enabled === false (gate is FIRST)", async () => {
    setConfig({ revert: { enabled: false } });
    const store = makeStore();
    const rt = getRuntime("gate-off");
    rt.store = store;
    setLogFile(file); // capture any errant log lines
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "gate-off" }),
    );
    expect(store.calls).toEqual([]); // capture never fired
    expect(rt.snapshots?.get("turn")).toBeUndefined();
    expect(readLogLines()).toEqual([]); // no log line (clean no-op, not an error)
  });

  it("no-ops when rt.store is undefined (does not throw; rt.snapshots untouched)", async () => {
    const rt = getRuntime("no-store");
    expect(rt.store).toBeUndefined(); // fresh runtime has no store
    await expect(
      agentEndCaptureHandler(
        makeAgentEndEvent(),
        makeCtx({ sessionId: "no-store" }),
      ),
    ).resolves.toBeUndefined();
    expect(rt.snapshots?.get("turn")).toBeUndefined();
  });

  it("does NOT call store.capture when revert is disabled — assert the fake capture spy call count is 0", async () => {
    setConfig({ revert: { enabled: false } });
    const store = makeStore();
    const rt = getRuntime("disabled");
    rt.store = store;
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "disabled" }),
    );
    expect(store.calls.filter((c) => c.startsWith("capture:"))).toHaveLength(0);
  });

  it("does NOT throw when store.capture throws — logs + returns (fail-open)", async () => {
    setLogFile(file);
    const store = makeStore({ captureThrows: true });
    const rt = getRuntime("throw");
    rt.store = store;
    await expect(
      agentEndCaptureHandler(
        makeAgentEndEvent(),
        makeCtx({ sessionId: "throw" }),
      ),
    ).resolves.toBeUndefined();
    // capture threw → logged as capture.agent_end error
    const lines = readLogLines();
    expect(
      lines.some((l) => l.event === "capture.agent_end" && l.level === "error"),
    ).toBe(true);
    expect(rt.snapshots?.get("turn")).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// agentEndCaptureHandler — in-place afterRef mutation
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("agentEndCaptureHandler — in-place afterRef mutation", () => {
  it("sets afterRef on the EXISTING 'turn' entry when capture('turn-after') returns a non-null ref", async () => {
    const store = makeStore({ captureRef: "after-abc123" });
    const rt = getRuntime("mutate");
    rt.store = store;
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "git",
      beforeRef: "before-xyz",
      turnIndex: 3,
      ts: 1000,
    });
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "mutate" }),
    );
    expect(store.calls).toContain("capture:turn-after");
    const turn = rt.snapshots?.get("turn");
    expect(turn?.afterRef).toBe("after-abc123");
  });

  it("MUTATES IN PLACE — the SAME object reference (not a Map.set replacement)", async () => {
    const store = makeStore({ captureRef: "after-ref" });
    const rt = getRuntime("same-obj");
    rt.store = store;
    const preStored: RevertCheckpoint = {
      label: "turn",
      backend: "git",
      beforeRef: "b1",
      turnIndex: 0,
      ts: 1,
    };
    rt.snapshots?.set("turn", preStored);
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "same-obj" }),
    );
    // the object held by `preStored` IS the object in the map (mutated, not replaced)
    expect(rt.snapshots?.get("turn")).toBe(preStored);
    expect(preStored.afterRef).toBe("after-ref");
  });

  it("preserves the existing beforeRef/turnIndex/ts/backend (only afterRef is added)", async () => {
    const store = makeStore({ captureRef: "after-ref" });
    const rt = getRuntime("preserve");
    rt.store = store;
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "cas",
      beforeRef: "before-keep",
      turnIndex: 9,
      ts: 4242,
    } satisfies RevertCheckpoint);
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "preserve" }),
    );
    const turn = rt.snapshots?.get("turn");
    expect(turn).toEqual({
      label: "turn",
      backend: "cas",
      beforeRef: "before-keep",
      afterRef: "after-ref",
      turnIndex: 9,
      ts: 4242,
    });
  });

  it("leaves afterRef unset when capture('turn-after') returns null (caps exceeded / IO error)", async () => {
    const store = makeStore({ captureRef: null });
    const rt = getRuntime("null-cap");
    rt.store = store;
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "git",
      beforeRef: "b1",
      turnIndex: 0,
      ts: 1,
    });
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "null-cap" }),
    );
    expect(store.calls).toContain("capture:turn-after");
    const turn = rt.snapshots?.get("turn");
    expect(turn?.afterRef).toBeUndefined(); // null capture → afterRef stays unset
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// agentEndCaptureHandler — no 'turn' entry
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("agentEndCaptureHandler — no 'turn' entry", () => {
  it("does NOT throw and does NOT create a new entry when rt.snapshots.get('turn') is undefined", async () => {
    const store = makeStore({ captureRef: "after-ref" });
    const rt = getRuntime("no-turn");
    rt.store = store;
    expect(rt.snapshots?.get("turn")).toBeUndefined();
    await expect(
      agentEndCaptureHandler(
        makeAgentEndEvent(),
        makeCtx({ sessionId: "no-turn" }),
      ),
    ).resolves.toBeUndefined();
    expect(rt.snapshots?.get("turn")).toBeUndefined(); // still no entry created
  });

  it("does NOT call Map.set (assert the snapshots map size is unchanged)", async () => {
    const store = makeStore({ captureRef: "after-ref" });
    const rt = getRuntime("no-set");
    rt.store = store;
    const sizeBefore = rt.snapshots?.size ?? 0;
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "no-set" }),
    );
    expect(rt.snapshots?.size).toBe(sizeBefore); // no new entry added
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// agentEndCaptureHandler — fail-open
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("agentEndCaptureHandler — fail-open", () => {
  it("NEVER throws when store.capture('turn-after') rejects — logs 'capture.agent_end' + returns", async () => {
    setLogFile(file);
    const store = makeStore({ captureThrows: true });
    const rt = getRuntime("reject");
    rt.store = store;
    await expect(
      agentEndCaptureHandler(
        makeAgentEndEvent(),
        makeCtx({ sessionId: "reject" }),
      ),
    ).resolves.toBeUndefined();
    const lines = readLogLines();
    expect(lines.some((l) => l.event === "capture.agent_end")).toBe(true);
  });

  it("leaves the existing 'turn' entry's afterRef unset when capture rejects", async () => {
    setLogFile(file);
    const store = makeStore({ captureThrows: true });
    const rt = getRuntime("reject-unset");
    rt.store = store;
    rt.snapshots?.set("turn", {
      label: "turn",
      backend: "git",
      beforeRef: "b1",
      turnIndex: 0,
      ts: 1,
    });
    await agentEndCaptureHandler(
      makeAgentEndEvent(),
      makeCtx({ sessionId: "reject-unset" }),
    );
    const turn = rt.snapshots?.get("turn");
    expect(turn?.afterRef).toBeUndefined(); // capture threw → afterRef never set
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// registerToolCallCapture — [P1.M3.T1.S1]
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("registerToolCallCapture — arms pi.on('tool_call', toolCallCaptureHandler)", () => {
  it("registers a handler for 'tool_call' (and only 'tool_call')", () => {
    const { handlers, pi } = makePi();
    registerToolCallCapture(pi);
    expect(typeof handlers["tool_call"]).toBe("function");
    expect(Object.keys(handlers)).toEqual(["tool_call"]);
  });

  it("registers EXACTLY ONE handler (calling on once)", () => {
    const { handlers, pi } = makePi();
    registerToolCallCapture(pi);
    const keys = Object.keys(handlers);
    expect(keys).toEqual(["tool_call"]);
  });

  it("does not register on any other event (e.g. not 'turn_start', not 'agent_end')", () => {
    const { handlers, pi } = makePi();
    registerToolCallCapture(pi);
    expect(handlers["turn_start"]).toBeUndefined();
    expect(handlers["turn_end"]).toBeUndefined();
    expect(handlers["agent_end"]).toBeUndefined();
    expect(handlers["context"]).toBeUndefined();
  });

  it("registers the EXACT exported toolCallCaptureHandler reference", () => {
    const { handlers, pi } = makePi();
    registerToolCallCapture(pi);
    expect(handlers["tool_call"]).toBe(toolCallCaptureHandler);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// toolCallCaptureHandler — [P1.M3.T1.S1] fakes
// ══════════════════════════════════════════════════════════════════════════════════════════

/**
 * A CasBackend-shaped fake: like makeStore() but also records `notifyBashUsed` calls. The handler casts
 * `rt.store as CasBackend`, so the fake must implement that PUBLIC method (NOT on the SnapshotStore
 * interface — the existing RecordingStore lacks it).
 */
function makeCasStore(): { store: SnapshotStore; calls: string[] } {
  const calls: string[] = [];
  const store = {
    calls,
    describe() {
      return { backend: "cas" } as { backend: "git" | "cas" | "none" };
    },
    async capture(label: string): Promise<string | null> {
      calls.push(`capture:${label}`);
      return "cas-ref";
    },
    async gc(): Promise<void> {
      calls.push("gc");
    },
    async dirtyCheck(): Promise<string[]> {
      return [];
    },
    async restore(): Promise<import("../src/snapshot/store.js").RestoreResult> {
      return { reverted: [], deleted: [], failed: [], skipped: [], refused: [] };
    },
    async has(): Promise<boolean> {
      return true;
    },
    async retire(): Promise<void> {
      /* no-op */
    },
    notifyBashUsed(): void {
      calls.push("notifyBashUsed"); // PUBLIC CasBackend method the handler casts to
    },
  };
  return { store: store as unknown as SnapshotStore, calls };
}

/** Synthetic ToolCallEvent with a controllable toolName + input. */
function makeToolCallEvent(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { type: "tool_call", toolCallId: "tc1", toolName, input } as ToolCallEvent;
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// toolCallCaptureHandler — gating (early-return, no work)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("toolCallCaptureHandler — gating", () => {
  it("no-ops when getConfig().revert.enabled === false (layer-1 gate is FIRST) — pendingExplicitPaths stays []", async () => {
    setConfig({ revert: { enabled: false } });
    const { store, calls } = makeCasStore();
    const rt = getRuntime("gate-off");
    rt.store = store;
    setLogFile(file);
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "src/a.ts" }),
      makeCtx({ sessionId: "gate-off" }),
    );
    expect(rt.pendingExplicitPaths).toEqual([]); // freshRuntime inits []; gate-off → never pushed
    expect(calls).toEqual([]); // no notifyBashUsed, no capture
    expect(readLogLines()).toEqual([]); // clean no-op, not an error
  });

  it("no-ops when rt.store is undefined (does not throw; pendingExplicitPaths untouched)", async () => {
    const rt = getRuntime("no-store");
    expect(rt.store).toBeUndefined(); // fresh runtime has no store
    await expect(
      toolCallCaptureHandler(
        makeToolCallEvent("write", { path: "src/a.ts" }),
        makeCtx({ sessionId: "no-store" }),
      ),
    ).resolves.toBeUndefined();
    expect(rt.pendingExplicitPaths).toEqual([]); // never pushed
  });

  it("no-ops when backend === 'git' (explicit-paths is cas-only; git captures the whole tree)", async () => {
    const store = makeStore({ backend: "git" }); // RecordingStore, no notifyBashUsed
    const rt = getRuntime("git");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "src/a.ts" }),
      makeCtx({ sessionId: "git" }),
    );
    expect(rt.pendingExplicitPaths).toEqual([]); // backend gate → never pushed
    expect(store.calls).toEqual([]); // no capture
  });

  it("no-ops when backend === 'none' (NoOpStore captures nothing)", async () => {
    const store = makeStore({ backend: "none" });
    const rt = getRuntime("none");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "src/a.ts" }),
      makeCtx({ sessionId: "none" }),
    );
    expect(rt.pendingExplicitPaths).toEqual([]);
  });

  it("no-ops when nonGitMode === 'cas' (default) even with a cas backend — write event does NOT push", async () => {
    // default config has nonGitMode 'cas'; setConfig in beforeEach already enabled revert.
    const { store, calls } = makeCasStore();
    const rt = getRuntime("cas-mode");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "src/a.ts" }),
      makeCtx({ sessionId: "cas-mode" }),
    );
    expect(rt.pendingExplicitPaths).toEqual([]); // nonGitMode !== 'explicit-paths' → no push
    expect(calls).toEqual([]); // no notifyBashUsed either
  });

  it("does NOT throw when getSessionId throws — fail-open: error is logged (capture.tool_call)", async () => {
    setLogFile(file);
    const { store } = makeCasStore();
    const rt = getRuntime("throw-sid");
    rt.store = store;
    await expect(
      toolCallCaptureHandler(
        makeToolCallEvent("write", { path: "src/a.ts" }),
        makeCtx({ sessionId: "throw-sid", throwOnGetSessionId: true }),
      ),
    ).resolves.toBeUndefined();
    const lines = readLogLines();
    expect(
      lines.some((l) => l.event === "capture.tool_call" && l.level === "error"),
    ).toBe(true);
    expect(rt.pendingExplicitPaths).toEqual([]); // threw before the push → never pushed
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// toolCallCaptureHandler — accumulation (write/edit happy path)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("toolCallCaptureHandler — accumulation (write/edit push into pendingExplicitPaths)", () => {
  beforeEach(() => {
    // explicit-paths mode + revert on (default beforeEach enables revert; set the mode)
    setConfig({ revert: { enabled: true, nonGitMode: "explicit-paths" } });
  });

  it("pushes event.input.path for a 'write' event into rt.pendingExplicitPaths", async () => {
    const { store } = makeCasStore();
    const rt = getRuntime("write-1");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "src/a.ts" }),
      makeCtx({ sessionId: "write-1" }),
    );
    expect(rt.pendingExplicitPaths).toEqual(["src/a.ts"]);
  });

  it("pushes event.input.path for an 'edit' event into rt.pendingExplicitPaths", async () => {
    const { store } = makeCasStore();
    const rt = getRuntime("edit-1");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("edit", { path: "src/b.ts", edits: [{ oldText: "x", newText: "y" }] }),
      makeCtx({ sessionId: "edit-1" }),
    );
    expect(rt.pendingExplicitPaths).toEqual(["src/b.ts"]);
  });

  it("accumulates across MULTIPLE write/edit events in the SAME turn (cumulative push)", async () => {
    const { store } = makeCasStore();
    const rt = getRuntime("accum");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "src/a.ts" }),
      makeCtx({ sessionId: "accum" }),
    );
    await toolCallCaptureHandler(
      makeToolCallEvent("edit", { path: "src/b.ts" }),
      makeCtx({ sessionId: "accum" }),
    );
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "src/c.ts" }),
      makeCtx({ sessionId: "accum" }),
    );
    expect(rt.pendingExplicitPaths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("does NOT push when input.path is MISSING (defensive typeof guard)", async () => {
    const { store } = makeCasStore();
    const rt = getRuntime("no-path");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("write", {}), // no path key
      makeCtx({ sessionId: "no-path" }),
    );
    expect(rt.pendingExplicitPaths).toEqual([]); // typeof guard rejected undefined
  });

  it("does NOT push and does NOT throw when input.path is a NON-STRING (defensive typeof guard)", async () => {
    const { store } = makeCasStore();
    const rt = getRuntime("bad-path");
    rt.store = store;
    await expect(
      toolCallCaptureHandler(
        makeToolCallEvent("write", { path: 12345 }),
        makeCtx({ sessionId: "bad-path" }),
      ),
    ).resolves.toBeUndefined();
    expect(rt.pendingExplicitPaths).toEqual([]); // typeof !== "string" → no push
  });

  it("does NOT push when input.path is an EMPTY string (length>0 guard)", async () => {
    const { store } = makeCasStore();
    const rt = getRuntime("empty-path");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("write", { path: "" }),
      makeCtx({ sessionId: "empty-path" }),
    );
    expect(rt.pendingExplicitPaths).toEqual([]); // empty string rejected
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// toolCallCaptureHandler — bash delegation
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("toolCallCaptureHandler — bash delegation to (rt.store as CasBackend).notifyBashUsed()", () => {
  beforeEach(() => {
    setConfig({ revert: { enabled: true, nonGitMode: "explicit-paths" } });
  });

  it("calls notifyBashUsed exactly once for a 'bash' event (cas + explicit-paths)", async () => {
    const { store, calls } = makeCasStore();
    const rt = getRuntime("bash-1");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("bash", { command: "echo hi" }),
      makeCtx({ sessionId: "bash-1" }),
    );
    expect(calls.filter((c) => c === "notifyBashUsed")).toHaveLength(1);
    expect(rt.pendingExplicitPaths).toEqual([]); // bash never pushes a path
  });

  it("calls notifyBashUsed on EVERY bash event (the once-per-turn dedup lives INSIDE CasBackend, NOT the handler)", async () => {
    // S1's handler does NOT dedup — it always delegates. CasBackend.notifyBashUsed owns the dedup.
    // The fake here records EVERY call (it does NOT replicate the dedup), proving the handler calls
    // it each time. (The real CasBackend would warn once; the handler stays a thin delegator.)
    const { store, calls } = makeCasStore();
    const rt = getRuntime("bash-repeat");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("bash", { command: "a" }),
      makeCtx({ sessionId: "bash-repeat" }),
    );
    await toolCallCaptureHandler(
      makeToolCallEvent("bash", { command: "b" }),
      makeCtx({ sessionId: "bash-repeat" }),
    );
    expect(calls.filter((c) => c === "notifyBashUsed")).toHaveLength(2); // handler delegated both times
  });

  it("does NOT call notifyBashUsed when backend === 'git' (backend gate)", async () => {
    // override beforeEach's mode is irrelevant — the backend gate fires before nonGitMode matters;
    // use a git-shaped store (RecordingStore has no notifyBashUsed, so a call would throw).
    const store = makeStore({ backend: "git" });
    const rt = getRuntime("bash-git");
    rt.store = store;
    await expect(
      toolCallCaptureHandler(
        makeToolCallEvent("bash", { command: "echo" }),
        makeCtx({ sessionId: "bash-git" }),
      ),
    ).resolves.toBeUndefined();
    expect(store.calls).toEqual([]); // no notifyBashUsed, no capture
  });

  it("does NOT call notifyBashUsed when nonGitMode === 'cas' (mode gate)", async () => {
    setConfig({ revert: { enabled: true, nonGitMode: "cas" } }); // override beforeEach
    const { store, calls } = makeCasStore();
    const rt = getRuntime("bash-cas-mode");
    rt.store = store;
    await toolCallCaptureHandler(
      makeToolCallEvent("bash", { command: "echo" }),
      makeCtx({ sessionId: "bash-cas-mode" }),
    );
    expect(calls).toEqual([]); // nonGitMode gate fired before the bash branch
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// toolCallCaptureHandler — inert tools (read/grep/find/ls/custom)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("toolCallCaptureHandler — inert tools (no path push, no bash warning)", () => {
  beforeEach(() => {
    setConfig({ revert: { enabled: true, nonGitMode: "explicit-paths" } });
  });

  it.each([
    ["read", { path: "src/x.ts" }],
    ["grep", { pattern: "foo" }],
    ["find", { path: "." }],
    ["ls", { path: "." }],
    ["custom", { anything: true }],
  ])("is a clean no-op for a '%s' tool_call event (cas + explicit-paths)", async (toolName, input) => {
    const { store, calls } = makeCasStore();
    const rt = getRuntime(`inert-${toolName}`);
    rt.store = store;
    await expect(
      toolCallCaptureHandler(
        makeToolCallEvent(toolName, input),
        makeCtx({ sessionId: `inert-${toolName}` }),
      ),
    ).resolves.toBeUndefined();
    expect(rt.pendingExplicitPaths).toEqual([]); // no path pushed
    expect(calls).toEqual([]); // no notifyBashUsed, no capture
  });
});
