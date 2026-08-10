# Spec Requirements for Bug Fixes (BUG-001 through BUG-006)

This document extracts the EXACT spec language each bug violates, with section numbers and acceptance criteria. Downstream implementation agents should treat these as authoritative contract references.

---

## BUG-001 (Major): Checkpoint not consumed when the same name is set on multiple targets

### Primary spec: spec/05-tools.md §3 step 5 — "Auto-expiry on consumption (REQUIRED)"

**EXACT spec text:**

> **Auto-expiry on consumption (REQUIRED):** a checkpoint exists to be rewound *to*. Once a `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` successfully targets it, the checkpoint is **consumed** and MUST be retired — its label cleared (or suppressed via a `mulligan:checkpoint-cancel` entry) so it no longer appears active in `mulligan_audit`. Rationale (live use): a used checkpoint has no further purpose, and unconsumed throwaway checkpoints otherwise linger in the active-marker list indefinitely. Re-creating a checkpoint of the same name after consumption is allowed (sets a fresh label). A checkpoint that is never consumed persists, as today.

**Key MUST clause:** "Once a `mulligan_rewind` successfully targets it, the checkpoint is consumed and **MUST be retired**."

**Section number:** spec/05-tools.md §3, step 5 (under `mulligan_checkpoint` Behavior)

### Acceptance criterion: spec/10-testing.md §2.1 — F-checkpoint

**EXACT spec text (table row):**

| Scenario | How to drive | Pass criteria |
|---|---|---|
| **F-checkpoint** | `mulligan_checkpoint("x")`, then `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` | label entry exists; rewind hides back to the labeled point (assert filtered message count drops to prefix); **checkpoint is consumed on use — `mulligan_audit` no longer lists it active and a second rewind to `"x"` refuses (not found) unless re-created (spec/05 §3 step 5)** |

**Key acceptance phrase:** "a second rewind to 'x' refuses (not found) unless re-created"

### Related: spec/08-edge-cases.md E10

> **E10. Checkpoint name invalid or not found**
> - **Situation:** `granularity:"checkpoint"` with a name that doesn't match `/^[a-z0-9_-]{1,40}$/` or no such labeled entry exists on the branch.
> - **Behavior:** refuse with the reason.

### Implementation location

`src/tools/rewind.ts` — step 7b checkpoint-consumption loop (the `if (granularity === "checkpoint")` block). The current code iterates `getEntries()` in append order, calls `pi.setLabel(targetId, undefined)` on the FIRST matching label entry, then `break`s. This clears only the OLDEST target when multiple targets share the same label string.

### Fix direction

The consumption loop should clear the SPECIFIC target that `resolveCheckpoint` determined was the match (the most-recent/leaf-most target), OR clear ALL label entries whose current `getLabel` maps to the checkpoint name. The current single-clear-and-break only retires the oldest target, leaving newer targets active.

---

## BUG-002 (Minor): nudges.driftWindowTurns accepts fractional values that floor to 0

### Primary spec: spec/07-preventive-and-nudges.md §5.1 — "Windowed drift signaling (REQUIRED)"

**EXACT spec text:**

> `shouldNudge` MUST smooth the per-turn delta over a rolling window of the last `config.nudges.driftWindowTurns` turns (default 3) before comparing to `driftThresholdTokens` — fire when the *windowed* (moving-average, or M-of-N) delta crosses the threshold, NOT on a single turn's raw delta.

**Acceptance criteria from §5.1:**

> (a) a single 8k-token turn amid small turns does NOT fire; (b) three ~4k turns in a row DO fire; (c) a single large result (>threshold) with ~0 net growth does NOT fire the drift nudge even though it does trigger Nudge A.

### Related: spec/09-configuration.md §4 — Validation rules

**EXACT spec text for integer knobs:**

> `rewind.maxRetriesPerPrompt`: integer ≥ 1; non-integer or `<1` → default.

And the general number validation rule:

> Numbers: must be finite, `>= 0` (thresholds `> 0`); invalid → default.

### Related: spec/09-configuration.md §3 — Rationale table for driftWindowTurns

