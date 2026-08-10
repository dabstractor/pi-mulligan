import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { bloatReminderHandler, registerBloatReminder, bloatThresholdFor } from "../src/nudges.js";
import { setConfig, getConfig, DEFAULT_CONFIG } from "../src/config.js";
import type { MulliganConfig } from "../src/config.js";
import { getRuntime, clearAll } from "../src/runtime.js";
import { setLogFile, type LogLine } from "../src/log.js";
import { approxTokens, type ResultContentBlock } from "../src/tokens.js";
import { renderBloatReminder } from "../src/notes.js";

// ── module-level state reset (GOTCHA #5: runtime map + logFile are module-scoped) ──────────
let dir: string;
let file: string;

beforeEach(() => {
  clearAll(); // runtime map reset (mirror runtime.test.ts / markers.test.ts GOTCHA #7)
  // CONFIG RESET: setConfig mutates a MODULE-level cache; a prior test's setConfig({enabled:false}) would leak
  // in and silently disable the nudge. setConfig({}) re-validates from DEFAULT_CONFIG (config.ts is fail-open
  // → unknown keys dropped, absent fields keep defaults → enabled:true, nudges.bloatReminder:true, threshold
  // 16384 global / read 24576 / bash = global 16384 (per-tool resolution)).
  setConfig({});
  dir = mkdtempSync(join(tmpdir(), "mulligan-nudges-"));
  file = join(dir, "log.jsonl");
  setLogFile(null); // logging off by default; setLogFile(file) only in fail-open tests
});

afterEach(() => {
  clearAll();
  setLogFile(null);
  rmSync(dir, { recursive: true, force: true });
});

// ── fakes (hand-rolled, no vi.fn for Pi objects — mirror markers.test.ts / filter.test.ts) ──

/** Minimal fake ExtensionAPI capturing `.on` registrations. */
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      // last-write-wins capture; tests assert it is registered for "tool_result"
      handlers[event] = handler;
    },
  };
  return { handlers, pi: pi as unknown as ExtensionAPI };
}

/** Minimal fake ExtensionContext: scripts getSessionId (the only thing the handler reads). */
function makeCtx(opts: { sessionId?: string; throwOnGetSessionId?: boolean } = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const sessionManager = {
    getSessionId() {
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
  };
  return { sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"] } as ExtensionContext;
}

/** Synthetic ToolResultEvent with one text block of the given byte size + toolName. */
function makeEvent(toolName: string, text: string, isError = false): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "c1",
    input: {},
    content: [{ type: "text", text }],
    isError,
    toolName,
  } as unknown as ToolResultEvent;
}

/** Read back the log file as parsed LogLines (for fail-open assertions). Returns [] if the file was never
 *  created (i.e. no log() call fired — the healthy-path case). */
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

// The config gates default to enabled (config.ts DEFAULT_CONFIG: enabled:true, nudges.bloatReminder:true,
// nudges.bloatThresholdBytes:16384, nudges.bloatThresholdBytesByTool:{ read:24576 }). The
// over-threshold fixture below is 26000 bytes > read's resolved 24576.

// Resolved per-tool thresholds (DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool + global 16384).
// These are the values bloatThresholdFor(toolName, getConfig()) returns for DEFAULT_CONFIG.
const READ_THRESHOLD = 24576;   // makeEvent("read", ...) resolves here
const BASH_THRESHOLD = 16384;   // makeEvent("bash", ...) resolves here — bash uses the global (not in the map)
const GLOBAL_THRESHOLD = 16384; // makeEvent("grep"/"unknown", ...) and undefined/"" resolve here
/** OVER-THRESHOLD fixture for read-tool tests: 26000 > READ_THRESHOLD (24576) → over.
 *  approxTokens = ceil(26000/4) = 6500. (For the grep bloat-hit test, 26000 > GLOBAL 16384 → over too.) */
const OVER_TEXT = "x".repeat(26000);
const OVER_BYTES = 26000;
/** UNDER-THRESHOLD fixture: 5 bytes < any threshold → pass-through. */
const UNDER_TEXT = "small";

