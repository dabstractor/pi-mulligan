/**
 * reconcileBanner — refresh the active-checkpoint banner (spec/13 §5).
 *
 * STUB — implemented in P2.M3.T1.S2. The real implementation will scan for currently-active
 * `mulligan:checkpoint:*` labels (via the same two-phase discovery used by clearCheckpointByName /
 * checkpointExists in rewind.ts) and call `ctx.ui.setWidget("mulligan:active-checkpoint", lines, { placement: "aboveEditor" })`
 * — or `ctx.ui.setWidget("mulligan:active-checkpoint", undefined)` to clear it when no checkpoint is
 * active. Every `ctx.ui.*` call is guarded by `ctx.hasUI`.
 *
 * This stub is a typed no-op so `commands.ts`'s `import { reconcileBanner }` resolves today. It is called
 * from src/commands.ts after each successful checkpoint SET / REVOKE mutation (spec/13 §2 step 6, §3 step 4),
 * and will later also be hooked into the contextHandler tail + session_start by P2.M3.T1.S3.
 *
 * The parameter is typed `ExtensionContext` (the minimal interface — NOT `ExtensionCommandContext`) so this
 * same function is callable from both command handlers (ExtensionCommandContext) and event handlers
 * (ExtensionContext), which both receive an ExtensionContext-compatible `ctx`.
 *
 * @param _ctx the Pi ExtensionContext (intentionally unused in the stub)
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function reconcileBanner(_ctx: ExtensionContext): void {
  /* STUB — implemented in P2.M3.T1.S2 */
}