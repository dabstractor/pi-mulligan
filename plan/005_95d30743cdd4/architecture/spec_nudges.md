# Spec Extracts — Nudge Refinements (spec/07 + spec/10)

All text below is **VERBATIM** from the current spec (HEAD `0bcaa814`). This is the source of truth the code must match.

---

## §1 — `renderBloatReminder(toolName, bytes)`

### Signature + mechanism (verbatim pseudocode, spec/07 §1)

```ts
const reminder = renderBloatReminder(event.toolName, bytes);  // threshold gates firing above; no longer rendered
```

> The comment "threshold gates firing above; no longer rendered" confirms the threshold is **NOT** passed to the renderer — it only gates **firing** at the `if (bytes < threshold) return;` line above.

### Rendered text (VERBATIM, spec/07 §1 `renderBloatReminder(toolName, bytes)`)

```md
This result added ~<KB> KB to your context. If you don't need the full output, call `mulligan_shrink` with a summary or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole call was a mistake.
```

**Key differences from current code:**
- NO `[mulligan]` prefix
- NO threshold mention (`(threshold <T> KB)` is gone)
- NO "stays on disk for the human" clause
- Single line (was 4 lines joined)
- `<KB>` = `bytesToKb(bytes)` (same helper)

### Cost (verbatim)

> The reminder is **appended**, not replacing — the agent may genuinely need the full output right now; the hint is about *future turns*. It is a single line; modest token cost (~30 tokens) incurred once, only when the threshold is crossed.

**~30 tokens** (was ~40 in the old multi-line form).

---

## §2 — `renderDriftNudge`

### Rendered text (VERBATIM, spec/07 §2 `renderDriftNudge`)

```md
Previous turn added ~<delta>k tokens to your context. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
```

**Key differences from current code:**
- NO `[mulligan]` prefix
- NO bloat clause in the delta-available first line (was: `...and produced <N> bloated result(s)`)
- Condensed to ~2 lines (was 3 joined lines)
- The action recommendation + audit line are merged into a single line with semicolons (was: separate joined lines)

### "Why this is zero-extra-requests" (verbatim, spec/07 §2)

> - The metric computation at `turn_end` is pure arithmetic over already-known numbers (no model call).
> - The injection at `context` mutates only the in-flight copy; the inference was happening regardless.
> - The nudge `CustomMessage` is constructed **in the filter** and **never appended to the session** (`pi.sendMessage` is NOT called) — so it does not accumulate. Each turn's nudge is recomputed from the latest metric and replaces (not stacks with) the previous one (because it's not persisted, there's nothing to stack).

### Edge cases — "rendered drift nudge no longer carries a bloat clause" (verbatim, spec/07 §2 Edge cases)

> **Bloat counts are cosmetic now, not a firing trigger (known rough edge):** `pendingBloatHits` are collected at `tool_result` time and are not subtracted when a later `mulligan:rewind` hides those same results. Previously a near-zero-delta turn with a big result could fire the drift nudge as `~0k tokens / N bloated results` (self-contradictory); with `bloatHit` removed from the firing condition (§2/§5.1 — delta-only), that contradiction no longer occurs — a ~0-net-growth turn does not fire regardless of how big a result it held. **The rendered drift nudge no longer carries a bloat clause at all** (see `renderDriftNudge`), so stale counts cannot appear in it — the rough edge is closed at the rendering layer too. (`pendingBloatHits` are still collected only to drive the no-delta fallback firing decision in §5.1; they are never rendered.) The nudge SHOULD additionally be suppressed for the remainder of any turn in which a rewind was refused (any reason), so a capped/stuck turn stops being poked (`@08-edge-cases.md` E22).

**Critical for implementation:** "The rendered drift nudge no longer carries a bloat clause at all" — this confirms the delta-available path NEVER mentions bloat. The no-delta fallback (first-turn/post-reload) is the ONLY path that may mention bloat ("Previous turn produced <N> bloated result(s)").

---

## §5.3 — Suppress the drift nudge when the agent already acted (REQUIRED)

### Full section (VERBATIM, spec/07 §5.3)

