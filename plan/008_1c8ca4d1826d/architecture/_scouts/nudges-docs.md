# Code Context — pi-mulligan v2.0 delta recon (READ-ONLY)

## Files Retrieved
1. `src/notes.ts` (lines 221–416) — Nudge text renderers: `DriftNudgeInput`, `renderBloatReminder`, `renderDriftNudge` + module-private helpers
2. `src/nudges.ts` (lines 274–430 via grep + read 320–430) — `shouldNudge` (§5.1), `injectNudge` (calls renderDriftNudge), `suppressCheck` (§5.3), `shouldHighWater` (§5.2)
3. `README.md` (lines 155–241) — shrink blurb, target matchers, E19 trust note, drift-nudge paragraph
4. `VERIFICATION.md` (grep) — only 1 hit for the greps

## 1. src/notes.ts

### renderDriftNudge — FULL verbatim (lines 310–338)

```ts
export function renderDriftNudge(metric: DriftNudgeInput): string {
  const delta = readDelta(metric);
  const hits = readBloatHits(metric);
  const sustainedN = readSustainedTurns(metric); // advisory UX (Minor #3): windowed-fire clarification
  let lead: string;
  if (delta != null) {
    lead = `Previous turn added ~${kTokens(delta)} tokens to your context`;
    // Advisory UX clause (spec/07 §2 edge cases, rendered-layer polish): the nudge fires on the WINDOWED
    // moving average, but the lead reports the LATEST single-turn delta. When the latest delta is itself below
    // the drift threshold yet the windowed average tripped (sustained growth), a bare "~0.8k tokens" lead is
    // misleading (0.8k alone would not fire). Append " (sustained over the last N turns)" so the agent
    // understands sustained growth — not this one turn — is the trigger. Omitted when sustainedN is absent/
    // non-positive, or when the latest delta alone would explain the fire (delta >= a nominal threshold, here
    // approximated as "delta is non-trivially large" — we only clarify the small-delta case the wart describes).
    if (sustainedN > 0 && delta < LARGE_SINGLE_TURN_DELTA) {
      lead += ` (sustained over the last ${sustainedN} turns)`;
    }
  } else if (hits.length > 0) {
    lead = `Previous turn produced ${hits.length} bloated ${resultWord(hits.length)}`;
  } else {
    lead = "Previous turn changed your context"; // unreachable via shouldNudge; totality fallback
  }
  return `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.`;
}
```

**Lead branches (in order):**
- delta != null → `"Previous turn added ~<k> tokens to your context"` (+ optional `" (sustained over the last N turns)"` when `sustainedN > 0 && delta < LARGE_SINGLE_TURN_DELTA` (4000, module-private const at lines 342–348))
- delta == null, hits>0 → `"Previous turn produced <N> bloated result(s)"` (bloat-fallback)
- both empty → `"Previous turn changed your context"` (totality fallback, unreachable via shouldNudge)

**Fixed tail (all branches):** `` `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.` `` — verbatim at line 337.

**Return signature:** `renderDriftNudge(metric: DriftNudgeInput): string` — a SINGLE physical line, no embedded `\n`, no trailing newline, NO `[mulligan]` prefix.

### FORMAT JSDoc block (lines 288–297, verbatim)

```
 * FORMAT (spec/07 §2 — VERBATIM; a SINGLE physical string with NO embedded "\n"; the LEAD varies by input,
 * the tail after "<lead>." is FIXED in all cases):
 *     <lead>. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.
 * <lead> is a 3-branch selection (delta WINS regardless of bloat):
 *   - delta != null:         "Previous turn added ~<k> tokens to your context"   (NO bloat mention)
 *   - delta == null, bloat>0: "Previous turn produced <N> bloated <resultWord>"   (the only bloat path)
 *   - both empty:            "Previous turn changed your context"                 (unreachable; totality fallback)
 * <k> = kTokens(delta) (delta/1000, 1 decimal: 4200→"4.2k", 3000→"3k"); <N> = bloatHits.length;
 * resultWord = resultWord(N) (1→"result", else "results"). NO [mulligan] prefix. NO trailing newline.
 * NO embedded newline. The tail is a terse "If wasteful, … to undo / compact a result." suggestion; no `mulligan_audit` clause (§2 dropped it).
```

### DriftNudgeInput (lines 239–253)
`deltaTokens: number | null`, `bloatHits: ReadonlyArray<{toolName, approxTokens}>`, `sustainedOverTurns?: number | null`. TurnMetric is structurally assignable → no cast at call site.

### renderBloatReminder — Nudge A (lines 278–282, verbatim)

```ts
export function renderBloatReminder(toolName: string, bytes: number): string {
  const resultKb = bytesToKb(bytes);
  return `\n---\n~${resultKb} KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake.`;
}
```
Confirmed: prescribes `mulligan_shrink`. Located in notes.ts (lines 278–282); independent of renderDriftNudge's lead/tail logic — untouched by any drift-nudge text delta.

