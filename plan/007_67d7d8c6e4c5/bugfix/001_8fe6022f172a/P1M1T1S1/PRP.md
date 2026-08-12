# PRP — P1.M1.T1.S1: Fix spec/07 §5.1 stale `>` → `>=` + clean up nudges.ts deviation framing (BUG-001 textual reconciliation)

---

## Goal

**Feature Goal**: Close the LAST spec-internal inconsistency in the `driftThresholdTokens` reconciliation. The code (`src/nudges.ts:332`) already uses `>=`, `config.ts`/`config.test.ts` already assert `4000`, `spec/09 §2/§3` already document `4000` with the `>`→`>=` rationale, and the README already documents it correctly. The ONLY remaining divergence is textual: `spec/07 §5.1` still writes the firing condition with strict `>`, and a `src/nudges.ts` comment block frames `>=` as a "SPEC-AMBIGUITY RESOLUTION / BUG-003 deviation." Fix both so spec/07, spec/09, and the code all say `>=` with `4000`, and the comment cites spec/09 §3 as the authority.

**Deliverable**: (1) A 1-character spec-text fix in `spec/07-preventive-and-nudges.md §5.1` (`avg(window.deltaTokens) > driftThresholdTokens` → `>=`). (2) A rewritten comment block in `src/nudges.ts` (lines ~296-306) that references spec/09 §3 as the authority and drops the "ambiguity resolution / deviation" framing — keeping the worked acceptance-criteria examples. **No behavioral change** — no value, operator, test, or code-logic edit.

**Success Definition**:
- `spec/07 §5.1`, `spec/09 §3`, and `src/nudges.ts:332` all express the drift firing condition with `>=` (consistent).
- `src/nudges.ts` no longer frames `>=`/`4000` as a "deviation" or "ambiguity resolution"; it cites spec/09 §3.
- `npx vitest run` — all 1042 tests pass (no behavioral change; the code is untouched except the comment).
- `npx tsc --noEmit` — clean (comment + markdown edits don't affect types).

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and future spec readers; indirectly the agent (whose drift-nudge behavior is unchanged).

**Use Case**: A maintainer reading spec/07 §5.1, spec/09 §3, and the code should see one consistent story: `driftThresholdTokens = 4000`, comparison `>=`, all three §5.1 acceptance criteria satisfied.

**User Journey**: Maintainer reads spec/07 §5.1 → sees `>=` (matches code + spec/09) → reads the nudges.ts comment → sees spec/09 §3 cited as authority → no confusion about a "deviation."

**Pain Points Addressed**: Today spec/07 §5.1 says `>` while the code and spec/09 say `>=` — a spec-internal contradiction that makes it look like the implementation deviates from spec/07. The fix removes the contradiction.

## Why

- **Business value / user impact**: Low direct impact (no behavior changes). High spec-hygiene value: removes the last textual contradiction in a core-feature config default, so the spec, code, and tests tell one consistent story. Prevents a future maintainer from "fixing" the (already-correct) value or operator based on a stale spec line.
- **Integration with existing features**: `shouldNudge` (src/nudges.ts:326-334) is the drift-nudge gate; its `>=` comparison + the 4000 default are already correct and fully tested. This subtask makes the SPEC match the (shipped, tested) implementation.
- **Problems this solves and for whom**: For maintainers: spec/code/test consistency on a core-feature knob. The PRD bug-report's premise ("spec/09 says 6000") is STALE — spec/09 was already amended to 4000 in a prior cycle; this subtask closes the one remaining textual gap (spec/07's `>`).

## What

User-visible behavior: **NONE** (comment + markdown only). Spec/07 §5.1's firing-condition text changes from `>` to `>=`; the nudges.ts comment block is reframed. No config value, no operator, no test, no code-logic change.

### Success Criteria

