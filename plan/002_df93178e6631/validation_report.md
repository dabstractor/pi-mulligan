# pi-mulligan — Validation / Bug Tracker Report

**Generated:** by an independent validation pass (read-only; no source modified).
**Scope:** deep codebase analysis + automated validation (`./validate.sh`) + live E2E exercising of the running extension.
**Target:** Pi `0.84.x` extension — agent self-rewind / context control via persisted markers + a `context`-event view transform.

---

## TL;DR

| Aspect | Verdict |
|---|---|
| Static type check (`tsc --noEmit`, strict) | ✅ Clean |
| Unit tests (`vitest`) | ❌ **1 failing** (721/722) — stale test vs raised default |
| Integration smoke (`npm run smoke`, fresh state) | ✅ 14/14 |
| Integration smoke (repeated run) | ❌ **Not idempotent** — 2 core regression guards flake |
| §2.3 invariants (entry types, ZERO persisted nudges) | ✅ Hold |
| Zero-config load | ✅ Works |
| Plan completeness (`tasks.json`) | ✅ 66/66 items Complete |
| Product correctness (core pinned-hide feature) | ✅ Verified correct |

**Headline:** the **product code is correct** — the core mechanism (pinned `hideEntryIds` permanent soft-delete) is verified working end-to-end on fresh sessions. The defects found are in the **test harness and one stale unit test**, plus one documented-but-underreported **test-hygiene sharp edge**. None are user-facing breakage, but two undermine trust in the acceptance gates.

---

## Findings

### 🔴 FINDING 1 (HIGH) — `npm run smoke` is not idempotent; the two headline regression guards fail on every non-first run

**Symptom.** Running `npm run smoke` a second time (back-to-back, no cleanup) fails 2 of 14 scenarios — and they are the most important ones:

```
✗ seed reply HIDDEN on observing inference (BUG-001/002 guard) — {"seedHiddenInAssistant":true,"note":"LEAKED BACK …"}
FAIL F-rewind-core
✗ post-checkpoint seed hidden + anchor survives (BUG-003/001 guard) — {"seedHiddenInAssistant":true,…,"note":"post-checkpoint seed LEAKED BACK …"}
FAIL F-checkpoint
12/14 scenarios passed
```

**Reproduction (deterministic).**
1. Clear smoke sessions → `npm run smoke` → **14/14 pass**.
2. Immediately `npm run smoke` again → **12/14, F-rewind-core + F-checkpoint FAIL**.
(Verified by inspecting the per-scenario logs in `/tmp/mulligan-smoke/*.log` and the session JSONLs.)

**Root cause — test-harness state leakage, NOT a product regression.**
- `test/integration/run-smoke.mjs` spawns every scenario with a **stable** `--session-id smoke-<scenario>`. Pi **appends** to that same session JSONL on every run (F-reload actually relies on this within a single run).
- The F-rewind-core seed flow injects an assistant reply containing the literal `MULLIGAN-SMOKE-SEED-HIDDEN` each run. Across runs these **accumulate**.
- The regression guard asserts `seedHiddenInAssistant === false` — i.e. *no* assistant message in the filtered view may contain `SEED_HIDDEN`. But each run's `mulligan_rewind` pins only *that run's* seed reply (via the stable `hideEntryIds`). Prior runs' seed replies have **different stable entry ids** that no current marker covers, so they remain visible → the guard fires "LEAKED BACK".
- Concretely, the F-rewind-core session JSONL at failure held **3** `SEED_HIDDEN` assistant replies (entry ids `a9548931`, `e5ae5aeb`, `3c7d758f`) but only **2** rewind markers pinning **2** of them (`a9548931`, `3c7d758f`). The unpinned leftover `e5ae5aeb` (from an earlier run) is what the guard saw.

**Why this matters / severity.** F-rewind-core and F-checkpoint are the **BUG-001 / BUG-002 / BUG-003 regression guards** — i.e. the guards for the single most important feature in the codebase (the `hideEntryIds` pinned-anchor permanent-hiding fix, ~400 LOC across `resolvePinnedHide`, `captureHideEntryIds`, and the `filterPipeline` dispatch). A CI loop or any developer running the suite twice will see real-looking "LEAKED BACK" failures that are **false alarms**, eroding confidence in the acceptance gate. Worse, the failure message literally says "BUG-001/002 regression: pinned hide lost," which reads as a severe product regression when it is not.

