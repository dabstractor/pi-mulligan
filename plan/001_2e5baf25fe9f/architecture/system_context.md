# System Context — pi-mulligan

## 1. Project Overview

**pi-mulligan** is a Pi coding-agent extension that gives an LLM agent autonomous,
token-cheap control over its own context window. The agent can shed context it
produced by mistake (bloated tool output, wrong-direction work) and "redo" a turn
with a self-authored note — without a human in the loop, and without spending
extra model requests.

**Core insight (empirically proven):** Pi's conversation is an append-only tree
that an agent *cannot* structurally mutate from a tool, but the agent *can* drop
persisted "view instructions" that the `context` event honors on every subsequent
inference. A rewind is a **permanent soft-delete**: a persisted instruction that
hides a span of messages from every future copy sent to the model, while the
originals remain on disk and visible in `/tree` as an audit trail.

## 2. Current Repository State

- **Greenfield project** — no source code exists yet.
- The `spec/` directory contains a complete 12-document specification plus two
  proven reference artifacts (HANDOFF.md + looper-smoke.proto.ts).
- A `plan/` directory exists for orchestration output.
- No `package.json`, `tsconfig.json`, or `src/` directory yet.

## 3. Verified Architecture (One Mechanism, Two Operations, Two Nudges)

### 3.1 The Single Mechanism: Marker-Driven Context Filter

```
agent calls mulligan_rewind(note, granularity)
   │
   ├─ pi.appendEntry("mulligan:rewind", { spec, noteRef, ts })   ← control state (NOT in context)
   ├─ pi.sendMessage({ customType:"mulligan:note", content })     ← the note (IN context)
   └─ tool returns a short confirmation

agent loop continues → next inference fires the `context` event
   │
   └─ context handler:
        1. read event.messages (deep copy of the active branch)
        2. read all mulligan:* markers from ctx.sessionManager.getEntries()
        3. resolve each marker's spec against event.messages
           (rewind → remove a span;  shrink → replace a message's content)
        4. return { messages: transformed }
   │
   └─ model sees [kept prefix] + [note] + [rewind confirmation],
      resumes work — auto-prompt is just the normal agent loop
```

### 3.2 The Two Operations
1. **Rewind** — hide recent context (last tool-call group or last full turn) + leave a note.
2. **Shrink** — replace a specific past tool result's content with a compact summary in the view.

### 3.3 The Two Nudges (zero extra model requests)
1. **Bloated-result reminder** — `tool_result` hook appends a reminder when output exceeds threshold.
2. **Per-turn drift nudge** — `turn_end` records metric; next `context` fire injects one-line annotation.

## 4. Module Layout (from spec §03 §7 and §11)

```
src/
  index.ts            // factory: registers tools + handlers, wires config
  config.ts           // load + validate settings; defaults
  log.ts              // structured file logger (testability)
  runtime.ts          // per-session runtime map (seq, baseline, lastFiltered)
  markers.ts          // appendEntry/setLabel/sendMessage wrappers + id capture
  filter.ts           // the context handler (thin glue) + pipeline ordering + fail-open
  transforms.ts       // PURE: partitionIntoUnits, resolve*, applyRewind, applyShrink, filterPipeline
  ledger.ts           // PURE: extractFileLedger (deterministic read/modified files)
  tokens.ts           // PURE: estimateTokens, resultBytes, approxTokens
  notes.ts            // PURE: validateNote, renderNote, renderBloatReminder, renderDriftNudge
  nudges.ts           // tool_result annotator + turn_end metric + shouldNudge/injectNudge
  tools/
    rewind.ts
    shrink.ts
    checkpoint.ts
    audit.ts
test/
  transforms.test.ts
  ledger.test.ts
  tokens.test.ts
  notes.test.ts
  pipeline.test.ts
  integration/
    smoke.ts
    scenarios.md
```

### Critical Separation: Pure vs. Pi-Coupled

**Pure (no Pi dependency, fully unit-testable):**
- `transforms.ts` — partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn,
  resolveCheckpoint, applyRewind, applyShrink, filterPipeline, protectedOk
- `ledger.ts` — extractFileLedger
- `tokens.ts` — estimateTokens, resultBytes, approxTokens
- `notes.ts` — validateNote, renderNote, renderBloatReminder, renderDriftNudge

**Pi-Coupled (thin glue, integration-tested):**
- `config.ts` — getConfig(), validation
- `log.ts` — structured JSONL logger
- `runtime.ts` — per-session runtime map
- `markers.ts` — pi.appendEntry/setLabel/sendMessage wrappers
- `filter.ts` — context event handler
- `nudges.ts` — tool_result + turn_end + context nudge injection
- `tools/*` — four agent-callable tools
- `index.ts` — factory wiring

## 5. Key Architectural Decisions (Decision Log)

| # | Decision | Rationale |
|---|---|---|
| D1 | Soft retry only; no hard replay | Hidden tool calls' side effects persist on disk; replay compounds them |
| D2 | Agent-authored structured note + deterministic file ledger; no model summarizer | Summarizer *describes*; we need to *redirect* |
| D3 | Advisory preventive reminders (not auto-shrink) | Auto-shrink risks discarding data the model needs |
| D4 | Per-turn nudge via context-event annotation | Zero extra requests — the project's central constraint |
| D5 | Audit tokens computed from filtered view, not getContextUsage() | getContextUsage() counts hidden tokens (bookkeeping drift) |
| D6 | No undo; agent rewinds are permanent | Simplicity; /tree already serves human recovery |
| D7 | Relative targeting for granularities (spec-based, not index-based) | Robust across compaction (which renumbers entries) |
| D8 | No human command; no session-tree mutation | Redundant with Pi's built-in /tree, /compact, /fork |

## 6. Data Model Summary

All persisted shapes use a versioned envelope: `{ schema: "pi-mulligan", v: 1, kind: "..." }`

| Pi customType | Pi entry type | In LLM context? | Purpose |
|---|---|---|---|
| `mulligan:rewind` | `custom` | no | Rewind marker (spec + note metadata) |
| `mulligan:shrink` | `custom` | no | Shrink marker (target + replacement) |
| `mulligan:turn-metric` | `custom` | no | Drift nudge telemetry |
| `mulligan:note` | `custom_message` | **yes** | The note the resumed model reads |
| (checkpoint) | `label` | no | Named bookmark for checkpoint rewind |

## 7. Testing Strategy (Two Tiers)

**Tier 1 — Unit tests (pure helpers, no Pi):**
- transforms.ts: partitionIntoUnits, resolve*, applyRewind, applyShrink, filterPipeline
- ledger.ts: extractFileLedger
- tokens.ts: estimateTokens, resultBytes
- notes.ts: validateNote, renderNote
- Pipeline composition, pairing invariant, idempotency

**Tier 2 — Integration smoke harness (real `pi -p`):**
- F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift,
  F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload
- Driven by `pi -e ./src/index.ts -p "..."`, assertions read log + session JSONL

## 8. Key Dependencies

- `@earendil-works/pi-coding-agent` — types + runtime (resolved by Pi at load)
- `typebox` — schema definitions for tool parameters
- `vitest` (dev) — unit test framework
- Node.js built-ins (`node:fs`)

## 9. Version Target

Pi `0.84.x` (spec verified against this version). The installed version at
`/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/` was used
for type verification.