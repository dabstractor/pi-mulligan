# PRP — P1.M7.T3.S1: Implement targeted tests and fixes for edge cases E1–E20

**Work item:** P1.M7.T3.S1 · **Points:** 2 · **Stage:** Integration, Hardening & Documentation (spec/10-testing.md
is the testing spec; spec/08-edge-cases.md is the E1–E20 source of truth; spec §3 design principle #4 "Fail open").
**Scope:** CREATE `test/edge-cases.test.ts` (the consolidated cross-cutting E1–E20 unit suite), ADD edge-case
scenarios to the smoke harness produced by the **parallel** P1.M7.T2.S1 (`test/integration/smoke.ts`
`/mulligan_smoke` dispatch + `test/integration/run-smoke.mjs` assertions for E7/E11/E12/E15/E20), and apply ONE
small correctness **fix** (E14: gate the rewind/shrink tools on the master `config.enabled` switch). `src/` is
otherwise READ-ONLY — the implementation of every edge case is ALREADY COMPLETE; this task PROVES it and closes
one gap.

> **THIS IS THE EDGE-CASE VERIFICATION CAPSTONE.** spec/08-edge-cases.md is the "what about…" index: every
> foreseeable awkward situation and exactly how Mulligan handles it. The existing per-module tests
> (`transforms.test.ts`, `filter.test.ts`, `tools/*.test.ts`, …) already cover MANY cases individually, but they
> are organized BY MODULE. This task delivers the **single E1–E20-indexed suite** so a reviewer/maintainer can
> walk the whole index in one file and confirm each "what about…" is handled — plus it fills the gaps (E5, E6,
> E13 cross-cutting, E14 master-switch, E18 doc) and adds the Pi-dependent cases (E7/E11/E12/E15/E20) to the
> real-`pi` smoke harness.

---

## Goal

**Feature Goal**: Ship a single consolidated `test/edge-cases.test.ts` that walks spec/08's E1–E20 index in
order, each edge case named `describe("E1 — Orphaned toolResult", …)`, asserting the EXACT prescribed behavior
from the spec against the REAL (Complete) implementation — proving every "what about…" is handled, including
the cross-cutting fail-open invariant (E13) across ALL handlers + tools, the protected-message defense (E3),
and the master-disable no-op (E14). Plus: extend the parallel smoke harness with deterministic scenarios for
the 5 Pi-dependent cases (E7, E11, E12, E15, E20) that cannot be unit-tested. Plus: apply the E14 fix so the
master `config.enabled` switch also gates the agent-callable tools (closing the one real gap found in research).

**Deliverable** (3 artifacts — 2 new test files, 2 modified harness files, 1 small `src/` fix):
1. **`test/edge-cases.test.ts`** — NEW. A vitest suite with one `describe` block per testable edge case
   (E1–E6, E8–E10, E13, E14, E16–E19; E18 is a documentation test). Uses the ESTABLISHED house idiom: hand-rolled
   `makePi()`/`makeCtx()` fakes (NO `vi.fn` for Pi objects), `.js` import paths, `clearAll()`+`setConfig(undefined)`
   reset in `beforeEach`/`afterEach`, `vi.mock("../src/transforms.js", …)` ONLY where a forced throw is needed
   (mirrors `test/filter.test.ts`). 16 `describe` blocks; ~30–45 `it` cases.
2. **`test/integration/smoke.ts`** — MODIFIED (additions only; the file is CREATED by parallel P1.M7.T2.S1).
   Add E7/E11/E12/E15/E20 to the `driveScenario` dispatch in `/mulligan_smoke`. Add the assertions to
   `run-smoke.mjs`. (If P1.M7.T2.S1 is not yet landed, these additions are APPENDED to its scenarios list —
   they do not change its existing 9 F-* scenarios.)
3. **`src/tools/rewind.ts` + `src/tools/shrink.ts`** — MODIFIED (the E14 fix, ~1 line each): add
   `if (!config.enabled) return refusal("Mulligan is disabled", granularity)` (rewind) /
   `return refusal("Mulligan is disabled")` (shrink) as the FIRST config gate in `execute`, BEFORE the existing
   sub-feature check. No other `src/` change. (checkpoint has no config gate by design — labels are inert;
   audit is read-only advisory — neither needs the master gate; see "Why".)

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (edge-cases.test.ts type-checks; it's under `test/` → in
  tsconfig `include`). The E14 fix compiles clean.
- `npx vitest run test/edge-cases.test.ts` → **all green**, every E# describe block present and passing.
- `npx vitest run` (full suite) → **all green** (the E14 fix must not regress the existing disabled-config tool
  tests in `rewind.test.ts`/`shrink.test.ts` — update those 2 assertions to the new "Mulligan is disabled" text
  ONLY where they assert the master-switch path; the sub-feature path text "rewind is disabled"/"shrink is
  disabled" is UNCHANGED).
- The smoke harness (once P1.M7.T2.S1 lands) runs the E7/E11/E12/E15/E20 scenarios without crash; E7 is a
  documentation/log-only scenario (PASS-with-note is acceptable).

---

## User Persona

**Target User**: (a) **The Mulligan maintainer / future contributor** — gets ONE file that answers every "what
about…" a reviewer could raise, indexed exactly like spec/08, so hardening regressions are caught at the edge-case
boundary rather than the module boundary. (b) **The reviewer** — can open `test/edge-cases.test.ts`, read top to
bottom, and confirm each E1–E20 behavior holds without spelunking 6 module test files.

**Use Case**: Before a release, the maintainer runs `npx vitest run test/edge-cases.test.ts`. Green = the entire
spec/08 index is honored. A failure points straight at the edge case (e.g. "E6 — parallel tool mode … failed")
and the spec section to consult.

**Pain Points Addressed**: The per-module tests prove each function in isolation, but the spec's EDGE-CASE INDEX
is the review surface, and no single test file maps to it. E13 (fail-open) is asserted piecemeal across 4 files;
E14's master switch silently does NOT gate the tools (a real gap — config.enabled=false still lets the agent call
mulligan_rewind); E5/E6/E18 have thin coverage; the 5 Pi-dependent cases (E7/E11/E12/E15/E20) have no scenario
in the smoke harness at all.

---

## Why

- **spec/10 §1 + spec §8 verification strategy.** spec §8: "a deterministic command-based suite for the data
  layer, and model-driven integration runs that prove the `context`-filter takes effect." The pure tier is
  unit-tested; this task adds the cross-cutting + edge-index consolidation + the Pi-dependent smoke scenarios.
  spec/08 is literally subtitled "Implementers: read this before writing the filter. Reviewers: this is the
  'what about…' index." — `test/edge-cases.test.ts` IS that index made executable.
- **The fail-open invariant (E13, design principle #4) is the project's cardinal safety property.** "Mulligan
  must never be the reason an agent turn fails." It is currently asserted per-handler; this task adds a single
  CROSS-CUTTING suite that forces a throw in EACH handler + EACH tool and asserts no-throw — the one test that
  would catch a regression where a new code path forgets the try/catch.
- **E14 is a real gap.** Research confirmed: `config.ts` `getConfig()` sets `cfg.enabled` from raw.enabled but
  does NOT cascade to sub-features — `rewind.enabled`/`shrink.enabled` stay `true` (DEFAULT_CONFIG). So
  `setConfig({enabled:false})` makes the `context` handler + nudges pass-through (correct) BUT the tools still
  execute (rewind checks ONLY `config.rewind.enabled`). spec/08 E14 explicitly says "tools refuse with 'Mulligan
  is disabled.'" The 1-line fix per tool honors this. (The disabled-config tool tests in `rewind.test.ts`/
  `shrink.test.ts` set the SUB-feature flag, not the master — so they're unaffected except where they explicitly
  test `enabled:false`; verify + update those.)
- **The Pi-dependent cases need a real `pi`.** E11 (reload) needs `--session-id` across two processes; E12
  (getContextUsage undefined) needs a pre-first-inference state; E15 (50 markers) needs the raw marker wrapper to
  bypass the tool's depth guard; E20 (entry ordering) needs the real session JSONL. These can't be faked
  faithfully — they belong in the smoke harness (P1.M7.T2.S1's surface), so this task EXTENDS it.

---

## What

### Artifact 1 — `test/edge-cases.test.ts` (NEW, the consolidated E1–E20 unit suite)

A vitest file. Imports the REAL modules (NOT mocked) so it exercises the actual handling:
`transforms.js`, `notes.js`, `markers.js` (types), `filter.js` (`contextHandler`, `readMarkers`),
`nudges.js` (`bloatReminderHandler` via `registerBloatReminder`, `turnEndMetricHandler` via
`registerTurnEndMetric`), `tools/rewind.js` (`makeRewindTool`), `tools/shrink.js` (`makeShrinkTool`),
`tools/checkpoint.js` (`makeCheckpointTool`, `validCheckpointName`), `tools/audit.js` (`auditTool`),
`config.js` (`setConfig`), `runtime.js` (`clearAll`, `getRuntime`). Uses `vi.mock("../src/transforms.js", …)`
ONLY inside a SEPARATE `describe` for E13's forced-pipeline-throw case (the `filter.test.ts` pattern).

**Structure** — one `describe` per edge case, in spec/08 order. The fixture builders + fakes are COPIED from the
house idiom (`asst`/`result`/`user`/`custom` from `transforms.test.ts`; `makePi`/`makeCtx` from
`rewind.test.ts`/`filter.test.ts`). Each case asserts the spec/08 PRESCRIBED BEHAVIOR (not just "doesn't crash").
See "Implementation Tasks" for the per-case assertion list (the authoritative mapping is in
`research/edge-case-mapping.md`).

### Artifact 2 — smoke harness additions (E7, E11, E12, E15, E20)

APPEND to the `driveScenario` dispatch in `test/integration/smoke.ts` (the `/mulligan_smoke <scenario>` command
produced by P1.M7.T2.S1) and the `SCENARIOS`/assert functions in `test/integration/run-smoke.mjs`:

- **E7** (compaction leak, KNOWN LIMITATION): a scenario that creates a rewind, logs
  `"E7: known limitation — compaction may transiently reference hidden content (v1 accepted; mitigated by later
  compaction). Note survives."`, and asserts NO crash. PASS-with-note. (No code mitigation exists by design —
  v1 accepts it. This scenario documents + smoke-tests the no-crash property.)
- **E11** (reload mid-task): two `pi` runs sharing `--session-id smoke-E11`. Run-1 creates a rewind via
  `makeRewindTool(pi).execute(...)`. Run-2 just `sendUserMessage("ok",{deliverAs:"followUp"})`. Assert run-2's
  first `context.fire` has `hasRewindMarker:true` (marker survived reload) AND (soft) the first run-2
  turn-metric has `deltaTokens:null` (baseline lost → drift nudge falls back to bloat-only).
- **E12** (getContextUsage undefined): call `auditTool.execute(...)` + trigger one `turn_end` BEFORE any
  assistant message (a fresh `--session-id smoke-E12`, audit as the FIRST action). Assert: no crash; audit
  succeeds (E16 fallback path); a turn-metric is persisted.
- **E15** (50 markers): seed N=50 rewind markers via the RAW `appendRewindMarker(pi, ctx, …)` wrapper (NOT the
  tool — the tool's depth guard refuses the 6th). Then `sendUserMessage` followUp. Assert: `context.fire`
  returns (filter terminates, time-bounded <2s); no crash; message count did not increase (monotonic shrinkage).
  Log: `"E15: markers persist intentionally (audit trail); v1 does no GC."`
- **E20** (appendEntry/sendMessage ordering): call `mulligan_rewind` (via the tool), then read the session
  JSONL. Assert the `mulligan:rewind` (`type:"custom"`) entry appears BEFORE the `mulligan:note`
  (`type:"custom_message"`) entry in file order.

### Artifact 3 — the E14 fix (`src/tools/rewind.ts` + `src/tools/shrink.ts`)

In each tool's `execute`, add the master-switch gate as the FIRST config check (before the existing sub-feature
check). ~1 line each:

```ts
// rewind.ts rewindExecute, inside try{}, as step (1) BEFORE `if (!config.rewind.enabled)`:
const config = getConfig();
if (!config.enabled) return refusal("Mulligan is disabled", granularity); // E14 master switch
if (!config.rewind.enabled) return refusal("rewind is disabled", granularity);
```
```ts
// shrink.ts shrinkExecute, inside try{}, as step (1) BEFORE `if (!config.shrink.enabled)`:
const config = getConfig();
if (!config.enabled) return refusal("Mulligan is disabled"); // E14 master switch
if (!config.shrink.enabled) return refusal("shrink is disabled");
```

No change to `checkpoint.ts` (no config gate by design — labels are inert; spec/09 has no checkpoint section)
or `audit.ts` (read-only advisory; the master switch already makes the filter a no-op so the cached view is
unfiltered — audit is harmless; do NOT gate audit, it remains a useful diagnostic when disabled).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The authoritative E1–E20 → code → test mapping is in
> `research/edge-case-mapping.md` (WHERE each case is handled, the exact assertion, existing-coverage status,
> and the one gap). The house test idiom is quoted + the fixture-builder/fake builders are named with their
> source files to copy from. The exact refusal-text strings, the MUTATION_WARNING verbatim text, the config
> gate line numbers, and the smoke-harness interface (from the parallel P1.M7.T2.S1 PRP) are all below. No
> prior knowledge beyond "write these test cases + the 1-line fix using the verified facts" is required.

### Documentation & References

```yaml
# MUST READ — the E1–E20 source of truth (the "what about…" index this suite implements)
- file: spec/08-edge-cases.md
  why: "EVERY assertion in test/edge-cases.test.ts traces to a numbered entry here. Each entry gives
        Situation/Risk/Behavior — the Behavior line IS the test's expectation."
  section: "E1 (orphan → own plain unit), E2 (rewind own excluded), E3 (protected), E4 (maxDepth), E5 (side
            effects → MUTATION_WARNING + ledger), E6 (parallel → keep whole unit), E8 (no-op same-ref), E9
            (validateNote), E10 (checkpoint name + existence), E13 (fail-open), E14 (config.enabled), E16
            (audit fallback), E17 (shrinks last-wins), E18 (advisory nudges), E19 (preserve role)."

# MUST READ — the authoritative E1–E20 → code → test mapping (THIS task's research output)
- file: plan/001_2e5baf25fe9f/P1M7T3S1/research/edge-case-mapping.md
  why: "The per-edge-case table: WHERE handled (file.fn), tier (unit vs smoke), the concrete assertion,
        existing-coverage status, and the E14 gap + recommended fix. This IS the implementation checklist."
  section: "The SUMMARY TABLE (last block) + the per-E# entries above it."

# MUST READ — the testing spec (tier 1 unit + tier 2 smoke; the §2.1 F-* criteria + §2.3 JSONL invariants)
- file: spec/10-testing.md
  section: "§1.1–§1.9 (the tier-1 contract cases — many are already in transforms.test.ts; edge-cases.test.ts
            re-asserts them under the E# index), §2.2 (deterministic /mulligan_smoke path), §2.3 (JSONL
            invariants the smoke scenarios assert)."

# MUST READ — the house test idiom (copy the fixture builders + fakes from these)
- file: test/transforms.test.ts
  section: "fixture builders asst/asstText/result/user/custom + expectPairingInvariant + summary; lines 1–120."
  why: "The canonical pure-transform test helpers. COPY them into edge-cases.test.ts (they are local to that
        file; do not import across test files)."
  pattern: "hand-rolled builders, no module state, describe/it with spec-citation titles."
- file: test/rewind.test.ts
  section: "makePi() + makeCtx() fakes (NO vi.fn); clearAll()+setConfig(undefined) in beforeEach/afterEach;
            VALID_NOTE constant; the throwOn* options."
  why: "The canonical tool-test fake pattern. edge-cases.test.ts REUSES the same makePi/makeCtx shapes for E4/E5/E9/E10/E14."
- file: test/filter.test.ts
  section: "vi.mock('../src/transforms.js', ...) to force filterPipeline to throw; the E13 contextHandler
            fail-open tests (pipelineReturn = () => { throw ... })."
  why: "The ONLY place a vi.mock is used (to force an internal throw). edge-cases.test.ts's E13 cross-cutting
        suite copies this EXACT pattern for the contextHandler case."

# MUST READ — the implementation under test (READ-ONLY except the E14 fix; all Complete)
- file: src/transforms.ts
  section: "partitionIntoUnits (E1), resolveLastToolCallGroup+assistantIssuedCall (E2/E6),
            resolveLastTurn+rewindOwnIndices+isMulliganCustomMessage (E2/E3/E6), protectedOk (E3),
            applyRewind/applyShrink (E8/E17/E19), resolveShrinkTarget (E19), filterPipeline (composition)."
- file: src/filter.ts
  section: "contextHandler try/catch → return (E13 fail-open); `if (!config.enabled) return` (E14);
            readMarkers skip-malformed (E13)."
- file: src/nudges.ts
  section: "bloatReminderHandler + turnEndMetricHandler try/catch (E13); `if (!config.enabled || !sub) return` (E14);
            turn_end tolerates undefined getContextUsage (E12)."
- file: src/tools/rewind.ts
  section: "rewindExecute: config.rewind.enabled gate (E14 — ADD master gate), validateNote refusal (E9),
            checkpointExists refusal (E10), countRewindMarkers+depth guard (E4), resolvePreview→extractFileLedger
            + MUTATION_WARNING (E5), the whole-body try/catch (E13). refusal()/successText() helpers."
- file: src/tools/shrink.ts
  section: "shrinkExecute: config.shrink.enabled gate (E14 — ADD master gate), targetIsStructurallyValid (E8/E19),
            bestEffortMatch, whole-body try/catch (E13)."
- file: src/tools/checkpoint.ts
  section: "validCheckpointName /^[a-z0-9_-]{1,40}$/ (E10); makeCheckpointTool factory."
- file: src/tools/audit.ts
  section: "auditExecute E16 fallback: rt.lastFiltered null → buildContextEntries()→filterPipeline,
            source='fallback', confidence='low'. `export const auditTool` (PLAIN const, no factory)."
- file: src/markers.ts
  section: "appendRewindMarker/appendShrinkMarker (synchronous appends — E20 ordering); RewindMarker/ShrinkMarker shapes."

# MUST READ — config (the E14 cascade + the fix's exact location)
- file: src/config.ts
  section: "getConfig() sets cfg.enabled from raw.enabled but does NOT cascade to rewind.enabled/shrink.enabled
            (lines ~185–205) — CONFIRMED the E14 gap. DEFAULT_CONFIG: enabled:true, rewind.enabled:true,
            shrink.enabled:true. setConfig(undefined) → DEFAULT_CONFIG."

# SIBLING PRP — the smoke harness surface this task EXTENDS (parallel; treat as a contract)
- file: plan/001_2e5baf25fe9f/P1M7T2S1/PRP.md
  section: "Artifact 1 smoke.ts: `/mulligan_smoke <scenario>` command + driveScenario dispatch + smokeLog +
            the context.fire observer; Artifact 3 run-smoke.mjs: SCENARIOS array + per-scenario assert fns +
            §2.3 global invariants."
  why: "E7/E11/E12/E15/E20 APPEND to driveScenario + SCENARIOS. The smoke.ts interface (driveScenario(pi, ctx,
        name), smokeLog(test,status,detail), pi.sendUserMessage followUp, the import of makeRewindTool/
        appendRewindMarker from ../../src) is defined here. Reuse its smokeLog + its readSessionEntries helper."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; scripts.test:'vitest run'; scripts.smoke (set by P1.M7.T2.S1).
├── tsconfig.json           # strict, include:['src','test']  ← edge-cases.test.ts IS included → must tsc-clean.
├── src/                    # THE COMPLETE EXTENSION (all Complete; READ-ONLY except the E14 fix in 2 tool files).
│   ├── transforms.ts / filter.ts / nudges.ts / markers.ts / notes.ts / config.ts / runtime.ts / log.ts / tokens.ts / ledger.ts
│   ├── index.ts            # factory (P1.M7.T1.S1); session_start→resetRuntime (E11), session_shutdown→clearAll.
│   └── tools/{rewind,shrink,checkpoint,audit}.ts   # E14 fix touches rewind.ts + shrink.ts ONLY.
├── test/                   # vitest unit tests (COMPLETE per-module coverage).
│   ├── edge-cases.test.ts  # DOES NOT EXIST — THIS TASK CREATES IT.
│   ├── transforms.test.ts / filter.test.ts / nudges.test.ts / drift_nudge.test.ts / turn_metric.test.ts
│   ├── notes.test.ts / ledger.test.ts / tokens.test.ts / config.test.ts / log.test.ts / runtime.test.ts / index.test.ts
│   └── tools/{rewind,shrink,checkpoint,audit}.test.ts
└── test/integration/       # CREATED by parallel P1.M7.T2.S1 (smoke.ts, scenarios.md, run-smoke.mjs). EMPTY now.
# VERIFIED: `npx vitest run` is the test gate. `npx tsc --noEmit -p tsconfig.json` is the type gate.
```

### Desired Codebase tree with files to be CREATED / MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── src/tools/rewind.ts                          # MODIFIED: +1 line E14 master-switch gate (E14 fix).
├── src/tools/shrink.ts                          # MODIFIED: +1 line E14 master-switch gate (E14 fix).
├── test/edge-cases.test.ts                      # NEW: consolidated E1–E20 unit suite (16 describe blocks).
├── test/integration/smoke.ts                    # MODIFIED (additions): E7/E11/E12/E15/E20 in driveScenario.
├── test/integration/run-smoke.mjs               # MODIFIED (additions): E7/E11/E12/E15/E20 in SCENARIOS + asserts.
└── test/integration/scenarios.md                # MODIFIED (additions): E7/E11/E12/E15/E20 playbook sections.
# (test/integration/* may not exist yet at start — P1.M7.T2.S1 creates them in parallel. If absent when this
#  task runs, the smoke additions are SKIPPED with a NOTE in the PRP result, and ONLY the unit suite + E14 fix
#  ship; the smoke scenarios are appended when P1.M7.T2.S1 lands. See "Integration Points".)
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (the E14 fix must NOT regress existing tool tests) — rewind.test.ts/shrink.test.ts have
#   disabled-config cases that set the SUB-feature flag: setConfig({rewind:{enabled:false}}) → "rewind is
#   disabled" (UNCHANGED), and setConfig({shrink:{enabled:false}}) → "shrink is disabled" (UNCHANGED). The
#   master-switch path setConfig({enabled:false}) is NOT currently asserted in those files (because the tools
#   didn't honor it). After the fix: (a) the sub-feature tests still pass (their config.rewind.enabled=false
#   leaves config.enabled=true → master gate passes → sub gate refuses with the SAME text); (b) ADD the master-
#   switch assertion to edge-cases.test.ts E14 (config.enabled=false → "Mulligan is disabled"). VERIFY by
#   running the full suite after the fix; if any existing test asserted config.enabled:false → tool-works, UPDATE
#   it (grep `enabled:false` in test/tools/*.test.ts).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (vi.mock scope) — vi.mock("../src/transforms.js", …) is HOISTED to the top of the file and
#   replaces the module GLOBALLY for that test file. test/filter.test.ts uses it because filter.ts IMPORTS
#   transforms.js. edge-cases.test.ts needs the REAL transforms for E1–E8/E17/E19 but a MOCKED one for the E13
#   forced-throw case. RESOLUTION: do NOT put the E13 pipeline-throw case in edge-cases.test.ts's own
#   vi.mock — instead test E13's contextHandler fail-open via a fake ctx that THROWS (throwOnGetEntries /
#   throwOnGetBranch / throwOnGetSessionId), which forces contextHandler's catch WITHOUT mocking transforms
#   (the existing filter.test.ts "throwing getSessionId" test does exactly this). Reserve the vi.mock approach
#   ONLY if a pure-throw is unreachable; prefer the throw-fake. This keeps edge-cases.test.ts using the REAL
#   transforms everywhere.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (clearAll + setConfig(undefined) reset is MANDATORY) — runtime.ts's nextSeq + config.ts's cached
#   config are MODULE-SCOPED mutable state. A test that setConfig({enabled:false}) leaks into the NEXT test.
#   EVERY edge-cases.test.ts top-level describe MUST have beforeEach/afterEach that call clearAll() AND
#   setConfig(undefined) (the rewind.test.ts/shrink.test.ts/audit.test.ts pattern). The E14/E4/E5/E9/E10 cases
#   all mutate config or seed the runtime map. Without the reset, tests are order-dependent + flaky.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (auditTool is a PLAIN const, not a factory) — unlike makeRewindTool(pi), audit is
#   `export const auditTool: ToolDefinition<…> = defineTool({...})`. Call it as
#   `auditTool.execute(toolCallId, {top:8}, undefined, undefined, ctx)` — NO pi arg. (E16 test.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (the MUTATION_WARNING text is load-bearing) — src/tools/rewind.ts MUTATION_WARNING starts with
#   "⚠ The hidden span modified files/ran side-effecting commands". E5 asserts the SUCCESS text ENDS WITH this
#   exact substring (after "Note left."). Copy it from rewind.ts (do NOT retype from memory — the ⚠ + wording
#   are spec/08 E5 VERBATIM). renderNote's ledger blocks are `<files-modified>\n…\n</files-modified>` etc.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (E13 cross-cutting: forcing a throw in EACH handler) —
#   • contextHandler: fake ctx throwOnGetEntries/throwOnGetBranch/throwOnGetSessionId → catch → returns void.
#   • bloatReminderHandler / turnEndMetricHandler: these are registered via registerBloatReminder(pi)/
#     registerTurnEndMetric(pi) which do `pi.on("tool_result"/"turn_end", handler)`. To call them directly,
#     import the HANDLER functions if exported; if not exported (they're module-private in nudges.ts), call
#     them THROUGH a fake pi that captures the handler: `const captured=[]; const fakePi={on:(ev,h)=>{if(ev===
#     "tool_result")captured.handler=h}}`; then `captured.handler(throwEvent, throwCtx)` and assert no throw.
#     VERIFY the export surface of nudges.ts at impl time (grep `export` src/nudges.ts). If the handlers are NOT
#     exported, the fake-pi-capture pattern is the clean path (no vi.mock needed).
#   • tools: rewind/shrink/checkpoint/audit each have a throwOn* ctx option OR a fakePi.throwOnAppend → assert
#     the execute() returns a refusal text (never throws).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (E17 last-wins is by SEQ, not by push order) — two shrink markers with seq 2 then seq 1 (pushed in
#   that order) → filterPipeline applies seq-1 FIRST then seq-2 → seq-2's replacement wins (stableSortBySeq
#   sorts ascending). The test must seed them OUT of seq order and assert the HIGHER-seq replacement is the
#   final content (proves it's seq-ordered, not insertion-ordered).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 (smoke harness may not exist yet) — P1.M7.T2.S1 is PARALLEL. If test/integration/ is empty when
#   this task starts, the unit suite (edge-cases.test.ts) + the E14 fix SHIP independently (they have NO
#   dependency on the harness). The smoke additions (E7/E11/E12/E15/E20) are THEN deferred — record them as a
#   NOTE in the task result + leave a `test/integration/edge-cases-scenarios.md` stub (THIS task creates it)
#   listing the 5 scenarios so P1.M7.T2.S1 (or a follow-up) can wire them. Do NOT block the whole task on the
#   harness; the unit suite is the bulk of the value.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 (E15 bypasses the tool's depth guard) — the tool refuses the 6th rewind (E4 maxDepth=5). To seed
#   50 markers in the smoke E15 scenario, call the RAW `appendRewindMarker(pi, ctx, payload)` wrapper directly
#   (imported from ../../src/markers.js in smoke.ts) — it has no depth guard. This is the INTENDED design
#   (the guard is tool-level, not wrapper-level); E15 tests the FILTER's tolerance of many markers, not the tool.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 (E3's actual behavior is two-layer, NOT "tool refuses before persisting") — spec/08 E3 says "the
#   tool refuses before persisting," but the IMPLEMENTED behavior is: resolveLastTurn refuses the NUCLEAR case
#   (iFirst===iLast → {remove:[]}) AND protectedOk (defense-in-depth) blocks ANY remove crossing iFirstUser.
#   The TOOL does NOT pre-check protected — it persists, and the filter no-ops. The E3 test must document this
#   ACTUAL behavior (resolver refuses nuclear; protectedOk blocks first:user crossing) rather than assert a
#   tool-level refusal that doesn't exist. This is a spec-vs-code nuance — the test pins the code's real behavior.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No new types. `test/edge-cases.test.ts` reuses the structural `MessageLike`/`Unit`/`BranchEntry`/`MarkerBundle`
from `transforms.js` and the marker/note/tool types from their modules, all type-only imports. The fixture
builders + fakes are LOCAL copies of the house idiom.

```ts
// edge-cases.test.ts header (the canonical import set + house idiom):
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint,
  applyRewind, applyShrink, resolveShrinkTarget, filterPipeline, stableSortBySeq, protectedOk,
  type MessageLike, type Unit, type BranchEntry, type MarkerBundle, type RewindMarkerLike, type ShrinkMarkerLike,
} from "../src/transforms.js";
import { contextHandler, readMarkers } from "../src/filter.js";
import { validateNote, NOTE_INVALID_REASON, renderNote } from "../src/notes.js";
import { setConfig } from "../src/config.js";
import { clearAll, getRuntime } from "../src/runtime.js";
import { makeRewindTool } from "../src/tools/rewind.js";
import { makeShrinkTool } from "../src/tools/shrink.js";
import { makeCheckpointTool, validCheckpointName } from "../src/tools/checkpoint.js";
import { auditTool } from "../src/tools/audit.js";
import { appendRewindMarker } from "../src/markers.js";
import type { ExtensionAPI, ExtensionContext, ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";

// + LOCAL copies of: asst/asstText/result/user/custom/summary/expectPairingInvariant (from transforms.test.ts)
//   and makePi()/makeCtx() (from rewind.test.ts / filter.test.ts).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITES (no edits — run only)
  - RUN: ls test/integration/ 2>&1              # is the smoke harness landed? (drives GOTCHA #8)
  - RUN: grep -n "^export" src/nudges.ts        # are bloatReminderHandler/turnEndMetricHandler exported? (GOTCHA #6)
  - RUN: grep -rn "enabled:false" test/tools/   # any existing master-switch tool assertion to update? (GOTCHA #1)
  - RUN: npx vitest run                         # baseline green (the complete system passes)
  - RUN: npx tsc --noEmit -p tsconfig.json      # baseline type-green

Task 1: APPLY THE E14 FIX (src/tools/rewind.ts + src/tools/shrink.ts — the ONLY src/ change)
  - EDIT src/tools/rewind.ts rewindExecute: in the try{} block, the FIRST config check is currently
    `const config = getConfig(); if (!config.rewind.enabled) return refusal("rewind is disabled", granularity);`.
    INSERT before it: `if (!config.enabled) return refusal("Mulligan is disabled", granularity);`
    (config is already read on the line above; reuse it — do NOT call getConfig() twice).
  - EDIT src/tools/shrink.ts shrinkExecute: same — INSERT `if (!config.enabled) return refusal("Mulligan is
    disabled");` before the existing `if (!config.shrink.enabled)`.
  - VERIFY: npx tsc --noEmit (clean) + npx vitest run test/tools/ (no regression — the sub-feature tests set
    config.rewind.enabled:false with config.enabled:true, so the master gate passes through; confirm).
  - NOTE: do NOT touch checkpoint.ts (no config gate) or audit.ts (read-only; master switch makes the filter
    pass-through so the cached view is unfiltered — audit remains a harmless diagnostic).

Task 2: CREATE test/edge-cases.test.ts (the consolidated suite — the PRIMARY deliverable)
  - HEADER: imports (above) + LOCAL fixture/fake builders (copied from the house idiom).
  - beforeEach/afterEach: clearAll(); setConfig(undefined);   (GOTCHA #3)
  - describe("E1 — Orphaned toolResult", …):
      • messages=[user, result("orphan")] → partitionIntoUnits → 2 plain units; orphan is plain (✅already; re-pin).
      • filterPipeline with a last_tool_call_group rewind over [user, asst("c1"), result("c1"), result("orphan")] →
        output contains NO orphan (the orphan is its own plain unit; the rewind removes the c1 toolGroup whole).
        Run expectPairingInvariant on the output (no orphaned call/result).
  - describe("E2 — Rewinding the executing turn", …):
      • resolveLastToolCallGroup([…, asst(R), result(R)], m, "R") → returns the PREVIOUS toolGroup (or null if none).
      • A marker built by makeRewindTool carries excludeToolCallId === the execute toolCallId arg (call
        makeRewindTool(fakePi).execute("my-tc-id", VALID_PARAMS…) → inspect fakePi.appended[0].data.excludeToolCallId === "my-tc-id").
  - describe("E3 — Rewinding across a protected message", …):
      • resolveLastTurn([user0], {to_previous_prompt:true}, "x") → {remove:[]} (nuclear refused: iFirst===iLast).
      • resolveLastTurn([user0, asst, result, user1], {to_previous_prompt:true}, "x") → remove includes user1 NOT user0.
      • protectedOk([user0, …], [0], config) → false (min(remove)=0 not > iFirstUser=0).
      • filterPipeline with a rewind whose remove WOULD cross first:user + protectedOk→false → messages UNCHANGED.
      • (DOCUMENT via a comment: the tool persists; the filter no-ops — GOTCHA #10. Do not assert a tool refusal.)
  - describe("E4 — Max rewind depth exceeded", …):
      • makeCtx with entries = 5× customEntry("mulligan:rewind", rewindData(n)) → makeRewindTool(fakePi).execute(…,
        VALID_PARAMS last_tool_call_group) → result text contains "depth" AND "max" / "refused"; exactly 5 counted.
      • 4 entries → succeeds (under cap); inspect fakePi.appended has the new marker.
  - describe("E5 — Side effects (writes/bash)", …):
      • makeCtx.contextEntries scripted so buildContextEntries→messages yields a span with an edit(path) + a
        bash("git commit") within the rewind's removed indices → makeRewindTool(fakePi).execute(…) → success text
        ENDS WITH the MUTATION_WARNING substring (copy exact text from rewind.ts — GOTCHA #5) AND the persisted
        note (fakePi.sent[0].content) contains "<files-modified>" + "<bash-side-effects>".
      • setConfig({rewind:{requireMutationWarning:false}}) + same side-effecting span → success text does NOT
        contain "⚠". (The warning is gated on the config flag.)
  - describe("E6 — Parallel tool mode", …):
      • messages=[user, asst("S","R"), result("S"), result("R")] (one assistant issued sibling S + rewind R).
        resolveLastToolCallGroup(units, m, "R") → skips the shared unit → null (no previous toolGroup).
        Add a prior toolGroup: [user, asst("A"), result("A"), asst("S","R"), result("S"), result("R")] → returns the
        A toolGroup's indices (previous one).
      • resolveLastTurn over the parallel list, excludeToolCallId="R" → rewindOwnIndices contains BOTH the shared
        assistant + result("S") (the whole unit kept). Document "keep entire shared message."
  - describe("E8 — Marker targets nothing (no-op)", …):
      • filterPipeline(msgs, {rewinds:[checkpointRewind], shrinks:[]}, cfg, branchEntries=[]) → msgs === result
        (REFERENCE equality — checkpoint label absent → resolveCheckpoint null → remove=[] → applyRewind same-ref).
      • filterPipeline(msgs, {rewinds:[], shrinks:[noMatchShrink]}, cfg) → msgs === result (applyShrink no-match same-ref).
  - describe("E9 — Note field validation failure", …):
      • makeRewindTool(fakePi).execute("tc", {…VALID note but what_happened:""}) → "Mulligan: refused — note fields
        must all be non-empty." AND fakePi.appended.length===0 AND fakePi.sent.length===0.
      • Repeat for whitespace-only each of the 4 fields (avoid/true_current_state/next) → all refused, nothing persisted.
  - describe("E10 — Checkpoint name invalid or not found", …):
      • (a) makeCheckpointTool(fakePi).execute("tc", {name:"Bad Name!"}) → text contains "invalid checkpoint name" + the regex.
      • (b) makeRewindTool(fakePi).execute("tc", {…note, granularity:"checkpoint", checkpoint:"ghost"}) with no label
        in makeCtx.entries → "checkpoint 'ghost' not found".
      • (c) granularity:"checkpoint" with checkpoint:"" (or omitted) → "checkpoint granularity requires a checkpoint name".
      • (d) validCheckpointName("good-name_1") === true; validCheckpointName("UPPER") === false (unit-test the guard directly).
  - describe("E13 — Tool/handler throws internally (fail-open)", …):  ← THE CROSS-CUTTING HEADLINE
      • contextHandler: makeCtx({throwOnGetEntries:true}) → contextHandler({type:"context",messages:[…]}, ctx) →
        returns undefined (void/pass-through), does NOT throw. Repeat throwOnGetBranch, throwOnGetSessionId.
      • bloatReminderHandler: capture via fake-pi-on (GOTCHA #6) → call with a throwEvent/throwCtx → returns void, no throw.
      • turnEndMetricHandler: same fake-pi-capture → throwCtx → void, no throw.
      • makeRewindTool(fakePi({throwOnAppend:true})).execute(…) → returns refusal text ("unexpected error"), no throw.
      • makeShrinkTool(fakePi({throwOnAppend:true})).execute(…) → refusal text, no throw.
      • makeCheckpointTool(fakePi({throwOnSetLabel:true})).execute("tc",{name:"x"}) → refusal text, no throw.
      • auditTool.execute("tc", {top:8}, undefined, undefined, makeCtx({throwOnGetEntries:true})) → result with
        details.error, no throw. (audit's catch returns failure text.)
      (This single describe is the project's cardinal safety-property test.)
  - describe("E14 — Extension disabled via config", …):
      • setConfig({enabled:false}); contextHandler(event, ctx) → returns undefined (pass-through). (filter.test.ts has this; re-pin.)
      • setConfig({enabled:false}); the nudge handlers → no-op (no turn-metric appended). (capture via fake pi.)
      • setConfig({rewind:{enabled:false}}) (master still true) → makeRewindTool.execute → "rewind is disabled" (sub-feature).
      • setConfig({enabled:false}) (rewind.enabled still true) → makeRewindTool.execute → "Mulligan is disabled" (THE FIX).
      • setConfig({enabled:false}) → makeShrinkTool.execute → "Mulligan is disabled".
      • setConfig({shrink:{enabled:false}}) → makeShrinkTool.execute → "shrink is disabled".
  - describe("E16 — mulligan_audit before any inference", …):
      • getRuntime("s1").lastFiltered = null (or a fresh runtime) → auditTool.execute("tc",{top:8},undefined,undefined,
        makeCtx({entries:[…some messages as contextEntries…]})) → result.details.source === "fallback" AND
        result.details.confidence === "low" AND no throw. (Inspect details — the AuditDetails type.)
  - describe("E17 — Two shrinks target the same message", …):
      • filterPipeline([user, asst("c1"), result("c1")], {rewinds:[], shrinks:[
          {seq:2, target:{by_tool_call_id:"c1"}, replacement:"WINNER"},
          {seq:1, target:{by_tool_call_id:"c1"}, replacement:"loser"}]}, cfg) → the result's c1 message content === "WINNER"
        (higher seq applied last → wins; seeded OUT of order to prove seq-order — GOTCHA #7).
  - describe("E18 — Model ignores the nudges (advisory)", …):
      • import { renderDriftNudge } from "../src/notes.js"; const text = renderDriftNudge({deltaTokens:4000, bloatHits:[]});
        assert text.includes("consider") AND (includes("mulligan_rewind") OR includes("mulligan_shrink")) — the nudge
        is a SUGGESTION, not a force. (Documents E18: nudges are advisory, D3; no behavioral assertion beyond the text shape.)
  - describe("E19 — Shrink target is a non-toolResult message", …):
      • applyShrink([user("hello world")], {target:{by_content_includes:"hello"}, replacement:"X"}) → result[0].role === "user"
        AND result[0].content text === "X" (role preserved — E19).
      • Same for an asstText("note here") → role === "assistant" preserved.
      • filterPipeline pairing unaffected (no toolResult involved).
  - NAMING/PLACEMENT: test/edge-cases.test.ts. One describe per E# in spec/08 order. Titles EXACTLY:
    `describe("E1 — Orphaned toolResult (no matching toolCall)", …)` etc. (mirror spec/08 headings).

Task 3: SMOKE HARNESS ADDITIONS (E7/E11/E12/E15/E20) — CONDITIONAL on P1.M7.T2.S1 being landed (GOTCHA #8)
  - IF test/integration/smoke.ts EXISTS:
      • EDIT test/integration/smoke.ts driveScenario: add `case "E7": case "E11": case "E12": case "E15": case "E20":`
        branches (mirror the existing F-* dispatch; each ends with smokeLog + sendUserMessage followUp where an
        observing inference is needed).
      • E7: create a rewind (makeRewindTool.execute), smokeLog("E7", "info", {note:"known limitation — compaction
        may transiently reference hidden content; v1 accepted"}); sendUserMessage followUp. ASSERT (run-smoke):
        no crash (pi exit 0); the note persists.
      • E11: TWO runPi calls sharing --session-id smoke-E11. Run-1: rewind; sendUserMessage followUp. Run-2:
        sendUserMessage("ok") only. ASSERT: run-2 first context.fire hasRewindMarker===true.
      • E12: fresh --session-id smoke-E12; auditTool.execute as the first action (call it from the command via the
        imported auditTool) before any assistant msg; trigger one turn. ASSERT: no crash; audit result present.
      • E15: loop appendRewindMarker(pi, ctx, {granularity:"last_tool_call_group", options:{}, excludeToolCallId:"x",
        note:VALID_NOTE, ledger:emptyLedger}) 50× (RAW wrapper — GOTCHA #9); sendUserMessage followUp. ASSERT:
        context.fire present (filter terminated); message count did not increase.
      • E20: makeRewindTool.execute(...) then read the session JSONL (the logged sessionFile). ASSERT: the
        mulligan:rewind (type:"custom") entry index < the mulligan:note (type:"custom_message") entry index in file order.
      • EDIT test/integration/run-smoke.mjs: add the 5 to SCENARIOS + per-scenario assert functions (mirror the F-* shape).
      • EDIT test/integration/scenarios.md: append an "Edge cases (E7/E11/E12/E15/E20)" section with the same fields.
  - IF test/integration/ is EMPTY (harness not landed):
      • CREATE test/integration/edge-cases-scenarios.md (a STUB): the 5 scenarios as a spec the follow-up wires.
      • RECORD in the task result: "smoke additions deferred — harness not yet landed (P1.M7.T2.S1 parallel)."
      • The unit suite (Task 2) + E14 fix (Task 1) SHIP without the harness.

Task 4: VERIFY + FULL SUITE
  - RUN: npx tsc --noEmit -p tsconfig.json      # type-clean (edge-cases.test.ts + the E14 fix)
  - RUN: npx vitest run test/edge-cases.test.ts  # all E# green
  - RUN: npx vitest run                          # FULL suite green (no regression from the E14 fix)
  - RUN (if harness landed): npm run smoke       # E7/E11/E12/E15/E20 scenarios pass / pass-with-note
```

### Implementation Patterns & Key Details

```ts
// The E14 fix (the ONLY src/ change) — rewind.ts rewindExecute, top of try{}:
try {
  const config = getConfig();
  if (!config.enabled) return refusal("Mulligan is disabled", granularity); // E14 master switch (NEW)
  if (!config.rewind.enabled) return refusal("rewind is disabled", granularity); // sub-feature (unchanged)
  // … rest unchanged
}
// shrink.ts shrinkExecute: identical shape, refusal("Mulligan is disabled") (no granularity arg).

// The E13 cross-cutting fail-open assertion (the headline pattern) — contextHandler via a throw-fake:
const ctx = makeCtx({ throwOnGetEntries: true }); // getEntries throws
const result = contextHandler({ type: "context", messages: [user("hi")] } as ContextEvent, ctx);
expect(result).toBeUndefined(); // void = pass-through (C4) — the turn is NOT broken

// The E17 last-wins-by-seq assertion (seeded out of order):
const out = filterPipeline([user("u"), asst("c1"), result("c1")],
  { rewinds: [], shrinks: [
      { seq: 2, target: { by_tool_call_id: "c1" }, replacement: "WINNER" }, // higher seq
      { seq: 1, target: { by_tool_call_id: "c1" }, replacement: "loser" } ] }, // lower seq, pushed SECOND
  { rewind: { protectedRoles: ["first:user", "latest:user"] } });
// assert the c1 toolResult's content text === "WINNER" (seq-2 applied last)

// The E8 no-op reference-equality assertion:
const msgs = [user("u")];
const out = filterPipeline(msgs, { rewinds: [{ seq:1, granularity:"checkpoint", checkpoint:"absent", excludeToolCallId:"x" }], shrinks: [] },
  { rewind: { protectedRoles: ["first:user"] } }, [] /* no branch entries → label absent */);
expect(out).toBe(msgs); // SAME reference === true no-op (resolveCheckpoint null → remove=[] → applyRewind same-ref)
```

### Integration Points

```yaml
CONFIG (the E14 fix's effect):
  - setConfig({enabled:false}) now makes the WHOLE extension a no-op: context handler pass-through + nudges
    no-op + tools refuse "Mulligan is disabled". (Previously tools still executed — the gap.)
  - No migration; no new env vars. DEFAULT_CONFIG unchanged (enabled:true).

TEST (the new file):
  - test/edge-cases.test.ts is picked up by vitest's default glob (test/**/*.test.ts). No config change.
  - tsconfig include ['src','test'] already covers it → tsc --noEmit type-checks it.

SMOKE HARNESS (conditional on P1.M7.T2.S1):
  - driveScenario + SCENARIOS + scenarios.md get 5 new entries (E7/E11/E12/E15/E20).
  - If the harness isn't landed, test/integration/edge-cases-scenarios.md (a stub THIS task creates) carries
    the 5 scenarios for the follow-up. The unit suite + E14 fix ship independently.

DOCUMENTATION:
  - E7 (compaction leak) is a KNOWN LIMITATION — its final doc home is README (P1.M7.T4). This task's E7 smoke
    scenario + the edge-case-mapping.md NOTE are the source; do NOT write README here (out of scope).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The ONLY type gate (NO eslint/prettier/biome in this repo). Run after Task 1 (the fix) + Task 2 (the suite).
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0. If errors: READ them — most likely a stale refusal() arg (E14 fix) or a fake-shape mismatch.
# Common fix: the E14 refusal in shrink.ts takes ONE arg (no granularity); rewind.ts takes two.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new consolidated suite alone:
npx vitest run test/edge-cases.test.ts -t "E"   # every E# describe
# Expected: all green. A failure names the edge case (e.g. "E6 — Parallel tool mode") → consult spec/08 E6.

# The tools the E14 fix touched (regression check — GOTCHA #1):
npx vitest run test/tools/rewind.test.ts test/tools/shrink.test.ts
# Expected: green. The sub-feature disabled tests (config.rewind.enabled:false) are UNAFFECTED (master stays true).

# The full suite (the real gate):
npx vitest run
# Expected: ALL green. This proves the E14 fix didn't regress anything + the new suite composes.
```

### Level 3: Integration Testing (System Validation — CONDITIONAL on harness)

```bash
# Only if P1.M7.T2.S1's harness is landed (test/integration/smoke.ts exists):
npm run smoke
# Expected: the 9 F-* scenarios pass (unchanged) AND E7/E11/E12/E15/E20 pass / pass-with-note (E7 is doc-only).
# E11 needs TWO pi runs (shared --session-id); E15 seeds 50 markers via the RAW wrapper.

# Manual spot-check (a single edge-case scenario in isolation):
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-E11 -p "/mulligan_smoke E11"
# Expected: dispatches the command, no uncaught exception, smoke log shows the E11 context.fire lines.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The fail-open INVARIANT is the project's cardinal safety property. Run the E13 describe in isolation + verbose:
npx vitest run test/edge-cases.test.ts -t "E13" --reporter=verbose
# Expected: every forced-throw case (7 of them: 3 contextHandler + 2 nudges + ... ) prints PASS = "no throw".

# Type-coverage spot-check: confirm edge-cases.test.ts uses the REAL types (not any/unknown paper-overs):
grep -c ": any\b" test/edge-cases.test.ts   # Expected: 0 (the house idiom is typed; fakes are cast at the boundary).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (edge-cases.test.ts + the E14 fix type-clean).
- [ ] `npx vitest run test/edge-cases.test.ts` → all E1–E6, E8–E10, E13, E14, E16–E19 (+E18 doc) green.
- [ ] `npx vitest run` (full suite) → all green (no E14-fix regression in test/tools/*.test.ts).
- [ ] (If harness landed) `npm run smoke` → E7/E11/E12/E15/E20 pass / pass-with-note.

### Feature Validation (the spec/08 index is honored)
- [ ] E1: orphan result → own plain unit; filter never orphans either side.
- [ ] E2: rewind's own toolGroup excluded (excludeToolCallId === execute arg).
- [ ] E3: resolveLastTurn nuclear refuses (iFirst===iLast); protectedOk blocks first:user crossing.
- [ ] E4: 6th rewind refused with depth message; count is 5.
- [ ] E5: side-effecting span → VERBATIM MUTATION_WARNING + ledger blocks; gated on requireMutationWarning.
- [ ] E6: parallel-shared assistant message kept whole (resolveLastToolCallGroup skips; resolveLastTurn keeps).
- [ ] E8: no-match rewind/shrink → SAME reference (true no-op).
- [ ] E9: any empty note field → refused + nothing persisted.
- [ ] E10: invalid name (regex) + not-found checkpoint + empty checkpoint name all refused.
- [ ] E13: EVERY handler + tool fails open (forced throw → no throw, void/refusal).
- [ ] E14: config.enabled=false → context/nudges no-op AND tools refuse "Mulligan is disabled" (THE FIX).
- [ ] E16: audit with lastFiltered null → source="fallback", confidence="low".
- [ ] E17: two shrinks same target → higher-seq replacement wins (seq-ordered, not insertion).
- [ ] E18: drift nudge text is advisory (suggests, doesn't force).
- [ ] E19: shrink on a user/assistant message → role preserved.
- [ ] (Smoke) E7 no-crash; E11 marker survives reload; E12 pre-inference audit ok; E15 50 markers terminate; E20 entry order.

### Code Quality Validation
- [ ] edge-cases.test.ts follows the house idiom (hand-rolled fakes, .js imports, clearAll+setConfig reset).
- [ ] The E14 fix is ~1 line per tool (no over-engineering); checkpoint/audit untouched (with documented reason).
- [ ] No `vi.mock` in edge-cases.test.ts except where unreachable otherwise (prefer throw-fakes — GOTCHA #2).
- [ ] No new patterns invented — fixture/fake builders are copies of the established ones.

### Documentation & Deployment
- [ ] If harness not landed: test/integration/edge-cases-scenarios.md stub created + task result notes the deferral.
- [ ] E7 known-limitation note recorded (final README home is P1.M7.T4 — not this task).

---

## Anti-Patterns to Avoid

- ❌ Don't re-implement edge-case HANDLING — it's already complete in src/. This task tests + closes ONE gap (E14).
- ❌ Don't mock transforms.js globally in edge-cases.test.ts (it'd disable E1–E8/E17/E19). Use throw-fakes for E13.
- ❌ Don't skip the clearAll()+setConfig(undefined) reset — module-scoped config/runtime state WILL leak between cases.
- ❌ Don't assert E3 as a "tool refuses before persisting" — the real behavior is filter-side (resolver + protectedOk).
- ❌ Don't seed 50 markers via the TOOL for E15 (the depth guard refuses the 6th) — use the RAW appendRewindMarker.
- ❌ Don't gate checkpoint.ts or audit.ts on config.enabled (checkpoint has no config by design; audit is read-only).
- ❌ Don't block the whole task on the parallel smoke harness — ship the unit suite + E14 fix independently (GOTCHA #8).
- ❌ Don't retype the MUTATION_WARNING / regex / NOTE_INVALID_REASON from memory — copy the exact literals from src/.

---

## Success Metrics

**Confidence Score**: 9/10 for one-pass implementation success. The E1–E20→code→test mapping is exhaustive and
verified against LIVE src/; the house test idiom is documented with source files to copy from; the single src/
fix (E14) is ~1 line per tool with a clear no-regression argument; the conditional smoke path has a clean
fallback. The only residual risk is the harness-landing timing (mitigated by GOTCHA #8's independent-ship rule).