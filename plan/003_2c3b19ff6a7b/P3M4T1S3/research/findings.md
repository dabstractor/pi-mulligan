# P3.M4.T1.S3 — Research findings (README feature blurbs)

**Task**: Update README feature blurbs for (a) windowed drift, (b) high-water signal,
(c) marker retraction. Docs-only (Mode B). Edit ONLY §5 "How It Works", §7 "Known
Limitations" D6 bullet, and the "Further reading" tool count. §3 (S1) and §4 (S2) are
DONE and out of scope.

## Scope partition (verified against README + sibling PRPs)

| Section | Owner | Status |
|---------|-------|--------|
| §3 Configuration (knobs table + JSON) | S1 | **DONE** (driftWindowTurns, highWaterFraction, driftThresholdTokens:6000, maxActive, staleAfterFires, "All 17 knobs") |
| §4 Tools (five tools, mulligan_cancel) | S2 | **DONE** ("five agent-callable tools", cancel subsection present) |
| §1 Overview / §5 How It Works / §6 Guarantees / §7 Known Limitations / Further reading | **S3 (this)** | Pending |

**S3 edits actually required** (only these):
1. §5 "How It Works" — the **"Two ride-along nudges"** block → add windowing to the drift
   nudge + add the high-water signal.
2. §5 "How It Works" — the **shrink paragraph** → add marker-retraction note.
3. §7 "Known Limitations" — the **"No undo (D6)"** bullet → amend for retractable markers.
4. "Further reading" — line 255 "the **four** tools' full specification" → "**five**".

**Reviewed, NO change needed** (document to prevent over-editing):
- §1 Overview — problem statement, doesn't describe nudge mechanisms. Untouched.
- §6 Guarantees #3 "The nudges ride inferences ... add no model requests" — STILL TRUE for
  windowed drift + high-water (both ride the existing `context` event, D4). Untouched.
- §7 other 3 bullets (E7 compaction leak, D1 no replay, E15 markers accumulate) — unaffected.

## Ground-truth from source (src/nudges.ts)

### Windowed drift (§5.1) — `shouldNudge`
- Smoothes per-turn delta over a **moving average** of the last
  `config.nudges.driftWindowTurns` (default 3) `mulligan:turn-metric` entries.
- Fires iff windowed-average delta **> driftThresholdTokens (6000)** OR any window metric
  had `bloatHit === true`.
- Single 8k spike does NOT fire; sustained growth (windowed avg > 6k) DOES.
- **The rendered nudge still shows the latest turn's delta** — windowing is in the GATE,
  not the rendered text. So the existing README example `[mulligan: last turn +4.2k tokens;
  rewind available]` stays accurate; only the *fire condition* is windowed.

### High-water (§5.2) — `shouldHighWater` + `renderHighWaterNudge`
- **Edge-triggered**: fires once on upward crossing of `highWaterFraction` (default 0.7) of
  the context window; latch `rt.aboveHighWater` set true on fire, cleared only when total
  drops back below → re-arms. No nagging while above.
- Uses the **filtered total** (`estimateTokens(filteredMessages).tokens` — same total
  `mulligan_audit` reports), NOT `ctx.getContextUsage().tokens`.
- Annotation format (verbatim from `renderHighWaterNudge`):
  `[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or
  mulligan_rewind to reclaim space.` (pct = Math.round(total/window*100); 0.7 → "~70%").
- `customType: "mulligan:high-water"` (DISTINCT from drift's `mulligan:nudge`).
- EPHEMERAL — injected into the returned message copy only; never persisted.

### Marker retraction (E21) — `mulligan_cancel`
- Retires a rewind/shrink marker by id → stops applying from next turn (forward-only).
- Does NOT undo on-disk side effects; does NOT replay hidden content (stays in `/tree`).
- "Softens D6: agent markers are no longer irrevocably permanent."
- Softens (not eliminates) the §7 D6 limitation.

## Exact before-state snippets (to anchor edits)

**§5 nudges block (before):**
```
**Two ride-along nudges (zero extra model requests):**

1. **Bloated-result reminder** — a `tool_result` hook appends a short reminder to any result exceeding the per-tool bloat threshold (`bash`: 32 KB, `read`: 20 KB, others: the 16 KB global default).
2. **Per-turn drift nudge** — at `turn_end` Mulligan records the token delta; on the *next* inference it injects a one-line annotation (e.g. `[mulligan: last turn +4.2k tokens; rewind available]`). The `mulligan:nudge` annotation is **never persisted**.
```

**§5 shrink paragraph (before) — retraction anchor:**
```
**Shrink** = view substitution: `appendEntry("mulligan:shrink", {target, replacement})`; the context handler substitutes content in place (preserving `role` / `toolCallId` / `toolName` / `isError` so the tool-call/result pairing invariant holds).
```

**§7 D6 bullet (before):**
```
- **No undo (`spec/SPEC.md` §9 D6).** Agent-initiated rewinds and shrinks are permanent — they persist across reload and `/resume`. There is no un-rewind. A human who wants to explore hidden content uses Pi's native `/tree`.
```

**Further reading line 255 (before):**
```
- `spec/05-tools.md` — the four tools' full specification.
```

## Consistency checks (cross-ref with §3/S1 wording)
- §3 driftWindowTurns row says "smoothed before thresholding" → README blurb uses same
  "smoothed over a rolling window" language (not "moving average") for consistency.
- §3 highWaterFraction row says "edge-triggered — fires once on crossing, clears when the
  total drops back below" → mirror that exact phrasing in the blurb.
- §4 mulligan_cancel blockquote already present → §5/§7 retraction prose cross-links to it.