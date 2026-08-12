import { resolve, relative, isAbsolute } from "node:path";

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
    /** Max CONSECUTIVE rewinds re-landing at the same latest user prompt before the tool
     *  refuses (the runaway-loop bound; `@08-edge-cases.md` E22). Distinct from `maxDepth`
     *  (which bounds cumulative markers): a loop can persist while re-bloating between
     *  rewinds, so depth alone cannot stop it. Integer >= 1. Default: 5. Consumed by
     *  P4.M1.T2.S1 (the per-prompt retry budget guard in src/tools/rewind.ts). */
    maxRetriesPerPrompt: number;
    /** Wall-clock backstop: refuse any rewind once the filtered-context estimate reaches
     *  this fraction of the model's window (catches the zero-marker loop vector the
     *  retry budget cannot see; `@08-edge-cases.md` E22). Number in (0,1]. Default: 0.9
     *  (leaves headroom below the provider's "Prompt too long" rejection). Consumed by
     *  P4.M1.T2.S2 (the context-fraction stop guard in src/tools/rewind.ts). */
    abortContextFraction: number;
    /** If true, the rewind tool appends a warning when the hidden span contained write /
     *  side-effecting tool calls (those effects PERSIST on disk). Default: true. */
    requireMutationWarning: boolean;
  };

  /** Shrink operation (`mulligan_shrink`) settings. */
  shrink: {
    /** Enable the shrink tool/feature. Default: true. */
    enabled: boolean;
    /** Cap on simultaneous active shrink markers; when exceeded the oldest is retired.
     *  Mirrors rewind.maxDepth as a bound on marker accumulation. Positive integer (>= 1;
     *  fractional values that floor below 1 fall back to the default).
     *  Default: 32. Source: spec/09-configuration.md §2/§3. Consumed by P3.M2.T3. */
    maxActive: number;
    /** Auto-retire a pinned shrink whose target is absent for this many consecutive
     *  fires. Positive integer (>= 1; fractional values that floor below 1 fall back to the default).
     *  Default: 3. Source: spec/09-configuration.md §2/§3.
     *  Consumed by P3.M2.T3. */
    staleAfterFires: number;
    /** Caps the replacement text shown to the operator via ctx.ui.notify when a shrink is recorded —
     *  a pure UI side-channel with ZERO context cost (the tool result itself stays terse). Must be > 0.
     *  Default: 2048. Source: spec/09-configuration.md §3; spec/05-tools.md §2.
     *  Consumed by P1.M2.T1.S2 (the shrink operator echo). */
    notifyMaxChars: number;
    // NOTE: "autoOnBloat" is reserved for a FUTURE opt-in mode and is NOT in v1
    //       (spec/07 §nudges: "Auto-shrink would risk data loss"). Do not add it.
  };

  /** Working-tree revert operation (`mulligan_rewind` file restoration) settings — v1.2,
   *  opt-in. The whole block is INERT until `enabled` is set true AND the agent passes the
   *  per-call revert flags on rewind (spec/14 §1 three-layer opt-in). Source: spec/14 §8,
   *  spec/09 §2/§3. */
  revert: {
    /** Master opt-in. false (default) → snapshot machinery is fully inert (no capture, no
     *  overhead). The rewind tool still accepts the per-call flags but ignores them.
     *  Default: false. (spec/14 §1, spec/09 §2/§3) */
    enabled: boolean;
    /** Global kill-switch on the destructive delete path. Deletion is the one irreversible
     *  revert action, so it sits behind BOTH the per-call `delete_created_files` flag AND
     *  this config gate (both required). Default: false. (spec/14 §1, spec/09 §3) */
    allowDeleteCreatedFiles: boolean;
    /** Non-git capture strategy. "cas" (default — comprehensive whole-tree snapshot) or
     *  "explicit-paths" (conservative — only write/edit tool paths; bash not captured; the
     *  pi-undo-redo model). Git workspaces use the GitBackend regardless. Default: "cas".
     *  (spec/14 §4.1/§4.2, spec/09 §3) */
    nonGitMode: "cas" | "explicit-paths";
    /** Root dir for the shadow repo / CAS store, or null for the default
     *  `<sessionDir>/mulligan/`. MUST NOT resolve inside cwd (would pollute the workspace) —
     *  validateConfig rejects such a value with null + warn. Default: null. (spec/14 §8,
     *  spec/09 §3/§4) */
    storageDir: string | null;
    /** Per-file byte cap; files larger than this are skipped + warned (fail-closed — a huge
     *  gitignored data file is never silently claimed restorable). Must be > 0.
     *  Default: 262144 (256 KB). (spec/14 §8, spec/09 §3/§4) */
    maxFileBytes: number;
    /** Per-session byte cap for capture; capture stops (best-effort partial snapshot) beyond
     *  it. Must be > 0. Default: 33554432 (32 MB). (spec/14 §8, spec/09 §3/§4) */
    maxTotalBytes: number;
    /** Count cap on snapshots captured per turn; capture stops accepting new data beyond it.
     *  Must be > 0. Default: 64. (spec/14 §8, spec/09 §3/§4) */
    maxSnapshotsPerTurn: number;
    /** Snapshot exclude globs for BOTH backends. `.gitignore` is deliberately NOT consulted —
     *  a gitignored `.env` is exactly the file a revert must restore. Non-array → default list.
     *  Default: [".git","node_modules","dist","build",".next",".venv","target"].
     *  (spec/14 §4.3/§8, spec/09 §3/§4) */
    excludeGlobs: string[];
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
     *  Must be > 0. Default: 16384 (16 KB). Per-tool overrides in bloatThresholdBytesByTool
     *  take precedence over this global value for the listed tools. */
    bloatThresholdBytes: number;
    /** Optional per-tool override map. Keys are Pi tool names (e.g. "read"); values
     *  are byte thresholds. A tool not listed falls back to bloatThresholdBytes. Default:
     *  { read: 24576 }. `bash` is intentionally NOT listed — it is the primary bloat surface,
     *  so it falls back to the 16 KB global default to stay maximally sensitive; `read` gets
     *  a higher bar (24 KB) because large source-file reads are routine and legitimate. */
    bloatThresholdBytesByTool?: Record<string, number>;
    /** Turn token-delta above which the per-turn drift nudge fires. Must be > 0.
     *  Default 4000. The moving-average over driftWindowTurns (default 3) compared with `>=` satisfies all three
     *  spec/07 §5.1 acceptance criteria: (a) a single 8k turn amid small turns averages <4000 → no fire;
     *  (b) three ~4k turns average ~4000 >= 4000 → fire; (c) a single large result with ~0 net growth averages
     *  ~0 → no fire. (Lowered from 6000 + `>=` — BUG-003: at 6000 with `>`, criterion (b) never fired.) */
    driftThresholdTokens: number;
    /** Rolling window (in turns) over which the per-turn token delta is smoothed
     *  before thresholding (spec/07 §5.1). Positive integer (>= 1; fractional values that floor below 1
     *  silently fall back to the default — BUG-002). Default: 3. Consumed
     *  by shouldNudge (P3.M3.T4) + readMarkers recent-metrics window (P3.M3.T3). */
    driftWindowTurns: number;
    /** Fraction of the context window at which the §5.2 high-water annotation
     *  fires (edge-triggered — once on crossing, cleared when total drops back
     *  below). Must be in the open interval (0,1). Default: 0.7. Consumed by
     *  shouldHighWater (P3.M3.T5) + contextHandler (P3.M3.T6). */
    highWaterFraction: number;
  };

  /** Audit tool (`mulligan_audit`) settings. */
  audit: {
    /** Confidence label reported with token estimates. Default: "medium". */
    estimateConfidence: EstimateConfidence;
  };

  /** UI settings (operator-facing surfaces). */
  ui: {
    /** v1.1: shows the persistent above-prompt-box banner (`ctx.ui.setWidget`,
     *  placement:"aboveEditor") while ≥1 user-set checkpoint is active, so the operator does not
     *  forget they have armed destructive cross-prompt rewind power (spec/08 E26, spec/13 §5).
     *  Disablable WITHOUT disabling checkpoints. Default: true. Source: spec/09 §2/§3.
     *  Consumed by reconcileBanner (P2.M3.T1.S2). */
    activeCheckpointBanner: boolean;
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
    maxRetriesPerPrompt: 5,
    abortContextFraction: 0.9,
    requireMutationWarning: true,
  },
  shrink: {
    enabled: true,
    maxActive: 32,
    staleAfterFires: 3,
    notifyMaxChars: 2048,
  },
  revert: {
    enabled: false,
    allowDeleteCreatedFiles: false,
    nonGitMode: "cas",
    storageDir: null,
    maxFileBytes: 262144,
    maxTotalBytes: 33554432,
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
  audit: {
    estimateConfidence: "medium",
  },
  ui: {
    activeCheckpointBanner: true,
  },
  log: {
    file: null,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// S2 (P1.M1.T2.S2) — lazy cache + fail-safe validation (spec/09-configuration.md §1, §4)
// APPENDED below the S1 exports (Granularity, EstimateConfidence, MulliganConfig, DEFAULT_CONFIG),
// which are UNCHANGED. This module still imports NOTHING from Pi — settings are handed in via setConfig().
// ─────────────────────────────────────────────────────────────────────────────

/** Known protectedRoles selector strings (spec/09 §4). v1 supports exactly these two. */
const KNOWN_PROTECTED_ROLES = new Set<string>(["first:user", "latest:user"]);

/**
 * Session cache of the validated config. `null` until the first getConfig()/setConfig().
 * Re-validated and replaced on every setConfig() (the re-read-on-/reload seam is index.ts, P1.M7.T1).
 */
let cachedConfig: MulliganConfig | null = null;

/**
 * getConfig() — the public read API (spec/09 §1: "loaded lazily on first use and cached for the session").
 *
 * LAZY: on the first call (cache empty) it validates DEFAULT_CONFIG and caches the result.
 * DEFENSIVE COPY: a fresh structuredClone is returned on EVERY call, so a caller can never mutate the
 * shared session cache (or DEFAULT_CONFIG). The clone is cheap (~10 fields, microseconds) relative to an
 * LLM inference. Callers MUST still treat the result as read-only.
 */
export function getConfig(): MulliganConfig {
  let cfg = cachedConfig;
  if (cfg === null) {
    cfg = validateConfig(undefined);
    cachedConfig = cfg;
  }
  return structuredClone(cfg);
}

/**
 * setConfig() — initialize / replace the session cache from a raw settings object (spec/09 §1).
 * Called from the index.ts factory / session_start handler (and again on /reload). Accepts the merged Pi
 * settings object (or settings.mulligan); the caller is responsible for extraction (config.ts is Pi-free).
 * NEVER throws: any error resets the cache to validated defaults.
 */
export function setConfig(raw: unknown): void {
  try {
    cachedConfig = validateConfig(raw);
  } catch {
    cachedConfig = validateConfig(undefined);
  }
}

/**
 * validateConfig() — the pure, fail-safe validation engine (spec/09 §4).
 *
 * Deep-merges `raw` over a clone of DEFAULT_CONFIG, validates + coerces each known field per the §4 rules,
 * ignores unknown keys (forward-compat), and returns a fully-valid MulliganConfig. NEVER throws: the entire
 * body is wrapped in try/catch; on ANY error (e.g. a Proxy with a throwing trap) it returns a fresh clone
 * of DEFAULT_CONFIG. Exported so unit tests can exercise it directly.
 */
export function validateConfig(raw: unknown): MulliganConfig {
  try {
    // Start from a deep clone so the shared DEFAULT_CONFIG singleton is NEVER mutated (GOTCHA #2a).
    const cfg: MulliganConfig = structuredClone(DEFAULT_CONFIG);
    if (!isRecord(raw)) {
      // null / primitive / array / non-record → all defaults.
      return cfg;
    }

    // Each known field is read via safeGet (which returns `undefined` for ABSENT properties and for a
    // throwing Proxy `get` trap). The `if (v !== undefined)` guard therefore SKIPS absent fields (they
    // keep their default with NO warn — spec/09 §4 warns only on present-but-invalid values) and only runs
    // the coercer on a genuinely-present value. (GOTCHA #1)
    let v: unknown;

    // Top-level master switch.
    v = safeGet(raw, "enabled");
    if (v !== undefined) cfg.enabled = coerceBoolean(v, cfg.enabled);

    // rewind.*
    const rewindRaw = safeGet(raw, "rewind");
    if (isRecord(rewindRaw)) {
      v = safeGet(rewindRaw, "enabled");
      if (v !== undefined) cfg.rewind.enabled = coerceBoolean(v, cfg.rewind.enabled);
      v = safeGet(rewindRaw, "protectedRoles");
      if (v !== undefined) cfg.rewind.protectedRoles = coerceProtectedRoles(v, cfg.rewind.protectedRoles);
      v = safeGet(rewindRaw, "maxDepth");
      if (v !== undefined) cfg.rewind.maxDepth = coerceNumber("rewind.maxDepth", v, cfg.rewind.maxDepth, false);
      v = safeGet(rewindRaw, "maxRetriesPerPrompt");
      if (v !== undefined) {
        const n = coerceNumber("rewind.maxRetriesPerPrompt", v, cfg.rewind.maxRetriesPerPrompt, true);
        cfg.rewind.maxRetriesPerPrompt = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt;
      }
      v = safeGet(rewindRaw, "abortContextFraction");
      if (v !== undefined) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1) cfg.rewind.abortContextFraction = v;
        else warnConfig("rewind.abortContextFraction", v);
      }
      v = safeGet(rewindRaw, "requireMutationWarning");
      if (v !== undefined) cfg.rewind.requireMutationWarning = coerceBoolean(v, cfg.rewind.requireMutationWarning);
    }

    // shrink.*  (autoOnBloat intentionally NOT honored — reserved, not v1; S1 GOTCHA #1)
    const shrinkRaw = safeGet(raw, "shrink");
    if (isRecord(shrinkRaw)) {
      v = safeGet(shrinkRaw, "enabled");
      if (v !== undefined) cfg.shrink.enabled = coerceBoolean(v, cfg.shrink.enabled);
      v = safeGet(shrinkRaw, "maxActive");
      if (v !== undefined) {
        const n = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
        cfg.shrink.maxActive = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.maxActive;
      }
      v = safeGet(shrinkRaw, "staleAfterFires");
      if (v !== undefined) {
        const n = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
        cfg.shrink.staleAfterFires = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.staleAfterFires;
      }
      v = safeGet(shrinkRaw, "notifyMaxChars");
      if (v !== undefined) cfg.shrink.notifyMaxChars = coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true);
    }

    // revert.* (v1.2 working-tree revert; spec/14 §8, spec/09 §2/§4)
    const revertRaw = safeGet(raw, "revert");
    if (isRecord(revertRaw)) {
      v = safeGet(revertRaw, "enabled");
      if (v !== undefined) cfg.revert.enabled = coerceBoolean(v, cfg.revert.enabled);
      v = safeGet(revertRaw, "allowDeleteCreatedFiles");
      if (v !== undefined) cfg.revert.allowDeleteCreatedFiles = coerceBoolean(v, cfg.revert.allowDeleteCreatedFiles);
      v = safeGet(revertRaw, "nonGitMode");
      if (v !== undefined) cfg.revert.nonGitMode = coerceNonGitMode(v, cfg.revert.nonGitMode);
      v = safeGet(revertRaw, "storageDir");
      if (v !== undefined) cfg.revert.storageDir = coerceStorageDir(v, cfg.revert.storageDir);
      v = safeGet(revertRaw, "maxFileBytes");
      if (v !== undefined) cfg.revert.maxFileBytes = coerceNumber("revert.maxFileBytes", v, cfg.revert.maxFileBytes, true);
      v = safeGet(revertRaw, "maxTotalBytes");
      if (v !== undefined) cfg.revert.maxTotalBytes = coerceNumber("revert.maxTotalBytes", v, cfg.revert.maxTotalBytes, true);
      v = safeGet(revertRaw, "maxSnapshotsPerTurn");
      if (v !== undefined) cfg.revert.maxSnapshotsPerTurn = coerceNumber("revert.maxSnapshotsPerTurn", v, cfg.revert.maxSnapshotsPerTurn, true);
      v = safeGet(revertRaw, "excludeGlobs");
      if (v !== undefined) cfg.revert.excludeGlobs = coerceExcludeGlobs(v, cfg.revert.excludeGlobs);
    }

    // nudges.*
    const nudgesRaw = safeGet(raw, "nudges");
    if (isRecord(nudgesRaw)) {
      v = safeGet(nudgesRaw, "bloatReminder");
      if (v !== undefined) cfg.nudges.bloatReminder = coerceBoolean(v, cfg.nudges.bloatReminder);
      v = safeGet(nudgesRaw, "perTurnDrift");
      if (v !== undefined) cfg.nudges.perTurnDrift = coerceBoolean(v, cfg.nudges.perTurnDrift);
      v = safeGet(nudgesRaw, "bloatThresholdBytes");
      if (v !== undefined) cfg.nudges.bloatThresholdBytes = coerceNumber("nudges.bloatThresholdBytes", v, cfg.nudges.bloatThresholdBytes, true);
      v = safeGet(nudgesRaw, "driftThresholdTokens");
      if (v !== undefined) cfg.nudges.driftThresholdTokens = coerceNumber("nudges.driftThresholdTokens", v, cfg.nudges.driftThresholdTokens, true);
      v = safeGet(nudgesRaw, "driftWindowTurns");
      if (v !== undefined) {
        const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
        cfg.nudges.driftWindowTurns = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.nudges.driftWindowTurns;
      }
      v = safeGet(nudgesRaw, "highWaterFraction");
      if (v !== undefined) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1) cfg.nudges.highWaterFraction = v;
        else warnConfig("nudges.highWaterFraction", v);
      }
      v = safeGet(nudgesRaw, "bloatThresholdBytesByTool");
      if (v !== undefined) cfg.nudges.bloatThresholdBytesByTool = coerceBloatThresholdByTool(v, cfg.nudges.bloatThresholdBytesByTool);
    }

    // audit.*
    const auditRaw = safeGet(raw, "audit");
    if (isRecord(auditRaw)) {
      v = safeGet(auditRaw, "estimateConfidence");
      if (v !== undefined) cfg.audit.estimateConfidence = coerceEstimateConfidence(v, cfg.audit.estimateConfidence);
    }

    // ui.* (v1.1: active-checkpoint banner; spec/09 §2/§4, spec/13 §5)
    const uiRaw = safeGet(raw, "ui");
    if (isRecord(uiRaw)) {
      v = safeGet(uiRaw, "activeCheckpointBanner");
      if (v !== undefined) cfg.ui.activeCheckpointBanner = coerceBoolean(v, cfg.ui.activeCheckpointBanner);
    }

    // log.*  (opening/writing the file is log.ts / P1.M1.T3 — NOT this module)
    const logRaw = safeGet(raw, "log");
    if (isRecord(logRaw)) {
      v = safeGet(logRaw, "file");
      if (v !== undefined) cfg.log.file = coerceLogFile(v, cfg.log.file);
    }

    return cfg;
  } catch {
    // NEVER throw (spec/09 §4). Adversarial input (e.g. a throwing Proxy trap) → all defaults.
    return structuredClone(DEFAULT_CONFIG);
  }
}

