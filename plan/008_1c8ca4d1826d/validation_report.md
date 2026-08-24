# pi-mulligan — Validation Report

**Date:** 2026-08-24 · **Repo:** `/home/dustin/projects/pi-mulligan-current-turn-only` (v0.1.4, spec v2.0)
**Method:** static review + 4 independent read-only subagent audits + hands-on E2E journey simulation driving the real `src/` modules (65 ad-hoc + 52 scripted assertions) + the real-`pi` integration smoke + docs-contract checks.

---

## Verdict summary

| Layer | Result |
|---|---|
| Type check (`tsc --noEmit`) | ✅ clean |
| Unit tests (`vitest run`) | ✅ 1098/1098, 24 files |
| Integration smoke (`pi` CLI, **isolated** `-ne`) | ✅ 14/14 scenarios |
| Integration smoke as shipped (`npm run smoke`) | ❌ **0/14 — extension-load failure** (Finding 1) |
| E2E user journeys (cross-module, real code) | ✅ 52/52 assertions |
| v2.0 current-turn shrink scope (creation + every fire) | ✅ verified in code, tests, and live simulation (incl. N+2 moving-target check) |
| E22 guards (retry budget, context fraction, depth) | ✅ behave correctly; one spec-internal boundary contradiction (Finding 7) |
| Docs/attestation contract | ❌ drift + stale claims (Findings 3–5) |

The **core v2.0 contract holds**: shrink targets are hard-refused at creation when they resolve outside the current turn, the filter independently enforces the issuing-turn bound at every fire (pinned and live arms), the drift nudge is awareness-only, orientation-line honesty gating works, guardrails (first:user, no user-wipe, checkpoint consent + auto-expiry) hold, and cancel retraction works end-to-end. The issues below are operational/documentation/test-hygiene — none is a correctness defect in the transform pipeline.

---

## Findings

### MAJOR

**M-1. `npm run smoke` fails 0/14 on any machine with another mulligan variant installed (extension-load conflict).**
`test/integration/run-smoke.mjs:76` spawns `pi -e ./src/index.ts -e ./test/integration/smoke.ts …` without `-ne`. Pi still discovers globally-installed packages; the developer's own `~/.pi/agent/settings.json` lists `../../projects/pi-mulligan-state-reset`, whose tools collide:
```
Error: Failed to load extension ".../pi-mulligan-state-reset/src/index.ts":
  Tool "mulligan_rewind" conflicts with .../pi-mulligan-current-turn-only/src/index.ts  (×4 tools)
→ pi exits 1 → "EXTENSION LOAD FAILED" for all 14 scenarios
```
Re-run with `-ne` (disable extension discovery) → **14/14 pass**, proving the harness itself is sound. Fix: add `-ne` to the orchestrator's argv (explicit `-e` paths still load). Evidence: reproduced twice; isolated run green.

**M-2. The integration suite has no automated enforcement (CI gap).**
`.github/workflows/test.yml` runs only `npm run typecheck` + `npm test` (= `vitest run`). `test/integration/smoke.ts` has no `.test.` suffix and there is no `vitest.config` include, so vitest never picks it up; the only entry point is manual `npm run smoke` — which currently fails per M-1. Spec §2.5 success criterion 1 ("shed it autonomously… proven end-to-end") is therefore unguarded by CI.

**M-3. VERIFICATION.md attestations are stale/false.**
- `VERIFICATION.md:17` claims "**671 passed, 0 failed** (18 files)"; the actual suite is **1098 tests / 24 files**.
- `VERIFICATION.md:20` claims "**7 gates** (filter + all **5 tools** [rewind/shrink/audit/cancel/checkpoint] + 2 nudges)" — v1.1 removed the agent `mulligan_checkpoint` tool; `src/index.ts:53–56` registers exactly **4**.
- `VERIFICATION.md:22` (criterion 6) claims README documents "the **five** agent-callable tools" with "**5 \*_DESC verbatim**" — README §4 documents **four**, and the rewind quote is drifted (M-4).

**M-4. README §4 `mulligan_rewind` blockquote is not the verbatim `REWIND_DESC` it claims to be.**
README §4 states the descriptions are "verbatim copies… from `src/tools/*.ts`". README:135 reads *"The hidden content disappears from your view permanently"* while `src/tools/rewind.ts:127–129` (`REWIND_DESC`) reads *"The content is hidden from your context going forward"*. (shrink/audit/cancel quotes match exactly — only rewind drifted.)

### MINOR

**m-5. README references a nonexistent spec file (×2).**
`README.md:196` and `README.md:301` cite `spec/13-human-commands.md`; the actual file is `spec/13-human-facing-surface.md`.

