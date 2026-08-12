# Research Notes — P4.M1.T1.S2 (smoke F-shrink-persist user-message variant)

## Harness architecture (two files = the "smoke harness")
- `test/integration/smoke.ts` — Pi HELPER extension loaded via `pi -e ./src/index.ts -e ./test/integration/smoke.ts`.
  - `session_start` handler injects a **custom_message** canary: `pi.sendMessage({ customType: "mulligan_smoke_canary", content: MSG_CANARY, display: false })`.
  - `context` handler = OBSERVER (returns void; loads SECOND → sees POST-filter view). Logs per-fire observables.
  - `driveScenario(scenario)` switch dispatches per scenario using REAL tool factories (`makeShrinkTool(pi)` etc.).
  - `case "F-shrink-persist"` (~L180): ONE shrink `by_content_includes: MSG_CANARY`, replacement `SHRUNK_MARKER`.
- `test/integration/run-smoke.mjs` — plain Node ESM orchestrator (NOT type-checked). Spawns pi, parses smoke log + session JSONL, asserts.
  - `runScenario(scenario)` — default 2-prompt flow (`/mulligan_smoke <s>` then `Reply with exactly: OK`); F-rewind-core/F-checkpoint/F-reload/E11 have custom branches.
  - `assertShrinkPersist({smoke, piRes})` (~L257) — current assertions.
  - Helpers: `readSessionEntries(sessionFile)` (L122), `entryIncludes(entries, needle)` (L191), `assert(results,label,cond,detail)` (L137), `parseSmokeLog` (L101), `countCustom`.

## Current F-shrink-persist assertions (the baseline to EXTEND, not weaken)
- `tool.shrink ran` (>=1 shrink line)
- `context.fire shrunkInContext:true` (the SHRUNK_MARKER appears in the filtered view)
- `JSONL has mulligan:shrink (custom)` (countCustom)
- `JSONL original canary still on disk` → `entryIncludes(entries, "MULLIGAN-SMOKE-MSG-CANARY")` ← THIS is the existing on-disk-survival proof for the custom_message canary
- global invariants (§2.3)

## The gap (E19 h2.100)
- Current target = a **custom_message** canary (MSG_CANARY). E19 demands the **USER-message** case: "Summarizing user input is acceptable precisely because the original always survives."
- `pi.sendMessage` only creates custom_messages (role "custom"), NOT role:"user". → A real user message MUST come from an orchestrator `-p` prompt.

## Shrink mechanism (confirms user-message shrink is supported end-to-end)
- `resolveShrinkTarget` `by_content_includes` (src/transforms.ts ~L802): "first message (ANY role — spec/08 E19) whose stringified content includes a NON-EMPTY substring." → matches user messages.
- `applyShrink` (~L963): clones via `{...orig, content: newContent}` → role PRESERVED (E19). No protectedOk check on shrink (protection is rewind-only). So shrinking a user message works.
- shrink tool (src/tools/shrink.ts) captures `pinnedEntryId` (stable entry id) at creation; filter resolves by identity. Fail-open: matched:false still persists; live re-resolution at filter time.

## Design (touches BOTH files — the established pattern for every scenario)
1. run-smoke.mjs `runScenario`: F-shrink-persist → 3-prompt flow: `[USER_CANARY prompt, /mulligan_smoke F-shrink-persist, Reply OK]`.
2. smoke.ts `driveScenario` F-shrink-persist: add a SECOND shrink `by_content_includes: USER_CANARY`, distinct replacement `USER_SHRUNK_MARKER`.
3. smoke.ts context handler: add `userCanaryPresent` + `userShrunkInContext` observables.
4. run-smoke.mjs `assertShrinkPersist`: add E19 assertions (userShrunkInContext:true; original USER_CANARY on disk; 2 shrink lines).

## Validation
- `npm run smoke` (= `node test/integration/run-smoke.mjs`) — full suite; F-shrink-persist must PASS.
- `npm run typecheck` (tsc --noEmit) — smoke.ts IS type-checked; run-smoke.mjs is NOT. Changes follow existing patterns verbatim.

## Confidence: 9/10
Direct extension of the working F-shrink-persist pattern. Only novelty = targeting a user message, already validated at the pure-helper tier by P4.M1.T1.S1's E19 tests + E19 spec.