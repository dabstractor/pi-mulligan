import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setConfig, getConfig } from "./config.js";
import { loadMulliganConfig } from "./settings.js";
import { setLogFile, log } from "./log.js";
import {
  resetRuntime,
  clearAll,
  getRuntime,
  getActiveStores,
} from "./runtime.js";
import { registerFilterHandler } from "./filter.js";
import { registerBloatReminder, registerTurnEndMetric } from "./nudges.js";
import {
  registerTurnStartCapture,
  registerAgentEndCapture,
  gcTurnSnapshots,
} from "./capture.js";
import { detectAndCreate } from "./snapshot/store.js";
import { makeRewindTool } from "./tools/rewind.js";
import { makeShrinkTool } from "./tools/shrink.js";
import { auditTool } from "./tools/audit.js";
import { makeCancelTool } from "./tools/cancel.js"; // 4th agent-callable tool (P3.M1.T3.S1)
import {
  makeCheckpointCommand,
  makeCheckpointRevokeCommand,
  makeAuditCommand,
} from "./commands.js"; // 3 human slash commands (P2.M1.T1.S1 + P2.M2.T1.S1)
import { reconcileBanner } from "./banner.js"; // [P2.M3.T1.S3 / spec/13 §5] restore/refresh the active-checkpoint banner at the refresh points

