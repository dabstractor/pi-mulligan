# Spec & Test Analysis: pi-mulligan Rewind Hiding Bug

Analysis of spec assumptions and test patterns for the "rewind is not permanent" bugfix plan.
All line numbers are exact. Code snippets are verbatim unless noted.

---

## KEY QUESTION 1: What does spec/06 §11 claim about idempotency, and why is it wrong within a turn?

### The claim (spec/06-context-filter.md line 232)

> "Idempotency: re-firing the filter on the same session reproduces the same result (markers resolve against the same session each time until the session changes). No double-removal because removed messages are absent from subsequent passes within the same fire, and across fires **the session is unchanged between user prompts**."

### Why it is wrong (severity: critical — root cause of BUG-001/BUG-002)

The bolded clause — "the session is unchanged between user prompts" — is **FALSE within a turn**. Between context fires inside a single turn, Pi appends new entries to the session every time the agent calls a tool (or produces any message). The session GROWS between fires, not just between user prompts.

The consequence: the filter's relative resolvers are **position-based, not identity-based**. They re-resolve against the *current* (grown) message list on every fire:

- `resolveLastToolCallGroup` (src/transforms.ts:223) walks units end→start and returns "the most recent non-excluded toolGroup" — a **moving target**. After the agent does new work post-rewind, the newest toolGroup is the new (legitimate) work, not the original mistake.
- `resolveLastTurn` (src/transforms.ts:319) finds the last `role:"user"` message and removes everything after it — but new "redo" work produced after the rewind is also after the last user message, so it gets hidden too.

**Concrete failure (BUG-001):**
1. Agent calls bloated `grep` → `[u, asst(grep), result(grep), asst(rewind), result(rewind)]`
2. Agent calls `mulligan_rewind(last_tool_call_group)` → marker persisted. `excludeToolCallId = "rewind call"`.
3. Next context fire: `resolveLastToolCallGroup` → last non-excluded toolGroup = `grep`. Removes grep. ✓ Correct.
4. Agent does "redo" work: calls `read()`. Messages grow: `[u, asst(grep), result(grep), asst(rewind), result(rewind), asst(read), result(read)]`
5. Next context fire: `resolveLastToolCallGroup` → last non-excluded toolGroup = **`read`** (the new work!). Removes `read`. The **grep leaks back into view.** ✗

**The §11 example is also an erratum** (documented in `plan/001_2e5baf25fe9f/P1M3T5S1/research/verification.md` §3). The spec's two-rewind narrative (lines 218-234) claims rewind#1 removes a2/r2 and rewind#2 removes a1/r1. But applying the live §3 rule mechanically, rewind#1 (excluding res3's call) would actually resolve to `{a4,res4}[8,9]` (the most recent non-own toolGroup) — not a2/r2. The exclude-own-call mechanic is fundamentally **single-rewind**; multiple `last_tool_call_group` markers interfere.

### The flawed assumption chain

| Spec claim | Reality |
|---|---|
| "markers resolve against the same session each time" | Session **grows** between context fires within a turn |
| "the session is unchanged between user prompts" | Tools append entries; the `context` event fires before *every* LLM call |
| "removed messages are absent from subsequent passes" | True only within ONE pipeline pass; across fires, Pi provides the **full** original session each time |
| Relative specs (`last_tool_call_group`, `last_turn`) are stable | They are positional; the "last" shifts as new work is appended |

---

## KEY QUESTION 2: What is the RewindMarker data structure? Could a "pinned entry ids" field be added?

### RewindMarker (spec/04-data-model.md §3, lines 109-140; implemented at src/markers.ts:54-69)

```ts
interface RewindMarker extends MulliganEnvelope {
  schema: "pi-mulligan";
  v: 1;
  kind: "rewind";
  id: string;                 // uuid; correlates with the mulligan:note
  granularity: "last_tool_call_group" | "last_turn";  // spec lists 2; code adds "checkpoint" (GOTCHA #1)
  options: {
    to_previous_prompt?: boolean;   // last_turn only
    protect?: string[];             // role list (default from config)
  };
  excludeToolCallId?: string;  // THIS rewind's own toolCallId — lets filter skip its own group
  seq: number;                 // monotonic per-session counter (for stableSortBySeq ordering)
  note: NoteInput;             // structured note (duplicated from the mulligan:note message)
  ledger: FileLedger;          // extracted file ledger for the hidden span
  ts: number;                  // Date.now() at append
}
```

**There is NO "pinned entry ids" or "target snapshot" field.** The marker stores only a *relative* spec (`granularity`) + the rewind's own `excludeToolCallId`. The filter re-resolves the target every fire.

### Could a "pinned" field be added? YES — and the infrastructure already exists.

The rewind tool's `resolvePreview` function (src/tools/rewind.ts:271-308) **already resolves the target at marker-creation time** against a `buildContextEntries()` snapshot:

