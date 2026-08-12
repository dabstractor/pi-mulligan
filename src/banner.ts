import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { listCheckpoints } from "./tools/audit.js";

/** The stable widget key `reconcileBanner` owns. It is the SINGLE writer of this key (spec/13 §5):
 *  no other code may `ctx.ui.setWidget` this key. */
const BANNER_WIDGET_KEY = "mulligan:active-checkpoint";

/**
 * reconcileBanner — refresh the active-checkpoint banner so it reflects the CURRENT active-checkpoint state
 * (spec/13 §5; spec/08 E26). It is the SINGLE writer of the `mulligan:active-checkpoint` above-editor widget.
 *
 * Behavior (4 branches):
 *   (a) `!ctx.hasUI` → no-op (return). The banner is a TUI/RPC surface; in print/JSON/rpc-without-ui there is
 *       no UI to render it. (Guarded like every `ctx.ui.*` call in the codebase.)
 *   (b) `!config.ui.activeCheckpointBanner` → CLEAR (`setWidget(KEY, undefined)`) then return. Disabling the
 *       knob removes a banner shown on a PRIOR turn even if checkpoints are still active (spec/09 §3:
 *       "Disablable without disabling checkpoints"). Must clear (not just skip) so a prior banner disappears.
 *   (c) 0 active checkpoints → CLEAR then return (a checkpoint was just revoked or consumed by a rewind).
 *   (d) ≥1 active checkpoint → SET: one spec/13 §5 warning line per active checkpoint, `placement:"aboveEditor"`.
 *
 * Active-checkpoint discovery REUSES `listCheckpoints` (src/tools/audit.ts) — the same pure, two-phase
 * latest-wins scanner the audit + human /mulligan_audit command use (mirrors `checkpointExists` in rewind.ts),
 * so a CLEARED/CONSUMED checkpoint is never reported active. Never re-scan entries here.
 *
 * The WHOLE body is wrapped in ONE try/catch: this function NEVER throws. It is called from command handlers
 * (commands.ts: after checkpoint SET/REVOKE) and, after S3, from the contextHandler tail + session_start —
 * i.e. potentially every inference. A throwing `ctx.hasUI`/`getEntries`/`getConfig`/`setWidget` (e.g. a Proxy
 * trap) is logged via `console.warn("[mulligan] banner: …")` and swallowed. The log itself is wrapped so a
 * throwing `console` cannot re-throw (mirrors config.ts `warnConfig`).
 *
 * The banner is UI-ONLY: it is NEVER injected into `event.messages` (zero model-context cost — E26 acceptance (d)).
 * The param is typed `ExtensionContext` (the minimal interface) so this one function is callable from BOTH
 * command handlers (ExtensionCommandContext) and event handlers (ExtensionContext) — external_deps.md §2.
 *
 * @param ctx the Pi ExtensionContext (hasUI + ui.setWidget + sessionManager.getEntries are all on the base ctx)
 */
export function reconcileBanner(ctx: ExtensionContext): void {
  try {
    // (a) No UI surface → nothing to render (no-op in print/JSON/rpc-without-ui).
    if (!ctx.hasUI) return;

    // (b) Knob off → CLEAR even if checkpoints are active (a prior-turn banner must disappear).
    const config = getConfig();
    if (!config.ui.activeCheckpointBanner) {
      ctx.ui.setWidget(BANNER_WIDGET_KEY, undefined);
      return;
    }

    // Active-checkpoint discovery: REUSE listCheckpoints (pure, two-phase latest-wins — never reports a
    // cleared/consumed checkpoint as active). The cast is the established call-site idiom (audit.ts/commands.ts).
    const names = listCheckpoints(ctx.sessionManager.getEntries() as unknown as unknown[]);

    // (c) No active checkpoints → CLEAR.
    if (names.length === 0) {
      ctx.ui.setWidget(BANNER_WIDGET_KEY, undefined);
      return;
    }

    // (d) ≥1 active → SET one spec/13 §5 line per checkpoint (verbatim; <name> substituted, no Revoke-path quotes).
    const lines = names.map(
      (name) =>
        `⚠ Mulligan checkpoint active: "${name}" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke ${name}`,
    );
    ctx.ui.setWidget(BANNER_WIDGET_KEY, lines, { placement: "aboveEditor" });
  } catch (e) {
    // Never throw on the hot path. Log + swallow (mirror config.ts warnConfig; logging itself must not crash).
    try {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(`[mulligan] banner: failed to reconcile: ${reason}`);
    } catch {
      /* a throwing console must not re-throw */
    }
  }
}
