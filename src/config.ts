/**
 * Granularity — the unit a rewind targets.
 * - "last_tool_call_group": hide just the most recent tool interaction (surgical).
 * - "last_turn":            hide everything after the most recent user message (redo the turn).
 * - "checkpoint":           hide back to a named checkpoint set via mulligan_checkpoint.
 * Source: spec/12-glossary.md §Granularity, spec/05-tools.md §1 (RewindParams).
 */
export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";

/**
 * EstimateConfidence — honesty label reported alongside token estimates.
 * Token accounting is approximate; this conveys how approximate. Default "medium".
 * Source: spec/04-data-model.md §7, spec/09-configuration.md §2.
 */
export type EstimateConfidence = "low" | "medium" | "high";

/**
 * MulliganConfig — the shape of the `"mulligan"` object read from Pi `settings.json`
 * (global `~/.pi/agent/settings.json` and/or project-local `<project>/.pi/settings.json`,
 * project-local overriding global). Every option has a safe default; the extension works with
 * zero configuration. Unknown keys are ignored; type-mismatched values fall back to the
 * default (handled by getConfig in config.ts S2). Source of truth: spec/09-configuration.md.
 */
export interface MulliganConfig {
  /** Master switch. false → the entire extension is a no-op (no context transform, tools
   *  refuse cleanly). Default: true. */
  enabled: boolean;

  /** Rewind operation (`mulligan_rewind`) settings. */
  rewind: {
    /** Enable the rewind tool/feature. Default: true. */
    enabled: boolean;
    /** Message selectors that can never be rewound past. v1 known selectors: "first:user"
     *  (the original task) and "latest:user" (the current ask). Unknown entries ignored.
     *  Default: ["first:user", "latest:user"]. */
    protectedRoles: string[];
    /** Max simultaneous active mulligan:rewind markers on a branch. Bounds marker
     *  accumulation (markers are permanent). Default: 5. */
    maxDepth: number;
    /** If true, the rewind tool appends a warning when the hidden span contained write /
     *  side-effecting tool calls (those effects PERSIST on disk). Default: true. */
    requireMutationWarning: boolean;
  };

  /** Shrink operation (`mulligan_shrink`) settings. */
  shrink: {
    /** Enable the shrink tool/feature. Default: true. */
    enabled: boolean;
    // NOTE: "autoOnBloat" is reserved for a FUTURE opt-in mode and is NOT in v1
    //       (spec/07 §nudges: "Auto-shrink would risk data loss"). Do not add it.
  };

  /** Preventive nudge settings (advisory; ride inferences that were already happening). */
  nudges: {
    /** Annotate a tool_result when a single result exceeds bloatThresholdBytes. Default: true. */
    bloatReminder: boolean;
    /** Inject a one-line context drift nudge when a turn grew past driftThresholdTokens.
     *  Default: true. */
    perTurnDrift: boolean;
    /** In-context byte size of a single tool result above which the bloat reminder fires.
     *  Below Pi's ~50 KB built-in cap to catch meaningful-but-not-catastrophic results.
     *  Must be > 0. Default: 8192 (8 KB). */
    bloatThresholdBytes: number;
    /** Turn token-delta above which the per-turn drift nudge fires. Must be > 0.
     *  Default: 3000. */
    driftThresholdTokens: number;
  };

  /** Audit tool (`mulligan_audit`) settings. */
  audit: {
    /** Confidence label reported with token estimates. Default: "medium". */
    estimateConfidence: EstimateConfidence;
  };

  /** Structured logging settings (the primary observability surface in non-TUI modes). */
  log: {
    /** Absolute path to an append-only JSONL debug log, or null to disable. If set, opening
     *  is deferred to first write and wrapped so a bad path never crashes the extension.
     *  Default: null (off). */
    file: string | null;
  };
}

/**
 * DEFAULT_CONFIG — the zero-configuration defaults for MulliganConfig.
 * CONSTANT: do not mutate. getConfig() (S2) returns a freshly-merged copy built atop this
 * object (deep-cloned before user overrides are applied), never this object itself.
 * Source of truth: spec/09-configuration.md §2.
 */
export const DEFAULT_CONFIG: MulliganConfig = {
  enabled: true,
  rewind: {
    enabled: true,
    protectedRoles: ["first:user", "latest:user"],
    maxDepth: 5,
    requireMutationWarning: true,
  },
  shrink: {
    enabled: true,
  },
  nudges: {
    bloatReminder: true,
    perTurnDrift: true,
    bloatThresholdBytes: 8192,
    driftThresholdTokens: 3000,
  },
  audit: {
    estimateConfidence: "medium",
  },
  log: {
    file: null,
  },
};