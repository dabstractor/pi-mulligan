import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setConfig, getConfig } from "./config.js";
import { setLogFile } from "./log.js";
import { resetRuntime, clearAll } from "./runtime.js";
import { registerFilterHandler } from "./filter.js";
import { registerBloatReminder, registerTurnEndMetric } from "./nudges.js";
import { makeRewindTool } from "./tools/rewind.js";
import { makeShrinkTool } from "./tools/shrink.js";
import { makeCheckpointTool } from "./tools/checkpoint.js";
import { auditTool } from "./tools/audit.js";
import { makeCancelTool } from "./tools/cancel.js"; // 5th agent-callable tool (P3.M1.T3.S1)

/**
 * Mulligan — Pi extension factory (spec/01 §1, spec/03 §4, spec/11 §8 Step 8).
 *
 * The single entry point (package.json `main` + `pi.extensions`). Wires all 5 agent-callable tools,
 * the 3 event-driven handlers (context filter + 2 nudges), and the session lifecycle (runtime reset /
 * full cleanup). Zero-config: setConfig(undefined) → validated DEFAULT_CONFIG (enabled:true, log off).
 *
 * SYNC (no async work; spec/01 §1 allows async but it is unnecessary). Does NOT start long-lived
 * resources (spec/01 §1; Mulligan has none). Does NOT wrap in try/catch — fail-FAST on wiring errors at
 * bootstrap; the individual handlers (contextHandler/bloatReminderHandler/turnEndMetricHandler) already
 * self-protect for fail-open (spec/03 #4).
 *
 * @param pi the Pi ExtensionAPI passed by the host at load time
 */
export default function (pi: ExtensionAPI): void {
  // 1. Load + cache config at factory time (v1: validated defaults — no Pi settings accessor in v1;
  //    setConfig(undefined) → DEFAULT_CONFIG; reading real settings.mulligan is v1.1). Never throws.
  setConfig(undefined);

  // 2. Point the logger at the configured destination (after the cache is populated). null = off (default).
  setLogFile(getConfig().log.file);

  // 3. Register all 5 agent-callable tools. rewind/shrink/checkpoint/cancel are FACTORIES capturing `pi`
  //    via closure (their execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …)/setCheckpoint(pi, …)
  //    but execute() does NOT receive pi). auditTool is a PLAIN const (audit needs no pi).
  pi.registerTool(makeRewindTool(pi));
  pi.registerTool(makeShrinkTool(pi));
  pi.registerTool(makeCheckpointTool(pi));
  pi.registerTool(auditTool);
  pi.registerTool(makeCancelTool(pi)); // 5th tool — marker retraction (P3.M1.T3.S1 / E21)

  // 4. Arm the 3 event-driven handlers (each is a thin pi.on seam; fail-open lives INSIDE each handler).
  registerFilterHandler(pi); // pi.on("context", contextHandler)          — the filter heart
  registerBloatReminder(pi); // pi.on("tool_result", bloatReminderHandler) — Nudge A
  registerTurnEndMetric(pi); // pi.on("turn_end", …)                       — Nudge B Phase 1

  // 5. session_start → reset this session's runtime (read sessionId FRESH — C12; never cache a
  //    sessionManager handle). A resumed/reloaded session starts from clean in-memory control state;
  //    persisted markers are untouched and remain the source of truth. Never branches on reason.
  pi.on("session_start", (_event, ctx) => {
    resetRuntime(ctx.sessionManager.getSessionId());
  });

  // 6. session_shutdown → wipe ALL per-session runtimes (full process teardown). Never throws.
  pi.on("session_shutdown", () => {
    clearAll();
  });
}