# PRP — P1.M2.T3.S1: Emit Spec-Correct No-Op Text for target vs markerId Resolution Paths (BUG-006)

## Goal

**Feature Goal**: Fix BUG-006 — `mulligan_cancel`'s not-found no-op returns ONE hardcoded string
(`"…with that id…"`) for BOTH resolution paths, diverging from spec/05 §5. After the fix, the not-found text is
**path-specific**: the **markerId** path keeps `"Mulligan: no active marker found with that id — nothing to
cancel."` (unchanged); the **target** path (and the unreachable neither-case) emits the spec/05 §5 verbatim
`"Mulligan: no active marker found for that target — nothing to cancel."`. No behavior change beyond the text.

**Deliverable**: Edits to **two files**:
1. `src/tools/cancel.ts` — the step-4 not-found block (~lines 390-396): declare `usedMarkerId` and emit
   path-specific text via a ternary.
2. `test/tools/cancel.test.ts` — change **exactly 4** target-path assertions (lines 765, 784, 803, 908) from
   `"…with that id…"` → `"…for that target…"`, and update the stale flag-comment (lines 559-561). The **3**
   markerId-path assertions (lines 342, 362, 432) are **unchanged**.

**Success Definition**: (a) cancelling by `target` with no match → `"…for that target…"`; cancelling by
`markerId` with no match → `"…with that id…"` (unchanged); (b) `details` stays `{ cancelled: false }` on both
paths; (c) the 3 markerId-path tests still pass unchanged (they pin "with that id"); the 4 target-path tests now
pin "for that target"; (d) `npx tsc --noEmit` exits 0; (e) `npx vitest run test/tools/cancel.test.ts` all green.

## User Persona

**Target User**: An AI agent invoking `mulligan_cancel` by `target` (the preferred/documented path).

**Use Case**: The agent cancels by target (e.g. `{ target: { by_tool_call_id: "call-A" } }`) in a session with
no active marker covering that target.

**Pain Points Addressed**: Today the agent is told "no active marker found **with that id**" even though it
passed no id — misleading, and a verbatim spec-text mismatch on the tool's primary interaction path.

## Why

- **Spec fidelity**: spec/05-tools.md §5 (lines 264, 280) specifies the target-path text verbatim. The current
  single hardcoded string (`cancel.ts:393`) is a deliberate-but-wrong deviation pinned by an existing test
  (which flagged itself as a deviation — `cancel.test.ts:559-561`).
- The two resolution paths are already cleanly separated in steps 3a/3b (`cancel.ts:368` vs `:375`); only step 4
  collapses them into one string. The fix threads a one-line `usedMarkerId` flag from the already-resolved path
  into the no-op block.
- **No business logic, no new refusal, no behavior change beyond the text.** `details` stays
  `{ cancelled: false }`. `appendCancelMarker` is still NOT called on the not-found path. Validated by the
  existing cancel test suite (the 3 markerId tests stay green; the 4 target tests flip to the correct text).

## What

A one-block code edit in `src/tools/cancel.ts` (declare `usedMarkerId`; ternary over the two spec strings) plus
a surgical test update in `test/tools/cancel.test.ts` (4 target-path assertions change; 3 markerId-path
assertions stay; the deviation flag-comment is rewritten). The `usedMarkerId` test mirrors the step-3a condition
at `cancel.ts:368` (`typeof params.markerId === "string" && params.markerId.length > 0`) EXACTLY, so the emitted
text always matches the path actually taken (Decision D1 — markerId wins when both are given).

### Success Criteria

