# PRP — P1.M2.T1.S1: `needle.length > 0` guard in `resolveShrinkTarget`'s `by_content_includes` arm (BUG-004)

## Goal

**Feature Goal**: Close the BUG-004 defense-in-depth gap in `resolveShrinkTarget` (src/transforms.ts): the
`by_content_includes` arm accepts an empty-string needle, and `String.prototype.includes("") === true` for every
string, so it returns index `0` (the first message) — silently substituting the first message's content on every
context fire. Add `&& needle.length > 0` to the guard so an empty needle falls through to `return null` (no
match → no-op), **mirroring the existing `length > 0` guards on the `by_tool_call_id` and `by_tool_name` arms.**

**Deliverable**: Edits to **two files**:
1. `src/transforms.ts` — (a) the one-condition guard fix (line 791); (b) the JSDoc update (Mode A: the MATCHER
   STRATEGIES line + the dispatcher line + the inline comment).
2. `test/transforms.test.ts` — a **required corollary**: the existing E13 "never throws" test (lines 1145–1150)
   relied on the old empty-needle-matches behavior to exercise a matched throwing-Proxy, and now breaks — it
   MUST be rewritten to assert the new no-op behavior. Plus two small regression assertions that lock in
   `empty needle → null`.

**Success Definition**: After the edit, `resolveShrinkTarget(msgs, { by_content_includes: "" })` returns `null`
(was `0`); `applyShrink` with an empty needle is a no-op (returns the array unchanged, same reference). The
shrink tool layer is unaffected (it still refuses an empty discriminator). `npx tsc --noEmit` exits 0;
`npx vitest run` passes all **952** tests (count unchanged — only `expect()` calls added/changed, no new
`it(...)` blocks).

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers; indirectly the filter hot path (`filterPipeline` → `applyShrink` →
`resolveShrinkTarget`) and any code path that constructs a shrink marker WITHOUT the tool's validation.

**Use Case**: A shrink marker is constructed with an empty/emptied `by_content_includes` (an old persisted
marker from a prior version, a hand-crafted `CustomEntry`, or a marker whose needle was later cleared). The
resolver must NOT silently match the first message.

**Pain Points Addressed**: Eliminates the degenerate "empty needle matches everything" behavior — a latent
data-substitution footgun. Restores symmetry with the other two arms (both already guard `length > 0`).

## Why

- **Defense-in-depth / D5 (honest bookkeeping)**: the shrink tool layer (`targetIsStructurallyValid`) already
  refuses an empty discriminator, so the *tool* path is safe. But `resolveShrinkTarget` is a Pi-FREE pure
  helper consumed by the filter hot path; any marker that bypasses tool validation (persisted/hand-crafted/
  later-emptied) would hit the unguarded arm. PRD §2.5 explicitly recommends "add `needle.length > 0` guard
  inside resolveShrinkTarget's by_content_includes arm (return null for empty) as defense-in-depth, mirroring
  the existing length>0 checks on the other two arms."
- **Consistency**: the two sibling arms (`by_tool_call_id` line 764, `by_tool_name` line 775) already guard
  `typeof x === "string" && x.length > 0`. The `by_content_includes` arm is the lone inconsistency. Fixing it
  makes all three arms uniform.
- **Tiny, safe, well-contained**: one condition added; downstream `applyShrink` already treats `null` as a
  documented no-op (returns the array unchanged, same reference). No new behavior beyond empty→null.

## What

One guard condition (`&& needle.length > 0`) added to the `by_content_includes` branch of
`resolveShrinkTarget` (src/transforms.ts:791), plus the JSDoc/inline-comment updates that ride with it. Plus
the one test that breaks (it used the empty needle as a match trigger) rewritten to the new no-op behavior, and
two small regression assertions. No structural change to `resolveShrinkTarget` (the for-loop and `return null`
are unchanged); no change to `applyShrink`, `filterPipeline`, or the tool layer.

### Success Criteria

- [ ] `resolveShrinkTarget`'s `by_content_includes` guard reads `if (typeof needle === "string" && needle.length > 0)`
      (the bare `typeof needle === "string"` is gone), mirroring the `callId`/`name` arms.