- [ ] `spec/07 §5.1` firing condition reads `avg(window.deltaTokens) >= driftThresholdTokens` (was `>`).
- [ ] `src/nudges.ts` comment block (~296-306) cites `spec/09 §3` as the authority for `>=` + `4000`; no "SPEC-AMBIGUITY RESOLUTION" / "BUG-003 fix" / "deviation" framing.
- [ ] The worked acceptance-criteria examples (`avg([...]) >= 4k? Yes/No`) are KEPT (they are correct and valuable).
- [ ] `src/nudges.ts:332` is UNCHANGED (`return avg >= config.nudges.driftThresholdTokens;`).
- [ ] `src/config.ts:168` is UNCHANGED (`driftThresholdTokens: 4000`).
- [ ] `npx vitest run` → 1042 pass; `npx tsc --noEmit` → clean.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact current text of both edit sites, the exact target text, the authoritative bug_analysis confirming everything else is already correct, and — critically — a prominent WARNING that the PRD bug-report's premise is stale so the implementer does not "restore 6000" (which would re-introduce the divergence and break 4000-asserting tests + spec/09).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/architecture/bug_analysis.md
  why: "§BUG-001 is the AUTHORITATIVE research (supersedes the PRD bug-report's stale premise). It verifies by codebase probe: code (nudges.ts:332) uses >=; config.ts:168 is 4000; spec/09 §2 (line 45) is 4000; spec/09 §3 (line 84) rationale documents the > → >= change; README (line 98) documents 4000+>=; config.test.ts:30 + :64 assert 4000 (PASS); drift_nudge.test.ts:128-143 test >= at 4000 (PASS). The ONLY remaining divergence is spec/07 §5.1's `>` text + the nudges.ts comment framing."
  critical: "The PRD bug-report (h2.2/h3.0) claims 'spec/09 §2 shows 6000' — that premise is STALE. spec/09 ALREADY shows 4000. Do NOT 'restore 6000' or change the operator in code — that would re-introduce the divergence and break the existing 4000 tests + spec/09. This subtask is TEXTUAL CONSISTENCY ONLY."

- file: spec/07-preventive-and-nudges.md §5.1 (the `>` is in the "Windowed drift signaling" paragraph)
  why: "THE spec-text edit site. The firing-condition sentence reads: 'The firing condition is delta-only when delta data is available: `avg(window.deltaTokens) > driftThresholdTokens`.' Change the single `>` to `>=`."
  pattern: "grep -n 'deltaTokens) > driftThresholdTokens' spec/07-preventive-and-nudges.md → exactly ONE match (the firing condition). The '(>threshold)' in acceptance (c) is a DIFFERENT context (the BLOAT threshold, not the drift comparison) — do NOT touch it."
  gotcha: "spec/07 §5.1 also has a v1.1 note (D10) and acceptance criteria (a)/(b)/(c) in prose — none of those use the drift `>` operator; leave them. Only the `avg(window.deltaTokens) > driftThresholdTokens` inline-code expression changes."

- file: spec/09-configuration.md §2 (line 45) + §3 (line 84)
  why: "The AUTHORITY to cite. §2 line 45: `\"driftThresholdTokens\": 4000`. §3 line 84 rationale: 'Lowered from 6000 with the comparison changed from `>` to `>=` (BUG-003 fix): at 6000 with strict `>`, §5.1 criterion (b) ... never held ... At 4000 with `>=`, all three §5.1 acceptance criteria hold.' This is the text the nudges.ts comment should reference."
  critical: "spec/09 is ALREADY correct — do NOT edit it. It is the authority the nudges.ts comment cites."

- file: src/nudges.ts (comment block ~lines 296-306 + the `>=` at line 332)
  why: "THE code-comment edit site. The comment block currently opens 'SPEC-AMBIGUITY RESOLUTION (spec/07 §5.1, BUG-003 fix): ...' and frames `>=` + 4000 as a deviation/resolution. Line 332 `return avg >= config.nudges.driftThresholdTokens;` is UNCHANGED (already correct)."
  pattern: "Rewrite the comment header to cite spec/09 §3 as the authority; keep the (a)/(b)/(c) worked examples (avg([...]) >= 4k? Yes/No). Drop 'SPEC-AMBIGUITY RESOLUTION', 'BUG-003 fix', and 'ILLUSTRATIVE recharacterization RETIRED' framing — the spec now codifies >= explicitly."

- file: test/config.test.ts (lines 30, 64) + test/drift_nudge.test.ts (lines 128-143)
  why: "VERIFICATION ONLY — do NOT edit. config.test.ts:30 asserts DEFAULT_CONFIG driftThresholdTokens: 4000 (exact-match); :64 asserts .toBe(4000). drift_nudge.test.ts:128-143 tests the >= behavior at 4000. All already PASS. Running them confirms no behavioral change."
  critical: "If any of these FAIL after your edit, you accidentally changed the value/operator/code — revert; the edit is comment + markdown only."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
