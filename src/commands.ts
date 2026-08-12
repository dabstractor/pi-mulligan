/**
 * commands.ts — the v1.1 *human-facing* checkpoint slash-command factories (spec/13 §2 `/mulligan_checkpoint
 * <name>` set, §3 `/mulligan_checkpoint_revoke <name>` revoke).
 *
 * This module replaces the removed v1 `mulligan_checkpoint` AGENT tool (E23 RESOLVED): the *user* — the actor
 * with foresight — now sets checkpoints via a slash command; the agent retains only
 * `mulligan_rewind(granularity:"checkpoint")` to rewind *to* them.
 *
 * Each factory returns the `{ description, handler }` shape consumed by `pi.registerCommand` (P2.M1.T1.S2 does
 * the registration; S3 writes the tests). `pi` is captured by the factory closure (the testable seam); `ctx` is
 * passed to the handler at CALL time as the 2nd argument. Handlers are write-only w.r.t. the model's context
 * (the notify is human-facing via `ctx.ui`; nothing is injected into `event.messages`). C2 does NOT block
 * registerCommand (external_deps.md §1: C2 forbids extension-injected MESSAGES dispatching as commands; this is
 * direct registration of a human-typed command).
 *
 * All `ctx.ui.notify` calls are guarded by `ctx.hasUI` (true in TUI/RPC, false in print/JSON). Every handler
 * body is wrapped in try/catch → unexpected-error notify; handlers NEVER throw.
 */
import {
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { setCheckpoint } from "./markers.js";
import type { RewindMarker, ShrinkMarker } from "./markers.js"; // type-only (audit writes nothing)
import { getConfig } from "./config.js";
import { getRuntime } from "./runtime.js"; // rt.lastFiltered (the cached filtered view)
import { filterPipeline } from "./transforms.js"; // E16 fallback only (spec/06 §7)
import { readMarkers } from "./filter.js"; // active markers (rewinds/shrinks/cancelledIds)
import { estimateTokens } from "./tokens.js"; // total + per-message token estimates
import { bloatThresholdFor } from "./nudges.js"; // per-tool bloat threshold (Nudge A)
import { validCheckpointName } from "./tools/checkpoint.js";
import { reconcileBanner } from "./banner.js";
import {
  renderAuditReport,
  listCheckpoints,
  describeMessage,
  messageBytes,
  buildCallLookup,
  type AuditRow,
} from "./tools/audit.js"; // the EXPORTED audit renderer + label helpers (same surface the agent tool uses)

/** notify — the hasUI-guarded ctx.ui.notify wrapper. Centralizes the `if (ctx.hasUI)` guard every handler
 *  notify needs (spec/13 §2 step 5: guard per call; ctx.hasUI is true whenever a human types a slash command,
 *  but guard anyway). Module-local (not exported). */
function notify(
  ctx: ExtensionCommandContext,
  msg: string,
  type: "info" | "warning" | "error",
): void {
  if (ctx.hasUI) ctx.ui.notify(msg, type);
}

/**
 * auditEntriesToMessages — the E16 fallback's entry→message conversion (spec/06 §7). This is a LOCAL REPLICA
 * of audit.ts's MODULE-PRIVATE `entriesToMessages`: it DELEGATES to Pi's canonical
 * `sessionEntryToContextMessages` (the exact same helper buildSessionContext uses) so the human command never
 * invents a divergent conversion and stays byte-identical to the agent tool's audit report. Each entry yields
 * ≥0 messages; non-yielding entry types (compaction/branch_summary/label/…) contribute nothing here (their
 * effect is already baked into the buildContextEntries() list). Defensive (never throws — a throwing entry
 * contributes [], matching spec/06 §7's "best-effort; flag confidence low"). Module-local (not exported).
 */
function auditEntriesToMessages(
  entries: SessionEntry[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of entries) {
    try {
      const msgs = sessionEntryToContextMessages(entry);
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          if (typeof m === "object" && m !== null && !Array.isArray(m)) {
            // Route through `unknown` — AgentMessage is a nominal-ish Pi union (e.g. CompactionSummaryMessage)
            // that is not directly assignable to Record<string, unknown> even though it is structurally a
            // record (GOTCHA #2). The runtime guard above proves it is a plain object.
            out.push(m as unknown as Record<string, unknown>);
          }
        }
      }
    } catch {
      // best-effort (spec/06 §7) — a throwing entry contributes []
    }
  }
  return out;
}

