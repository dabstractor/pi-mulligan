# PRP — P1.M2.T2.S1: Comment alignment for `display:true` rationale (rewind-note `leaveNote`)

## Goal

**Feature Goal**: Align the `display:true` comment in `src/markers.ts` `leaveNote()` with the authoritative
rationale in **spec/05 §1 step 6**. The current comment only says the note is "visible in the UI transcript";
it omits the deliberate-operator-visibility rationale: `display:true` is **deliberate**, surfaces the note to
the **operator** (the human sees exactly what the model told its resumed self), and is the **rewind counterpart
of shrink's replacement echo** (`ctx.ui.notify`). The expanded comment must cite **spec/05 §1 step 6** and
**spec/05 §1 Purpose** ("flagship UX").

**Deliverable**: An expanded **JSDoc paragraph** in `src/markers.ts` `leaveNote()` (the paragraph documenting
`display:true`, currently lines 367-368). **No code change, no test change, no other file.** Mode A — the
comment IS the documentation.

**Success Definition**: After the edit, the `display:true` JSDoc paragraph (a) states `display:true` is
**deliberate**; (b) states it surfaces the note to the **operator** (human sees exactly what the model told its
resumed self); (c) calls out the **rewind counterpart of shrink's replacement echo** (`ctx.ui.notify` in
shrink.ts step 5b); (d) cites **spec/05 §1 step 6**; (e) cites **spec/05 §1 Purpose** ("flagship UX"). The
`pi.sendMessage({ ... display: true ... })` code line is **byte-identical**; `npm run typecheck` passes; the
markers test suite stays green (comment-only change).

## User Persona

**Target User**: A future developer reading `src/markers.ts` `leaveNote()` to understand why the rewind note
passes `display:true` (vs. a purely in-context hidden custom message).

**Use Case**: Tracing the operator-visibility contract of Mulligan's payloads (rewind note vs. shrink echo).

**Pain Points Addressed**: Today the comment mentions the UI transcript surface but not the *rationale* — a
reader cannot tell whether `display:true` is an accident or a deliberate operator-visibility choice, nor that
it pairs with shrink's `ctx.ui.notify` echo.

## Why

- The spec's authoritative statement (`spec/05-tools.md:80`, §1 step 6, **bolded**) reads: *"`display:true` is
  deliberate — it surfaces the note to the operator as well, so the human can see exactly what the model told
  its resumed self. This is the rewind counterpart of shrink's replacement echo: every self-directed payload is
  operator-visible."* The code comment should mirror this rationale so a reader of the code understands the
  *intent*, not just the surface.
- `spec/05-tools.md:16` (§1 Purpose) frames the note as **Mulligan's flagship UX** ("the structured
  self-authored note is Mulligan's flagship UX"). Citing this ties the low-level `display:true` flag to the
  product-level rationale (a hide becomes a *better-informed retry* because the note is read by the resumed
  model AND seen by the human).
- The **shrink** counterpart lives in `src/tools/shrink.ts:320-326` (step 5b, added by P1.M2.T1.S2): it echoes
  the replacement to the operator via `ctx.ui.notify(...)` (zero-context-cost). Rewind's `display:true` is the
  symmetric mechanism on the rewind side. Drawing this parallel in the comment is the core alignment task.
- **No business logic, no code, no tests.** Pure documentation/comment fix (Mode A).

## What

One JSDoc paragraph is **expanded in place** (the paragraph that documents `display:true`, currently lines
367-368). The expansion incorporates the five rationale points below. No code line, no other paragraph, no
other file changes.

### Success Criteria

- [ ] The `display:true` JSDoc paragraph states `display:true` is **deliberate**.
- [ ] It states the note is surfaced to the **operator** (the human sees exactly what the model told its
      resumed self via the rewind note), visible in the UI transcript (`/tree`).
- [ ] It names this as the **rewind counterpart of shrink's replacement echo** (`ctx.ui.notify` in shrink.ts
      step 5b) — "every self-directed payload is operator-visible".