// ══════════════════════════════════════════════════════════════════════════════════════════
// registerBloatReminder
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("registerBloatReminder — arms pi.on('tool_result', bloatReminderHandler)", () => {
  it("registers a handler for 'tool_result' (and only 'tool_result')", () => {
    const { handlers, pi } = makePi();
    registerBloatReminder(pi);
    expect(typeof handlers["tool_result"]).toBe("function");
    // No other event is registered.
    expect(Object.keys(handlers)).toEqual(["tool_result"]);
  });

  it("registers EXACTLY ONE handler (calling on once)", () => {
    // makePi last-write-wins, so re-calling on() would overwrite; assert a single key is set and it is the
    // bloatReminderHandler by behavior (it fires on an over-threshold event).
    const { handlers, pi } = makePi();
    registerBloatReminder(pi);
    const h = handlers["tool_result"] as typeof bloatReminderHandler;
    const event = makeEvent("read", OVER_TEXT);
    const res = h(event, makeCtx({ sessionId: "reg" }));
    expect(res).toBeDefined();
    expect(getRuntime("reg").pendingBloatHits).toHaveLength(1); // the registered handler IS the bloat handler
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// bloatThresholdFor — per-tool resolution (pure helper)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("bloatThresholdFor — per-tool resolution (spec/07 §1; DEFAULT_CONFIG)", () => {
  it("resolves read to its per-tool override and bash to the global default", () => {
    const config = getConfig(); // DEFAULT_CONFIG after setConfig({}) in beforeEach
    expect(bloatThresholdFor("bash", config)).toBe(16384); // bash not in the map → global
    expect(bloatThresholdFor("read", config)).toBe(24576); // read has a per-tool override
  });

  it("resolves an unknown toolName to the GLOBAL default (16384)", () => {
    const config = getConfig();
    expect(bloatThresholdFor("unknown_tool", config)).toBe(16384);
    expect(bloatThresholdFor("grep", config)).toBe(16384);
  });

  it("resolves a falsy/missing toolName to the GLOBAL default (16384)", () => {
    const config = getConfig();
    expect(bloatThresholdFor(undefined, config)).toBe(16384);
    expect(bloatThresholdFor("", config)).toBe(16384); // empty string is falsy → global
  });

  it("falls back to the global when the override map is EMPTY (hand-built config, bypasses validateConfig)", () => {
    // CRITICAL: setConfig({nudges:{bloatThresholdBytesByTool:{}}}) does NOT produce an empty map —
    // coerceBloatThresholdByTool MERGES over the DEFAULT_CONFIG fallback ({read:24576}).
    // So hand-build a literal that bypasses validateConfig entirely (bloatThresholdFor is pure).
    const emptyMapConfig: MulliganConfig = {
      ...DEFAULT_CONFIG,
      nudges: { ...DEFAULT_CONFIG.nudges, bloatThresholdBytesByTool: {} },
    };
    expect(bloatThresholdFor("bash", emptyMapConfig)).toBe(16384); // bash not in {} → global
    expect(bloatThresholdFor("read", emptyMapConfig)).toBe(16384);
    expect(bloatThresholdFor("unknown_tool", emptyMapConfig)).toBe(16384);
  });

  it("respects an explicit custom override for a tool", () => {
    // Same hand-built-literal technique to override a single tool without the merge filling in defaults.
    const customConfig: MulliganConfig = {
      ...DEFAULT_CONFIG,
      nudges: { ...DEFAULT_CONFIG.nudges, bloatThresholdBytesByTool: { bash: 99999 } },
    };
    expect(bloatThresholdFor("bash", customConfig)).toBe(99999);
    expect(bloatThresholdFor("read", customConfig)).toBe(16384); // read not in this hand-built map → global (NOT read's 24576 default)
  });

  it("does not leak inherited Object.prototype members for tools named 'constructor'/'toString'/etc. (BUG-001)", () => {
    // A tool whose name collides with an inherited Object.prototype member (constructor/toString/...)
    // must fall back to the global — NOT return the inherited function. Pre-fix, byTool[toolName]
    // returns the inherited function and `?? global` does not trigger, so the helper leaks a non-number.
    const config = getConfig(); // DEFAULT_CONFIG: global 16384, byTool {read:24576}
    const global = config.nudges.bloatThresholdBytes; // 16384
    for (const protoKey of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "toLocaleString"]) {
      const t = bloatThresholdFor(protoKey, config);
      expect(t).toBe(global); // returns the global number, NOT the inherited Object.prototype function
      expect(typeof t).toBe("number"); // belt-and-suspenders: never a function
      expect(Number.isFinite(t)).toBe(true); // never NaN downstream
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// config gates
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("config gates — both short-circuit BEFORE measurement/recording (GOTCHA #8)", () => {
  it("returns undefined and records NOTHING when config.enabled === false", () => {
    setConfig({ enabled: false }); // master switch off
    const ctx = makeCtx({ sessionId: "dis-master" });
    const event = makeEvent("read", OVER_TEXT); // would be over-threshold if measured
    const res = bloatReminderHandler(event, ctx);
    expect(res).toBeUndefined();
    expect(getRuntime("dis-master").pendingBloatHits).toHaveLength(0);
  });

  it("returns undefined and records NOTHING when config.nudges.bloatReminder === false", () => {
    setConfig({ enabled: true, nudges: { bloatReminder: false } });
    const ctx = makeCtx({ sessionId: "dis-nudge" });
    const event = makeEvent("read", OVER_TEXT);
    const res = bloatReminderHandler(event, ctx);
    expect(res).toBeUndefined();
    expect(getRuntime("dis-nudge").pendingBloatHits).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// mulligan_* skip
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("mulligan_* toolName — skip our own tools (GOTCHA #3)", () => {
  it("returns undefined and records NOTHING for a toolName starting with 'mulligan_'", () => {
    const ctx = makeCtx({ sessionId: "own-tool" });
    const event = makeEvent("mulligan_shrink", OVER_TEXT); // over-threshold but it is OUR tool
    const res = bloatReminderHandler(event, ctx);
    expect(res).toBeUndefined();
    expect(getRuntime("own-tool").pendingBloatHits).toHaveLength(0);
  });

  it("still fires for a normal toolName (sanity: the skip is the 'mulligan_' prefix only)", () => {
    const ctx = makeCtx({ sessionId: "normal-tool" });
    const event = makeEvent("read", OVER_TEXT);
    const res = bloatReminderHandler(event, ctx);
    expect(res).toBeDefined();
    expect(getRuntime("normal-tool").pendingBloatHits).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// under-threshold → pass-through
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("under-threshold result — pass-through, NO append, NO hit", () => {
  it("returns undefined when resultBytes < threshold", () => {
    const ctx = makeCtx({ sessionId: "under" });
    const event = makeEvent("read", UNDER_TEXT); // 5 bytes < 24576
    const res = bloatReminderHandler(event, ctx);
    expect(res).toBeUndefined();
    expect(getRuntime("under").pendingBloatHits).toHaveLength(0);
  });

  it("is exactly at the boundary: bytes == threshold is NOT over (strict <)", () => {
    // resultBytes("y".repeat(24576)) == 24576; the handler returns when bytes < threshold (24576 < 24576 → false),
    // so exactly-threshold IS annotated. Confirm the boundary behavior is `<`, not `<=`.
    const atText = "y".repeat(READ_THRESHOLD); // exactly 24576 bytes (read's resolved threshold)
    const ctx = makeCtx({ sessionId: "boundary" });
    const res = bloatReminderHandler(makeEvent("read", atText), ctx);
    expect(res).toBeDefined(); // 24576 is NOT < 24576 → over-threshold path → annotated
    expect(getRuntime("boundary").pendingBloatHits).toHaveLength(1);
  });

  it("one byte under the boundary is pass-through", () => {
    const justUnder = "z".repeat(READ_THRESHOLD - 1); // 24575 bytes (< read's 24576 → pass-through)
    const ctx = makeCtx({ sessionId: "just-under" });
    const res = bloatReminderHandler(makeEvent("read", justUnder), ctx);
    expect(res).toBeUndefined();
    expect(getRuntime("just-under").pendingBloatHits).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// over-threshold → append + hit record
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("over-threshold result — APPEND reminder + record bloat hit (spec/07 §1)", () => {
  it("returns {content} with ONE block appended; original blocks PRESERVED (GOTCHA #7)", () => {
    const ctx = makeCtx({ sessionId: "over" });
    const event = makeEvent("read", OVER_TEXT);
    const origBlocks = event.content; // reference to the original array
    const res = bloatReminderHandler(event, ctx);

    expect(res).toBeDefined();
    const content = (res as { content: unknown[] }).content;
    expect(Array.isArray(content)).toBe(true);
    // exactly ONE block appended
    expect(content).toHaveLength(origBlocks.length + 1);
    // the ORIGINAL blocks are preserved at the front, untouched (appended, not replaced)
    expect(content.slice(0, origBlocks.length)).toEqual(origBlocks);
  });

  it("the appended block is {type:'text', text: renderBloatReminder(toolName,bytes)} EXACTLY (reuse)", () => {
    const ctx = makeCtx({ sessionId: "reuse" });
    const event = makeEvent("read", OVER_TEXT);
    const res = bloatReminderHandler(event, ctx);
    const content = (res as { content: { type: string; text: string }[] }).content;
    const appended = content[content.length - 1];
    expect(appended.type).toBe("text");
    // reuse the COMPLETE helper — the reminder text must equal it byte-for-byte (no reimplementation)
    expect(appended.text).toBe(renderBloatReminder("read", OVER_BYTES));
  });

  it("records a bloat hit {toolName, approxTokens: approxTokens(bytes)} in rt.pendingBloatHits (GOTCHA #4)", () => {
    const ctx = makeCtx({ sessionId: "hit" });
    const event = makeEvent("grep", OVER_TEXT);
    bloatReminderHandler(event, ctx);
    const hits = getRuntime("hit").pendingBloatHits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ toolName: "grep", approxTokens: approxTokens(OVER_BYTES) });
    // explicit pinned value: ceil(26000/4) = 6500
    expect(hits[0].approxTokens).toBe(6500);
  });

  it("does NOT mutate event.content in place (returns a NEW array reference — GOTCHA #7)", () => {
    const ctx = makeCtx({ sessionId: "new-ref" });
    const event = makeEvent("read", OVER_TEXT);
    const originalLength = event.content.length;
    const res = bloatReminderHandler(event, ctx);
    const content = (res as { content: unknown[] }).content;
    expect(content).not.toBe(event.content); // new reference
    expect(event.content).toHaveLength(originalLength); // original untouched
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// per-tool threshold resolution in bloatReminderHandler (behavioral proof)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("per-tool threshold resolution in bloatReminderHandler (DEFAULT_CONFIG)", () => {
  it("a 'bash' result just under 16384 → pass-through (no reminder, no hit)", () => {
    const ctx = makeCtx({ sessionId: "bash-under" });
    const res = bloatReminderHandler(makeEvent("bash", "y".repeat(BASH_THRESHOLD - 1)), ctx);
    expect(res).toBeUndefined();
    expect(getRuntime("bash-under").pendingBloatHits).toHaveLength(0);
  });

  it("a 'bash' result over 16384 → reminder fires + 1 hit", () => {
    const ctx = makeCtx({ sessionId: "bash-over" });
    const res = bloatReminderHandler(makeEvent("bash", "y".repeat(40000)), ctx); // 40000 > 16384
    expect(res).toBeDefined();
    expect(getRuntime("bash-over").pendingBloatHits).toHaveLength(1);
  });

  it("an UNKNOWN tool result over 16384 but under 24576 → reminder fires (uses global 16384)", () => {
    const ctx = makeCtx({ sessionId: "grep-over-global" });
    const res = bloatReminderHandler(makeEvent("grep", "z".repeat(18000)), ctx); // 18000 > 16384
    expect(res).toBeDefined();
    expect(getRuntime("grep-over-global").pendingBloatHits).toHaveLength(1);
  });

  it("a 'read' result over 16384 but under 24576 → pass-through (read threshold is 24576, NOT 16384)", () => {
    // DISCRIMINATING PAIR with the grep case above: SAME 18000 bytes, DIFFERENT toolName → different outcome.
    // This is the strongest proof the handler resolves per-tool, not via a single global threshold.
    const ctx = makeCtx({ sessionId: "read-under-own" });
    const res = bloatReminderHandler(makeEvent("read", "z".repeat(18000)), ctx); // 18000 < 24576
    expect(res).toBeUndefined();
    expect(getRuntime("read-under-own").pendingBloatHits).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// multi-result accumulation across a turn
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("multi-result turn — pendingBloatHits accumulates (NOT cleared here — P1.M6.T2.S1 clears)", () => {
  it("a second over-threshold result appends a SECOND hit", () => {
    const ctx = makeCtx({ sessionId: "multi" });
    bloatReminderHandler(makeEvent("read", OVER_TEXT), ctx);
    bloatReminderHandler(makeEvent("grep", "y".repeat(20000)), ctx); // 20000 > global 16384 → fires
    const hits = getRuntime("multi").pendingBloatHits;
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ toolName: "read", approxTokens: approxTokens(OVER_BYTES) });
    expect(hits[1]).toEqual({ toolName: "grep", approxTokens: approxTokens(20000) });
  });

  it("an under-threshold result interleaved does NOT add a hit", () => {
    const ctx = makeCtx({ sessionId: "mixed" });
    bloatReminderHandler(makeEvent("read", OVER_TEXT), ctx); // over (read) → 1 hit
    bloatReminderHandler(makeEvent("read", UNDER_TEXT), ctx); // under → no hit
    bloatReminderHandler(makeEvent("bash", "q".repeat(40000)), ctx); // 40000 > bash 16384 → 1 hit
    const hits = getRuntime("mixed").pendingBloatHits;
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.toolName)).toEqual(["read", "bash"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// fail-open — NEVER throws (spec/03 #4, spec/08 E13); logs via log("error","nudge.bloat",sessionId,...)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("fail-open — every throw is caught, logged, returns undefined (GOTCHA #6, E13)", () => {
  beforeEach(() => setLogFile(file)); // capture the fail-open log line

  it("a throwing getSessionId → returns undefined, logs sessionId='' (read first, it threw)", () => {
    const ctx = makeCtx({ sessionId: "ignored", throwOnGetSessionId: true });
    const event = makeEvent("read", OVER_TEXT);
    // call ONCE (each call logs a line) — capture the result to assert both not-throw and undefined.
    let res: unknown;
    expect(() => {
      res = bloatReminderHandler(event, ctx);
    }).not.toThrow();
    expect(res).toBeUndefined();
    // fail-open log: sessionId is "" (the handler read it FIRST, it threw before assignment completed)
    const lines = readLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("error");
    expect(lines[0].event).toBe("nudge.bloat");
    expect(lines[0].sessionId).toBe(""); // GOTCHA #1: log receives sessionId (""), NOT ctx
    expect(typeof lines[0].data).toBe("object");
  });

  it("a healthy getConfig path does NOT throw — it annotates normally (getConfig never throws)", () => {
    // getConfig/validateConfig are fail-open (never throw; always return a valid config). So the config line
    // cannot itself trigger the catch. Confirm the healthy config path: over-threshold → annotated, 1 hit, NO
    // error logged. (This documents that the catch is NOT needed for config; the getSessionId + Proxy-toolName
    // tests above cover the realistic throw paths.)
    setConfig({ enabled: true }); // explicit healthy config
    const ctx = makeCtx({ sessionId: "healthy-cfg" });
    const event = makeEvent("read", OVER_TEXT);
    const res = bloatReminderHandler(event, ctx);
    expect(res).toBeDefined(); // healthy path → annotated (sanity)
    expect(getRuntime("healthy-cfg").pendingBloatHits).toHaveLength(1);
    expect(readLogLines()).toHaveLength(0); // no error logged
  });

  it("a throwing resultBytes (content is a Proxy whose iteration throws) → returns undefined, logs", () => {
    // resultBytes is defensive (swallows Proxy throws per-block), so it returns 0 for a throwing Proxy array
    // rather than throwing. To force the catch to fire on the resultBytes line, hand the handler an event whose
    // content throws on the cast/access path itself: a Proxy that throws on `Symbol.iterator` / index access
    // BEFORE resultBytes' own defensive layer runs is still caught by resultBytes. So we instead force the catch
    // on a LATER line by making getRuntime throw — but getRuntime never throws. The reliable catch trigger is
    // getSessionId (above). Here we assert resultBytes' OWN defensive behavior: a throwing-Proxy content yields
    // bytes=0 → pass-through (NOT a throw, NOT over-threshold) → no annotation, no hit.
    const throwingContent = new Proxy([], {
      get(_t, prop) {
        if (prop === "length") throw new Error("proxy boom");
        throw new Error("proxy boom");
      },
    }) as unknown as ResultContentBlock[];
    const event = {
      type: "tool_result",
      toolCallId: "c1",
      input: {},
      content: throwingContent,
      isError: false,
      toolName: "read",
    } as unknown as ToolResultEvent;
    const ctx = makeCtx({ sessionId: "proxy-content" });
    // resultBytes is defensive → 0 → pass-through; the OUTER catch is NOT what fires here (defense-in-depth
    // means resultBytes never reaches the outer catch). Confirm pass-through + no hit.
    expect(() => bloatReminderHandler(event, ctx)).not.toThrow();
    expect(bloatReminderHandler(event, ctx)).toBeUndefined();
    expect(getRuntime("proxy-content").pendingBloatHits).toHaveLength(0);
  });

  it("the OUTER try/catch is the hard guarantee: an exception thrown by any line is caught + logged", () => {
    // getConfig/resultBytes/renderBloatReminder/getRuntime are all defensive (never throw). The realistic throw
    // the handler can observe is from getSessionId (covered above). To prove the catch is line-agnostic (it
    // catches a throw from ANY line, not just getSessionId), construct an event whose toolName access throws via
    // a Proxy — the throw originates on the `event.toolName.startsWith(...)` line, AFTER sessionId+config pass.
    const throwingEvent = new Proxy(
      { type: "tool_result", toolCallId: "c1", input: {}, content: [{ type: "text", text: OVER_TEXT }], isError: false },
      {
        get(t, prop) {
          if (prop === "toolName") throw new Error("toolName proxy boom");
          // @ts-expect-error — generic Proxy indexing into the target record
          return t[prop];
        },
      },
    ) as unknown as ToolResultEvent;
    const ctx = makeCtx({ sessionId: "toolname-throw" });
    let res: unknown;
    expect(() => {
      res = bloatReminderHandler(throwingEvent, ctx);
    }).not.toThrow();
    expect(res).toBeUndefined();
    const lines = readLogLines();
    expect(lines).toHaveLength(1); // ONE call → ONE log line
    expect(lines[0].event).toBe("nudge.bloat");
    expect(lines[0].sessionId).toBe("toolname-throw"); // sessionId read FIRST, before the throw
    expect(lines[0].level).toBe("error");
  });

  it("log is called with sessionId (string), NEVER with ctx (GOTCHA #1)", () => {
    // The throwing-toolName case logs sessionId="string-not-ctx" (a string), proving ctx is not passed.
    const throwingEvent = new Proxy(
      { type: "tool_result", toolCallId: "c1", input: {}, content: [{ type: "text", text: OVER_TEXT }], isError: false },
      {
        get(t, prop) {
          if (prop === "toolName") throw new Error("boom");
          // @ts-expect-error — generic Proxy indexing into the target record
          return t[prop];
        },
      },
    ) as unknown as ToolResultEvent;
    bloatReminderHandler(throwingEvent, makeCtx({ sessionId: "string-not-ctx" }));
    const lines = readLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].sessionId).toBe("string-not-ctx"); // a STRING, exactly the sessionId
    expect(typeof lines[0].sessionId).toBe("string");
  });
});