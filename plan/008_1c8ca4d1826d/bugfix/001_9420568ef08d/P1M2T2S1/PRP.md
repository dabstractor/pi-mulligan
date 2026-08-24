# PRP — P1.M2.T2.S1: Register + drive + assert F-ckptcmd (/mulligan_checkpoint set/revoke label lifecycle; no agent checkpoint tool)

## Goal

**Feature Goal**: Add the `F-ckptcmd` scenario to the integration smoke suite (BUG-003 / spec @10-testing.md §2.1) proving end-to-end that the human slash commands `/mulligan_checkpoint` and `/mulligan_checkpoint_revoke` drive the label lifecycle: set makes `mulligan:checkpoint:x` active, revoke clears it (latest-wins), NO custom control entry is created, and NO agent `mulligan_checkpoint` tool exists.

**Deliverable**: Edited `test/integration/run-smoke.mjs` (SCENARIOS entry, custom-flow branch in `runScenario`, `assertCkptcmd` asserter + ASSERTERS registration), a minimal `F-ckptcmd` case in `test/integration/smoke.ts`'s `driveScenario` (logging-only), and a new `### F-ckptcmd` section in `test/integration/scenarios.md`. No production-code changes.

**Success Definition**: `npm run smoke` runs F-ckptcmd and reports PASS (15/15 at this stage; 19/19 once P1.M2.T2–T5 land); all assertions (a)–(e) below hold; `npm test` + `npx tsc --noEmit` stay green.

## Why

The v1.1 human surface (slash commands, spec/13) is unit-tested (test/commands.test.ts, 38 its) but the real end-to-end path — `pi -p '/mulligan_checkpoint x'` → command dispatch → `pi.setLabel` → LabelEntry in the session JSONL → revoke → clear entry — has no CI coverage (BUG-003). Regressions in the Pi-glue layer (command registration in src/index.ts, setCheckpoint's branch walk, clearCheckpointByName's two-phase confirm) would go undetected. This scenario also establishes the slash-command-driven scenario template reused by P1.M2.T2.S2 (F-banner) and P1.M2.T4.S1 (F-useraudit).

## What

1. **Register** `"F-ckptcmd"` in the `SCENARIOS` array (test/integration/run-smoke.mjs:30-44) — append after `"F-checkpoint"`.
2. **Drive** via a custom-flow branch in `runScenario()` (~:545, alongside the F-shrink-persist / F-rewind-core / F-checkpoint branches):

```js
if (scenario === "F-ckptcmd") {
  const piRes = runPi(scenario, {
    prompts: [
      "/mulligan_checkpoint x",       // set — labels the last real message (prompt 1's own user entry)
      "/mulligan_checkpoint_revoke x", // revoke — setLabel(id, undefined), latest-wins
      "Reply with exactly: OK",        // observing inference — persists the session JSONL for assertions
    ],
  });
  const smoke = parseSmokeLog(piRes.logPath);
  return { piRes, smoke };
}
```

   Slash commands dispatch deterministically (Pi intercepts the leading `/`; the handlers registered by src/index.ts run; no model call needed for steps 1-2). Prompt 3 only guarantees the session JSONL is committed.

3. **smoke.ts**: add `case "F-ckptcmd": break;` (with a comment: commands execute via src/index.ts's registration — NOT routed through /mulligan_smoke; the case exists so an accidental `/mulligan_smoke F-ckptcmd` doesn't fall into the unknown-scenario error path). If `parseSmokeLog` needs a `session.start` line to yield `sessionFile`, verify where session.start is logged — if it's logged at extension load / session event (not only inside driveScenario), nothing more is needed; the asserter depends on `smoke.sessionFile`.

4. **Assert** — new `assertCkptcmd({ smoke, piRes })` following the existing asserter shape (returns `{ results, sessionEntries }`; skip JSONL assertions with a ⚠ note when `entries.length === 0`):
   - (a) `countLabel(entries, "mulligan:checkpoint:x") >= 1` AND a label entry with `label === "mulligan:checkpoint:x"` exists; at the post-set point `labelActive(entriesBeforeRevoke, "mulligan:checkpoint:x") === true` — compute on the entry prefix up to (not including) the first clear entry, or simpler: assert `countLabel >= 1` and that the FIRST clear entry comes after the set entry.
   - (b) after revoke: `labelActive(entries, "mulligan:checkpoint:x") === false` — a `{type:"label", targetId, label:undefined}` clear entry exists (`entries.some(e => e.type === "label" && e.label === undefined)`) for the SAME targetId the set used (assert targetIds match).
   - (c) `countCustom(entries, "mulligan:checkpoint") === 0` — checkpoints are Pi LabelEntries; "no extra control entry" (user-owned by construction).
   - (d) ZERO mulligan_checkpoint TOOL invocations: no session entry's stringified form contains a toolCall with name `"mulligan_checkpoint"` — `entries.some(e => JSON.stringify(e).includes('"mulligan_checkpoint"') && JSON.stringify(e).includes("toolCall"))` must be false (the agent tool must not exist; unit-pinned at test/index.test.ts:74 = exactly 4 registered tools).
   - (e) `assertGlobalInvariants(results, entries)` (includes "mulligan:checkpoint: labels are type:label").