- [ ] `cancel.ts` not-found block emits `"…with that id…"` when `usedMarkerId`, else `"…for that target…"`.
- [ ] `details` is `{ cancelled: false }` on both paths (unchanged).
- [ ] `test/tools/cancel.test.ts:765, 784, 803, 908` assert `"…for that target…"`.
- [ ] `test/tools/cancel.test.ts:342, 362, 432` STILL assert `"…with that id…"` (markerId path — unchanged).
- [ ] The flag-comment at `cancel.test.ts:559-561` reflects the split (no longer "SAME text for BOTH paths").
- [ ] `npx tsc --noEmit` → exit 0; `npx vitest run test/tools/cancel.test.ts` → all green.
- [ ] No file other than `cancel.ts` and `cancel.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: (1) the **verbatim** current and target code for the not-found block, (2) the
**verbatim** spec/05 §5 target-path string, (3) the **complete map** of all 7 identical assertion sites with
their disposition (4 change / 3 stay) and the distinguishing `run()` call + unique anchor for each, (4) the
exact `usedMarkerId` condition (mirroring step-3a), and (5) deterministic grep + tsc + vitest gates.

### Documentation & References

```yaml
# MUST EDIT — the code fix
- file: src/tools/cancel.ts
  why: The step-4 not-found block (lines 390-396) returns one hardcoded string for both paths. Add the
        usedMarkerId flag + a ternary over the two spec strings.
  section: "cancelExecute step (4) not-found no-op, ~lines 390-396 (the `if (targetUuid === null)` block)."
  pattern: "declare `const usedMarkerId = typeof params.markerId === \"string\" && params.markerId.length > 0;`
            (mirrors the step-3a condition at line 368 EXACTLY), then ternary on the text."
  gotcha: "The usedMarkerId test MUST equal the line-368 (3a) condition verbatim — otherwise the emitted text
           can disagree with the path actually taken (e.g. if both target+markerId given, markerId wins → 'with
           that id'). Decision D1. details STAYS { cancelled: false }."

# MUST EDIT — the test updates (4 assertions + 1 comment)
- file: test/tools/cancel.test.ts
  why: 7 identical assertion lines pin the OLD unified string. Change ONLY the 4 target-path sites; keep the 3
        markerId-path sites. Update the stale 559-561 deviation flag-comment.
  section: "markerId-path assertions at 342/362/432 (STAY); target-path assertions at 765/784/803/908 (CHANGE);
            flag-comment at 559-561 (REWRITE)."
  pattern: "Assertion old: \"...with that id — nothing to cancel.\" → target-path new: \"...for that target —
            nothing to cancel.\" Distinguish by the preceding run() call: target: → change; markerId: → keep."
  critical: "The assertion line is IDENTICAL at all 7 sites. A global find/replace flips the 3 markerId tests
             WRONG (they'd expect 'for that target' but code returns 'with that id' → 3 FAILs). Target ONLY
             765/784/803/908. For 784 & 803 (identical immediate trio) extend the anchor to the enclosing
             it(\"...\") title to make oldText unique."

# MUST READ — spec source-of-truth (READ-ONLY — already correct)
- file: spec/05-tools.md
  why: Line 264 = the verbatim target-path text; line 280 = step-4 description naming the "for that target" text.
  section: "§5 mulligan_cancel, step 4 (Not-found no-op). READ-ONLY — do NOT edit spec/*."
  critical: "TARGET-path text = \"Mulligan: no active marker found for that target — nothing to cancel.\"
             MARKERID-path text = the current \"...with that id...\" string, UNCHANGED."

# MUST READ — the step-3a condition this must mirror
- file: src/tools/cancel.ts
  why: Line 368 — `if (typeof params.markerId === \"string\" && params.markerId.length > 0)` is the markerId
        path. The usedMarkerId flag MUST be this exact expression so the text tracks the path actually taken.
  section: "step (3a) MARKERID PATH, line 368. READ-ONLY reference for the condition to mirror."

# CONTEXT — parallel sibling (no file conflict)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M2T2S1/PRP.md
  why: CONTRACT. Edits src/tools/rewind.ts (countRetriesAtLatestPrompt) + test/tools/rewind.test.ts ONLY.
        No overlap with cancel.ts / cancel.test.ts. Both run in parallel; full-suite gate validates both.
  critical: "Do NOT touch rewind.ts or rewind.test.ts (sibling-owned)."

# MUST READ — the exhaustive pre-researched map
- docfile: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M2T3S1/research/bug006_cancel_noop_text.md
  why: The complete 7-site test map (4 change / 3 stay) with unique anchors, the verbatim code diff, the spec
        citations, and the repo-wide grep confirming scope.
  critical: "Line numbers may shift by implementation time (sibling work is parallel but in a DIFFERENT file).
             Re-locate the assertion sites by the preceding run() call, not by line number alone."
```

### Current Codebase tree (the only relevant slice)

```bash
src/tools/cancel.ts          # ← EDIT step-4 not-found block (~390-396): usedMarkerId + ternary
test/tools/cancel.test.ts    # ← EDIT 4 target-path assertions (765/784/803/904→908) + flag-comment (559-561)
spec/05-tools.md             # READ-ONLY — lines 264, 280 = verbatim target-path text (source of truth)
src/tools/rewind.ts          # OUT OF SCOPE — sibling P1.M2.T2.S1 (countRetriesAtLatestPrompt)
test/tools/rewind.test.ts    # OUT OF SCOPE — sibling P1.M2.T2.S1
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL (TEST UNIQUENESS): the assertion line
#   `    expect(firstText(res)).toBe("Mulligan: no active marker found with that id — nothing to cancel.");`
# is IDENTICAL at 7 sites (342, 362, 432, 765, 784, 803, 908). A naive global find/replace flips ALL 7 —
# breaking the 3 markerId-path tests (they must stay "with that id"). Target ONLY 765/784/803/908.
# Distinguish by the preceding run(): `target:` → change; `markerId:` → keep.

# CRITICAL (usedMarkerId must mirror 3a): the flag expression MUST be byte-identical to the step-3a condition
# at cancel.ts:368 (`typeof params.markerId === "string" && params.markerId.length > 0`). If it diverges, the
# text can disagree with the path taken (e.g. both target+markerId given → markerId wins → must say "with that
# id"). Decision D1.

# CRITICAL (NEVER THROW): the whole cancelExecute body is one try/catch (E13). The new const + ternary add no
# throws. details stays { cancelled: false }. appendCancelMarker is still NOT called on the not-found path.

# GOTCHA: there is NO separate "neither"-case test (schema requires target OR markerId — cancel.ts:125). The
# "neither" branch is unreachable through the public API; usedMarkerId=false → target text covers it defensively.

# GOTCHA: the JSDoc at cancel.ts:325 ("return the 'no active marker found' no-op text") is already generic —
# it does NOT pin a path-specific string, so it needs NO change. (Optional polish only; not required.)

# GOTCHA: tool result text is NOT externally documented — README/spec do not pin the markerId text beyond
# spec/05 §5's target-path text. So NO README/spec edit is needed for BUG-006. (Confirmed by repo-wide grep.)

# OUT OF SCOPE (do NOT touch):
#   - src/tools/rewind.ts, test/tools/rewind.test.ts -> sibling P1.M2.T2.S1 (countRetriesAtLatestPrompt).
#   - spec/* (spec/05 is READ-ONLY source of truth; other specs unaffected).
#   - src/nudges.ts, src/tools/checkpoint.ts, src/tools/shrink.ts, src/tools/audit.ts (BUG-004/005/007 etc.).
#   - README.md (tool result text is runtime agent-facing, not a documented config/API surface).
# This PRP edits ONLY src/tools/cancel.ts + test/tools/cancel.test.ts.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no type change. The ternary is a `string` literal union; `details` stays `{ cancelled: false }`. The
`CancelArgs` type (`{ target?: <union>; markerId?: string }`, cancel.ts:130) is unchanged._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/cancel.ts — step-4 not-found block (path-specific text)
  - FIND (verbatim current, ~lines 390-396):
      "    // (4) not-found no-op (spec/05 §5 step 4; E21 (d) — safe no-op, never throws). appendCancelMarker NOT called.
            if (targetUuid === null) {
              return {
                content: [{ type: \"text\", text: \"Mulligan: no active marker found with that id — nothing to cancel.\" }],
                details: { cancelled: false },
              };
            }"
  - REPLACE WITH (verbatim target — usedMarkerId mirrors line-368 (3a); ternary over the two spec strings):
      "    // (4) not-found no-op (spec/05 §5 step 4; E21 (d) — safe no-op, never throws). appendCancelMarker NOT called.
            //     BUG-006: emit path-specific text. markerId path keeps \"with that id\"; target/neither path uses
            //     the spec/05 §5 verbatim \"for that target\" text (Decision D1 — markerId wins when both are given).
            const usedMarkerId = typeof params.markerId === \"string\" && params.markerId.length > 0;
            if (targetUuid === null) {
              return {
                content: [
                  {
                    type: \"text\",
                    text: usedMarkerId
                      ? \"Mulligan: no active marker found with that id — nothing to cancel.\"
                      : \"Mulligan: no active marker found for that target — nothing to cancel.\",
                  },
                ],
                details: { cancelled: false },
              };
            }"
  - RATIONALE: the markerId text is byte-identical to before (3 markerId tests stay green); the target text is
    the spec/05:264 verbatim. usedMarkerId mirrors the (3a) condition so the text tracks the path actually taken.
  - PRESERVE: the comment header line, the `if (targetUuid === null)` guard, `details: { cancelled: false }`,
    and that appendCancelMarker is NOT called here. Steps 3a/3b/5/6/7 are UNCHANGED.
  - DO NOT: change the step-3a/3b logic, the already-cancelled text (step 5), any other string, or throw.

Task 2: EDIT test/tools/cancel.test.ts — 4 TARGET-path assertions → "for that target"
  - These 4 sites are inside `describe("mulligan_cancel — target path …")` (starts ~line 563). Each is preceded
    by a `run(pi, ctx, { target: { by_tool_call_id: "call-A" } })` call. Change the assertion string ONLY:
      OLD: `"Mulligan: no active marker found with that id — nothing to cancel."`
      NEW: `"Mulligan: no active marker found for that target — nothing to cancel."`
  - The 4 sites (re-locate by the preceding target: run() if line numbers shifted):
      * line ~765 — anchor: the preceding `expect(appended).toHaveLength(0); // markers EXIST but none COVER → no-op`
      * line ~784 — anchor: extend upward to the enclosing `it("…")` title (immediate trio identical to 803)
      * line ~803 — anchor: extend upward to the enclosing `it("…")` title (immediate trio identical to 784)
      * line ~908 — anchor: the preceding `expect(appended).toHaveLength(0); // null targetUuid → no-op` +
        the `await expect(run(pi, ctx, { target: … })).resolves.toBeDefined();` line above it
  - DO NOT touch the 3 MARKERID-path assertions at ~342, ~362, ~432 (each preceded by `markerId:` run()) —
    they MUST stay "with that id". A global find/replace of the assertion line is FORBIDDEN (it flips all 7).
  - GOTCHA: the assertion line is identical at all 7 sites; craft each oldText with enough surrounding context
    (the preceding run() + expect(appended) line, or the it() title) to be unique.

Task 3: EDIT test/tools/cancel.test.ts — rewrite the stale flag-comment (~lines 559-561)
  - FIND (verbatim current):
      "// ⚠️ VERIFY-AT-IMPLEMENTATION RESOLUTION (research flagged this): S2's cancel.ts returns the SAME not-found
       // text for BOTH paths — \"Mulligan: no active marker found with that id — nothing to cancel.\" (NOT a separate
       // \"...for that target\" string). The target-path no-op cases below pin that shared string."
  - REPLACE WITH (reflects the now-split texts):
      "// BUG-006 (fixed): cancel.ts emits PATH-SPECIFIC not-found text. The markerId path returns \"with that id\"
       // (unchanged); the target path returns the spec/05 §5 verbatim \"for that target\" text. The target-path
       // no-op cases below pin the target-specific string (markerId-path cases above pin \"with that id\")."
  - RATIONALE: the old comment documented the deviation; after Task 1 it is stale. Keep the comment's PURPOSE
    (orienting the reader to which path each no-op block tests), just correct the facts.
  - DO NOT: remove the comment entirely, or alter the `═══` divider line below it.
```

### Implementation Patterns & Key Details

```ts
// The step-3a condition (cancel.ts:368) is the single source of truth for "markerId path was attempted":
//   if (typeof params.markerId === "string" && params.markerId.length > 0) { /* (3a) MARKERID PATH */ }
// The not-found block must test the SAME expression so the text tracks the path actually taken:
//   const usedMarkerId = typeof params.markerId === "string" && params.markerId.length > 0;
//   text: usedMarkerId ? "...with that id..." : "...for that target..."
// (If both target+markerId are given, markerId wins per Decision D1 → step 3a runs → usedMarkerId true →
//  "with that id". Correct. The target path (3b) only runs in the `else if (params.target)` branch.)

// PATTERN (return shape — UNCHANGED): { content: [{type:"text", text}], details:{cancelled:false} }.
//   details is ALWAYS { cancelled: false } on the not-found path (appendCancelMarker NOT called).

// The two spec strings (verbatim, em-dash — included):
//   markerId: "Mulligan: no active marker found with that id — nothing to cancel."   (UNCHANGED)
//   target:   "Mulligan: no active marker found for that target — nothing to cancel."  (spec/05:264)
// Note the em dash (—), not a hyphen. Copy the strings verbatim; do not re-type the dash.

// CRITICAL (test edit): the assertion line is identical at 7 sites. The 4 target-path sites sit inside the
//   `describe("mulligan_cancel — target path (spec/10 §1.11 (a)-(g))")` block; the 3 markerId sites sit in
//   earlier describes. Anchor each target-path edit on its preceding run({target:...}) call; for 784/803 use
//   the enclosing it("...") title as the uniqueness anchor.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — single-block text change.
  - DATABASE: none
  - CONFIG: none (no config field touches the no-op text)
  - ROUTES: none
  - CODE: only the step-4 not-found block in cancel.ts; steps 3a/3b/5/6/7 unchanged.
  - The only "integration" is SPEC FIDELITY: the target-path text must equal spec/05:264 verbatim; the
    markerId text must equal the pre-existing string verbatim. Validation gates enforce via grep + the tests.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T2.S1 edits rewind.ts + rewind.test.ts (different files, no overlap).
    The full-suite gate validates both changesets together.
```

---

## Validation Loop

This is a single-block code edit + targeted test updates. Validation = tsc, the cancel test suite, and a grep
proving both strings are present and the right assertions changed.

### Level 1: Type check

```bash
npx tsc --noEmit
```
Expected: exit 0. The ternary is a `string` literal union; no type signature changes.

### Level 2: the cancel test suite (the core BUG-006 checks)

```bash
npx vitest run test/tools/cancel.test.ts
```
Expected: **all pass.** The 3 markerId-path tests (342/362/432) still assert "with that id" and pass; the 4
target-path tests (765/784/803/908) now assert "for that target" and pass. If a markerId test FAILs, you
accidentally flipped a "stay" site — re-check Task 2's scope. If a target test FAILs on "with that id", the
code ternary is backwards — re-check Task 1's usedMarkerId.

### Level 3: grep verification (both strings present; correct sites changed)

```bash
# (a) cancel.ts now contains BOTH spec strings:
echo "--- cancel.ts: expect BOTH strings ---"
grep -c 'no active marker found' src/tools/cancel.ts                       # expect 2 (both branches)
grep -n 'with that id — nothing to cancel' src/tools/cancel.ts             # expect 1 (markerId branch)
grep -n 'for that target — nothing to cancel' src/tools/cancel.ts          # expect 1 (target branch)

# (b) markerId-path assertions STAY "with that id" (3 sites), target-path NOW "for that target" (4 sites):
echo "--- test: markerId-path still 'with that id' (expect 3) ---"
grep -c 'with that id — nothing to cancel' test/tools/cancel.test.ts       # expect 3 (342/362/432)
echo "--- test: target-path now 'for that target' (expect 4) ---"
grep -c 'for that target — nothing to cancel' test/tools/cancel.test.ts    # expect 4 (765/784/803/908)

# (c) no stale flag-comment remains:
grep -n 'SAME not-found\|text for BOTH paths' test/tools/cancel.test.ts \
  && echo "FAIL: stale deviation comment remains" || echo "PASS: flag-comment updated"
```
Expected: cancel.ts has both strings; the test file has exactly 3 "with that id" assertions (markerId path) and
4 "for that target" assertions (target path); the stale "SAME text for BOTH paths" comment is gone.

### Level 4: Full-suite convergence (validates this + the parallel rewind.ts sibling together)

```bash
# Run the full suite to confirm BUG-006 + BUG-005 (sibling rewind.ts) are green together.
npx vitest run
```
Expected: all tests pass (0 failures). BUG-006 touches cancel.ts/cancel.test.ts; BUG-005 touches
rewind.ts/rewind.test.ts — no overlap, both must be green.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npx tsc --noEmit` → exit 0.
- [ ] Level 2: `npx vitest run test/tools/cancel.test.ts` → all pass.
- [ ] Level 3(a): cancel.ts has both `with that id` (1×) and `for that target` (1×) strings.
- [ ] Level 3(b): test file has exactly 3 `with that id` assertions (342/362/432) + 4 `for that target` (765/784/803/908).
- [ ] Level 3(c): stale "SAME text for BOTH paths" flag-comment is gone.
- [ ] Level 4: `npx vitest run` → full suite green.

### Feature Validation
- [ ] Cancel by `target` with no match → `"…for that target…"`.
- [ ] Cancel by `markerId` with no match → `"…with that id…"` (unchanged).
- [ ] `details` is `{ cancelled: false }` on both paths.
- [ ] The 3 markerId-path tests pass unchanged; the 4 target-path tests pass with the new text.

### Code Quality / Scope Discipline
- [ ] `usedMarkerId` mirrors the step-3a condition (cancel.ts:368) exactly.
- [ ] Did NOT change steps 3a/3b/5/6/7, the already-cancelled text, or any other string.
- [ ] Did NOT touch the 3 markerId-path assertions (342/362/432).
- [ ] Did NOT touch `src/tools/rewind.ts` / `test/tools/rewind.test.ts` (sibling P1.M2.T2.S1).
- [ ] Did NOT touch `spec/*`, README.md, or any other src/test file.
- [ ] Em-dash (—) preserved verbatim in both strings (not a hyphen).

### Documentation
- [ ] The flag-comment now correctly describes the split (no stale "SAME text" claim).
- [ ] No README/spec edit needed (tool result text is runtime agent-facing; spec/05 already correct).

---

## Anti-Patterns to Avoid

- ❌ Don't global-find/replace the assertion line — it's identical at 7 sites; that flips the 3 markerId-path
  tests wrong. Change ONLY the 4 target-path sites (765/784/803/908), distinguished by their `target:` run() call.
- ❌ Don't invent a NEW condition for `usedMarkerId` — copy the step-3a expression (`typeof params.markerId ===
  "string" && params.markerId.length > 0`) verbatim so the text tracks the path actually taken.
- ❌ Don't change `details`, the `if (targetUuid === null)` guard, or the fact that appendCancelMarker isn't
  called here — only the `text` differs by path.
- ❌ Don't touch the 3 markerId-path assertions (342/362/432) — they correctly pin "with that id".
- ❌ Don't edit `rewind.ts`/`rewind.test.ts` (sibling P1.M2.T2.S1 owns them) or `spec/*`/README (out of scope).
- ❌ Don't re-type the em dash as a hyphen — copy the strings verbatim (`—` not `-`).
- ❌ Don't add a "neither"-case test — the schema requires target OR markerId (cancel.ts:125); the branch is
  unreachable through the public API and defensively covered by usedMarkerId=false → target text.
- ❌ Don't skip the flag-comment update (559-561) — it explicitly documents the now-fixed deviation.

---

## Confidence Score

**9/10** for one-pass implementation success. The code change is a single block with verbatim FIND/REPLACE, the
`usedMarkerId` condition is pinned to the existing step-3a expression, both target strings are quoted verbatim
(incl. the em dash), and the spec source-of-truth (spec/05:264) is cited. The one non-trivial risk — the 7
identical assertion lines in cancel.test.ts — is explicitly mapped (4 change / 3 stay) with the distinguishing
`run()` call and unique anchors for each site, plus a grep gate that asserts exactly 3 "with that id" + 4 "for
that target" assertions remain. The deviation flag-comment rewrite is also specified verbatim. Residual risk:
line-number drift from the parallel rewind.ts sibling is mitigated by anchoring edits on the preceding `run()`
call / `it()` title rather than line numbers alone. (Not 10/10 only because the 784/803 identical-trio sites
require the implementer to read their `it()` titles to craft unique oldText — low risk but non-zero.)