spec/
  07-preventive-and-nudges.md   # ← MODIFY §5.1: `>` → `>=` (1 char in the firing-condition inline code)
  09-configuration.md           # ← READ-ONLY authority (already 4000 + >=); DO NOT edit
src/
  nudges.ts                     # ← MODIFY comment block (~296-306); line 332 (>=) UNCHANGED
  config.ts                     # ← UNCHANGED (line 168: 4000)
test/
  config.test.ts, drift_nudge.test.ts   # ← VERIFICATION ONLY (already assert 4000 + >=)
README.md                       # ← UNCHANGED (line 98 already documents 4000 + >= correctly)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S1 MODIFIES exactly two existing files (one spec markdown, one code-comment block):
spec/07-preventive-and-nudges.md   # §5.1 firing condition: `>` → `>=`
src/nudges.ts                      # comment block (~296-306): reframe to cite spec/09 §3; keep worked examples
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (the PRD bug-report premise is STALE — do NOT "restore 6000").
//   The PRD (h2.2/h3.0) claims "spec/09 §2 shows driftThresholdTokens: 6000" and "§3 rationale says 'Raised from
//   3000'." That premise is OUT OF DATE: the CURRENT spec/09 §2 (line 45) shows 4000 and §3 (line 84) says
//   "Lowered from 6000 with the comparison changed from > to >=". The code (config.ts:168 = 4000, nudges.ts:332 = >=)
//   and tests (config.test.ts assert 4000; drift_nudge.test.ts tests >=) ALREADY match. So this subtask is TEXTUAL
//   CONSISTENCY ONLY. Do NOT change the value to 6000 or the operator in CODE — that would re-introduce the
//   divergence the prior cycle already fixed AND break the 4000-asserting tests + spec/09. (See bug_analysis §BUG-001.)

// CRITICAL GOTCHA #2 (only ONE `>` changes in spec/07 §5.1 — do not touch the bloat-threshold `>`).
//   The drift firing condition `avg(window.deltaTokens) > driftThresholdTokens` is the ONLY drift `>` in §5.1.
//   Acceptance (c) says "a single large result (>threshold)" — that `>threshold` refers to the BLOAT threshold
//   (Nudge A's bloatThresholdBytes/Tokens), NOT the drift comparison. Leave it. grep
//   `deltaTokens) > driftThresholdTokens` → exactly 1 match; change only that one.

// CRITICAL GOTCHA #3 (the worked examples in the nudges.ts comment are CORRECT — keep them).
//   The comment's (a)/(b)/(c) lines — `avg([8k,0.5k,0.5k])=3k >= 4k? No → no fire ✓`, `avg([4k,4k,4k])=4k >= 4k? Yes`,
//   `avg(~0) >= 4k? No` — are mathematically correct and demonstrate WHY 4000+>= satisfies all three §5.1 criteria.
//   The contract says KEEP them. Only the FRAMING (the "SPEC-AMBIGUITY RESOLUTION / BUG-003 fix / ILLUSTRATIVE
//   recharacterization RETIRED" language) is rewritten; the examples stay.

// CRITICAL GOTCHA #4 (this is a NO-BEHAVIORAL-CHANGE task — the code logic is untouched).
//   Line 332 `return avg >= config.nudges.driftThresholdTokens;` is UNCHANGED. Only the COMMENT BLOCK above it
//   changes (plus the spec markdown). If `npx vitest run` shows ANY failure after your edit, you accidentally
//   touched code logic — revert and re-apply only the comment + markdown edits.

