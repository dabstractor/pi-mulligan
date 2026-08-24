# P1.M2.T5.S1 research notes
- run-smoke.mjs: SCENARIOS :30-49; runPi flattens prompts → -p pairs (:87); ASSERTERS :708-719; soft printed :895; assertNudgeDrift pattern :326-343 (JSONL-timeout tolerance :339-341).
- smoke.ts: context observer :523-563 logs hasNudge (:552) + highWater{latch,fraction} (:559) on EVERY fire — currentScenario gates only hard-hiding logs → no /mulligan_smoke dispatch needed for this scenario.
- src/tokens.ts:126-143 estimateAgentTokens — D10 structural exemption (role!=='user').
- src/nudges.ts:325-332 shouldNudge (windowed avg >= threshold); :466-512 shouldHighWater MUTATES rt.aboveHighWater latch — observer must read-only.
- src/config.ts:168-170 defaults: driftThresholdTokens 4000, driftWindowTurns 3, highWaterFraction 0.7. smoke.ts:250 comment "3000" is STALE v1.0 text.
- ARG_MAX ~2MB Linux; 60k tokens ≈ 240KB argv OK as a single -p arg.
- Contrast arm: F-nudge-drift (scenarios.md :191-221) already green — cross-reference, don't duplicate.
