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

    const reminder = renderBloatReminder(event.toolName, bytes);  // threshold gates firing above; no longer rendered
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

### `renderBloatReminder(toolName, bytes)`
```md

This result added ~<KB> KB to your context. If you don't need the full output, call `mulligan_shrink` with a summary or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole call was a mistake.
```

The reminder is **appended**, not replacing — the agent may genuinely need the full output right now; the hint is about *future turns*. It is a single line; modest token cost (~30 tokens) incurred once, only when the threshold is crossed.

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
  Rationale: legitimate output size differs sharply by tool, so the override map tunes sensitivity per tool. `bash` is the primary bloat surface (large command output), so it is intentionally NOT in the map — it uses the 16 KB global default to stay maximally sensitive. `read` gets a higher bar (24 KB) because large source-file reads are routine and legitimate; an `lsp_hover` payload is a few hundred bytes and needs no override. Shipped defaults: `{ "read": 24576 }`, with all other tools (including `bash`) falling back to the 16 KB global.
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
At the start of each turn, if context has grown *sustainedly* over the rolling window, inject a one-line annotation into the message copy so the agent is aware of drift and remembers rewind/shrink exist. Rides the existing next inference — **zero extra requests**.

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
The filter (§1 of `@06-context-filter.md`) reads the last `config.nudges.driftWindowTurns` `mulligan:turn-metric` entries on the branch and calls the windowed `shouldNudge` (§5.1). The drift nudge fires on **sustained total-context growth** — the windowed-average `deltaTokens` crossing `driftThresholdTokens`. The `bloatHit` arm is **not** a firing condition when delta data is available: a single big tool result is already covered by Nudge A (co-located on that result), so re-announcing it one turn later adds nothing and, observed live, can itself drive a stuck-turn loop. `bloatHit` is retained **only as a fallback** when *no* turn in the window has delta data (first turn / post-reload — see Edge cases), so the nudge still has some signal before a baseline exists. If true:
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
Previous turn added ~<delta>k tokens to your context. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
```

### Why this is zero-extra-requests
- The metric computation at `turn_end` is pure arithmetic over already-known numbers (no model call).
- The injection at `context` mutates only the in-flight copy; the inference was happening regardless.
- The nudge `CustomMessage` is constructed **in the filter** and **never appended to the session** (`pi.sendMessage` is NOT called) — so it does not accumulate. Each turn's nudge is recomputed from the latest metric and replaces (not stacks with) the previous one (because it's not persisted, there's nothing to stack).

### Cost
- ~25–40 tokens per turn **when it fires** (only when the sustained-drift threshold is crossed, or — before any baseline exists — a bloated result appears). Zero otherwise.
- The metric `CustomEntry` is persisted (small, JSONL), but it is **not** in context (it's a `custom`, not `custom_message`), so it costs no model tokens. Old metrics accumulate on disk (like all entries) but only the latest is read; this is acceptable (matches Pi's append-only model). A future "garbage collect old metrics" is a non-goal for v1.

### Edge cases
- **First turn / post-reload:** `tokenBaseline` is null → `deltaTokens` null → with no delta data in the window, `shouldNudge` falls back to `bloatHit`-only signaling (still useful; a bloated result on turn 1 still nudges). This is the **only** path on which `bloatHit` fires the drift nudge.
- **Negative delta** (a rewind/shrink shrank context): the windowed delta is non-positive → `shouldNudge` does not fire (it keys on positive sustained growth). Additionally, per §5.3, the drift nudge is **hard-suppressed** whenever a `mulligan:rewind` or `mulligan:shrink` marker was created during the metric's turn — so a since-shrunk or since-rewound result never re-triggers the cross-turn nudge. (`bloatHit` is no longer a firing condition when delta data exists.)
- **Bloat counts are cosmetic now, not a firing trigger (known rough edge):** `pendingBloatHits` are collected at `tool_result` time and are not subtracted when a later `mulligan_rewind` hides those same results. Previously a near-zero-delta turn with a big result could fire the drift nudge as `~0k tokens / N bloated results` (self-contradictory); with `bloatHit` removed from the firing condition (§2/§5.1 — delta-only), that contradiction no longer occurs — a ~0-net-growth turn does not fire regardless of how big a result it held. The rendered drift nudge no longer carries a bloat clause at all (see `renderDriftNudge`), so stale counts cannot appear in it — the rough edge is closed at the rendering layer too. (`pendingBloatHits` are still collected only to drive the no-delta fallback firing decision in §5.1; they are never rendered.) The nudge SHOULD additionally be suppressed for the remainder of any turn in which a rewind was refused (any reason), so a capped/stuck turn stops being poked (`@08-edge-cases.md` E22).
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
`shouldNudge` MUST smooth the per-turn delta over a rolling window of the last `config.nudges.driftWindowTurns` turns (default 3) before comparing to `driftThresholdTokens` — fire when the *windowed* (moving-average, or M-of-N) delta crosses the threshold, NOT on a single turn's raw delta. Rationale (live use): a single heavy turn is routinely legitimate (reading several source files; the user pasting reference docs to read) — *sustained* growth over a window is the actionable signal. The turn metric (`@04-data-model.md` §5) carries the raw per-turn delta; the window is computed in the filter from the last N `mulligan:turn-metric` entries on the branch. The firing condition is **delta-only when delta data is available**: `avg(window.deltaTokens) > driftThresholdTokens`. The earlier `|| bloatHit` arm is **dropped** — it fired the drift nudge on any single large tool result, redundant with Nudge A (already co-located on that result) and a known stuck-turn-loop amplifier (it produced the live-observed `~0k tokens / N bloated results` self-contradiction). `bloatHit` remains a firing condition *only* in the no-delta fallback: a window with zero finite deltas fires iff any metric has `bloatHit` (first turn / post-reload). Acceptance: (a) a single 8k-token turn amid small turns does NOT fire; (b) three ~4k turns in a row DO fire; (c) a single large result (>threshold) with ~0 net growth does NOT fire the drift nudge even though it does trigger Nudge A.

### 5.2 Edge-triggered high-water signal (REQUIRED)
In addition to the delta nudge, the filter MUST inject a one-line annotation the first time the **total filtered** context crosses a high-water fraction of the window (`config.nudges.highWaterFraction`, default 0.7), using the same filtered-total `mulligan_audit` computes (`@05-tools.md` §4). It MUST be **edge-triggered** — fire once on crossing, not every turn while above — by tracking `rt.aboveHighWater` (set true when the annotation fires, cleared only when the total drops back below the fraction) in the session runtime. This catches slow, steady accumulation that no single-turn delta nudge sees, without nagging.

### 5.3 Suppress the drift nudge when the agent already acted (REQUIRED)
The drift nudge (§2) MUST NOT fire for a turn in which the agent already issued a `mulligan:shrink` or `mulligan:rewind` that addressed the bloat/drift the nudge would describe. Rationale (live use): in observed sessions the agent shrank a bloated result *in the same turn* it was produced, yet the drift nudge still re-announced the bloat at the next turn's start — pure redundancy that cost ~25–40 tokens and risked poking a stuck turn. The §2 edge-case ts-window heuristic is promoted here to a hard rule and sharpened: collect the `seq`s of every `mulligan:rewind`/`mulligan:shrink` marker created during the metric's turn (turn-boundary → `turn_end`); if that set is non-empty, `shouldNudge` returns false for that metric **regardless** of delta or `bloatHit`. This makes Nudge A (inline, co-located) and Nudge B (cross-turn) strictly non-overlapping: Nudge A fires at most once per bloated result; Nudge B fires only when the agent did **not** self-correct. Acceptance: (a) a turn that produces a >threshold result AND shrinks it does NOT fire the drift nudge next turn; (b) a turn that produces a >threshold result and does nothing fires normally; (c) a turn that rewinds also does not fire. Composes with §5.1 (windowing) and the E22 refusal-suppression rule.