**The product code is correct.** On fresh sessions 14/14 pass; the pinned-hide mechanism removes *exactly* the pinned entry ids (verified by JSONL inspection: the two pinned `SEED_HIDDEN` replies are hidden; only the unpinned prior-run leftover survives).

**Inaccuracy in `VERIFICATION.md`.** The repo's own DoD report acknowledges session-reuse flakiness — but **only for `F-protected`** (VERIFICATION.md §"DoD #2 — smoke session reuse"). It **misses** that F-rewind-core + F-checkpoint *also* flake, and its top-of-file claim that *"All gates were green on first run and remained green after a final sequential re-run"* does not hold for a literal repeated `npm run smoke`.

**Suggested fix (for the maintainers).** Give each scenario a **run-scoped unique `--session-id`** (e.g. `smoke-<scenario>-<timestamp>`) in `runPi()`, so no cross-run accumulation occurs. (`validate.sh` works around this for now by clearing smoke sessions before the smoke phase.)

---

### 🟠 FINDING 2 (MEDIUM) — `npm test` has one deterministic failure: the audit bloat-flag test is stale vs the raised 16 KB default

**Symptom.**
```
FAIL test/tools/audit.test.ts > mulligan_audit — bloat flag …
  > flags a toolResult whose bytes exceed config.nudges.bloatThresholdBytes
  expected false to be true  (res.details.top[0].bloaty)
Test Files 1 failed | 17 passed   ·   Tests 1 failed | 721 passed (722)
```

**Root cause — stale test + stale docstrings; product code is correct.**
- The shipped global default is **`bloatThresholdBytes: 16384` (16 KB)** — set in `src/config.ts:109` `DEFAULT_CONFIG`, documented in `spec/09-configuration.md` §66 (*"Raised from 8 KB after observation: the 8 KB default nagged on every routine source-file read … 16 KB lets a typical source file through"*), and reflected in `README.md`. This was a deliberate, spec-pinned change.
- The audit bloat flag compares against the **global** `config.nudges.bloatThresholdBytes` (`src/tools/audit.ts` `messageBytes`).
- The failing test (`test/tools/audit.test.ts:414-426`) creates a **10 KB** `read` tool result and asserts `bloaty === true` on the assumption the threshold is **8192 (8 KB)** (its `beforeEach` comment literally says *"threshold 8192"* at line 289, and the section header says "8 KB"). With the shipped 16 KB default, **10 KB < 16 KB → `bloaty === false` → test fails**.
- The test + several comments were never updated when the default was raised from 8 KB → 16 KB (recent `per-tool bloat thresholds` commits).

**Stale "8 KB / 8192" references that should say 16 KB / 16384:**
| Location | Current (stale) |
|---|---|
| `test/tools/audit.test.ts:21` | "bloat threshold (8 KB)" |
| `test/tools/audit.test.ts:289` | `// defaults: … threshold 8192` |
| `test/tools/audit.test.ts:414` | "8 KB" section comment |
| `test/tools/audit.test.ts:426` | asserts `"⚠ above bloat threshold (8 KB)"` |
| `src/nudges.ts:16` | "default 8192 ≈ 2k tokens" |
| `src/notes.ts:275` | "default 8192" |
| `src/tools/audit.ts:301` | "default 8192 = 8 KB" |
| `src/tools/audit.ts:367` | example "8 KB" |

**Suggested fix (for the maintainers).** Either make the test create a result above the real 16 KB default (e.g. `kbText(20)`), or pin the threshold in the `beforeEach` (`setConfig({ nudges: { bloatThresholdBytes: 8192 } })`); and update the stale comments. No `src/` logic change is needed — the default is correct per the PRD.

---

### 🟡 FINDING 3 (LOW / sharp edge) — `mulligan_shrink` with `by_tool_name`+`occurrence:"last"` (or `by_content_includes`) is a moving target

**Observed live during this validation pass.** I called `mulligan_shrink` with `{ by_tool_name:"read", occurrence:"last", … }`. The substitution then **re-applied to the *next* `read` result** (a subsequent `read src/config.ts`) on the following context fire — clobbering an unrelated, later read with the fixed summary text. This is *exactly* the class of "moving target" bug that motivated the `hideEntryIds` pinned-anchor fix for **rewinds** (BUG-001/002).