// ── private helpers (module-local; not exported) ─────────────────────────────

/** True for plain records and Object.create(null); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a property without throwing (a Proxy `get` trap may throw). Returns `undefined` if the property
 *  is absent OR the read throws — both are treated as "not provided" (keep default, no warn). */
function safeGet(obj: object, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Boolean: coerce with `!!` (spec/09 §4). Absent (undefined) → fallback. Present (incl. null) → `!!value`. */
function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : !!value;
}

/** Number: must be a finite number; `mustBePositive` enforces `> 0` (else `>= 0`). Invalid-present → fallback + warn. */
function coerceNumber(field: string, value: unknown, fallback: number, mustBePositive: boolean): number {
  if (typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0)) {
    return value;
  }
  warnConfig(field, value);
  return fallback;
}

/** protectedRoles: array of known selectors; unknown entries dropped (per-entry warn). Non-array → fallback + warn. */
function coerceProtectedRoles(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    warnConfig("rewind.protectedRoles", value);
    return fallback;
  }
  const known: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && KNOWN_PROTECTED_ROLES.has(entry)) {
      known.push(entry);
    } else {
      warnConfig("rewind.protectedRoles entry", entry);
    }
  }
  return known;
}

/** bloatThresholdBytesByTool: per-tool override map (spec/09 §4). Non-record → fallback + warn.
 *  Record entries: keep finite numbers > 0, drop invalid (per-entry warn). MERGES over fallback so
 *  default entries are preserved for tools the user did not mention. Unknown tool names are kept
 *  (forward-compat). `fallback` is optional only to satisfy the optional interface field's
 *  `| undefined` type at the call site — at runtime it is always the cloned default map. */
