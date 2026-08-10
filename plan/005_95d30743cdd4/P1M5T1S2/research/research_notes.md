# Research Notes — P1.M5.T1.S2 (README feature blurbs for four behavior changes)

**Mode B changeset-level documentation sync.** Sole deliverable: edits to `README.md` §4 (tool prose) + §5
(How It Works nudge prose). No code, no tests, no spec files.

## Parallel sibling: P1.M5.T1.S1 (config table + JSON example)

S1 owns README **§3** ONLY (config table: `shrink.notifyMaxChars` row, "All 20 knobs" caption, JSON shrink
block). S2 (this task) owns README **§4** (tool blurbs) + **§5** (How It Works). **Text-disjoint** — no
overlapping FIND strings; the two land cleanly regardless of order. S1's GOTCHA #6 explicitly defers the
prose blurbs to S2. NOTE: the README on disk at research time ALREADY reflects S1's §3 changes (notifyMaxChars
row + "All 20 knobs" + JSON), so the line numbers below are post-S1; but the edits rely on **verbatim unique
FIND strings**, not line numbers, so they're stable either way.

## The four behavior changes — source-of-truth verification

### (1) mulligan_cancel target API — `src/tools/cancel.ts` (M1.T1.S2, Complete)

NEW shipped `CANCEL_DESC` (the LLM-facing desc; README §4 blockquote is a *verbatim copy* of it):
> "Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use
> when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken
> transform would apply on every turn for the rest of the session. Identify the marker by `target` (same hint
> shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most
> recent marker affecting that content is retired; or pass an explicit `markerId` if you have one. The
> transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail).
> Cancelling a non-existent or already-cancelled marker is a safe no-op."

- KEY: takes a `target` hint (SAME 3-arm union as shrink); most-recent covering marker retired (LIFO by seq);
  `markerId` is now an OPTIONAL fallback ("markerId wins if both given").
- OLD README §4 cancel blockquote (line 191) says "Pass the markerId you received in details when you issued
  the marker." — this is the pre-M1 id-only form. → **REPLACE blockquote with new verbatim CANCEL_DESC.**
- README §4 cancel "When to use it" (line 193) also says "Pass the `markerId`..." — → update to target-first.
- No `config.cancel` sub-knob (master gate only).

### (2) mulligan_shrink operator echo — `src/tools/shrink.ts` (M2.T1.S2, Complete)

- `SHRINK_DESC` is **UNCHANGED** (3 sentences, same as README §4 blockquote line 155). → **Blockquote stays
  verbatim; do NOT touch it.**
- The CHANGE is in BEHAVIOR, not the desc string:
  - Tool RESULT stays terse: `feedbackText` = `"Mulligan: shrink recorded. Matched: ${matched ? "yes" : "no"}."`
    (line 146). Replacement is NOT echoed in the result.
  - Operator echo via `ctx.ui.notify` (lines 324–326):
    `if (ctx.hasUI) { const capped = cap(params.replacement, config.shrink.notifyMaxChars);
      ctx.ui.notify(\`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>\`, "info"); }`
  - Capped at `shrink.notifyMaxChars` (default 2048, shipped M2.T1.S1, already in §3 config table).
  - Zero context cost: `ctx.ui.notify` is a pure UI side-channel never added to the model's context.
- → **ADD a sentence in the README §4 shrink prose** (after the "When to use it" line) noting the operator
  echo via UI toast, capped by notifyMaxChars, result stays terse. spec/05 §2 pointer.

### (3) checkpoint auto-expiry — `src/tools/rewind.ts` (M3.T1.S1, Complete)

- `CKPT_DESC` (`src/tools/checkpoint.ts` line 79) is **UNCHANGED** (2 sentences, same as README §4 checkpoint
  blockquote line 169). → **Blockquote stays verbatim; do NOT touch it.**
- The CHANGE is in the rewind tool (the consumer), `rewind.ts` step (7b), lines 558–577:
  - On the `checkpoint`-granularity success path (after step 7 persist + leaveNote), the checkpoint label
    `mulligan:checkpoint:<name>` is **cleared** — the checkpoint is "consumed" by the rewind that targets it.
  - Rationale (spec/05 §3 step 5 "Auto-expiry on consumption (REQUIRED)"): a used checkpoint has no further
    purpose; unconsumed throwaway checkpoints otherwise linger in the active-marker list indefinitely.
  - Re-creating a checkpoint of the same name after consumption is allowed (sets a fresh label).
  - The clear is best-effort, its own try/catch (E13) — a label-clear failure never undoes the rewind.