- [ ] It cites **spec/05 §1 step 6** (the bolded `display:true` rationale).
- [ ] It cites **spec/05 §1 Purpose** ("flagship UX").
- [ ] The `pi.sendMessage({ customType: "mulligan:note", content, display: true, details })` code line
      (line ~383) is **byte-identical** (no code change).
- [ ] `npm run typecheck` passes; `npx vitest run test/markers.test.ts` (or full `npm test`) stays green.
- [ ] No file other than `src/markers.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the **verbatim current JSDoc paragraph** (the FIND target), the **verbatim expanded
replacement** (the REPLACE target), the authoritative spec rationale with exact file/line citations, the
shrink-echo counterpart with exact file/line citations, and deterministic grep + typecheck + vitest validation
gates. The implementer needs no codebase exploration beyond opening `src/markers.ts` at the `leaveNote()` JSDoc.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this PRP modifies (comment-only)
- file: src/markers.ts
  why: The leaveNote() function JSDoc paragraph documenting display:true (lines 367-368) omits the deliberate-
        operator-visibility rationale. Expand it.
  section: "leaveNote() JSDoc — the paragraph beginning '* `display:true` (spec/04 §3) so the note is visible
            in the UI transcript (/tree) ...'. (Function body at line ~379-385; JSDoc lines ~358-377.)"
  pattern: "JSDoc /** ... */ block; each non-blank line starts with ' * ' (space-asterisk-space). Expand the ONE
            display:true paragraph; leave the other paragraphs (C8/triggerTurn, Returns/never-throws, @param) and
            the function body untouched."
  gotcha: "DO NOT touch the code line `pi.sendMessage({ customType: \"mulligan:note\", content, display: true,
           details });` (line ~383) or any code line. Edit ONLY the JSDoc paragraph. Preserve the '`content` is
           the rendered note string (notes.renderNote output).' fact (it documents the @param content contract)."

# MUST READ — the authoritative rationale the comment must mirror (spec/05 §1 step 6, BOLDED)
- file: spec/05-tools.md
  why: Line 80 (§1 'Behavior (step by step)', step 6 Persist) is the BOLDED display:true rationale — the exact
        wording the comment must cite/paraphrase. Line 16 (§1 Purpose) is the 'flagship UX' framing.
  section: "§1 step 6 (line ~80) — '**(`display:true` is deliberate — it surfaces the note to the operator as
            well ... This is the rewind counterpart of shrink's replacement echo: every self-directed payload is
            operator-visible.)**'; §1 Purpose (line ~16) — '**The structured self-authored note is Mulligan's
            flagship UX**'."
  critical: "This is the source-of-truth for the five rationale points. The expanded comment must capture all
             five. READ-ONLY — do NOT edit spec/*."

# MUST READ — the shrink counterpart the comment references (rewind ⟺ shrink operator-echo)
- file: src/tools/shrink.ts
  why: Lines 320-326 (shrink step 5b) — the operator-visible replacement echo added by P1.M2.T1.S2: it calls
        ctx.ui.notify(`Shrunk <target> — replacement:\\n<<<\\n${capped}\\n>>>`, \"info\"). This is the shrink-side
        analogue of rewind's display:true; the expanded comment names it as the counterpart.
  section: "shrinkExecute step 5b (~line 320-326). READ-ONLY — do NOT edit (owned by P1.M2.T1.S2 [complete])."
  pattern: "shrink echoes the replacement to the OPERATOR via ctx.ui.notify (zero context cost — the model never
            sees it); rewind mirrors the note into the UI transcript via display:true. Both make the
            self-directed payload operator-visible."

# CONTEXT — the parallel sibling (no file conflict)
- file: plan/005_95d30743cdd4/P1M2T1S3/PRP.md
  why: CONTRACT. P1.M2.T1.S3 is test-only — it edits test/tools/shrink.test.ts + test/config.test.ts ONLY.
        It does NOT touch src/markers.ts. No overlap. (It verifies the shrink echo/notify contract that this
        comment references as the counterpart.)
```

### Current Codebase tree (the only relevant slice)

