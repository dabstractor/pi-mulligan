import { describe, it, expectTypeOf, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  getConfig,
  setConfig,
  validateConfig,
  type MulliganConfig,
  type Granularity,
  type EstimateConfidence,
} from "../src/config.js";

describe("DEFAULT_CONFIG", () => {
  it("matches the spec/09 §2 defaults exactly", () => {
    expect(DEFAULT_CONFIG).toEqual({
      enabled: true,
      rewind: {
        enabled: true,
        protectedRoles: ["first:user", "latest:user"],
        maxDepth: 5,
        maxRetriesPerPrompt: 5,
        abortContextFraction: 0.9,
        requireMutationWarning: true,
      },
      shrink: { enabled: true, maxActive: 32, staleAfterFires: 3 },           // no autoOnBloat (not v1)
      nudges: {
        bloatReminder: true,
        perTurnDrift: true,
        bloatThresholdBytes: 16384,
        bloatThresholdBytesByTool: { read: 24576 },
        driftThresholdTokens: 6000,
        driftWindowTurns: 3,
        highWaterFraction: 0.7,
      },
      audit: { estimateConfidence: "medium" },
      log: { file: null },
    });
  });

  it("is assignable to MulliganConfig (type-level)", () => {
    expectTypeOf(DEFAULT_CONFIG).toMatchTypeOf<MulliganConfig>();
  });

  it("exports the 3-value Granularity and 3-value EstimateConfidence (type-level)", () => {
    expectTypeOf<Granularity>().toEqualTypeOf<"last_tool_call_group" | "last_turn" | "checkpoint">();
    expectTypeOf<EstimateConfidence>().toEqualTypeOf<"low" | "medium" | "high">();
  });
});

