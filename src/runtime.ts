/**
 * Per-session runtime state map — Mulligan's in-memory (non-persisted) control state.
 * spec/04-data-model.md §8 (SessionRuntime core four fields), spec/06-context-filter.md §7
 * (lastFiltered/lastFilterTs, cached for mulligan_audit), spec/04-data-model.md §5 (BloatHit shape mirrors
 * TurnMetric.bloatHits[*]), spec/02-proven-constraints.md §C12 (never cache a sessionManager handle),
 * spec/11-build-order.md §1/§2 Step 1 ("runtime.ts // per-session runtime map").
 *
 * DESIGN (read GOTCHA #1–#8 in the PRP):
 * - Foundation-tier and Pi-FREE. Imports no RUNTIME modules — not Pi, not config, not log (a single
 *   type-only import, `import type { RevertCheckpoint }`, is erased by tsc and adds no runtime coupling).
 *   This keeps it a pure, fast, isolated unit-test target and honors the work-item contract ("No prior
 *   code dependencies beyond P1.M1.T1.S1").
 * - The real Pi `AgentMessage` union lives in @earendil-works/pi-agent-core, which is NOT a resolvable
 *   dependency of this repo (not hoisted; not re-exported by @earendil-works/pi-coding-agent). So a LOCAL
 *   opaque `AgentMessage` alias is defined here (GOTCHA #1). runtime.ts only STORES/RETURNS message arrays —
 *   it never introspects them — so an opaque element type is sufficient and faithful.
 * - State lives in a module-scoped Map<string, SessionRuntime> keyed by sessionId. resetRuntime clears the
 *   entry on session_start (wired in index.ts, P1.M7.T1); clearAll wipes it on shutdown/reload. NEVER caches a
 *   sessionManager handle (C12) — only primitive values and arrays are stored.
 */

import type { RevertCheckpoint } from "./markers.js";

/**
 * AgentMessage — LOCAL opaque alias for the elements of a Pi message list.
 *
 * The authoritative Pi `AgentMessage` union (user | assistant | toolResult | bashExecution | custom | …) is
 * defined in @earendil-works/pi-agent-core and is NOT resolvable from this repo (neither hoisted into
 * node_modules nor re-exported by @earendil-works/pi-coding-agent). Foundation-tier runtime.ts is deliberately
 * Pi-free, so it mirrors the element opaquely: a message is a record. runtime.ts never inspects message
 * contents — it only stores `event.messages` deep copies (filter.ts) and returns them (audit.ts).
 *
 * Assignability: a real Pi `AgentMessage[]` is assignable INTO `lastFiltered` (every message variant is a
 * record). Consumers reading `lastFiltered` back should narrow/cast to the real Pi type they obtain from the
 * `context` event (audit.ts, P1.M5.T4.S1) — the objects ARE real messages; the type is just opaque here.
 */
export type AgentMessage = Record<string, unknown>;

/**
 * BloatHit — one bloated tool result observed in a turn. Mirrors `TurnMetric.bloatHits[*]`
 * (spec/04-data-model.md §5) so the bloat annotator (nudges.ts) and the turn metric (markers.ts) can share the
 * shape. Accumulated in `SessionRuntime.pendingBloatHits` across a turn, then snapshotted into the TurnMetric
 * at turn_end and cleared.
 */
export interface BloatHit {
  /** Name of the tool whose result exceeded the bloat threshold (e.g. "read", "bash"). */
  toolName: string;
  /** Approximate in-context token cost of the bloated result (an estimate, not exact). */
  approxTokens: number;
}

/**
 * SessionRuntime — per-session in-memory state (NOT persisted). The work-item contract's 7-field shape: the
 * core four from spec/04-data-model.md §8 (sessionId, seq, tokenBaseline, lastTurnIndex) plus the audit cache
 * from spec/06-context-filter.md §7 (lastFiltered, lastFilterTs) plus the bloat accumulator (pendingBloatHits).
 *
 * Held in a module-scoped Map keyed by sessionId. Fields are MUTABLE by design: callers obtain the live runtime
 * via getRuntime() and mutate fields in place (filter.ts writes lastFiltered; turn_end writes
 * tokenBaseline/lastTurnIndex; nudges.ts pushes pendingBloatHits; markers.ts increments seq via nextSeq).
 * C12: only primitive values + message arrays are stored — never a sessionManager handle.
 */