- [ ] The for-loop body and the arm's `return null` are UNCHANGED.
- [ ] JSDoc (MATCHER STRATEGIES line + dispatcher line) + inline comment updated to note an empty needle → null.
- [ ] `resolveShrinkTarget(msgs, { by_content_includes: "" })` returns `null` (was `0`) for any message list.
- [ ] The broken E13 test (lines 1145–1150) is rewritten to assert the no-op (same ref, never throws); the
      other empty-needle test sites (lines 1140, 1117, and `test/tools/shrink.test.ts:251`) are correct/unchanged.
- [ ] `npx tsc --noEmit` exits 0; `npx vitest run` passes all 952 tests (count unchanged).
- [ ] No file other than `src/transforms.ts` and `test/transforms.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current code of the target arm, the sibling-arm guards to mirror, the
verbatim desired guard, the verbatim JSDoc/inline-comment edits, the verbatim broken test (with the exact
before→after rewrite), and the deterministic validation gates. The implementer needs no exploration beyond
opening `src/transforms.ts` and `test/transforms.test.ts`.

### Documentation & References

```yaml
# MUST READ — primary edit target (the guard + JSDoc)
- file: src/transforms.ts
  why: resolveShrinkTarget (lines 758–801). The by_content_includes arm is lines 789–797; the guard to change is
        line 791. The JSDoc MATCHER STRATEGIES are lines 738–745; the dispatcher line is 747–748; the inline
        comment is line 789.
  pattern: "mirror the sibling arms exactly: by_tool_call_id line 764 and by_tool_name line 775 both use
            `typeof x === \"string\" && x.length > 0`. The by_content_includes arm must do the same for `needle`."
  gotcha: "ONLY the guard condition changes. The for-loop (`stringifyContent(...).includes(needle)`) and the
           arm's `return null` stay exactly as-is. An empty needle now falls through PAST this arm to the final
           `return null; // no recognizable discriminator key` (line 799) — same result (null), cleaner path."

# MUST READ — the bug research (root cause + the contrast with the guarded arms + the test gap)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/bug_verification.md
  why: §BUG-004 (lines 154–185) gives the exact buggy code, the contrast with the two guarded arms, and the
        impact (empty needle matches messages[0]). Confirms the fix is `needle.length > 0`.
  critical: "States 'test/transforms.test.ts does not test empty-string needle' — a coverage gap this PRP closes
             with two small regression assertions. ALSO flags the one test that relies on empty-needle-matching."

# MUST READ — secondary edit target (the test that BREAKS — required corollary)
- file: test/transforms.test.ts
  why: The E13 'never throws' test (lines 1138–1150) used an empty `by_content_includes: \"\"` to MATCH an
        all-throwing Proxy trap, then asserted the trap's content was replaced with \"r\". After the fix, an
        empty needle → null → applyShrink is a no-op → the trap is returned UNCHANGED →
        `expect(textOf(out[0])).toBe(\"r\")` FAILS (and textOf(trap) would throw). MUST rewrite.
  section: "the `it(\"spec/08 E13 — NEVER throws …\")` block, lines 1138–1150. Rewrite lines 1145–1150; add a
            .toBeNull() at line 1140; add a positive regression after line 1117."
  gotcha: "Do NOT read the trap's content after the rewrite — the trap throws on every read. Assert reference
           equality (applyShrink returns the same array on no-op), not textOf(out[0])."

# SHOULD READ — confirms the tool layer is separately guarded (NOT affected by this fix)
- file: test/tools/shrink.test.ts
  why: Line 251 `['by_content_includes empty', { by_content_includes: '' }]` is a TOOL-layer parametrized case
        asserting `targetIsStructurallyValid` REFUSES an empty discriminator. The tool never reaches
        resolveShrinkTarget with an empty needle. This test is NOT affected and must NOT change.
  gotcha: "Leave shrink.test.ts UNCHANGED. It tests the tool's own validation, which still refuses empty."

# SHOULD READ — the spec the resolver must honor
- file: spec/06-context-filter.md
  why: §5 (L126–128) defines the three matcher strategies incl. by_content_includes substring match. The fix is
        defense-in-depth consistent with this (an empty substring is not a meaningful match).
  section: "§5 L126–128 (matcher strategies)."
  gotcha: "READ-ONLY — do NOT edit spec/06."

# CONTEXT — the parallel item (confirms no file conflict)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M1T2S1/PRP.md
  why: CONTRACT. Edits src/config.ts + test/config.ts (Math.floor >= 1 guard on shrink.maxActive/staleAfterFires).
        Does NOT touch src/transforms.ts or test/transforms.test.ts → zero overlap; either order OK.
