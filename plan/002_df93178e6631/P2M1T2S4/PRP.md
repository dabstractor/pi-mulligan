name: "P2.M1.T2.S4 — Final cross-cutting documentation sweep (per-tool bloat threshold)"
description: |

---
## ⚠️ READ THIS HEADER FIRST — Re-planning rationale (Attempt 2/3)

This is a **revised** PRP. Attempt 1 scoped S4 to README.md only. That PRP's own acceptance
criteria ALL passed and README.md is fully correct in the working tree — BUT `npm test`
(Level 3 regression guard) reported **1 failure in `test/tools/audit.test.ts`**, so the
orchestrator flagged an issue.

**Root cause (now fully diagnosed):**
- The test-impact analysis that guided the task breakdown
  (`plan/002_df93178e6631/architecture/test_impact_analysis.md`) listed every file that needed
  updates for the 8192→16384 threshold change **EXCEPT `test/tools/audit.test.ts`**. It only
  enumerated `test/nudges.test.ts` (S2), `test/config.test.ts` (S1/S2),
  `test/integration/smoke.ts` (S3), and `README.md` (S4).
- Therefore no implementing subtask (S1–S3) owned `audit.test.ts`, and S4 (narrow README task)
  left `npm test` red.
- `test/tools/audit.test.ts:416-426` uses fixture `kbText(10)` (= 10 240 bytes) with toolName
  `"read"` and asserts the bloat flag fires with `"(8 KB)"`. But the audit tool computes
  `bloaty` against the **GLOBAL** `config.nudges.bloatThresholdBytes` (see `src/tools/audit.ts:520`
  `const threshold = config.nudges.bloatThresholdBytes;` and `:529 bloaty: messageBytes(msg) > threshold`).
  S1 raised that global default to **16384** (16 KB), so 10 240 bytes is now BELOW threshold →
  `bloaty=false` → `expect(...).toBe(true)` fails. (Note: the audit flag is intentionally GLOBAL;
  per-tool resolution lives only in the nudge handler via `bloatThresholdFor`, wired by S1.)

**Revised scope decision.** S4's contract literally says: *"DOCS: [Mode B] … the final sweep
for cross-cutting docs."* A stale-threshold reference that (a) blocks the project's only test
gate and (b) is purely a documentation/fixture-value casualty is exactly what a final
cross-cutting sweep must catch. **The revised S4 therefore sweeps ALL surviving stale
`8192`/`8 KB` documentation references**, not just README. This is the minimal change set that
turns `npm test` fully green and leaves no stale default-8192 docs in the Delta 002 changeset.

> **CRITICAL PRECISION RULE — do NOT do a global find/replace of `8192`→`16384`.** Many `8192`
> occurrences are INTENTIONAL (explicit threshold arguments to pure functions / math identities)
> and their tests PASS. Touching them will BREAK passing tests. Section "Stale vs Intentional"
> below lists EXACTLY which lines to change and which to leave untouched.

---

## Goal

**Feature Goal**: Complete the Delta 002 (per-tool bloat threshold) changeset so that
`README.md` accurately documents the new config defaults + per-tool resolution, **AND** the
project's full test suite (`npm test`) is green with **zero** surviving stale `8192`/"8 KB"
default documentation references.

**Deliverable**:
1. `README.md` — the 3 contracted documentation locations (config table, JSON example,
   How-It-Works bullet) reflecting `bloatThresholdBytes: 16384` + `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }`. *(Already correct in working tree — VERIFY only.)*
2. `test/tools/audit.test.ts` — fix the **1 failing test** + its stale comment so `npm test`
   passes. *(REQUIRED for the Level 3 gate.)*
3. `src/*.ts` — fix the surviving stale "default 8192" **JSDoc** comments (doc accuracy;
   zero runtime impact). *(Final cross-cutting docs sweep.)*

**Success Definition**: `npm test` → **0 failed**; `grep -nE "8192|8 KB|8KB" README.md` → empty;
no stale "default 8192" remains in `src/*.ts` JSDoc; the intentional explicit-threshold tests
in `test/notes.test.ts` / `test/tokens.test.ts` / `test/config.test.ts` remain UNTOUCHED and green.

## Why

- **Unblocks the milestone.** `npm test` is the project's sole deterministic gate (no `build`
  script exists — `package.json` defines only `test` and `smoke`). A red suite blocks P2.M1
  from being marked Complete and blocks any downstream merge confidence.