describe("validateConfig", () => {
  it("returns deep-equal DEFAULT_CONFIG for absent/empty/non-record input", () => {
    expect(validateConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig({})).toEqual(DEFAULT_CONFIG);
    expect(validateConfig(42)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig("nope")).toEqual(DEFAULT_CONFIG);
    expect(validateConfig([1, 2, 3])).toEqual(DEFAULT_CONFIG); // arrays are not records → defaults
    expect(validateConfig(Object.create(null))).toEqual(DEFAULT_CONFIG); // null-proto object is a record
  });

  it("deep-merges partial valid overrides over defaults", () => {
    const cfg = validateConfig({ nudges: { bloatThresholdBytes: 100 } });
    expect(cfg.nudges.bloatThresholdBytes).toBe(100);
    expect(cfg.nudges.driftThresholdTokens).toBe(6000); // unchanged default
    expect(cfg.enabled).toBe(true); // unchanged
  });

  it("applies a full valid override", () => {
    const cfg = validateConfig({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false },
      shrink: { enabled: false, maxActive: 8, staleAfterFires: 2 },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1 },
      audit: { estimateConfidence: "low" },
      log: { file: "/tmp/mulligan.jsonl" },
    });
    expect(cfg).toEqual({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, maxRetriesPerPrompt: 5, abortContextFraction: 0.9, requireMutationWarning: false },
      shrink: { enabled: false, maxActive: 8, staleAfterFires: 2 },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1, bloatThresholdBytesByTool: { read: 24576 }, driftWindowTurns: 3, highWaterFraction: 0.7 },
      audit: { estimateConfidence: "low" },
      log: { file: "/tmp/mulligan.jsonl" },
    });
  });

  it("coerces booleans with !! (spec/09 §4) — non-empty strings are truthy", () => {
    expect(validateConfig({ enabled: 1 }).enabled).toBe(true);
    expect(validateConfig({ enabled: 0 }).enabled).toBe(false);
    expect(validateConfig({ enabled: "" }).enabled).toBe(false);
    // GOTCHA #3: "false" is a non-empty string → truthy → true (intentional per spec)
    expect(validateConfig({ enabled: "false" }).enabled).toBe(true);
    // null is present → !!null → false (users wanting the default must OMIT the field)
    expect(validateConfig({ enabled: null }).enabled).toBe(false);
  });

  it("validates numbers: finite, >=0; thresholds >0; rejects strings/NaN/Infinity WITHOUT coercion", () => {
    expect(validateConfig({ nudges: { bloatThresholdBytes: -1 } }).nudges.bloatThresholdBytes).toBe(16384);
    expect(validateConfig({ nudges: { bloatThresholdBytes: 0 } }).nudges.bloatThresholdBytes).toBe(16384); // threshold must be >0
    expect(validateConfig({ nudges: { bloatThresholdBytes: NaN } }).nudges.bloatThresholdBytes).toBe(16384);
    expect(validateConfig({ nudges: { bloatThresholdBytes: Infinity } }).nudges.bloatThresholdBytes).toBe(16384);
    expect(validateConfig({ nudges: { bloatThresholdBytes: "8192" } }).nudges.bloatThresholdBytes).toBe(16384); // no string coercion
    expect(validateConfig({ rewind: { maxDepth: 0 } }).rewind.maxDepth).toBe(0); // >=0 allowed
    expect(validateConfig({ rewind: { maxDepth: -1 } }).rewind.maxDepth).toBe(5); // <0 → default
  });

  it("default bloatThresholdBytesByTool is the per-tool map { read: 24576 }", () => {
    expect(validateConfig({}).nudges.bloatThresholdBytesByTool).toEqual({ read: 24576 });
  });

  it("bloatThresholdBytesByTool: partial override MERGES over defaults (unmentioned tools preserved)", () => {
    const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: 99999 } } });
    expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 99999, read: 24576 }); // read default preserved by merge
  });

  it("bloatThresholdBytesByTool: invalid entries dropped with per-entry warn; defaults preserved", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: -1, read: 20480 } } });
      // bash(-1) dropped+warned (bash is not in the default map, so nothing to restore);
      // read(20480) valid → kept. Result is { read: 20480 }.
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ read: 20480 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("nudges.bloatThresholdBytesByTool entry");
    } finally {
      warn.mockRestore();
    }
  });

  it("bloatThresholdBytesByTool: non-record value discarded → default map, one warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: "oops" } });
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ read: 24576 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("nudges.bloatThresholdBytesByTool");
    } finally {
      warn.mockRestore();
    }
  });

  it("bloatThresholdBytesByTool: array is not a record → discarded, one warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: [["bash", 5]] } });
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ read: 24576 });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("bloatThresholdBytesByTool: unknown tool names are kept (forward-compat, spec/09 §4)", () => {
    const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: 99999, custom_tool: 5000 } } });
    expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 99999, read: 24576, custom_tool: 5000 });
  });

  it("bloatThresholdBytesByTool: absent field is NOT warned (absent ≠ invalid)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytes: 100 } }); // byTool absent
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ read: 24576 });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("filters protectedRoles to known selectors; drops unknown entries; non-array → default", () => {
    expect(validateConfig({ rewind: { protectedRoles: ["first:user", "bogus"] } }).rewind.protectedRoles).toEqual(["first:user"]);
    expect(validateConfig({ rewind: { protectedRoles: ["bogus", "nope"] } }).rewind.protectedRoles).toEqual([]);
    expect(validateConfig({ rewind: { protectedRoles: [] } }).rewind.protectedRoles).toEqual([]);
    // non-array → default
    expect(validateConfig({ rewind: { protectedRoles: "first:user" } }).rewind.protectedRoles).toEqual(["first:user", "latest:user"]);
  });

  it("validates estimateConfidence enum; else default 'medium'", () => {
    expect(validateConfig({ audit: { estimateConfidence: "low" } }).audit.estimateConfidence).toBe("low");
    expect(validateConfig({ audit: { estimateConfidence: "high" } }).audit.estimateConfidence).toBe("high");
    expect(validateConfig({ audit: { estimateConfidence: "bogus" } }).audit.estimateConfidence).toBe("medium");
    expect(validateConfig({ audit: { estimateConfidence: 123 } }).audit.estimateConfidence).toBe("medium");
  });

  it("validates log.file: null is valid 'off'; any string accepted; non-string → null", () => {
    expect(validateConfig({ log: { file: "/x.jsonl" } }).log.file).toBe("/x.jsonl");
    expect(validateConfig({ log: { file: null } }).log.file).toBe(null);
    expect(validateConfig({ log: { file: "" } }).log.file).toBe(""); // empty string is a string
    expect(validateConfig({ log: { file: 123 } }).log.file).toBe(null);
  });

  it("ignores unknown keys (forward-compat), incl. shrink.autoOnBloat", () => {
    const cfg = validateConfig({ foo: "bar", rewind: { baz: 1, enabled: false }, shrink: { autoOnBloat: true } });
    expect(cfg.rewind.enabled).toBe(false);
    expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3 }); // autoOnBloat dropped; defaults retained
    expect(cfg).toEqual(validateConfig({ rewind: { enabled: false } }));
  });

  it("NEVER throws on adversarial input (GOTCHA #1)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const throwingProxy = new Proxy({}, { get() { throw new Error("boom"); } });
    expect(() => validateConfig(circular)).not.toThrow();
    expect(() => validateConfig(throwingProxy)).not.toThrow();
    // a throwing getter nested inside an otherwise-valid object also stays safe:
    const tricky = { rewind: { maxDepth: "not-a-number" } };
    expect(() => validateConfig(tricky)).not.toThrow();
    expect(validateConfig(tricky).rewind.maxDepth).toBe(5); // invalid → default, no throw
  });

  it("does not mutate DEFAULT_CONFIG (GOTCHA #2a)", () => {
    const snapshot = structuredClone(DEFAULT_CONFIG);
    validateConfig({ nudges: { bloatThresholdBytes: 1 }, rewind: { maxDepth: 99 } });
    expect(DEFAULT_CONFIG).toEqual(snapshot);
  });

  it("does NOT warn for ABSENT fields in a partial override (warns only on present-but-invalid, spec/09 §4)", () => {
    // A partial valid override must NOT spew warns about its absent sibling fields.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytes: 100 } }); // driftThresholdTokens absent
      expect(cfg.nudges.bloatThresholdBytes).toBe(100);
      expect(cfg.nudges.driftThresholdTokens).toBe(6000); // absent → default, silently
      expect(warn).not.toHaveBeenCalled(); // ZERO warns for a fully-valid partial override
      // …but a present-but-INVALID value DOES warn (exactly once, naming the field):
      warn.mockClear();
      validateConfig({ nudges: { bloatThresholdBytes: -1 } });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("nudges.bloatThresholdBytes");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)", () => {
  it("(a) passes through valid maxActive / staleAfterFires", () => {
    const cfg = validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5 } });
    expect(cfg.shrink.maxActive).toBe(10);
    expect(cfg.shrink.staleAfterFires).toBe(5);
  });

  it("(b) defaults to 32 / 3 with NO warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({});
      expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3 });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) boundary: 1 / 1 is valid (>0)", () => {
    const cfg = validateConfig({ shrink: { maxActive: 1, staleAfterFires: 1 } });
    expect(cfg.shrink.maxActive).toBe(1);
    expect(cfg.shrink.staleAfterFires).toBe(1);
  });

  it("(d) leaves shrink.enabled unchanged when only knobs set", () => {
    const cfg = validateConfig({ shrink: { enabled: false } });
    expect(cfg.shrink).toEqual({ enabled: false, maxActive: 32, staleAfterFires: 3 });
  });

  it("(e) invalid maxActive ∈ {0,-1,NaN,'abc',Infinity} → 32 + exactly 1 warn naming shrink.maxActive", () => {
    for (const bad of [0, -1, NaN, "abc", Infinity]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const cfg = validateConfig({ shrink: { maxActive: bad } });
        expect(cfg.shrink.maxActive).toBe(32);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("shrink.maxActive");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(f) invalid staleAfterFires ∈ {0,-1,NaN,'abc',Infinity} → 3 + exactly 1 warn naming shrink.staleAfterFires", () => {
    for (const bad of [0, -1, NaN, "abc", Infinity]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const cfg = validateConfig({ shrink: { staleAfterFires: bad } });
        expect(cfg.shrink.staleAfterFires).toBe(3);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("shrink.staleAfterFires");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(g) both invalid → 2 warns, both default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ shrink: { maxActive: 0, staleAfterFires: -1 } });
      expect(cfg.shrink.maxActive).toBe(32);
      expect(cfg.shrink.staleAfterFires).toBe(3);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("(h) forward-compat: unknown shrink.autoOnBloat dropped, knobs honored", () => {
    const cfg = validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5, autoOnBloat: true } });
    expect(cfg.shrink.maxActive).toBe(10);
    expect(cfg.shrink.staleAfterFires).toBe(5);
    expect(cfg.shrink).toEqual({ enabled: true, maxActive: 10, staleAfterFires: 5 }); // autoOnBloat dropped
  });

  it("(type) shrink.maxActive / shrink.staleAfterFires are required numbers (type-level)", () => {
    expectTypeOf<MulliganConfig["shrink"]>().toHaveProperty("maxActive").toEqualTypeOf<number>();
    expectTypeOf<MulliganConfig["shrink"]>().toHaveProperty("staleAfterFires").toEqualTypeOf<number>();
  });
});