```bash
src/
├── markers.ts        # ← EDIT leaveNote() JSDoc display:true paragraph ONLY (lines ~367-368); no code change
└── tools/
    └── shrink.ts     # READ-ONLY — step 5b ctx.ui.notify echo (the referenced counterpart; owned by P1.M2.T1.S2)
spec/
└── 05-tools.md       # READ-ONLY — §1 step 6 (line ~80, bolded rationale) + §1 Purpose (line ~16, 'flagship UX')
test/
└── markers.test.ts   # READ-ONLY — run to confirm the comment change is behavior-neutral
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: this is a JSDoc-COMMENT-ONLY edit. No code, no test changes.
#   - Edit ONLY the ONE paragraph in leaveNote()'s JSDoc that documents display:true (lines ~367-368).
#   - Leave the function body (incl. the pi.sendMessage({ ... display: true ... }) line) byte-identical.
#   - Leave the other JSDoc paragraphs (C8/triggerTurn, Returns/never-throws, @param pi/content/rewindId) intact.

# CRITICAL — the rationale the comment must capture (verbatim from spec/05 §1 step 6, BOLDED):
#   "display:true is deliberate — it surfaces the note to the operator as well, so the human can see exactly
#    what the model told its resumed self. This is the rewind counterpart of shrink's replacement echo:
#    every self-directed payload is operator-visible."
# Plus spec/05 §1 Purpose: "the structured self-authored note is Mulligan's flagship UX".

# GOTCHA — preserve the existing factual content of the paragraph:
#   "`content` is the rendered note string (notes.renderNote output)."  ← keep this (documents @param content).

# GOTCHA — the paragraph is inside a JSDoc /** ... */ block. Every content line begins with " * " (space,
#   asterisk, space). Match that prefix EXACTLY in the replacement so the JSDoc renders cleanly and tsc/vitest
#   are unaffected. Do not introduce a stray "*/" or unbalanced asterisks.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - src/tools/shrink.ts        -> owned by P1.M2.T1.S2 [complete] (the referenced counterpart, NOT a file to edit).
#   - test/*                      -> no test changes (comment-only). test/tools/shrink.test.ts + test/config.test.ts
#                                    are owned by the parallel sibling P1.M2.T1.S3.
#   - spec/*                      -> READ-ONLY (spec/05 §1 is the cited source-of-truth).
#   - The leaveNote() function body / the pi.sendMessage(...) call / any code line.
#   - Other JSDoc paragraphs in leaveNote() (C8/triggerTurn; Returns/never-throws; @param lines).
# This PRP edits ONLY the display:true JSDoc paragraph in src/markers.ts leaveNote().
```

---

## Implementation Blueprint

### Data models and structure
_N/A — comment-only edit (Mode A). No code, no types, no migrations._

### Implementation Tasks (ordered by dependencies)

One task; one exact JSDoc paragraph replacement. **Verify the `FIND` block matches verbatim before replacing.**