- **S4 is the designated sweep.** The contract assigns S4 as "the final sweep for cross-cutting
  docs" that "depends on all implementing subtasks." A stale-threshold test fixture + stale
  JSDoc are cross-cutting doc casualties that slipped past S1's "update JSDoc" mandate and the
  (incomplete) test-impact analysis.
- **Honesty of the codebase.** Leaving `// default 8192` JSDoc next to a `16384` default is the
  kind of "garbage in" a PRP exists to eliminate.

## What

### User-visible behavior
None — this is a documentation + test-fixture sync. No runtime behavior changes (README is prose;
audit test fixture resize exercises the SAME code path; JSDoc is comments).

### Technical requirements
1. README.md documents the per-tool bloat config accurately (3 locations). **Already done — verify.**
2. The single failing audit bloat-flag test is corrected to use a fixture above the **global 16384**
   threshold and assert the `"(16 KB)"` flag string.
3. Stale "default 8192" JSDoc in `src/tools/audit.ts`, `src/notes.ts`, `src/nudges.ts` → "default 16384".

### Success Criteria
- [ ] `npm test` → **Test Files: 0 failed | Tests: 0 failed** (currently 1 failed in audit.test.ts).
- [ ] `grep -nE "8192|8 KB|8KB" README.md` → **empty**.
- [ ] `git status` source changes are limited to: `README.md`, `test/tools/audit.test.ts`,
      and (JSDoc-only) `src/tools/audit.ts`, `src/notes.ts`, `src/nudges.ts`. Nothing else.
- [ ] The intentional `8192` occurrences (listed in "Stale vs Intentional") are UNTOUCHED and still pass.

## All Needed Context

### Documentation & References

```yaml
# MUST READ — the research that (incompletely) guided the breakdown; explains WHY audit.test.ts was missed
- file: plan/002_df93178e6631/architecture/test_impact_analysis.md
  why: enumerates per-file test/doc updates for the 8192→16384 change. NOTE: it does NOT list
       test/tools/audit.test.ts — that omission is the root cause this PRP corrects.
  critical: do NOT treat this file as exhaustive for test files; audit.test.ts is the gap.

# MUST READ — source of truth for all defaults
- file: src/config.ts
  why: DEFAULT_CONFIG (the values README + tests + JSDoc must match).
  pattern: "nudges.bloatThresholdBytes = 16384", "nudges.bloatThresholdBytesByTool = { bash: 32768, read: 20480 }", "driftThresholdTokens = 3000"

# MUST READ — proves the audit bloat flag uses the GLOBAL threshold (not per-tool)
- file: src/tools/audit.ts
  why: line 520 `const threshold = config.nudges.bloatThresholdBytes;` and line 529
       `bloaty: messageBytes(msg) > threshold`. This is WHY the test fixture must exceed 16384,
       regardless of toolName. Per-tool resolution (bloatThresholdFor) lives ONLY in the nudge handler.
  gotcha: the audit flag is intentionally GLOBAL; do NOT "fix" it to be per-tool.

# MUST READ — the failing test
- file: test/tools/audit.test.ts
  why: lines 416-426 (the failing test), line 289 (stale comment), the kbText helper at line 256.
  pattern: "function kbText(kb: number): string { return \"x\".repeat(kb * 1024); }" → kbText(20) = 20480 bytes.

# The core deliverable (contracted) — verify it is already correct
- file: README.md
  why: the 3 locations S4 was originally scoped to (config table ~L91, JSON example ~L108,
       How-It-Works bullet ~L204). All 3 are ALREADY correct in the working tree.
```

### Current Codebase tree (relevant slice)