describe("nudges.driftWindowTurns & nudges.highWaterFraction + driftThresholdTokens 6000 (P3.M3.T1.S1 / spec/09 §2-§4)", () => {
  it("(a) defaults: driftWindowTurns 3, highWaterFraction 0.7, driftThresholdTokens 6000 — NO warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({});
      expect(cfg.nudges.driftWindowTurns).toBe(3);
      expect(cfg.nudges.highWaterFraction).toBe(0.7);
      expect(cfg.nudges.driftThresholdTokens).toBe(6000);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(b) passes through all three valid values together", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8, driftThresholdTokens: 10000 } });
      expect(cfg.nudges.driftWindowTurns).toBe(5);
      expect(cfg.nudges.highWaterFraction).toBe(0.8);
      expect(cfg.nudges.driftThresholdTokens).toBe(10000);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) driftWindowTurns is FLOORED to an integer (5.7 → 5)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { driftWindowTurns: 5.7 } });
      expect(cfg.nudges.driftWindowTurns).toBe(5); // 5.7 finite>0 → coerceNumber returns 5.7 → floor 5
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(d) driftWindowTurns invalid ∈ {0,-1,NaN,'abc',Infinity} → 3 + exactly 1 warn naming nudges.driftWindowTurns", () => {
    for (const bad of [0, -1, NaN, "abc", Infinity]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const cfg = validateConfig({ nudges: { driftWindowTurns: bad } });
        expect(cfg.nudges.driftWindowTurns).toBe(3);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("nudges.driftWindowTurns");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(e) highWaterFraction invalid ∈ {0, 1, -0.5, 1.5, NaN} → 0.7 + exactly 1 warn naming nudges.highWaterFraction", () => {
    for (const bad of [0, 1, -0.5, 1.5, NaN]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const cfg = validateConfig({ nudges: { highWaterFraction: bad } });
        expect(cfg.nudges.highWaterFraction).toBe(0.7);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("nudges.highWaterFraction");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(f) highWaterFraction is NOT string-coerced ('0.7' → 0.7 default + warn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { highWaterFraction: "0.7" } });
      expect(cfg.nudges.highWaterFraction).toBe(0.7);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("nudges.highWaterFraction");
    } finally {
      warn.mockRestore();
    }
  });

  it("(g) highWaterFraction valid near-boundary values 0.01 and 0.99 are KEPT", () => {
    expect(validateConfig({ nudges: { highWaterFraction: 0.01 } }).nudges.highWaterFraction).toBe(0.01);
    expect(validateConfig({ nudges: { highWaterFraction: 0.99 } }).nudges.highWaterFraction).toBe(0.99);
  });

  it("(h) existing nudges knobs UNCHANGED when new knobs are set", () => {
    const cfg = validateConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8 } });
    expect(cfg.nudges.bloatReminder).toBe(true);
    expect(cfg.nudges.perTurnDrift).toBe(true);
    expect(cfg.nudges.bloatThresholdBytes).toBe(16384);
    expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ read: 24576 });
  });

  it("(i) round-trip via setConfig/getConfig", () => {
    setConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8, driftThresholdTokens: 10000 } });
    const cfg = getConfig();
    expect(cfg.nudges.driftWindowTurns).toBe(5);
    expect(cfg.nudges.highWaterFraction).toBe(0.8);
    expect(cfg.nudges.driftThresholdTokens).toBe(10000);
  });

  it("(type) driftWindowTurns / highWaterFraction are required numbers (type-level)", () => {
    expectTypeOf<MulliganConfig["nudges"]>().toHaveProperty("driftWindowTurns").toEqualTypeOf<number>();
    expectTypeOf<MulliganConfig["nudges"]>().toHaveProperty("highWaterFraction").toEqualTypeOf<number>();
  });
});