// CRITICAL GOTCHA #5 (scope: do NOT edit spec/09, config.ts, README, or any test).
//   spec/09 §2/§3 (the authority) is ALREADY correct — editing it risks introducing a NEW inconsistency.
//   config.ts:168 (4000), README:98 (documents 4000+>=), and the tests (assert 4000+>=) are all correct — leave
//   them. This subtask touches ONLY spec/07 §5.1 + the nudges.ts comment block.
```

## Implementation Blueprint

### Data models and structure

**None.** No code, no types, no config values change. This is a documentation/comment consistency pass.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FIX spec/07 §5.1 firing-condition operator (`>` → `>=`)
  - LOCATE the firing-condition sentence in spec/07-preventive-and-nudges.md §5.1 (Windowed drift signaling).
    grep -n "deltaTokens) > driftThresholdTokens" spec/07-preventive-and-nudges.md  → exactly ONE match.
  - EDIT that one inline-code expression. CURRENT:
      `avg(window.deltaTokens) > driftThresholdTokens`
    TARGET:
      `avg(window.deltaTokens) >= driftThresholdTokens`
  - PRESERVE the surrounding sentence ("The firing condition is delta-only when delta data is available: ...") and
    ALL acceptance criteria (a)/(b)/(c) prose. Do NOT touch the "(>threshold)" in acceptance (c) (GOTCHA #2).
  - VERIFY: `grep -n "deltaTokens) > driftThresholdTokens" spec/07-preventive-and-nudges.md` → zero matches;
    `grep -n "deltaTokens) >= driftThresholdTokens" spec/07-preventive-and-nudges.md` → one match.
  - DEPENDENCIES: none.

Task 2: REFRAME the nudges.ts comment block (~lines 296-306) — cite spec/09 §3, drop deviation framing
  - LOCATE the comment block above shouldNudge (the "SPEC-AMBIGUITY RESOLUTION (spec/07 §5.1, BUG-003 fix): ..."
    paragraph, ~lines 296-306).
  - CURRENT block (verbatim):
        * SPEC-AMBIGUITY RESOLUTION (spec/07 §5.1, BUG-003 fix): spec/07 §5.1 gives three acceptance criteria —
        * (a) a single 8k-token turn amid small turns does NOT fire; (b) three ~4k turns in a row DO fire; (c) a single
        * large result with ~0 net growth does NOT fire. With the DEFAULT threshold LOWERED to 4000 (config.ts) and the
        * comparison changed from `>` to `>=`, the moving-average algorithm satisfies ALL THREE literally:
        *   (a) avg([8k,0.5k,0.5k])=3k >= 4k? No → no fire ✓
        *   (b) avg([4k,4k,4k])=4k   >= 4k? Yes → fire ✓   (was 4k > 6k → no fire — the BUG-003 violation)
        *   (c) avg(~0)              >= 4k? No → no fire ✓
        * Chosen algorithm: MOVING AVERAGE vs threshold, DELTA-ONLY (bloat demoted to the no-delta fallback per
        * P4.M2.T1.S1 / spec/07 §5.1). The earlier "ILLUSTRATIVE" recharacterization of criterion (b) is RETIRED —
        * (b) is now a firm, satisfied acceptance criterion at the lowered default.
  - TARGET block (reframed — cites spec/09 §3 as authority; KEEPS the worked examples; drops the resolution/deviation framing):
        * OPERATOR + DEFAULT (spec/09 §3 is the authority; spec/07 §5.1 carries the acceptance criteria): spec/09 §3
        * codifies driftThresholdTokens = 4000 with the comparison `>=` (and documents the `>` → `>=` change). The
        * moving-average algorithm satisfies ALL THREE spec/07 §5.1 acceptance criteria at that default:
        *   (a) a single 8k-token turn amid small turns does NOT fire; (b) three ~4k turns in a row DO fire;
        *       (c) a single large result with ~0 net growth does NOT fire. Literally:
        *   (a) avg([8k,0.5k,0.5k])=3k >= 4k? No → no fire ✓
        *   (b) avg([4k,4k,4k])=4k   >= 4k? Yes → fire ✓
        *   (c) avg(~0)              >= 4k? No → no fire ✓
        * Chosen algorithm: MOVING AVERAGE vs threshold, DELTA-ONLY (bloat demoted to the no-delta fallback per
        * spec/07 §5.1). spec/07 §5.1's firing condition uses `>=` to match this implementation and spec/09 §3.
  - NAMING/FORM: keep it a JSDoc block comment (the leading ` * ` style). Keep the (a)/(b)/(c) worked examples
    verbatim (GOTCHA #3). Drop "SPEC-AMBIGUITY RESOLUTION", "BUG-003 fix", "BUG-003 violation", and
    "ILLUSTRATIVE recharacterization RETIRED" — the spec now codifies >=, so it is not a "resolution."
  - PRESERVE: the surrounding comment paragraphs (WHY bloatHit is demoted; the bloat-fallback `=== true` note; the
    grewOverThreshold note; the @param/@returns block) and line 332 `return avg >= ...`.
  - DEPENDENCIES: none.

Task 3: VERIFY (no new code — confirm no behavioral change)
  - RUN `npx vitest run` → all 1042 tests pass (the code logic is UNCHANGED; only a comment + spec markdown changed).
    If ANY test fails, you accidentally touched code — revert and re-apply only Tasks 1-2 (GOTCHA #4).
  - RUN `npx tsc --noEmit` → clean (comments + markdown don't affect types).
  - GREP consistency: all three authorities now say `>=`:
      grep -n "deltaTokens) >= driftThresholdTokens" spec/07-preventive-and-nudges.md  → 1 match
      grep -n "avg >= config.nudges.driftThresholdTokens" src/nudges.ts                → 1 match (line 332, unchanged)
      grep -n "changed from \`>\` to \`>=\`" spec/09-configuration.md                   → 1 match (the authority)
  - DEPENDENCIES: Tasks 1-2.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 2): reframe the comment HEADER to cite the authority, keep the worked examples.
//   The key shift is from "this RESOLVES an ambiguity / is a BUG-003 fix" → "spec/09 §3 CODEIFIES this; the
//   algorithm satisfies the §5.1 acceptance criteria." The (a)/(b)/(c) avg([...]) >= 4k? examples are the load-
//   bearing correctness demonstration — they stay verbatim. Only the framing prose changes.

// CRITICAL: this is the rare PRP where the CODE IS ALREADY CORRECT. The bug_analysis (§BUG-001) verified by probe
//   that nudges.ts:332 (>=), config.ts:168 (4000), spec/09 §2/§3 (4000 + >=), README:98, and the tests (4000 + >=)
//   all agree. The PRD bug-report's "spec/09 says 6000" premise is STALE. S1 closes the ONE remaining textual gap
//   (spec/07 §5.1's `>`) + cleans the comment framing. Do not "fix" a value/operator that is already correct.
```

