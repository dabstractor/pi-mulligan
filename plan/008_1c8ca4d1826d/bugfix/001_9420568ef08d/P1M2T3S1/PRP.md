# PRP — P1.M2.T3.S1: Register + drive + assert F-consent (split-phase seed flow; user-prompt hiding verdicts; guardrail arm)

## Goal

**Feature Goal**: Add the `F-consent` scenario to the integration smoke suite (BUG-003 / spec @10-testing.md §2.1, pass criteria at :101), proving end-to-end on a real `pi -p` run that a **user-consented checkpoint rewind** (`/mulligan_checkpoint delta` + `granularity:'checkpoint'` rewind): (a) succeeds with K>0 and persists a `mulligan:rewind` marker + consumed `mulligan:checkpoint:delta` label; (b) hides BOTH post-checkpoint **user** prompts (canaries U1/U2 absent from the filtered view) while the pre-checkpoint user prompt remains visible; (c) NEVER hides `first:user` (`firstUserPresent === true` on EVERY fire — default `protectedRoles: ['first:user','latest:user']`, src/config.ts:151); (d) a `last_turn` rewind (guardrail arm) NEVER hides a user message — the re-landed user prompt stays visible after the rewind.

**Deliverable**: Edited `test/integration/run-smoke.mjs` (SCENARIOS entry, an 8-prompt split-phase `runScenario()` branch, `assertConsent` + ASSERTERS wiring), edited `test/integration/smoke.ts` (three new canary constants, consent visibility booleans in the `context.fire` detail, two new `driveScenario` cases), and a new `### F-consent` section in `test/integration/scenarios.md`. No production-code changes.

**Success Definition**: `npm run smoke` runs F-consent and reports PASS (17/17 at this stage — F-banner from P1.M2.T2.S2 assumed landed; 19/19 once P1.M2.T4/T5 land, counted by P1.M2.T6.S1); all assertions below hold; `npm test` + `npx tsc --noEmit` stay green.

## Why

The v1.1 consent model (spec/13): a user who sets a checkpoint consents to having their SUBSEQUENT prompts hidden by a checkpoint rewind — the one place a rewind may hide user messages. `last_turn` / `last_tool_call_group` rewinds must NEVER hide a user message (the guardrail). Both are unit-tested but the end-to-end path (real slash command → label entry → real `makeRewindTool` checkpoint rewind → next context.fire) has zero CI coverage (BUG-003). This scenario is explicitly named in spec/11-build-order.md Step 6b's verify criteria.

## What

### 1. Register — `test/integration/run-smoke.mjs`

