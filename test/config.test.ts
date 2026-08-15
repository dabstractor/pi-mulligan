import { describe, it, expectTypeOf, expect, beforeEach, vi } from "vitest";
import os from "node:os";
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
      shrink: { enabled: true, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 },           // no autoOnBloat (not v1)
      revert: {
        enabled: false,
        allowDeleteCreatedFiles: false,
        nonGitMode: "cas",
        storageDir: null,
        maxFileBytes: 10485760,
        maxTotalBytes: 134217728,
        maxSnapshotsPerTurn: 64,
        excludeGlobs: [".git", "node_modules", "dist", "build", ".next", ".venv", "target"],
      },
      nudges: {
        bloatReminder: true,
        perTurnDrift: true,
        bloatThresholdBytes: 16384,
        bloatThresholdBytesByTool: { read: 24576 },
        driftThresholdTokens: 4000,
        driftWindowTurns: 3,
        highWaterFraction: 0.7,
      },
      audit: { estimateConfidence: "medium" },
      ui: { activeCheckpointBanner: true },
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
    expect(cfg.nudges.driftThresholdTokens).toBe(4000); // unchanged default (BUG-003: lowered from 6000)
    expect(cfg.enabled).toBe(true); // unchanged
  });

  it("applies a full valid override", () => {
    const cfg = validateConfig({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false },
      shrink: { enabled: false, maxActive: 8, staleAfterFires: 2 },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1 },
      audit: { estimateConfidence: "low" },
      ui: { activeCheckpointBanner: false },
      log: { file: "/tmp/mulligan.jsonl" },
    });
    expect(cfg).toEqual({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, maxRetriesPerPrompt: 5, abortContextFraction: 0.9, requireMutationWarning: false },
      shrink: { enabled: false, maxActive: 8, staleAfterFires: 2, notifyMaxChars: 2048 },
      revert: {
        enabled: false,
        allowDeleteCreatedFiles: false,
        nonGitMode: "cas",
        storageDir: null,
        maxFileBytes: 10485760,
        maxTotalBytes: 134217728,
        maxSnapshotsPerTurn: 64,
        excludeGlobs: [".git", "node_modules", "dist", "build", ".next", ".venv", "target"],
      },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1, bloatThresholdBytesByTool: { read: 24576 }, driftWindowTurns: 3, highWaterFraction: 0.7 },
      audit: { estimateConfidence: "low" },
      ui: { activeCheckpointBanner: false },
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
    expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 }); // autoOnBloat dropped; defaults retained
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
      expect(cfg.nudges.driftThresholdTokens).toBe(4000); // absent → default, silently
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
      expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 });
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
    expect(cfg.shrink).toEqual({ enabled: false, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 });
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
    expect(cfg.shrink).toEqual({ enabled: true, maxActive: 10, staleAfterFires: 5, notifyMaxChars: 2048 }); // autoOnBloat dropped
  });

  it("(i) maxActive fractional value that floors below 1 (0.5) → falls back to default 32, SILENT (BUG-003)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ shrink: { maxActive: 0.5 } });
      expect(cfg.shrink.maxActive).toBe(32); // Math.floor(0.5)===0, 0 < 1 → default (was 0.5 before the fix)
      expect(warn).not.toHaveBeenCalled();   // silent fallback, matching maxRetriesPerPrompt
    } finally {
      warn.mockRestore();
    }
  });

  it("(j) staleAfterFires fractional value that floors below 1 (0.5) → falls back to default 3, SILENT (BUG-003)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ shrink: { staleAfterFires: 0.5 } });
      expect(cfg.shrink.staleAfterFires).toBe(3); // Math.floor(0.5)===0, 0 < 1 → default (was 0.5 before the fix)
      expect(warn).not.toHaveBeenCalled();         // silent fallback, matching maxRetriesPerPrompt
    } finally {
      warn.mockRestore();
    }
  });

  it("(type) shrink.maxActive / shrink.staleAfterFires are required numbers (type-level)", () => {
    expectTypeOf<MulliganConfig["shrink"]>().toHaveProperty("maxActive").toEqualTypeOf<number>();
    expectTypeOf<MulliganConfig["shrink"]>().toHaveProperty("staleAfterFires").toEqualTypeOf<number>();
  });
});