### Integration Points

```yaml
CODE:
  - modify: src/nudges.ts comment block (~296-306) ONLY — line 332 (>=) + the shouldNudge body UNCHANGED
  - untouched: src/config.ts (4000), src/nudges.ts:332 (>=), all other nudges.ts code
SPEC:
  - modify: spec/07-preventive-and-nudges.md §5.1 (the firing-condition `>` → `>=`)
  - untouched (the authority): spec/09-configuration.md §2/§3 (already 4000 + >=)
TESTS:
  - untouched: test/config.test.ts (asserts 4000), test/drift_nudge.test.ts (tests >= at 4000) — verification only
DOCS:
  - untouched: README.md (line 98 already documents 4000 + >= correctly)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No value, operator, config, or registration change.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck — must be clean (comment + markdown don't affect types):
npx tsc --noEmit
# EXPECTED: clean (zero errors). If you see an error in src/nudges.ts, you accidentally edited code, not just the
# comment — revert and re-apply only the comment-block rewrite.

# Spec/code/operator consistency (all three authorities now say >=):
grep -n "deltaTokens) >= driftThresholdTokens" spec/07-preventive-and-nudges.md   # 1 match (the fix)
grep -n "avg >= config.nudges.driftThresholdTokens" src/nudges.ts                 # 1 match (line 332, unchanged)
grep -n "changed from \`>\` to \`>=\`" spec/09-configuration.md                    # 1 match (the authority)
# And confirm the stale strict `>` is GONE from spec/07's drift condition:
grep -n "deltaTokens) > driftThresholdTokens" spec/07-preventive-and-nudges.md    # ZERO matches
```

### Level 2: Unit Tests (Component Validation)