- → **ADD a sentence in README §4 checkpoint prose** (the "When to use it" line): checkpoint auto-expires
  once a rewind targets it; re-creating later is allowed. spec/05 §3 pointer.

### (4) nudge text simplification — `src/notes.ts` (M4.T1.S1 + M4.T2.S1, Complete)

#### (4a) bloat reminder — `renderBloatReminder(toolName, bytes)` now 2-arg (was 3-arg with thresholdBytes)
- NEW shipped text (line 276):
  `\n---\nThis result added ~${resultKb} KB to your context. If you don't need the full output, call
   \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:"last_tool_call_group")\` if the whole
   call was a mistake.`
- Single physical line after a `\n---\n` separator; ~30 tokens, appended (not replacing).
- README §5 bloat reminder (line 222) currently: "...a short reminder...(`bash`: 32 KB, `read`: 20 KB, others:
  the 16 KB global default)."
  - **STALE THRESHOLDS** that contradict §3 config table (line 96: `{ "read": 24576 }` = 24 KB; bash NOT listed
    → 16 KB global). §5 says `bash: 32 KB, read: 20 KB` — both wrong vs §3 AND vs code.
  - → **UPDATE line 222**: reflect shorter single-line text AND fix thresholds to match §3 (bash + unlisted =
    16 KB global; read = 24 KB). This consistency fix is justified: it's the same sentence being edited, and
    leaving it would make the README contradict its own §3 table.

#### (4b) drift nudge — `renderDriftNudge(metric)` rewritten
- NEW shipped text (lines 311–322), SINGLE physical line, NO `[mulligan]` prefix, NO bloat clause on the delta
  path:
  - delta path (the normal case): `"Previous turn added ~<k> tokens to your context. If that growth was
    wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run
    \`mulligan_audit\` for a breakdown."`
  - `<k>` = delta/1000 to 1 decimal (4200→"4.2k", 3000→"3k").
  - BLOAT IS NOT rendered when delta data exists (spec/07 §5.3): the drift nudge no longer re-announces a
    bloated result the agent already addressed (a since-shrunk result would otherwise be re-announced one turn
    later with stale counts). `bloatHit` fires the drift nudge ONLY as the no-baseline fallback (first turn /
    post-reload, deltaTokens===null).
- README §5 drift nudge (line 223) currently uses the STALE example `[mulligan: last turn +4.2k tokens;
  rewind available]` and says nothing about the no-re-announce-bloat behavior.
  - → **UPDATE line 223**: replace stale example with the actual shipped text, and add the delta-only /
    no-re-announce-bloat behavior. spec/07 §2/§5.3 pointer.

## README §4 "verbatim copies" rule (line 129, critical for placement)

README §4 states: "The descriptions below are **verbatim copies** of the LLM-facing description strings the
agent sees at runtime (from `src/tools/*.ts`)." This determines WHERE each edit goes:

- **Cancel (1):** blockquote MUST be updated to new verbatim CANCEL_DESC (the desc string itself changed).
  Plus the "When to use it" prose (README's own text, not verbatim) gets a target-first rewrite.
- **Shrink (2):** blockquote = verbatim SHRINK_DESC (UNCHANGED) → **do not touch**. The echo note goes in the
  README's own "When to use it" prose below it.
- **Checkpoint (3):** blockquote = verbatim CKPT_DESC (UNCHANGED) → **do not touch**. The auto-expiry note
  goes in the README's own "When to use it" prose below it.

## Out of scope (confirmed)

- §3 config table / JSON example → S1.
- §1 Overview, §2 Installation, §6 Guarantees, §7 Known Limitations, §8 License, Further reading → no change
  (§6/§7 already mention mulligan_cancel's retraction safety valve at the right level of abstraction; the
  target param is a §4 detail).
- Any code/spec/test file → none. README.md is the sole target.
- No markdown linter / no `tsc`/`vitest` gate exercises README → validation is **grep + cross-check** (like S1).

## Source files read (READ-ONLY — for verbatim accuracy of the target text)

- `src/tools/cancel.ts` — CANCEL_DESC (new, with `target`).
- `src/tools/shrink.ts` — SHRINK_DESC (unchanged) + ctx.ui.notify echo (lines 324–326) + feedbackText (146).
- `src/tools/checkpoint.ts` — CKPT_DESC (unchanged, line 79).
- `src/tools/rewind.ts` — checkpoint consumption step (7b), lines 558–577.
- `src/notes.ts` — renderBloatReminder (274–276) + renderDriftNudge (311–322).
- `README.md` — the sole edit target (§4 lines 153–195, §5 lines 222–223).