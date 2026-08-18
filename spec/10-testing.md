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
- `[u0, a, r, u1, a, r]` → remove indices after `u1` (keep `u1`; `last_turn` never wipes user input — v1.1 guardrail).

### 1.4 `applyRewind`
- Removing a toolGroup unit keeps pairing intact (no orphan results/calls remain).
- Removing `last_turn` keeps the rewind's own unit + mulligan notes at the tail.
- Empty `remove` → input unchanged (idempotent).

### 1.5 `applyShrink`
- `by_tool_call_id` match → content replaced, `role/toolCallId/toolName/isError` preserved.
- No match → input unchanged (no-op).
- Two shrinks same target, seq order → last wins; the `<context-shrunk>` stamp appears exactly once (never nested) regardless of how many shrinks re-target the same message.
- **Render-time stamp (`@06-context-filter.md` §5.1):** the rendered content is the raw `replacement` wrapped in `<context-shrunk>\n…\n</context-shrunk>`; the marker's stored `replacement` stays RAW (assert `marker.replacement === "[shrunk]"` after `applyShrink` — the stamp is render-only, never persisted/mutated onto the marker).

### 1.6 `extractFileLedger`
- A span with `read(path="a.ts")`, `edit(path="b.ts")`, `bash(command="git commit")`, `bash(command="ls")` → `readFiles:["a.ts"]`, `modifiedFiles:["b.ts"]`, `bashSideEffects:["git commit"]` (`ls` is read-only → omitted). De-dup + sort.
- Empty span → all lists empty.

### 1.7 `estimateTokens`
- Monotonic in input length; empty → 0; confidence flag present.
- A known string yields a stable estimate (snapshot test).

### 1.8 `renderNote` / field validation
- All three fields present → renders with ledger blocks; empty ledger lists → their blocks omitted.
- Any empty field → validation refuses (returns a structured error, not a rendered note).
- Snapshot tests for representative notes.

### 1.9 Pipeline composition (`filterPipeline`)
- Two rewinds compose to the example in `@06-context-filter.md` §11 (assert exact resulting index set).
- Rewind-then-shrink-on-removed-target → shrink no-ops.
- Protected message → rewind skipped + warn.
- **Legacy-gate regression (`turnHasAdvanced`; `test/bug-replay-repro.test.ts`):** a marker with **no** `hideEntryIds` resolves on the creating/resume fire but **no-ops once the turn has advanced** past the rewind's own toolGroup — assert a legacy `last_tool_call_group`/`last_turn` marker hides nothing on the continuation fire after new work is appended (the turn-replay bug, `FIX_TURN_REPLAY_LOOP.md`). A **pinned** marker (with `hideEntryIds`) is unaffected and keeps hiding its span across continuation fires; assert it does NOT replay under compaction either (pinned → `[]`, a leak).
- **`diag` sink:** passing an optional 5th `diag` argument to `filterPipeline` collects `{seq, mode, remove, resolvedLen}` per rewind; assert it WARNs when any rewind's `max(remove) >= resolvedLen-3` (the replay signature). The full suite stays green when `diag` is omitted (opt-in, pure — no Pi).

### 1.10 Retry-cap & context-fraction guards (E22)
- `maxRetriesPerPrompt: 3`, 3 consecutive `last_turn` rewinds re-landing at the same prompt → the 4th is refused with the budget reason and persists nothing.
- A zero-hide rewind (`nothing matched to hide`) still increments the per-prompt counter.
- A `last_tool_call_group`/`checkpoint` rewind whose resolved target is at/after the latest user message counts toward the budget.
- A new user message resets the counter; the next rewind succeeds.
- `mulligan_shrink`/`mulligan_audit`/`mulligan_cancel` remain callable after the budget is hit. (v1.1: `mulligan_checkpoint` is no longer an agent tool — it is a human command, unaffected by the agent retry budget.)
- A rewind requested while filtered context ≥ `abortContextFraction` of the window is refused even if the budget remains.
- All refusals return a reason and never throw (E13), and never block a normal text reply.

