# 03 — Architecture

> This document specifies the **shape** of Mulligan: its components, their responsibilities, how data flows between them, and why this shape (and not the alternatives that were rejected). The precise data shapes are in `@04-data-model.md`; the algorithms are in `@06-context-filter.md` and `@07-preventive-and-nudges.md`.

---

## 1. One-sentence architecture

**Mulligan persists lightweight "markers" as Pi `CustomEntry`s, and a single `context`-event handler reads those markers on every inference and rewrites the message copy sent to the model — hiding spans (rewind), substituting message content (shrink), and injecting a one-line nudge — all without ever mutating the session tree and without ever spending an extra model request.**

## 2. Components

```
┌──────────────────────────────────────────────────────────────────────┐
│  pi-mulligan extension (one entry file, internal modules)             │
│                                                                       │
│  ┌──────────────────────────────┐   ┌──────────────────────────────┐ │
│  │  TOOLS (agent-callable)       │   │  EVENT HANDLERS              │ │
│  │  • mulligan_rewind            │   │  • context  (the filter)     │ │
│  │  • mulligan_shrink            │   │  • tool_result (bloat anno.) │ │
│  │  • mulligan_cancel            │   │  • turn_end  (drift metric)  │ │
│  │  • mulligan_audit             │   │  • session_start (init)      │ │
│  └───────────┬──────────────────┘   └──────────────┬───────────────┘ │
│              │ writes markers/notes via pi.*        │ reads markers   │
│              ▼                                      ▼                 │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  PERSISTED STATE (Pi CustomEntries / CustomMessages, in JSONL)   │ │
│  │   mulligan:rewind marker   mulligan:shrink marker                │ │
│  │   mulligan:checkpoint label mulligan:note (context message)      │ │
│  │   mulligan:turn-metric (drift telemetry)                         │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  PURE HELPERS (no Pi surface; unit-testable)                     │ │
│  │   resolveRewind()  resolveShrink()  applyTransforms()            │ │
│  │   extractFileLedger()  estimateTokens()  findToolCallPairs()     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Tools (`@05-tools.md`)

Four tools, each a thin wrapper: validate input → write the appropriate marker(s)/note via `pi.*` → return a short confirmation. **Tools never read or transform the message list** — that is the filter's job. Keeping tools write-only and the filter read-only makes the system easy to reason about and unit-test (the transform logic lives in pure helpers).

- `mulligan_rewind(note, granularity, options?)` — append a rewind marker + the note.
- `mulligan_shrink(target, replacement)` — append a shrink marker.
- `mulligan_audit()` — **read-only exception**: computes a token breakdown from the last-known filtered view and returns it as the tool result. (It does not persist anything; it reads markers + estimates tokens. See `@05-tools.md` §4.)
- `mulligan_cancel(target|markerId)` — append a `mulligan:cancel` retraction marker.

> **v1.1:** `mulligan_checkpoint` is **no longer an agent tool** — it is the human slash command `/mulligan_checkpoint` (`@13` §2). `mulligan_rewind(granularity:"checkpoint")` is retained so the agent can rewind *to* a user-set checkpoint. The three human commands (`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit`) and the active-checkpoint banner are specified in `@13-human-facing-surface.md`; they are thin handlers over the same `markers.ts` wrappers + pure helpers, write-only w.r.t. the model's context.

### 2.2 Event handlers

- **`context` (the filter)** — the heart. On every inference: read all `mulligan:rewind` and `mulligan:shrink` markers from `ctx.sessionManager.getEntries()`; resolve each against `event.messages` via the pure helpers; compose the transforms in a defined order; inject the per-turn nudge if the latest `mulligan:turn-metric` warrants it; return `{ messages }`.
- **`tool_result`** — measures result size; if above the bloat threshold, appends a short reminder line to the result content (advisory, per D3). Optionally (off by default) records a candidate for auto-shrink.
- **`turn_end`** — computes the turn's token delta (using cached "tokens at turn_start" minus "tokens at turn_end", or an estimate) and appends a `mulligan:turn-metric` entry consumed by the next `context` fire for the nudge.
- **`session_start`** — initializes per-session in-memory caches (e.g., the running token baseline). No long-lived resources.

### 2.3 Pure helpers (`@06-context-filter.md`)

All transform logic is extracted into pure functions taking `(messages, marker, config)` and returning a new message array. This is the single most important testability decision: **the entire correctness surface of Mulligan is unit-testable without Pi, without a model, and without a session.** The Pi-facing code is glue.

Key helpers:
- `findToolCallPairs(messages)` — maps every `toolCall` id to its `toolResult` index and vice versa, for pairing-aware hiding.
- `resolveLastToolCallGroup(messages, excludeToolCallIds)` — returns the index range of the most recent assistant message containing tool calls + its result messages.
- `resolveLastTurn(messages, excludeToolCallId?)` — returns the index range of the most recent turn's agent work (keeps the user message; v1.1: `to_previous_prompt` removed).
- `applyRewind(messages, range)` — pairing-aware removal.
- `applyShrink(messages, target, replacement)` — content substitution.
- `extractFileLedger(messages, range)` — deterministic `readFiles`/`modifiedFiles` extraction over a span (for the note's state ledger).
- `estimateTokens(messages, model?)` — character/structure-based estimate with a confidence flag.

## 3. Data flow

### 3.1 A rewind, step by step

```
1. Agent decides its last tool-call group was a mistake.
2. Agent calls mulligan_rewind({
     note: { what_happened, true_current_state, next },
     granularity: "last_tool_call_group"
   }).