**Why.** Per `spec/06 §5`, shrink targets "resolve against the current messages each inference." `filterPipeline` applies shrinks in a loop where **each `applyShrink` re-resolves its target live** (`src/transforms.ts` `filterPipeline` shrink loop → `applyShrink` → `resolveShrinkTarget`). Critically, **`ShrinkMarker` has no `hideEntryIds` pinning** (only `RewindMarker` does — confirmed in `src/markers.ts`), so a `by_tool_name`+`last` or `by_content_includes` shrink keeps matching the *latest* matching message forever, including ones created long after the shrink was issued.

**Severity / framing.** This is **lower-stakes than the rewind case** (a shrink substitutes content rather than un-hiding deleted content), and it is **"working as designed"** (live re-resolution is what makes shrinks compaction-robust per `spec/04 §4`). The tool's own description nudges toward the safe `by_tool_call_id` (stable). But the asymmetry is worth flagging: rewinds were hardened against moving-target regressions with pinned entry ids; **shrinks were not**, so `by_tool_name`+`last` / `by_content_includes` remain footguns that can silently rewrite future unrelated results. A future hardening (e.g. pin the matched entry id at first successful resolution, like rewinds) would close the gap.

---

## What works well (positive evidence)

- **Strict types clean.** `tsc --noEmit` exits 0 under `"strict": true, "noImplicitAny": true`. The deliberate "Pi-free pure modules" invariant (`transforms.ts`, `tokens.ts`, `ledger.ts` — zero imports) holds.
- **Core feature verified end-to-end.** On fresh sessions the pinned-hide permanent soft-delete works: each `mulligan:rewind` marker pins specific **stable entry ids** (`hideEntryIds`), and `resolvePinnedHide` removes exactly those messages every context fire. JSONL inspection confirms the pinned `SEED_HIDDEN` replies are hidden while a leftover unpinned one survives — proving the *identity-based* (not positional) hiding is correct and that new work with new entry ids stays visible (the BUG-001/002 fix).
- **§2.3 invariants hold** (asserted in Phase 4 across 14 smoke session files): `mulligan:rewind`/`shrink`/`turn-metric` are all `type:"custom"` (control state, NOT in context); `mulligan:note` is `type:"custom_message"` (IN context); `mulligan:checkpoint:` is `type:"label"`; and **ZERO `mulligan:nudge` entries are ever persisted** (nudges are ephemeral, constructed only in the filtered copy) — matching the design principle "zero extra requests."
- **Fail-open discipline is consistent.** Every handler (`contextHandler`, `bloatReminderHandler`, `turnEndMetricHandler`) and every tool wraps its whole body in try/catch → pass-through; the pure resolvers use `isRecord`/`readOwn` everywhere so Proxy traps and malformed inputs never throw. F-failopen passes; the malformed-marker unit tests pass.
- **Plan complete.** All 66 items in `plan/001_*/tasks.json` are `Complete`.
- **Excellent config resilience.** `validateConfig` never throws (adversarial input → defaults); every knob has a safe default; `bloatThresholdBytesByTool` per-tool override map coerces correctly.
- **Zero-config load works** (Phase 5): the factory loads with no `mulligan` config block and no error.

---

## Notes on the validation approach

- `./validate.sh` runs 5 phases: type check → unit tests → integration smoke → §2.3 invariants → zero-config load. It **clears accumulated smoke session files before the smoke phase** as an explicit, documented workaround for FINDING 1, so the suite is reproducible. Exit status is 0 only if all phases pass.
- The integration smoke (`npm run smoke`) is the authoritative E2E: it spawns real `pi` processes loading the real extension and a deterministic command-path that persists markers **before** any model call, so the core assertions hold even when the model times out / no API key is present. 12 scenarios additionally assert persisted JSONL entry shapes.
- Findings 1–3 were confirmed by direct session-JSONL inspection (`~/.pi/agent/sessions/.../...smoke-*.jsonl`) and by reproducing the pass/fail transition on fresh vs accumulated state.
- Per the validation mandate, **no source files were modified** — only `./validate.sh` and this report were written.