```yaml
Task 1: EDIT src/markers.ts — leaveNote() JSDoc display:true paragraph (lines ~367-368)
  - FIND (verbatim current — the 2-line JSDoc paragraph; note the " * " prefix on each line):
      " * `display:true` (spec/04 §3) so the note is visible in the UI transcript (/tree). `content` is the rendered note\n * string (notes.renderNote output)."
  - REPLACE WITH (the expanded paragraph — same " * " prefix on each line; covers all five rationale points
    AND preserves the `content` fact):
      " * `display:true` (spec/04 §3; spec/05 §1 step 6) is DELIBERATE: it surfaces the note to the OPERATOR as well as\n * the model — the human sees exactly what the model told its resumed self via the rewind note (visible in the UI\n * transcript, /tree). This is the rewind counterpart of shrink's replacement echo (`ctx.ui.notify` in shrink.ts\n * step 5b): every self-directed payload is operator-visible, mirroring the note's in-context role for the resumed\n * model (spec/05 §1 Purpose — \"the structured self-authored note is Mulligan's flagship UX\"). `content` is the\n * rendered note string (notes.renderNote output)."
  - RATIONALE (mapping to the 5 required points):
      (a) "is DELIBERATE"                                → deliberate intent.
      (b) "surfaces the note to the OPERATOR ... the human sees exactly what the model told its resumed self"
                                                         → operator visibility wording (mirrors spec/05 §1 step 6).
      (c) "rewind counterpart of shrink's replacement echo (`ctx.ui.notify` in shrink.ts step 5b)"
                                                         → the shrink parallel (src/tools/shrink.ts:320-326).
      (d) "spec/05 §1 step 6"                            → step-6 citation.
      (e) "spec/05 §1 Purpose — 'flagship UX'"           → Purpose citation.
      Plus preserves "`content` is the rendered note string (notes.renderNote output)." (documents @param content).
  - PRESERVE: the " * " (space-asterisk-space) JSDoc line prefix; the backtick-fenced `display:true`, `content`,
    `ctx.ui.notify`, `/tree` tokens; the balanced /** ... */ block (no stray "*/"). Do NOT touch the function
    body or any other JSDoc paragraph.
  - DO NOT: change any code line, any assertion, any import, any other paragraph, or any other file. The
    `pi.sendMessage({ customType: "mulligan:note", content, display: true, details })` line stays byte-identical.
  - NOTE: the EXACT wording above is a recommended phrasing; the contract is satisfied by ANY wording that (a)
    states display:true is deliberate, (b) states operator visibility (human sees what the model told its resumed
    self), (c) names the shrink/ctx.ui.notify counterpart, (d) cites spec/05 §1 step 6, (e) cites spec/05 §1
    Purpose. If you rephrase, keep it tight and keep the `content` fact.
```

### Implementation Patterns & Key Details

```ts
// The code under test (UNCHANGED) — src/markers.ts leaveNote():
//   pi.sendMessage({ customType: "mulligan:note", content, display: true, details });
//                                                            ^^^^^^^^^^^
//   display:true mirrors the note into the UI transcript (/tree) so the OPERATOR sees it — not just the model.
//   Spec authority: spec/05-tools.md:80 (§1 step 6, BOLDED) + spec/05-tools.md:16 (§1 Purpose, 'flagship UX').

// The symmetric shrink-side mechanism (src/tools/shrink.ts:320-326, step 5b — the referenced counterpart):
//   const capped = cap(params.replacement, config.shrink.notifyMaxChars);
//   ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
//   // ^ zero-context-cost operator echo of the replacement (the model never sees it).
// Rewind's display:true is the symmetric operator-visible payload on the rewind side.

// PATTERN (comment-alignment): keep the JSDoc factual content + add the rationale citation. Do NOT rewrite the
// function or change behavior. The comment must read as "why display:true is set", citing the spec step that
// mandates it.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — comment-only change (Mode A).
  - DATABASE: none
  - CONFIG: none (the comment CITES spec/05 §1 but changes no config)
  - ROUTES: none
  - CODE: none (the pi.sendMessage(...) call is byte-identical; src/tools/shrink.ts is a READ-ONLY reference;
           spec/* is the cited source-of-truth)
  - The only "integration" is CROSS-DOC CONSISTENCY: the code comment must AGREE with spec/05 §1 step 6
    (line ~80) and §1 Purpose (line ~16). Validation gates below enforce this via grep.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T1.S3 is test-only (test/tools/shrink.test.ts + test/config.test.ts);
    no overlap with src/markers.ts. The shrink echo/notify contract it verifies is exactly what this comment
    references as the counterpart — both must describe the same operator-visibility intent.
```

---

## Validation Loop

This is a JSDoc comment edit to one `.ts` file. Validation = grep that the five rationale points + spec
citations are present, `tsc --noEmit` clean, and the markers test suite green (comment-only = behavior-neutral).

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Confirm the edit landed and the JSDoc block is still balanced (open /** ... close */ intact, " * " prefix):
sed -n '358,378p' src/markers.ts
# Also confirm the code line is byte-identical (display:true still passed, no accidental code change):
sed -n '383p' src/markers.ts
```
Expected: the `display:true` JSDoc paragraph now reads "is DELIBERATE: it surfaces the note to the OPERATOR ..."
with the spec/05 §1 step 6 + Purpose citations; the `pi.sendMessage({ customType: "mulligan:note", content,
display: true, details });` code line is unchanged.

### Level 2: Rationale-content gate (the core contract checks)

```bash
# (a) "deliberate" present in the display:true paragraph:
grep -n 'display:true.*DELIBERATE\|DELBERATE' src/markers.ts   # expect a hit in the JSDoc

