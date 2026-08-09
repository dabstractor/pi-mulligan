# 07 — Preventive layer & nudges

> Mulligan's two "ride-along" mechanisms that help the agent notice when it should rewind or shrink — **without ever spending an extra model request**. Both exploit the fact that the `context` event and the `tool_result` event already fire as part of normal operation; we attach cheap computations and annotations to them.

Design principle (D4): *anything that nudges the agent per-turn must ride an inference that was already happening.* A feature that costs a model call per turn is, by definition, counter to the project's purpose and is rejected.

---

## 1. Nudge A — bloated-result reminder (`tool_result` event)

### Purpose
When a single tool result is large, append a short reminder **to that result's own content** telling the agent a rewind/shrink is available. This rides the result itself (no extra request) and is co-located with the offending output, so the agent sees the hint exactly where the bloat is.

### Mechanism
```ts
pi.on("tool_result", async (event, ctx) => {
  try {
    const config = getConfig();
    if (!config.enabled || !config.nudges.bloatReminder) return;
    if (event.toolName?.startsWith("mulligan_")) return;     // don't annotate our own tools

    const bytes = resultBytes(event.content);
    const threshold = bloatThresholdFor(event.toolName, config);  // per-tool override, else global
    if (bytes < threshold) return;                              // under threshold → no-op

    const reminder = renderBloatReminder(event.toolName, bytes, threshold);
    // Append the reminder to the existing content (do not replace — the agent may need the data).
    const content = [...(event.content ?? []), { type: "text", text: reminder }];
    // Also record a turn-metric contribution so the per-turn nudge (Nudge B) can aggregate.
    recordBloatHit(ctx, event.toolName, approxTokens(bytes));
    return { content };
  } catch (e) {
    log("error", "nudge.bloat", ctx, { error: String(e) });
    // fail-open: return nothing (leave result unchanged)
  }
});
```

### `renderBloatReminder`
```md

---
[mulligan] This result is ~<KB> KB in your context (threshold <T> KB).
If you don't need the full output going forward, call `mulligan_shrink` with a
summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole
call was a mistake. (The hidden/shrunk content stays on disk for the human.)
```

The reminder is **appended**, not replacing — the agent may genuinely need the full output right now; the hint is about *future turns*. It is a single block; modest token cost (~40 tokens) incurred once, only when the threshold is crossed.

### Threshold default & calibration
- Default `bloatThresholdBytes = 16384` (16 KB ≈ 4k tokens in-context), deliberately **below** Pi's built-in 50 KB truncation cap so Mulligan catches meaningful-but-not-catastrophic results that slip under the built-in cap. The previous default was 8192 (8 KB); it was raised after observation showed 8 KB nagging on every routine source-file read (9–17 KB) — i.e. firing on results the agent still needed. 16 KB lets a typical source file through while still catching genuinely catastrophic results (the 50 KB un-redirected `grep`, etc.).
- The threshold is **per tool**: each tool may override the global default via `bloatThresholdBytesByTool`. Resolution is a single helper:
  ```ts
  function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
    const global = config.nudges.bloatThresholdBytes;
    if (!toolName) return global;
    const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
    return byTool[toolName] ?? global;
  }
  ```
  Rationale: legitimate output size differs sharply by tool. A `bash` build/test/`git log` run routinely and legitimately produces tens of KB; an `lsp_hover` payload is a few hundred bytes. One global threshold either over-nags the noisy tools or under-catches the quiet ones. Shipped defaults: `{ "bash": 32768, "read": 20480 }`, with all other tools falling back to the 16 KB global.
  - *Limitation:* the override is keyed by Pi `toolName` (e.g. `"bash"`), not by subcommand — a `git log` and an `echo` both present as `bash`. Sub-command-level sensitivity is out of scope for v1; the `perTurnDrift` nudge (§2) catches aggregate turn growth regardless of which tool produced it.