/**
 * clearCheckpointByName — clear (revoke) all ACTIVE `mulligan:checkpoint:<name>` labels (spec/13 §3). Two-phase
 * discovery+clear that MIRRORS `checkpointExists` in src/tools/rewind.ts (line 329).
 *
 * WHY two-phase: Pi's label map is APPEND-ONLY. A revoke (`pi.setLabel(id, undefined)`) appends a CLEAR entry,
 * so the HISTORICAL set entry stays in the raw `getEntries()` stream. Scanning raw entries for a string match
 * would therefore find a STALE label even after revocation. We MUST (a) DISCOVER candidate `targetId`s from raw
 * `label` entries, then (b) CONFIRM each via `ctx.sessionManager.getLabel(id) === needle` (latest-wins →
 * `undefined` once cleared), and ONLY clear confirmed-active candidates.
 *
 * Never throws: a throwing `getEntries` / `getLabel` / entry access (e.g. a throwing Proxy `get` trap) → skip
 * or return false, matching the defensive convention of checkpointExists. Returns true iff at least one active
 * candidate was cleared.
 *
 * The `ctx` parameter is typed `ExtensionContext` (the MINIMAL interface — NOT `ExtensionCommandContext`) so this
 * helper is reusable from both command handlers and (later) the banner / event-handler refresh points, matching
 * the sibling `checkpointExists(ctx: ExtensionContext, name)` signature in rewind.ts.
 *
 * @param pi   the Pi ExtensionAPI (setLabel clears the label)
 * @param ctx  the Pi ExtensionContext (getEntries to discover candidates; getLabel to confirm activity)
 * @param name the checkpoint name (the suffix after `mulligan:checkpoint:`)
 * @returns true iff at least one active `mulligan:checkpoint:<name>` label was cleared
 */
export function clearCheckpointByName(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
): boolean {
  const needle = `mulligan:checkpoint:${name}`;
  // DISCOVERY phase: collect candidate targetIds from raw label entries whose label string === needle.
  const candidates = new Set<string>();
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return false; // never let the revoke throw
  }
  if (!Array.isArray(entries)) return false;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
      if (
        ee.type === "label" &&
        ee.label === needle &&
        typeof ee.targetId === "string" &&
        ee.targetId.length > 0
      ) {
        candidates.add(ee.targetId);
      }
    } catch {
      // skip a throwing-Proxy entry
    }
  }
  if (candidates.size === 0) return false;
  // CONFIRM phase: clear each CANDIDATE whose latest-wins getLabel still maps to needle.
  let cleared = false;
  for (const id of candidates) {
    try {
      if (ctx.sessionManager.getLabel(id) === needle) {
        pi.setLabel(id, undefined); // CLEAR (appends a clear entry; latest-wins)
        cleared = true;
      }
    } catch {
      // a throwing getLabel → treat this candidate as inactive (never throw on the command hot path)
    }
  }
  return cleared;
}

/**
 * makeCheckpointCommand — factory for the `/mulligan_checkpoint <name>` SET command (spec/13 §2).
 *
 * pi is captured by the closure; the handler receives `(args, ctx)` at CALL time (the testable seam — tests do
 * `makeCheckpointCommand(fakePi).handler("name", fakeCtx)` without a real Pi). The returned shape
 * `{ description, handler }` is structurally assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]`
 * (`Omit<RegisteredCommand, "name" | "sourceInfo">`).
 *
 * Handler flow (spec/13 §2): parse name → disabled-gate → name-validation gate → `setCheckpoint` → on
 * `{entryId}` success (fair-warning notify + `reconcileBanner`) / on `{error}` (could-not-set notify). The
 * label mutation runs REGARDLESS of `ctx.hasUI`; only the notify is guarded. The whole body is wrapped in
 * try/catch → unexpected-error notify; the handler NEVER throws.
 *
 * @param pi the Pi ExtensionAPI (captured by the closure; passed to setCheckpoint)
 */