function coerceBloatThresholdByTool(
  value: unknown,
  fallback?: Record<string, number>,
): Record<string, number> {
  if (!isRecord(value)) {
    warnConfig("nudges.bloatThresholdBytesByTool", value);
    return fallback ?? {};
  }
  const result: Record<string, number> = { ...(fallback ?? {}) };
  for (const [toolName, threshold] of Object.entries(value)) {
    if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0) {
      result[toolName] = threshold;
    } else {
      warnConfig("nudges.bloatThresholdBytesByTool entry", { [toolName]: threshold });
    }
  }
  return result;
}

/** nonGitMode: must be one of "cas"|"explicit-paths"; else fallback + warn (spec/09 §4). */
function coerceNonGitMode(value: unknown, fallback: "cas" | "explicit-paths"): "cas" | "explicit-paths" {
  if (value === "cas" || value === "explicit-paths") return value;
  warnConfig("revert.nonGitMode", value);
  return fallback;
}

/** storageDir: null (valid — default) or a string that MUST NOT resolve inside process.cwd()
 *  (spec/14 §8: "NEVER under cwd"). A value that resolves inside cwd → null + warn.
 *  Non-string/non-null → null + warn. Mirrors coerceLogFile's null-is-valid handling. */
function coerceStorageDir(value: unknown, fallback: string | null): string | null {
  if (value === null) return fallback;            // explicit "use default" — valid, no warn
  if (typeof value !== "string") {
    warnConfig("revert.storageDir", value);
    return fallback;                              // non-string → null (default)
  }
  // Reject if the resolved path is inside cwd (would pollute the workspace).
  const cwd = resolve(process.cwd());
  const resolved = resolve(cwd, value);
  const rel = relative(cwd, resolved);
  const insideCwd = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (insideCwd) {
    warnConfig("revert.storageDir", value);
    return fallback;                              // inside cwd → null (default)
  }
  return value;
}