# (b) operator-visibility wording present:
grep -n 'surfaces the note to the OPERATOR\|the human sees exactly what the model told its resumed self' src/markers.ts

# (c) the shrink counterpart named:
grep -n 'rewind counterpart of shrink.s replacement echo\|ctx.ui.notify' src/markers.ts   # expect a hit

# (d) spec/05 §1 step 6 cited:
grep -n 'spec/05 §1 step 6' src/markers.ts     # expect a hit in the JSDoc

# (e) spec/05 §1 Purpose / 'flagship UX' cited:
grep -n 'spec/05 §1 Purpose\|flagship UX' src/markers.ts   # expect a hit

# (f) the content/@param fact was preserved (NOT dropped):
grep -n 'rendered note string (notes.renderNote output)' src/markers.ts   # expect a hit
```
Expected: all of (a)-(f) present. (Use `grep -ni` if you rephrased casing; the contract is the *content*, not
exact strings — but every point must be visibly present.)

### Level 3: Build + unit tests (system validation — prove no behavioral change)

```bash
# Type-check (comments don't affect types; confirms no stray breakage like an unbalanced JSDoc):
npm run typecheck          # = tsc --noEmit — expect ZERO errors

# Run the markers test suite (comment-only → must be green, unchanged):
npx vitest run test/markers.test.ts

# Optional full suite sanity (the comment touches no behavior):
npx vitest run             # or: npm test  (= vitest run)
```
Expected: `tsc --noEmit` clean; markers tests (and full suite) pass identically to before. Because only a JSDoc
comment changed, TypeScript and vitest results MUST be unchanged. If anything fails, a comment was accidentally
edited into code — re-read the diff and fix.

### Level 4: Cross-doc consistency (system validation)

```bash
# The expanded comment must AGREE with the spec source-of-truth (spec/05 §1 step 6 + Purpose).
echo "--- code comment (the corrected paragraph) ---"
sed -n '367,372p' src/markers.ts

echo "--- spec/05 §1 step 6 (the bolded rationale) ---"
sed -n '80p' spec/05-tools.md

echo "--- spec/05 §1 Purpose (flagship UX) ---"
sed -n '16p' spec/05-tools.md

