# PRP — P1.M2.T1.S1: Renderer text + JSDocs (`renderBloatReminder` + `renderDriftNudge`)

## Goal

**Feature Goal**: Re-shorten the two nudge renderer strings in `src/notes.ts` to match spec/07 §1/§2 (the text
had drifted long). `renderBloatReminder` drops the verbose "This result added … If you don't need … call …
with a summary or …(granularity:…)" scaffolding (~30→~20 tokens). `renderDriftNudge` drops "that growth was",
converts the parentheticals "(undo the turn)"/"(compact a result)" to "to undo the turn"/"to compact a
result", and removes the entire "; run `mulligan_audit` for a breakdown" clause. Both JSDoc FORMAT blocks +
the cost note are updated to match (Mode A inline docs).

**Deliverable**: Edits to **exactly one file** — `src/notes.ts`:
- `renderBloatReminder` body (line 271) — new short return string.
- `renderDriftNudge` body tail (line 320) — new short tail (lead selection unchanged).
- `renderBloatReminder` JSDoc FORMAT block (lines 252–255) + cost note (line 249, ~30→~20 tokens).
- `renderDriftNudge` JSDoc FORMAT block (lines 283–285) + (optional) the stale line-296 tail-structure note.

**Success Definition**: After the edit, `renderBloatReminder("read", 8192)` returns the new short string
(`\n---\n~8 KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole
call was a mistake.`); `renderDriftNudge({deltaTokens:4200, bloatHits:[]})` returns `Previous turn added ~4.2k
tokens to your context. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a
result.` The JSDoc FORMAT blocks quote these VERBATIM. `npx tsc --noEmit` introduces NO new errors. The two
auto-adapting consumer suites (`test/nudges.test.ts`, `test/drift_nudge.test.ts`) stay green. (`test/notes.test.ts`
renderer snapshots are EXPECTED-RED — owned by the sibling P1.M2.T1.S2.)

## User Persona (if applicable)

**Target User**: The model consuming the nudges (terse, lower-token reminders) and maintainers reading the
JSDoc as the inline spec.

**Use Case**: A bloated tool result fires Nudge A → the agent sees the short reminder appended to the result.
A sustained-drift turn fires Nudge B → the agent sees the short one-line annotation.

**Pain Points Addressed**: The reminder text had grown verbose (more tokens per nudge, more noise). The
re-shortening restores the terse, high-signal form the spec intends.

## Why

- **Token economy**: each nudge rides in context (Nudge A appended to a result; Nudge B injected per turn when
  it fires). Shorter text = fewer tokens spent on advisory chrome. PRD spec/07 §1/§2 prescribe the short forms.
- **Spec/code alignment**: spec/07 §1 (h3.50) and §2 (h3.55) already specify the short VERBATIM text; the code
  had drifted long. This PRP brings the code (and its JSDoc FORMAT blocks) back into exact agreement.
- **Drops the stale `mulligan_audit` clause from the drift nudge**: §2 removed bloat from the rendered drift
  nudge (the "rough edge" closed at the rendering layer); the trailing "; run `mulligan_audit` for a breakdown"
  clause is now redundant and is dropped.

## What

Pure string-literal rewrites + JSDoc updates in `src/notes.ts`. No signature changes, no helper changes, no
call-site changes, no behavior change beyond the rendered text. The 3-branch lead selection in `renderDriftNudge`
is untouched; the `toolName` parameter stays accepted-but-unused; never-throws discipline preserved.

### Success Criteria

- [ ] `renderBloatReminder` returns the new short string (leading `\n---\n` + `~${resultKb} KB added …`; no
      `(granularity:"last_tool_call_group")`, no "This result added", no "If you don't need the full output").
- [ ] `renderDriftNudge` returns `<lead>. If wasteful, \`mulligan_rewind\` to undo the turn or
      \`mulligan_shrink\` to compact a result.` (lead selection unchanged; no "; run `mulligan_audit`" clause).
- [ ] Both JSDoc FORMAT blocks quote the new text VERBATIM; the cost note reads "~20 tokens" (was "~30").
- [ ] `npx tsc --noEmit` introduces NO new errors beyond the 2 pre-existing M1.T1.S3 errors
      (`test/notes.test.ts:323`, `test/tools/rewind.test.ts:843` — the in-progress `avoid` removal).