> ### 5.3 Suppress the drift nudge when the agent already acted (REQUIRED)
> The drift nudge (§2) MUST NOT fire for a turn in which the agent already issued a `mulligan:shrink` or `mulligan:rewind` that addressed the bloat/drift the nudge would describe. Rationale (live use): in observed sessions the agent shrank a bloated result *in the same turn* it was produced, yet the drift nudge still re-announced the bloat at the next turn's start — pure redundancy that cost ~25–40 tokens and risked poking a stuck turn. The §2 edge-case ts-window heuristic is promoted here to a hard rule and sharpened: collect the `seq`s of every `mulligan:rewind`/`mulligan:shrink` marker created during the metric's turn (turn-boundary → `turn_end`); if that set is non-empty, `shouldNudge` returns false for that metric **regardless** of delta or `bloatHit`. This makes Nudge A (inline, co-located) and Nudge B (cross-turn) strictly non-overlapping: Nudge A fires at most once per bloated result; Nudge B fires only when the agent did **not** self-correct. Acceptance: (a) a turn that produces a >threshold result AND shrinks it does NOT fire the drift nudge next turn; (b) a turn that produces a >threshold result and does nothing fires normally; (c) a turn that rewinds also does not fire. Composes with §5.1 (windowing) and the E22 refusal-suppression rule.

### §5.3 acceptance criteria (verbatim)

- **(a)** a turn that produces a >threshold result AND shrinks it does NOT fire the drift nudge next turn;
- **(b)** a turn that produces a >threshold result and does nothing fires normally;
- **(c)** a turn that rewinds also does not fire.

### Implementation note (from the spec)

The spec says "collect the `seq`s of every `mulligan:rewind`/`mulligan:shrink` marker created during the metric's turn." The current implementation uses a **ts-window heuristic** (`suppressCheck` in `nudges.ts`): returns true iff a marker's `ts` falls in `(metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]`. The spec calls this a valid "simple heuristic" — the PRD explicitly says **"Do NOT rewrite suppressCheck to be seq-based unless a test reveals the ts-window mis-fires."** The JSDoc should cite §5.3 and frame it as the hard rule.

---

## spec/10 F-nudge-drift §5.3 negative test (VERBATIM)

> | **F-nudge-drift** | sustained growth: 3 consecutive turns each adding ~4k tokens | after the 3rd turn the next inference's filtered view ends with a `mulligan:nudge` custom message (ephemeral; NOT in session JSONL). Negatives MUST also pass: a single ~8k-token turn amid small turns does NOT fire, and a single >threshold result with ~0 net growth does NOT fire the drift nudge (it only triggers Nudge A); and **a turn that produces a >threshold result AND shrinks/rewinds it in the same turn does NOT fire the drift nudge next turn (§5.3 — Nudge A and B are non-overlapping)** |

---

## spec/10 §1.11 Cancel target resolution (VERBATIM — for M1 test reference)

> ### 1.11 Cancel target resolution (E21, target-based)
> - `by_tool_call_id` hint → retires the uuid of the (single) marker whose matched message / `hideEntryIds` carries that id.
> - `by_tool_name:"read", occurrence:"last"` → retires the most-recent active shrink or rewind whose covered span includes the last `read` result.
> - `by_content_includes:"<substr>"` → retires the most-recent active marker covering a message whose text contains the substring.
> - Several markers cover the match → **most recent by `seq`** is retired (LIFO); the rest stay active.
> - No active marker covers the match → safe no-op (`cancelled:false`); nothing appended.
> - Explicit `markerId` fallback → retires that exact marker; unknown id → safe no-op.
> - After a successful cancel, the next `context` fire shows the originally-hidden/shrunk content verbatim (E21 (b)); the retired marker stays on disk.

---

## spec/10 F-cancel (VERBATIM — for M1 integration test reference)

> | **F-cancel** | create a `mulligan_shrink`, then `mulligan_cancel({target:{by_tool_name:"read", occurrence:"last"}})` | next `context` fire the originally-shrunk message reappears verbatim in the filtered view; session JSONL has both `mulligan:shrink` and `mulligan:cancel` entries (shrink is skipped, not deleted) |

---

## spec/10 F-checkpoint (VERBATIM — for M3 test reference)

> | **F-checkpoint** | `mulligan_checkpoint("x")`, then `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` | label entry exists; rewind hides back to the labeled point (assert filtered message count drops to prefix); **checkpoint is consumed on use — `mulligan_audit` no longer lists it active and a second rewind to `"x"` refuses (not found) unless re-created (spec/05 §3 step 5)** |