```bash
README.md                       # CONTRACTED deliverable (verify only — already correct)
src/config.ts                   # DEFAULT_CONFIG source of truth (READ ONLY — do not change)
src/tools/audit.ts              # bloat flag logic (L520/529) + stale JSDoc (L301)
src/notes.ts                    # stale JSDoc (L275) + math example (L346, LEAVE)
src/nudges.ts                   # stale JSDoc (L16)
src/tokens.ts                   # math example (L284, LEAVE)
test/tools/audit.test.ts        # THE FAILING TEST (L416-426) + stale comment (L289)
test/notes.test.ts              # INTENTIONAL explicit-threshold 8192 refs (LEAVE)
test/tokens.test.ts             # math identity (L334, LEAVE)
test/config.test.ts             # string non-coercion test (L97, LEAVE)
test/integration/smoke.ts       # owned by S3 (already updated — LEAVE)
package.json                    # scripts: { test, smoke } — NO build script
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — audit bloat flag is GLOBAL, not per-tool (src/tools/audit.ts:520-529).
//   const threshold = config.nudges.bloatThresholdBytes;   // 16384 after S1
//   bloaty: messageBytes(msg) > threshold,
// The failing test's toolName "read" is IRRELEVANT to the audit flag. The fixture must exceed
// 16384 (the global default), NOT 20480 (the read per-tool value). Use kbText(20)=20480.

// CRITICAL — no `npm run build` script exists. package.json defines only `test` and `smoke`.
//   Do NOT run `npm run build` (it errors). The Level 1/2/3 gates are: ruff-equivalent = none
//   (TS project); the gate is `npm test`.

// CRITICAL — README.md is NOT imported by any src/ or test/ file (pure prose). Its correctness
//   cannot affect `npm test`. The test failure is 100% from audit.test.ts.

// GOTCHA — kbText(N) = "x".repeat(N*1024) bytes. kbText(10)=10240 < 16384 (fails). kbText(20)=20480 > 16384 (passes).

// GOTCHA — `setConfig({})` in the test applies DEFAULT_CONFIG (bloatThresholdBytes=16384). Do not
//   inject a per-config override to "make it pass" — the test must validate the DEFAULT global threshold.
```

## Implementation Blueprint

### Stale vs Intentional — the EXACT scope of `8192` changes

**CHANGE (stale — fix these):**
| Location | Current | Target |
|---|---|---|
| `test/tools/audit.test.ts:289` comment | `// defaults: confidence medium, threshold 8192` | `// defaults: confidence medium, bloatThresholdBytes 16384 (16 KB global)` |
| `test/tools/audit.test.ts:422` comment | `// 10 KB > 8 KB threshold → bloaty` | `// 20 KB > 16 KB global threshold → bloaty` |
| `test/tools/audit.test.ts:421` fixture | `kbText(10)` | `kbText(20)` |
| `test/tools/audit.test.ts:426` assertion | `toContain("⚠ above bloat threshold (8 KB)")` | `toContain("⚠ above bloat threshold (16 KB)")` |
| `src/tools/audit.ts:301` JSDoc | `(default 8192 = 8 KB)` | `(default 16384 = 16 KB)` |
| `src/notes.ts:275` JSDoc | `(config.nudges.bloatThresholdBytes, default 8192)` | `(config.nudges.bloatThresholdBytes, default 16384)` |
| `src/nudges.ts:16` JSDoc | `(default 8192 ≈ 2k tokens)` | `(default 16384 ≈ 4k tokens)` |

