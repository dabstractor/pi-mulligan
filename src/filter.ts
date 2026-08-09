/**
 * filter.ts — Mulligan's `context` event handler (the runtime entry point for ALL transforms).
 * spec/03-architecture.md §2.4 (fail open) + §7 (filter.ts // context handler), spec/06-context-filter.md
 *   §1 (the handler glue) + §7 (cache filtered view for audit), spec/07-preventive-and-nudges.md §2 (nudge
 *   stubs), spec/08-edge-cases.md E13 (handler never throws), api_verification.md §7.1 (ContextEvent/
 *   ContextEventResult/ExtensionHandler) + §5 (CustomEntry) + §4 (getEntries/getBranch/getSessionId),
 *   spec/02-proven-constraints.md C4 (void = pass-through) + C12 (read sessionManager fresh).
 *
 * DESIGN (read GOTCHA #1–#13 in the PRP):
 * - Pi Integration Layer (the read/orchestrate half; markers.ts is the write half). This module is the
 *   ONLY place that subscribes to the `context` event. It is THIN GLUE over the pure `filterPipeline`
 *   (transforms.ts): read markers fresh, read the branch fresh, delegate the transform, cache the result
 *   for mulligan_audit, fail-open. The actual transform math (rewind removal, shrink substitution, nudge
 *   injection) lives in transforms.ts — fully unit-tested without Pi.
 * - The `context` event fires BEFORE every LLM call (verified: api_verification §7.1). `event.messages` is
 *   a deep copy of the active branch, safe to mutate/replace. Returning `{ messages }` transforms what the
 *   model sees; returning nothing (void) passes the original through unchanged (C4). The session tree is
 *   NEVER mutated (soft-over-hard, D2) — only the in-flight copy is rewritten.
 * - NEVER throws (spec/03 #4, spec/08 E13). The ENTIRE handler body is ONE try/catch → log + return
 *   (pass-through). readMarkers is ALSO defensive (skips malformed marker entries) as defense-in-depth.
 *   An extension bug can NEVER break an agent turn.
 * - Reads `ctx.sessionManager` FRESH inside the body every fire (C12) — never caches the handle at module
 *   scope or in the runtime map.
 *
 * PREREQUISITE: statically imports `filterPipeline` from "./transforms.js" (P1.M3.T5.S1). If that export is
 *   absent, tsc fails — this task is sequenced after P1.M3.T5.S1.
 *
 * NOTE: P1.M6.T2.S2 will REPLACE the local shouldNudge/injectNudge stubs with real imports from nudges.ts.
 *   They are EXPORTED so the swap is a find/replace and the test can assert the current no-op behavior.
 *
 * TYPE NOTE: `ContextEventResult` is defined locally below (it is NOT re-exported at the package root of
 *   @earendil-works/pi-coding-agent, only from core/extensions). Its `messages` element type is derived from
 *   `ContextEvent["messages"]` so the local shape is structurally identical to Pi's own
 *   `ContextEventResult`, which makes the `pi.on("context", contextHandler)` overload resolve cleanly.
 */
import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { filterPipeline, resolvePinnedShrink } from "./transforms.js";
import type { MessageLike, BranchEntry } from "./transforms.js";
import { getRuntime } from "./runtime.js";
import type { AgentMessage } from "./runtime.js"; // local opaque alias (Pi's AgentMessage is NOT exported)
import { getConfig } from "./config.js";
import { log } from "./log.js";
import { estimateTokens } from "./tokens.js";
import type { RewindMarker, ShrinkMarker, TurnMetric } from "./markers.js";
import { appendCancelMarker } from "./markers.js";
import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";

// ── module-private defensive helpers (mirror transforms.ts/notes.ts — never throw) ───

/** True for plain records (and Object.create(null)); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable. */
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

// ── ContextEventResult (local; structurally identical to Pi's core/extensions ContextEventResult) ──

/**
 * The element type of `ContextEvent.messages`, derived so it stays in lock-step with Pi's own `AgentMessage`
 * without naming that (un-exported-at-root) type. `ContextEventResult` is defined locally because the
 * package root re-exports `ContextEvent` but NOT `ContextEventResult`.
 */
type ContextMessage = NonNullable<ContextEvent["messages"]>[number];

/**
 * ContextEventResult — return shape of the `context` handler. `{ messages }` transforms what the model
 * sees; `void`/`undefined` passes the original through (C4). Structurally identical to Pi's own
 * `ContextEventResult { messages?: AgentMessage[] }`, so the `pi.on("context", handler)` overload resolves.
 */
