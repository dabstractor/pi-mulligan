# Research Notes — P1.M2.T1.S2 (bugfix 001_9420568ef08d): highWater observables in context.fire

## smoke.ts context handler (test/integration/smoke.ts ~:458-519)
- `pi.on("context", (event, ctx) => {...})` builds `msgs = event.messages as unknown as Array<Record<string, unknown>>`, fetches `entries = ctx.sessionManager.getEntries()` (own try/catch → []), computes booleans, then `smokeLog("context.fire", "info", { count, msgCanaryPresent, resultCanaryPresent, notePresent, hasRewindMarker, shrunkInContext, hasNudge, seedAnchorInAssistant, seedHiddenInAssistant })` (line ~480). Whole body in one try/catch → `smokeLog("context.fire","fail",{error})`. Returns VOID (pass-through; smoke loads SECOND → event.messages is the POST-filter set).
- P1.M2.T1.S1 (parallel) APPENDS `banner`/`userMsgCount`/`firstUserPresent` to this same detail object — must not collide; our fields are `highWater.latch` / `highWater.fraction`.

## runtime.ts
- `getRuntime(sessionId): SessionRuntime` (:139) — module-scoped Map, never throws, creates fresh on first access. `SessionRuntime.aboveHighWater` is the §5.2 edge latch (mutable in place).
- CRITICAL (external_deps.md): both extensions share ONE pi process + module instance, so importing `getRuntime` from `../../src/runtime.js` in smoke.ts yields the SAME runtime the nudges handler mutated. Observer reads AFTER src's handler ran (registration order) → post-update latch value.
- Session id: `ctx.sessionManager.getSessionId()` (read FRESH in-handler — C12 stale-reference rule; nudges.ts:194 does the same).

## shouldHighWater (src/nudges.ts:497-513)
- `(totalFilteredTokens / windowTokens) >= config.nudges.highWaterFraction (default 0.7)` → first upward crossing sets `rt.aboveHighWater = true`, returns true; subsequent above-threshold fires return false (edge-triggered); below-threshold CLEARS the latch; `windowTokens <= 0` returns false WITHOUT touching the latch (E12 fail-open).
- Awareness-only (spec/07 §5.2, D10).

## tokens.ts
- `estimateTokens(messages: MessageLike[] | null | undefined): {tokens, confidence}` — chars/4 ceil, never throws, non-negative.

## getContextUsage
- `ctx.getContextUsage()` may be undefined pre-first-inference; `?.contextWindow` may be 0/undefined → fraction must be `null` in that case (E12 tolerance — the harness already tolerates this for the audit E12 scenario).

## scenarios.md
- "A `context.fire` line" JSON block at ~:56-67 — append `highWater` fields with `//`-comments matching house style. P1.M2.T1.S1 also appends its fields there (banner/userMsgCount/firstUserPresent) — both land in the same block; fine.

## Consumer
- P1.M2.T5.S1 (F-drift-userexempt): asserts big user paste → `hasNudge:false` AND `highWater.latch === true` (soft on huge windows). This item only produces the observable; no scenario registration here.