echo "--- shrink counterpart (the referenced ctx.ui.notify echo) ---"
sed -n '320,326p' src/tools/shrink.ts
```
Expected: the comment cites spec/05 §1 step 6 + Purpose; spec/05:80 contains the "display:true is deliberate"
bolded note; spec/05:16 contains "flagship UX"; src/tools/shrink.ts:320-326 contains the `ctx.ui.notify` echo
the comment names as the counterpart.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
# The only source change should be the leaveNote() JSDoc paragraph — no code, no other file.
git -C . diff -- src/markers.ts | head -40
# Assert no other file was touched by THIS task (siblings edit their own files in their own sessions):
git -C . diff --name-only -- src/tools/shrink.ts spec/05-tools.md test/tools/shrink.test.ts test/config.test.ts
# Expected: NO changes to those four files from this PRP.
```
Expected: the only hunk is the expanded JSDoc paragraph (a `-`/`+` block on the display:true comment); the
`pi.sendMessage(...)` line and all other code are unchanged; no other file is modified by this task.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `sed -n '358,378p' src/markers.ts` shows the expanded `display:true` paragraph; `sed -n '383p`
      src/markers.ts` shows the `pi.sendMessage(...)` line byte-identical.
- [ ] Level 2: grep confirms (a) DELIBERATE, (b) operator visibility wording, (c) shrink/`ctx.ui.notify`
      counterpart, (d) spec/05 §1 step 6, (e) spec/05 §1 Purpose/'flagship UX', (f) `content` fact preserved.
- [ ] Level 3: `npm run typecheck` clean; `npx vitest run test/markers.test.ts` green (unchanged).
- [ ] Level 4: comment agrees with spec/05:80 (step 6) + spec/05:16 (Purpose) + shrink.ts:320-326 (counterpart).
- [ ] Level 5: `git diff -- src/markers.ts` is a single comment hunk; no other file touched.

### Feature Validation
- [ ] The `display:true` paragraph states `display:true` is **deliberate**.
- [ ] It states the note is surfaced to the **operator** (human sees what the model told its resumed self).
- [ ] It names the **rewind counterpart of shrink's replacement echo** (`ctx.ui.notify` in shrink.ts step 5b).
- [ ] It cites **spec/05 §1 step 6** and **spec/05 §1 Purpose** ("flagship UX").
- [ ] The `pi.sendMessage({ ... display: true ... })` code line is unchanged (no behavior change).

### Code Quality / Scope Discipline
- [ ] Did NOT touch `src/tools/shrink.ts` (owned by P1.M2.T1.S2 [complete]; it is the referenced counterpart).
- [ ] Did NOT touch `test/*` (no test changes — comment-only; shrink/config tests owned by P1.M2.T1.S3).
- [ ] Did NOT touch `spec/*` (READ-ONLY — spec/05 §1 is the cited source-of-truth).
- [ ] Did NOT touch the `leaveNote()` function body, the `pi.sendMessage(...)` call, or any code line.
- [ ] Did NOT touch other JSDoc paragraphs in `leaveNote()` (C8/triggerTurn; Returns/never-throws; @param lines).
- [ ] Preserved the "`content` is the rendered note string (notes.renderNote output)." fact.

### Documentation
- [ ] The code comment now mirrors the spec's deliberate-operator-visibility rationale (spec/05 §1 step 6).
- [ ] A future reader of `leaveNote()` understands `display:true` is intentional and pairs with shrink's echo.

---

## Anti-Patterns to Avoid

- ❌ Don't change any CODE — this is comment-only (Mode A). The `pi.sendMessage({ ... display: true ... })` line,
  the function signature, and the function body are byte-identical before/after.
- ❌ Don't drop the "`content` is the rendered note string (notes.renderNote output)." fact — it documents the
  `@param content` contract and must be preserved.
- ❌ Don't rewrite the whole JSDoc block or other paragraphs — expand ONLY the `display:true` paragraph.
- ❌ Don't edit `src/tools/shrink.ts` — it is the *referenced counterpart* (owned by P1.M2.T1.S2 [complete]),
  not a file to change here. The comment *names* it; it does not modify it.
- ❌ Don't edit `spec/*` — spec/05 §1 is the cited source-of-truth (READ-ONLY).
- ❌ Don't add/modify tests — comment-only; the shrink/config test contracts are owned by P1.M2.T1.S3.
- ❌ Don't leave the rationale partial — all FIVE points (deliberate / operator-sees / shrink counterpart /
  step 6 cite / Purpose cite) must be present in the expanded paragraph.

---

## Confidence Score

**10/10** for one-pass implementation success. This is a single JSDoc paragraph expansion in one file, with the
verbatim FIND (2-line current paragraph) and REPLACE (expanded paragraph) strings, the authoritative spec
rationale verbatim (`spec/05-tools.md:80` step 6 bolded + `:16` Purpose "flagship UX"), the exact shrink
counterpart citation (`src/tools/shrink.ts:320-326` step 5b `ctx.ui.notify`), a five-point rationale→comment
mapping, and deterministic grep + `tsc --noEmit` + vitest validation gates. The change is provably
non-behavioral (comment-only), so typecheck and tests are guaranteed unchanged. The parallel-sibling contract
(P1.M2.T1.S3 is test-only, edits `test/tools/shrink.test.ts` + `test/config.test.ts`) is non-overlapping. The
only residual risk — accidentally editing a code line or unbalancing the JSDoc — is explicitly called out as a
DO-NOT and caught by the Level 1 (`sed -n '383p'` byte-identical) + Level 3 (`tsc --noEmit`) gates.