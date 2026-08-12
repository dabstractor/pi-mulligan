import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import indexFactory from "../src/index.js";
import { getRuntime, clearAll } from "../src/runtime.js";
import type { SnapshotStore } from "../src/snapshot/store.js";

// Deterministic factory test: mock settings.js so loadMulliganConfig's return is controllable
// (a real ~/.pi or repo .pi settings.json would make this machine-dependent). vi.mock is file-scoped
// → does not leak to test/settings.test.ts or others. The hand-rolled Pi fakes (makePi/makeCtx) stay.
vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() }));
vi.mock("../src/log.js", () => ({ setLogFile: vi.fn(), log: vi.fn() }));
// [P3.M1.T2.S1] mock detectAndCreate so the session_start store block is observable + controllable
// (a real store would touch git/fs). detectAndCreate is the ONLY value index.ts imports from
// store.js, so the module mock needs only that export (the type-only SnapshotStore import is erased).
vi.mock("../src/snapshot/store.js", () => ({ detectAndCreate: vi.fn() }));
import { loadMulliganConfig } from "../src/settings.js"; // the mocked binding (assert/program it)
import { getConfig, setConfig } from "../src/config.js"; // to assert the return flowed to the cache + set revert
import { setLogFile, log } from "../src/log.js"; // mocked — assert the session_start re-fire
import { detectAndCreate } from "../src/snapshot/store.js"; // mocked — assert/program the store block

// ── module-level state reset (GOTCHA #12: runtime map is module-scoped) ───────────────────
beforeEach(() => {
  clearAll();
  vi.mocked(loadMulliganConfig).mockReset(); // default vi.fn() → returns undefined → DEFAULT_CONFIG
  vi.mocked(setLogFile).mockReset(); // default vi.fn() → no-op; cleared so factory step-2 calls don't leak
  vi.mocked(log).mockReset(); // [P3.M1.T2.S1] cleared so session_start store-block log calls don't leak
  vi.mocked(detectAndCreate).mockReset(); // [P3.M1.T2.S1] default vi.fn() → returns undefined; reset per test
});

// ── fakes (hand-rolled, no vi.fn for Pi objects — mirror nudges.test.ts / filter.test.ts) ──

/**
 * Minimal fake ExtensionAPI capturing BOTH `.on` registrations AND `.registerTool` calls
 * (GOTCHA #10 — index.ts calls both; the established makePi only captured `.on`).
 */
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> =
    {};
  const tools: { name: string }[] = [];
  const commands: { name: string }[] = [];
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      handlers[event] = handler;
    },
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
    registerCommand(name: string, _options: unknown) {
      commands.push({ name });
    },
  };
  return { handlers, tools, commands, pi: pi as unknown as ExtensionAPI };
}

/** Minimal fake ExtensionContext: carries the sessionManager (getSessionId) and cwd that the
 *  session_start handler reads (T2.S2 re-reads config with ctx.cwd). cwd defaults to "/test/cwd" so
 *  pre-T2.S2 callers are unaffected (backward compatible). */
function makeCtx(sessionId = "sess-test", cwd = "/test/cwd") {
  const sessionManager = {
    getSessionId() {
      return sessionId;
    },
  };
  return {
    sessionManager:
      sessionManager as unknown as ExtensionContext["sessionManager"],
    cwd,
  } as ExtensionContext;
}

/** Synthetic SessionStartEvent (shape only — the handler reads ctx, not event fields). */
function makeStartEvent(reason = "new") {
  return { type: "session_start", reason } as unknown as never;
}

// ── tests ─────────────────────────────────────────────────────────────────────────────────