Append `"F-consent"` to the SCENARIOS array (:30-44) after `"F-banner"` (P1.M2.T2.S2's entry; if not yet landed, place after `"F-ckptcmd"`). Add `"F-consent": assertConsent` to ASSERTERS (:588-600). Single run — NO `main()` special-case needed (asserter uses the standard `{ smoke, piRes }` shape).

### 2. Drive — new branch in `runScenario()` (next to the `F-checkpoint` branch, ~:645)

Reuse the **split-phase seed pattern** proven by F-checkpoint/F-ckptcmd (run-smoke.mjs:643-658): slash-command prompts do NOT create user message entries, so a committed model turn must precede `/mulligan_checkpoint` for `setCheckpoint`'s backwards anchor walk (src/markers.ts:456-490 — last `message` entry with non-empty role) to find a stable entry; and post-checkpoint turns must exist so the rewind hides something (K>0).

```js
if (scenario === "F-consent") {
  // F-consent (BUG-003 / spec @10 §2.1 :101): 8-prompt CONSENT flow.
  // 1) seed-anchor model turn (setCheckpoint's anchor — slash prompts create no message entries);
  // 2) /mulligan_checkpoint delta — REAL slash command, deterministic label write;
  // 3+4) TWO user prompts U1/U2 with distinct canaries (post-checkpoint content the rewind will hide);
  // 5) /mulligan_smoke F-consent-rewind — drives the REAL makeRewindTool checkpoint rewind;
  // 6) a user prompt with the GUARD canary + reply (the turn a last_turn rewind will re-land on);
  // 7) /mulligan_smoke F-consent-guard — drives the REAL last_turn rewind (guardrail arm);
  // 8) observing inference — ALL hiding/visibility verdicts read off this fire.
  const piRes = runPi(scenario, {
    prompts: [
      "Reply with exactly: SETANCHOR",
      "/mulligan_checkpoint delta",
      "User says: MULLIGAN-SMOKE-CONSENT-U1 — reply with exactly: OK",
      "User says: MULLIGAN-SMOKE-CONSENT-U2 — reply with exactly: OK",
      "/mulligan_smoke F-consent-rewind",
      "User says: MULLIGAN-SMOKE-CONSENT-GUARD — reply with exactly: OK",
      "/mulligan_smoke F-consent-guard",
      "Reply with exactly: OK",
    ],
  });
  const smoke = parseSmokeLog(piRes.logPath);
  return { piRes, smoke };
}
```

Fires expected: after prompts 1, 3, 4, 6, 8 → **5 fires** (`smoke.contextFires.length === 5`; prompts 2/5/7 are command dispatches, no inference).

### 3. smoke.ts — observables + driver cases

**(a)** Add module-local canary constants next to `SEED_ANCHOR`/`SEED_HIDDEN` (~:58-64):

```ts
// F-consent canaries (P1.M2.T3.S1): U1/U2 live in POST-checkpoint USER prompts (consented hiding
// targets); GUARD lives in the user prompt a last_turn rewind re-lands on (must stay VISIBLE).
const CONSENT_U1 = "MULLIGAN-SMOKE-CONSENT-U1";
const CONSENT_U2 = "MULLIGAN-SMOKE-CONSENT-U2";
const CONSENT_GUARD = "MULLIGAN-SMOKE-CONSENT-GUARD";
```

**(b)** In the `context` handler, next to the existing `userMsgCount`/`firstUserPresent` computation (~:494-495, P1.M2.T1.S1's observables), add role-agnostic content scans (canaries are unique; user content only appears in user messages):

```ts
const consentU1Present = msgs.some((m) => JSON.stringify(m).includes(CONSENT_U1));
const consentU2Present = msgs.some((m) => JSON.stringify(m).includes(CONSENT_U2));
const consentGuardPresent = msgs.some((m) => JSON.stringify(m).includes(CONSENT_GUARD));
```

and extend the `context.fire` detail (~:513-527) with `consent: { u1: consentU1Present, u2: consentU2Present, guard: consentGuardPresent }` — computed on EVERY fire (needed for the every-fire `firstUserPresent` assertion and pre-rewind seeding sanity).

**(c)** Two new cases in `driveScenario`'s switch (mirror the `F-checkpoint-rewind` case at smoke.ts:299-304):

```ts
case "F-consent-rewind": {
  // Phase 1 of F-consent's rewind arm: the REAL checkpoint rewind. Deterministic — no model
  // dependency for the tool call itself. The '/mulligan_checkpoint delta' label was set by the
  // REAL slash command earlier in the prompt flow; this hides both post-checkpoint user prompts.
  await rewindNow(pi, ctx, "smoke-consent-rw-1", "checkpoint", { checkpoint: "delta" });
  break;
}
case "F-consent-guard": {
  // Guardrail arm: a last_turn rewind re-lands on the GUARD user prompt — the user message must
  // REMAIN VISIBLE (last_turn never hides a user message; only checkpoint consent does).
  await rewindNow(pi, ctx, "smoke-consent-guard-1", "last_turn");
  break;
}
```

(`rewindNow` already exists: smoke.ts:103-120; `SMOKE_NOTE` is the canonical valid note; `makeRewindTool` already imported.)

### 4. Assert — new `assertConsent({ smoke, piRes })` in run-smoke.mjs

Mirror the structure of `assertCheckpoint` (:378-415) + the JSONL helpers `readSessionEntries` / `countCustom` / `countLabel` / `labelActive` / `assertGlobalInvariants`:

- **Sanity**: `piRes.status === 0`; `smoke.contextFires.length >= 4` (tolerant ≥4 vs the ideal 5 — a model timeout on prompt 8 is the flake mode; label the failure clearly).
- **(a) checkpoint rewind succeeded**: last `tool.rewind` line with `detail.toolCallId`-independent read — filter `smoke.lines.filter(l => l.test === "tool.rewind")`; the checkpoint rewind's text must NOT match `/refused|0 messages will be hidden/i` (K>0, same guard as assertCheckpoint:401). JSONL: `countLabel(entries, "mulligan:checkpoint:delta") >= 1`; `countCustom(entries, "mulligan:rewind", "rewind") >= 2` (checkpoint + guard rewinds); `!labelActive(entries, "mulligan:checkpoint:delta")` (consumed by the rewind — auto-expiry, same regression guard as assertCheckpoint:410).
- **(b) consented user-prompt hiding + pre-checkpoint visibility**: on the FINAL fire (`const final = smoke.contextFires[smoke.contextFires.length - 1]`): `final.consent.u1 === false`, `final.consent.u2 === false` (both post-checkpoint user prompts hidden — THE consent behavior), AND `final.userMsgCount >= 2` with `final.firstUserPresent === true` (the pre-checkpoint prompts remain visible: SETANCHOR user prompt + the GUARD user prompt). Pre-rewind seeding sanity: at least one EARLIER fire (`contextFires.slice(0, -1)`) has `consent.u1 === true` and one has `consent.u2 === true` (proves the canaries were committed and visible before the rewind — otherwise the hiding assertions would pass vacuously; two-signal guard, same discipline as F-checkpoint.hiding).
- **(c) first:user never hidden**: `smoke.contextFires.every(f => f.firstUserPresent === true)` — EVERY fire, before and after both rewinds.
- **(d) guardrail**: on the final fire `consent.guard === true` — the re-landed user prompt REMAINS visible after the `last_turn` rewind (which hid only the model turn after it). Also assert the guard rewind itself ran: a `tool.rewind` line whose text mentions `last_turn` and is not refused.
- **(e)** `assertGlobalInvariants(results, entries)` when `entries.length > 0`, else fail "JSONL available" (the F-ckptcmd hard-fail deviation: every write here is deterministic — a missing JSONL means the spawn failed).

### 5. Docs — `test/integration/scenarios.md` (Mode A, same subtask)

Add a `### F-consent` section after F-ckptcmd/F-banner: document the 8-prompt seed/canary flow (why the seed anchor must precede the checkpoint, why TWO user canaries, why the guard arm), the observables read (`consent.{u1,u2,guard}`, `firstUserPresent`, `userMsgCount`), the every-fire first:user invariant, and the pass criteria mapping to spec @10-testing.md §2.1 F-consent.

### Success Criteria

- [ ] F-consent registered, driven, asserted; `npm run smoke` → PASS (17/17 at this stage).
- [ ] (a) K>0 checkpoint rewind + label consumed assertions hold.
- [ ] (b) U1/U2 hidden on the final fire; pre-rewind fires show them visible (no vacuous pass).
- [ ] (c) `firstUserPresent === true` on every fire.
- [ ] (d) GUARD user message visible after the last_turn rewind.
- [ ] `npm test` + `npx tsc --noEmit` green; scenarios.md section added.

## All Needed Context

### Context Completeness Check

An implementer with only this PRP + the four files below has everything: the exact prompt flow, the split-phase rationale (why the seed anchor must commit BEFORE the command), the observable names already landed by P1.M2.T1.S1, and the assertion patterns to mirror.

### Documentation & References

```yaml
- file: test/integration/run-smoke.mjs
  why: THE orchestrator being edited. SCENARIOS :30-44; ASSERTERS :588-600; runScenario F-checkpoint split-phase branch :643-658 (THE pattern); assertCheckpoint :378-415 (K>0 + label-consumed + hiding read-back pattern); assert() :141; assertGlobalInvariants :203; helpers readSessionEntries/countCustom/countLabel/labelActive :~100-200
  pattern: runPi(scenario, { prompts: [...] }) drives sequential -p prompts; parseSmokeLog(piRes.logPath) → { lines, contextFires, sessionFile }
  gotcha: slash-command prompts dispatch WITHOUT an agent-loop turn (no user message entry, no context.fire) — only model-reply prompts produce fires; contextFires[i].consent/.banner/.firstUserPresent mirror the smoke.ts detail fields

- file: test/integration/smoke.ts
  why: THE harness being edited. SEED canary consts :58-64; rewindNow helper :103-120; driveScenario switch (F-checkpoint-set/-rewind cases :283-304 = THE template); context handler observables :480-530 (userMsgCount/firstUserPresent at :494-495, banner at :524, context.fire detail :513-527)
  pattern: scenario-scoped blocks read currentScenario; but consent booleans are UNCONDITIONAL (every fire) because the every-fire firstUserPresent assertion needs all fires
  gotcha: the handler must keep returning VOID (observer-only, GOTCHA #1); smokeLog never throws; smoke loads SECOND → msgs are POST-filter (absence = hidden by Mulligan)

- file: src/markers.ts
  why: setCheckpoint anchor walk :456-490 — walks getBranch() BACKWARDS to the last message entry with a real role; WHY the seed-anchor model turn must commit BEFORE /mulligan_checkpoint (a fresh command-only session has no anchorable entry)
  gotcha: read-only reference — do NOT modify

- file: src/config.ts
  why: protectedRoles default ["first:user","latest:user"] :151 — the config backing assertion (c); enforcement lives in transforms.ts protectedOk (:1373-1397, fail-safe)
  gotcha: read-only reference

- file: test/integration/scenarios.md
  why: add the ### F-consent section (Mode A docs ride with this subtask); mirror the F-ckptcmd/F-banner section structure from P1.M2.T2.S1/S2
- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T2S2/PRP.md
  why: PARALLEL item (F-banner). It edits run-smoke.mjs (SCENARIOS + runScenario branch + asserter) and smoke.ts (a case) — NO file conflict is possible if you APPEND after its F-banner entries rather than inserting into its blocks. Its banner observable (contextFires[i].banner) is already landed and independent
  gotcha: assume F-banner lands exactly as specified; do not reference or depend on banner state

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T1S1/PRP.md
  why: landed — the userMsgCount/firstUserPresent observables this scenario CONSUMES (smoke.ts :494-495/:524-525)
```

### Known Gotchas

```js
// CRITICAL: slash-command prompts (/mulligan_checkpoint, /mulligan_smoke) create NO user message
//   entries and fire NO context events — only the 5 model-reply prompts produce fires.
// CRITICAL: the seed anchor (prompt 1) must commit BEFORE /mulligan_checkpoint delta — setCheckpoint's
//   backwards walk needs a real message entry (markers.ts:456-490); a command-only fresh session refuses.
// GOTCHA: U1/U2 must be in USER prompts (not assistant replies) — the whole point is CONSENTED hiding of
//   user messages, which only checkpoint-granularity rewinds do. last_turn NEVER hides them (guard arm).
// GOTCHA: guard against vacuous pass: assert ≥1 pre-rewind fire shows u1/u2 PRESENT (canaries committed).
// GOTCHA: smoke.ts loads SECOND → its context handler sees POST-filter msgs; canary absence == hidden.
// GOTCHA: .js import suffixes in smoke.ts imports (ESM Bundler) — already in place, don't add .ts ones.
// GOTCHA: both rewinds use the REAL makeRewindTool via rewindNow (SMOKE_NOTE is valid) — deterministic,
//   no model dependency for the tool calls themselves; the model only drives the seed/observe turns.
// GOTCHA: append F-consent AFTER F-banner's entries in SCENARIOS/runScenario to avoid merge conflicts
//   with the parallel P1.M2.T2.S2 work.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT test/integration/smoke.ts — observables
  - ADD canary consts CONSENT_U1/U2/GUARD near :58-64
  - ADD consentU1/U2/GuardPresent scans near :495; ADD `consent: {...}` to the context.fire detail (:513-527)

Task 2: EDIT test/integration/smoke.ts — driver cases
  - ADD "F-consent-rewind" (rewindNow … "checkpoint", {checkpoint:"delta"}) and
    "F-consent-guard" (rewindNow … "last_turn") cases to driveScenario (template :299-304)

Task 3: EDIT test/integration/run-smoke.mjs — register + drive
  - APPEND "F-consent" to SCENARIOS (after F-banner); ADD the 8-prompt runScenario branch (exact prompts above)

Task 4: EDIT test/integration/run-smoke.mjs — assert
  - ADD assertConsent({smoke, piRes}) implementing sanity/(a)/(b)/(c)/(d)/(e); wire into ASSERTERS

Task 5: EDIT test/integration/scenarios.md — add ### F-consent (Mode A)

Task 6: VALIDATE
```

## Validation Loop

```bash
npm run smoke          # F-consent PASS; all other scenarios stay green (17/17 at this stage)
npm test               # full unit suite unchanged-green
npx tsc --noEmit       # smoke.ts typechecks
# Iterate: on FAIL, read the [mulligan-smoke] stderr lines + /tmp mulligan-smoke log JSONL for the
# failing assertion label; verify the fire count (expect 5) and consent fields before changing code.
```

## Final Validation Checklist

- [ ] F-consent green in `npm run smoke`; no other scenario regressed
- [ ] U1/U2 hidden + pre-checkpoint user prompts visible on the final fire; pre-rewind visibility sanity asserted
- [ ] `firstUserPresent === true` on every fire
- [ ] GUARD user message survives the last_turn rewind
- [ ] JSONL: delta label set + consumed; ≥2 rewind markers; global invariants hold
- [ ] `npm test` + `npx tsc --noEmit` green; scenarios.md updated

## Anti-Patterns to Avoid

- ❌ Don't reimplement tool/filter logic in the harness — drive REAL `makeRewindTool` via `rewindNow`, read the POST-filter view
- ❌ Don't return `{messages}` from the smoke context handler (observer-only, GOTCHA #1)
- ❌ Don't put U1/U2 in assistant replies — they must be USER prompts (consented hiding targets)
- ❌ Don't assert hiding without the pre-rewind presence sanity (vacuous-pass trap)
- ❌ Don't touch F-banner's blocks (parallel work) — append, don't interleave

**Confidence Score: 8/10** — exact prompt flow, landed observables, and proven split-phase precedent (F-checkpoint :643-658); residual risk is model-timing flakes on the seed turns (mitigated by the tolerant fire-count assertion + clear failure labels).