- [ ] `npx vitest run test/nudges.test.ts test/drift_nudge.test.ts` stays green (70/70 — auto-adapting consumers).
- [ ] NO edits to any test file (test/notes.test.ts renderer snapshots are S2's job). NO edits outside src/notes.ts.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text of both renderer bodies and their JSDoc blocks, the
verbatim desired replacements (matching spec/07 §1/§2), the exact unchanged constraints, the precise test-
breakage map (which suites auto-adapt vs. which are owned by S2), and the accurate baseline (tsc exit 2 from
the in-progress parallel item — my edits add no new errors). The implementer needs no exploration beyond
opening `src/notes.ts`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: src/notes.ts
  why: renderBloatReminder (function line 269, body 271; JSDoc 246–267) + renderDriftNudge (function 306,
        body 306–321; JSDoc 275–304). The two return-string rewrites + 2 JSDoc FORMAT blocks + cost note.
  pattern: "both renderers are PURE string composers (no Pi imports in the body; type-only imports only).
            Keep them pure + never-throwing. Only the returned string literals + the JSDoc text change."
  gotcha: "M1.T1.S1 (now Complete) edited the NOTE machinery ABOVE these functions (NoteInput/validateNote/
           renderNote). The renderers are in the S3 region (line 221+) — DISJOINT. Do not touch note machinery."

# MUST READ — the spec VERBATIM targets (the new text must match these exactly)
- file: spec/07-preventive-and-nudges.md
  why: §1 (h3.50) gives the new renderBloatReminder text: '~<KB> KB added to your context. `mulligan_shrink`
        to summarize, or `mulligan_rewind` if the whole call was a mistake.' + '~20 tokens'. §2 (h3.55) gives
        the new renderDriftNudge text: '<lead>. If wasteful, `mulligan_rewind` to undo the turn or
        `mulligan_shrink` to compact a result.'
  section: "§1 renderBloatReminder (h3.50); §2 renderDriftNudge (h3.55)."
  gotcha: "the leading '\\n---\\n' (markdown horizontal rule) on renderBloatReminder is NOT shown in the spec's
           ```md block but IS part of the shipped string (it's the rule that visually separates the reminder
           from the result). PRESERVE it. NO trailing newline on either renderer."

# SHOULD READ — confirms the call site is already 2-arg (NO call-site change)
- file: src/nudges.ts
  why: bloatReminderHandler calls renderBloatReminder(event.toolName, bytes) (2-arg) and injectNudge calls
        renderDriftNudge(metric). Both auto-adapt to the new text. NO nudges.ts edit needed.
  gotcha: "do NOT edit nudges.ts — it already passes the right args; it just receives the new (shorter) string."

# SHOULD READ — the delta-006 system context (touchpoint map + the planned S1/S2 split)
- file: plan/006_5b685875f3df/architecture/system_context.md
  why: Touchpoint Map confirms M2 touches only renderBloatReminder/renderDriftNudge in notes.ts (disjoint from
        M1's note machinery); verification claims #5/#6 confirm nudges.test.ts + drift_nudge.test.ts auto-adapt
        (no pinned-text assertions); assigns the notes.test.ts renderer snapshots to cluster 2 (S2).
  critical: "The test/notes.test.ts renderer snapshots are OWNED BY S2. S1 must NOT touch any test file. The
             expected-red notes.test.ts after S1 is the PLANNED split, not a failure."

# CONTEXT — the parallel item (confirms no src/notes.ts conflict)
- file: plan/006_5b685875f3df/P1M1T1S3/PRP.md
  why: CONTRACT for the in-progress parallel item. It edits TEST files ONLY (notes.test.ts, rewind.test.ts,
        edge-cases.test.ts, markers.test.ts) for the `avoid` removal. It does NOT modify src/notes.ts. The 2
        pre-existing tsc errors (notes.test.ts:323, rewind.test.ts:843) are its in-flight residue.
  critical: "Do NOT fix those 2 tsc errors — they are M1.T1.S3's responsibility. S1 only ensures it adds NONE
             of its own."
```

### Current Codebase tree (the only relevant slice)

