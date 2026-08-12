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
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setCheckpoint } from "./markers.js";
import { getConfig } from "./config.js";
import { validCheckpointName } from "./tools/checkpoint.js";
import { reconcileBanner } from "./banner.js";

/** notify — the hasUI-guarded ctx.ui.notify wrapper. Centralizes the `if (ctx.hasUI)` guard every handler
 *  notify needs (spec/13 §2 step 5: guard per call; ctx.hasUI is true whenever a human types a slash command,
 *  but guard anyway). Module-local (not exported). */
function notify(ctx: ExtensionCommandContext, msg: string, type: "info" | "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(msg, type);
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
export function clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean {
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
      if (ee.type === "label" && ee.label === needle && typeof ee.targetId === "string" && ee.targetId.length > 0) {
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
    description: "Set a Mulligan checkpoint — the agent may rewind across your subsequent prompts back to this point",
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
          notify(
            ctx,
            `Mulligan: checkpoint '${name}' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with /mulligan_checkpoint_revoke ${name}.`,
            "warning",
          ); // spec/13 §2 step 5 verbatim (the "(your prompts after here can be hidden)" parenthetical is load-bearing — reinforces E26 consent/forgetting risk)
          reconcileBanner(ctx); // refresh the banner only on a SUCCESSFUL mutation (spec/13 §2 step 6)
        } else {
          // "error" in res — discriminated-union narrowing (GOTCHA #9)
          notify(ctx, `Mulligan: could not set checkpoint: ${res.error}`, "warning");
        }
      } catch (e) {
        notify(ctx, `Mulligan: unexpected error: ${e instanceof Error ? e.message : String(e)}`, "warning");
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
          notify(ctx, `Mulligan: no active checkpoint named '${name}'.`, "info"); // spec/13 §3 step 2 verbatim (closing apostrophe on <name>)
        } else {
          reconcileBanner(ctx); // refresh the banner only when state actually changed (spec/13 §3 step 4)
          notify(
            ctx,
            `Mulligan: checkpoint '${name}' revoked. The agent can no longer rewind across your prompts to it.`,
            "info",
          ); // spec/13 §3 step 5
        }
      } catch (e) {
        notify(ctx, `Mulligan: unexpected error: ${e instanceof Error ? e.message : String(e)}`, "warning");
      }
    },
  };
}