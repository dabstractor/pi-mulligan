/**
 * capture.ts — the v1.2 working-tree-revert capture hooks (spec/14-working-tree-revert.md §5). Houses
 * the `turn_start` capture hook (prompt-boundary GC + capture("turn")) + the shared `gcTurnSnapshots`
 * helper reused by the session_start GC (P3.M1.T2.S1). Distinct concern from nudges.ts (the v1.1
 * preventive nudges); this module holds the v1.2 working-tree snapshot lifecycle.
 *
 * spec/14-working-tree-revert.md §5 (capture lifecycle & retention — the prompt-boundary GC pass:
 * at each new prompt (turn_start), BEFORE capturing the new turn's snapshot, the store deletes every
 * refs/mulligan/snapshots/turn/* ref + gc's the shadow repo / mark-sweeps the CAS; checkpoints are
 * exempt — separate namespace; a git gc / CAS mark-sweep failure is logged and NEVER blocks the turn),
 * §2 (the SnapshotStore interface — reads rt.store), §4.3 (AsyncMutex serializes capture/dirtyCheck/
 * restore/retire/gc), §6 (restore consumes rt.snapshots.get("turn").beforeRef);
 * spec/08-edge-cases.md E27 (best-effort fail-open — the handler NEVER throws);
 * architecture/codebase_patterns.md §6 (event-handler registration pattern — mirrors
 * registerBloatReminder/registerTurnEndMetric in nudges.ts) + §8 (store-threading decision: the store
 * handle lives on SessionRuntime, read via rt.store).
 *
 * DESIGN:
 * - The `turn_start` hook is the CAPTURE HALF of the file-revert feature: it runs prompt-boundary GC
 *   FIRST (drop all prior turns' turn/* refs + reclaim + clear in-memory turn/*), THEN captures("turn")
 *   and stores its before-ref in rt.snapshots so a last_turn rewind (P4.M2.T1.S1 step 6b) can restore
 *   the working tree to the turn's start. The after-ref (agent_end, P3.M1.T1.S2) makes dirtyCheck
 *   effective; this task delivers the before-ref.
 * - GC FIRST, then capture (PRD §5: "BEFORE capturing the new turn's snapshot"). Safe because no
 *   non-checkpoint rewind crosses a prompt boundary — last_turn/last_tool_call_group only ever target
 *   the current turn, so once a new prompt arrives every prior turn's snapshots are dead.
 * - NEVER throws (E27): the WHOLE handler body is ONE try/catch → log + return. Read sessionId FIRST
 *   inside the try{} so the catch{} can log it (nudges.ts GOTCHA #1). ASYNC (Pi awaits event handlers;
 *   awaits store.gc()/capture()).
 * - FAIL-OPEN gating order: config.revert.enabled (layer 1, FIRST check) → rt.store (undefined until
 *   P3.M1.T2.S1 wires detectAndCreate at session_start) → (gc) → backend!=="none" (NoOpStore — nothing
 *   to capture) → capture. Each gate is a clean no-op return when the feature is inert.
 * - Unconditional registration (registerTurnStartCapture is always called by index.ts step 5); the
 *   gate lives INSIDE the handler, so registering is free when revert is off (mirrors
 *   registerBloatReminder).
 */
