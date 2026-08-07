import { describe, it, expectTypeOf, expect } from "vitest";
import {
  DEFAULT_CONFIG,
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
        bloatThresholdBytes: 8192,
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