describe("index.ts extension factory", () => {
  it("registers all 4 tools with the exact names", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);

    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "mulligan_audit",
        "mulligan_cancel",
        "mulligan_rewind",
        "mulligan_shrink",
      ].sort(),
    );
  });

  it("does not register extra tools", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);
    expect(tools.length).toBe(4);
  });

  it("registers the 3 human slash commands with the exact names", () => {
    const { commands, pi } = makePi();
    indexFactory(pi);
    expect(commands.map((c) => c.name).sort()).toEqual(
      [
        "mulligan_checkpoint",
        "mulligan_checkpoint_revoke",
        "mulligan_audit",
      ].sort(),
    );
  });

  it("arms the 6 event handlers", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);

    const expected = [
      "agent_end",
      "context",
      "tool_result",
      "turn_end",
      "turn_start",
      "session_start",
      "session_shutdown",
    ];
    for (const event of expected) {
      expect(
        handlers[event],
        `expected handler armed for "${event}"`,
      ).toBeTypeOf("function");
    }
  });

  it("does not arm extra handlers", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    expect(Object.keys(handlers).sort()).toEqual(
      [
        "agent_end",
        "context",
        "session_shutdown",
        "session_start",
        "tool_result",
        "turn_end",
        "turn_start",
      ].sort(),
    );
  });

  it("session_start handler resets the runtime for that session", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);

    const sid = "s1";
    // Populate a runtime and mutate it so it diverges from a fresh one.
    const rt = getRuntime(sid);
    rt.seq = 99;
    rt.tokenBaseline = 5000;

    const start = handlers["session_start"];
    expect(start).toBeTypeOf("function");
    start!(makeStartEvent("new"), makeCtx(sid));

    // After reset, the next getRuntime creates a FRESH runtime → all defaults.
    const rt2 = getRuntime(sid);
    expect(rt2.seq).toBe(0);
    expect(rt2.tokenBaseline).toBeNull();
  });

  it("session_start handler does not branch on reason (resume also resets)", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);

    const sid = "s-resume";
    const rt = getRuntime(sid);
    rt.seq = 7;

    const start = handlers["session_start"]!;
    start(makeStartEvent("resume"), makeCtx(sid));

    expect(getRuntime(sid).seq).toBe(0);
  });

  it("session_shutdown handler clears all runtimes", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);

    // Populate two sessions' runtimes.
    getRuntime("s1").seq = 3;
    getRuntime("s2").seq = 4;

    const shutdown = handlers["session_shutdown"];
    expect(shutdown).toBeTypeOf("function");
    shutdown!();

    // clearAll wiped the map → next access creates fresh runtimes (seq 0).
    expect(getRuntime("s1").seq).toBe(0);
    expect(getRuntime("s2").seq).toBe(0);
  });

  it("is a sync factory (returns void, not a Promise)", () => {
    const { pi } = makePi();
    const result = indexFactory(pi);
    expect(result).toBeUndefined();
  });
});

describe("index.ts config loading (factory)", () => {
  it("calls loadMulliganConfig(process.cwd()) and feeds its return to setConfig", () => {
    vi.mocked(loadMulliganConfig).mockReturnValue({ enabled: false });
    const { pi } = makePi();
    indexFactory(pi);
    expect(loadMulliganConfig).toHaveBeenCalledTimes(1);
    expect(loadMulliganConfig).toHaveBeenCalledWith(process.cwd());
    // the mock's return value flowed through to the config cache (proves the wiring end-to-end):
    expect(getConfig().enabled).toBe(false);
  });

  it("is fail-open to DEFAULT_CONFIG when loadMulliganConfig returns undefined", () => {
    vi.mocked(loadMulliganConfig).mockReturnValue(undefined); // absent/invalid/no-mulligan-key
    const { pi } = makePi();
    indexFactory(pi);
    expect(loadMulliganConfig).toHaveBeenCalledTimes(1);
    expect(getConfig().enabled).toBe(true); // DEFAULT_CONFIG.enabled === true
  });

  // (T2.S1's "never calls loadMulliganConfig from the session_start handler" scope-guard test was
  //  REMOVED — it is now factually wrong because T2.S2 intentionally adds that exact re-read.
  //  The positive assertions live in the `index.ts session_start config re-read (T2.S2)` block below.)
});

describe("index.ts session_start config re-read (T2.S2)", () => {
  it("re-reads config with the authoritative ctx.cwd", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    // The factory (step 2) also calls setLogFile; clear it so only the session_start re-fire is counted.
    vi.mocked(setLogFile).mockClear();
    vi.mocked(loadMulliganConfig).mockReturnValue({
      log: { file: "/proj.log" },
    });

    handlers["session_start"]!(
      makeStartEvent("reload"),
      makeCtx("s1", "/proj"),
    );

    expect(loadMulliganConfig).toHaveBeenCalledWith("/proj");
    expect(getConfig().log.file).toBe("/proj.log");
  });

  it("re-fires setLogFile with the re-read config's log.file", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    vi.mocked(setLogFile).mockClear();
    vi.mocked(loadMulliganConfig).mockReturnValue({ log: { file: "/x.log" } });

    handlers["session_start"]!(makeStartEvent("new"), makeCtx("s1"));

    expect(setLogFile).toHaveBeenCalledTimes(1);
    expect(setLogFile).toHaveBeenCalledWith("/x.log");
  });

  it("is fail-open to DEFAULT_CONFIG when re-read returns undefined", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    vi.mocked(setLogFile).mockClear();
    vi.mocked(loadMulliganConfig).mockReturnValue(undefined); // absent/invalid settings

    handlers["session_start"]!(makeStartEvent("resume"), makeCtx("s1"));

    expect(getConfig().enabled).toBe(true); // DEFAULT_CONFIG.enabled === true
    expect(setLogFile).toHaveBeenCalledWith(null); // DEFAULT_CONFIG.log.file === null
  });

  it("re-reads on EVERY reason (startup|reload|new|resume|fork)", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);

    for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
      vi.mocked(loadMulliganConfig).mockReset();
      handlers["session_start"]!(makeStartEvent(reason), makeCtx("s1", "/r"));
      expect(loadMulliganConfig, `reason=${reason}`).toHaveBeenCalledWith("/r");
    }
  });

  it("still resets the session runtime", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);

    const sid = "s1";
    const rt = getRuntime(sid);
    rt.seq = 99;

    handlers["session_start"]!(makeStartEvent("new"), makeCtx(sid));

    expect(getRuntime(sid).seq).toBe(0);
  });
});

