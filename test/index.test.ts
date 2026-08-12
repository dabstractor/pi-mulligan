import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import indexFactory from "../src/index.js";
import { getRuntime, clearAll } from "../src/runtime.js";

// Deterministic factory test: mock settings.js so loadMulliganConfig's return is controllable
// (a real ~/.pi or repo .pi settings.json would make this machine-dependent). vi.mock is file-scoped
// → does not leak to test/settings.test.ts or others. The hand-rolled Pi fakes (makePi/makeCtx) stay.
vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() }));
vi.mock("../src/log.js", () => ({ setLogFile: vi.fn() }));
import { loadMulliganConfig } from "../src/settings.js"; // the mocked binding (assert/program it)
import { getConfig } from "../src/config.js"; // to assert the return flowed to the cache
import { setLogFile } from "../src/log.js"; // mocked — assert the session_start re-fire

// ── module-level state reset (GOTCHA #12: runtime map is module-scoped) ───────────────────
beforeEach(() => {
  clearAll();
  vi.mocked(loadMulliganConfig).mockReset(); // default vi.fn() → returns undefined → DEFAULT_CONFIG
  vi.mocked(setLogFile).mockReset(); // default vi.fn() → no-op; cleared so factory step-2 calls don't leak
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