export function makeCheckpointCommand(pi: ExtensionAPI): {
  description: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
} {
  return {
    description:
      "Set a Mulligan checkpoint — the agent may rewind across your subsequent prompts back to this point",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        const name = (args ?? "").trim();
        if (!getConfig().enabled) {
          notify(ctx, "Mulligan is disabled", "warning"); // contract-literal disabled message (no "Mulligan: " prefix)
          return;
        }
        if (!validCheckpointName(name)) {
          notify(
            ctx,
            `Mulligan: invalid checkpoint name '${name}' (lowercase, digits, hyphen, underscore; max 40)`,
            "warning",
          ); // spec/13 §2 step 1 verbatim
          return;
        }
        const res = setCheckpoint(pi, ctx, name);
        if ("entryId" in res) {
          // [P3.M2.T1.S1 / @spec/13 §2 step 4b + @14 §5] v1.2 working-tree revert: capture a checkpoint
          // snapshot so a later mulligan_rewind(granularity:"checkpoint", revert_file_changes:true) can
          // restore files to this point. BEST-EFFORT: a capture failure is swallowed and NEVER blocks the
          // checkpoint (the label was already set by setCheckpoint above) — the fair-warning notify +
          // reconcileBanner below ALWAYS run. The mulligan:revert-checkpoint control entry lets a reloaded
          // session restore rt.snapshots (E32). The "ckpt:" namespace is exempt from prompt-boundary GC
          // (git refForLabel → checkpoint/<name>; CAS mark-sweep exempts "ckpt" manifests; gcTurnSnapshots
          // only clears keys starting with "turn"). NO return/throw inside this block — control falls
          // through to the notify + reconcileBanner (nested `if` guards only).
          if (getConfig().revert.enabled) {
            try {
              const sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); same pattern as makeAuditCommand
              const rt = getRuntime(sessionId);
              if (rt.store) {
                const backend = rt.store.describe().backend;
                if (backend !== "none") {
                  // narrowed to "git"|"cas" (const stays narrowed across the await) — NoOpStore skipped
                  const ckptRef = await rt.store.capture("ckpt:" + name);
                  if (ckptRef) {
                    rt.snapshots?.set("ckpt:" + name, {
                      label: "ckpt:" + name,
                      backend,
                      beforeRef: ckptRef,
                      turnIndex: -1, // sentinel: checkpoint, not turn-bound (rewind resolves by label)
                      ts: Date.now(),
                    });
                    // persist for cross-reload (E32): session_start re-reads mulligan:revert-checkpoint
                    // entries to rebuild rt.snapshots. { label, ref, backend } is the minimal restore set.
                    pi.appendEntry("mulligan:revert-checkpoint", {
                      label: "ckpt:" + name,
                      ref: ckptRef,
                      backend,
                    });
                  }
                }
              }
            } catch {
              /* best-effort — never blocks checkpoint creation (@14 §5 / E27) */
            }
          }
          notify(
            ctx,
            `Mulligan: checkpoint '${name}' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with /mulligan_checkpoint_revoke ${name}.`,
            "warning",
          ); // spec/13 §2 step 5 verbatim (the "(your prompts after here can be hidden)" parenthetical is load-bearing — reinforces E26 consent/forgetting risk)
          reconcileBanner(ctx); // refresh the banner only on a SUCCESSFUL mutation (spec/13 §2 step 6)
        } else {
          // "error" in res — discriminated-union narrowing (GOTCHA #9)
          notify(
            ctx,
            `Mulligan: could not set checkpoint: ${res.error}`,
            "warning",
          );
        }
      } catch (e) {
        notify(
          ctx,
          `Mulligan: unexpected error: ${e instanceof Error ? e.message : String(e)}`,
          "warning",
        );
      }
    },
  };
}

