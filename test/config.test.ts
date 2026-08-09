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
        requireMutationWarning: true,
      },
      shrink: { enabled: true },           // no autoOnBloat (not v1)
      nudges: {
        bloatReminder: true,
        perTurnDrift: true,
        bloatThresholdBytes: 16384,
        bloatThresholdBytesByTool: { bash: 32768, read: 20480 },
        driftThresholdTokens: 3000,
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
    expect(cfg.nudges.driftThresholdTokens).toBe(3000); // unchanged default
    expect(cfg.enabled).toBe(true); // unchanged
  });

  it("applies a full valid override", () => {
    const cfg = validateConfig({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false },
      shrink: { enabled: false },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1 },
      audit: { estimateConfidence: "low" },
      log: { file: "/tmp/mulligan.jsonl" },
    });
    expect(cfg).toEqual({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false },
      shrink: { enabled: false },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1, bloatThresholdBytesByTool: { bash: 32768, read: 20480 } },
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

  it("default bloatThresholdBytesByTool is the per-tool map { bash: 32768, read: 20480 }", () => {
    expect(validateConfig({}).nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
  });

  it("bloatThresholdBytesByTool: partial override MERGES over defaults (unmentioned tools preserved)", () => {
    const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: 99999 } } });
    expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 99999, read: 20480 }); // read preserved
  });

  it("bloatThresholdBytesByTool: invalid entries dropped with per-entry warn; defaults preserved", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: -1, read: 20480 } } });
      // bash(-1) dropped+warned → default 32768 preserved by merge; read(20480) valid → kept
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
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
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
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
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("bloatThresholdBytesByTool: unknown tool names are kept (forward-compat, spec/09 §4)", () => {
    const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: 99999, custom_tool: 5000 } } });
    expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 99999, read: 20480, custom_tool: 5000 });
  });

  it("bloatThresholdBytesByTool: absent field is NOT warned (absent ≠ invalid)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytes: 100 } }); // byTool absent
      expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
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
    expect(cfg.shrink).toEqual({ enabled: true }); // autoOnBloat dropped; default shrink.enabled retained
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
      expect(cfg.nudges.driftThresholdTokens).toBe(3000); // absent → default, silently
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