5. **Register** `"F-ckptcmd": assertCkptcmd` in the ASSERTERS map (~:533-549).
6. **Docs (Mode A)**: add `### F-ckptcmd` to `test/integration/scenarios.md` — how to run (`npm run smoke` / single-scenario reproduction command), what the 3 prompts do, pass criteria (a)–(e) mirroring the existing per-scenario entries' style (see the F-checkpoint / F-rewind-core sections for the format).

### Success Criteria

- [ ] F-ckptcmd appears in SCENARIOS, runScenario drives the 3-prompt slash flow, ASSERTERS wired.
- [ ] Assertions (a)–(e) implemented with `assert()` labels; PASS on a clean run.
- [ ] `-ne` retained in the spawn (globally-installed older mulligan collision guard).
- [ ] scenarios.md section added.
- [ ] `npm run smoke` green including F-ckptcmd; `npm test` + `npx tsc --noEmit` green.

## All Needed Context

### Documentation & References

```yaml
- file: test/integration/run-smoke.mjs
  why: THE EDIT TARGET (orchestrator). SCENARIOS :30-44; runPi() :71-101 (spawn shape: 'pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID> -p ...', MULLIGAN_SMOKE_LOG env, 120s timeout); custom-flow branches in runScenario() ~:545-600 (F-shrink-persist/F-rewind-core/F-checkpoint precedents); ASSERTERS map ~:533-549
  pattern: asserters take {smoke, piRes}, use assert()/readSessionEntries()/countCustom()/countLabel()/labelActive()/assertGlobalInvariants(), return {results, sessionEntries}; entries.length===0 → JSONL assertions skipped with a ⚠ note (assertRewindCore precedent)
  gotcha: KEEP -ne (collision guard); run-smoke.mjs is plain Node ESM, NOT type-checked — no TS syntax

- file: test/integration/smoke.ts
  why: add the logging-only 'F-ckptcmd' case to driveScenario's switch (~:162-...); driveScenario dispatches on /mulligan_smoke <scenario> — for this scenario it is NOT invoked by the orchestrator (prompts are literal slash commands), the case exists for safety/documentation
  gotcha: the asserter needs smoke.sessionFile — it comes from a session.start line in the smoke JSONL; verify session.start is logged at load/session event (grep smokeLog("session.start")) and that it does NOT depend on driveScenario running

- file: src/commands.ts
  why: the real handlers under test — makeCheckpointCommand (:160-210: disabled-gate → validCheckpointName → setCheckpoint → success notify + reconcileBanner) and makeCheckpointRevokeCommand (:217-255: clearCheckpointByName two-phase latest-wins confirm → setLabel(id, undefined) on clear)
  pattern: handlers NEVER throw; registered by src/index.ts as /mulligan_checkpoint and /mulligan_checkpoint_revoke

- file: src/markers.ts
  why: setCheckpoint :456-490 — pi.setLabel(stableId, 'mulligan:checkpoint:<name>') where stableId = last 'message' entry with a real role from getBranch() walked BACKWARDS (BUG-003 fix); returns {error:"no conversation message to checkpoint..."} if none. On this scenario's fresh session, prompt 1's own user entry is the anchor — the set MUST succeed
  critical: checkpoints are Pi LabelEntries, NOT custom entries — that is WHY countCustom('mulligan:checkpoint') === 0 is the 'no extra control entry' assertion

- file: test/index.test.ts
  why: :74 — unit pin that index.ts registers EXACTLY 4 tools (no mulligan_checkpoint agent tool); assertion (d) is the integration mirror

- file: test/integration/scenarios.md
  why: EDIT — add '### F-ckptcmd' section (how to run / expect / pass criteria) mirroring existing per-scenario entries; also the general harness documentation

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/prd_snapshot.md
  why: BUG-003 (h3.2) — the five missing v1.1 scenarios; F-ckptcmd pass criteria per spec @10-testing.md §2.1. Overview (h2.0) — the -ne collision-guard note

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T1S2/PRP.md
  why: the parallel sibling's contract (highWater context.fire observables in smoke.ts) — same-file neighbor; your edits (driveScenario case) are disjoint from its context-handler edits
```