export interface SessionRuntime {
  /** The Pi session id this runtime belongs to (ctx.sessionManager.getSessionId()). */
  sessionId: string;
  /** Monotonic per-session marker counter; persisted INTO each marker (spec/04 §3). 0 = no markers yet.
   *  Incremented via nextSeq(); first marker gets seq 1 (pre-increment). */
  seq: number;
  /** Token count at the start of the current turn (or last turn_end), for the turn-metric delta (spec/04 §5).
   *  null until the first estimate is captured (first turn / post-reload). */
  tokenBaseline: number | null;
  /** The turn index this runtime last saw (from turn_end event.turnIndex). null until first turn_end. */
  lastTurnIndex: number | null;
  /** The most recent filtered message list (what the model actually saw on the last inference), cached so
   *  mulligan_audit can report the filtered view without re-running the pipeline (spec/06 §7). null until the
   *  first context.fire. Written by filter.ts each fire. */
  lastFiltered: AgentMessage[] | null;
  /** Date.now() of the last context.fire that wrote lastFiltered. For audit freshness checks. null until first fire. */
  lastFilterTs: number | null;
  /** Bloated tool results observed THIS turn (since last turn_end), snapshotted into the TurnMetric at
   *  turn_end and cleared. Each fresh runtime gets its OWN new empty array (GOTCHA #5). */
  pendingBloatHits: BloatHit[];
  /** Consecutive-fire miss count per active pinned shrink (keyed by shrink marker id), for stale-marker
   *  retirement (spec E15). Incremented by filter.ts contextHandler when a pinned shrink's target is
   *  absent on a given fire; reset/deleted on a hit or retirement. Each fresh runtime gets its OWN Map
   *  (GOTCHA #5 — never a module-level shared Map). Consumed by P3.M2.T3.S1. */
  shrinkMissCounts: Map<string, number>;
  /** Whether the total filtered context is currently ABOVE the high-water fraction of the window
   *  (config.nudges.highWaterFraction, default 0.7). Latches the §5.2 edge-triggered high-water signal:
   *  set `true` when the high-water annotation fires (total crosses above the fraction); cleared (`false`)
   *  only when the total drops back below the fraction. Edge-triggered — prevents the annotation from
   *  nagging every turn while above. Persists across turns within a session; auto-reset to `false` by
   *  resetRuntime (entry deleted on session_start) and clearAll (shutdown). Default: `false`. In-memory,
   *  non-persisted (spec/04 §8). Consumed by shouldHighWater (P3.M3.T5.S1) via the rt parameter. */
  aboveHighWater: boolean;
  /** The turnIndex of a turn in which a `mulligan_rewind` was just REFUSED (P4.M1.T2.S3 / spec/08 E23).
   *  Latched by the rewind tool's `refuse()` wrapper to `readMarkers(ctx).metric?.turnIndex ?? rt.lastTurnIndex`
   *  on EVERY refusal path (all 9 sites). filter.ts's drift-nudge block reads it to MUTE Nudge B (the drift
   *  nudge) for the remainder of that same turn — a rewind refusal already surfaced the same root-cause
   *  signal, so re-nagging would be noise. Cleared to `null` on the next context fire once
   *  `markers.metric.turnIndex` differs from the latched value (the turn has advanced) — so a FUTURE turn's
   *  genuine drift still nudges. null = no refused rewind this turn (the default; fail-open — drift nudge
   *  proceeds). Mirrors aboveHighWater: in-memory, non-persisted; auto-reset to `null` by resetRuntime
   *  (entry deleted on session_start) and clearAll (shutdown). Consumed by filter.ts's drift-nudge guard. */
  rewindRefusedTurnIndex: number | null;
  /** Active RevertCheckpoints for the v1.2 working-tree-revert feature, keyed by capture label
   *  (`"turn"` | `"checkpoint:<name>"`). In-memory and non-persisted (spec/04 §8). Each RevertCheckpoint
   *  (spec/14 §2) pairs a `beforeRef` (snapshot at turn_start / checkpoint-set) with an `afterRef` (snapshot
   *  at turn_end / next capture) so `rewindExecute` can `store.dirtyCheck(afterRef, paths)` then
   *  `store.restore(beforeRef, opts)`.
   *
   *  WHO WRITES: the turn_start/agent_end capture hooks (P3.M1.T1) and the `/mulligan_checkpoint` step 4b
   *  command (P3.M2.T1) — only when `config.revert.enabled`. WHO READS: `rewindExecute` (P4.M2.T1 step 6b)
   *  resolves the before/after refs before calling store.restore().
   *
   *  OPTIONAL in the interface (`snapshots?`) so a hand-built `{ } as SessionRuntime` type-checks, but
   *  freshRuntime ALWAYS initializes it to a fresh empty `Map` — downstream hooks rely on a live Map (read
   *  via `rt.snapshots?.…`). Per-session isolated: each fresh runtime gets its OWN `new Map()` (GOTCHA #5 —
   *  never a module-level shared Map, which would leak checkpoints across sessions). Auto-reset:
   *  resetRuntime deletes the whole runtime entry (session_start) and clearAll wipes all entries (shutdown)
   *  — the Map is dropped with the object, no explicit clear.
   *  See `@14-working-tree-revert.md` §2 (definition + per-session caching), §5 (capture lifecycle), §6 (restore). */
  snapshots?: Map<string, RevertCheckpoint>;
}

