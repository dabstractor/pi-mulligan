# pi-mulligan

> Autonomous, token-cheap context self-rewind for a [Pi](https://github.com/earendil-works/pi-coding-agent) coding agent. The agent sheds context it produced by mistake and redoes a turn with a self-authored note — no human in the loop.

**Pi:** `0.84.x` · **License:** MIT · **Status:** v1.0

---

## 1. Overview

**pi-mulligan** is a Pi extension that gives a coding agent autonomous, token-cheap control over its own context window — the ability to shed context it produced by mistake (a giant un-suppressed command output, a too-large file read, a wrong-direction exploration) and to *redo* a turn with a self-authored note, without a human in the loop.

The name comes from golf: a *mulligan* is a courtesy do-over in golf — a second shot after a bad one, without penalty. That is exactly what this extension gives the agent.

**Why agents need this:**

- **Unbounded output capture.** A `grep -r foo .` over a monorepo or a `cat` on a log produces ~10k tokens of output that then persists in *every* subsequent turn.
- **Wrong-direction work.** The agent pursues an approach across turns, accumulates a footprint, then reaches an insight that invalidates it — but the sunk context keeps taxing every future inference.
- **Silent accumulation.** No single result is catastrophic, but the turn grew the context sharply and the agent has no built-in signal that it is drifting toward an auto-compaction it would rather avoid.

**Why Pi's existing tools don't solve it:** compaction summarizes the *head* and *keeps the tail* (it sheds *old* context — the wrong direction for this use case), and `/tree`, `/compact`, and `/fork` are all human-driven — an agent tool has no route to invoke them (proven in `spec/02-proven-constraints.md`). There is no agent-callable primitive for "forget what I just did and try again." Mulligan provides it.

See `spec/SPEC.md` §1–§2 for the full executive summary and problem statement.

---

## 2. Installation

> **Works with zero configuration.** No `mulligan` settings are needed — the extension loads with all defaults (see [Configuration](#3-configuration) below).

### Three ways to load the extension

1. **Quick test — the `-e` / `--extension` flag:**

   ```bash
   pi -e ./src/index.ts
   ```

2. **Auto-discovery (recommended for daily use; supports `/reload`):** place the extension in one of Pi's extension directories:

   - `.pi/extensions/*.ts` — project-local (loads after project trust), or
   - `~/.pi/agent/extensions/*.ts` — global.

   This repo ships as `src/index.ts`; symlink or copy it into the auto-discovery directory so it is discoverable, or keep using `pi -e` for development.

3. **As a distributed Pi package:** `pi install` (npm or git), per Pi's `docs/packages.md`.

### npm for editor types (optional)

The repo already declares its runtime deps (`@earendil-works/pi-coding-agent` + `typebox`) in `package.json`. Running `npm install` resolves `node_modules/` so editors get IntelliSense/type-resolution. **It is not required to run** — at runtime, Pi resolves these deps from its own install (extensions are jiti-loaded in Pi's process).

### Zero-config smoke (the acceptance check)

```bash
pi -e ./src/index.ts        # loads with NO mulligan config → all defaults → works out of the box
```

This is the `spec/11-build-order.md` §2 Step 9 acceptance check: the extension must load without error with an absent/empty `mulligan` config block.

### Requirements

- **Pi** `0.84.x`.
- **Node ESM** (the project's `package.json` has `"type": "module"`).

---

## 3. Configuration

Mulligan reads a `mulligan` object from Pi `settings.json` — the global `~/.pi/agent/settings.json` and/or the project-local `.pi/settings.json` (project-local overrides global). It is loaded lazily on first use, cached for the session, and re-read on `/reload`. See `spec/09-configuration.md` §1.

> **Zero configuration.** Every option has a safe default. Unknown keys are ignored; type-mismatched values fall back to the default with a `warn`; **validation never throws.** The extension works with an empty or absent `mulligan` block.

### Defaults table

All 19 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3).

| Knob | Default | What it does |
|------|---------|--------------|
| **master** | | |
| `enabled` | `true` | Master switch. `false` → the entire extension is a no-op (see [Disabling](#disabling)). |
| **rewind** | | |
| `rewind.enabled` | `true` | Enable the `mulligan_rewind` tool. |
| `rewind.protectedRoles` | `["first:user", "latest:user"]` | Message selectors that can never be rewound past (the original task / the current ask). v1 supports these two selectors; unknown entries are dropped. |
| `rewind.maxDepth` | `5` | Max simultaneous *active* `mulligan:rewind` markers on a branch. Bounds accumulation (markers are permanent). |
| `rewind.maxRetriesPerPrompt` | `5` | Max *consecutive* rewinds that re-land at the same latest user prompt before refusal — the runaway-loop bound (`spec/08-edge-cases.md` E22). Distinct from `maxDepth` (cumulative markers). |
| `rewind.abortContextFraction` | `0.9` | Refuse any rewind once the filtered-context estimate reaches this fraction of the window — the zero-marker-loop guard (`spec/08-edge-cases.md` E22). |
| `rewind.requireMutationWarning` | `true` | Append a ⚠ warning when the hidden span wrote files / ran side-effecting bash (those effects persist on disk). |
| **shrink** | | |
| `shrink.enabled` | `true` | Enable the `mulligan_shrink` tool. |
| `shrink.maxActive` | `32` | Cap on simultaneous *active* `mulligan:shrink` markers; the oldest is retired when exceeded. Mirrors `rewind.maxDepth` as a bound on marker accumulation. |
| `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent for this many consecutive filter fires (`spec/08-edge-cases.md` E15/E21). Stops dead markers being walked every fire. |
| **nudges** | | |
| `nudges.bloatReminder` | `true` | Annotate a `tool_result` exceeding the byte threshold with a rewind reminder. |
| `nudges.perTurnDrift` | `true` | Inject a one-line drift nudge when a turn grew past the token threshold. |
| `nudges.bloatThresholdBytes` | `16384` | Global catch-all: in-context byte size of a single tool result above which the bloat reminder fires (16 KB — below Pi's ~50 KB cap). A tool listed in `bloatThresholdBytesByTool` uses its own value instead; tools not listed fall back to this. |
| `nudges.bloatThresholdBytesByTool` | `{ "read": 24576 }` | Per-tool byte thresholds (keyed by Pi `toolName`). A tool listed here uses its own value instead of the global `bloatThresholdBytes`; tools not listed fall back to the global. `bash` is intentionally NOT listed — it is the primary bloat surface, so it uses the 16 KB global default to stay maximally sensitive; `read` gets 24 KB because large source-file reads are routine. |
| `nudges.driftThresholdTokens` | `6000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. Raised from the previous 3k default after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point. |
| `nudges.driftWindowTurns` | `3` | Rolling window (in turns) over which the per-turn token delta is smoothed before thresholding (`spec/07-preventive-and-nudges.md` §5.1). Turns a noisy single-turn signal into a sustained-growth signal. |
| `nudges.highWaterFraction` | `0.7` | Fraction of the context window at which the §5.2 high-water annotation fires (edge-triggered — fires once on crossing, clears when the total drops back below). Catches slow, steady accumulation the delta nudge misses. |
| **audit** | | |
| `audit.estimateConfidence` | `"medium"` | Honesty label reported with token estimates (`low` \| `medium` \| `high`). |
| **log** | | |
| `log.file` | `null` | Off by default. An absolute path to an append-only JSONL debug log. |

### Minimal example `settings.json`

The `mulligan` block is **optional** — omit it entirely for all defaults. Here is its shape, commented out so you can see the keys:

```jsonc
{
  // "mulligan": {
  //   "enabled": true,
  //   "rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },
  //   "shrink": { "maxActive": 32, "staleAfterFires": 3 },
  //   "nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "read": 24576 }, "driftThresholdTokens": 6000, "driftWindowTurns": 3, "highWaterFraction": 0.7 }
  // }
}
```

#### Disabling

`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and the state-changing tools refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (the three mutating tools — `rewind`, `shrink`, `cancel` — gate on the master switch; `checkpoint` and `audit` remain available as always-on read-only diagnostics). The human can disable Mulligan without uninstalling it.

---

## 4. Tools

Mulligan registers five agent-callable tools. The descriptions below are **verbatim copies** of the LLM-facing description strings the agent sees at runtime (from `src/tools/*.ts`) — they are the agent's documentation, reproduced here so a human knows exactly what the agent can now do. When-to-use guidance follows each one (from `spec/05-tools.md`).

### `mulligan_rewind`

> Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The hidden content disappears from your view permanently (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message.

**When to use it:**

- After a bloated tool result you cannot undo (e.g. an un-redirected `grep -r`) — shed it and re-approach.
- After a whole turn pursued the wrong direction — drop the work since the last user message and re-attempt.
- To jump back to a named checkpoint before a speculative sub-task you want to discard wholesale.

**Granularities:**

| `granularity` | What it hides |
|---------------|---------------|
| `last_tool_call_group` | Surgical — the most recent assistant turn that issued tool calls *plus* its tool-result messages. Keeps surrounding reasoning. |
| `last_turn` | Everything after the most recent user message (assistant + tool-result work produced this turn). The model lands back at the current user prompt. |
| `checkpoint` | Back to a named checkpoint set via `mulligan_checkpoint` (requires the `checkpoint` param). |

The optional `to_previous_prompt` (only valid with `last_turn`) is the *nuclear* option: it also discards the most recent user message, abandoning the current ask entirely.

**The four-field note (confabulation defense).** A rewind requires a `note` with four non-empty fields — `what_happened` (what went wrong), `avoid` (what not to do again), `true_current_state` (files changed, commands run, decisions made on the discarded span — a deterministic file ledger is auto-appended here), and `next` (the immediate next action). Vacuous notes are refused. The resumed model reads this note as the most-recent context.

### `mulligan_shrink`

> Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result).

**When to use it (vs `mulligan_rewind`):** rewind = the call was a *mistake* — it is gone, replaced by a fresh attempt; shrink = the call was *fine* but its *output* is bloated — the call stays, and its result is swapped for your summary.

**Target matchers** (resolved live each turn, robust to compaction):

- `by_tool_call_id` — the unique toolCallId of the result to shrink.
- `by_tool_name` + `occurrence` (`"last"` / `"first"`) — semantic match by tool name.
- `by_content_includes` — the first message (any role) whose text contains the substring.

The `replacement` must be non-empty and **faithful** — the model treats it as ground truth from then on.

### `mulligan_checkpoint`

> Name the current position so a later mulligan_rewind can jump straight back to it. Use before a speculative sub-task you might want to undo in one shot.

**When to use it:** before a speculative sub-task you might want to discard wholesale — set a checkpoint, and a later `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` returns to it in one shot.

The `name` must match `/^[a-z0-9_-]{1,40}$/` (lowercase, digits, hyphen, underscore; 1–40 chars). Invalid names are refused.

### `mulligan_audit`

> Show a token breakdown of the context you're currently carrying (what the model actually sees), flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to rewind or shrink.

**When to use it:** when you suspect context is bloated and want to decide between rewind (mistake) and shrink (fine-but-big). The report ranks the top messages by size (`top`, default `8`), flags results above the per-tool bloat threshold, and lists active rewind/shrink markers + checkpoints — closing the feedback loop ("that one read is 9.4k → shrink it").

The token total is computed from the **filtered view** (what the model actually sees after Mulligan's transforms) — *not* Pi's `getContextUsage()`, which would count already-hidden tokens. The audit is **read-only** and persists nothing.

### `mulligan_cancel`

> Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Pass the markerId you received in details when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op.

**When to use it:** the safety valve for a mis-targeted `mulligan_rewind` or `mulligan_shrink` — a shrink issued against the wrong message, a rewind that hid something you still need, or any marker pointed at the wrong target. Without it, the mistaken transform would apply on every turn for the rest of the session, and a `mulligan_rewind` of the issuing call does **not** retire it (markers are control entries outside the rewind's span). Pass the `markerId` you received in `details` when you issued the marker; the transform stops applying from the next turn on. Cancelling a non-existent or already-cancelled id is a safe no-op — call it freely if unsure.

Retraction is **forward-only**: it suppresses the marker from the filtered view going forward. It does **not** undo on-disk side effects (file edits and bash commands persist) or replay originally-hidden content into the live turn — that stays recoverable by the human via `/tree`. This softens D6: a mistaken marker is no longer irrevocably permanent.

---

## 5. How It Works

The core insight (established empirically in the feasibility spike, `spec/02-proven-constraints.md`): Pi's conversation is an **append-only tree** that an agent *cannot* structurally mutate from a tool, but the agent **can** drop persisted "view instructions" that the `context` event honors on every inference. A rewind is therefore not a deletion — it is a **permanent soft-delete**: a persisted marker that hides a span from every future inference, while the originals remain on disk and are visible in `/tree`.

### Data flow on a rewind

```
agent calls mulligan_rewind(note, granularity)
   │
   ├─ appendEntry("mulligan:rewind", {spec, ...})         ← control state (NOT sent to the model)
   ├─ sendMessage({customType:"mulligan:note", content})   ← the note (IN context)
   └─ tool returns a short confirmation
        │
        ↓  (normal agent loop continues)
next inference → context handler
   ├─ read mulligan:* markers from the session entries
   ├─ rewrite the message copy: hide the span / substitute the shrink
   └─ return { messages: transformed }
        │
        ↓
model sees [kept prefix] + [your note] + [confirmation], resumes — no resume code needed
```

**Shrink** = view substitution: `appendEntry("mulligan:shrink", {target, replacement})`; the context handler substitutes content in place (preserving `role` / `toolCallId` / `toolName` / `isError` so the tool-call/result pairing invariant holds).

Both rewind and shrink markers are **retractable**: `mulligan_cancel` retires a mis-targeted marker so it stops applying from the next turn on — a safety valve when a rewind hid something still needed or a shrink hit the wrong message (see [§4 Tools](#4-tools)). Retraction is forward-only: on-disk side effects persist and originally-hidden content stays recoverable via `/tree`.

**Ride-along nudges & signals (zero extra model requests):**

1. **Bloated-result reminder** — a `tool_result` hook appends a short reminder to any result exceeding the per-tool bloat threshold (`bash`: 32 KB, `read`: 20 KB, others: the 16 KB global default).
2. **Per-turn drift nudge** — at `turn_end` Mulligan records the token delta; on the *next* inference it injects a one-line annotation (e.g. `[mulligan: last turn +4.2k tokens; rewind available]`). The delta is **windowed** (`spec/07-preventive-and-nudges.md` §5.1): smoothed over a rolling window of the last `nudges.driftWindowTurns` turns (default 3) before the threshold, so a single heavy turn (reading several source files, a pasted reference doc) does **not** fire it, but *sustained* growth across consecutive turns does. The `mulligan:nudge` annotation is **never persisted**.
3. **High-water signal** (`spec/07-preventive-and-nudges.md` §5.2) — a one-time annotation (`[mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`) the first time the *filtered* context crosses `nudges.highWaterFraction` of the window (default 0.7). It is **edge-triggered** — it fires once on the upward crossing and stays quiet until the total drops back below the fraction, so it never nags. This catches slow, steady accumulation that no single-turn delta nudge sees.

**`/tree` is the audit trail.** Every rewind, shrink, and checkpoint is a persisted entry — the human can inspect the full un-filtered history (including every hidden span) via Pi's native `/tree`. Mulligan adds no human-facing command of its own, because `/tree` already serves that need.

See `spec/SPEC.md` §1, §4 and `spec/06-context-filter.md` for the full architecture.

---

## 6. Guarantees

1. **Soft-delete / audit trail.** Hidden content is **never lost** — it stays in the session JSONL on disk and is visible in Pi's native `/tree`.
2. **Fail-open.** Any internal error degrades to a logged no-op, never a broken agent turn. Every tool and handler is try/catch-wrapped.
3. **Zero-config + zero extra requests.** The extension works out of the box with all defaults. The nudges ride inferences that were already happening — they add no model requests.

---

## 7. Known Limitations

Mulligan is deliberately minimal. These are the four things it deliberately does **not** do in v1.

- **Compaction leak (`spec/08-edge-cases.md` E7).** Pi's auto-compaction may summarize a span that included a Mulligan-hidden message, producing a transient "leak" via the summary until the next compaction settles. v1 accepts this as bounded and transient — and Mulligan *reducing* context makes compaction fire later and over less-important content. There is no v1 mitigation.
- **No general undo (`spec/SPEC.md` §9 D6; softened by `spec/08-edge-cases.md` E21).** Agent-initiated rewinds and shrinks persist across reload and `/resume`, and there is no un-rewind that *replays* hidden content or *reverses* on-disk side effects (file edits and bash commands persist) — a human who wants to explore hidden content uses Pi's native `/tree`. One safety valve now exists: a mis-targeted marker is **retractable** via `mulligan_cancel`, which stops the transform applying from the next turn on (the marker stays on disk for the audit trail). This softens D6 for marker mistakes; it does not make rewinds/shrinks generally reversible.
- **No hard retry / replay (`spec/SPEC.md` §9 D1).** Mulligan supports *soft* retry only (rewind + note + re-plan). Hidden tool calls' **side effects persist on disk** (files written, commands run); replaying them would compound those effects (a duplicate commit, a double `mkdir`). The mutation warning and the note's `true_current_state` / auto-appended file ledger are the safeguards.
- **Markers accumulate (`spec/08-edge-cases.md` E15).** v1 does no marker garbage-collection — markers persist intentionally (they are the audit trail). `rewind.maxDepth=5` bounds simultaneous *active* rewind markers; the only cost is disk growth (markers are control state, not in context). The filter is cheap in practice (few markers × messages bounded by compaction). Two hard backstops guard against runaway same-prompt retry loops (`spec/08-edge-cases.md` E22): a per-prompt retry budget (`rewind.maxRetriesPerPrompt`) and a context-fraction stop (`rewind.abortContextFraction`) that refuse a rewind *before* it can drive the context to a provider 'Prompt too long' rejection.

---

## 8. License

**MIT** (per `spec/SPEC.md`). Adding a top-level `LICENSE` file with the MIT text is recommended but not yet present in this repo.

---

## Further reading

The `spec/` directory is the deep-detail reference. Start with `spec/SPEC.md` (the master document: PRD + architecture), then the companion sections:

- `spec/05-tools.md` — the five tools' full specification.
- `spec/06-context-filter.md` — the context-event view transform.
- `spec/09-configuration.md` — the configuration surface + coercion rules.
- `spec/08-edge-cases.md` — edge cases (E7 compaction leak, E14 master switch, E15 markers).