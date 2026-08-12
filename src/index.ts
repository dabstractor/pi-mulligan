import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setConfig, getConfig } from "./config.js";
import { loadMulliganConfig } from "./settings.js";
import { setLogFile } from "./log.js";
import { resetRuntime, clearAll } from "./runtime.js";
import { registerFilterHandler } from "./filter.js";
import { registerBloatReminder, registerTurnEndMetric } from "./nudges.js";
import { makeRewindTool } from "./tools/rewind.js";
import { makeShrinkTool } from "./tools/shrink.js";
import { auditTool } from "./tools/audit.js";
import { makeCancelTool } from "./tools/cancel.js"; // 4th agent-callable tool (P3.M1.T3.S1)
import { makeCheckpointCommand, makeCheckpointRevokeCommand } from "./commands.js"; // 2 human slash commands (P2.M1.T1.S1)

/**
 * Mulligan — Pi extension factory (spec/01 §1, spec/03 §4, spec/11 §8 Step 8).
 *
 * The single entry point (package.json `main` + `pi.extensions`). Wires all 4 agent-callable tools,
 * the 3 event-driven handlers (context filter + 2 nudges), the 2 human slash commands
 * (/mulligan_checkpoint, /mulligan_checkpoint_revoke — spec/13 §2–§3; v1.1 replaces the v1
 * mulligan_checkpoint agent tool, E23 RESOLVED), and the session lifecycle (runtime reset /
 * full cleanup). /mulligan_audit is added by P2.M2.T1.S2. Config loads from merged Pi settings
 * (global ~/.pi/agent + project-local <cwd>/.pi)
 * via loadMulliganConfig → setConfig; absent/invalid settings fail-open to validated DEFAULT_CONFIG
 * (enabled:true, log off).
 *
 * SYNC (no async work; spec/01 §1 allows async but it is unnecessary). Does NOT start long-lived
 * resources (spec/01 §1; Mulligan has none). Does NOT wrap in try/catch — fail-FAST on wiring errors at
 * bootstrap; the individual handlers (contextHandler/bloatReminderHandler/turnEndMetricHandler) already
 * self-protect for fail-open (spec/03 #4), and config loading is fail-open inside loadMulliganConfig +
 * setConfig (absent/invalid settings → DEFAULT_CONFIG, never a throw).
 *
 * @param pi the Pi ExtensionAPI passed by the host at load time
 */
export default function (pi: ExtensionAPI): void {
  // 1. Load + cache config at factory time. loadMulliganConfig reads + deep-merges the GLOBAL
  //    (~/.pi/agent/settings.json, via getAgentDir) and PROJECT-LOCAL (<cwd>/.pi/settings.json)
  //    Pi settings and returns the raw `mulligan` block; setConfig validates + caches it (→
  //    validateConfig). cwd is process.cwd() here because the factory has NO ctx (lifecycle asymmetry,
  //    D4); the session_start handler below re-reads with the authoritative ctx.cwd (P1.M1.T2.S2).
  //    Never throws: loadMulliganConfig is fail-open (→ undefined) and setConfig is fail-open (→
  //    DEFAULT_CONFIG), so an absent/corrupt settings file always boots to validated defaults.
  setConfig(loadMulliganConfig(process.cwd()));

  // 2. Point the logger at the configured destination (after the cache is populated). null = off (default).
  setLogFile(getConfig().log.file);

  // 3. Register all 4 agent-callable tools (spec/03 §2.1; v1.1: mulligan_checkpoint moved to a human
  //    slash command — spec/05 §3). rewind/shrink/cancel are FACTORIES capturing `pi` via closure (their
  //    execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …) but execute() does NOT receive pi).
  //    auditTool is a PLAIN const (audit needs no pi).
  pi.registerTool(makeRewindTool(pi));
  pi.registerTool(makeShrinkTool(pi));
  pi.registerTool(auditTool);
  pi.registerTool(makeCancelTool(pi)); // 4th tool — marker retraction (P3.M1.T3.S1 / E21)

  // 4. Register the 2 human slash commands (spec/13 §2–§3; v1.1 replaces the v1 mulligan_checkpoint
  //    agent tool — E23 RESOLVED). Both are FACTORIES capturing `pi` via closure (mirroring the tool
  //    factories above). No try/catch — fail-fast by design (GOTCHA #7).
  pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));
  pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi));

  // 5. Arm the 3 event-driven handlers (each is a thin pi.on seam; fail-open lives INSIDE each handler).
  registerFilterHandler(pi); // pi.on("context", contextHandler)          — the filter heart
  registerBloatReminder(pi); // pi.on("tool_result", bloatReminderHandler) — Nudge A
  registerTurnEndMetric(pi); // pi.on("turn_end", …)                       — Nudge B Phase 1

  // 6. session_start → re-read config with the AUTHORITATIVE ctx.cwd on EVERY reason
  //    (startup|reload|new|resume|fork) — fulfills spec/09 §1 ("re-read on /reload"). The factory
  //    (step 1) loaded config with process.cwd() because it had no ctx (lifecycle asymmetry, D4);
  //    here ctx.cwd is the real project root, so this is the correct place to re-read. Doubly
  //    fail-open: loadMulliganConfig is fail-open (→ undefined) and setConfig is fail-open (→
  //    DEFAULT_CONFIG), so a corrupt/changed settings file never crashes a reload (NO try/catch).
  //    setLogFile re-points the logger AFTER the cache is repopulated (reads getConfig().log.file —
  //    D6; must follow setConfig). _event.reason is available but intentionally NOT branched on (all
  //    reasons re-read identically). resetRuntime is the tail and reads sessionId FRESH (C12; never
  //    cache a sessionManager handle). A resumed/reloaded session starts from clean in-memory control
  //    state; persisted markers are untouched and remain the source of truth.
  pi.on("session_start", (_event, ctx) => {
    setConfig(loadMulliganConfig(ctx.cwd));
    setLogFile(getConfig().log.file);
    resetRuntime(ctx.sessionManager.getSessionId());
  });

  // 7. session_shutdown → wipe ALL per-session runtimes (full process teardown). Never throws.
  pi.on("session_shutdown", () => {
    clearAll();
  });
}