```

### Current Codebase tree (the only relevant slice)

```bash
src/
└── transforms.ts        # ← EDIT: resolveShrinkTarget guard (791) + JSDoc (744–745, 747–748) + inline comment (789)
test/
├── transforms.test.ts   # ← EDIT: rewrite broken E13 test (1145–1150) + 2 regression assertions (1117, 1140)
└── tools/shrink.test.ts # READ-ONLY — tool-layer empty-discriminator refusal (line 251); NOT affected
spec/06-context-filter.md # READ-ONLY reference — §5 matcher strategies
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/transforms.ts        # +1 condition on the guard (line 791) + JSDoc/inline-comment updates (Mode A)
test/transforms.test.ts  # rewrite 1 broken test + add 2 regression assertions (keep suite green + lock in fix)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (the test that breaks): test/transforms.test.ts:1145–1150 used an empty
//   by_content_includes:"" as the ONLY way to match an all-throwing Proxy `trap` (whose content can't be
//   stringified), then asserted the trap's content was REPLACED with "r". After the fix, empty needle → null →
//   applyShrink is a no-op → the trap is returned UNCHANGED (same array ref). So:
//     - `expect(out).toHaveLength(1)` still passes (array length unchanged);
//     - `expect(textOf(out[0])).toBe("r")` FAILS — out[0] is the trap, and textOf(trap) THROWS.
//   You MUST rewrite those lines to assert the no-op (same ref, never throws) — see Task 4. Do NOT leave the
//   suite red.

// CRITICAL GOTCHA #2 (do NOT read the trap after the rewrite): the trap is `new Proxy({...}, new Proxy({},
//   { get(){ throw } }))` — EVERY property read throws. After the fix the trap is returned unchanged, so
//   textOf(out[0]) / out[0].content / any read on it throws. Assert reference equality
//   (`expect(applyShrink(trapArr, ...)).toBe(trapArr)`), NOT content.

// CRITICAL GOTCHA #3 (only the guard changes): change `if (typeof needle === "string")` →
//   `if (typeof needle === "string" && needle.length > 0)`. Do NOT touch the for-loop, the `.includes(needle)`
//   call, or the arm's `return null`. An empty needle now falls through to the function's FINAL `return null`
//   (line 799) — same null result, cleaner path.

// CRITICAL GOTCHA #4 (tool layer is separate): test/tools/shrink.test.ts:251 asserts the TOOL refuses an empty
//   discriminator (targetIsStructurallyValid). That path never reaches resolveShrinkTarget. It is NOT affected
//   by this fix — leave it unchanged. (The tool's own guard and this resolver guard are independent layers.)

// OUT OF SCOPE (do NOT touch in this subtask):
#   - applyShrink, filterPipeline, resolvePinnedShrink, stringifyContent → already handle null/no-op correctly;
#     no change needed.
#   - src/tools/shrink.ts (targetIsStructurallyValid) → tool-layer validation, unchanged.
#   - test/tools/shrink.test.ts → tool tests, unchanged.
#   - spec/06, spec/04, spec/08 → read-only references.
#   - Other arms (by_tool_call_id, by_tool_name) → already correct; do not touch.
# This PRP edits ONLY src/transforms.ts (guard + JSDoc + comment) + test/transforms.test.ts (3 test edits).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no data-model change. The fix adds one condition to an existing guard. `ShrinkTarget` (the
`{ by_content_includes: string }` variant) is unchanged; the resolver simply treats an empty string as "no
match" instead of "match everything."_

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/transforms.ts:791 — add the length>0 guard (THE FIX)
  - LOCATE resolveShrinkTarget's by_content_includes arm (lines 789–797). FIND the guard line:
      "  if (typeof needle === \"string\") {"
  - REPLACE WITH:
      "  if (typeof needle === \"string\" && needle.length > 0) {"
  - RATIONALE: mirrors the sibling arms (callId line 764, name line 775). Empty needle → guard false → fall
    through to the final `return null` (line 799) → no match → no-op. Preserves E13 (never throws).
  - DO NOT: touch the for-loop, the `.includes(needle)` call, or the arm's `return null`; change the other arms.

