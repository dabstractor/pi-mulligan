# Research Notes — P1.M2.T3.S3: renderBloatReminder + renderDriftNudge

This file is the curated evidence base for the PRP. It captures the EXACT spec text (verbatim), the verified
on-disk baseline, and the design decisions with rationale. The PRP consumes these — read this alongside the PRP.

---

## 1. spec/07-preventive-and-nudges.md — the two renderers (VERBATIM, the authority)

### §1 — `renderBloatReminder` (Nudge A: bloated-result reminder, `tool_result` event)

Mechanism (handler call site — pins the SIGNATURE):
```ts
pi.on("tool_result", async (event, ctx) => {
  // ...
  const bytes = resultBytes(event.content);
  if (bytes < config.nudges.bloatThresholdBytes) return;   // under threshold → no-op
  const reminder = renderBloatReminder(event.toolName, bytes, config.nudges.bloatThresholdBytes);
  // Append the reminder to the existing content (do not replace).
  const content = [...(event.content ?? []), { type: "text", text: reminder }];
  // Also record a turn-metric contribution.
  recordBloatHit(ctx, event.toolName, approxTokens(bytes));
  return { content };
});
```

The `renderBloatReminder` text (verbatim from the ```md block — NOTE the leading blank line + `---` rule):
```

---
[mulligan] This result is ~<KB> KB in your context (threshold <T> KB).
If you don't need the full output going forward, call `mulligan_shrink` with a
summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole
call was a mistake. (The hidden/shrunk content stays on disk for the human.)
```

Key facts:
- `<KB>` = the result's byte size converted to KB. `<T>` = thresholdBytes converted to KB.
- "modest token cost (~40 tokens) incurred once, only when the threshold is crossed."
- "appended, not replacing — the agent may genuinely need the full output right now."
- Default `bloatThresholdBytes = 8192` (8 KB ≈ 2k tokens). "in BYTES of the in-context text representation … UTF-8 byte length."
- **CRITICAL**: the verbatim text contains NO `<toolName>` placeholder → `toolName` is accepted by the signature
  (handler passes `event.toolName`) but is NOT interpolated into the v1 text. (See design_decisions.md §3.)

### §2 — `renderDriftNudge` (Nudge B: per-turn drift nudge, `turn_end` → `context` injection)

The `renderDriftNudge` text (verbatim from the ```md block):
```
[mulligan] Previous turn added ~<delta>k tokens to your context< and produced <N> bloated result(s)>.
If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).
Run `mulligan_audit` for a breakdown.
```

Key facts:
- `<delta>` = `TurnMetric.deltaTokens` rendered as a "k" value (thousands).
- `< and produced <N> bloated result(s)>` = the CONDITIONAL bloat clause — present iff `bloatHits` non-empty;
  `result(s)` pluralizes (1 → "result", else → "results").
- "~25–40 tokens per turn when it fires."
- Injected as a NON-persisted `mulligan:nudge` custom message in the filter copy (`pi.sendMessage` NOT called).
- **First turn / post-reload edge case**: "`tokenBaseline` is null → `deltaTokens` is `null` → nudge falls back to
  `bloatHit`-only signaling (still useful; a bloated result on turn 1 still nudges)." → `renderDriftNudge` MUST
  handle `deltaTokens: null` by DROPPING the "added ~<delta>k tokens" clause and leading with bloat.
  (See design_decisions.md §4.)

Consumer call site (spec/06 §1 + spec/07 §2):
```ts
function injectNudge(messages: AgentMessage[], metric: TurnMetric): AgentMessage[] {
  const line = renderDriftNudge(metric);
  const nudge: AgentMessage = { role:"custom", customType:"mulligan:nudge", content: line, display:false, ... };
  return [...messages, nudge];
}
// gate: shouldNudge(metric, config) = metric.grewOverThreshold || metric.bloatHit
```

### §3 — determinism & testability (VERBATIM)
"Both nudges are driven by pure helpers (`renderBloatReminder`, `renderDriftNudge`, `shouldNudge`, `resultBytes`,
`approxTokens`) that are unit-tested without Pi."

---

## 2. spec/04-data-model.md §5 — TurnMetric (the metric the renderer consumes)

```ts
interface TurnMetric extends MulliganEnvelope {
  kind: "turn-metric";
  seq: number;
  ts: number;
  deltaTokens: number;        // signed estimate of how much context grew this turn
  bloatHit: boolean;          // any tool_result this turn exceeded bloatThreshold
  bloatHits: { toolName: string; approxTokens: number }[];
  grewOverThreshold: boolean; // deltaTokens > driftThresholdTokens
  turnIndex: number;
}
```
"…If the baseline is missing (e.g. first turn, or post-reload), `deltaTokens` is `null` and the nudge falls back
to `bloatHit`-only signaling."