/**
 * Mulligan — Pi extension factory (spec/01 §1, spec/03 §4, spec/11 §8 Step 8).
 *
 * The single entry point (package.json `main` + `pi.extensions`). Wires all 4 agent-callable tools,
 * the 3 event-driven handlers (context filter + 2 nudges), the 3 human slash commands
 * (/mulligan_checkpoint, /mulligan_checkpoint_revoke — spec/13 §2–§3; v1.1 replaces the v1
 * mulligan_checkpoint agent tool, E23 RESOLVED; and /mulligan_audit — spec/13 §4, the human's direct
 * path to the same context-bloat diagnostic the agent's mulligan_audit tool produces), and the
 * session lifecycle (runtime reset / full cleanup). Config loads from merged Pi settings
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

  // 4. Register the 3 human slash commands (spec/13 §2–§4; v1.1 replaces the v1 mulligan_checkpoint
  //    agent tool — E23 RESOLVED). All three are FACTORIES capturing `pi` via closure (mirroring the
  //    tool factories above). makeAuditCommand's `pi` is captured for registration-uniformity but
  //    UNUSED — its reads go through ctx/pure helpers (spec/13 §4; P2.M2.T1.S1). No try/catch — fail-fast.
  pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));
  pi.registerCommand(
    "mulligan_checkpoint_revoke",
    makeCheckpointRevokeCommand(pi),
  );
  pi.registerCommand("mulligan_audit", makeAuditCommand(pi)); // human-facing audit (spec/13 §4) — SAME report
  //   as the agent's mulligan_audit tool, surfaced to the human via ctx.ui.notify (never event.messages).

  // 5. Arm the 4 event-driven handlers (each is a thin pi.on seam; fail-open lives INSIDE each handler).
  registerFilterHandler(pi); // pi.on("context", contextHandler)          — the filter heart
  registerBloatReminder(pi); // pi.on("tool_result", bloatReminderHandler) — Nudge A
  registerTurnEndMetric(pi); // pi.on("turn_end", …)                       — Nudge B Phase 1
  registerTurnStartCapture(pi); // pi.on("turn_start", …) — v1.2 working-tree revert prompt-boundary
  // GC + capture("turn"). Self-guards on revert.enabled (fail-open).
  registerAgentEndCapture(pi); // pi.on("agent_end", …) — v1.2 working-tree revert: capture("turn-after")
  // for the dirty guard (E30). Self-guards on revert.enabled (fail-open).

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
  pi.on("session_start", async (_event, ctx) => {
    setConfig(loadMulliganConfig(ctx.cwd));
    setLogFile(getConfig().log.file);
    const sid = ctx.sessionManager.getSessionId(); // FRESH (C12); read once, reuse below
    resetRuntime(sid);
    reconcileBanner(ctx); // [P2.M3.T1.S3 / spec/13 §5] restore the banner on every session start
    // (startup|reload|new|resume|fork) — so /resume never silently drops the reminder.
    // Bare call (no wrapper): reconcileBanner NEVER throws (S2), matching the handler's
    // fail-open convention (its other callees are also fail-open).

    // [P3.M1.T2.S1 / spec/14 §5] v1.2 working-tree revert: create the per-session store (cached
    // on rt.store) + run the prompt-boundary GC pass (reuses turn_start's gcTurnSnapshots) to clear
    // stale turn/* refs left on disk by a RELOADED instance (E32 — "session_start runs the same
    // pass"). detectAndCreate NEVER rejects (→ NoOpStore on any error, E28); gcTurnSnapshots NEVER
    // throws. The try/catch is belt-and-suspenders for this CRITICAL path — a store failure must
    // NEVER block config reload / runtime reset / banner reconcile.
    //
    // [P1.M2.T1.S1 / spec/14 §5 / E32] BUG-002 fix: AFTER gcTurnSnapshots, rebuild rt.snapshots from
    // the persisted mulligan:revert-checkpoint control entries (/mulligan_checkpoint's step 4b write).
    // E32 ("post-reload snapshot loss → RESOLVED in v1.2") requires the read-side: resetRuntime wiped
    // rt.snapshots, so a /resume re-reads the {label, ref, backend} control data, reconstructs each
    // RevertCheckpoint (beforeRef←ref, turnIndex:-1, no afterRef — checkpoints capture once), verifies
    // the ref still exists via store.has(ref) (fail-open skip on absent/NoOpStore), and repopulates the
    // Map so a checkpoint-granularity rewind finds its snapshot. Best-effort: a malformed entry or
    // missing ref is skipped; a rebuild failure never blocks session_start.
    if (!getConfig().revert.enabled) return; // layer-1 gate (default false → zero capture, zero storage)
    try {
      const rt = getRuntime(sid); // the FRESH runtime resetRuntime just (re)created (store undefined, empty snapshots)
      rt.store = await detectAndCreate(ctx.cwd, getConfig().revert); // create + cache (NEVER rejects → NoOpStore)
      await gcTurnSnapshots(rt); // REUSE capture.ts's pass — gc() drops all turn/* refs on disk + clears in-memory
      // [P1.M2.T1.S1 / spec/14 §5 / E32] BUG-002 fix: rebuild rt.snapshots from the persisted
      // mulligan:revert-checkpoint control entries that /mulligan_checkpoint wrote (commands.ts step 4b).
      // resetRuntime above wiped rt.snapshots to a fresh empty Map; a /resume must RE-read the refs so a
      // later checkpoint-granularity rewind finds its snapshot (E32 "post-reload snapshot loss → RESOLVED
      // in v1.2"). Runs AFTER gcTurnSnapshots (which exempts ckpt:* refs) so surviving checkpoint refs are
      // confirmed by has(). Purely additive; a malformed/absent ref is skipped (fail-open) — a rebuild
      // failure NEVER blocks session_start (the outer try/catch + per-entry try/catch both cover it).
      try {
        let entries: unknown;
        try {
          entries = ctx.sessionManager.getEntries(); // read FRESH (C12)
        } catch {
          entries = undefined; // getEntries threw → no rebuild (fail-open)
        }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
            try {
              const ee = e as { type?: unknown; customType?: unknown; data?: unknown };
              if (ee.type !== "custom") continue;
              if (ee.customType !== "mulligan:revert-checkpoint") continue;
              const data = ee.data;
              if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
              const d = data as { label?: unknown; ref?: unknown; backend?: unknown };
              if (typeof d.label !== "string" || d.label.length === 0) continue;
              if (typeof d.ref !== "string" || d.ref.length === 0) continue;
              if (d.backend !== "git" && d.backend !== "cas") continue;
              // optional E32 verification: the ref must STILL exist in the store (survived gc / storage
              // intact). NoOpStore.has→false (backend 'none' ⇒ nothing to restore); a throw ⇒ skip.
              let present = true;
              try {
                present = await rt.store!.has(d.ref);
              } catch {
                present = false;
              }
              if (!present) continue;
              rt.snapshots?.set(d.label, {
                label: d.label,
                backend: d.backend,
                beforeRef: d.ref,
                turnIndex: -1, // checkpoint sentinel (matches commands.ts step 4b)
                ts: Date.now(),
              });
            } catch {
              // a throwing-Proxy entry → skip (fail-open, never throw on the session_start path)
            }
          }
        }
      } catch {
        // belt-and-suspenders — the outer session_start catch already covers this; keep the rebuild isolated
      }
    } catch (e) {
      try {
        log("error", "session_start.store", sid, { error: String(e) });
      } catch {
        /* log() never throws, but be safe */
      }
    }
  });

  // 7. session_shutdown → wipe ALL per-session runtimes (full process teardown). Never throws.
  pi.on("session_shutdown", async () => {
    // [P3.M1.T2.S1 / spec/14 §5] v1.2 working-tree revert: best-effort destroy every session's
    // snapshot store (git shadow repo / CAS dir) BEFORE clearAll() wipes the runtime map — "Both
    // stores are deleted entirely on session_shutdown (no cross-session buildup)." A destroy
    // failure is swallowed — teardown never blocks clearAll/exit. (getActiveStores() is read BEFORE
    // clearAll() — it enumerates the now-still-present runtimes.)
    for (const store of getActiveStores()) {
      try {
        await store.destroy(); // backend-agnostic: git → rm shadowDir; cas → rm storageDir; none → no-op
      } catch {
        /* best-effort — a store.destroy failure never blocks teardown / clearAll */
      }
    }
    clearAll();
  });
}
