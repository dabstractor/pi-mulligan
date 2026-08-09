import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import indexFactory from "../src/index.js";
import { getRuntime, clearAll } from "../src/runtime.js";

// Deterministic factory test: mock settings.js so loadMulliganConfig's return is controllable
// (a real ~/.pi or repo .pi settings.json would make this machine-dependent). vi.mock is file-scoped
// → does not leak to test/settings.test.ts or others. The hand-rolled Pi fakes (makePi/makeCtx) stay.
vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() }));
import { loadMulliganConfig } from "../src/settings.js"; // the mocked binding (assert/program it)
import { getConfig } from "../src/config.js"; // to assert the return flowed to the cache

// ── module-level state reset (GOTCHA #12: runtime map is module-scoped) ───────────────────
beforeEach(() => {
  clearAll();
  vi.mocked(loadMulliganConfig).mockReset(); // default vi.fn() → returns undefined → DEFAULT_CONFIG
});

// ── fakes (hand-rolled, no vi.fn for Pi objects — mirror nudges.test.ts / filter.test.ts) ──

/**
 * Minimal fake ExtensionAPI capturing BOTH `.on` registrations AND `.registerTool` calls
 * (GOTCHA #10 — index.ts calls both; the established makePi only captured `.on`).
 */
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const tools: { name: string }[] = [];
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      handlers[event] = handler;
    },
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
  };
  return { handlers, tools, pi: pi as unknown as ExtensionAPI };
}

/** Minimal fake ExtensionContext: only sessionManager.getSessionId() is needed by the session_start handler. */
function makeCtx(sessionId = "sess-test") {
  const sessionManager = {
    getSessionId() {
      return sessionId;
    },
  };
  return {
    sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"],
  } as ExtensionContext;
}

/** Synthetic SessionStartEvent (shape only — the handler reads ctx, not event fields). */
function makeStartEvent(reason = "new") {
  return { type: "session_start", reason } as unknown as never;
}

// ── tests ─────────────────────────────────────────────────────────────────────────────────

describe("index.ts extension factory", () => {
  it("registers all 5 tools with the exact names", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);

    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["mulligan_audit", "mulligan_cancel", "mulligan_checkpoint", "mulligan_rewind", "mulligan_shrink"].sort(),
    );
  });

  it("does not register extra tools", () => {
    const { tools, pi } = makePi();
    indexFactory(pi);
    expect(tools.length).toBe(5);
  });

  it("arms the 5 event handlers", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);

    const expected = ["context", "tool_result", "turn_end", "session_start", "session_shutdown"];
    for (const event of expected) {
      expect(handlers[event], `expected handler armed for "${event}"`).toBeTypeOf("function");
    }
  });

  it("does not arm extra handlers", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    expect(Object.keys(handlers).sort()).toEqual(
      ["context", "session_shutdown", "session_start", "tool_result", "turn_end"].sort(),
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

  it("never calls loadMulliganConfig from the session_start handler (that re-read is T2.S2)", () => {
    const { handlers, pi } = makePi();
    indexFactory(pi);
    const callsBefore = vi.mocked(loadMulliganConfig).mock.calls.length;
    handlers["session_start"]!(makeStartEvent("new"), makeCtx("s1"));
    expect(vi.mocked(loadMulliganConfig).mock.calls.length).toBe(callsBefore); // unchanged
  });
});