export interface ContextEventResult {
  messages?: ContextMessage[];
}

// ── MarkersBundle — readMarkers return + the structural contract for filterPipeline's `markers` param ──

/**
 * MarkersBundle — the markers read fresh from the session each context fire, bucketed for the pure
 * filterPipeline. `metric` is the LATEST turn-metric on the branch (highest seq) or null. EXPORTED so the
 * test + audit share ONE shape. TS structural typing makes this assignable to filterPipeline's `markers`
 * param with zero shared-type coordination (P1.M3.T5.S1 may import the marker interfaces type-only).
 */
export interface MarkersBundle {
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  metric: TurnMetric | null;
  /** uuid `id`s of rewind/shrink markers retired by a mulligan:cancel entry (P3.M1.T2.S1 / E21).
   *  readMarkers drops any marker whose data.id ∈ this set BEFORE returning, so the pipeline only sees the
   *  active markers. Always present (empty Set when there are no cancels on the branch). */
  cancelledIds: Set<string>;
}

/**
 * readMarkers — scan the session's custom entries FRESH and bucket the Mulligan markers (spec/06 §1;
 * api_verification §5). Markers are `custom` entries (NOT in LLM context); notes are `custom_message`
 * (IN context) and checkpoints are `label` — both are naturally excluded by the `type === "custom"`
 * filter. `data` IS the complete marker: markers.ts stamps the envelope {schema,v,kind,id/seq,ts} INTO
 * entry.data via appendEntry, so we cast it directly.
 *
 * The turn-metric is the LATEST one on the branch (spec/07 §2): among all `mulligan:turn-metric`
 * entries, keep the one with the highest `seq` (the monotonic per-session counter). Older metrics
 * persist on disk but are ignored. Defensive on a missing/non-number `seq` (treat as -Infinity).
 *
 * NEVER throws: malformed entries (non-record data, wrong kind, unknown customType) are SKIPPED, not
 * thrown — fail-open at the marker level (spec/08 E13). The whole readOwn/isRecord layer swallows
 * Proxy-trap throws too.
 *
 * @param ctx the Pi ExtensionContext (sessionManager.getEntries read FRESH — C12)
 * @returns { rewinds, shrinks, metric, cancelledIds } — metric is the latest turn-metric or null;
 *          cancelledIds holds the uuid ids of cancelled rewind/shrink markers (dropped from the arrays).
 */
export function readMarkers(ctx: ExtensionContext): MarkersBundle {
  const rewinds: RewindMarker[] = [];
  const shrinks: ShrinkMarker[] = [];
  let metric: TurnMetric | null = null;
  const cancelledIds = new Set<string>();

  let entries: SessionEntry[];
  try {
    entries = ctx.sessionManager.getEntries(); // read FRESH (C12)
  } catch {
    return { rewinds, shrinks, metric, cancelledIds }; // a throwing getEntries → empty bundle (fail-open)
  }

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (readOwn(entry, "type") !== "custom") continue; // notes=custom_message, checkpoints=label → excluded
    const customType = readOwn(entry, "customType");
    if (typeof customType !== "string" || !customType.startsWith("mulligan:")) continue;

    const data = readOwn(entry, "data");
    if (!isRecord(data)) continue; // malformed marker → skip (fail-open)
    const kind = readOwn(data, "kind");

    if (customType === "mulligan:rewind" && kind === "rewind") {
      rewinds.push(data as unknown as RewindMarker);
    } else if (customType === "mulligan:shrink" && kind === "shrink") {
      shrinks.push(data as unknown as ShrinkMarker);
    } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
      const candidate = data as unknown as TurnMetric;
      const cSeq = typeof candidate.seq === "number" ? candidate.seq : -Infinity;
      const mSeq = metric && typeof metric.seq === "number" ? metric.seq : -Infinity;
      if (metric === null || cSeq > mSeq) metric = candidate; // keep the LATEST (highest seq)
    } else if (customType === "mulligan:cancel" && kind === "cancel") {
      // P3.M1.T2.S1 / E21: collect the uuid id of the rewind/shrink being retired. readMarkers drops
      // any marker whose data.id ∈ cancelledIds AFTER the scan (order-independent: full scan, then filter).
      const targetId = readOwn(data, "targetId");
      if (typeof targetId === "string" && targetId.length > 0) cancelledIds.add(targetId);
      // else: malformed cancel (non-string / empty / missing targetId) → skip (fail-open, never throw)
    }
    // else: future/unknown mulligan:* custom entry → skip defensively (forward-compat)
  }

  // P3.M1.T2.S1 / E21: drop any marker retired by a mulligan:cancel (by its uuid id). A marker whose
  // id is unreadable (defensive) is KEPT — never drop on bad data. Cancelled markers stay on disk
  // (audit trail); they are simply skipped going forward.
  const activeRewinds = rewinds.filter(r => {
    const id = readOwn(r, "id");
    return typeof id !== "string" || !cancelledIds.has(id);
  });
  const activeShrinks = shrinks.filter(s => {
    const id = readOwn(s, "id");
    return typeof id !== "string" || !cancelledIds.has(id);
  });

  return { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds };
}