Task 2: EDIT src/transforms.ts — JSDoc + inline comment (Mode A; rides with the work)
  (2a) MATCHER STRATEGIES line (744–745). FIND:
      " *   - by_content_includes: return the index of the FIRST message (ANY role — spec/08 E19) whose stringified `content`\n *     includes the substring (stringifyContent: string→verbatim, array→JSON.stringify), else null."
    REPLACE WITH:
      " *   - by_content_includes: return the index of the FIRST message (ANY role — spec/08 E19) whose stringified `content`\n *     includes the NON-EMPTY substring (an empty needle resolves to null — defense-in-depth, BUG-004;\n *     stringifyContent: string→verbatim, array→JSON.stringify), else null."
  (2b) dispatcher line (747–748). FIND:
      " * by_content_includes); a target with no recognizable discriminator, or a non-string/empty id/name, resolves to null."
    REPLACE WITH:
      " * by_content_includes); a target with no recognizable discriminator, or a non-string/empty id/name/needle, resolves to null."
  (2c) inline comment (line 789). FIND:
      "  // by_content_includes: first message (ANY role — E19) whose stringified content includes the substring."
    REPLACE WITH:
      "  // by_content_includes: first message (ANY role — E19) whose stringified content includes a NON-EMPTY substring."
  - RATIONALE: keeps the doc consistent with the new guard (empty needle → null). (2b) extends the existing
    "non-string/empty id/name" clause to "id/name/needle" so the dispatcher doc covers all three arms.
  - DO NOT: edit the other strategy bullets (by_tool_call_id, by_tool_name) or any other JSDoc.

Task 3: EDIT test/transforms.test.ts — add 2 regression assertions (lock in empty-needle → null)
  (3a) After the NON-empty "u" assertion (line 1117), inside the SAME it(...) block. FIND:
      "    expect(resolveShrinkTarget(msgs, { by_content_includes: \"u\" })).toBe(0); // user(\"u\") stringified includes \"u\""
    REPLACE WITH (append a sibling empty-needle assertion):
      "    expect(resolveShrinkTarget(msgs, { by_content_includes: \"u\" })).toBe(0); // user(\"u\") stringified includes \"u\"\n    expect(resolveShrinkTarget(msgs, { by_content_includes: \"\" })).toBeNull(); // BUG-004: empty needle → no match (null, not 0)"
  (3b) Strengthen the throwing-Proxy no-throw check (line 1140). FIND:
      "    expect(() => resolveShrinkTarget([trap], { by_content_includes: \"\" })).not.toThrow();"
    REPLACE WITH (add the return-value assertion on the next line):
      "    expect(() => resolveShrinkTarget([trap], { by_content_includes: \"\" })).not.toThrow();\n    expect(resolveShrinkTarget([trap], { by_content_includes: \"\" })).toBeNull(); // BUG-004: empty needle → null even on a throwing-Proxy"
  - RATIONALE: closes the coverage gap (bug_verification: "does not test empty-string needle"). (3a) is a clean
    positive assertion on a NORMAL array; (3b) confirms it on the hard throwing-Proxy case. Both lock in null.
  - DO NOT: add new it(...) blocks (keeps the reported test count at 952); change the "u" assertion itself.

Task 4: EDIT test/transforms.test.ts:1145–1150 — REWRITE the broken E13 assertion (REQUIRED corollary)
  - FIND (verbatim current — the comment + the matched→replaced assertions):
      "    // applyShrink where the throwing-Proxy IS matched (empty needle matches empty stringified content) → spread is\n    // try/caught → minimal fallback → never throws, content replaced.\n    expect(() => applyShrink([trap], { target: { by_content_includes: \"\" }, replacement: \"r\" })).not.toThrow();\n    const out = applyShrink([trap], { target: { by_content_includes: \"\" }, replacement: \"r\" });\n    expect(out).toHaveLength(1);\n    expect(textOf(out[0])).toBe(\"r\");               // fallback still replaced content (role read safely before spread)"
  - REPLACE WITH (no-op → same ref, never throws — does NOT read the trap):
      "    // BUG-004: an empty by_content_includes needle now resolves to null → applyShrink is a NO-OP (returns the\n    // array unchanged, same reference) and never throws even when a throwing-Proxy is the sole message.\n    const trapArr: MessageLike[] = [trap];\n    expect(() => applyShrink(trapArr, { target: { by_content_includes: \"\" }, replacement: \"r\" })).not.toThrow();\n    expect(applyShrink(trapArr, { target: { by_content_includes: \"\" }, replacement: \"r\" })).toBe(trapArr); // no-op → same ref"
  - RATIONALE: the old assertion relied on empty-needle-matches to exercise a matched throwing-Proxy; that path
    no longer exists (empty → null). The new assertions preserve E13 (applyShrink never throws on a
    throwing-Proxy) AND assert the correct new behavior (no-op → same reference). Using a named `trapArr`
    variable enables the reference-equality check without reading the trap's content (which would throw).
  - DO NOT: call textOf/out[0].content on the result (the trap throws on read); assert reference equality only.
