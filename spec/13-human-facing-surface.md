# 13 — Human-facing surface (slash commands, consent model, active-checkpoint banner)

> **v1.1 amendment.** v1 exposed every Mulligan operation to the agent and added *no* human command (D8). Two findings from live use forced a deliberate, narrow reversal:
>
> 1. **Checkpoint is exposed to the wrong actor (E23).** A checkpoint only pays off when set *before* a mistake — which requires *foresight* the agent does not have (it recognizes mistakes only in hindsight). The actor with the foresight is the **user**. v1 therefore moved the trigger to the user.
> 2. **`mulligan_audit`'s value is human-facing.** Its report (token ranking of the filtered view + bloat flags) is the thing a person watching the context window wants on demand. `/tree` serves only the audit-*trail* half (persisted entries); it cannot answer "what's eating my context." (D8's justification holds for the trail; it fails for the diagnostic.)
>
> This document specifies the **three human slash commands**, the **consent model** that legitimizes the agent's cross-prompt rewind power, and the **persistent active-checkpoint banner** that prevents a user from forgetting they have granted that power.

---

## 0. Mechanism — `pi.registerCommand` (and why C2 does not block it)

```ts
pi.registerCommand(name: string, options: {
  description?: string;
  getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}): void;
```

The handler receives **`ExtensionCommandContext`** (which extends `ExtensionContext`, adding session-control methods — see `@01-pi-context-internals.md` §2.2). This is legitimate and is **not** the path C2 (`@02-proven-constraints.md`) forbids. C2 proves an **agent tool** cannot reach command context via `pi.sendUserMessage` (extension-injected messages bypass command dispatch). It says nothing about a **human typing a registered command directly** — that is the normal, supported dispatch path (`@02` runner `getRegisteredCommands`/`resolveRegisteredCommands`). Mulligan v1 avoided commands entirely; v1.1 introduces exactly **three**, each human-invoked, each with a focused, safe contract.

The three commands are thin handlers that capture `pi` via closure at registration (mirroring the tool factories) and call the existing pure helpers / `markers.ts` wrappers. They are **write-only w.r.t. the model's context**: none of them injects content into `event.messages`. `/mulligan_audit`'s report is shown to the *human* (transcript / `ctx.ui`), not pushed into the model's view.

---

## 1. The guardrail — no rewind wipes user input (REQUIRED)