### 1.11 Cancel target resolution (E21, target-based)
- `by_tool_call_id` hint → retires the uuid of the (single) marker whose matched message / `hideEntryIds` carries that id.
- `by_tool_name:"read", occurrence:"last"` → retires the most-recent active shrink or rewind whose covered span includes the last `read` result.
- `by_content_includes:"<substr>"` → retires the most-recent active marker covering a message whose text contains the substring.
- Several markers cover the match → **most recent by `seq`** is retired (LIFO); the rest stay active.
- No active marker covers the match → safe no-op (`cancelled:false`); nothing appended.
- Explicit `markerId` fallback → retires that exact marker; unknown id → safe no-op.
- After a successful cancel, the next `context` fire shows the originally-hidden/shrunk content verbatim (E21 (b)); the retired marker stays on disk.

---

## 2. Tier 2 — Integration smoke harness (real `pi`)

Adapt `@reference/looper-smoke.proto.ts` (rename `looper_*` → `mulligan_*`, restructure into the Mulligan module layout). It registers the tools/handlers, logs structured JSONL to a temp file, and is driven by `pi -e ./dist/index.ts -p "..."` in known scenarios. Assertions read the log + the resulting session JSONL.

### 2.1 Required scenarios & pass criteria (mirror the spike)

| Scenario | How to drive | Pass criteria |
|---|---|---|
| **F-rewind-core** | inject a canary `CustomMessage` at `session_start`; prompt the agent to call `mulligan_rewind(granularity:"last_tool_call_group")` after a bloated tool call | `context.fire` log shows canary present then dropped on the next inference (`context.filter before:N after:N-1`); a second assistant message is produced (auto-prompt); session JSONL has `mulligan:rewind` + `mulligan:note` entries |
| **F-shrink-persist** | prompt agent to call a tool returning a large canary result, then `mulligan_shrink` it | next inference's filtered view shows the replacement; session JSONL toolResult is the original (shrink is a view-substitution, not a JSONL rewrite — **assert the original is still on disk and the substitution appears in the filtered cache**) |
| **F-shrink-preventive** | `tool_result` hook annotates a >16KB result | result content has the appended bloat reminder ("~… KB added to your context…"); `turn-metric` records `bloatHit:true` |
| **F-nudge-drift** | sustained growth: 3 consecutive turns each adding ~4k tokens | after the 3rd turn the next inference's filtered view ends with a `mulligan:nudge` custom message (ephemeral; NOT in session JSONL). Negatives MUST also pass: a single ~8k-token turn amid small turns does NOT fire, and a single >threshold result with ~0 net growth does NOT fire the drift nudge (it only triggers Nudge A); and a turn that produces a >threshold result AND shrinks/rewinds it in the same turn does NOT fire the drift nudge next turn (§5.3 — Nudge A and B are non-overlapping) |
| **F-protected** | attempt a `checkpoint` rewind whose scope would reach the first user message | tool refuses / filter no-ops (`protectedOk` blocks `min(remove) <= iFirstUser`); the original task is never hidden |
| **F-maxdepth** | create 5 rewinds, attempt a 6th | 6th refuses with depth message |
| **F-checkpoint** | `mulligan_checkpoint("x")`, then `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` | label entry exists; rewind hides back to the labeled point (assert filtered message count drops to prefix); **checkpoint is consumed on use — `mulligan_audit` no longer lists it active and a second rewind to `"x"` refuses (not found) unless re-created (spec/05 §3 step 5)** |
| **F-cancel** | create a `mulligan_shrink`, then `mulligan_cancel({target:{by_tool_name:"read", occurrence:"last"}})` | next `context` fire the originally-shrunk message reappears verbatim in the filtered view; session JSONL has both `mulligan:shrink` and `mulligan:cancel` entries (shrink is skipped, not deleted) |
| **F-failopen** | force an exception inside the filter (test hook) | handler returns pass-through; no turn break; error logged |
| **F-reload** | create a rewind, then re-open the session (`--session-id`) and run one more turn | filter still hides the canary (marker survived reload) |
| **F-retrycap** | `maxRetriesPerPrompt: 2`; drive repeated `last_turn` rewinds at the same prompt | the 3rd rewind is refused with the budget text and persists nothing; a fresh user prompt restores the budget |
| **F-abortfraction** | force filtered context ≥ `abortContextFraction`, then request a rewind | rewind refused with the context-fraction text even though budget remains; shrink/audit still callable |
| **F-consent** (v1.1) | set a user checkpoint, send 2 more prompts, then agent `mulligan_rewind(granularity:"checkpoint")` | rewind succeeds and hides both subsequent user prompts (the user opted in by setting the checkpoint); `first:user` is never hidden. `last_turn`/`last_tool_call_group` never hide a `user` message (guardrail) |
| **F-ckptcmd** (v1.1) | `/mulligan_checkpoint x`; `/mulligan_checkpoint_revoke x` | a `mulligan:checkpoint:x` label is set on the leaf (no extra control entry — checkpoints are user-owned by construction); on revoke the label clears; the agent `mulligan_checkpoint` tool does NOT exist |
| **F-banner** (v1.1) | `/mulligan_checkpoint x` then several turns | `ctx.ui.setWidget("mulligan:active-checkpoint", …, {placement:"aboveEditor"})` is set and persists; clears within one `context` fire after revoke or consumption; restored on `/resume`; never injected into `event.messages` (assert 0 banner bytes in the filtered view) |
| **F-useraudit** (v1.1) | `/mulligan_audit` (human) vs `mulligan_audit` (agent) | both render the same report via `renderAuditReport`; the command's output goes to the human/transcript and is NOT in `event.messages`; the tool result still reaches the model |
| **F-drift-userexempt** (v1.1) | user pastes a ~50k-token doc; agent does ~0 work | the drift nudge does NOT fire (user content excluded from the agent-attributable delta); the high-water signal (§5.2) DOES fire on total context. Contrast: 3 turns of agent reads ~4k each DO fire the drift nudge |
| **F-revert-git** (v1.2) | in a temp git repo, mutate via `write`+`edit`+bash `sed -i`, then `mulligan_rewind(granularity:"last_turn", revert_file_changes:true)` | files match their pre-span content (incl. the `sed`-edited file — bash file changes ARE reverted); the user's `.git` is byte-identical (no new objects, no reflog/stash entry); the shadow repo holds a protected ref that `retire()` clears; marker carries `revert.revertedFiles` |
| **F-revert-cas** (v1.2) | same mutation in a NON-git dir | CAS restore matches pre-span content; `revert.backend==="cas"` |
| **F-revert-failopen** (v1.2) | lock/chmod one target file, then revert | rewind still succeeds; the locked file is in `revert.failedFiles`; the rest reverted |
| **F-revert-delete** (v1.2) | span creates a new file; rewind with `delete_created_files` under `allowDeleteCreatedFiles:false`, then under `:true` | deletion REFUSED when the config gate is off (even with the flag set); file deleted only when both are on |
| **F-revert-granularity** (v1.2) | rewind `last_tool_call_group` with `revert_file_changes:true` | file revert IGNORED + the mismatch notice returned; the context rewind still happens |
| **F-revert-dirtyguard** (v1.2) | after `agent_end`, edit one target file externally, then rewind with `revert_file_changes:true` | file-revert REFUSED: the drifted path is in `revert.refusedFiles`; the context rewind still happens; the file is NOT overwritten |
| **F-revert-explicit** (v1.2) | `nonGitMode:"explicit-paths"`; mutate via `write`/`edit` AND bash `sed`, then revert | write/edit files reverted; the bash `sed` file NOT reverted (+ once-per-turn warning); `revert.backend==="cas"` |
| **F-revert-reload** (v1.2) | rewind with revert, then `/resume` and rewind-to-checkpoint | persisted refs still honored; files restored post-reload (E32 resolved) |
| **F-revert-selfheal** (v1.2) | two backends in one cwd (sibling sessions); the sibling's `destroy()` deletes the shared shadow repo; the survivor captures again | the next capture **self-heals** (re-runs `git init --bare`, resets the commit chain) instead of failing `fatal: not a git repository` forever; a restore against the re-seeded snapshot still reverts files |

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