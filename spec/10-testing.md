# 10 — Testing & verification

> Mulligan's correctness surface is **mostly pure functions** (transforms, ledger, tokens, notes, render). Those get fast unit tests with no Pi, no model, no session. The Pi-coupled glue (the `context` handler, the tools, the nudges) is verified by an integration smoke harness that drives real `pi -p` runs and asserts on a structured log + the session JSONL. This two-tier strategy mirrors the feasibility spike that already proved every primitive (`@reference/looper-smoke.proto.ts`).

---

## 1. Tier 1 — Unit tests (pure helpers, no Pi)

Target files: `transforms.ts`, `ledger.ts`, `tokens.ts`, `notes.ts`. Framework: any (Vitest/node:test). These are the bulk of correctness.

### 1.1 `partitionIntoUnits` (pairing)
- `[user, assistant(1 toolCall), result, assistant(text)]` → 3 units (the assistant+result is one toolGroup, the text assistant is plain, user is plain).
- Orphan result (no matching toolCall) → its own plain unit; never merged.
- Assistant with 3 toolCalls + 3 results → one toolGroup unit with 4 indices.
- **Invariant test:** for every toolGroup unit, every result index's `toolCallId` is in the assistant's toolCall ids, and vice versa.

### 1.2 `resolveLastToolCallGroup`
- Given `[u, a(call A), r(A), a(call B, big), r(B)]` with `excludeToolCallId = undefined` → returns the `a(B)+r(B)` unit.
- With `excludeToolCallId = B` → returns the `a(A)+r(A)` unit (skips the rewind's own).
- No toolGroup at all → `null`.

### 1.3 `resolveLastTurn`
- `[u0, a, r, u1, a, r]`, default → remove indices after `u1` (keep u1).
- `to_previous_prompt:true` → also remove `u1`.
- `u1` is the first user → `to_previous_prompt` refused by protected check.

### 1.4 `applyRewind`
- Removing a toolGroup unit keeps pairing intact (no orphan results/calls remain).
- Removing `last_turn` keeps the rewind's own unit + mulligan notes at the tail.
- Empty `remove` → input unchanged (idempotent).

### 1.5 `applyShrink`
- `by_tool_call_id` match → content replaced, `role/toolCallId/toolName/isError` preserved.
- No match → input unchanged (no-op).
- Two shrinks same target, seq order → last wins.

### 1.6 `extractFileLedger`
- A span with `read(path="a.ts")`, `edit(path="b.ts")`, `bash(command="git commit")`, `bash(command="ls")` → `readFiles:["a.ts"]`, `modifiedFiles:["b.ts"]`, `bashSideEffects:["git commit"]` (`ls` is read-only → omitted). De-dup + sort.
- Empty span → all lists empty.

### 1.7 `estimateTokens`
- Monotonic in input length; empty → 0; confidence flag present.
- A known string yields a stable estimate (snapshot test).

### 1.8 `renderNote` / field validation
- All four fields present → renders with ledger blocks; empty ledger lists → their blocks omitted.
- Any empty field → validation refuses (returns a structured error, not a rendered note).
- Snapshot tests for representative notes.

### 1.9 Pipeline composition (`filterPipeline`)
- Two rewinds compose to the example in `@06-context-filter.md` §11 (assert exact resulting index set).
- Rewind-then-shrink-on-removed-target → shrink no-ops.
- Protected message → rewind skipped + warn.

---

## 2. Tier 2 — Integration smoke harness (real `pi`)

Adapt `@reference/looper-smoke.proto.ts` (rename `looper_*` → `mulligan_*`, restructure into the Mulligan module layout). It registers the tools/handlers, logs structured JSONL to a temp file, and is driven by `pi -e ./dist/index.ts -p "..."` in known scenarios. Assertions read the log + the resulting session JSONL.

### 2.1 Required scenarios & pass criteria (mirror the spike)

| Scenario | How to drive | Pass criteria |
|---|---|---|
| **F-rewind-core** | inject a canary `CustomMessage` at `session_start`; prompt the agent to call `mulligan_rewind(granularity:"last_tool_call_group")` after a bloated tool call | `context.fire` log shows canary present then dropped on the next inference (`context.filter before:N after:N-1`); a second assistant message is produced (auto-prompt); session JSONL has `mulligan:rewind` + `mulligan:note` entries |
| **F-shrink-persist** | prompt agent to call a tool returning a large canary result, then `mulligan_shrink` it | next inference's filtered view shows the replacement; session JSONL toolResult is the original (shrink is a view-substitution, not a JSONL rewrite — **assert the original is still on disk and the substitution appears in the filtered cache**) |
| **F-shrink-preventive** | `tool_result` hook annotates a >8KB result | result content has the appended `[mulligan]` reminder; `turn-metric` records `bloatHit:true` |
| **F-nudge-drift** | a turn that grows >3k tokens | next inference's filtered view ends with a `mulligan:nudge` custom message (ephemeral; NOT in session JSONL) |
| **F-protected** | attempt `mulligan_rewind(granularity:"last_turn", to_previous_prompt:true)` when it's the first user message | tool returns refusal text; no marker created |
| **F-maxdepth** | create 5 rewinds, attempt a 6th | 6th refuses with depth message |
| **F-checkpoint** | `mulligan_checkpoint("x")`, then `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` | label entry exists; rewind hides back to the labeled point (assert filtered message count drops to prefix) |
| **F-failopen** | force an exception inside the filter (test hook) | handler returns pass-through; no turn break; error logged |
| **F-reload** | create a rewind, then re-open the session (`--session-id`) and run one more turn | filter still hides the canary (marker survived reload) |

### 2.2 Driving reliability
- Use a deterministic, instruction-following model if available; otherwise phrase prompts to force the tool call (the spike used `glm-5.2` successfully with explicit instructions). Provide a fallback "deterministic command" path (`/mulligan_smoke <scenario>`) that invokes the tools/handlers directly for scenarios that don't need model judgment (F-shrink-persist, F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload).
- Log every `context.fire` with `{ count, canaryPresent, notePresent, hasRewindMarker }` (as the spike did) — these are the primary assertions.

### 2.3 Session JSONL assertions
Use the parsing approach from the spike (`@reference/looper-smoke.proto.ts`): walk entries, assert on `type`/`customType`/`role`/`parentId`/content. Key invariants:
- `mulligan:rewind` and `mulligan:shrink` are `custom` entries (not `custom_message`) — i.e. not in context.
- `mulligan:note` is a `custom_message` (in context).
- `mulligan:nudge` is **never** persisted (it's constructed in the filter copy only) — assert zero `mulligan:nudge` entries on disk.
- Checkpoints are `label` entries with `mulligan:checkpoint:` prefix.

---

## 3. Property/invariant tests (optional, high-value)

- **Pairing invariant (property):** for any random message list and any sequence of rewind/shrink markers, the filtered output never contains an orphan `toolCall` or `toolResult`. Quickcheck-style.
- **Idempotency (property):** `filterPipeline(filterPipeline(m)) === filterPipeline(m)` for stable inputs.
- **Monotonic shrinkage:** applying a rewind never *increases* the message count.

---

## 4. Manual / TUI smoke
- Load in interactive mode: `pi -e ./dist/index.ts`. Trigger a big `read`, observe the bloat reminder; call `mulligan_audit`; call `mulligan_rewind`; confirm via `/tree` that hidden content is still visible (audit trail) while the model's behavior reflects the rewind.
- Verify `/reload` preserves markers.

## 5. Cross-references
- The proven harness to adapt → `@reference/looper-smoke.proto.ts`
- Behaviors under test → `@06-context-filter.md`, `@07-preventive-and-nudges.md`, `@08-edge-cases.md`