import type {
  TurnStartEvent,
  AgentEndEvent,
  ExtensionContext,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { getRuntime } from "./runtime.js";
import type { SessionRuntime } from "./runtime.js";
import { log } from "./log.js";

/**
 * gcTurnSnapshots — the prompt-boundary reclamation pass for a session's working-tree snapshots
 * (spec/14 §5). Drops ALL `turn/*` snapshot refs/manifests on disk (via `rt.store.gc()` — the whole
 * turn namespace, reclaiming prior turns whose in-memory entry no longer exists) AND physically
 * reclaims (`git gc --auto --prune=now` / CAS blob mark-sweep). `checkpoint/*` is EXEMPT (gc() only
 * touches turn/*). Then clears the in-memory `turn/*` entries from rt.snapshots (checkpoint entries
 * preserved). BEST-EFFORT: gc() never rejects; this fn never throws. EXPORTED so the session_start GC
 * (P3.M1.T2.S1) reuses the SAME pass to clear stale turn/* refs from a reloaded instance (PRD §5).
 *
 * @param rt the live per-session runtime (reads rt.store + rt.snapshots). No-op if rt.store is unset.
 */
export async function gcTurnSnapshots(rt: SessionRuntime): Promise<void> {
  if (!rt.store) return;
  try {
    await rt.store.gc(); // drop all turn/* refs on disk + reclaim; checkpoint/* exempt; never rejects
  } catch {
    /* belt-and-suspenders: gc() is best-effort by contract, but never let a throw escape */
  }
  // clear in-memory turn/* entries (checkpoint:<name> entries do NOT start with "turn" → preserved).
  for (const key of [...(rt.snapshots?.keys() ?? [])]) {
    if (key.startsWith("turn")) rt.snapshots?.delete(key);
  }
}

/**
 * turnStartCaptureHandler — the v1.2 turn_start capture hook (spec/14 §5). At the start of each agent
 * turn: (1) run prompt-boundary GC FIRST (drop all prior turns' turn/* refs + reclaim), then (2)
 * capture("turn") and store its before-ref in rt.snapshots so a last_turn rewind (P4.M2.T1.S1 step 6b)
 * can restore the working tree to the turn's start. Safe because no non-checkpoint rewind crosses a
 * prompt boundary. ASYNC (Pi awaits event handlers; awaits store.gc()/capture()).
 *
 * NEVER throws (E27): the WHOLE body is ONE try/catch → log + return. Read sessionId FIRST so the catch
 * can log it. Self-guards on config.revert.enabled (layer 1) + rt.store (undefined until P3.M1.T2.S1
 * wires it) + backend!=="none" (NoOpStore — nothing to capture). Best-effort: a capture/GC failure is
 * logged and the turn proceeds (the before-ref is simply absent → file-revert degrades to skipped).
 *
 * @param event { type:"turn_start"; turnIndex; timestamp } (TurnStartEvent — exported by pi).
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12).
 */
export async function turnStartCaptureHandler(
  event: TurnStartEvent,
  ctx: ExtensionContext,
): Promise<void> {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so the catch can log it
    if (!getConfig().revert.enabled) return; // layer-1 gate — FIRST check
    const rt = getRuntime(sessionId); // STRING arg, not ctx (GOTCHA #5)
    if (!rt.store) return; // store not created (config off / T2.S1 not wired)
    // (1) GC FIRST — prompt-boundary reclamation (drop all turn/* refs + reclaim + clear in-memory).
    await gcTurnSnapshots(rt);
    // (2) THEN CAPTURE — snapshot the working set now → the turn's before-ref.
    const backend = rt.store.describe().backend;
    if (backend === "none") return; // NoOpStore — nothing to capture (fail-open)
    const beforeRef = await rt.store.capture("turn");
    if (beforeRef) {
      rt.snapshots?.set("turn", {
        label: "turn",
        backend, // narrowed to "git"|"cas" by the !=="none" guard above (RevertCheckpoint.backend)
        beforeRef,
        turnIndex: event.turnIndex,
        ts: Date.now(),
      });
    }
  } catch (e) {
    // FAIL-OPEN (E27): log + return — the turn is NEVER broken by a capture/GC failure.
    try {
      log("error", "capture.turn_start", sessionId, { error: String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
  }
}

/**
 * registerTurnStartCapture — arm the v1.2 turn_start hook. index.ts (step 5) calls this once at
 * startup: `registerTurnStartCapture(pi);`. The handler needs no `pi` (it reads rt.store, getConfig,
 * getRuntime, log — all module globals), so it is registered DIRECTLY (mirrors registerBloatReminder;
 * contrast registerTurnEndMetric which wraps to capture pi). Unconditional registration — the gate
 * lives INSIDE the handler (free when revert is off).
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerTurnStartCapture(pi: ExtensionAPI): void {
  pi.on("turn_start", turnStartCaptureHandler);
}

/**
 * agentEndCaptureHandler — the v1.2 agent_end capture hook (spec/14-working-tree-revert.md §5/§6). Fires at
 * the end of the agent's loop (after all tool calls + the final assistant message): snapshots the working
 * tree via `capture("turn-after")` and sets the ref as `afterRef` on the EXISTING `"turn"` RevertCheckpoint
 * in rt.snapshots (the object the turn_start hook stored). This after-ref is the baseline the dirty guard
 * (rewindExecute step 6b, P4.M2.T1.S1) compares the current tree against to detect a human/other-process
 * edit made AFTER the agent's turn — the E30 refuse-on-dirty guarantee (never silently clobber an unsaved
 * edit). ASYNC (Pi awaits event handlers; awaits store.capture).
 *
 * NEVER throws (E27): the WHOLE body is ONE try/catch → log + return. Read sessionId FIRST so the catch can
 * log it. Self-guards on config.revert.enabled (layer 1) + rt.store (undefined until P3.M1.T2.S1 wires it).
 * MUTATES the existing turn checkpoint in place (does NOT Map.set a replacement). No-ops cleanly when: revert
 * is off / the store is absent / there is no "turn" entry to annotate (no before-ref to pair with) / capture
 * returns null (caps exceeded — E29 / IO error). Best-effort: a capture failure is logged and the turn ends
 * (afterRef stays unset → the rewind's dirty guard degrades to its just-in-time after-ref path, PRD §6 step 3).
 *
 * @14 §5 (capture lifecycle — agent_end → capture("turn-after") → the turn's after ref; "the after-ref is
 *   what makes dirtyCheck effective (it detects post-turn drift)"), §6 step 3 (restore dirty-guard: if
 *   afterRef exists, dirtyCheck(afterRef, affected); any dirty path → REFUSE the file-revert; mid-turn
 *   limitation before agent_end → just-in-time after-ref → guard trivially satisfied).
 *
 * @param event { type:"agent_end"; messages: AgentMessage[] } — messages is UNUSED by this handler.
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12).
 */
export async function agentEndCaptureHandler(
  event: AgentEndEvent,
  ctx: ExtensionContext,
): Promise<void> {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so the catch can log it
    if (!getConfig().revert.enabled) return; // layer-1 gate — FIRST check
    const rt = getRuntime(sessionId); // STRING arg, not ctx (NOT ctx.sessionId)
    if (!rt.store) return; // store not created (config off / T2.S1 not wired)
    const afterRef = await rt.store.capture("turn-after");
    if (afterRef) {
      // MUTATE the existing "turn" checkpoint in place (spec/14 §5: the after-ref rides the same
      // RevertCheckpoint the turn_start before-ref lives on). Do NOT Map.set a replacement — held
      // references must see the update.
      const existing = rt.snapshots?.get("turn");
      if (existing) existing.afterRef = afterRef;
      // else: no "turn" entry (turn_start didn't fire / capture null / GC'd) → nothing to annotate → no-op.
    }
    // capture returned null → no-op (afterRef stays unset; the rewind's dirty guard degrades gracefully).
  } catch (e) {
    // FAIL-OPEN (E27): log + return — the turn is NEVER broken by an after-capture failure.
    try {
      log("error", "capture.agent_end", sessionId, { error: String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
  }
}

/**
 * registerAgentEndCapture — arm the v1.2 agent_end hook. index.ts (step 5) calls this once at startup:
 *   `registerAgentEndCapture(pi);`. The handler needs no `pi` (it reads rt.store, getConfig, getRuntime,
 *   log — all module globals), so it is registered DIRECTLY (mirrors registerBloatReminder /
 *   registerTurnStartCapture; contrast registerTurnEndMetric which wraps to capture pi). Unconditional
 *   registration — the gate lives INSIDE the handler (free when revert is off).
 *
 * @14 §5 (agent_end → capture("turn-after") → the turn's after ref — the dirty-guard baseline).
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerAgentEndCapture(pi: ExtensionAPI): void {
  pi.on("agent_end", agentEndCaptureHandler);
}