```

#### Resulting by_content_includes arm (post-edit, src/transforms.ts:789–797)

```ts
  // by_content_includes: first message (ANY role — E19) whose stringified content includes a NON-EMPTY substring.
  const needle = readOwn(target, "by_content_includes");
  if (typeof needle === "string" && needle.length > 0) {
    for (let i = 0; i < messages.length; i++) {
      if (stringifyContent(readOwn(messages[i], "content")).includes(needle)) return i;
    }
    return null;
  }

  return null; // no recognizable discriminator key
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: all three arms now use the SAME guard shape. Compare:
//   by_tool_call_id (764): if (typeof callId === "string" && callId.length > 0)
//   by_tool_name    (775): if (typeof name   === "string" && name.length   > 0)
//   by_content_includes:   if (typeof needle === "string" && needle.length > 0)   // ← the fix

// WHY empty → null is safe downstream:
//   resolveShrinkTarget returns number | null. applyShrink's LIVE/unpinned path checks the index; on null it
//   returns the messages array UNCHANGED (same reference — a documented no-op). So empty needle → no
//   substitution, the turn survives, and the shrink retries next fire (compaction-robust per spec/06 §5:133).

// WHY the E13 test breaks (the gotcha): the all-throwing Proxy `trap` can ONLY be "matched" by an empty
// needle (its content throws → stringifies to "" → "".includes("") === true). With the guard, empty → null,
// so applyShrink no-ops and returns the trap unchanged. The old `expect(textOf(out[0])).toBe("r")` both
// (a) is semantically wrong now and (b) would throw (textOf reads the trap). Rewrite to reference-equality.
```

### Integration Points

```yaml
CODE:
  - modify: src/transforms.ts — resolveShrinkTarget guard (line 791) + JSDoc (744–745, 747–748) + comment (789)
  - consumed-by (NO change): applyShrink already handles null as a no-op; filterPipeline unchanged.
TESTS:
  - modify: test/transforms.test.ts — rewrite broken E13 test (1145–1150) + 2 regression assertions (1117, 1140)
  - unchanged: test/tools/shrink.test.ts:251 (tool-layer refusal — independent of the resolver)

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config, no DB, no routes, no tool registration. Pure-helper defense-in-depth fix.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Strict type-check — the added condition is type-trivial (needle is string inside the guard).
npx tsc --noEmit
echo "tsc exit: $?"   # expect 0 (baseline was 0)

# Confirm the guard + JSDoc landed:
grep -n 'needle.length > 0\|typeof needle' src/transforms.ts   # expect the guard line with && needle.length > 0
grep -n 'NON-EMPTY substring\|empty id/name/needle' src/transforms.ts   # expect the JSDoc edits
```
Expected: `tsc` exits 0; the guard grep prints the new condition; the JSDoc grep prints both edits.

### Level 2: Unit Tests (Component Validation)

```bash
# The transforms suite — the rewritten E13 test + the 2 new assertions live here.
npx vitest run test/transforms.test.ts
# Expected: all pass. If the E13 test fails with a throw on textOf(out[0]), you did NOT rewrite lines 1145–1150
# (re-apply Task 4). If a 'resolveShrinkTarget(...) toBeNull' fails, the guard wasn't applied (re-check Task 1).

# The shrink TOOL suite — confirms the tool layer is unaffected.
npx vitest run test/tools/shrink.test.ts
# Expected: all pass (the tool still refuses an empty discriminator; it never reaches the resolver).