/**
 * makeCheckpointRevokeCommand — factory for the `/mulligan_checkpoint_revoke <name>` REVOKE command (spec/13 §3).
 *
 * pi is captured by the closure; the handler receives `(args, ctx)` at CALL time. The returned shape is
 * structurally assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]`.
 *
 * Handler flow (spec/13 §3): parse name → disabled-gate → `clearCheckpointByName` → on not-cleared (not-found
 * notify) / on cleared (`reconcileBanner` + revoked notify). The whole body is wrapped in try/catch →
 * unexpected-error notify; the handler NEVER throws.
 *
 * @param pi the Pi ExtensionAPI (captured by the closure; passed to clearCheckpointByName for setLabel)
 */
export function makeCheckpointRevokeCommand(pi: ExtensionAPI): {
  description: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
} {
  return {
    description: "Revoke a Mulligan checkpoint",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        const name = (args ?? "").trim();
        if (!getConfig().enabled) {
          notify(ctx, "Mulligan is disabled", "warning");
          return;
        }
        const cleared = clearCheckpointByName(pi, ctx, name);
        if (!cleared) {
          notify(
            ctx,
            `Mulligan: no active checkpoint named '${name}'.`,
            "info",
          ); // spec/13 §3 step 2 verbatim (closing apostrophe on <name>)
        } else {
          reconcileBanner(ctx); // refresh the banner only when state actually changed (spec/13 §3 step 4)
          notify(
            ctx,
            `Mulligan: checkpoint '${name}' revoked. The agent can no longer rewind across your prompts to it.`,
            "info",
          ); // spec/13 §3 step 5
        }
      } catch (e) {
        notify(
          ctx,
          `Mulligan: unexpected error: ${e instanceof Error ? e.message : String(e)}`,
          "warning",
        );
      }
    },
  };
}

/**
 * makeAuditCommand — factory for the `/mulligan_audit` HUMAN-facing command (spec/13 §4). Produces the SAME
 * report the agent's `mulligan_audit` tool produces (`renderAuditReport`) and surfaces it to the human via
 * `ctx.ui.notify` ONLY — the report NEVER enters `event.messages` (a human command must not bloat the
 * model's context; spec/13 §4 step 2). The agent RETAINS its own `mulligan_audit` tool; same renderer, the
 * sink is determined by who invoked it (human → ctx.ui here; agent → the tool result).
 *
 * The handler is a VERBATIM mirror of `auditExecute` (src/tools/audit.ts): disabled-gate FIRST → `!ctx.hasUI`
 * early return → resolve the FILTERED view (`rt.lastFiltered` cached else the E16 `filterPipeline` fallback;
 * NEVER `ctx.getContextUsage()` — D5 / bookkeeping drift) → `totalTokens = estimateTokens(filtered)` from the
 * SAME view used for the rows (NOT `computeFilteredTotal`, whose E16 fallback deliberately omits
 * filterPipeline and would diverge from the agent tool's report) → top-8 ranked rows via `buildCallLookup` +
 * `describeMessage`/`messageBytes`/`bloatThresholdFor` → `readMarkers` + `listCheckpoints` →
 * `renderAuditReport` (identical call to the agent tool) → `notify(ctx, report, "info")`.
 *
 * `pi` is captured by the closure for REGISTRATION UNIFORMITY with the sibling factories (index.ts, in S2,
 * does `pi.registerCommand("mulligan_audit", makeAuditCommand(pi))`) but is UNUSED — the audit, like its
 * tool, needs no `pi` (every read goes through `ctx` / pure helpers). `args` is IGNORED (reserved for a
 * future `top` override, spec/13 §4; hardcoded `top = 8`). The whole body is wrapped in try/catch →
 * unexpected-error notify; the handler NEVER throws and NEVER calls `pi.sendMessage`/`pi.appendEntry`.
 *
 * @param pi the Pi ExtensionAPI (captured by the closure; unused — the audit is read-only via ctx)
 */