- The threshold is in **bytes of the in-context text representation** (sum of `.text` lengths across content blocks, UTF-8 byte length). Not model tokens (we don't tokenize here — keep it cheap and deterministic).
- Configurable; a project that routinely handles large legitimate outputs (log analysis) may raise either the global value or a specific tool's entry.

### Interaction with shrink/rewind
- If the agent heeds the reminder and shrinks, the shrink marker substitutes the content (including the appended reminder) with the agent's replacement on the next turn — so the reminder disappears automatically once acted on. Clean.
- If the agent rewinds the tool-call group, the whole result (reminder included) is hidden. Clean.
- If ignored, the reminder persists in context (a ~40-token cost). Acceptable; it's a one-time cost per bloated result.

### Why advisory, not auto-shrink (D3)
Auto-shrinking would risk discarding data the model needs right now (e.g. a large test output the model is actively diagnosing). The reminder preserves agent agency: the model decides, with full information, whether the bloat is a problem. Auto-shrink is a future opt-in mode (`config.shrink.autoOnBloat`, **not in v1**).

---

## 2. Nudge B — per-turn drift nudge (`turn_end` → `context` injection)

### Purpose
At the start of each turn, if the *previous* turn grew context substantially (or hit bloat), inject a one-line annotation into the message copy so the agent is aware of drift and remembers rewind/shrink exist. Rides the existing next inference — **zero extra requests**.

This is the non-obvious mechanism the project pivoted on (see `@reference/HANDOFF.md` Q5). The user's insight: a per-turn nudge seems to require an extra request, which would defeat the project — but the `context` event is a free ride, so the nudge can piggyback.

### Mechanism — two phases

**Phase 1: measure at `turn_end`.**
```ts
pi.on("turn_end", async (event, ctx) => {
  try {
    const config = getConfig();
    if (!config.enabled || !config.nudges.perTurnDrift) return;
    const rt = runtime(ctx);

    // Estimate current context tokens from the filtered view if available, else from getContextUsage.
    const now = rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens
                                : (ctx.getContextUsage()?.tokens ?? 0);
    const baseline = rt.tokenBaseline;       // captured at previous turn_end (or session_start)
    const delta = baseline == null ? null : now - baseline;
    const bloat = rt.pendingBloatHits ?? []; // collected by Nudge A this turn
    rt.pendingBloatHits = [];

    const metric: TurnMetric = {
      schema:"pi-mulligan", v:1, kind:"turn-metric",
      seq: nextSeq(rt), ts: Date.now(),
      deltaTokens: delta,
      bloatHit: bloat.length > 0,
      bloatHits: bloat,
      grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens,
      turnIndex: event.turnIndex,
    };
    pi.appendEntry("mulligan:turn-metric", metric);
    rt.tokenBaseline = now;                   // roll baseline forward
    rt.lastTurnIndex = event.turnIndex;
  } catch (e) { log("error","nudge.turn_end", ctx, { error:String(e) }); }
});
```

**Phase 2: inject at next `context` fire.**
The filter (§1 of `@06-context-filter.md`) reads the **latest** `mulligan:turn-metric` on the branch. `shouldNudge(metric, config) = metric.grewOverThreshold || metric.bloatHit`. If true:
```ts
function injectNudge(messages: AgentMessage[], metric: TurnMetric): AgentMessage[] {
  const line = renderDriftNudge(metric);
  // Append as a lightweight CustomMessage that is NOT persisted (it's in the copy only).
  // We construct it inline; it never touches the session.
  const nudge: AgentMessage = {
    role: "custom", customType: "mulligan:nudge",
    content: line, display: false,
    details: { ephemeral: true, turnIndex: metric.turnIndex },
    timestamp: Date.now(),
  };
  return [...messages, nudge];
}
```
`renderDriftNudge`:
```md
[mulligan] Previous turn added ~<delta>k tokens to your context< and produced <N> bloated result(s)>.
If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).
Run `mulligan_audit` for a breakdown.
```

### Why this is zero-extra-requests
- The metric computation at `turn_end` is pure arithmetic over already-known numbers (no model call).
- The injection at `context` mutates only the in-flight copy; the inference was happening regardless.
- The nudge `CustomMessage` is constructed **in the filter** and **never appended to the session** (`pi.sendMessage` is NOT called) — so it does not accumulate. Each turn's nudge is recomputed from the latest metric and replaces (not stacks with) the previous one (because it's not persisted, there's nothing to stack).

### Cost
- ~25–40 tokens per turn **when it fires** (only when drift/bloat threshold crossed). Zero when neither fires.
- The metric `CustomEntry` is persisted (small, JSONL), but it is **not** in context (it's a `custom`, not `custom_message`), so it costs no model tokens. Old metrics accumulate on disk (like all entries) but only the latest is read; this is acceptable (matches Pi's append-only model). A future "garbage collect old metrics" is a non-goal for v1.

### Edge cases
- **First turn / post-reload:** `tokenBaseline` is null → `deltaTokens` null → nudge falls back to `bloatHit`-only signaling (still useful; a bloated result on turn 1 still nudges).
- **Negative delta** (a rewind/shrink shrank context): `grewOverThreshold` is false; `bloatHit` may still be true from a result that was then shrunk. To avoid nagging after the agent already acted, the filter suppresses the nudge if a `mulligan:rewind` or `mulligan:shrink` marker was created **during** the metric's turn (compare `metric.seq` range to marker `seq`s). Simple heuristic: if any marker's `ts` is within the turn's time window, skip the nudge.
- **Bloat counts from a rewind-hidden span (known rough edge):** `pendingBloatHits` are collected at `tool_result` time and are not subtracted when a later `mulligan_rewind` hides those same results in the same turn-window. This can yield a `~0k tokens / N bloated results` nudge that looks contradictory. With the turn-replay fix (`FIX_TURN_REPLAY_LOOP.md`), the worst driver of this — a legacy relative-resolution rewind hiding the in-progress turn's bloated results every fire (filtered delta ≈ 0 while the hits stayed recorded) — is gone, but the accounting mismatch can still surface in a genuine stuck-turn loop. Not harmful in isolation; the hard fix for a *loop* is the per-prompt retry budget / context-fraction stop (`@08-edge-cases.md` E22). Additionally, the nudge SHOULD be suppressed for the remainder of any turn in which a rewind was refused (any reason), so a capped/stuck turn stops being poked.
- **`turn_end` not firing in print mode for the final turn:** acceptable; the nudge is best-effort.

---

## 3. Determinism & testability
Both nudges are driven by pure helpers (`renderBloatReminder`, `renderDriftNudge`, `shouldNudge`, `resultBytes`, `approxTokens`) that are unit-tested without Pi. The Pi-coupled glue (`tool_result`/`turn_end`/`context` handlers) is exercised by the integration smoke tests (`@10-testing.md`), which assert on the log lines and on injected annotation presence in the filtered payload.

## 4. Cross-references
- Turn-metric schema → `@04-data-model.md` §5
- Filter pipeline that calls `injectNudge` → `@06-context-filter.md` §1, §12
- Config defaults → `@09-configuration.md`

---

## 5. Drift-nudge refinements (REQUIRED)

These refine Nudge B (§2) to cut false positives and catch slow accumulation. Both ride the existing `context` event (D4 — zero extra requests).

### 5.1 Windowed drift signaling (REQUIRED)
`shouldNudge` MUST smooth the per-turn delta over a rolling window of the last `config.nudges.driftWindowTurns` turns (default 3) before comparing to `driftThresholdTokens` — fire when the *windowed* (moving-average, or M-of-N) delta crosses the threshold, NOT on a single turn's raw delta. Rationale (live use): a single heavy turn is routinely legitimate (reading several source files; the user pasting reference docs to read) — *sustained* growth over a window is the actionable signal. The turn metric (`@04-data-model.md` §5) carries the raw per-turn delta; the window is computed in the filter from the last N `mulligan:turn-metric` entries on the branch. Acceptance: a single 8k-token turn amid small turns does NOT fire; three ~4k turns in a row DO.

### 5.2 Edge-triggered high-water signal (REQUIRED)
In addition to the delta nudge, the filter MUST inject a one-line annotation the first time the **total filtered** context crosses a high-water fraction of the window (`config.nudges.highWaterFraction`, default 0.7), using the same filtered-total `mulligan_audit` computes (`@05-tools.md` §4). It MUST be **edge-triggered** — fire once on crossing, not every turn while above — by tracking `rt.aboveHighWater` (set true when the annotation fires, cleared only when the total drops back below the fraction) in the session runtime. This catches slow, steady accumulation that no single-turn delta nudge sees, without nagging.