```bash
src/
├── notes.ts             # ← EDIT: renderBloatReminder (269–272) + renderDriftNudge (306–321) + their JSDoc
└── nudges.ts            # READ-ONLY reference — call site already 2-arg; auto-adapts (NO edit)
spec/07-preventive-and-nudges.md  # READ-ONLY reference — §1/§2 VERBATIM targets
test/
├── notes.test.ts        # OWNED BY S2 — renderer snapshots assert OLD text (expected-red after S1; do NOT touch)
├── nudges.test.ts       # auto-adapts (compares to renderBloatReminder return value) — stays green
└── drift_nudge.test.ts  # auto-adapts (loose startsWith/not.toContain) — stays green
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
src/notes.ts   # 2 renderer return-strings + 2 JSDoc FORMAT blocks + 1 cost note (+ optional 1 stale-note line)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (the planned S1/S2 split): changing the renderer strings makes test/notes.test.ts RED —
//   it pins the OLD text (DRIFT_TAIL const line 405-406; renderBloatReminder exact/contains/snapshot
//   assertions lines 410-470; renderDriftNudge "<lead>+DRIFT_TAIL" assertions lines 475-527). Those updates
//   are S2's job ("Nudge text test assertions (notes.test.ts)"). S1 must NOT edit any test file. Validate S1
//   with tsc (no NEW errors) + the two auto-adapting consumer suites — NOT with notes.test.ts.

// CRITICAL GOTCHA #2 (preserve the leading \n---\n): renderBloatReminder's string STARTS with "\n---\n"
//   (a markdown horizontal rule that visually separates the reminder from the result body). The spec's ```md
//   block does NOT show it, but it IS part of the shipped string. Keep it. NO trailing newline on either
//   renderer. NO [mulligan] prefix on either.

// CRITICAL GOTCHA #3 (verbatim, incl. backticks): the renderer strings contain literal backticks around the
//   tool names (`mulligan_shrink`, `mulligan_rewind`). In the TS template literal these are escaped (\`).
//   Reproduce the escaping EXACTLY — a missing escape breaks the template literal / the rendered markdown.

// CRITICAL GOTCHA #4 (baseline tsc is already exit 2): the parallel M1.T1.S3 (in progress) leaves 2 tsc errors
//   (notes.test.ts:323, rewind.test.ts:843 — the `avoid` removal). My edits are pure string literals → they add
//   NO new tsc errors. The S1 gate is "tsc error set UNCHANGED" (still exactly those 2), NOT "tsc exit 0".

// OUT OF SCOPE (do NOT touch in this subtask):
#   - test/notes.test.ts (renderer snapshots) → P1.M2.T1.S2.
#   - src/nudges.ts (call site) → already 2-arg; auto-adapts.
#   - The helpers bytesToKb/kTokens/resultWord/readDelta/readBloatHits → unchanged.
#   - The 3-branch lead selection in renderDriftNudge → unchanged.
#   - Function signatures + toolName (accepted-but-unused) → unchanged.
#   - The note machinery (NoteInput/validateNote/renderNote) → M1's region, disjoint.
#   - spec/07, README → read-only / owned by M3.
# This PRP edits ONLY src/notes.ts (2 return-strings + JSDoc).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no data-model change. `DriftNudgeInput` and the function signatures are unchanged; only the returned
string literals (and their JSDoc) change._

### Implementation Tasks (ordered by dependencies)

All edits are in `src/notes.ts`. Apply the renderer-body edits first (Tasks 1–2), then the JSDoc (Tasks 3–5).

```yaml
Task 1: EDIT src/notes.ts — renderBloatReminder body (line 271)
  - FIND (verbatim current):
      "  return `\\n---\\nThis result added ~${resultKb} KB to your context. If you don't need the full output, call \\`mulligan_shrink\\` with a summary or \\`mulligan_rewind(granularity:\"last_tool_call_group\")\\` if the whole call was a mistake.`;"
  - REPLACE WITH:
      "  return `\\n---\\n~${resultKb} KB added to your context. \\`mulligan_shrink\\` to summarize, or \\`mulligan_rewind\\` if the whole call was a mistake.`;"
  - RATIONALE: matches spec/07 §1 (h3.50) VERBATIM. Drops "This result added", "If you don't need the full
    output, call", "with a summary or", and the (granularity:"last_tool_call_group") detail. ~30→~20 tokens.
  - PRESERVE: leading "\n---\n" (markdown rule), the ${resultKb} interpolation, the escaped backticks around
    tool names, NO trailing newline.