3. Tool:
   a. validates the note fields (all three MUST be non-empty — see @05-tools.md).
   b. resolves the target range NOW is not possible (the tool must not read the
      message list — see §2.1). Instead it records the granularity + a timestamp
      + a "turn index at call time" snapshot, and lets the FILTER resolve it
      against the live message list on the next inference.
   c. pi.appendEntry("mulligan:rewind", { id, granularity, note, excludeSelf,
      options, ts, sessionTurn })   ← control state, NOT in context
   d. pi.sendMessage({ customType:"mulligan:note",
        content: renderNote(note, ledger), display:true })   ← IN context
   e. returns { content:[{type:"text", text:"Rewound <granularity>. Note left. <N> messages will be hidden from your view from the next turn."}] }
4. Agent loop continues → next inference → `context` fires.
5. Filter:
   a. messages = event.messages (deep copy)
   b. markers = ctx.sessionManager.getEntries().filter(mulligan:*)
   c. for each rewind marker (oldest first): range = resolve*(messages, marker);
      messages = applyRewind(messages, range)   // pairing-aware
   d. for each shrink marker: messages = applyShrink(messages, ...)
   e. inject nudge if mulligan:turn-metric warrants
   f. return { messages }
6. Model sees [kept prefix] + [mulligan:note] + [rewind confirmation],
   continues the task — auto-prompt is the normal loop (C5).
```

**Why the tool defers resolution to the filter** (rather than resolving the range in the tool and storing absolute indices): absolute indices are **invalidated by compaction** (which renumbers/replaces the message list) and by other transforms. Storing a *spec* (`granularity` + `excludeSelf` + relative anchors) and resolving it fresh on each inference against the *current* message list is robust by construction. This is decision D7 made concrete.

### 3.2 A shrink, step by step

```
1. Agent identifies a specific past result it wants to compact (e.g. a huge read).
2. Agent calls mulligan_shrink({
     target: { match: "last_tool_result_of", toolName: "read" }  // or by content substring
     replacement: "Summarized: <agent-authored summary>"
   }).
3. Tool: pi.appendEntry("mulligan:shrink", { target, replacement, ts }).
4. Next inference → filter: messages = applyShrink(messages, target, replacement).
5. Model sees the compact replacement in place of the original from this turn on.
```

`mulligan_shrink` targets are **matcher-based**, not index-based, for the same compaction-robustness reason. Supported matchers: `{toolCallId}`, `{toolName, occurrence:"last"|"first"}`, `{contentIncludes: substring}`. See `@06-context-filter.md` §5.

### 3.3 The per-turn nudge, step by step (`@07-preventive-and-nudges.md`)

```
1. turn_end fires. Handler computes delta = estimateTokens(event? ) ...
   (turn_end does not receive messages; see §4 of this doc for the metric source.)
   Appends mulligan:turn-metric { deltaTokens, grewOverThreshold, bloatHit }.
2. Next inference → context filter: shouldNudge (windowed; @07 §5.1) fires on
   SUSTAINED total-context growth (windowed deltaTokens > driftThresholdTokens).
   bloatHit is NOT a firing condition when delta data exists (redundant with Nudge A;
   reserved for the no-delta fallback). Append a one-line annotation to the message
   copy: "[mulligan: last turn +4.2k tokens; rewind/shrink available]".
   (Rides the existing inference — zero extra requests.)