// ── contextHandler — the heart of the extension (spec/03 §7, spec/06 §1) ─────────────────────

/**
 * contextHandler — the `context` event handler. Fires before EVERY LLM call; reads persisted markers
 * fresh, delegates the transform to the pure filterPipeline, conditionally injects the drift nudge,
 * caches the filtered view for mulligan_audit, and returns `{ messages }`. The ENTIRE body is wrapped in
 * try/catch — on ANY exception it logs and returns nothing (pass-through), so an extension bug can NEVER
 * break an agent turn (spec/03 #4 fail-open, spec/08 E13).
 *
 * EXPORTED (named) so the test suite can call it directly with hand-rolled fakes (pi FIRST — see GOTCHA);
 * registerFilterHandler is the production registration seam.
 *
 * WHY pi is a parameter (GOTCHA #2, mirrors turnEndMetricHandler in nudges.ts): the `context` callback only
 * receives (event, ctx), but this handler must call appendCancelMarker(pi, …) (→ pi.appendEntry) for stale-
 * marker retirement (spec E15). registerFilterHandler captures pi in a closure and passes it here, so the
 * exported handler is directly testable with a fake pi.
 *
 * @param pi    the Pi ExtensionAPI (appendCancelMarker → pi.appendEntry lives here).
 * @param event { type:"context"; messages: AgentMessage[] } — a deep copy of the active branch, safe to
 *        mutate/replace (api_verification §7.1).
 * @param ctx   the Pi ExtensionContext (sessionManager read FRESH — C12).
 * @returns `{ messages }` to transform, or void/undefined to pass the original through (C4).
 */