describe("getConfig / setConfig cache", () => {
  beforeEach(() => {
    setConfig(undefined); // reset the module-level cache to defaults before each test (GOTCHA #9)
  });

  it("getConfig returns validated defaults after a reset", () => {
    expect(getConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("setConfig then getConfig round-trips validated overrides", () => {
    setConfig({ nudges: { bloatThresholdBytes: 100 } });
    expect(getConfig().nudges.bloatThresholdBytes).toBe(100);
  });

  it("setConfig validates/coerces through the cache (invalid → default)", () => {
    setConfig({ nudges: { bloatThresholdBytes: -5 } });
    expect(getConfig().nudges.bloatThresholdBytes).toBe(16384);
  });

  it("getConfig hands out independent copies — the cache cannot be poisoned by callers (GOTCHA #2b)", () => {
    setConfig({ enabled: false });
    const a = getConfig();
    a.enabled = true; // mutate the returned copy
    const b = getConfig();
    expect(b.enabled).toBe(false); // cache unchanged
  });

  it("getConfig never exposes DEFAULT_CONFIG by reference", () => {
    expect(getConfig()).not.toBe(DEFAULT_CONFIG);
    setConfig(DEFAULT_CONFIG);
    expect(getConfig()).not.toBe(DEFAULT_CONFIG); // still a fresh clone
  });

  it("setConfig never throws on garbage input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => setConfig(circular)).not.toThrow();
    expect(() => setConfig(123)).not.toThrow();
    expect(getConfig()).toEqual(DEFAULT_CONFIG); // cache fell back to defaults
  });
});

describe("getConfig lazy init (cache starts null)", () => {
  // vi.resetModules() gives a FRESH module instance → cachedConfig is null again, so the first
  // getConfig() exercises the lazy-init branch. (GOTCHA #9)
  beforeEach(async () => {
    vi.resetModules();
  });

  it("first getConfig() on a fresh module validates defaults lazily", async () => {
    const mod = await import("../src/config.js");
    // (cache is private; we assert behavior, not internals)
    expect(mod.getConfig()).toEqual(DEFAULT_CONFIG);
    // a second call returns an equal (but distinct) config:
    const again = mod.getConfig();
    expect(again).toEqual(DEFAULT_CONFIG);
    expect(again).not.toBe(mod.getConfig()); // still defensive copies
  });
});

// (g) CONFIG-KNOB VALIDATION for the two E22 backstops (spec/09 §4; spec/08 E22).
// rewind.maxRetriesPerPrompt: integer ≥ 1 (Math.floor on the coerced number); non-integer-after-floor or <1 → default 5.
// rewind.abortContextFraction: number in (0,1]; out of range or non-number → default 0.9.
describe("rewind.maxRetriesPerPrompt & rewind.abortContextFraction (P4.M1.T3.S1 / spec/09 §4, spec/08 E22)", () => {
  it("(a) sets both valid overrides", () => {
    const cfg = validateConfig({ rewind: { maxRetriesPerPrompt: 3, abortContextFraction: 0.8 } });
    expect(cfg.rewind.maxRetriesPerPrompt).toBe(3);
    expect(cfg.rewind.abortContextFraction).toBe(0.8);
  });

  it("(b) defaults to 5 / 0.9 when absent (no warn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({});
      expect(cfg.rewind.maxRetriesPerPrompt).toBe(5);
      expect(cfg.rewind.abortContextFraction).toBe(0.9);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) abortContextFraction ∈ {0, 1.5, -0.5, NaN} → 0.9 (+warn naming the field)", () => {
    for (const bad of [0, 1.5, -0.5, NaN]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(validateConfig({ rewind: { abortContextFraction: bad } }).rewind.abortContextFraction).toBe(0.9);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("abortContextFraction");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(d) maxRetriesPerPrompt: 0 → 5; 2.7 → 2 (Math.floor); 'x' → 5", () => {
    expect(validateConfig({ rewind: { maxRetriesPerPrompt: 0 } }).rewind.maxRetriesPerPrompt).toBe(5);
    expect(validateConfig({ rewind: { maxRetriesPerPrompt: 2.7 } }).rewind.maxRetriesPerPrompt).toBe(2);
    expect(validateConfig({ rewind: { maxRetriesPerPrompt: "x" } }).rewind.maxRetriesPerPrompt).toBe(5);
  });

  it("(e) existing rewind knobs unchanged when the new knobs are set", () => {
    const cfg = validateConfig({ rewind: { maxRetriesPerPrompt: 3, abortContextFraction: 0.8 } });
    expect(cfg.rewind.enabled).toBe(true);
    expect(cfg.rewind.protectedRoles).toEqual(["first:user", "latest:user"]);
    expect(cfg.rewind.maxDepth).toBe(5);
    expect(cfg.rewind.requireMutationWarning).toBe(true);
  });
});