Task 2: EDIT src/notes.ts — renderDriftNudge body tail (line 320)
  - FIND (verbatim current):
      "  return `${lead}. If that growth was wasteful, call \\`mulligan_rewind\\` (undo the turn) or \\`mulligan_shrink\\` (compact a result); run \\`mulligan_audit\\` for a breakdown.`;"
  - REPLACE WITH:
      "  return `${lead}. If wasteful, \\`mulligan_rewind\\` to undo the turn or \\`mulligan_shrink\\` to compact a result.`;"
  - RATIONALE: matches spec/07 §2 (h3.55) VERBATIM. Drops "that growth was" (→ "If wasteful"); parentheticals
    "(undo the turn)"/"(compact a result)" → "to undo the turn"/"to compact a result"; the ENTIRE
    "; run `mulligan_audit` for a breakdown" clause is removed.
  - PRESERVE: the `${lead}.` join, the 3-branch lead selection ABOVE this line (unchanged), escaped backticks,
    NO embedded newline, NO trailing newline.

Task 3: EDIT src/notes.ts — renderBloatReminder JSDoc cost note (line 249)
  - FIND: " * text:reminder}]`. ~30 tokens, incurred once per bloated result; advisory (D3) — appended, not replacing."
  - REPLACE WITH: " * text:reminder}]`. ~20 tokens, incurred once per bloated result; advisory (D3) — appended, not replacing."
  - RATIONALE: PRD h3.50 says "~20 tokens incurred once". The shortened text is ~20 tokens (was ~30).

Task 4: EDIT src/notes.ts — renderBloatReminder JSDoc FORMAT block (lines 252–255)
  - FIND (verbatim current):
      " * FORMAT (spec/07 §1 — VERBATIM; leading \"\\n---\\n\" is a markdown horizontal rule; single line):\n *     \\n---\\nThis result added ~<KB> KB to your context. If you don't need the full output, call\n *     `mulligan_shrink` with a summary or `mulligan_rewind(granularity:\"last_tool_call_group\")` if\n *     the whole call was a mistake."
  - REPLACE WITH:
      " * FORMAT (spec/07 §1 — VERBATIM; leading \"\\n---\\n\" is a markdown horizontal rule; single line):\n *     \\n---\\n~<KB> KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind`\n *     if the whole call was a mistake."
  - RATIONALE: the FORMAT block must quote the new shipped text VERBATIM (it is both dev doc and spec cross-ref).
  - DO NOT: change the "leading \"\\n---\\n\" is a markdown horizontal rule; single line" preamble or the
    "<KB> = bytesToKb(bytes)..." line below it.

Task 5: EDIT src/notes.ts — renderDriftNudge JSDoc FORMAT block (lines 283–285)
  - FIND (verbatim current):
      " * FORMAT (spec/07 §2 — VERBATIM; a SINGLE physical string with NO embedded \"\\n\"; the LEAD varies by input,\n * the tail after \"<lead>.\" is FIXED in all cases):\n *     <lead>. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown."
  - REPLACE WITH:
      " * FORMAT (spec/07 §2 — VERBATIM; a SINGLE physical string with NO embedded \"\\n\"; the LEAD varies by input,\n * the tail after \"<lead>.\" is FIXED in all cases):\n *     <lead>. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."
  - RATIONALE: the FORMAT block must quote the new tail VERBATIM.
  - DO NOT: change the "<lead> is a 3-branch selection..." block below it (the lead selection is unchanged).