/** excludeGlobs: array of strings; non-array → fallback + warn. Non-string elements
 *  dropped with a per-entry warn (mirrors coerceProtectedRoles' per-entry discipline).
 *  Any non-empty string is valid (NO domain restriction, unlike protectedRoles).
 *  spec/09 §4, spec/14 §8. */
function coerceExcludeGlobs(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    warnConfig("revert.excludeGlobs", value);
    return fallback;
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
    else warnConfig("revert.excludeGlobs entry", entry);
  }
  return out;
}

/** estimateConfidence: must be one of low|medium|high; else fallback + warn. */
function coerceEstimateConfidence(value: unknown, fallback: EstimateConfidence): EstimateConfidence {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  warnConfig("audit.estimateConfidence", value);
  return fallback;
}

/** log.file: null (off — no warn) or any string (opening deferred); non-string → fallback + warn. */
function coerceLogFile(value: unknown, fallback: string | null): string | null {
  if (value === null) return fallback; // explicit "off" — valid
  if (typeof value === "string") return value;
  warnConfig("log.file", value);
  return fallback;
}

/** Fail-safe warn (spec/09 §4: "log a warn naming the field and the value"). Uses console.warn until the
 *  structured JSONL logger (log.ts, P1.M1.T3) ships; that task should re-point this single helper. */
function warnConfig(field: string, value: unknown): void {
  try {
    console.warn(`[mulligan] config: invalid "${field}"=${safeStringify(value)}, using default`);
  } catch {
    /* never throw — logging must not crash the extension */
  }
}

/** JSON.stringify that never throws (circular refs / BigInt → String()). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