// ── [P3.M1.T2.S1] session_start store lifecycle (create + cache + GC + fail-open) ──────────
// The handler now creates a snapshot store via detectAndCreate when config.revert.enabled, caches
// it on getRuntime(sid).store, and runs gcTurnSnapshots(rt) to clear stale turn/* refs from a
// reloaded instance (E32). detectAndCreate is MOCKED (vi.mock at the top) so a RecordingStore fake
// (gc + destroy spies) observes the wiring WITHOUT touching git/fs.
describe("index.ts session_start store lifecycle (T2.S1)", () => {
  /** A recording fake SnapshotStore — gc + destroy are spies the tests assert on. describe/capture
   *  etc. are stubs (the store block only calls gc, via gcTurnSnapshots). */
  function makeFakeStore(): SnapshotStore & {
    gc: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  } {
    return {
      describe: vi.fn(() => ({ backend: "git" as const })),
      capture: vi.fn(async () => null),
      dirtyCheck: vi.fn(async () => []),
      restore: vi.fn(async () => ({
        reverted: [],
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      })),
      has: vi.fn(async () => false),
      retire: vi.fn(async () => undefined),
      gc: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    } as unknown as SnapshotStore & {
      gc: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
  }

  it("does NOT call detectAndCreate when revert.enabled is false (gate is first; DEFAULT_CONFIG)", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    // DEFAULT_CONFIG: revert.enabled === false → the store block early-returns BEFORE detectAndCreate.
    vi.mocked(loadMulliganConfig).mockReturnValue(undefined); // → DEFAULT_CONFIG

    await handlers["session_start"]!(
      makeStartEvent("new"),
      makeCtx("s1", "/proj"),
    );

    expect(detectAndCreate).not.toHaveBeenCalled();
    expect(getRuntime("s1").store).toBeUndefined(); // gate first → no store assigned
  });

  it("creates the store via detectAndCreate + caches it on getRuntime(sid).store when revert.enabled is true", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    // Enable revert via the settings mock (flows through setConfig → getConfig).revert.enabled === true.
    vi.mocked(loadMulliganConfig).mockReturnValue({
      revert: { enabled: true, storageDir: "/tmp/store" },
    });
    const fakeStore = makeFakeStore();
    vi.mocked(detectAndCreate).mockResolvedValue(fakeStore);

    await handlers["session_start"]!(
      makeStartEvent("reload"),
      makeCtx("s1", "/proj"),
    );

    expect(getRuntime("s1").store).toBe(fakeStore); // cached on rt.store
  });

  it("passes (ctx.cwd, getConfig().revert) to detectAndCreate (2-arg call — no sessionDir)", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    vi.mocked(loadMulliganConfig).mockReturnValue({
      revert: { enabled: true, storageDir: "/tmp/store" },
    });
    vi.mocked(detectAndCreate).mockResolvedValue(makeFakeStore());

    await handlers["session_start"]!(
      makeStartEvent("new"),
      makeCtx("s1", "/proj"),
    );

    expect(detectAndCreate).toHaveBeenCalledTimes(1);
    expect(detectAndCreate).toHaveBeenCalledWith("/proj", getConfig().revert);
    expect(detectAndCreate).toHaveBeenCalledWith(
      "/proj",
      expect.objectContaining({ enabled: true, storageDir: "/tmp/store" }),
    );
  });

  it("runs the prompt-boundary GC (store.gc called once via gcTurnSnapshots) after store creation", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    vi.mocked(loadMulliganConfig).mockReturnValue({
      revert: { enabled: true, storageDir: "/tmp/store" },
    });
    const fakeStore = makeFakeStore();
    vi.mocked(detectAndCreate).mockResolvedValue(fakeStore);

    await handlers["session_start"]!(
      makeStartEvent("new"),
      makeCtx("s1", "/proj"),
    );

    expect(fakeStore.gc).toHaveBeenCalledTimes(1); // gcTurnSnapshots(rt) called store.gc once
  });

  it("NEVER rejects when detectAndCreate rejects — logs 'session_start.store' + the runtime is still fresh", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    vi.mocked(loadMulliganConfig).mockReturnValue({
      revert: { enabled: true, storageDir: "/tmp/store" },
    });
    // detectAndCreate rejects (belt-and-suspenders — in production it never does, but the try/catch
    // must still hold the CRITICAL session_start path safe).
    vi.mocked(detectAndCreate).mockRejectedValue(new Error("boom"));

    await expect(
      handlers["session_start"]!(makeStartEvent("new"), makeCtx("s1", "/proj")),
    ).resolves.toBeUndefined(); // NEVER rejects

    expect(log).toHaveBeenCalledWith(
      "error",
      "session_start.store",
      "s1",
      expect.objectContaining({ error: expect.stringContaining("boom") }),
    );
    // resetRuntime still ran (BEFORE the store block) → the runtime is fresh.
    expect(getRuntime("s1").seq).toBe(0);
    // store was never assigned (detectAndCreate rejected before the assignment line resolved).
    expect(getRuntime("s1").store).toBeUndefined();
  });

  it("resetRuntime still ran (seq===0) when the store block throws — config reload + banner unaffected", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    vi.mocked(loadMulliganConfig).mockReturnValue({
      revert: { enabled: true, storageDir: "/tmp/store" },
    });
    vi.mocked(detectAndCreate).mockRejectedValue(new Error("any failure"));

    // Seed a stale runtime so we can prove resetRuntime ran (the fresh one has seq 0).
    getRuntime("s1").seq = 42;

    await handlers["session_start"]!(
      makeStartEvent("new"),
      makeCtx("s1", "/proj"),
    );

    expect(getRuntime("s1").seq).toBe(0); // resetRuntime ran (entry deleted → fresh runtime)
    expect(getConfig().revert.enabled).toBe(true); // config reload also ran (unaffected by the throw)
  });
});

