# Spec Extracts — `mulligan_cancel` (§5) + E21 + §10.1.11

**Source:** `spec/05-tools.md` §5, `spec/08-edge-cases.md` E21, `spec/10-testing.md` §1.11.
All text extracted VERBATIM from HEAD `0bcaa814` on 2025-08-10.

---

## 1. Parameter schema (typebox) — spec/05 §5

```ts
import { Type } from "typebox";

const CancelParams = Type.Object({
  target: Type.Union([
    Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of a message the marker affected." }) }),
    Type.Object({ by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
                  occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]) }),
    Type.Object({ by_content_includes: Type.String({ description: "Match a marker whose affected message(s) include this substring." }) }),
  ], { description: "How to identify the marker to cancel — the SAME hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired." }),

  markerId: Type.Optional(Type.String({ description: "Optional explicit fallback: the markerId returned by mulligan_rewind/mulligan_shrink in details.markerId. If both target and markerId are given, markerId wins." })),
}, { description: "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present." });
```

### Key structural differences vs the CURRENT code (`src/tools/cancel.ts`)

| Aspect | Current code | Target spec |
|---|---|---|
| `target` field | ABSENT | 3-arm union (identical shape to `ShrinkParams.target`) |
| `markerId` | `Type.String(...)` (REQUIRED) | `Type.Optional(Type.String(...))` (OPTIONAL fallback) |
| Object-level description | absent | `"Cancel accepts a target (preferred) or an explicit markerId (fallback). At least one MUST be present."` |
| `target` union description | N/A | `"How to identify the marker to cancel — the SAME hint shape mulligan_shrink uses..."` |

---

## 2. Description string (CANCEL_DESC) — spec/05 §6 "Description strings"

> **Cancel:** `"Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Identify the marker by \`target\` (same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that content is retired; or pass an explicit \`markerId\` if you have one. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."`

### Current code's CANCEL_DESC (for diff reference)

```
"Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when
you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken
transform would apply on every turn for the rest of the session. Pass the markerId you received in details
when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on
disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."
```

**Diff:** the middle sentence changes from "Pass the markerId you received in details when you issued the marker." to the target-based wording: "Identify the marker by `target` (same hint shape as mulligan_shrink...) — the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one."

---

## 3. Return shape — spec/05 §5

```ts
{ content: [{ type: "text", text: string }], details: { cancelled?: boolean; markerId?: string | null } }
// text on success:
//   "Mulligan: marker cancelled. The transform will no longer apply from the next turn on."
//   details: { cancelled: true, markerId: <the new cancel marker's entry id, or null> }
// text on no-op (no marker matched the target / unknown markerId):
//   "Mulligan: no active marker found for that target — nothing to cancel."
//   details: { cancelled: false }
// text on no-op (already cancelled):
//   "Mulligan: that marker is already cancelled."
//   details: { cancelled: false }
// text on refusal (disabled / unexpected error):
//   "Mulligan: refused — <reason>."   details: {}
```

**NOTE:** the not-found no-op text changes from the current `"Mulligan: no active marker found with that id — nothing to cancel."` to `"Mulligan: no active marker found for that target — nothing to cancel."` (reflects the target-based API).

---

## 4. Behavior (step by step) — spec/05 §5

1. **Config gate (E14):** if `config.enabled === false`, refuse with `"Mulligan is disabled"`. There is **no** `config.cancel` sub-knob — retraction is a safety/escape hatch, always available when Mulligan is enabled.
2. **Read entries FRESH (C12):** `entries = ctx.sessionManager.getEntries()`, wrapped in try/catch → `[]` on throw.
3. **Resolve the marker to retire:**
   - **Preferred — `target`:** resolve `params.target` against the current message snapshot using the **same pure resolver** `mulligan_shrink` uses (live each turn, robust to compaction). Then collect candidate markers — every active `mulligan:rewind`/`mulligan:shrink` whose effect covers the matched message: a *shrink* covers the message its own `target` resolves to; a *rewind* covers any message in its hidden span (resolved read-only). Pick the **most recent** candidate by `seq` (LIFO — the latest-issued marker affecting that content is the likely mistake). Read its uuid `data.id` via `readOwn`.
   - **Fallback — explicit `markerId`:** if `params.markerId` is set (or `target` resolved to nothing and `markerId` is present), scan `entries` for a custom entry whose `entry.id === params.markerId` AND `customType ∈ {"mulligan:rewind", "mulligan:shrink"}`; read its uuid `data.id`. If both `target` and `markerId` are given, `markerId` wins.
   - A marker whose `data.id` is unreadable/non-string/empty → treated as not found (malformed marker → safe no-op).