**m-6. Stale build artifact committed at repo root.**
`pi-mulligan-0.1.0.tgz` (v0.1.0) sits in the repo while `package.json` is v0.1.4 — a stale snapshot that no longer matches the source and invites accidental installation. (Its `renderDriftNudge` contains neither the v1 nor v2 tail — it predates both.)

**m-7. E22 budget boundary: spec-internal contradiction (implementation matches one clause, contradicts the other).**
spec/08 E22(a): "the first `maxRetriesPerPrompt−1` rewinds … succeed; **the Nth (== budget) refuses**." spec/10 §1.10: "3 consecutive … rewinds … **the 4th is refused**" (budget 3). The implementation (`src/tools/rewind.ts:572–579`, `retries >= max`) allows the first N and refuses N+1 — i.e. it follows §1.10 and contradicts E22(a). Behavior is conservative either way (verified live: budget=3 → rewinds #1–3 succeed, #4 refused pre-persist); the spec texts disagree with each other and one unit test pins the implemented boundary.

**m-8. Retry-budget over-approximation (documented).**
`countRetriesAtLatestPrompt` (`src/tools/rewind.ts:283–356`) counts *every* rewind marker after the latest user entry; spec/08 E22 / spec/05 §1 step 4 count a `last_tool_call_group`/`checkpoint` rewind only when its *resolved target* is at/after that prompt. Over-refusal only (conservative direction); deviation acknowledged in-code at `:272–278`.

**m-9. `turnHasAdvanced` fails open for unlocatable own-toolGroup (narrow legacy replay vector).**
`src/transforms.ts:1475–1492`: when a legacy (unpinned) rewind's own toolGroup can't be located (e.g. it was removed by an earlier pinned rewind), the gate returns `false` and the relative resolver may re-target current work (the BUG-002 replay signature). Production markers are always pinned (never reach this path); affects old/unpinned markers only.

**m-10. Out-of-scope pinned shrink markers never auto-retire, contradicting the in-code claim.**
`src/transforms.ts:1738–1741` says a permanently out-of-scope pinned marker "misses every fire and auto-retires via filter.ts's shrinkMissCounts after staleAfterFires" — but `filter.ts:398–405` counts a *hit* on `resolvePinnedShrink(...) !== null` (identity only, no span check), so a present-but-out-of-span entry resets the miss counter and the marker no-ops forever (bounded only by the `maxActive` cap). No spec violation ("no-ops for that fire" is exactly what happens); the comment and the design doc (`scope_guard_design.md` §4) are wrong.

**m-11. `rewind.maxDepth` accepts 0 and fractional values.**
`src/config.ts:263–264` uses `coerceNumber(…, mustBePositive=false)` — no floor-to-min-1, unlike `maxRetriesPerPrompt`, `maxActive`, `staleAfterFires`, `driftWindowTurns` (BUG-002/003 convention). Spec §4's literal "finite, >= 0" is satisfied, so this is a consistency nit: `maxDepth: 0` disables rewinds via silent refusal, `2.5` behaves as `2.5`.

**m-12. Test-suite gaps on load-bearing contracts** (all verified as gaps, behavior manually confirmed correct where I checked):
- **E21(b)'s explicitly demanded unit test is absent** — no test runs the filter/pipeline with a cancelled marker present and asserts content reappearance (spec/08:108). The two halves (readMarkers drop; tool appends cancel) are tested; the composition is not.
- **Exact E22 refusal texts not pinned** — tests assert fragments ("per-prompt retry budget", "3/3"); the spec-mandated steering tail sentences are nowhere asserted verbatim.
- **audit/cancel callability after budget hit untested** (only shrink is exercised).
- **spec/10 §3 shrink-idempotency property test is vacuous under v2.0** — `test/transforms.test.ts:1754–1773` builds markers without `markerEntryId` and calls the 3-arg pipeline, which the suite itself proves no-ops; the property passes while exercising zero shrink substitution.
- **Compaction re-entry for shrink markers has zero tests** (spec/06:137 names it as a vector the guard must defeat).
- **Pinned×pinned and rewind+shrink same-fire pipeline composition untested**; N+2 moving-target untested in the suite (I verified manually: correct).
- Single fixed seed per property test; no seed sweep.

### INFO

**i-13. Environment/deployment: the globally-installed `pi-mulligan-state-reset` (older mulligan variant) is live in this machine's Pi runtime and emits the v1 prescribing drift-nudge tail.** Both my session and a reviewer's session repeatedly received live nudges reading *"…If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."* — the exact cross-turn prescription v2.0 removed as a stuck-turn amplifier. This repo's `src/notes.ts:340` renders the correct v2.0 awareness-only tail; the firing text comes from the stale installed build (`~/.pi/agent/settings.json` packages list). Not a source defect — deployment hygiene: reinstall/upgrade the installed package.

**i-14. `README.md:5` "Status: v1.2" while the code implements v2.0 semantics (package 0.1.4).** The body documents v2.0 behavior; only the header badge is stale.

**i-15. Dead (unregistered) agent-tool code retained.** `makeCheckpointTool`/`CheckpointParams` remain in `src/tools/checkpoint.ts` (imported only by tests + the smoke harness's deterministic path). Intentional per v1.1 (tool removed), but it is dead production surface.

**i-16. Spec-side staleness (code is the correct side in each case):** spec/05 §6 CANCEL description still lists `by_content_includes`; spec/05 §6 SHRINK description says "past tool result"; spec/05 §5 purpose prose enumerates three target arms; spec/06 §12 pseudocode comment says shrinks are "NOT pinned" while §5 documents pinning; `shrink.ts:67` header comment says "3-arm target union" (schema is 2-arm); `test/tools/shrink.test.ts:33–34` header documents the pre-v2.0 no-match-not-a-refusal contract the body correctly contradicts.

**i-17. `bloatThresholdBytesByTool` non-object falls back to the default map `{read:24576}`** rather than spec/09 §4's "discard entirely (use global only)" (`src/config.ts:346–349`). Spec-internal tension; the implemented general rule ("type-mismatch → default") is the safer reading, but it also resurrects the default `read` override after a user submits an invalid map.

**i-18. Advisory-layer degradations (spec-consistent, documented in-code):** mutation warning suppressed when the ledger preview throws; context-fraction stop reads the previous fire's filtered total (one-turn lag); `"Matched: no"` printed when an in-span match can't be mapped to a stable entry id (marker still persists, filter live-resolves); structural-impossibility refusal uses its own discriminator message rather than the "previous turn" string (deliberate per design doc).

**i-19. Duplicated binary-search helper** — the inline exact-match search in `filterPipeline`'s pinned path (`transforms.ts:1754–1763`) duplicates `lowerBoundAsc` (`:1546–1561`). Equivalent behavior; DRY nit.

---

## What was verified correct (highlights)

- **v2.0 current-turn scoping — both ends.** Creation: hard refusal with the exact spec string, zero persistence (`shrink.ts:368`); earlier-turn `by_tool_call_id` and no-match-this-turn selectors both refused. Filter: per-fire `markerTurnSpan` enforcement on pinned (span-check before substitution) and live (conservative translated span) arms; fail-safe no-ops on compaction/misalignment; persistence across later turns without cross-turn drift — confirmed in code, tests, **and** live simulation (incl. N+2 same-toolName non-application).
- **Guardrails.** `last_turn`/`last_tool_call_group` never hide a `user` message; `first:user` unconditionally protected (`protectedOk` on both pinned and legacy paths); checkpoint consent flow (fair warning, banner, auto-expiry on consumption, revoke) verified end-to-end.
- **E22 guards.** Retry budget refuses pre-persist with the exact text and resets on a new prompt; context-fraction stop refuses at ≥90% of the *filtered* window even with budget remaining (D5-compliant); shrink/audit remain callable after a budget hit; disabled mode is a full no-op (filter pass-through + all 4 tools + 3 commands refuse).
- **Nudges.** Nudge A rides the result with the per-tool threshold (read 24 KB, bash/global 16 KB); Nudge B is windowed, delta-only, awareness-only (v2.0 tail verified live), never persisted; §5.3 acted-suppression and E22 refusal-suppression wired.
- **C13/E27 defense.** `prepareObjectArgs` repairs JSON-string object params (rewind/shrink/cancel), passes malformed input through honestly; audit carries no shim.
- **Persistence shapes.** Envelope/seq/ts on all four marker kinds; uuid `id` only on rewind/shrink; cancel `targetId` = uuid semantics; `getLeafId()` captured immediately after `appendEntry` (C7); note as `custom_message` (in-context), markers as `custom` (not in-context).
- **Docs.** README 21-knob defaults table matches `DEFAULT_CONFIG` value-for-value; shrink/audit/cancel quotes verbatim.

## Artifacts

- `validate.sh` — 5-phase validator (typecheck → unit → isolated smoke → 52-assertion E2E journey suite → docs contract). Current result: 3/5 phases green; failures are exactly M-1 (via its isolated-mode note), M-4, m-5, m-6.