> | `nudges.driftWindowTurns` | `3` | Rolling window over which the drift delta is smoothed before thresholding (`@07` §5.1). Turns a noisy single-turn signal into a sustained-growth signal. |

### Implementation location

`src/config.ts` — `validateConfig`, the `nudges.driftWindowTurns` branch:
```ts
const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
```
Missing `Math.floor(n) >= 1` guard. The sibling `rewind.maxRetriesPerPrompt` DOES guard correctly:
```ts
cfg.rewind.maxRetriesPerPrompt = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt;
```

### Fix direction

Apply the same `Math.floor(n) >= 1 ? Math.floor(n) : default` guard already used for `maxRetriesPerPrompt` to `driftWindowTurns`. A value like `0.5` currently passes the `> 0` coerceNumber check, then `Math.floor(0.5) === 0`, producing a degenerate zero-length window.

---

## BUG-003 (Minor): shrink.maxActive and shrink.staleAfterFires accept fractional values

### Primary spec: spec/09-configuration.md §4 — Validation rules

**EXACT spec text:**

> `rewind.maxRetriesPerPrompt`: integer ≥ 1; non-integer or `<1` → default.

This establishes the integer-validation precedent that `maxActive` and `staleAfterFires` should follow (they are the same semantic class: integer count knobs).

### Related: spec/09-configuration.md §3 — Rationale table

> | `shrink.maxActive` | `32` | Bounds long-session filter cost and marker accumulation; the oldest shrink is retired when exceeded. Mirrors `rewind.maxDepth`. |
> | `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent for this many consecutive fires (`@08-edge-cases.md` E15/E21). Stops dead markers from being walked every fire. |

### Related: spec/08-edge-cases.md E15 — Stale-marker retirement + soft cap (REQUIRED)

**EXACT spec text:**

> **Stale-marker retirement + soft cap (REQUIRED):** a pinned shrink whose target entry has been absent for `config.shrink.staleAfterFires` (default 3) consecutive fires MUST be auto-retired (treated as cancelled per E21) so it stops being resolved every fire. Active shrink markers are additionally capped at `config.shrink.maxActive` (default 32, mirroring `rewind.maxDepth`); when exceeded, the oldest is retired.

### Implementation location

`src/config.ts` — `validateConfig`, the `shrink.maxActive` and `shrink.staleAfterFires` branches:
```ts
v = safeGet(shrinkRaw, "maxActive");
if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
v = safeGet(shrinkRaw, "staleAfterFires");
if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
```
No `Math.floor` / integer guard. A value like `0.5` is accepted verbatim.

### Consequences in filter.ts

- Soft-cap check: `markers.shrinks.length > config.shrink.maxActive` becomes `1 > 0.5` → true with ONE shrink → oldest auto-retired immediately.
- Stale-retirement check: `misses >= config.shrink.staleAfterFires` becomes `1 >= 0.5` → pinned shrink retired after a SINGLE miss instead of 3.

### Fix direction

Apply the same `Math.floor(n) >= 1 ? Math.floor(n) : default` guard to both `maxActive` and `staleAfterFires`, matching `maxRetriesPerPrompt` and the proposed `driftWindowTurns` fix (BUG-002).

---

## BUG-004 (Minor): resolveShrinkTarget with empty by_content_includes matches the FIRST message

### Primary spec: spec/06-context-filter.md §5 — Shrink target resolution

The `by_content_includes` arm of `resolveShrinkTarget` in `src/transforms.ts` has no empty-string guard — every string `includes("")`, so an empty needle matches index 0 (the FIRST message) regardless of role.

### Related: spec/05-tools.md §2 — Shrink parameter schema

**EXACT spec text:**

> `Type.Object({ by_content_includes: Type.String({ description: "Shrink the (first) message whose text contains this substring." }) })`

The spec says "whose text contains this substring" — an empty substring is a degenerate case that should not match (defense-in-depth).

### Related: spec/08-edge-cases.md E13 (never throws)

The fix must remain defensive (return null for empty needle, not throw).

### Implementation location

`src/transforms.ts` — `resolveShrinkTarget`, the `by_content_includes` branch (~line 740-760):
```ts
const needle = readOwn(target, "by_content_includes");
if (typeof needle === "string") {
    for (let i = 0; i < messages.length; i++) {
        if (stringifyContent(readOwn(messages[i], "content")).includes(needle)) return i;
    }
    return null;
}
```

The other two arms already guard with `.length > 0`:
```ts
const callId = readOwn(target, "by_tool_call_id");
if (typeof callId === "string" && callId.length > 0) { ... }