4. **Not-found no-op:** if no marker resolved → return `"no active marker found for that target"` no-op text + `details:{cancelled:false}`. `appendCancelMarker` NOT called.
5. **Already-cancelled check (idempotency):** re-scan ALL entries for `customType === "mulligan:cancel"` AND `data.targetId === <uuid>`. If found → return `"already cancelled"` no-op + `details:{cancelled:false}`. `appendCancelMarker` NOT called.
6. **Persist:** `appendCancelMarker(pi, ctx, { targetId: <uuid> })` — the `targetId` is the marker's uuid `data.id` (**NOT** the entry id). Never throws (returns `null` on failure). Returns the cancel marker's new entry id (or `null`).
7. **Return:** confirmation text + `details:{cancelled:true, markerId}`. (`cancelled` stays `true` even when `markerId` is `null`.)

The WHOLE body is wrapped in ONE try/catch → refusal `"unexpected error: <msg>"` on any exception (E13).

### "Target resolution → marker uuid" (critical subsection)

> The agent identifies the marker *by the content it affected* (a `target` hint, same as `mulligan_shrink`), but `readMarkers` drops markers by their uuid `data.id` ∈ `cancelledIds`. So the cancel tool MUST map: `target hint → matched message → covering marker → marker.data.id (uuid)` — and that uuid is the persisted `targetId`. The explicit `markerId` path short-circuits the first two hops (`entry.id → entry.data.id`) for hosts that surface `details.markerId`. Either way, what is persisted is the marker's uuid, **never** an entry id. On the next context fire, `readMarkers` builds `cancelledIds` from every cancel's `data.targetId` and drops the retired rewind/shrink before the pipeline sees it (E21 acceptance (b)).

### Refusal / no-op conditions

- **Disabled** (`config.enabled === false`): refusal text + `details:{}`.
- **No matching marker** (target resolved to no covering rewind/shrink, or unknown/malformed explicit `markerId`): safe no-op, `details:{cancelled:false}` (not a refusal — returns a reason, never throws).
- **Already-cancelled** (a `mulligan:cancel` with `data.targetId === uuid` exists): safe no-op, `details:{cancelled:false}` (idempotent).

---

## 5. E21 acceptance criteria — spec/08 E21

- **(a)** an agent can cancel any `mulligan:rewind`/`mulligan:shrink` by target (content/role hint) or by explicit `markerId`;
- **(b)** on the `context` fire after cancellation the transform no longer applies — unit test: cancel a shrink, assert the original message reappears verbatim in the filtered view; cancel a rewind, assert the hidden messages reappear;
- **(c)** `mulligan_audit` lists cancelled markers as retired;
- **(d)** cancelling a non-existent/already-cancelled id is a safe no-op that returns a reason and never throws (E13).

---

## 6. Test acceptance (Tier 1) — spec/10 §1.11

- `by_tool_call_id` hint → retires the uuid of the (single) marker whose matched message / `hideEntryIds` carries that id.
- `by_tool_name:"read", occurrence:"last"` → retires the most-recent active shrink or rewind whose covered span includes the last `read` result.
- `by_content_includes:"<substr>"` → retires the most-recent active marker covering a message whose text contains the substring.
- Several markers cover the match → **most recent by `seq`** is retired (LIFO); the rest stay active.
- No active marker covers the match → safe no-op (`cancelled:false`); nothing appended.
- Explicit `markerId` fallback → retires that exact marker; unknown id → safe no-op.
- After a successful cancel, the next `context` fire shows the originally-hidden/shrunk content verbatim (E21 (b)); the retired marker stays on disk.

### Tier 2 integration (spec/10 §2.1 F-cancel)

> **F-cancel** | create a `mulligan_shrink`, then `mulligan_cancel({target:{by_tool_name:"read", occurrence:"last"}})` | next `context` fire the originally-shrunk message reappears verbatim in the filtered view; session JSONL has both `mulligan:shrink` and `mulligan:cancel` entries (shrink is skipped, not deleted)

---

## 7. Spec example — spec/05 §5