export function contextHandler(
  pi: ExtensionAPI,
  event: ContextEvent,
  ctx: ExtensionContext,
): ContextEventResult | void {
  let sessionId = "unknown";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // read FRESH (C12); first so the catch can log it

    const config = getConfig();
    if (!config.enabled) return; // master switch off → pass-through (do NOT pollute the audit cache)

    const rt = getRuntime(sessionId);
    const markers = readMarkers(ctx); // fresh markers each fire (C12)
    const branchEntries = ctx.sessionManager.getBranch(); // read FRESH (C12); passed to the Pi-free pipeline

    // Delegate the transform to the pure filterPipeline. Explicit `: MessageLike[]` normalizes the type
    // whether filterPipeline is generic <M> or returns MessageLike[] (GOTCHA #10). event.messages is Pi's
    // AgentMessage[]; cast through unknown to transforms.ts's MessageLike[] at this single call boundary
    // (transforms.ts is Pi-free and names only its own MessageLike).
    let messages: MessageLike[] = filterPipeline(
      event.messages as unknown as MessageLike[],
      markers,
      config,
      branchEntries as unknown as BranchEntry[],
    );

    // Per-turn drift nudge (spec/07 §2). shouldNudge/injectNudge/suppressCheck are imported from nudges.ts
    // (P1.M6.T2.S2). Suppress avoids nagging when the agent already acted that turn (a rewind/shrink marker
    // within the turn's time window — spec/07 §2 "Edge cases").
    if (
      config.nudges.perTurnDrift &&
      markers.metric &&
      shouldNudge(markers.metric, config) &&
      !suppressCheck(markers.metric, markers)
    ) {
      messages = injectNudge(messages, markers.metric);
    }

    // Cache the filtered view for mulligan_audit (spec/06 §7). MessageLike[] is assignable to runtime's
    // opaque AgentMessage[] (Record<string,unknown>[]) — no cast needed (GOTCHA #10).
    rt.lastFiltered = messages as unknown as AgentMessage[];
    rt.lastFilterTs = Date.now();

    // Defensive observability: log the token reduction (honors design principle #6, honest bookkeeping).
    // estimateTokens NEVER throws; the whole line is belt-and-suspenders in its own try/catch so a logging
    // failure can never break the turn. Safe to omit — NOT in the explicit LOGIC (a)–(h).
    try {
      // tokens.ts defines its OWN MessageLike (structurally narrower content blocks) that is NOT the same
      // type as transforms.ts's MessageLike. Cast through unknown to the estimateTokens param type so the
      // observability log never causes a type error (it is wrapped in its own try/catch and never breaks
      // the turn anyway).
      type TokenMessages = Parameters<typeof estimateTokens>[0];
      const after = estimateTokens(messages as unknown as TokenMessages).tokens;
      const before = estimateTokens(event.messages as unknown as TokenMessages).tokens;
      log("info", "filter.fire", sessionId, { before, after, rewinds: markers.rewinds.length,
        shrinks: markers.shrinks.length, hasMetric: markers.metric !== null });
    } catch {
      /* observability only — never break the turn */
    }

    // P3.M2.T3.S1 / spec E15: stale-marker retirement. A PINNED shrink whose target ENTRY has been absent
    // from the branch for config.shrink.staleAfterFires consecutive fires is auto-retired (a mulligan:cancel
    // is appended — the SAME retraction primitive the cancel tool uses, P3.M1). The cancel takes effect on
    // the NEXT fire (readMarkers drops the cancelled id) — NO in-fire mutation. Only PINNED shrinks can go
    // stale (live shrinks re-resolve each fire and no-op harmlessly). NEVER throws: its OWN inner try/catch
    // (E13) — a retirement failure is swallowed and execution falls through to the normal return, so the
    // already-computed filter transform is PRESERVED (it does NOT fall through to the outer void-return).
    // event.messages is PRE-filter (filterPipeline REMOVES messages, breaking the alignment walk); rt/config/
    // branchEntries are the already-read locals (no re-fetch); sh.id/pinnedEntryId read via readOwn (Proxy-safe).
    try {
      const staleAfterFires = config.shrink.staleAfterFires;
      for (const sh of markers.shrinks) {
        const pinnedEntryId = readOwn(sh, "pinnedEntryId");
        if (typeof pinnedEntryId !== "string" || pinnedEntryId.length === 0) continue; // live shrink → skip
        const id = readOwn(sh, "id");
        if (typeof id !== "string" || id.length === 0) continue; // unreadable id → skip (defensive)
        // resolvePinnedShrink aligns branchEntries with event.messages (PRE-filter) by identity; null = absent.
        const hit =
          resolvePinnedShrink(
            event.messages as unknown as MessageLike[],
            branchEntries as unknown as BranchEntry[],
            pinnedEntryId,
          ) !== null;
        if (hit) {
          rt.shrinkMissCounts.set(id, 0); // target present → reset miss count
        } else {
          const misses = (rt.shrinkMissCounts.get(id) ?? 0) + 1;
          rt.shrinkMissCounts.set(id, misses);
          if (misses >= staleAfterFires) {
            appendCancelMarker(pi, ctx, { targetId: id }); // auto-retire (next fire drops it); never throws
          }
        }
      }
    } catch (retireErr) {
      // Retirement failure must not break the turn (E13). Log + fall through to the normal return.
      try {
        log("warn", "filter.retire", sessionId, {
          error: retireErr instanceof Error ? retireErr.message : String(retireErr),
        });
      } catch {
        /* log() never throws, but be safe */
      }
    }

    // ONE cast at the return boundary: MessageLike[] -> Pi's AgentMessage[] (ContextEventResult.messages).
    return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };
  } catch (e) {
    // FAIL-OPEN (spec/03 #4, spec/08 E13): log + return nothing (pass-through). Never break the turn.
    try {
      log("error", "filter.fire", sessionId, { error: e instanceof Error ? e.message : String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
    return; // void → pass-through (C4)
  }
}

// ── registerFilterHandler — the production registration seam (consumed by index.ts, P1.M7.T1) ──

/**
 * registerFilterHandler — arm the `context` transform. Called once from the extension factory
 * (index.ts, P1.M7.T1.S1): `registerFilterHandler(pi)`. Delegates to `pi.on("context", contextHandler)`.
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerFilterHandler(pi: ExtensionAPI): void {
  // Thread pi through: the `context` callback only passes (event, ctx), but contextHandler needs pi for
  // appendCancelMarker (stale retirement, P3.M2.T3.S1). Mirrors registerTurnEndMetric (nudges.ts).
  pi.on("context", (event: ContextEvent, ctx: ExtensionContext) => contextHandler(pi, event, ctx));
}