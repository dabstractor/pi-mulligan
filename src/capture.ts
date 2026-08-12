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
  ToolCallEvent,
  ExtensionContext,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { getRuntime } from "./runtime.js";
import type { SessionRuntime } from "./runtime.js";
import type { CasBackend } from "./snapshot/cas.js";
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
 * rebuildCheckpointSnapshots — [P1.M2.T1.S1/S2 / spec/14 §5 / E32 / BUG-002] rebuild rt.snapshots from the
 * persisted `mulligan:revert-checkpoint` control entries that `/mulligan_checkpoint` wrote (commands.ts
 * step 4b). After a `/resume` (or reload), `resetRuntime` wiped `rt.snapshots` to a fresh empty Map; E32
 * ("post-reload snapshot loss → RESOLVED in v1.2") requires the READ-SIDE: re-read the persisted
 * `{label, ref, backend}` control data, reconstruct each `RevertCheckpoint` (beforeRef←ref, turnIndex:-1,
 * NO afterRef — checkpoints capture once), optionally verify the ref still exists via `rt.store.has(ref)`
 * (fail-open skip on absent/NoOpStore/throw), and repopulate the Map so a later checkpoint-granularity
 * rewind finds its snapshot (BUG-001's restore path proceeds to `store.restore()` instead of the
 * "no working-tree snapshot" skip).
 *
 * MUST run AFTER `gcTurnSnapshots` (ckpt:* refs are exempt from gc → survive → `has()` confirms them
 * truthfully). Defensive entry-scan mirroring `clearCheckpointByName` (commands.ts ~120-145): per-entry
 * object guard + per-entry try/catch + customType filter + typeof field guards. BEST-EFFORT: a malformed
 * entry or a throwing-Proxy `get` trap is skipped; the helper NEVER throws. EXPORTED so BOTH the
 * `session_start` handler (src/index.ts) AND the F-revert-reload integration test call the SAME code —
 * single source of truth (the `gcTurnSnapshots` precedent: exported, dual-caller). Last-wins for duplicate
 * labels (iterate in order; each valid+present `set()` overwrites).
 *
 * @param ctx the Pi ExtensionContext (reads ctx.sessionManager.getEntries() for the control entries).
 * @param rt the live per-session runtime (reads rt.store.has + rt.snapshots.set). No-op if rt.store is unset.
 */