**Principle:** a rewind may hide the agent's own output (tool calls, results, reasoning) freely, but it must **never** hide a `user` message. The single exception is a checkpoint rewind: because a checkpoint can be created **only** by the human (`/mulligan_checkpoint` — the agent tool is removed), the user's act of setting one is consent for the agent to rewind across their *subsequent* prompts back to that point. `first:user` is never wiped. (This is why v1's `to_previous_prompt` option is removed — it discarded the latest user message.) No runtime consent gate is needed: there is no agent path that can create a checkpoint, so a checkpoint's existence *is* the consent.

Per granularity:

Per granularity:

| Granularity | Hides a `user` message? | Consent required? |
|---|---|---|
| `last_tool_call_group` | No — it is an assistant+results unit. | No (never crosses a user message). |
| `last_turn` (default) | No — keeps the latest user message by construction (`@06` §4). | No. |
| `checkpoint` | **Yes** — discards everything after the checkpoint, including subsequent user messages. | **Yes** — legitimized by the user setting the checkpoint (the only way to create one) + the §5 warning/banner. |

**`first:user` is unconditionally protected and cannot be consented away.** Checkpoints are set at the leaf (always at/after the first user message), `remove` is strictly `> iTarget`, and `protectedOk` (`@06` §8) independently blocks any rewind whose `min(remove) <= iFirstUser`. No checkpoint, no consent, and no config option overrides the original-task boundary.

---

## 2. `/mulligan_checkpoint <name>` (set) — REPLACES the agent tool

> Replaces the v1 `mulligan_checkpoint` agent tool (removed — see `@05-tools.md` §3). The agent can no longer set checkpoints (resolves E23). The agent's `mulligan_rewind(granularity:"checkpoint")` is retained.

**Purpose:** the user tags the current position with a name so a later rewind (agent- or, if re-added, user-initiated) can target it. By setting it, the user **consents** to the agent rewinding across their subsequent prompts back to this point, for the lifetime of the checkpoint.

**Name rule:** `/^[a-z0-9_-]{1,40}$/`. Reusing a name moves the label (Pi labels are unique-per-target).

**Behavior:**
1. Validate `name`. On invalid → `ctx.ui.notify("Mulligan: invalid checkpoint name '<name>' (lowercase, digits, hyphen, underscore; max 40)", "warning")`; return.
2. `const leafId = ctx.sessionManager.getLeafId();`
3. `pi.setLabel(leafId, \`mulligan:checkpoint:${name}\`);` — same label mechanism as v1 (`@04` §6). (Use the **last real `message` entry** on the branch, not a transient/non-context-producing leaf, per BUG-003 — walk `getBranch()` backwards to a context-producing entry.)
4. (No provenance machinery — a checkpoint is just the label. Since only this command creates checkpoints, every checkpoint is user-owned by construction; nothing extra is persisted.)
   - **4b. Working-tree snapshot (v1.2 — `@14` §5):** if `config.revert.enabled`, capture a whole-working-tree snapshot (via the `SnapshotStore`) tagged with the checkpoint name, so a later `mulligan_rewind(granularity:"checkpoint", revert_file_changes:true)` can restore files to this point. Best-effort; a capture failure is logged and never blocks checkpoint creation.
5. **Fair-warning notify (REQUIRED):** `ctx.ui.notify("Mulligan: checkpoint '<name>' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with /mulligan_checkpoint_revoke <name>.", "warning")`. Guarded by `ctx.hasUI`.
6. **Arm/refresh the banner (§5)** so the reminder is visible from this turn on.
7. No content is injected into the model's context.

**No agent path.** There is no `mulligan_checkpoint` tool after v1.1. An agent that "wants" a checkpoint cannot create one; if a workflow needs one, the user sets it. (This is the point of E23.)

---

## 3. `/mulligan_checkpoint_revoke <name>` (revoke)

**Purpose:** revoke (clear) a user-set checkpoint, withdrawing the cross-prompt rewind consent from the next turn on. The agent can no longer rewind to it.

**Behavior:**
1. Find the active checkpoint label `mulligan:checkpoint:<name>` on the branch (scan `getEntries()`; resolve via `getLabel(id)===needle` for latest-wins, mirroring `@05` checkpoint-exists logic).
2. Not found → `ctx.ui.notify("Mulligan: no active checkpoint named '<name>'.", "info")`; return.
3. `pi.setLabel(targetId, undefined);` — clears the label. (Revocation is auditable via `/tree`: the label-set and label-clear are both persisted entries.)
4. **Refresh the banner (§5)** — if no checkpoints remain active, clear it.
5. `ctx.ui.notify("Mulligan: checkpoint '<name>' revoked. The agent can no longer rewind across your prompts to it.", "info")`.

Revoking a checkpoint that is mid-rewind-target (an agent `mulligan_rewind` already issued this turn) does NOT retroactively cancel that rewind — the marker is already persisted; the revocation takes effect on the **next** `context` fire (the checkpoint label is gone, so a *subsequent* checkpoint rewind by the same name refuses "not found"). Use `/mulligan_audit` + the existing `mulligan_cancel` for marker retraction.

---

## 4. `/mulligan_audit` (user-facing)

**Purpose:** the human runs the same context-bloat diagnostic the agent's `mulligan_audit` tool produces — on demand, without asking the agent. The agent tool is **retained** (the agent still uses it); this command is the human's direct path.

**Behavior:**
1. Reuse the existing `auditExecute` pipeline (`@05-tools.md` §4 / `src/tools/audit.ts`) — resolve the filtered view (`rt.lastFiltered`, else the E16 fallback), rank by tokens, flag bloat, list active markers **and active checkpoints**, render the report.
2. **Output follows the caller.** A human running `/mulligan_audit` gets the report in the transcript / via `ctx.ui` (never injected into `event.messages` — a human command must not bloat the model's context). The agent's `mulligan_audit` tool result reaches the model when the *agent* calls it. Same renderer; the sink is determined by who invoked it: human → human, agent → agent.
3. **Banner-aware:** the report's `Active markers` line includes `N checkpoints [names] (user-set)` so the human can see what they have armed.

`/mulligan_audit` ignores its `args` (reserved for a future `top` override: `/mulligan_audit 20`).

---

## 5. Active-checkpoint banner (persistent reminder — REQUIRED)

**Problem:** a checkpoint grants destructive power for its entire lifetime, which may span many turns. A one-time warning at set time is insufficient — beyond a certain point the user forgets the checkpoint is armed and the power silently remains in the agent's hands.

**Mechanism — `ctx.ui.setWidget` with `placement: "aboveEditor"`** (verified in the installed `ExtensionUIContext`):
```ts
ctx.ui.setWidget(
  "mulligan:active-checkpoint",                       // stable key
  [ <one line per active checkpoint> ],                // string[] content
  { placement: "aboveEditor" },                        // renders ABOVE the prompt box
);
```
Pass `undefined` as content to clear it: `ctx.ui.setWidget("mulligan:active-checkpoint", undefined)`.

**Content (per active checkpoint, one line):**
```
⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>
```
Multiple active checkpoints → multiple lines (one each). Guarded by `ctx.hasUI` (no-op in print/JSON/rpc-without-ui).

**Refresh points (reconcile banner ⇄ active-checkpoint state):**
1. **`/mulligan_checkpoint` (set)** and **`/mulligan_checkpoint_revoke`** — the command handlers refresh immediately after mutating state.
2. **`session_start`** — restore the banner if an active checkpoint exists on the resumed session (so `/resume` does not silently drop the reminder).
3. **Every `context` fire (defense-in-depth)** — the filter already scans checkpoints; after computing the active set, reconcile the banner (set if ≥1 active, clear if 0). This catches **consumption** (a checkpoint rewind retires the label, `@05` §3 step 5) and any state change the command hooks missed. Cheap: the scan is already happening.

**Why a widget and not `ctx.ui.notify`:** `notify` is a transient toast (disappears); a widget with `placement:"aboveEditor"` persists until cleared, which is the requirement. `ctx.ui.setStatus` (footer) is an alternative but is lower-visibility than a dedicated above-editor region and shares the footer with other statuses.

---

## 6. Interaction with the rest of the spec

- **Agent tool inventory** (`@03` §2.1, `@05`): `mulligan_checkpoint` is **removed**; the agent tool count drops from 5 to **4** (`mulligan_rewind`, `mulligan_shrink`, `mulligan_audit`, `mulligan_cancel`). `mulligan_rewind(granularity:"checkpoint")` is **retained** — the agent rewinds to user-set checkpoints.
- **Protected messages** (`@06` §8): the guardrail — `last_turn`/`last_tool_call_group` never wipe user input; a `checkpoint` rewind may (the user opted in). `first:user` stays unconditionally protected.
- **E23** (`@08`): **resolved** — checkpoints moved to the user (the actor with foresight).
- **E3** (`@08`): updated for the consent model.
- **Drift nudge** (`@07` §2): the drift `deltaTokens` now **excludes user-attributable content** (see `@07` v1.1 amendment and `@04` §5) — user prompts must not trip a rewind/shrink-prescribing nudge.
- **Config** (`@09`): add `mulligan.ui.activeCheckpointBanner` (default `true`) to let the human disable the banner without disabling checkpoints.

## 7. Cross-references
- Checkpoint label data shape → `@04-data-model.md` §6 (just a label — user-owned by construction)
- Rewind checkpoint targeting → `@06-context-filter.md` §6 (unchanged); guardrail in `@05` rewind behavior §1 step 3b
- Protected-message enforcement → `@06-context-filter.md` §8
- Drift nudge agent-attributable delta → `@07-preventive-and-nudges.md` §2
- Edge cases → `@08-edge-cases.md` E3, E23 (resolved), E26 (banner)