```ts
// src/tools/rewind.ts:283-298 (resolvePreview)
let remove: number[];
if (params.granularity === "last_tool_call_group") {
  const units = partitionIntoUnits(messages);
  remove = resolveLastToolCallGroup(units, messages, toolCallId) ?? [];
} else if (params.granularity === "last_turn") {
  remove = resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove;
} else {
  const branchEntries = ctx.sessionManager.getBranch() as BranchEntry[];
  remove = resolveCheckpoint(messages, branchEntries, params.checkpoint ?? "", toolCallId)?.remove ?? [];
}
const ledger = extractFileLedger(messages, remove);  // <-- the `remove` indices ARE available here
```

The `remove` index set is computed but used only for the advisory K preview and ledger — it is **not persisted**. A fix would:

1. **Add a field** to `RewindMarker` / `RewindMarkerInput`:
   - `pinnedToolCallIds?: string[]` — the toolCall ids of the assistant message(s) in the resolved unit (for `last_tool_call_group`). These are **stable across compaction** (toolCallId is a Pi-internal id, not a message index).
   - Or `pinnedRemoveEntryIds?: string[]` — the session entry ids of the messages to hide (stable across fires).

2. **Capture at creation time** in `resolvePreview` or a sibling: when the tool resolves the target, snapshot the resolved toolCallIds (extractable from `messages[remove]` — each assistant message's toolCall blocks carry `.id`).

3. **Prefer pinned over relative** in `filterPipeline`: if `pinnedToolCallIds` is present and non-empty, resolve by finding the unit(s) whose assistant issued those exact ids (identity-based, not position-based). Fall back to the relative spec only if pinned is absent (backward compat with old markers).

4. **The spread already preserves extra fields.** `appendRewindMarker` does `{...data, schema, v:1, kind, id, seq, ts}` (src/markers.ts:163-170). The `checkpoint` field already rides this mechanism (GOTCHA #1 — it's not in the frozen type but IS persisted at runtime). A `pinnedToolCallIds` field would work identically.

### Constraint: transforms.ts must stay Pi-free (0 imports)

`RewindMarkerLike` (src/transforms.ts:790-807) is a **local structural type** declared so transforms.ts can stay Pi-free (`grep -c '^import' → 0`). Any new pinned field must be added to `RewindMarkerLike` there too, read defensively via `readOwn`.

---

## KEY QUESTION 3: What test patterns exist for simulating multi-fire scenarios?

### Answer: There are NONE that simulate "rewind → more work → re-fire."

This is the **critical test gap** that let the bug ship.

### How filterPipeline and resolvers ARE tested (test/transforms.test.ts)

**Fixture builders** (lines 25-58):
- `asst(...callIds)` → assistant message with toolCall blocks (each `{type:"toolCall", id, name:"tool", arguments:{}}`)
- `asstText(text)` → text-only assistant (plain unit)
- `result(toolCallId)` → toolResult message (`{role:"toolResult", toolCallId, toolName:"tool", content:[{type:"text",text:"..."}], isError:false}`)
- `user(text)` → user message
- `custom(customType)` → custom message (e.g. `mulligan:note`)
- `entry(id, type, extra)` / `labelEntry(id, targetId, name)` → BranchEntry fixtures for checkpoint tests

**filterPipeline composition tests** (lines 1213-1366):
- "two rewinds compose" (line 1214): two markers with the **same** `excludeToolCallId:"cR1"` — rewind#1 removes the mistake, rewind#2 re-resolves against the reduced array and no-ops (no non-excluded group remains). The test comment explicitly calls spec/06 §11 an erratum: "The exclude-own-call mechanic is single-rewind; see GOTCHA #3 for why spec/06 §11's 'two distinct removals' narrative is an erratum."
- "rewind-then-shrink-on-removed-target" (line 1236): shrink no-ops because the rewind already removed its target.
- "protected message → rewind skipped" (line 1256): last_turn nuclear on a single-user session → resolver refuses.
- "checkpoint rewind through the pipeline" (line 1316): removes everything after the checkpoint point.

**Property tests** (lines 1369-1497):
- "pairing invariant" (line 1422): 300 seeded iterations, random rewinds → no orphan toolCall/toolResult.
- "monotonic shrinkage" (line 1440): 300 iterations → `out.length <= msgs.length`.
- **"idempotency (shrinks)"** (line 1456): `filterPipeline(filterPipeline(m)) === filterPipeline(m)` — but ONLY for shrinks. The comment explicitly says: "The general filterPipeline∘filterPipeline property does NOT hold for multi-group last_tool_call_group rewinds under live re-resolution (GOTCHA #8); this test exercises the shrink path where it always holds."
- **"determinism"** (line 1478): `filterPipeline(msgs, markers, cfg)` called **twice with the SAME msgs** → identical output. Comment: "The spec's idempotency guarantee is 're-firing on the same session reproduces the same result' = DETERMINISM (same input → same output). This ALWAYS holds for the pure pipeline."

### What is NOT tested (the gap)

No test anywhere in the suite does:
1. Build messages with a toolGroup X.
2. Create a rewind marker targeting X.
3. Run `filterPipeline(msgs, markers, cfg)` → assert X is removed. ✓
4. **Append** new messages (toolGroup Y) to `msgs` — simulating work after the rewind.
5. Run `filterPipeline(grownMsgs, markers, cfg)` again.
6. Assert X is **still** removed (permanent hiding) and Y is **present** (new work not accidentally hidden).

This is precisely the scenario that exposes the bug. The determinism test (line 1478) tests same-input twice; it does NOT test grown-input. The idempotency test (line 1456) tests only shrinks. The composition test (line 1214) tests two markers but not message-list growth.

### How the tool tests work (test/tools/rewind.test.ts, checkpoint.test.ts)

**Pattern**: hand-rolled `makePi()` / `makeCtx()` fakes (NO `vi.fn()`), `clearAll()` + `setConfig(undefined)` in beforeEach/afterEach. The fakes script `appendEntry`, `sendMessage`, `setLabel`, `getEntries`, `getBranch`, `buildContextEntries`, `getLeafId`.

**rewind.test.ts** (test/tools/rewind.test.ts): Tests the tool's execute path — validation refusals, depth guard, the persisted marker contract (granularity, options, `excludeToolCallId === toolCallId`, note, ledger, K). The `resolvePreview` is called inside execute with a scripted `contextEntries` snapshot. **No test simulates the filter re-firing against a grown session after the marker is created** — the tool test stops at "marker persisted correctly."

**checkpoint.test.ts** (test/tools/checkpoint.test.ts): Tests name validation (regex boundaries), `setLabel` calls, no-leaf refusal, never-throws. **Does not test whether `resolveCheckpoint` actually hides anything** (that's in transforms.test.ts).

---

## KEY QUESTION 4: What do smoke tests assert vs what they SHOULD assert?

### F-rewind-core (test/integration/smoke.ts:149-163)

**What it does:**
```ts
case "F-rewind-core": {
  await rewindNow(pi, ctx, "smoke-rewind-1", "last_turn");
  break;
}
```
Creates a `last_turn` rewind marker via the REAL tool. The orchestrator's second `-p` prompt triggers one observing inference.

**What the context handler asserts** (smoke.ts:253-273): logs `{count, msgCanaryPresent, resultCanaryPresent, notePresent, hasRewindMarker, shrunkInContext, hasNudge}` on every fire.

**What it SHOULD assert but does NOT:**
- ❌ That the hidden content **stays hidden across subsequent fires** (permanent hiding — the core claim).
- ❌ That **new work** produced after the rewind **survives** (the BUG-001 symptom: new work gets hidden instead).
- ❌ Multi-fire stability: that `context.fire` count does not enter an **infinite loop** (the BUG-002 symptom: 29+ fires stuck at n=4).

The scenario comment even admits this: "The authoritative canary-drop proof is the MODEL-DRIVEN path (documented in scenarios.md)."

### F-checkpoint (test/integration/smoke.ts:227-243)

**What it does:**
```ts
case "F-checkpoint": {
  const cpTool = makeCheckpointTool(pi);
  await cpTool.execute("smoke-cp-1", { name: "alpha" }, ...);
  await rewindNow(pi, ctx, "smoke-cp-rw-1", "checkpoint", { checkpoint: "alpha" });
  break;
}
```

**What it SHOULD assert but does NOT:**
- ❌ That the checkpoint rewind **actually hides anything** (BUG-003: `setCheckpoint` labels `getLeafId()` which is a transient entry → `resolveCheckpoint` maps to the last message → `remove = []` → K=0). The tool reports "0 messages will be hidden" but no assertion catches this.
- ❌ That the checkpoint hiding is **permanent** across subsequent fires.

### What the smoke tests SHOULD assert (the missing invariants)

For a regression-guarding smoke test:

1. **Fire 1 (immediately after rewind):** `context.fire` shows the hidden content ABSENT (canary not present).
2. **Fire 2 (after new work):** `context.fire` shows the hidden content **still absent** AND the new work **present**.
3. **Fire N (many turns later):** `context.fire` still shows the hidden content absent — permanent hiding.
4. **No infinite loop:** `context.fire` count per turn is bounded (not 29+ fires).

---

## Files Retrieved

1. `spec/06-context-filter.md` (lines 46-266) — §2 pairing rule, §3-§6 resolvers, §11 idempotency claim (line 232), §12 filterPipeline pseudocode.
2. `spec/04-data-model.md` (lines 109-199) — §3 RewindMarker structure (lines 114-134), §6 Checkpoint (lines 189-199).
3. `test/transforms.test.ts` (full, 1497 lines) — fixture builders (25-58), filterPipeline composition tests (1213-1366), property tests (1369-1497). **No multi-fire/grown-input test exists.**
4. `test/tools/rewind.test.ts` (full) — hand-rolled fakes, marker contract assertions. No filter-re-fire test.
5. `test/tools/checkpoint.test.ts` (full) — name validation + setLabel assertions. No hiding-verification.
6. `test/integration/smoke.ts` (full) — F-rewind-core (149-163), F-checkpoint (227-243). Single-fire observation only; no permanent-hiding assertion.
7. `src/transforms.ts` (full, 1028 lines) — partitionIntoUnits@109, resolveLastToolCallGroup@223, resolveLastTurn@319, resolveCheckpoint@450, filterPipeline@969. Zero imports (Pi-free).
8. `src/markers.ts` (full, 339 lines) — RewindMarker@54, appendRewindMarker@157. The spread preserves extra fields.
9. `src/filter.ts` (full, 253 lines) — contextHandler; reads markers fresh each fire, delegates to filterPipeline.
10. `src/tools/rewind.ts` (lines 240-370) — resolvePreview@271 resolves the target at creation time (for K/ledger) but does NOT persist it.
11. `plan/001_2e5baf25fe9f/P1M3T5S1/research/verification.md` — §3 (§11 erratum proof), §4 (idempotency limitations).
12. `plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/system_context.md` — existing bug analysis (BUG-001/002/003).

## Key Code

### The flawed idempotency claim (spec/06:232)
```
re-firing the filter on the same session reproduces the same result ... across fires
the session is unchanged between user prompts.
```
**False**: tools append entries between fires within a turn.

### The re-resolution that causes the bug (src/transforms.ts:983-1010)
```ts
// filterPipeline: each rewind resolves against CURRENT m (grown list)
for (const rw of stableSortBySeq(rewinds)) {
  if (granularity === "last_tool_call_group") {
    const units = partitionIntoUnits(m);  // re-partition on grown m
    remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];  // "last" = NEWEST, not original
  }
  ...
}
```

### The available-but-unpersisted snapshot (src/tools/rewind.ts:283-298)
```ts
// resolvePreview: resolves target at creation time — the `remove` indices ARE available
remove = resolveLastToolCallGroup(units, messages, toolCallId) ?? [];
const ledger = extractFileLedger(messages, remove);  // remove used for ledger/K only, NOT persisted
```

## Architecture

```
Agent calls mulligan_rewind
  → tools/rewind.ts::resolvePreview()   [resolves target NOW for K preview — discarded after]
  → markers.ts::appendRewindMarker()    [persists RELATIVE spec: granularity + excludeToolCallId]
  → markers.ts::leaveNote()             [sends mulligan:note]

Every context fire (filter.ts::contextHandler)
  → readMarkers()                       [reads ALL markers fresh]
  → filterPipeline(messages, markers)   [re-resolves RELATIVE spec against GROWN messages]
    → resolveLastToolCallGroup          ["last" = newest toolGroup = WRONG target after growth]
    → resolveLastTurn                   ["last user" → new work after it gets hidden = WRONG]
  → BUG: hidden content leaks back; new work gets hidden
```

## Start Here

Open `src/transforms.ts:983` (the `filterPipeline` rewind loop) to see the re-resolution. Then open `src/tools/rewind.ts:271` (`resolvePreview`) to see that the target IS already resolved at creation time but not persisted. The fix path is: capture the resolved toolCall ids in the marker at creation time, then have `filterPipeline` prefer those pinned ids over relative resolution.

---

## Residual Risks

1. **Backward compatibility**: Old markers (pre-fix) lack a pinned field → filter must fall back to relative resolution for them. This means old markers in existing sessions still exhibit the bug until the agent re-issues the rewind.
2. **Compaction interaction**: toolCall ids are stable across compaction (per spec/06 §10), but pinned session-entry ids may not be. If the fix uses entry ids, compaction remapping must be verified.
3. **Checkpoint granularity (BUG-003)**: The `getLeafId()` transient-entry problem is a separate root cause that a pinned-ids fix for relative granularities does NOT address. A checkpoint fix needs `setCheckpoint` to label the correct entry.
4. **Parallel-tool mode**: If the pinned toolCall ids belong to an assistant message shared with sibling calls, the filter must still keep the rewind's own unit whole (spec/06 §9). Pinned resolution must account for this.
5. **Test infrastructure**: No existing test harness simulates "rewind → more work → re-fire." The bugfix must add this pattern (pure unit test in transforms.test.ts is sufficient — no Pi integration needed since filterPipeline is pure).