```bash
# Full suite — confirms NO behavioral change (the code logic is untouched):
npx vitest run
# EXPECTED: all 1042 tests pass. Specifically:
#   - test/config.test.ts:30 asserts DEFAULT_CONFIG.nudges.driftThresholdTokens === 4000 (exact-match) — PASS
#   - test/config.test.ts:64 asserts .toBe(4000) — PASS
#   - test/drift_nudge.test.ts:128-143 tests the >= behavior at 4000 — PASS
# If ANY test fails, you accidentally changed a value/operator/code line — revert (GOTCHA #4). These tests are
# VERIFICATION, not edit targets (do NOT update them — they already assert the correct 4000 + >=).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A: there is no runtime behavior change to exercise (comment + markdown only). The full `npx vitest run` in
# Level 2 (which includes the integration smoke tests) is the system-level confirmation that nothing moved.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Spec cross-consistency check (manual read — confirms spec/07, spec/09, and the code now tell one story):
#   1. spec/07 §5.1 firing condition: `avg(window.deltaTokens) >= driftThresholdTokens` ✓ (Task 1)
#   2. spec/09 §2: "driftThresholdTokens": 4000 ✓ (already correct)
#   3. spec/09 §3: "Lowered from 6000 with the comparison changed from > to >=" ✓ (already correct — the authority)
#   4. src/nudges.ts:332: return avg >= config.nudges.driftThresholdTokens ✓ (already correct)
#   5. src/nudges.ts comment block: cites spec/09 §3; no "deviation/resolution" framing ✓ (Task 2)
# All five agree at 4000 + >=. Done.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` — clean (zero errors).
- [ ] `npx vitest run` — all 1042 tests pass (no behavioral change).
- [ ] `grep "deltaTokens) > driftThresholdTokens" spec/07-preventive-and-nudges.md` → zero matches.
- [ ] `grep "deltaTokens) >= driftThresholdTokens" spec/07-preventive-and-nudges.md` → one match.

### Feature Validation

- [ ] spec/07 §5.1 firing condition uses `>=` (matches spec/09 §3 + code).
- [ ] src/nudges.ts comment block cites spec/09 §3 as the authority; no "SPEC-AMBIGUITY RESOLUTION"/"BUG-003 fix"/"deviation" framing.
- [ ] The (a)/(b)/(c) worked examples are KEPT (correct + valuable).
- [ ] src/nudges.ts:332 (`>=`) and src/config.ts:168 (`4000`) are UNCHANGED.
- [ ] spec/09, config.test.ts, drift_nudge.test.ts, README — all UNCHANGED (already correct).

### Code Quality Validation

- [ ] Only `spec/07-preventive-and-nudges.md` (1 char) and `src/nudges.ts` (comment block) are modified — NO code-logic, config-value, test, or other-spec edits.
- [ ] The comment rewrite preserves the JSDoc block-comment style and the surrounding paragraphs.

### Documentation & Deployment

- [ ] spec/07 §5.1 + the nudges.ts comment now tell one consistent story with spec/09 §3 and the code (Mode A — rides with the work).
- [ ] No README change (line 98 already correct); no separate docs subtask.

---

## Anti-Patterns to Avoid

- ❌ Don't "restore 6000" or change the operator in CODE — the PRD bug-report's "spec/09 says 6000" premise is STALE. spec/09, config.ts, the tests, and the README ALREADY agree at 4000 + `>=`. Changing the value/operator would re-introduce the divergence and break the 4000-asserting tests + spec/09. This is TEXTUAL CONSISTENCY ONLY (GOTCHA #1).
- ❌ Don't edit `spec/09`, `src/config.ts`, `README.md`, or any test — they are ALREADY correct (spec/09 §2/§3 = 4000 + >=; config.ts:168 = 4000; README:98 documents it; tests assert it). Editing them risks a NEW inconsistency. S1 touches ONLY spec/07 §5.1 + the nudges.ts comment block (GOTCHA #5).
- ❌ Don't change the `(>threshold)` in spec/07 §5.1 acceptance (c) — that `>threshold` refers to the BLOAT threshold (Nudge A), not the drift comparison. Only the `avg(window.deltaTokens) > driftThresholdTokens` inline-code expression changes (GOTCHA #2).
- ❌ Don't delete the worked (a)/(b)/(c) examples in the nudges.ts comment — they are mathematically correct and demonstrate why 4000+>= satisfies all three §5.1 criteria. The contract explicitly says KEEP them; only the framing prose is rewritten (GOTCHA #3).
- ❌ Don't treat a failing `npx vitest run` as "the tests need updating" — if any test fails after your edit, YOU accidentally changed code logic (the edit is comment + markdown only). Revert the code change; the tests already assert the correct 4000 + >= and must stay green untouched (GOTCHA #4).
- ❌ Don't leave the "SPEC-AMBIGUITY RESOLUTION / BUG-003 fix / ILLUSTRATIVE recharacterization RETIRED" language — the spec now codifies >= explicitly (spec/09 §3), so framing the code as a "resolution of an ambiguity" is misleading. Cite spec/09 §3 as the authority instead.