Task 6 (OPTIONAL consistency): EDIT src/notes.ts — renderDriftNudge JSDoc stale note (line 296)
  - FIND (verbatim current):
      " * NO embedded newline. The \"consider\"→\"call\" + \"; run\"-joined tail condenses the old 3-line form to one line."
  - REPLACE WITH:
      " * NO embedded newline. The tail is a terse \"If wasteful, … to undo / compact a result.\" suggestion; no `mulligan_audit` clause (§2 dropped it)."
  - RATIONALE: the old note described the PREVIOUS tail structure (which had a \"; run audit\" clause and the
    word \"call\"). After Task 5 that description is stale and contradicts the new FORMAT block. This keeps the
    JSDoc internally consistent. (Not strictly required by the contract, but recommended — skip only if the
    exact replacement wording is uncertain; the key is to not leave a \"; run\"-joined description of a tail
    that no longer has that clause.)
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: both renderers are PURE string composers (no Pi imports in the body). The ONLY thing that changes
// is the returned string literal. Keep them pure + never-throwing.

// renderBloatReminder — BEFORE vs AFTER (the ${resultKb} interpolation + leading \n---\n are PRESERVED):
//   BEFORE: `\n---\nThis result added ~${resultKb} KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:"last_tool_call_group")\` if the whole call was a mistake.`
//   AFTER:  `\n---\n~${resultKb} KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake.`

// renderDriftNudge tail — BEFORE vs AFTER (the ${lead}. join is PRESERVED; lead selection UNCHANGED):
//   BEFORE: `${lead}. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown.`
//   AFTER:  `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.`

// CRITICAL: the backticks around tool names are ESCAPED (\`) inside the template literal. A missing escape
// either breaks compilation or mangles the rendered markdown. Reproduce the escaping EXACTLY as in the FIND strings.
```

### Integration Points

```yaml
CODE:
  - modify: src/notes.ts — renderBloatReminder body + renderDriftNudge body + 2 JSDoc FORMAT blocks + cost note
  - consumed-by (NO change): src/nudges.ts bloatReminderHandler (renderBloatReminder) + injectNudge (renderDriftNudge)
TESTS:
  - DO NOT modify any test file in S1.
  - test/notes.test.ts renderer snapshots (DRIFT_TAIL const + renderBloatReminder/renderDriftNudge assertions)
    are EXPECTED-RED after S1 → owned by P1.M2.T1.S2.
  - test/nudges.test.ts:299 + test/drift_nudge.test.ts:155-156 auto-adapt → stay green (S1 consistency gates).

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. Pure text rewrite; no config, no DB, no routes, no registration.
```

---

## Validation Loop

> **Read this before running any gate.** This is a PLANNED two-subtask split: S1 changes the renderer TEXT
> (src/notes.ts); S2 updates the test SNAPSHOTS (test/notes.test.ts). Therefore `npx vitest run
> test/notes.test.ts` is EXPECTED-RED after S1 (it pins the old text) and is NOT an S1 pass gate. The S1
> gates are: (1) tsc introduces no NEW errors; (2) the two auto-adapting consumer suites stay green.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check. BASELINE is currently exit 2 (2 pre-existing errors from the in-progress parallel M1.T1.S3:
# notes.test.ts:323 + rewind.test.ts:843, the `avoid` removal). My edits are pure string literals → they add
# NO new errors. After S1 the error set must be UNCHANGED (still exactly those 2).
npx tsc --noEmit 2>&1 | grep -E 'error TS' | sort
# EXPECT: exactly the 2 pre-existing errors (notes.test.ts:323, rewind.test.ts:843). NO error mentioning
# src/notes.ts, renderBloatReminder, or renderDriftNudge. If a NEW src/notes.ts error appears, you broke a
# template-literal escape — re-check the backtick escaping in Tasks 1/2.

# Confirm the renderer edits landed (print the two return lines + the FORMAT blocks):
grep -n '~\${resultKb} KB added to your context\|If wasteful, \`mulligan_rewind\` to undo\|~20 tokens' src/notes.ts
```
Expected: grep prints the new short strings + the ~20-tokens cost note; tsc error set unchanged (the same 2).

### Level 2: Unit Tests (the auto-adapting consumers — these ARE S1 gates)

```bash
# nudges.test.ts:299 compares appended.text === renderBloatReminder("read", OVER_BYTES) (the RETURN VALUE,
# not pinned text) → passes with the new text. drift_nudge.test.ts:155-156 uses loose startsWith/
# not.toContain → passes. Both must stay GREEN (proves the consumers see a consistent string).
npx vitest run test/nudges.test.ts test/drift_nudge.test.ts
# EXPECT: 70 passed (70) — 2 files. If these FAIL, the renderer change introduced an inconsistency
# (e.g. an unbalanced backtick that broke the string) — re-check Task 1/2 escaping.

# NOTE (NOT a gate): test/notes.test.ts WILL be red (it pins the old text). Do NOT run it as an S1 gate and
# do NOT fix it here — S2 owns it. (If curious: `npx vitest run test/notes.test.ts` shows the expected
# snapshot/assertion failures on DRIFT_TAIL + the renderBloatReminder exact/contains lines.)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. The "system" validation for a pure renderer rewrite is a direct output check:
npx tsx -e "
import { renderBloatReminder, renderDriftNudge } from './src/notes.js';
console.log(JSON.stringify(renderBloatReminder('read', 8192)));
console.log(JSON.stringify(renderDriftNudge({ deltaTokens: 4200, bloatHits: [] })));
"
# EXPECT:
#   "\n---\n~8 KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake."
#   "Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."
# (Proves the exact new strings ship — the same strings S2 will snapshot.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for a text-rewrite. No UI/perf/security surface. Levels 1–3 fully cover correctness.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — NO new errors (the 2 pre-existing M1.T1.S3 errors at notes.test.ts:323 /
      rewind.test.ts:843 remain; nothing in src/notes.ts).
- [ ] `npx vitest run test/nudges.test.ts test/drift_nudge.test.ts` — 70/70 green (auto-adapting consumers).
- [ ] Level 3 spot-check prints the exact new strings for both renderers.

### Feature Validation
- [ ] `renderBloatReminder` returns the new short string (leading `\n---\n` + `~${resultKb} KB added …`;
      no "This result added", no `(granularity:…)` detail).
- [ ] `renderDriftNudge` returns `<lead>. If wasteful, \`mulligan_rewind\` to undo the turn or
      \`mulligan_shrink\` to compact a result.` (no "; run `mulligan_audit`" clause; lead selection unchanged).
- [ ] Both JSDoc FORMAT blocks quote the new text VERBATIM; cost note reads "~20 tokens".
- [ ] No edits to any file other than `src/notes.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT touch any test file (test/notes.test.ts renderer snapshots are P1.M2.T1.S2's job).
- [ ] Did NOT touch src/nudges.ts (call site already 2-arg; auto-adapts).
- [ ] Did NOT change function signatures, the helpers, or the 3-branch lead selection.
- [ ] Did NOT touch the note machinery (NoteInput/validateNote/renderNote — M1's region, disjoint).
- [ ] Did NOT touch spec/07 / README (read-only / owned by M3).
- [ ] Preserved: leading `\n---\n`, escaped backticks, no trailing newline, never-throws discipline.

### Documentation
- [ ] JSDoc FORMAT blocks + cost note updated (Mode A inline docs) — this IS the doc for this subtask.

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" test/notes.test.ts in S1 — the renderer snapshots are S2's explicit deliverable. S1 = code only.
  Running `npx vitest run test/notes.test.ts` as an S1 pass gate is wrong (it's expected-red by design).
- ❌ Don't drop or mis-escape the backticks around `mulligan_shrink`/`mulligan_rewind` — they're escaped (`\`)
  inside the template literal; a missing escape breaks the literal or the rendered markdown.
- ❌ Don't drop the leading `\n---\n` on renderBloatReminder — it's the markdown horizontal rule that separates
  the reminder from the result (not shown in the spec's ```md block but part of the shipped string).