### Current Codebase tree (relevant)

```bash
test/integration/run-smoke.mjs   # EDIT — SCENARIOS + runScenario branch + assertCkptcmd + ASSERTERS
test/integration/smoke.ts        # EDIT — logging-only F-ckptcmd driveScenario case
test/integration/scenarios.md    # EDIT — ### F-ckptcmd section (Mode A)
src/commands.ts                  # READ — the handlers under test (frozen)
src/markers.ts                   # READ — setCheckpoint label semantics (frozen)
src/index.ts                     # READ — command + 4-tool registration
test/index.test.ts               # READ — the 4-tool unit pin
```

### Known Gotchas of our codebase & Library Quirks

```js
// CRITICAL: KEEP -ne in runPi's argv — a globally-installed older mulligan build must not collide (PRD Overview confounder).
// CRITICAL: setCheckpoint labels the last REAL message entry — on a fresh session prompt 1 ('/mulligan_checkpoint x')
//   IS itself a user message entry, so stableId exists and the set succeeds; if a future change makes the set fail,
//   assertion (a) fails loudly (good).
// CRITICAL: labelActive(entries, label) (run-smoke.mjs:177) applies Pi's LATEST-WINS resolution — a
//   setLabel(id, undefined) appends {type:"label", targetId, label:undefined}; assert both set AND clear entries
//   share the SAME targetId (the revoke must clear the exact label, not a different anchor).
// GOTCHA: run-smoke.mjs is plain ESM JS — no TS syntax, no imports from src (assertions operate on the JSONL text).
// GOTCHA: command prompts are NOT user messages in the agent loop (pi command dispatch bypasses it) — irrelevant
//   here but keeps the scenario deterministic (no model dependence for the set/revoke steps).
// GOTCHA: pi non-zero exit + empty smoke log → "EXTENSION LOAD FAILED" path (GOTCHA #12) — existing main() handles it.
// GOTCHA: assertion (d): search the stringified entries for '"mulligan_checkpoint"' AND "toolCall" — the label
//   prefix 'mulligan:checkpoint:' must NOT trip a false positive (it never appears as "mulligan_checkpoint").
// GOTCHA: this file is the TEMPLATE for P1.M2.T2.S2 (F-banner) and P1.M2.T4.S1 (F-useraudit) — keep the
//   custom-flow branch + asserter clean and commented for reuse.
```

## Implementation Blueprint

### Task 1: run-smoke.mjs — register the scenario

Add `"F-ckptcmd",` to SCENARIOS (after `"F-checkpoint"`). Total goes 14→15 for this changeset's intermediate state.

### Task 2: run-smoke.mjs — drive it (runScenario custom flow)

The 3-prompt branch exactly as shown in the "What" section — literal slash-command prompts; no `/mulligan_smoke` dispatch.

### Task 3: smoke.ts — logging-only case

```ts
case "F-ckptcmd": {
  // Slash-command-driven scenario: the orchestrator's -p prompts ARE the commands
  // (/mulligan_checkpoint x, then /mulligan_checkpoint_revoke x) — they execute via src/index.ts's
  // registration and are NOT routed through /mulligan_smoke. This case exists so the switch stays
  // exhaustive; the assertions read the session JSONL directly.
  break;
}
```

Verify `smokeLog("session.start", ...)` (the sessionFile source parseSmokeLog reads) is emitted independent of driveScenario; if it lives only in the session event handler, nothing to do.

### Task 4: run-smoke.mjs — assertCkptcmd