const name = readOwn(target, "by_tool_name");
if (typeof name === "string" && name.length > 0) { ... }
```

### Fix direction

Add a `needle.length > 0` guard inside the `by_content_includes` arm (return null for empty), mirroring the existing `length > 0` checks on the other two arms. This is defense-in-depth — the shrink TOOL already refuses empty discriminators via `targetIsStructurallyValid`, but the FILTER-level resolver should not rely solely on the tool layer (old/persisted markers, hand-crafted entries).

---

## BUG-005 (Minor): mulligan_audit runs and reports a marker-transformed view even when config.enabled === false

### Primary spec: spec/08-edge-cases.md E14 — "Extension disabled via config"

**EXACT spec text:**

> **E14. Extension disabled via config**
> - **Situation:** `config.enabled === false` (or a sub-feature disabled).
> - **Behavior:** the `context` handler returns immediately (pass-through); tools refuse with "Mulligan is disabled." **The extension is a no-op.** Allows the human to disable without uninstalling.

**Key phrase:** "The extension is a no-op" — when disabled, the context handler does NOT transform (pass-through), does NOT cache `rt.lastFiltered`, and the model sees the UNFILTERED view. But `mulligan_audit` runs its fallback path (`filterPipeline`), APPLIES all markers, and reports a transformed total + active marker counts — actively misleading the agent about what the model sees.

### Related: spec/05-tools.md §4 — Audit behavior (D5 honest bookkeeping)

**EXACT spec text:**

> **Why audit must use the filtered view (D5):** `ctx.getContextUsage()` reflects Pi's bookkeeping, which still counts messages Mulligan has hidden. Reporting that number would mislead the agent into thinking a rewind "didn't work." The audit's whole value is honesty about what the model sees.

When disabled, the model sees the UNFILTERED view but audit reports the FILTERED view — the opposite of D5's "honesty about what the model sees."

### Implementation location

`src/tools/audit.ts` — `auditExecute` function. There is NO `config.enabled` gate at the top, unlike the rewind/shrink/cancel tools which all refuse with "Mulligan is disabled" when disabled:
- `src/tools/rewind.ts`: `if (!config.enabled) return refuse("Mulligan is disabled", granularity);`
- `src/tools/shrink.ts`: (same pattern)
- `src/tools/cancel.ts`: (same pattern)

The audit tool is the lone inconsistency.

### Note from audit.ts source comment

The audit source code explicitly documents this as intentional:
> NO config gate (GOTCHA #4): there is no `config.audit.enabled` switch and the audit does NOT refuse when `config.enabled === false`. The audit is always-on diagnostics (read-only). Mirror checkpoint GOTCHA #4.

However, the PRD notes this creates an inconsistency: when disabled, the model sees unfiltered context but audit reports a filtered/transformed view with active markers — actively misleading about what the model sees (violating D5).

### Fix direction

Either:
1. Add a `config.enabled` gate that reports the unfiltered view / refuses when disabled (recommended — aligns with E14 + D5), OR
2. Document that audit is intentionally always-on (the current code comment does this, but the behavior still misleads per D5).

The PRD recommends option 1 (add the gate).

---

## BUG-006 (Minor): to_previous_prompt (nuclear) rewind on the first/only user message persists a no-op marker instead of refusing

### Primary spec: spec/08-edge-cases.md E3 — "Rewinding across a protected message"

**EXACT spec text:**

> **E3. Rewinding across a protected message**
> - **Situation:** a `last_turn`/`to_previous_prompt`/checkpoint rewind would remove the first user message or the latest user message.
> - **Risk:** catastrophic amnesia (lose the original task or the current ask).
> - **Behavior:** **the tool refuses before persisting** (returns a refusal text). The filter also enforces `min(remove) > iFirstUser` as defense-in-depth (no-op + warn log). See `@06-context-filter.md` §8.

**Key MUST clause:** "the tool refuses **before persisting**" — the rewind tool must NOT persist a marker when the rewind would cross a protected boundary.

### Related: spec/05-tools.md §1 — Return shape (refusal text)

**EXACT spec text:**

> // text on validation/safety failure:
> //   "Mulligan: refused — <reason>. (e.g. would cross a protected message; max depth reached; checkpoint not found; per-prompt retry budget reached; context at abort fraction)"

### Related: spec/10-testing.md §2.1 — F-protected acceptance criterion

**EXACT spec text:**

| Scenario | How to drive | Pass criteria |
|---|---|---|
| **F-protected** | attempt `mulligan_rewind(granularity:"last_turn", to_previous_prompt:true)` when it's the first user message | tool returns refusal text; **no marker created** |

**Key phrase:** "no marker created" — the tool must NOT persist a `mulligan:rewind` marker when the rewind would cross the protected boundary.

### Implementation location

`src/tools/rewind.ts` — `rewindExecute`, between `resolvePreview` (step 5) and the persist step (step 7).

For `granularity:"last_turn"` with `to_previous_prompt:true` when the latest user message IS the first user message, `resolveLastTurn` (in `src/transforms.ts`) correctly returns `{ remove: [] }` (the nuclear-first-user protected refusal). However the rewind TOOL does NOT independently detect this case — it treats an empty `remove` from `resolvePreview` as a legitimate K=0 rewind, persists the marker (with empty `hideEntryIds`), leaves the note, and returns success text.

The correct behavior per E3: the tool should detect the protected-refusal case (to_previous_prompt crossing first:user, signaled by an empty `remove` from `resolveLastTurn`) and refuse BEFORE persisting.

### Fix direction

Add an explicit protected-refusal check in `rewindExecute` after `resolvePreview` returns: if `granularity === "last_turn"` AND `params.to_previous_prompt === true` AND `remove.length === 0` (resolveLastTurn returned empty — the protected refusal signal), return a refusal text WITHOUT persisting. This matches E3's "refuses before persisting" contract and F-protected's "no marker created" acceptance criterion.

---

## Summary: Spec Clauses Violated

| Bug | Spec Clause | Requirement Level | Key Language |
|---|---|---|---|
| BUG-001 | spec/05 §3 step 5 | MUST | "MUST be retired" — checkpoint consumed but not retired |
| BUG-001 | spec/10 §2.1 F-checkpoint | Acceptance | "a second rewind to 'x' refuses (not found)" — second rewind succeeds |
| BUG-002 | spec/07 §5.1 | REQUIRED | "MUST smooth... over a rolling window" — degenerate 0-length window defeats windowing |
| BUG-002 | spec/09 §4 | Validation | Integer knobs should guard `>= 1` (precedent: maxRetriesPerPrompt) |
| BUG-003 | spec/09 §4 | Validation | Same integer validation precedent as maxRetriesPerPrompt |
| BUG-003 | spec/08 E15 | REQUIRED | "MUST be auto-retired... consecutive fires" — fractional value changes threshold semantics |
| BUG-004 | spec/06 §5 | Defense-in-depth | Empty needle is degenerate match (tool guards but resolver doesn't) |
| BUG-005 | spec/08 E14 | Behavior | "The extension is a no-op" — audit reports transformed view when disabled |
| BUG-005 | spec/05 §4 (D5) | Honesty | "honesty about what the model sees" — misleading when disabled |
| BUG-006 | spec/08 E3 | MUST | "the tool refuses before persisting" — persists no-op marker instead |
| BUG-006 | spec/10 §2.1 F-protected | Acceptance | "no marker created" — marker created with empty hideEntryIds |

---

## Cross-References for Implementation

- All tools follow the shared convention: never throws (E13), every execute wrapped in try/catch → text result.
- Refusal text format: `"Mulligan: refused — <reason>."` (prefix + trailing dot).
- Config validation pattern for integer knobs (the `maxRetriesPerPrompt` precedent): `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : default`.
- Defense-in-depth discipline: the resolver layer should be self-protecting, not solely relying on the tool layer (transforms.ts is Pi-FREE and used by filterPipeline on every context fire).