export function makeAuditCommand(pi: ExtensionAPI): {
  description: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
} {
  return {
    description:
      "Run the Mulligan context-bloat diagnostic — see what the model is carrying",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // args reserved for a future `top` override (/mulligan_audit 20); ignored for now (spec/13 §4).
      try {
        const config = getConfig();
        if (!config.enabled) {
          // disabled gate FIRST (mirror auditExecute step 0 + the sibling commands; GOTCHA #7): contract-literal,
          // NO "Mulligan: " prefix. When disabled the context handler is pass-through, so reporting a transformed
          // view would mislead (D5) — refuse BEFORE any session access.
          notify(ctx, "Mulligan is disabled", "warning");
          return;
        }
        if (!ctx.hasUI) return; // skip the expensive pipeline in print/JSON mode (the audit does real work)

        const sessionId = ctx.sessionManager.getSessionId(); // read FRESH (C12)
        const rt = getRuntime(sessionId);

        // Resolve the FILTERED view — mirror auditExecute (NEVER ctx.getContextUsage() — D5 / GOTCHA #1).
        let filtered: Record<string, unknown>[];
        let confidence: "low" | "medium" | "high";
        if (Array.isArray(rt.lastFiltered)) {
          // PRIMARY: the filter's cached output (spec/06 §7 — "written by the filter each fire").
          filtered = rt.lastFiltered;
          confidence = config.audit.estimateConfidence;
        } else {
          // E16 fallback (spec/06 §7): entries → messages → re-run the SAME pipeline. The ONLY place
          // filterPipeline is re-run intentionally. filterPipeline's 4th arg is branchEntries (getBranch),
          // NOT ctx (transforms.ts signature) — copy the verbatim cast from audit.ts (GOTCHA #2/#11).
          const base = auditEntriesToMessages(
            ctx.sessionManager.buildContextEntries(),
          );
          const branch = ctx.sessionManager.getBranch();
          filtered = filterPipeline(
            base,
            readMarkers(ctx),
            config,
            branch as unknown as Parameters<typeof filterPipeline>[3],
          );
          confidence = "low";
        }

        // Total from the SAME filtered view used for the rows (NOT computeFilteredTotal — GOTCHA #1: its E16
        // fallback omits filterPipeline, so it would diverge from the agent tool's report on the fallback path).
        type TM = Parameters<typeof estimateTokens>[0];
        const totalTokens = estimateTokens(filtered as unknown as TM).tokens; // verbatim cast (GOTCHA #2)

        // Top-N rows (hardcoded top=8; args ignored — GOTCHA #9).
        const top = 8;
        const callLookup = buildCallLookup(filtered);
        const rows: AuditRow[] = filtered
          .map((m) => ({
            tokens: estimateTokens([m] as unknown as TM).tokens,
            msg: m,
          })) // verbatim cast (GOTCHA #2)
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, top)
          .map(({ tokens, msg }) => {
            // GOTCHA #3: no module-private readStr here — use clean inline guards (no `as any`).
            const toolName =
              typeof msg.toolName === "string" ? msg.toolName : undefined;
            const rowThreshold = bloatThresholdFor(toolName, config);
            return {
              tokens,
              role: typeof msg.role === "string" ? msg.role : "?",
              label: describeMessage(msg, callLookup),
              bloaty: messageBytes(msg) > rowThreshold,
              thresholdBytes: rowThreshold,
            };
          });

        // Active markers (readMarkers) + checkpoints (scanned separately — readMarkers returns only custom-entry
        // markers; checkpoints are LabelEntries). Verbatim from auditExecute step 3.
        const markers = readMarkers(ctx);
        const checkpointNames = listCheckpoints(
          ctx.sessionManager.getEntries() as unknown as unknown[],
        );

        // Render the report — IDENTICAL call to the agent tool's renderAuditReport (spec/13 §4 step 2: "same renderer").
        const report = renderAuditReport({
          totalTokens,
          confidence,
          rewinds: markers.rewinds as RewindMarker[],
          shrinks: markers.shrinks as ShrinkMarker[],
          checkpointNames: checkpointNames,
          protectedRoles: config.rewind.protectedRoles,
          rows,
          filtered,
          cancelledCount: markers.cancelledIds.size,
        });

        // Surface to the human ONLY (GOTCHA #5/#10): notify is a one-shot human sink; it never touches the session
        // tree, so the report never enters event.messages. NEVER pi.sendMessage/pi.appendEntry.
        notify(ctx, report, "info");
      } catch (e) {
        notify(
          ctx,
          `Mulligan: unexpected error: ${e instanceof Error ? e.message : String(e)}`,
          "warning",
        );
      }
    },
  };
}