```js
function assertCkptcmd({ smoke, piRes }) {
  const results = [];
  const entries = readSessionEntries(smoke.sessionFile);
  const ckpt = "mulligan:checkpoint:x";
  if (entries.length > 0) {
    const labelEntries = entries.filter((e) => e.type === "label");
    const setEntries = labelEntries.filter((e) => e.label === ckpt);
    const clearEntries = labelEntries.filter((e) => e.label === undefined);
    // (a) set happened and was active at the post-set point
    assert(results, "(a) label 'mulligan:checkpoint:x' SET (label entry exists)", setEntries.length >= 1, `${setEntries.length} set entries`);
    assert(results, "(a) labelActive at post-set point (clear comes after set)",
      setEntries.length >= 1 && (clearEntries.length === 0 ||
        labelEntries.findIndex((e) => e.label === ckpt) < labelEntries.findIndex((e) => e.label === undefined)),
      "");
    // (b) revoke cleared it (latest-wins)
    assert(results, "(b) revoke wrote a clear entry (label:undefined)", clearEntries.length >= 1, `${clearEntries.length} clears`);
    assert(results, "(b) clear targets the SAME entry the set labeled",
      setEntries.length >= 1 && clearEntries.some((c) => c.targetId === setEntries[0].targetId), "");
    assert(results, "(b) labelActive(entries, ckpt) === false after revoke", labelActive(entries, ckpt) === false, "");
    // (c) checkpoints are labels — no custom control entry
    assert(results, "(c) ZERO custom 'mulligan:checkpoint' entries (labels only)", countCustom(entries, "mulligan:checkpoint") === 0, "");
    // (d) no agent mulligan_checkpoint tool invocation
    assert(results, "(d) ZERO mulligan_checkpoint TOOL invocations in the JSONL",
      !entries.some((e) => { const s = JSON.stringify(e); return s.includes("toolCall") && s.includes('"mulligan_checkpoint"'); }), "");
    // (e) global invariants
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — F-ckptcmd core assertions are JSONL-based; treat as FAIL`);
    // The set/revoke assertions are the WHOLE point — with no JSONL there is nothing to assert. Unlike
    // marker scenarios, do NOT silently pass: assert a hard failure so the run is honest.
    assert(results, "session JSONL available", false, "no entries read");
  }
  return { results, entries };
}
```

Register in ASSERTERS: `"F-ckptcmd": assertCkptcmd,`. Note the deliberate deviation from the skip-with-⚠ convention: every F-ckptcmd assertion is JSONL-based, and the set/revoke steps are deterministic (no model needed to WRITE the labels) — a missing JSONL means the spawn failed, so fail hard.

### Task 5: scenarios.md — `### F-ckptcmd`

Mirror the existing per-scenario section format: purpose, the 3 prompts, the pass criteria (a)–(e), and the spec reference (@10-testing.md §2.1, BUG-003).

### Task 6: Full validation

`npm run smoke` (expect 15/15 green at this stage), `npm test`, `npx tsc --noEmit`.

## Validation Loop

### Level 1: Type check

```bash
npx tsc --noEmit    # smoke.ts edit must typecheck; run-smoke.mjs is not type-checked (plain ESM)
```

### Level 2: Unit regression

```bash
npm test    # untouched suites must stay green (esp. test/index.test.ts:74 four-tool pin)
```

### Level 3: The scenario itself

```bash
npm run smoke
# Expect: F-ckptcmd PASS with all (a)-(e) assertion labels; suite total 15/15 (at this stage of the changeset).
# Single-scenario debug: node test/integration/run-smoke.mjs after temporarily reducing SCENARIOS, or inspect
# the smoke log at $(node -e 'console.log(require("os").tmpdir())')/mulligan-smoke/F-ckptcmd.log
```

### Level 4: Negative sanity (optional but recommended once)

Manually run `pi -ne -e ./src/index.ts --session-id ckpt-manual -p '/mulligan_checkpoint x' -p '/mulligan_checkpoint_revoke x' -p 'Reply with exactly: OK'` and inspect the session JSONL label entries — confirms the fixture assumptions (set on prompt-1's own entry; same targetId on clear).

## Final Validation Checklist

- [ ] `npm run smoke` green including F-ckptcmd; assertion labels (a)–(e) all pass
- [ ] `npm test` green; `npx tsc --noEmit` clean
- [ ] `-ne` retained; RUN_ID-scoped session id used (automatic via runPi)
- [ ] scenarios.md `### F-ckptcmd` section added
- [ ] No production code touched (harness + docs only)
- [ ] Custom-flow branch + asserter are reusable as the template for P1.M2.T2.S2 / P1.M2.T4.S1

## Anti-Patterns to Avoid

- ❌ Don't route F-ckptcmd through `/mulligan_smoke` — the whole point is the REAL slash-command dispatch path.
- ❌ Don't assert on notify strings in stdout (fragile) — assert on the session JSONL label entries.
- ❌ Don't silently skip on missing JSONL — this scenario's assertions are entirely JSONL-based and the label writes are deterministic; fail hard instead.
- ❌ Don't remove or reorder existing scenarios; append.
- ❌ Don't add TS syntax to run-smoke.mjs or imports from src/ into it.

**Confidence Score**: 8/10 — harness surfaces verified in-source (SCENARIOS :30-44, runPi :71-101, labelActive :177, ASSERTERS, custom-flow branches); the two residual risks are (1) whether `session.start`/sessionFile logging is independent of driveScenario (verify per Task 3) and (2) whether revoke's two-phase confirm produces exactly one clear entry — the asserter asserts ≥1 and targetId match, which is robust either way.