export async function rebuildCheckpointSnapshots(
  ctx: ExtensionContext,
  rt: SessionRuntime,
): Promise<void> {
  if (!rt.store) return; // self-gate (mirror gcTurnSnapshots) — needs rt.store.has()
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries(); // read FRESH (C12)
  } catch {
    return; // getEntries threw → no rebuild (fail-open)
  }
  if (!Array.isArray(entries)) return;
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
      // optional E32 verification: the ref must STILL exist in the store (survived gc / storage intact).
      // NoOpStore.has→false (backend 'none' ⇒ nothing to restore); a throw ⇒ skip (fail-open).
      let present = true;
      try {
        present = await rt.store.has(d.ref);
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
    rt.pendingExplicitPaths = []; // [P1.M3.T1.S2 / BUG-003] fresh per-turn accumulator (clear before capture)
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
    // [P1.M3.T1.S2 / BUG-003] thread rt.pendingExplicitPaths into capture("turn-after") for the cas
    // backend (the widening is CasBackend-specific — SnapshotStore.capture is 1-param). At agent_end
    // the accumulator holds ALL paths written this turn and the files are at their POST-write state —
    // exactly the afterRef (dirty-guard baseline) we want. git/none stay 1-param (the arg is ignored).
    const backend = rt.store.describe().backend;
    const afterRef =
      backend === "cas"
        ? await (rt.store as CasBackend).capture(
            "turn-after",
            rt.pendingExplicitPaths ?? [],
          )
        : await rt.store.capture("turn-after");
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

/**
 * toolCallCaptureHandler — [P1.M3.T1.S1 / spec/14-working-tree-revert.md §4.2 / BUG-003] the PRODUCER
 * half of the explicit-paths non-git-mode fix. Fires BEFORE each tool runs (the `tool_call` event is
 * the only place write/edit tool paths are observable before mutation, §4.2). In a CasBackend +
 * `revert.nonGitMode === "explicit-paths"` workspace it (a) for `write`/`edit` tools, pushes
 * `event.input.path` into `rt.pendingExplicitPaths` — the accumulator S2 will thread into
 * `rt.store.capture("turn", rt.pendingExplicitPaths)` so `captureExplicitPaths` has a non-empty manifest
 * (BUG-003 root cause: no caller ever passed the 2nd arg → empty manifest → restore reverted nothing);
 * and (b) for the `bash` tool, delegates to `(rt.store as CasBackend).notifyBashUsed()` to emit the
 * once-per-turn "bash changes NOT captured" warning (its file mutations are invisible to path-based
 * capture). All other tools (read/grep/find/ls/custom) are clean no-ops (no file mutation captured by
 * path). ASYNC (Pi awaits event handlers) but does no awaiting itself in S1 (push + a sync method call).
 *
 * NEVER throws (E27): the WHOLE body is ONE try/catch → log + return. A capture-hook failure must NEVER
 * block a tool_call (the event can block tool execution). Read sessionId FIRST inside the try{} so the
 * catch{} can log it (mirrors turnStartCaptureHandler/agentEndCaptureHandler GOTCHA #1).
 *
 * GATE ORDER (mirrors turnStartCaptureHandler EXACTLY — reordering breaks the fail-open logging contract):
 *   1. sessionId (FRESH read — C12) — first so the catch can log it;
 *   2. getConfig().revert.enabled (layer-1 gate — FIRST check; free when revert is off);
 *   3. getRuntime(sessionId) (STRING arg, not ctx — GOTCHA #5);
 *   4. rt.store (undefined until P3.M1.T2.S1 wires detectAndCreate at session_start) — early return;
 *   5. rt.store.describe().backend !== "cas" — explicit-paths is CasBackend-specific (a git repo captures
 *      the whole tree via git; a NoOpStore captures nothing) → correctly skips git AND none;
 *   6. getConfig().revert.nonGitMode !== "explicit-paths" — 'cas' mode walks the whole tree (no path list
 *      needed) → no accumulation to do.
 *
 * NARROWING CAVEAT (CRITICAL #1): `event.toolName === "write"` is a VALID runtime value-check but does
 * NOT narrow `event.input` in TS (CustomToolCallEvent.toolName is `string`, overlapping every literal).
 * So after the `===` check the handler casts defensively: `const path = (event.input as { path?: string
 * }).path;` then guards `typeof path === "string" && path.length > 0`. (Alternative: isToolCallEventType
 * narrows cleanly — see PRP Implementation Patterns; PATTERN A is used here per the PRP.)
 *
 * CAST REQUIREMENT (CRITICAL #2): `notifyBashUsed()` is a PUBLIC CasBackend method NOT on the SnapshotStore
 * interface, so `rt.store.notifyBashUsed()` is a TYPE ERROR. The handler casts: `(rt.store as
 * CasBackend).notifyBashUsed()`. CasBackend is imported TYPE-ONLY (erased by tsc; no runtime graph cycle).
 * The method self-guards on `nonGitMode === "explicit-paths"` + once-per-turn (`bashWarnedThisTurn`) — by
 * the time the handler reaches this call it has ALREADY gated nonGitMode, so the warning WILL fire; the
 * handler does NOT replicate those guards (CasBackend owns them).
 *
 * SCOPE NOTE: this handler is registered by `registerToolCallCapture` below, which index.ts step 5
 * calls once at startup (S2 wired it). S2 also (a) snapshots the pre-write file state via
 * `(rt.store as CasBackend).appendExplicitPath("turn", path)` (the BUG-003 fix — captureExplicitPaths
 * at turn_start would loop an empty accumulator; the pre-write content is observable ONLY here, so
 * the hook captures each path's current state before the tool mutates it), (b) threads
 * `rt.pendingExplicitPaths` into `capture("turn-after", …)` at agent_end, and (c) clears the
 * accumulator at the next turn_start. Until S3's end-to-end integration test, the mechanism is proven
 * via the appendExplicitPath unit test (an existing-file capture ⇒ a restore-shaped manifest entry).
 *
 * @param event the ToolCallEvent (`{ type:"tool_call"; toolCallId; toolName; input }`). `input` shape varies
 *   by toolName (Write/EditToolInput carry a `path`; BashToolInput does not).
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12).
 */
export async function toolCallCaptureHandler(
  event: ToolCallEvent,
  ctx: ExtensionContext,
): Promise<void> {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so the catch can log it
    if (!getConfig().revert.enabled) return; // layer-1 gate — FIRST check
    const rt = getRuntime(sessionId); // STRING arg, not ctx (GOTCHA #5)
    if (!rt.store) return; // store not created (config off / T2.S1 not wired)
    const backend = rt.store.describe().backend;
    if (backend !== "cas") return; // explicit-paths is CasBackend-specific (skips git + none)
    if (getConfig().revert.nonGitMode !== "explicit-paths") return; // 'cas' mode won't consume the paths
    // ── write/edit: accumulate the path + snapshot its PRE-WRITE state BEFORE the tool runs ──
    // (spec/14 §4.2 line 127: Pi AWAITS this hook in preflight before the tool runs ⇒ the file is
    // still in its pre-write state here — race-safe.)
    if (event.toolName === "write" || event.toolName === "edit") {
      // `===` is runtime-correct but does NOT narrow event.input in TS (CustomToolCallEvent.toolName is
      // `string`, overlapping all literals) → defensive cast + typeof guard (CRITICAL #1 / Pattern A).
      const path = (event.input as { path?: string }).path;
      if (typeof path === "string" && path.length > 0) {
        rt.pendingExplicitPaths?.push(path); // S2 threads rt.pendingExplicitPaths into capture()
        // [P1.M3.T1.S2 / BUG-003] snapshot the path's PRE-WRITE state BEFORE the tool runs (Pi awaits
        // this hook in preflight — spec §4.2 line 127). appendExplicitPath appends to the "turn"
        // beforeRef manifest (the empty placeholder turn_start wrote) so restore can revert it.
        // appendExplicitPath is CasBackend-specific (NOT on SnapshotStore) ⇒ cast (S1 added the type import).
        // FAIL-OPEN (E27): a throw (escape path / fs error) is caught by the outer try/catch → log +
        // return; the tool_call is NEVER blocked — the path simply won't be reverted (best-effort).
        await (rt.store as CasBackend).appendExplicitPath("turn", path);
      }
      return;
    }
    // ── bash: warn once per turn that its changes are not captured (notifyBashUsed self-guards) ──
    if (event.toolName === "bash") {
      // notifyBashUsed is PUBLIC on CasBackend but NOT on the SnapshotStore interface → cast required
      // (CRITICAL #2). The method self-guards on nonGitMode==='explicit-paths' (already gated above) +
      // once-per-turn; the handler does NOT replicate those guards — CasBackend owns them.
      (rt.store as CasBackend).notifyBashUsed();
      return;
    }
    // read/grep/find/ls/custom → no file mutation captured by path → no-op (fall through to return)
  } catch (e) {
    // FAIL-OPEN (E27): log + return — a tool_call must NEVER be blocked by a capture-hook failure.
    try {
      log("error", "capture.tool_call", sessionId, {
        error: String(e),
        toolName: event?.toolName,
      });
    } catch {
      /* log() never throws, but be safe (and event could be malformed) */
    }
  }
}

/**
 * registerToolCallCapture — arm the [P1.M3.T1.S1] `tool_call` capture hook. index.ts (step 5) will call
 * this once at startup: `registerToolCallCapture(pi);`. The handler needs no `pi` (it reads rt.store,
 * getConfig, getRuntime, log — all module globals), so it is registered DIRECTLY (mirrors
 * registerBloatReminder / registerTurnStartCapture / registerAgentEndCapture). Unconditional registration
 * — the gate lives INSIDE the handler (free when revert is off).
 *
 * NOTE (S1 scope): index.ts does NOT call this in S1 — registration is S2's contract. The export exists
 * so S2 can wire it without touching capture.ts again.
 *
 * @14 §4.2 (the tool-call hook reads `event.input.path` and snapshots that path's state before the tool runs).
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerToolCallCapture(pi: ExtensionAPI): void {
  pi.on("tool_call", toolCallCaptureHandler);
}
