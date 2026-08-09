---
name: "P2.M1.T2.S3 — Update test/integration/smoke.ts threshold references"
description: "Refresh stale 8KB/8192 bloat-threshold comments in the integration smoke harness to reflect the new 16384 global default + per-tool overrides (bash 32768, read 20480), and correct the pre-existing misconception that the mulligan_smoke_big tool triggers the bloat reminder (it is skipped by the mulligan_* guard). Comment/string-only edits; no logic, no assertions change."
---

## Goal

**Feature Goal**: Every bloat-threshold reference in `test/integration/smoke.ts` — comments and the one tool-description string — accurately reflects the new configuration surface shipped by P2.M1.T2.S1 (global `bloatThresholdBytes = 16384`, per-tool `bloatThresholdBytesByTool = { bash: 32768, read: 20480 }`) and is *honest* about the fact that `mulligan_smoke_big` cannot trigger the bloat reminder at all (it is skipped by the handler's `mulligan_*` guard before any size check).

**Deliverable**: The edited `test/integration/smoke.ts` file — comments and the tool `description` string updated; `bigResult()` size left unchanged (it is moot w.r.t. bloat); no test assertions altered (none are threshold-dependent).

**Success Definition**: (1) No literal `8192` or unqualified `>8KB` / `(8KB)` bloat-threshold reference remains in `test/integration/smoke.ts`; (2) every updated comment names the new defaults AND notes the per-tool overrides where relevant; (3) comments that previously claimed `mulligan_smoke_big` "triggers the bloat reminder" now correctly state it is **skipped** by the `mulligan_*` guard; (4) `npm run build` (tsc) is clean and `npm test` (vitest) passes; (5) `node test/integration/run-smoke.mjs` still produces the `tool.smoke_big` log line (canary still emitted).

## User Persona

**Target User**: Mulligan maintainer / future AI agent running or reasoning about the integration smoke harness.

**Use Case**: Reading `smoke.ts` to understand what the `F-shrink-preventive` scenario does and why the deterministic path cannot prove `bloatHit:true`.

**Pain Points Addressed**: Stale `8192`/`8KB` comments mislead a reader into thinking the global default is still 8 KB; comments claiming `mulligan_smoke_big` "triggers the bloat reminder" are factually wrong (the tool is skipped) and would waste a debugger's time chasing a never-firing code path.

## Why

- **Honest bookkeeping (PRD §3 principle #5).** The handler now resolves thresholds per-tool (S1), so any comment citing a single "default 8192" is wrong. Comments are the only place a reader learns *why* the canary exists and what it can/can't prove — they must be accurate.
- **Corrects a pre-existing inaccuracy, not just a number.** The `mulligan_*` skip has always meant `mulligan_smoke_big` never triggers bloat; the old comments obscured this. The threshold change is the moment to fix both.
- **No behavioral change.** S1/S2 already shipped the real logic + the nudges unit tests. This task touches only documentation-in-code so the harness's self-description stops contradicting the code.

## What

Comment and one string-literal edits in **`test/integration/smoke.ts` only**. Numeric threshold references become the new values with per-tool notes; the false "triggers the bloat reminder" claim becomes an accurate "skipped by the `mulligan_*` guard" statement. `bigResult()` is NOT resized (resizing is pointless — see Known Gotchas). No assertion in `run-smoke.mjs` changes (verified: none are threshold-dependent).

### Success Criteria

- [ ] No occurrence of `8192` remains in `test/integration/smoke.ts`.
- [ ] No unqualified `>8KB` / `(8KB)` bloat-threshold reference remains; surviving "8KB"-style mentions (if any) explicitly tie to the per-tool/global values.
- [ ] The new global default `16384` (≈16 KB) and per-tool overrides `bash: 32768`, `read: 20480` are named in the updated comments.
- [ ] Comments at L14, L135–136, L198, L203, L493 no longer claim `mulligan_smoke_big` triggers the bloat reminder; they state it is **skipped** by the `mulligan_*` guard.
- [ ] `bigResult()` still returns the canary at the current size (NOT resized).
- [ ] `npm run build` clean; `npm test` green.

## All Needed Context

### Context Completeness Check

A reader who knows nothing about this codebase can implement this by following the per-line edit list below + the resolution table + the single load-bearing gotcha (`mulligan_*` skip). The only file touched is `test/integration/smoke.ts`; all decisions are pre-made (do NOT resize, do NOT change assertions).

### Documentation & References

```yaml
- file: test/integration/smoke.ts
  why: THE ONLY file to edit. Lines 14, 135-136, 139(comment), 198, 199-203, 493, 498.
  pattern: JSDoc block comments + one tool `description:` string literal.

- file: src/nudges.ts
  why: bloatReminderHandler + bloatThresholdFor — the source of truth for the skip + resolution.
  critical: "Line `if (event.toolName.startsWith(\"mulligan_\")) return;` runs BEFORE resultBytes()/bloatThresholdFor().
    So mulligan_smoke_big is ALWAYS skipped → bloat reminder NEVER fires for it, regardless of canary size.
    bloatThresholdFor(toolName, config): in byTool map ? that : global; falsy toolName → global."

- file: test/integration/run-smoke.mjs
  why: The integration asserter. CONFIRM it has NO threshold-dependent assertion (verified L251-260).
  critical: "L260 is a SOFT note string, not an assert(): 'bloatHit:true requires the model to call
    mulligan_smoke_big (model-driven); see scenarios.md'. Out of scope for S3 (item scopes to smoke.ts);
    leave as-is unless an adjacent cleanup is desired."

- file: spec/07-preventive-and-nudges.md
  why: Canonical rationale for the 16384 default (L52). Confirms new global default.
  critical: "spec/07 L52 + spec/09 L66 already state 16384 — these are the authoritative new values to cite."

- file: plan/002_df93178e6631/architecture/test_impact_analysis.md
  why: Names the exact 4 comment sites (L14/L136/L198/L493) this task addresses.
```

### Current Codebase tree (relevant slice)

```bash
test/integration/
├── run-smoke.mjs      # asserter; has NO threshold-dependent assertion (L251-260 soft note only)
├── scenarios.md       # model-driven scenario docs (NOT in scope — spec doc, Mode A none)
└── smoke.ts           # <<< EDIT THIS (comments L14,135-136,198,203,493 + string L498)
src/
└── nudges.ts          # source of truth: mulligan_* skip (GOTCHA #3) + bloatThresholdFor
```

### Desired Codebase tree

```bash
# No files added/removed. Only test/integration/smoke.ts is edited (comments + one string).
test/integration/smoke.ts   # MODIFIED — stale 8192/8KB comments + false "triggers bloat" claims corrected
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — THE mulligan_* SKIP (src/nudges.ts bloatReminderHandler):
//   if (event.toolName.startsWith("mulligan_")) return;   // GOTCHA #3 — BEFORE any size/threshold work
// "mulligan_smoke_big".startsWith("mulligan_") === true  →  ALWAYS skipped.
// => The bloat reminder NEVER fires for mulligan_smoke_big, no matter the canary size.
// => bigResult() size is now MOOT for bloat detection. Do NOT resize to >32KB (pointless).
//    The canary's remaining jobs: (a) shrink target (RESULT_CANARY observable), (b) "big result" shape.

// PER-TOOL RESOLUTION (bloatThresholdFor, from S1) — cite these in comments:
//   toolName="bash"   → 32768   (bloatThresholdBytesByTool.bash)
//   toolName="read"   → 20480   (bloatThresholdBytesByTool.read)
//   toolName=other    → 16384   (global bloatThresholdBytes — the catch-all)
//   toolName undefined/"" → 16384
//   toolName "mulligan_*"  → (skipped before resolve)
// NOTE: mulligan_smoke_big is NOT in the per-tool map → would resolve to global 16384 IF not skipped.

// jiti module-cache isolation: smoke.ts is a SEPARATE extension with its own config.ts instance.
// It cannot call setConfig to change Mulligan's real thresholds — it only OBSERVES. (Pre-existing; unchanged.)

// The F-shrink-preventive deterministic path logs a "tool.smoke_big" line but bloatHit is MODEL-DRIVEN and,
// due to the skip, can in fact NEVER be true for mulligan_smoke_big. The comment must say so honestly.
```

## Implementation Blueprint

### Data models and structure

_None._ This task touches comments and one string literal only — no models, no logic, no new types.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT L14 — header Responsibilities bullet (4)
  - FIND: "*   (4) registerTool mulligan_smoke_big → returns a >8KB canary result (triggers Mulligan bloat reminder)."
  - REPLACE with a comment that:
      (a) keeps the ">8KB canary" intent but clarifies the bloat reminder does NOT fire for it;
      (b) names the new global default 16384 and per-tool overrides (bash 32768, read 20480);
      (c) states mulligan_smoke_big is skipped by the mulligan_* guard.
  - EXAMPLE (adapt wording, keep ~1-2 lines):
      "*   (4) registerTool mulligan_smoke_big → returns a large canary result. NOTE: bloatReminderHandler
       *       SKIPS mulligan_* tools (src/nudges.ts GOTCHA #3), so this tool never triggers the bloat reminder
       *       regardless of size; the canary's real role is as a shrink target (RESULT_CANARY). New defaults:
       *       global bloatThresholdBytes=16384, bloatThresholdBytesByTool={bash:32768, read:20480}."

Task 2: EDIT L135–136 — bigResult() JSDoc
  - FIND the two comment lines:
      "* bigResult — the >8KB canary string used by both the mulligan_smoke_big tool and the F-shrink-preventive"
      "* deterministic path. >8KB exceeds config.nudges.bloatThresholdBytes (default 8192) → triggers the bloat reminder."
  - REPLACE so that:
      (a) it no longer claims the canary "triggers the bloat reminder";
      (b) "default 8192" → "default 16384" with per-tool note;
      (c) clarifies the canary is a shrink target and that mulligan_smoke_big is skipped.
  - EXAMPLE:
      "* bigResult — the canary string (RESULT_CANARY + padding) used by mulligan_smoke_big + the F-shrink-preventive
       * deterministic path. NOTE: mulligan_smoke_big is a mulligan_* tool → bloatReminderHandler SKIPS it
       * (src/nudges.ts GOTCHA #3), so size never triggers the reminder. Defaults now: global 16384; per-tool
       * bash 32768, read 20480. The canary's job is being a shrink target, not crossing a bloat threshold."

Task 3: EDIT L139 — the bigResult() return (COMMENT only, NOT the value)
  - The line `return RESULT_CANARY + " " + "x".repeat(9000);` itself stays EXACTLY as-is (do NOT change 9000).
  - If a trailing inline comment exists on/around it referencing ">8KB" or "8192", correct it to point at the
    new global default and the skip. If there is no inline comment there, ADD a short one if it improves clarity,
    but DO NOT change the numeric `9000`.
  - RATIONALE: resizing is pointless (skip); 9000 is fine as a shrink-target canary.

Task 4: EDIT L198 — F-shrink-preventive deterministic-path comment
  - FIND: "// The bloat reminder fires on the tool_result EVENT when a result exceeds bloatThresholdBytes (8KB)."
  - REPLACE the "(8KB)" with the new value AND clarify per-tool + skip. EXAMPLE:
      "// The bloat reminder fires on the tool_result EVENT when a NON-mulligan_* result exceeds its resolved
       // threshold (global 16384; per-tool bash 32768, read 20480). mulligan_smoke_big is a mulligan_* tool → skipped."

Task 5: EDIT L199–203 — F-shrink-preventive model-driven note
  - FIND the lines asserting "the agent calls mulligan_smoke_big → the >8KB result triggers the bloat reminder → turn-metric.bloatHit:true".
  - This claim is INCORRECT (mulligan_* skip). REPLACE so the comment states:
      (a) bloatHit for mulligan_smoke_big can NEVER be true (skipped by mulligan_* guard);
      (b) the deterministic assertion remains "a turn-metric entry EXISTS (turn_end handler ran)";
      (c) a real model-driven bloatHit proof would require a NON-mulligan_* tool whose result exceeds its
          resolved threshold (bash >32768, read >20480, other >16384).
  - Keep the reference to scenarios.md if the model-driven path is documented there, but do NOT claim
    mulligan_smoke_big itself proves bloatHit.

Task 6: EDIT L493 — registerTool block comment
  - FIND: "// (4) registerTool mulligan_smoke_big — returns a >8KB canary result. The size triggers Mulligan's"
         "//     bloat reminder (F-shrink-preventive); the RESULT_CANARY string is the observable for shrink scenarios."
  - REPLACE so it no longer claims "The size triggers ... bloat reminder". EXAMPLE:
      "// (4) registerTool mulligan_smoke_big — returns a large canary result. NOTE: bloatReminderHandler SKIPS
       //     mulligan_* tools (src/nudges.ts GOTCHA #3), so this tool NEVER triggers the bloat reminder regardless
       //     of size; its role is as a shrink target (RESULT_CANARY observable). New defaults: global 16384,
       //     per-tool bash 32768 / read 20480."

Task 7: EDIT L498 — tool `description` string literal
  - FIND: `description: "SMOKE TEST TOOL. Returns a >8KB canary result. Call when asked.",`
  - UPDATE the ">8KB" to the new framing (cosmetic; this is the tool label the model sees). EXAMPLE:
      `description: "SMOKE TEST TOOL. Returns a large canary result (bloat reminder is skipped for mulligan_* tools). Call when asked.",`
  - KEEP it short and tool-label-appropriate (design principle #5: optimized for the LLM).

Task 8: VERIFY no other threshold refs were missed
  - RUN: grep -nE "8192|>8KB|\\(8KB\\)|8 KB" test/integration/smoke.ts
  - EXPECT: zero matches (or only matches you intentionally kept with full new-threshold context).
  - If any remain, update them per the same rules.

# Out-of-scope (DO NOT TOUCH in S3):
#   - test/integration/run-smoke.mjs soft note (L260) — optional, not required; item scopes to smoke.ts.
#   - spec/10-testing.md L67 ">8KB" — spec doc, not a test file.
#   - src/nudges.ts stale "default 8192" JSDoc — S1 explicitly left it; not S3's file.
#   - test/nudges.test.ts — owned by S2 (parallel).
```

### Implementation Patterns & Key Details

```typescript
// Pattern for each comment edit: state (1) the new numbers, (2) the per-tool overrides, (3) the skip.
// Keep comments concise — these are header/scenario docs, not prose. Mirror existing comment style
// (the file uses `// ` inline + `* ` JSDoc). Do not introduce new sections.

// The ONE non-comment edit is the tool `description:` string (L498) — keep it a single line, LLM-facing.

// DO NOT:
//   - change the `9000` in bigResult() (moot due to skip);
//   - change any assertion in run-smoke.mjs;
//   - rename the tool (out of scope; renaming would break the mjs asserter's `l.test === "tool.smoke_big"` match);
//   - add new tests (none needed; this is documentation accuracy).
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none (no code reads these comments; smoke.ts cannot reconfigure Mulligan — jiti isolation)
ROUTES: none
BUILD: smoke.ts must still typecheck under the project tsconfig (jiti loads it; tsc validates it)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Comments/strings only — but confirm the file still parses.
npm run build                       # or: npx tsc --noEmit  (whatever the project's typecheck script is)
# Expected: zero errors. If tsc complains, you likely broke a comment delimiter or the string literal.

# Lint (if configured):
npx eslint test/integration/smoke.ts 2>/dev/null || true   # best-effort; not all repos lint test/integration
```

### Level 2: No stale references remain

```bash
# MUST return ZERO matches (every match you intend to keep must carry full new-threshold context):
grep -nE "8192|>8KB|\(8KB\)|8 KB" test/integration/smoke.ts
# Expected: empty (or only intentionally-contextualized lines).

# Confirm the new values ARE present:
grep -nE "16384|32768|20480" test/integration/smoke.ts
# Expected: the edited comments show up.
```

### Level 3: Unit tests (smoke.ts is NOT a vitest target, but confirm nothing regressed)

```bash
npm test                            # = vitest run
# Expected: all green. smoke.ts isn't imported by the vitest suite, so comment edits can't break a unit test;
#           this run guards against accidental damage to shared imports smoke.ts re-exports/uses.
```

### Level 4: Integration smoke harness (the real check)

```bash
# Confirm the harness still loads + emits the canary log line (run-smoke.mjs asserts on `tool.smoke_big`).
# This requires a live `pi` binary + model; if unavailable in CI, at minimum confirm run-smoke.mjs's
# asserted selector still matches an emitted line by code inspection (it does: smokeLog("tool.smoke_big",...) ).
node test/integration/run-smoke.mjs   # if a pi binary + session are available
# Expected: the `assertShrinkPreventive` block still finds its `tool.smoke_big` line (unchanged code path).

# Sanity: the canary function still returns a string of the expected shape.
node -e "const m = await import('./test/integration/smoke.ts').catch(()=>null); console.log('smoke.ts loads as ESM:', !!m);"
# (Best-effort; jiti is the real loader. The authoritative proof is `npm run build` + the grep gates above.)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run build` / `tsc --noEmit` clean.
- [ ] `npm test` (vitest run) green.
- [ ] `grep -nE "8192|>8KB|\(8KB\)|8 KB" test/integration/smoke.ts` → empty (or fully-contextualized).
- [ ] `grep -nE "16384|32768|20480" test/integration/smoke.ts` → the new values present.

### Feature Validation
- [ ] L14, L135–136, L198, L203, L493 comments no longer claim `mulligan_smoke_big` triggers the bloat reminder; they state it is skipped by the `mulligan_*` guard.
- [ ] Updated comments name global `16384` + per-tool `bash: 32768`, `read: 20480`.
- [ ] `bigResult()` value unchanged (still `RESULT_CANARY + " " + "x".repeat(9000)`).
- [ ] No assertion in `run-smoke.mjs` was modified.
- [ ] Tool name `mulligan_smoke_big` unchanged (renaming would break the mjs asserter).

### Code Quality Validation
- [ ] Comment edits match the file's existing comment style (`// ` inline, `* ` JSDoc).
- [ ] Comments are concise (header/scenario docs, not essays).
- [ ] No logic, types, imports, or control flow touched.

### Documentation & Deployment
- [ ] Mode A (per item): NO user-facing docs change — test-file comment edits have no doc impact.
- [ ] No README.md edit (S4 owns the Mode B README sync).

---

## Anti-Patterns to Avoid

- ❌ Don't resize `bigResult()` to >32KB "to be safe" — the `mulligan_*` skip means size is irrelevant; it would be cargo-cult.
- ❌ Don't change the tool name to escape the skip (e.g. `smoke_big`) — out of scope and breaks the `run-smoke.mjs` selector `l.test === "tool.smoke_big"`.
- ❌ Don't "fix" the `mulligan_*` skip itself — it is intentional (prevents Mulligan's own tools from self-nagging); the correct fix is an accurate comment, not a code change.
- ❌ Don't edit `run-smoke.mjs`'s soft note unless doing an explicitly-approved adjacent cleanup — the item scopes to `smoke.ts`.
- ❌ Don't leave a stale `8192` "just in the JSDoc" — every numeric threshold reference must be updated or removed.
- ❌ Don't add tests for the comments — there is nothing to assert; correctness is verified by grep + tsc + read.

---

## Confidence Score: 9/10

**Why 9**: Single-file, comment/string-only edits; every decision is pre-made (numbers, per-tool values, the skip, do-not-resize, no-assertion-changes). Exact line locations are grep-verified. The only residual risk is a subtle wording choice in a comment, which has no functional impact. The one non-trivial insight (the `mulligan_*` skip makes the old "triggers bloat" claim false) is fully captured, so the implementer won't accidentally re-introduce the misconception or waste effort resizing the canary.

**Risk to one-pass success**: near-zero for the edits themselves; the `tsc` + grep gates will catch any slip. The integration harness (`run-smoke.mjs`) needs a live `pi` binary to run end-to-end, but the comment edits cannot change the emitted `tool.smoke_big` log line, so even a skipped Level-4 run does not threaten correctness.