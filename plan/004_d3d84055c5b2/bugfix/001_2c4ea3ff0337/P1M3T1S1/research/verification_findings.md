# Verification Findings — P1.M3.T1.S1 (README Configuration + Disabling accuracy)

**Task**: Verify README.md §3 Configuration (lines 67–124) + Disabling subsection (lines 120–122)
are accurate AFTER the BUG-001 fix (P1.M1 settings-loading + P1.M2 type-safety gate).
This is a [Mode B] documentation-review + validation task. Output = README verified accurate;
minor clarifications only where the implementation diverges from what the README implies.

Ground truth read: `src/settings.ts`, `src/index.ts`, `src/config.ts` (DEFAULT_CONFIG +
MulliganConfig interface), `src/filter.ts`, `src/nudges.ts`, `src/tools/{rewind,shrink,cancel,
checkpoint,audit}.ts`, `spec/09-configuration.md`, README.md (lines 67–130).

---

## A. VERIFICATION MATRIX — each documented behavior → implementation status

| # | README claim (line) | Implementation evidence | Status |
|---|---------------------|------------------------|--------|
| 1 | :69 "reads `mulligan` from Pi `settings.json`" | `settings.ts:loadMulliganConfig()` → `return merged.mulligan` | ✅ accurate |
| 2 | :69 "global `~/.pi/agent/settings.json` + project-local `.pi/settings.json`" | `loadMulliganConfig`: `join(getAgentDir(),"settings.json")` + `join(cwd ?? process.cwd(),".pi","settings.json")` | ✅ accurate |
| 3 | :69 "project-local overrides global" | `deepMergeSettings(global, project)` — project wins on overlap; nested objects recurse; arrays replace | ✅ accurate |
| 4 | :69 "cached for the session" | `config.ts:getConfig()` caches validated config (structuredClone on read) | ✅ accurate |
| 5 | :69 "re-read on `/reload`" | `index.ts` `session_start` handler re-calls `setConfig(loadMulliganConfig(ctx.cwd))` on ALL reasons (startup\|reload\|new\|resume\|fork) | ✅ accurate |
| 6 | :71 zero-config / never throws / unknown keys ignored / type-mismatch→default+warn | fail-open throughout: `loadMulliganConfig` try/catch→undefined; `validateConfig` never throws; tested in `test/config.test.ts` + `test/settings.test.ts` | ✅ accurate |
| 7 | :80 `enabled:false` → entire extension no-op (see Disabling) | `filter.ts:240`, `nudges.ts:122` & `:200`, `tools/rewind.ts:454`, `tools/shrink.ts:263`, `tools/cancel.ts:182` all gate on `config.enabled` | ✅ accurate (see C1) |
| 8 | :122 refuse text `Mulligan: refused — Mulligan is disabled.` | `refusal()` helpers prepend `Mulligan: refused — ` + append `.`: `refuse("Mulligan is disabled")` → exact string. rewind.ts:176, shrink.ts:134, cancel.ts:117 | ✅ exact match (3 tools) |
| 9 | :109–118 minimal example values | all values match DEFAULT_CONFIG (maxDepth 5, maxRetriesPerPrompt 5, abortContextFraction 0.9, maxActive 32, staleAfterFires 3, bloatThresholdBytes 16384, bloatThresholdBytesByTool {bash:32768,read:20480}, driftThresholdTokens 6000, driftWindowTurns 3, highWaterFraction 0.7) | ✅ consistent |

## B. DISCREPANCIES / CLARIFICATIONS

### DISCREPANCY #1 (MUST FIX) — "17 knobs" count is wrong; it is 19.
- README:75 — `All 17 knobs (source of truth: src/config.ts DEFAULT_CONFIG; rationale: spec/09 §3).`
- The README's OWN table (lines 80–103) lists **19** knob rows.
- `spec/09-configuration.md` §3 table lists **19** knobs.
- `src/config.ts` `MulliganConfig` interface + `DEFAULT_CONFIG` have **19** leaf knobs.
- Authoritative 19: enabled; rewind.{enabled,protectedRoles,maxDepth,maxRetriesPerPrompt,abortContextFraction,requireMutationWarning}; shrink.{enabled,maxActive,staleAfterFires}; nudges.{bloatReminder,perTurnDrift,bloatThresholdBytes,bloatThresholdBytesByTool,driftThresholdTokens,driftWindowTurns,highWaterFraction}; audit.estimateConfidence; log.file.
- **FIX**: line 75 "17 knobs" → "19 knobs". Single grep confirms "17 knobs" appears ONCE in README.