### JSDoc convention exemplar (renderBloatReminder, lines 256–277, abridged verbatim opening)
```
 * renderBloatReminder — Nudge A's text (spec/07-preventive-and-nudges.md §1). ...
 * FORMAT (spec/07 §1 — VERBATIM; leading "\n---\n" is a markdown horizontal rule; single line): ...
 * DEFENSIVE — NEVER throws (fail-open nudge handler; spec/07 §1; E13). ...
 * @param toolName  the tool that produced the result (ACCEPTED, NOT used in v1 text; reserved for future use)
 * @param bytes     the result's UTF-8 byte size (from resultBytes — spec/07 §1)
```
Convention throughout src/: every exported fn has a multi-paragraph JSDoc with spec citations like `spec/07 §2`, edge-case refs (E13, E19), FORMAT blocks, and DEFENSIVE never-throws notes.

## 2. src/nudges.ts wiring

- **§5.1 windowing — `shouldNudge`** (lines 325–334): `shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig): boolean` — moving average over `slice(0, config.nudges.driftWindowTurns)` of finite deltas, fires iff `avg >= config.nudges.driftThresholdTokens`; bloat fallback only when no usable deltas in window.
- **renderDriftNudge invocation — `injectNudge`** (lines 368–406): `injectNudge(messages: MessageLike[], metric: TurnMetric, recentMetrics?, config?): MessageLike[]`. Derives `sustainedOverTurns` (copy-on-write `input = { ...metric, sustainedOverTurns: deltas.length }`) when windowed avg ≥ threshold but latest delta < threshold; then `const line = renderDriftNudge(input);` (line 395) and appends ephemeral `mulligan:nudge` CustomMessage (`display:false`, `details:{ephemeral:true, turnIndex}`).
- **§5.2 high-water — `shouldHighWater` (line 497) + `renderHighWaterNudge` (line 538) + `injectHighWaterNudge` (line 574)** — separate `mulligan:high-water` customType, edge-triggered via `rt.aboveHighWater`.
- **§5.3 suppression — `suppressCheck`** (line 437): PURE; suppresses iff a rewind/shrink marker ts falls in `(prevMetric.ts, metric.ts]`. Call site in filter.ts: `shouldNudge(recentMetrics, config) && !suppressCheck(markers.metric, markers.recentMetrics, markers)`.
- **What would need to change for a renderDriftNudge text delta: NOTHING in nudges.ts.** injectNudge treats the line as opaque (`const line = renderDriftNudge(input)` → `content: line`). Return signature stays `string`; no structural coupling to lead/tail wording.

## 3. README.md quotes + grep hits

- **~line 157 (shrink blurb):** "> Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result)." — yes, says "past tool result".
- **~line 173 (E19 trust note):** "**View substitution (trust note).** Shrink never deletes anything — it is a *view substitution*: the original message stays on disk and is recoverable by the human via `/tree`, so only the model's in-context copy is replaced — even summarizing a user message (E19) is lossless at the session level."
- **~line 234 (drift nudge paragraph, contains old quoted nudge string):** `2. **Per-turn drift nudge** (`spec/07-preventive-and-nudges.md` §2/§5) — ... injects a single-line annotation (e.g. ``Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.``). The delta is **windowed** (§5.1): smoothed over a rolling window of the last `nudges.driftWindowTurns` turns (default 3) ... The `mulligan:nudge` annotation is **never persisted**.`

Grep hits (`by_content_includes|past tool result|If wasteful`):
- README.md:157 — "past tool result" (shrink blurb)
- README.md:169 — `by_content_includes` (target matcher list)
- README.md:187 — `by_content_includes` (retract hint shape)
- README.md:189 — `by_content_includes` (retract when-to-use)
- README.md:234 — "If wasteful" (drift-nudge paragraph, old quoted nudge string)
- README.md:266 — BUG-004 note: "`mulligan_shrink` `by_content_includes` with an empty substring now matches nothing (returns null)"
- VERIFICATION.md:209 — BUG-004 table row: "| BUG-004 | Minor | `transforms.ts` `resolveShrinkTarget` `by_content_includes` had no empty-needle guard; `\"\"` matched `messages[0]` | Add `needle.length>0` → empty needle returns `null` (defense-in-depth) | `transforms.test.ts`: rewrite E13 throw-test + 2 assertions locking empty→null |"

## 4. Other doc surfaces
- No `docs/` directory (repo root has `spec/`, `plan/`, `test/`, `src/`). Spec files live in `spec/` (e.g. `spec/07-preventive-and-nudges.md`, `spec/06-context-filter.md`).
- JSDoc spec-citation convention is uniform across src/ (see exemplar above; notes.ts/nudges.ts cite `spec/07 §1/§2/§5.x`, `spec/06 §1`, E13/E19, and internal task IDs like P1.M2.T3.S3).

## Architecture
notes.ts = PURE text renderers (no Pi imports). nudges.ts = Pi-wired handlers + pure gates; calls renderDriftNudge only inside injectNudge (line 395). filter.ts orchestrates: `shouldNudge(...) && !suppressCheck(...)` → `injectNudge(...)`. Text deltas are confined to notes.ts; string plumbing downstream is opaque.

## Start Here
`src/notes.ts` lines 284–338 — the FORMAT JSDoc + renderDriftNudge body; this is the only surface a drift-nudge wording delta touches (plus README.md:234 if docs must mirror the string).