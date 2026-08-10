# Spec Extraction — Checkpoint Auto-Expiry on Consumption (M3)

Extracted from spec/05 §3, spec/SPEC.md §2.3, spec/08 E15, spec/10 §2.1 F-checkpoint.

All four spec locations describe the same REQUIRED behavior: a checkpoint is consumed
when rewound to and MUST be retired so it no longer appears active in `mulligan_audit`.

---

## 1. spec/05-tools.md §3 — `mulligan_checkpoint` Behavior step 5 (verbatim)

> **Auto-expiry on consumption (REQUIRED):** a checkpoint exists to be rewound *to*. Once a
> `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` successfully targets it, the
> checkpoint is **consumed** and MUST be retired — its label cleared (or suppressed via a
> `mulligan:checkpoint-cancel` entry) so it no longer appears active in `mulligan_audit`. Rationale
> (live use): a used checkpoint has no further purpose, and unconsumed throwaway checkpoints
> otherwise linger in the active-marker list indefinitely. Re-creating a checkpoint of the same
> name after consumption is allowed (sets a fresh label). A checkpoint that is never consumed
> persists, as today.

**Key constraints from this section:**
- Trigger: a `mulligan_rewind(granularity:"checkpoint")` that **successfully targets** the checkpoint
  (passes all guards, persists the rewind marker).
- Effect: the checkpoint is **consumed** — its label cleared OR suppressed via a `mulligan:checkpoint-cancel` entry.
- Purpose: it no longer appears active in `mulligan_audit`.
- Re-creation: allowed — sets a fresh label (same name is fine).
- Unconsumed checkpoints persist unchanged.

---

## 2. spec/SPEC.md §2.3 — "What we build" (checkpoint consumption note)

> **Checkpoint** — tag the current position with a name, so a later rewind can target it precisely
> (auto-retired once rewound to, so consumed checkpoints don't accumulate).

This is the one-line product-level statement of the behavior. It confirms the auto-retire-on-consumption
is part of the core checkpoint design, not an afterthought.

---

## 3. spec/08-edge-cases.md E15 — "Very large number of accumulated markers/notes"

E15 addresses long-session marker/entry accumulation. The checkpoint-specific clause:

> Checkpoints are bounded separately by **auto-expiry on consumption** (`@05-tools.md` §3): a checkpoint
> used as a rewind target is retired immediately, so only unconsumed checkpoints persist.

**Key detail:** E15 frames checkpoint auto-expiry as the **bounding mechanism** for checkpoint
accumulation in long sessions (analogous to how `staleAfterFires` bounds shrink markers and `maxDepth`
bounds rewind markers). Without it, throwaway checkpoints would accumulate indefinitely in `mulligan_audit`.

---

## 4. spec/10-testing.md §2.1 — F-checkpoint acceptance criteria (verbatim)

| Scenario | How to drive | Pass criteria |
|---|---|---|
| **F-checkpoint** | `mulligan_checkpoint("x")`, then `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` | label entry exists; rewind hides back to the labeled point (assert filtered message count drops to prefix); **checkpoint is consumed on use — `mulligan_audit` no longer lists it active and a second rewind to `"x"` refuses (not found) unless re-created (spec/05 §3 step 5)** |

**Acceptance tests derived from F-checkpoint:**
1. After a successful checkpoint rewind, `mulligan_audit` no longer lists that checkpoint as active.
2. A second `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` to the consumed name refuses with "not found".
3. Re-creating (`mulligan_checkpoint("x")` again) sets a fresh label and a subsequent rewind works.
4. A checkpoint that is never consumed persists (unchanged behavior).
5. The rewind itself still succeeds (the marker persists, the filtered message count drops to prefix).

---

## Implementation summary (cross-referenced with codebase)

The spec allows **either** mechanism for retiring the checkpoint:
- **Label clear:** `pi.setLabel(targetEntryId, undefined)` — removes/invalidates the `mulligan:checkpoint:<name>` label.
- **Suppression entry:** append a `mulligan:checkpoint-cancel` custom entry that `audit.ts`/checkpoint scan filters on.

The label-clear approach is simpler (one `pi.setLabel` call) and naturally propagates to both
`audit.ts:listCheckpoints` (skips non-string labels) and `rewind.ts:checkpointExists` (returns false
when the label is gone). See `architecture/m3_checkpoint_expiry.md` for the verified `LabelEntry.targetId`
field and `pi.setLabel(entryId, string | undefined)` signature.