describe("nudges.driftWindowTurns & nudges.highWaterFraction + driftThresholdTokens 4000 (P3.M3.T1.S1 / spec/09 §2-§4, BUG-003)", () => {
  it("(a) defaults: driftWindowTurns 3, highWaterFraction 0.7, driftThresholdTokens 4000 — NO warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({});
      expect(cfg.nudges.driftWindowTurns).toBe(3);
      expect(cfg.nudges.highWaterFraction).toBe(0.7);
      expect(cfg.nudges.driftThresholdTokens).toBe(4000);
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

  it("(c-bis) driftWindowTurns fractional value that floors below 1 (0.5) → falls back to default 3 SILENTLY (BUG-002)", () => {
    // 0.5 passes coerceNumber's >0 gate (no warn), then Math.floor(0.5)===0 → 0 < 1 → guard falls back to the
    // default SILENTLY (no warn), exactly mirroring maxRetriesPerPrompt. Before the fix this stored 0, which
    // collapsed shouldNudge's recentMetrics.slice(0,0) → empty deltas → permanent bloat-only fallback.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { driftWindowTurns: 0.5 } });
      expect(cfg.nudges.driftWindowTurns).toBe(3); // Math.floor(0.5)===0, 0 < 1 → default (was 0 before the fix)
      expect(warn).not.toHaveBeenCalled(); // silent fallback, matching maxRetriesPerPrompt (GOTCHA #1)
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

// ── shrink.notifyMaxChars (P1.M2.T1.S3 / spec/09 §4) ─────────────────────────────────────
// Mirrors the shrink.maxActive & shrink.staleAfterFires block. validateConfig coerces with
// coerceNumber(field, v, default, mustBePositive:true): invalid (<=0 / non-finite / non-numeric) → 2048 + warn.
describe("shrink.notifyMaxChars (P1.M2.T1.S3 / spec/09 §4)", () => {
  it("(a) passes through a valid value", () => {
    expect(validateConfig({ shrink: { notifyMaxChars: 100 } }).shrink.notifyMaxChars).toBe(100);
  });

  it("(b) defaults to 2048 with NO warn when absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ shrink: {} }).shrink.notifyMaxChars).toBe(2048);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) boundary 1 is valid (threshold must be >0)", () => {
    expect(validateConfig({ shrink: { notifyMaxChars: 1 } }).shrink.notifyMaxChars).toBe(1);
  });

  it("(d) leaves the other shrink fields unchanged when only notifyMaxChars is set", () => {
    const cfg = validateConfig({ shrink: { enabled: false, notifyMaxChars: 100 } });
    expect(cfg.shrink).toEqual({ enabled: false, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 100 });
  });

  it("(e) invalid values fall back to 2048 with exactly one warn naming the field", () => {
    for (const bad of [0, -1, "x", NaN, Infinity] as unknown[]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const cfg = validateConfig({ shrink: { notifyMaxChars: bad } });
        expect(cfg.shrink.notifyMaxChars).toBe(2048);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("shrink.notifyMaxChars");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(type) shrink.notifyMaxChars is a required number", () => {
    expectTypeOf<MulliganConfig["shrink"]>().toHaveProperty("notifyMaxChars").toEqualTypeOf<number>();
  });
});

// ── ui.activeCheckpointBanner (P2.M3.T1.S1 / spec/09 §2-§4, spec/13 §5) ──────────────────────
// v1.1 active-checkpoint banner knob. validateConfig coerces with coerceBoolean (value, fallback) =>
// value===undefined ? fallback : !!value (spec/09 §4: booleans coerce with !!, NEVER warn).
// Non-record `ui` sub-object is silently ignored, matching audit/log/shrink/nudges block handling.
// Consumed (out of scope here) by reconcileBanner (P2.M3.T1.S2); S1 is config-surface only.
describe("ui.activeCheckpointBanner (P2.M3.T1.S1 / spec/09 §2-§4, spec/13 §5)", () => {
  it("(a) passes through a valid boolean", () => {
    expect(validateConfig({ ui: { activeCheckpointBanner: false } }).ui.activeCheckpointBanner).toBe(false);
    expect(validateConfig({ ui: { activeCheckpointBanner: true } }).ui.activeCheckpointBanner).toBe(true);
  });

  it("(b) defaults to true with NO warn when absent (spec/09 §4 — booleans never warn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({}).ui.activeCheckpointBanner).toBe(true);          // top-level ui absent
      expect(validateConfig({ ui: {} }).ui.activeCheckpointBanner).toBe(true);  // ui present, field absent
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) coerces with !! — non-empty string truthy, null falsy (matches `enabled`; GOTCHA #3)", () => {
    expect(validateConfig({ ui: { activeCheckpointBanner: 1 } }).ui.activeCheckpointBanner).toBe(true);
    expect(validateConfig({ ui: { activeCheckpointBanner: 0 } }).ui.activeCheckpointBanner).toBe(false);
    expect(validateConfig({ ui: { activeCheckpointBanner: "false" } }).ui.activeCheckpointBanner).toBe(true); // non-empty string → truthy
    expect(validateConfig({ ui: { activeCheckpointBanner: null } }).ui.activeCheckpointBanner).toBe(false);   // !!null → false
  });

  it("(d) non-record ui value → whole block silently ignored, default true, NO warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ ui: "oops" }).ui.activeCheckpointBanner).toBe(true);
      expect(validateConfig({ ui: [1, 2] }).ui.activeCheckpointBanner).toBe(true); // array is not a record
      expect(validateConfig({ ui: null }).ui.activeCheckpointBanner).toBe(true);   // null is not a record
      expect(warn).not.toHaveBeenCalled(); // matches audit/log/shrink/nudges block handling
    } finally {
      warn.mockRestore();
    }
  });

  it("(e) round-trip via setConfig/getConfig", () => {
    setConfig({ ui: { activeCheckpointBanner: false } });
    expect(getConfig().ui.activeCheckpointBanner).toBe(false);
  });

  it("(type) ui.activeCheckpointBanner is a required boolean", () => {
    expectTypeOf<MulliganConfig["ui"]>().toHaveProperty("activeCheckpointBanner").toEqualTypeOf<boolean>();
  });
});

// ── revert.* (P1.M1.T1.S1 / spec/14 §8, spec/09 §2-§4) ─────────────────────────────────────
// v1.2 opt-in working-tree revert config block. validateConfig deep-merges over the INERT
// defaults (enabled:false). Mirrors the shrink/ui block shape (safeGet → isRecord → per-field
// coerce). The storageDir "must not resolve inside cwd" rule is the one non-trivial piece.
describe("revert.* (P1.M1.T1.S1 / spec/14 §8, spec/09 §2-§4)", () => {
  const REVERT_DEFAULT = {
    enabled: false,
    allowDeleteCreatedFiles: false,
    nonGitMode: "cas",
    storageDir: null,
    maxFileBytes: 10485760,
    maxTotalBytes: 134217728,
    maxSnapshotsPerTurn: 64,
    excludeGlobs: [".git", "node_modules", "dist", "build", ".next", ".venv", "target"],
  };

  it("(a) defaults to the spec/14 §8 block with NO warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({}).revert).toEqual(REVERT_DEFAULT);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(b) passes through a full valid override", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({
        revert: {
          enabled: true,
          allowDeleteCreatedFiles: true,
          nonGitMode: "explicit-paths",
          storageDir: os.tmpdir(),
          maxFileBytes: 1000,
          maxTotalBytes: 2000,
          maxSnapshotsPerTurn: 3,
          excludeGlobs: ["foo", "bar"],
        },
      });
      expect(cfg.revert).toEqual({
        enabled: true,
        allowDeleteCreatedFiles: true,
        nonGitMode: "explicit-paths",
        storageDir: os.tmpdir(),
        maxFileBytes: 1000,
        maxTotalBytes: 2000,
        maxSnapshotsPerTurn: 3,
        excludeGlobs: ["foo", "bar"],
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) enabled/allowDeleteCreatedFiles coerce with !! (never warn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { enabled: 1 } }).revert.enabled).toBe(true);
      expect(validateConfig({ revert: { enabled: 0 } }).revert.enabled).toBe(false);
      expect(validateConfig({ revert: { allowDeleteCreatedFiles: "x" } }).revert.allowDeleteCreatedFiles).toBe(true);
      expect(validateConfig({ revert: { allowDeleteCreatedFiles: null } }).revert.allowDeleteCreatedFiles).toBe(false);
      expect(warn).not.toHaveBeenCalled(); // booleans never warn
    } finally {
      warn.mockRestore();
    }
  });

  it("(d) nonGitMode: 'cas'/'explicit-paths' kept; invalid → 'cas' + 1 warn", () => {
    expect(validateConfig({ revert: { nonGitMode: "explicit-paths" } }).revert.nonGitMode).toBe("explicit-paths");
    expect(validateConfig({ revert: { nonGitMode: "cas" } }).revert.nonGitMode).toBe("cas");
    for (const bad of ["bogus", 123, null, "CAS", "explicit_paths"]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(validateConfig({ revert: { nonGitMode: bad } }).revert.nonGitMode).toBe("cas");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("revert.nonGitMode");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(e) storageDir: null valid; string-outside-cwd valid; string-inside-cwd → null + warn; non-string → null + warn", () => {
    // null → null, no warn
    let warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { storageDir: null } }).revert.storageDir).toBe(null);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    // string outside cwd → kept, no warn
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { storageDir: os.tmpdir() } }).revert.storageDir).toBe(os.tmpdir());
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    // relative path resolving inside repo cwd → null + warn
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { storageDir: "./local-revert" } }).revert.storageDir).toBe(null);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("revert.storageDir");
    } finally {
      warn.mockRestore();
    }
    // cwd itself (rel === "") → null + warn
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { storageDir: process.cwd() } }).revert.storageDir).toBe(null);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("revert.storageDir");
    } finally {
      warn.mockRestore();
    }
    // non-string → null + warn
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { storageDir: 42 } }).revert.storageDir).toBe(null);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("revert.storageDir");
    } finally {
      warn.mockRestore();
    }
  });

  it("(f) maxFileBytes/maxTotalBytes/maxSnapshotsPerTurn: finite >0; invalid → default + 1 warn each", () => {
    const fields: Array<[keyof typeof REVERT_DEFAULT, string]> = [
      ["maxFileBytes", "revert.maxFileBytes"],
      ["maxTotalBytes", "revert.maxTotalBytes"],
      ["maxSnapshotsPerTurn", "revert.maxSnapshotsPerTurn"],
    ];
    for (const [field, label] of fields) {
      for (const bad of [0, -1, NaN, Infinity, "x"]) {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const cfg = validateConfig({ revert: { [field]: bad } });
          expect(cfg.revert[field]).toBe(REVERT_DEFAULT[field]);
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0][0]).toContain(label);
        } finally {
          warn.mockRestore();
        }
      }
      // boundary 1 is valid (must be >0)
      expect(validateConfig({ revert: { [field]: 1 } }).revert[field]).toBe(1);
    }
  });

  it("(g) excludeGlobs: string[] kept; non-array → default + 1 warn; non-string elements dropped", () => {
    // valid string array kept
    expect(validateConfig({ revert: { excludeGlobs: ["foo", "bar"] } }).revert.excludeGlobs).toEqual(["foo", "bar"]);
    // non-array → default + 1 warn
    let warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { excludeGlobs: "not-array" } }).revert.excludeGlobs).toEqual(REVERT_DEFAULT.excludeGlobs);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("revert.excludeGlobs");
    } finally {
      warn.mockRestore();
    }
    // non-string elements dropped with per-entry warn
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: { excludeGlobs: [1, "ok", null, "ok2"] } }).revert.excludeGlobs).toEqual(["ok", "ok2"]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toContain("revert.excludeGlobs entry");
      expect(warn.mock.calls[1][0]).toContain("revert.excludeGlobs entry");
    } finally {
      warn.mockRestore();
    }
  });

  it("(h) non-record revert block → all defaults SILENTLY (no warn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ revert: "oops" }).revert).toEqual(REVERT_DEFAULT);
      expect(validateConfig({ revert: [1, 2] }).revert).toEqual(REVERT_DEFAULT);
      expect(validateConfig({ revert: null }).revert).toEqual(REVERT_DEFAULT); // null is not a record
      expect(warn).not.toHaveBeenCalled(); // matches ui/audit/shrink/nudges block handling
    } finally {
      warn.mockRestore();
    }
  });

  it("(i) round-trip via setConfig/getConfig", () => {
    setConfig({ revert: { enabled: true } });
    const cfg = getConfig();
    expect(cfg.revert.enabled).toBe(true);
    // the other 7 fields are still the defaults (deep-merge holds)
    expect(cfg.revert.allowDeleteCreatedFiles).toBe(false);
    expect(cfg.revert.nonGitMode).toBe("cas");
    expect(cfg.revert.storageDir).toBe(null);
    expect(cfg.revert.maxFileBytes).toBe(10485760);
    expect(cfg.revert.maxTotalBytes).toBe(134217728);
    expect(cfg.revert.maxSnapshotsPerTurn).toBe(64);
    expect(cfg.revert.excludeGlobs).toEqual(REVERT_DEFAULT.excludeGlobs);
  });

  it("(type) revert fields are correctly typed", () => {
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("enabled").toEqualTypeOf<boolean>();
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("allowDeleteCreatedFiles").toEqualTypeOf<boolean>();
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("nonGitMode").toEqualTypeOf<"cas" | "explicit-paths">();
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("storageDir").toEqualTypeOf<string | null>();
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("maxFileBytes").toEqualTypeOf<number>();
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("maxTotalBytes").toEqualTypeOf<number>();
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("maxSnapshotsPerTurn").toEqualTypeOf<number>();
    expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("excludeGlobs").toEqualTypeOf<string[]>();
  });
});