# Full suite — regression guard (must stay at 952).
npx vitest run
# Expected: 952 passed (952). No count change (only expect() calls added/changed, no new it(...) blocks).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. The "system" validation for a pure-helper fix is a direct behavior check:
npx tsx -e "
import { resolveShrinkTarget } from './src/transforms.js';
const msgs = [{ role: 'user', content: 'hello' }];
console.log('empty ->', resolveShrinkTarget(msgs as any, { by_content_includes: '' }));   // null (was 0)
console.log('hello ->', resolveShrinkTarget(msgs as any, { by_content_includes: 'hello' })); // 0 (non-empty still matches)
"
# Expected: empty -> null ; hello -> 0. (Proves empty→null and that non-empty matching is unchanged.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for a one-condition pure-helper guard. No UI, no perf, no security surface.
# Levels 1–3 fully cover correctness for this subtask.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` exits 0 (baseline 0; the condition is type-trivial).
- [ ] `npx vitest run test/transforms.test.ts` — all pass (rewritten E13 test + 2 new assertions green).
- [ ] `npx vitest run test/tools/shrink.test.ts` — all pass (tool layer unaffected).
- [ ] `npx vitest run` — full suite passes (952, no count change).

### Feature Validation
- [ ] `resolveShrinkTarget`'s by_content_includes guard is `typeof needle === "string" && needle.length > 0`.
- [ ] The for-loop, `.includes(needle)`, and the arm's `return null` are unchanged.
- [ ] `resolveShrinkTarget(msgs, { by_content_includes: "" })` returns `null` (was `0`); non-empty needles match as before.
- [ ] JSDoc (MATCHER STRATEGIES + dispatcher) + inline comment note the empty-needle → null behavior (BUG-004).
- [ ] The broken E13 test is rewritten (no-op → same ref, never throws; does NOT read the trap).
- [ ] No edits to any file other than `src/transforms.ts` and `test/transforms.test.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT touch `applyShrink`, `filterPipeline`, `resolvePinnedShrink`, `stringifyContent` (they handle null/no-op correctly).
- [ ] Did NOT touch `src/tools/shrink.ts` or `test/tools/shrink.test.ts` (tool layer is a separate, unaffected guard).
- [ ] Did NOT touch the `by_tool_call_id` / `by_tool_name` arms (already correct).
- [ ] Did NOT edit spec/06 / spec/04 / spec/08 (read-only references).
- [ ] Did NOT add new `it(...)` blocks (count stays 952); only `expect()` calls added/changed.

### Documentation
- [ ] JSDoc + inline comment updated (Mode A) — this IS the inline doc for this subtask. No separate doc file.

---

## Anti-Patterns to Avoid

- ❌ Don't ship the guard without rewriting the broken E13 test (lines 1145–1150) — `npx vitest run` will be RED
  (the old assertion expects content replacement + calls `textOf(trap)` which throws). The rewrite is REQUIRED.
- ❌ Don't read the trap's content in the rewritten test (`textOf(out[0])`, `out[0].content`, …) — the trap
  throws on every read. Assert reference equality (`expect(applyShrink(trapArr, …)).toBe(trapArr)`).
- ❌ Don't change the for-loop, the `.includes(needle)` call, or the arm's `return null` — only the guard condition.
- ❌ Don't "fix" it by making `stringifyContent` return a sentinel for empty — the guard is the correct, minimal,
  symmetric fix (mirrors the other two arms).
- ❌ Don't touch `test/tools/shrink.test.ts:251` — that tests the TOOL's own empty-discriminator refusal, which
  is unaffected (the tool never reaches the resolver with an empty needle).
- ❌ Don't add new `it(...)` blocks or change the test count — add `expect()` calls inside existing blocks.
- ❌ Don't edit `applyShrink`/`filterPipeline`/spec files — they're correct/ read-only.

---

## Confidence Score

**9/10** for one-pass implementation success. The fix is a single symmetric condition mirroring two existing
sibling guards, with verbatim find/replace for the guard, the JSDoc, the inline comment, and the broken test
rewrite. The one non-obvious risk — the E13 test that used the empty needle as a match trigger — is surfaced
prominently with the exact before→after rewrite and an explicit "don't read the trap" warning. The two added
regression assertions lock in `empty → null` on both a normal array and the throwing-Proxy. Residual risks:
(1) the implementer forgets the test rewrite (mitigated by the Level-2 gate's explicit "throw on textOf(out[0])"
failure signature); (2) an edit lands on the wrong `typeof needle` site (mitigated — there's only ONE such guard
in the file, per the grep). Both are caught immediately by `npx vitest run test/transforms.test.ts`. No
dependency on the parallel item (separate files); no new behavior beyond empty→null.