// ── [P3.M1.T2.S1] session_shutdown teardown (destroy every store before clearAll) ─────────
// The handler now destroys every active store best-effort (a failure is swallowed — never blocks)
// BEFORE clearAll() wipes the runtime map. Uses getActiveStores() (runtime.ts helper) to enumerate.
describe("index.ts session_shutdown teardown (T2.S1)", () => {
  /** Seed a fake store onto a session's runtime so getActiveStores() sees it. */
  function seedStore(
    sid: string,
    destroyImpl: () => Promise<void> = async () => undefined,
  ): SnapshotStore & { destroy: ReturnType<typeof vi.fn> } {
    const store = {
      describe: () => ({ backend: "git" as const }),
      capture: async () => null,
      dirtyCheck: async () => [],
      restore: async () => ({
        reverted: [],
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      }),
      has: async () => false,
      retire: async () => undefined,
      gc: async () => undefined,
      destroy: vi.fn(destroyImpl),
    } as unknown as SnapshotStore & { destroy: ReturnType<typeof vi.fn> };
    getRuntime(sid).store = store;
    return store;
  }

  it("calls destroy() on EVERY active store before clearAll() (2 seeded stores → 2 destroy calls)", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    const fake1 = seedStore("s1");
    const fake2 = seedStore("s2");

    await handlers["session_shutdown"]!();

    expect(fake1.destroy).toHaveBeenCalledTimes(1);
    expect(fake2.destroy).toHaveBeenCalledTimes(1);
    // clearAll ran → next getRuntime is fresh (store undefined).
    expect(getRuntime("s1").store).toBeUndefined();
  });

  it("a destroy() rejection on one store does NOT skip the other stores OR clearAll()", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    const failing = seedStore("s1", async () => {
      throw new Error("locked file");
    });
    const other = seedStore("s2");

    await expect(handlers["session_shutdown"]!()).resolves.toBeUndefined(); // no throw

    expect(failing.destroy).toHaveBeenCalledTimes(1);
    expect(other.destroy).toHaveBeenCalledTimes(1); // the rejection did NOT skip the rest
    // clearAll still ran (the rejection did not skip it).
    expect(getRuntime("s1").store).toBeUndefined();
    expect(getRuntime("s2").store).toBeUndefined();
  });

  it("is a no-op (no destroy calls, no throw) when no session created a store", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    // No stores seeded → getActiveStores() returns [] → the loop body never runs.

    await expect(handlers["session_shutdown"]!()).resolves.toBeUndefined();
  });

  it("clearAll ran after destroy (next getRuntime(sid) is fresh; no stores leaked)", async () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    seedStore("s1");

    await handlers["session_shutdown"]!();

    // getActiveStores() reads the (now-cleared) map → empty (clearAll wiped it).
    // Re-seed nothing; a fresh getRuntime("s1") has no store.
    expect(getRuntime("s1").store).toBeUndefined();
    expect(getRuntime("s1").seq).toBe(0); // fresh runtime (clearAll → freshRuntime on next access)
  });
});