```

## 4. Where each piece of information lives

| Information | Stored as | In LLM context? | Lifetime |
|---|---|---|---|
| Rewind marker (spec + note + metadata) | `CustomEntry` via `pi.appendEntry("mulligan:rewind", …)` | **no** | permanent (until... nothing) |
| Shrink marker | `CustomEntry` `mulligan:shrink` | no | permanent |
| The note itself (what the resumed model reads) | `CustomMessage` via `pi.sendMessage({customType:"mulligan:note"})` | **yes** | permanent (it is a real message) |
| Checkpoint | `LabelEntry` via `pi.setLabel` | no | permanent |
| Turn metric (for nudge) | `CustomEntry` `mulligan:turn-metric` | no | ephemeral-in-effect: only the latest is read; old ones ignored (but persist on disk like all entries) |
| Filter transform results | nowhere (recomputed each inference) | — | per-inference |
| In-memory caches (token baseline, etc.) | module-scoped `Map<sessionId, …>` | — | per-session, reset on `session_start` |

**Why markers are `CustomEntry` and notes are `CustomMessage`:** control state must NOT pollute the model's context (a growing list of internal markers would itself be bloat); the note MUST be in context (the resumed model has to read it). Pi's two extension-persistence primitives map perfectly onto these two needs. (C1, C8.)

## 5. Ordering, composition, and idempotency

The filter applies transforms in a **fixed order** so behavior is deterministic regardless of how many markers accumulate:

1. **Resolve & apply rewinds** (oldest marker first). Each removal mutates the working array; later rewinds resolve against the already-reduced array. (Two rewinds compose: the second is resolved on the post-first-removal list.)
2. **Resolve & apply shrinks** (oldest first), on the post-rewind array.
3. **Inject nudge** (append one annotation message), on the post-transform array, only if the latest metric warrants.
4. Return the array.

**Idempotency:** every operation is idempotent w.r.t. re-firing. A rewind marker whose target range has already been removed (e.g. by an earlier rewind in the same pass, or because the span was compacted away) resolves to an empty range and is a no-op. A shrink whose target no longer matches is a no-op. This is essential because the filter runs every inference. (Verified spirit in the spike: the canary was re-dropped each fire.)

**Fail-open:** every stage is wrapped in try/catch; on any exception, log and return the input array unchanged. The model always gets a coherent message list.

## 6. Why this shape (rejected alternatives)

- **"Just mutate the session / branch the tree."** Impossible from a tool (C1, C2, C3). And unnecessary — view-filtering achieves the goal non-destructively with a free audit trail.
- **"Resolve the rewind range in the tool and store absolute indices."** Invalidated by compaction. Store a spec; resolve live. (D7.)
- **"Use `message_end`/`tool_result` to rewrite content for rewind."** Those only fire at production time and cannot retroactively rewrite past messages (C6). Retroactive changes are view-substitutions.
- **"Auto-summarize the abandoned span with a model call for the note."** Costs a request and *describes* rather than *redirects* (D2). The note is agent-authored and prescriptive; the file ledger is extracted deterministically.
- **"Add a human `/mulligan-rewind` command."** Redundant with `/tree`+`/compact`; adds surface for no novel value (D8).
- **"Make the nudge a separate reflection request."** Violates the zero-extra-requests principle (D4). The nudge rides the existing inference.
- **"Persist the filtered message list so the filter doesn't recompute."** Cannot (C1, C4); and recomputing is cheap and guarantees correctness against compaction. Embrace recompute.

## 7. Module layout (internal)

The extension entry (`index.ts`) wires the components; internal modules keep concerns separated and testable:

```
src/
  index.ts            // factory: registers tools + handlers, wires config
  config.ts           // load + validate settings; defaults
  markers.ts          // appendEntry/setLabel/sendMessage wrappers + id capture
  rewrite-budget.ts   // v2.1: per-session rewrite budget — queue-first submit, flush triggers, moment accounting, compaction rider
  runtime.ts          // per-session in-memory state (Map keyed by sessionId; reset on session_start)
  filter.ts           // the context handler + ordering + fail-open
  transforms.ts       // PURE: resolveRewind, resolveShrink, applyRewind, applyShrink, findToolCallPairs
  ledger.ts           // PURE: extractFileLedger (deterministic read/modified files)
  tokens.ts           // PURE: estimateTokens(messages, model?) + confidence
  notes.ts            // PURE: renderNote(note, ledger) + field validation
  tools/
    rewind.ts
    shrink.ts
    checkpoint.ts
    audit.ts
  nudges.ts           // tool_result annotator + turn_end metric + context nudge injection
  log.ts              // structured file logger (testability)
```

Everything under `transforms.ts`/`ledger.ts`/`tokens.ts`/`notes.ts` is **pure and unit-testable without Pi**. The Pi-coupled files (`markers.ts`, `filter.ts`, `tools/*`, `nudges.ts`) are thin and exercised by the integration smoke tests.

## 8. Cross-references

- Exact schemas for every persisted shape → `@04-data-model.md`
- Tool contracts → `@05-tools.md`
- The filter algorithm in full → `@06-context-filter.md`
- Nudges in full → `@07-preventive-and-nudges.md`