### CLARIFICATION #1 (recommended) — "the tools refuse cleanly" is a blanket claim; checkpoint + audit are always-on.
- README:122 — `…the tools refuse cleanly with "Mulligan: refused — Mulligan is disabled.".`
- Reality: rewind/shrink/cancel refuse on `enabled:false` (✅). BUT `checkpoint` (checkpoint.ts
  "GOTCHA #4 — no config.checkpoint.enabled switch") and `audit` (audit.ts "GOTCHA #4 — audit is
  always-on diagnostics, does NOT refuse when config.enabled===false") have **no config gate**.
- This is a literal divergence from the blanket "the tools refuse cleanly" claim. Recommend a brief
  parenthetical naming the 3 refusing tools and noting checkpoint/audit stay available (read-only
  diagnostics). Low-risk, high-clarity. FINAL DECISION = implementer's (contract: "minor
  clarifications only if implementation diverges" — it does).

### CLARIFICATION #2 (likely NO change) — "loaded lazily on first use" vs eager-at-factory.
- README:69 — "loaded lazily on first use".
- Implementation loads EAGERLY at factory time (`setConfig(loadMulliganConfig(process.cwd()))` in
  the factory body) and re-reads at session_start.
- User-facing behavior is identical (read once at boot, cached, re-read on /reload). "First use" ≈
  "first load" is defensible. Contract asserts README is accurate. **RECOMMEND LEAVE AS-IS** (flag
  only). The "lazy" word is also the spec/09 §1 wording — changing it here would diverge from spec.

### SCOPING NOTE — contract step (c) "Pi's normal merge" parenthetical is a spec/09 edit, NOT a README edit.
- Contract step (c): "If the README's language about 'Pi's normal merge' is misleading… add a
  parenthetical: '(Mulligan reads the settings files directly and merges them internally…)'."
- BUT the README does NOT contain the phrase "Pi's normal merge". README:69 says
  "(project-local overrides global)" — implementation-neutral and ACCURATE.
- The phrase "Pi's normal merge" lives in **spec/09-configuration.md §1** ("project-local wins over
  global via Pi's normal merge"). That is SIBLING task **P1.M3.T1.S2**'s scope.
- THEREFORE for THIS task (README) step (c) is a NO-OP. Implementer should VERIFY README:69 contains
  no "Pi's normal merge" claim (it does not) and make NO README edit for the merge parenthetical.
  The `deepMergeSettings`-does-its-own-merge note goes in spec/09 (S2), not README.

## C. VALIDATION BASELINES (confirmed in this research session)
- `npm run typecheck` (= `tsc --noEmit`) → **exit 0** (typecheck script already added by parallel
  sibling P1.M2.T1.S2; the stale fixture from P1.M2.T1.S1 is fixed → green).
- `npx vitest run` → **912 tests pass** (21 files), 0 failures. (Baseline in contract is "882+";
  P1.M1 added `test/settings.test.ts` which raised the count to 912. 912 ≥ 882 ✅.)
- `test/settings.test.ts` EXISTS (8019 B) — the settings-loading surface (readSettingsFile,
  deepMergeSettings, loadMulliganConfig) is unit-tested. No new tests needed for this doc task.

## D. THE DELIVERABLE (concrete change set)
- **REQUIRED EDIT (1 line)**: README:75 "17 knobs" → "19 knobs".
- **RECOMMENDED EDIT (clarification, 1 sentence)**: README:122 — add a parenthetical naming the
  3 refusing tools + noting checkpoint/audit are always-on read-only diagnostics.
- **NO EDIT**: README:69 merge language (accurate), "lazy on first use" (judgment: leave), settings
  example (consistent), refusal string (exact match), zero-config block (accurate).
- **NO EDIT** to spec/09 here — that is sibling P1.M3.T1.S2.

## E. FILES READ (evidence)
README.md (67–130), spec/09-configuration.md (full), src/config.ts (DEFAULT_CONFIG + interface),
src/settings.ts (full), src/index.ts (full), src/filter.ts:240, src/nudges.ts:122/200,
src/tools/rewind.ts:174/176/452-455, src/tools/shrink.ts:128/132-134/263-264,
src/tools/cancel.ts:110/115-117/181-182, src/tools/checkpoint.ts:27/96-100,
src/tools/audit.ts:22-23, architecture/docs_spec_research.md, P1M2T1S2/PRP.md (parallel-sibling contract).