- ❌ Don't change the 3-branch lead selection in renderDriftNudge, the helpers, or the signatures — only the
  returned string literals (and JSDoc) change.
- ❌ Don't expect `npx tsc --noEmit` to be exit 0 — the baseline is already exit 2 from the in-progress
  parallel M1.T1.S3 (`avoid` removal). The S1 gate is "no NEW errors", not "exit 0". Do NOT fix those 2 errors
  (they're M1.T1.S3's responsibility).
- ❌ Don't touch src/nudges.ts, the note machinery, spec/07, or README — out of scope / read-only / owned by M3.

---

## Confidence Score

**9/10** for one-pass implementation success. Both rewrites are verbatim string-literal swaps with the exact
current text, the exact desired text (cross-checked against PRD spec/07 §1/§2 h3.50/h3.55), and the JSDoc
updates specified line-by-line. The two non-obvious risks are both fully addressed: (1) the planned S1/S2
split — `test/notes.test.ts` is expected-red and explicitly NOT an S1 gate (the auto-adapting consumer suites
+ tsc are); (2) the baseline tsc is already exit 2 from the in-progress parallel item, so the gate is "no NEW
errors" (precisely: still only notes.test.ts:323 + rewind.test.ts:843), not "exit 0". Residual risks: a
backtick-escape typo in a template literal (mitigated by the Level-1 tsc grep for src/notes.ts errors + the
Level-2 consumer suites which would fail on a broken string); an implementer who tries to "help" by fixing
notes.test.ts (mitigated by the prominent DON'T in the Validation Loop header + Anti-Patterns). No dependency
on the parallel item (separate files: src/notes.ts vs. test/*).