**LEAVE UNTOUCHED (intentional / passing — changing these BREAKS green tests):**
| Location | Why it's intentional |
|---|---|
| `test/notes.test.ts` (all `renderBloatReminder("read", 8192, 8192)` etc.) | Passes `8192` as an EXPLICIT threshold argument to a pure rendering fn. Output "(8 KB)" is correct for input 8192. Tests PASS. |
| `test/tokens.test.ts:334` `approxTokens(8192)).toBe(2048)` | Math-identity test of the token estimator at a fixed input. PASS. |
| `test/config.test.ts:97` `bloatThresholdBytes: "8192").toBe(16384)` | Tests that a STRING is NOT coerced (falls back to default 16384). PASS. |
| `test/tools/audit.test.ts:684,714,734` `thresholdBytes: 8192` | Unit tests of `renderAuditReport` passing an EXPLICIT threshold param; expected "(8 KB)" output is correct. PASS. |
| `src/notes.ts:346` `bytesToKb(8192)=8`, `src/tokens.ts:284` `approxTokens(8192)=2048` | Function-behavior math examples at a fixed input (accurate as math, not "default" refs). |

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY README.md is already correct (DO NOT re-edit unless a check fails)
  - RUN: grep -nE "8192|8 KB|8KB" README.md   → must be EMPTY
  - CHECK config-table row: `| \`nudges.bloatThresholdBytes\` | \`16384\` |` exists, mentions "16 KB" + per-tool precedence
  - CHECK new row: `| \`nudges.bloatThresholdBytesByTool\` | \`{ "bash": 32768, "read": 20480 }\` |` exists immediately after
  - CHECK jsonc example contains: bloatThresholdBytes: 16384, bloatThresholdBytesByTool map, driftThresholdTokens: 3000 (// commented, ```jsonc fence preserved)
  - CHECK How-It-Works bullet reads: per-tool bloat threshold (bash: 32 KB, read: 20 KB, others: 16 KB global default)
  - CHECK header: "All 13 knobs" appears exactly once
  - IF ALL PASS: README needs zero edits. Move to Task 1. (This is the expected state — Attempt 1 already did README.)

Task 1: FIX the failing test — test/tools/audit.test.ts (REQUIRED for green npm test)
  - EDIT line ~289 comment: `// defaults: confidence medium, threshold 8192`
        → `// defaults: confidence medium, bloatThresholdBytes 16384 (16 KB global)`
  - EDIT the failing test (lines ~416-426), three changes inside the SAME `it(...)`:
      * fixture:  `toolResult("call-A", "read", kbText(10)), // 10 KB > 8 KB threshold → bloaty`
        →        `toolResult("call-A", "read", kbText(20)), // 20 KB > 16 KB global threshold → bloaty`
      * assertion: `expect(firstText(res)).toContain("⚠ above bloat threshold (8 KB)")`
        →          `expect(firstText(res)).toContain("⚠ above bloat threshold (16 KB)")`
  - DO NOT change the `expect(res.details.top[0].bloaty).toBe(true)` line (it stays true now that 20480 > 16384).
  - DO NOT touch lines 684/714/734 (renderAuditReport explicit-threshold unit tests — they PASS).
  - NAMING/PLACEMENT: keep the describe/it structure, the toolName "read", and `beforeEach(() => setConfig({}))`.
  - WHY kbText(20): audit.ts:520 uses the GLOBAL bloatThresholdBytes (16384), NOT the read per-tool value.
        20*1024 = 20480 > 16384 → bloaty=true. (10*1024=10240 < 16384 was the failure.)

Task 2: FIX stale "default 8192" JSDoc in src/*.ts (doc-accuracy sweep, zero runtime impact)
  - EDIT src/tools/audit.ts ~line 301: `config.nudges.bloatThresholdBytes\` (default 8192 = 8 KB).`
        → `(default 16384 = 16 KB).`
  - EDIT src/notes.ts ~line 275: `@param thresholdBytes ... (config.nudges.bloatThresholdBytes, default 8192)`
        → `... default 16384)`
  - EDIT src/nudges.ts ~line 16: `... (default 8192 ≈ 2k tokens), the handler`
        → `... (default 16384 ≈ 4k tokens), the handler`
  - DO NOT touch src/notes.ts:346 or src/tokens.ts:284 (math examples — accurate, not default refs).
  - DO NOT change any executable code — comments only.

Task 3: FINAL STALE-REF SWEEP (verification, not editing)
  - RUN: grep -rnE "default 8192|8192 = 8 KB" src/  → must be EMPTY
  - RUN: grep -nE "8192|8 KB|8KB" README.md          → must be EMPTY
  - Any remaining src/ 8192 hit must be either a math example (notes.ts:346, tokens.ts:284) or
    an intentional explicit-arg — confirm against the "LEAVE UNTOUCHED" table before stopping.
```

### Implementation Patterns & Key Details

```typescript
// The failing test AFTER the fix (Task 1) — the only behavioral assertion that changes:
it("flags a toolResult whose bytes exceed config.nudges.bloatThresholdBytes", async () => {
  const { ctx } = makeCtx();
  getRuntime("s1").lastFiltered = [
    toolResult("call-A", "read", kbText(20)), // 20 KB > 16 KB global threshold → bloaty
  ];
  const res = await run(ctx, {});
  expect(res.details.top[0].bloaty).toBe(true);                 // unchanged — now true (20480 > 16384)
  expect(firstText(res)).toContain("⚠ above bloat threshold (16 KB)"); // 16384/1024 = 16
});

// WHY (16 KB): the flag string is built in src/tools/audit.ts renderAuditReport as
//   `⚠ above bloat threshold (${kb} KB)` where kb = thresholdBytes/1024 = 16384/1024 = 16.
// The audit tool passes config.nudges.bloatThresholdBytes (16384) as thresholdBytes in the run path.
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none (DEFAULT_CONFIG already correct in src/config.ts from S1 — READ ONLY)
ROUTES: none
BUILD: none (no build script — package.json has only `test` and `smoke`)
GIT: source changes limited to README.md, test/tools/audit.test.ts, and JSDoc-only edits to
     src/tools/audit.ts, src/notes.ts, src/nudges.ts. Nothing else should appear in `git status`.
```

## Validation Loop

### Level 1: Stale-reference sweep (run after each task)

```bash
# README must be clean (Task 0 verify)
grep -nE "8192|8 KB|8KB" README.md              # Expected: EMPTY

# No stale "default 8192" JSDoc remains in src (Task 2 verify)
grep -rnE "default 8192|8192 = 8 KB" src/        # Expected: EMPTY
# (Remaining src 8192 hits MUST be only: src/notes.ts:346, src/tokens.ts:284 — math examples. Verify.)

# Source change set is bounded (Task 3 verify)
git status --short                              # Expected: README.md, test/tools/audit.test.ts,
                                                # src/tools/audit.ts, src/notes.ts, src/nudges.ts ONLY
```

### Level 2: Unit tests (THE gate)

```bash
npm test                                        # Expected: Test Files 0 failed | Tests 0 failed
# Specifically confirm the previously-failing test now passes:
npx vitest run test/tools/audit.test.ts -t "flags a toolResult whose bytes exceed"  # Expected: PASS
# Full audit file green:
npx vitest run test/tools/audit.test.ts         # Expected: 38 tests | 0 failed
```

### Level 3: Full suite + regression (system validation)

```bash
npm test 2>&1 | tail -8                         # Expected: "Test Files  0 failed" / "Tests  0 failed"

# Confirm no NEW stale default references leaked in (the whole point of the sweep):
grep -rnE "default 8192|threshold 8192|= 8 KB" src/ README.md test/tools/audit.test.ts  # Expected: EMPTY

# Confirm the intentional explicit-threshold tests still pass (must remain UNTOUCHED):
npx vitest run test/notes.test.ts test/tokens.test.ts test/config.test.ts   # Expected: all PASS
```

### Level 4: Doc-accuracy review (manual)

- [ ] Open `README.md` §3 — config table shows `bloatThresholdBytes | 16384` + the new
      `bloatThresholdBytesByTool` row with `{ "bash": 32768, "read": 20480 }`.
- [ ] The commented jsonc example shows all three nudges keys with the new defaults.
- [ ] §5 How-It-Works bullet describes per-tool resolution (bash 32 KB / read 20 KB / others 16 KB).
- [ ] `src/tools/audit.ts` JSDoc now says "default 16384 = 16 KB" (matches the code).

## Final Validation Checklist

### Technical Validation
- [ ] `npm test` → **0 failed** (the single hard gate; was 1 failed pre-fix).
- [ ] `grep -nE "8192|8 KB|8KB" README.md` → empty.
- [ ] `grep -rnE "default 8192|8192 = 8 KB" src/` → empty.
- [ ] `git status` changes bounded to the 5 expected files; no other source touched.

### Feature Validation
- [ ] Failing audit test (`flags a toolResult whose bytes exceed…`) now PASSES with `kbText(20)` + `"(16 KB)"`.
- [ ] README 3 locations accurate vs `src/config.ts` DEFAULT_CONFIG (16384 / {bash:32768, read:20480} / 3000).
- [ ] Stale "default 8192" JSDoc in audit.ts/notes.ts/nudges.ts updated to 16384.
- [ ] Intentional 8192 refs (notes.test.ts, tokens.test.ts, config.test.ts, audit.test.ts:684/714/734,
      notes.ts:346, tokens.ts:284) UNTOUCHED and still green.

### Code Quality Validation
- [ ] No global find/replace of `8192`→`16384` (would break intentional explicit-threshold tests).
- [ ] README edits (if any) preserve the `// ` comment prefix and ` ```jsonc ` fence in the example block.
- [ ] JSDoc edits are comment-only — no executable code changed in src/.

### Documentation & Deployment
- [ ] README is self-consistent (13 knobs header == 13 config-table rows == DEFAULT_CONFIG field count).
- [ ] No new env vars / config keys introduced (this is a doc + fixture sync only).

---

## Anti-Patterns to Avoid

- ❌ Don't do a blanket `8192`→`16384` replace across the repo — it breaks the intentional
  explicit-threshold unit tests in `test/notes.test.ts` and the math-identity tests.
- ❌ Don't "fix" the audit bloat flag to use per-tool resolution — it is intentionally GLOBAL
  (`src/tools/audit.ts:520`); per-tool lives only in the nudge handler. Just resize the fixture.
- ❌ Don't run `npm run build` — no such script exists (`package.json` has only `test`, `smoke`).
- ❌ Don't inject a `setConfig({...})` override to force the test green — it must validate the
  DEFAULT global threshold (16384) via the existing `beforeEach(() => setConfig({}))`.
- ❌ Don't re-edit README.md if Task 0's grep + checks all pass — Attempt 1 already did it correctly;
  re-editing risks introducing the very inconsistencies this sweep removes.
- ❌ Don't touch `test/integration/smoke.ts` — owned by S3, already updated.