NOTE: the work-item contract says `renderDriftNudge` takes a **metric-LIKE** object
`{deltaTokens: number|null, bloatHits: {toolName:string, approxTokens:number}[]}` — i.e. the MINIMAL PROJECTION
of TurnMetric the renderer needs (deltaTokens + bloatHits only). This keeps renderDriftNudge unit-testable without
constructing a full TurnMetric (seq/ts/kind/turnIndex/etc.). See design_decisions.md §6.

---

## 3. spec/09-configuration.md — threshold defaults (verified)

```jsonc
"nudges": {
  "bloatReminder": true,
  "perTurnDrift": true,
  "bloatThresholdBytes": 8192,    // 8 KB in-context → reminder (below Pi's 50 KB built-in cap)
  "driftThresholdTokens": 3000    // turn token delta → drift nudge
}
```
- `bloatThresholdBytes = 8192` (8 KB ≈ 2k tokens).
- `driftThresholdTokens = 3000` (a turn that adds ~3k+ tokens is worth a glance).
These are the DEFAULTS the test fixtures use (8192 bytes = 8 KB exactly; 3000 tokens = 3k).

---

## 4. spec/10-testing.md — test tier

- §1 Tier 1 (pure helpers, no Pi): target files include `notes.ts`. Framework: Vitest (house style — see
  test/tokens.test.ts `toMatchInlineSnapshot` at line 48).
- §2.1 F-shrink-preventive: "result content has the appended `[mulligan]` reminder; `turn-metric` records
  `bloatHit:true`."
- §2.1 F-nudge-drift: "a turn that grows >3k tokens | next inference's filtered view ends with a `mulligan:nudge`
  custom message (ephemeral; NOT in session JSONL)."
- §2.3: "`mulligan:nudge` is **never** persisted (it's constructed in the filter copy only)."
- The work item says: "Unit test: snapshot tests for representative inputs." → mirror S2's approach: pinned `.toBe()`
  format-contract tests + `toMatchInlineSnapshot()` representative cases.

---

## 5. spec/11-build-order.md — module ownership (verified)

```
│   ├── notes.ts                # PURE: validateNote, renderNote, renderBloatReminder, renderDriftNudge
│   ├── nudges.ts               # tool_result annotator + turn_end metric + shouldNudge/injectNudge
```
Step 2: "Implement `validateNote`, `renderNote`, `renderBloatReminder`, `renderDriftNudge`." → ALL FOUR renderers
live in `notes.ts`. `renderBloatReminder` + `renderDriftNudge` are CONSUMED BY `nudges.ts` (P1.M6) — but they are
IMPLEMENTED HERE (P1.M2.T3.S3, pure-helper tier).

---

## 6. spec/06-context-filter.md — the gate that precedes renderDriftNudge (verified)

```ts
if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
  m = injectNudge(m, markers.metric);   // → renderDriftNudge(metric)
}
// shouldNudge(metric, config) = metric.grewOverThreshold || metric.bloatHit   (spec/07 §2)
```
→ `renderDriftNudge` is ONLY reached when `shouldNudge` is true, i.e. EITHER `deltaTokens` is a growth-over-
threshold number OR `bloatHits` is non-empty. The both-null-and-empty case is UNREACHABLE in practice — but the
pure function is total (never throws, always returns a string). See design_decisions.md §5 (defensive fallback).

---

## 7. VERIFIED ON-DISK BASELINE (run 2025-08-07 before writing this PRP)

```
npx tsc --noEmit -p tsconfig.json   → exit 0
npx vitest run                      → 6 files / 187 tests green
                                       (config 21, ledger 39, log 15, notes 41, runtime 20, tokens 51)
```
- `src/notes.ts` = 222 lines. S1 (validateNote + NoteInput + isRecord/readOwn) + S2 (renderNote + readNoteField +
  readLedgerList + LEDGER_BLOCKS + the two `import type` lines at the very top) are LANDED.
- `test/notes.test.ts` = 392 lines, 41 tests (17 S1 validateNote + 24 S2 renderNote). Imports already include
  `renderNote`, `type FileLedger`, `type Granularity`. Has a `VALID_NOTE: NoteInput` constant.
- `devDeps = typescript ^5 + vitest ^1 + @types/node ^22` ONLY. NO eslint/prettier/biome → the type+style gate is
  `tsc --noEmit` (TS strict). tsconfig has `strict:true` but NOT `noUnusedParameters`/`noUnusedLocals` → an unused
  param compiles; the codebase STILL prefixes intentionally-unused params with `_` (see `tokens.ts`
  `estimateTokens(messages, _model?: unknown)`).
- moduleResolution:"Bundler" + type:"module" → test imports use `../src/notes.js` (.js extension resolves to .ts).