```jsonc
// Agent issued a mis-targeted shrink on the last `read`, then retracts it BY TARGET:
mulligan_cancel({ target: { by_tool_name: "read", occurrence: "last" } })
// → "Mulligan: marker cancelled. The transform will no longer apply from the next turn on."
//   details: { cancelled: true, markerId: "entry-cancel-2" }
// Next context fire: the originally-shrunk message reappears verbatim in the filtered view.

// Explicit-id fallback (only when the host actually surfaces details.markerId):
mulligan_cancel({ markerId: "entry-sh-1" })
```

---

## 8. Spec/05 §1 step 6 — the `display:true` rationale (for M2.T2 reference)

> `pi.sendMessage({ customType:"mulligan:note", content: renderedNote, display:true, details:{...} })`. **(`display:true` is deliberate — it surfaces the note to the operator as well, so the human can see exactly what the model told its resumed self. This is the rewind counterpart of shrink's replacement echo: every self-directed payload is operator-visible.)**

## 9. Spec/09 — `shrink.notifyMaxChars` config knob (for M2 reference)

```
| `shrink.notifyMaxChars` | `2048` | Caps the replacement text shown to the operator via `ctx.ui.notify` when a shrink is recorded. Pure UI side-channel — zero context cost (the tool result itself stays terse). `@05-tools.md` §2. |
```

JSON example: `"notifyMaxChars": 2048, // cap on the replacement shown to the operator via ctx.ui.notify (ZERO context cost)`

## 10. Spec/05 §2 — shrink return shape + notify step (for M2 reference)

Return:
```ts
{ content: [{ type:"text", text: "Mulligan: shrink recorded. Matched: yes/no." }] }
```
> The replacement is NOT echoed in the result. Echoing it would place a second copy in the model's context — defeating the tool's entire purpose. The operator sees the extracted summary via ctx.ui.notify (behavior step 5) at ZERO context cost.

Behavior step 5 (REQUIRED):
```ts
if (ctx.hasUI) ctx.ui.notify(
  `Shrunk <target desc> — replacement:\n<<<\n${cap(replacement, config.shrink.notifyMaxChars)}\n>>>`,
  "info");
```

## 11. Spec/05 §3 step 5 — checkpoint auto-expiry (for M3 reference)

> **Auto-expiry on consumption (REQUIRED):** a checkpoint exists to be rewound *to*. Once a `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` successfully targets it, the checkpoint is **consumed** and MUST be retired — its label cleared (or suppressed via a `mulligan:checkpoint-cancel` entry) so it no longer appears active in `mulligan_audit`. Re-creating a checkpoint of the same name after consumption is allowed (sets a fresh label). A checkpoint that is never consumed persists, as today.

## 12. Spec/10 §2.1 F-checkpoint — checkpoint consumption test (for M3 reference)

> **F-checkpoint** | `mulligan_checkpoint("x")`, then `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` | label entry exists; rewind hides back to the labeled point; **checkpoint is consumed on use — `mulligan_audit` no longer lists it active and a second rewind to `"x"` refuses (not found) unless re-created (spec/05 §3 step 5)**

## 13. Spec/07 §1 — `renderBloatReminder` target signature + text (for M4 reference)

The spec targets a 2-arg signature `renderBloatReminder(toolName, bytes)`. The new text is a single line without the `[mulligan]` prefix, threshold mention, or "stays on disk" clause. The current code at `notes.ts:278` is 3-arg `(toolName, bytes, thresholdBytes)`.

## 14. Spec/07 §2 — `renderDriftNudge` target text (for M4 reference)

The spec targets removal of the `[mulligan]` prefix and the bloat clause from the delta-available path. The current code at `notes.ts:322` emits `[mulligan]` prefix + bloat-conditional first line.

## 15. Spec/07 §5.3 — drift nudge suppression (for M4.T3 reference)

> **Suppress the drift nudge when the agent already acted (REQUIRED):** the drift nudge MUST NOT fire for a turn in which the agent already issued a rewind/shrink (hard rule — regardless of delta or bloatHit). F-nudge-drift §5.3 negative: "a turn that produces a >threshold result AND shrinks/rewinds it in the same turn does NOT fire the drift nudge next turn."

The current `suppressCheck` (`nudges.ts:~390`) already implements this via a ts-window check. Its JSDoc needs to cite §5.3 explicitly.