/**
 * The module-scoped per-session runtime map. Keyed by ctx.sessionManager.getSessionId(). One process-wide
 * singleton (ES modules are evaluated once). NEVER caches a sessionManager handle (C12) — only primitive
 * values and arrays live in each SessionRuntime. Tests MUST reset this via clearAll() (GOTCHA #7).
 */
const runtimes = new Map<string, SessionRuntime>();

/**
 * freshRuntime — construct a brand-new SessionRuntime with all defaults. Called on first access for a session
 * and again after resetRuntime. Returns a NEW object with a NEW pendingBloatHits array every time (GOTCHA #5 —
 * never a shared module-level array, which would leak bloat hits across sessions).
 */
function freshRuntime(sessionId: string): SessionRuntime {
  return {
    sessionId,
    seq: 0,
    tokenBaseline: null,
    lastTurnIndex: null,
    lastFiltered: null,
    lastFilterTs: null,
    pendingBloatHits: [],
    shrinkMissCounts: new Map(),
    aboveHighWater: false,
    rewindRefusedTurnIndex: null,
    snapshots: new Map<string, RevertCheckpoint>(),
  };
}

/**
 * getRuntime — return the live per-session runtime, creating a fresh one on first access.
 *
 * Returns a MUTABLE reference (NOT a copy): callers mutate fields in place (e.g. `rt.tokenBaseline = n`).
 * The same sessionId always resolves to the same live object until resetRuntime/clearAll. Never throws.
 *
 * @param sessionId the Pi session id (ctx.sessionManager.getSessionId())
 */
export function getRuntime(sessionId: string): SessionRuntime {
  let rt = runtimes.get(sessionId);
  if (rt === undefined) {
    rt = freshRuntime(sessionId);
    runtimes.set(sessionId, rt);
  }
  return rt;
}

/**
 * nextSeq — atomically increment and return the per-session monotonic marker counter.
 *
 * Pre-increment: the first call returns 1 (fresh seq is 0). The returned value is persisted INTO the marker
 * (spec/04-data-model.md §3 "seq") so the filter can order markers reliably even if timestamps tie. Per-session
 * isolated: incrementing session A never touches session B.
 *
 * @returns the post-increment seq value for this session (1, 2, 3, …)
 */
export function nextSeq(sessionId: string): number {
  const rt = getRuntime(sessionId);
  return ++rt.seq;
}

/**
 * resetRuntime — clear this session's runtime entry. Called on `session_start` (index.ts, P1.M7.T1) so a
 * reopened/resumed session starts from a clean runtime (seq 0, null baseline, empty bloat hits, no stale
 * filtered view). The NEXT getRuntime(sessionId) creates a fresh one. A no-op if the session had no runtime.
 * Never throws.
 *
 * Deletes (rather than mutating in place) so any reference a caller still holds is abandoned — the C12-safe
 * pattern (stale references must not keep mutating live state).
 */
export function resetRuntime(sessionId: string): void {
  runtimes.delete(sessionId);
}

/**
 * clearAll — wipe ALL per-session runtimes. Provided for `session_shutdown` / process-exit / `/reload` cleanup
 * (index.ts, P1.M7.T1) so no session's state leaks across a full teardown. Never throws.
 */
export function clearAll(): void {
  runtimes.clear();
}
