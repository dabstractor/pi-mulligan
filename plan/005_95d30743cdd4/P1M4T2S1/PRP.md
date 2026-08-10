# PRP — P1.M4.T2.S1: renderDriftNudge rewrite

## Goal

**Feature Goal**: Simplify Nudge B's rendered text. `renderDriftNudge` (src/notes.ts:322) drops the
`[mulligan]` prefix, collapses its 4-branch if/else over `(delta != null) × (bloat)` down to a 3-branch
(`delta != null` wins regardless of bloat → delta line with NO bloat mention; `delta == null && bloat > 0`
→ bloat-only line; both empty → totality fallback), and condenses the two fixed tail lines into ONE
line joined with `; run`. The word **"consider" → "call"**. The result is a single physical string (NO
embedded `\n`), spec/07 §2 verbatim. Net effect: the `[mulligan]` prefix + stale-bloat noise are gone,
and a since-shrunk result can no longer be re-announced one turn later as `~0k tokens / N bloated results`.

**Deliverable**: Edits to **four** files — `src/notes.ts` (function body + JSDoc FORMAT block + the
"bloat counts are cosmetic" note), `test/notes.test.ts` (the `DRIFT_TAIL` constant + the renderDriftNudge
test blocks 486–640), and **two cross-file test files the item contract did not name**:
`test/edge-cases.test.ts` (E18: `consider`→`call`) and `test/drift_nudge.test.ts:151–156`
(`startsWith("[mulligan]")`→ new prefix-less assertion). DOCS = [Mode A]: the JSDoc FORMAT block update
IS the doc — no separate doc file.

**Success Definition**: After the edits, (1) `renderDriftNudge` returns a single string with NO `[mulligan]`
prefix and NO embedded `\n`; (2) the delta-available path is a single condensed line with NO bloat clause;
(3) the null-delta + bloat fallback STILL leads with `Previous turn produced <N> bloated result(s)` (keeps
`resultWord`); (4) `kTokens`/`readDelta`/`readBloatHits` + the never-throws discipline are UNCHANGED;
(5) `npm run typecheck` exits 0; (6) `npx vitest run` is green (assertion rewrites only — test COUNT
unchanged).

> ⚠️ **[Mode A] doc update.** The only "documentation" change is the JSDoc `FORMAT` block + the
> "bloat counts are cosmetic / never rendered" note on `renderDriftNudge` itself. There is NO separate
> `.md` doc file. The README sync is sibling P1.M5.T1.* — do NOT touch README.

> ⚠️ **Sibling PRP running in parallel.** P1.M4.T1.S1 (renderBloatReminder rewrite) edits `src/notes.ts`
> AND `test/notes.test.ts` (the bloat-reminder blocks ~410–477 + a type test ~641–642). This PRP (T2) edits
> the renderDriftNudge blocks (~405 `DRIFT_TAIL`, ~486–640, type test ~645–646) in the SAME two files. The
> two edits are NON-OVERLAPPING by content (bloat-reminder vs drift-nudge), but **line numbers will shift**
> after T1 lands. LOCATE every edit by its CONTENT / `describe` label, NOT by absolute line number. The
> `grep -n` commands in the Validation Loop are content-keyed for exactly this reason.

## User Persona (if applicable)

**Target User**: The agent operating under the Mulligan extension (the consumer of the drift nudge text).

**Use Case**: At each `context` fire, if sustained context growth crossed the threshold, the filter injects
this one-line annotation into the message COPY. The agent reads it and decides whether to
`mulligan_rewind` / `mulligan_shrink` / `mulligan_audit`.

**User Journey**: A turn grows context ~4.2k tokens over baseline → next inference's context copy gets
the nudge appended as an ephemeral `mulligan:nudge` CustomMessage → the agent audits/shrinks/rewinds or
ignores it (~25–40-token cost, only when it fires).

**Pain Points Addressed**: The `[mulligan]` prefix was noise (no decision signal). The bloat clause on the
delta path could surface STALE counts — a since-shrunk result still announced as "N bloated result(s)" one
turn later (self-contradictory at ~0 net growth). Dropping the bloat clause from the delta path closes that
rough edge at the rendering layer (spec/07 §2 edge cases).

## Why

- **The `[mulligan]` prefix is noise** (M4 architecture note). The nudge is already a distinct
  `mulligan:nudge` CustomMessage; a textual prefix adds tokens without adding signal.
- **The bloat clause on the delta path is wrong + stale-prone** (spec/07 §2 edge cases, selected_prd_content
  h3.58). `pendingBloatHits` are collected at `tool_result` time and NOT subtracted when a later
  `mulligan_rewind`/`mulligan_shrink` hides those results. Previously a near-zero-delta turn with a big
  result could render as `~0k tokens / N bloated results` (self-contradictory). With `bloatHit` removed
  from the FIRING condition (delta-only — sibling logic in §5.1/§5.3) the nudge no longer fires on a ~0-
  net-growth turn; the RENDERING-layer change here removes the bloat clause too so stale counts can never
  appear. `bloatHit` is retained ONLY as the no-baseline fallback lead (first turn / post-reload) where it
  is the sole available signal.
- **"consider" → "call" + condensed tail** matches the spec/07 §2 verbatim single-line form. Two short
  tail lines (`.\nRun mulligan_audit...`) cost an extra newline + re-introduce line-break fragility; one
  line joined with `; run` is tighter and spec-faithful.
- **Scope discipline within M4**: this is the *drift-nudge render* half (T2). The sibling `renderBloatReminder`
  rewrite is T1 (parallel); the `suppressCheck` §5.3 JSDoc align is T3. Do NOT touch those — T2 is
  drift-nudge text only.

## What

A surgical rewrite of one pure helper + its JSDoc + every test that pins its output text.

1. **`src/notes.ts:322`** — `renderDriftNudge` (JSDoc starts ~line 295): replace the 4-branch if/else +
   the 3-element `[...].join("\n")` return with a 3-branch lead selection + a single-string return (no
   `[mulligan]` prefix, "call" not "consider", tail condensed via `; run`, no embedded `\n`). Rewrite the
   JSDoc `FORMAT` block + add the "bloat counts are cosmetic / never rendered" note.
2. **`test/notes.test.ts`** — `DRIFT_TAIL` constant (line ~405) + the four renderDriftNudge `describe`
   blocks (pinned-format ~486, rounding/pluralization ~548, defensive ~571, snapshot-style ~614): update
   `DRIFT_TAIL` from a 2-element array to a single tail string; rewrite every assertion that references
   `[mulligan]`, "consider", the two-line tail, or the delta+bloat branch.
3. **`test/edge-cases.test.ts:986–1000`** (E18) — `expect(text).toContain("consider")` ×2 → `toContain("call")`;
   update the `it` name + the advisory-tone comment.
4. **`test/drift_nudge.test.ts:151–156`** — `content.startsWith("[mulligan]")` → `startsWith("Previous turn")`
   + a `not.toContain("[mulligan]")` regression guard.

### Success Criteria

- [ ] `renderDriftNudge(metric)` returns a SINGLE string (NO embedded `\n`), NO `[mulligan]` prefix, for
      all three branches.
- [ ] The delta-available path (`delta != null`) NEVER mentions bloat, even when `bloatHits` is non-empty
      (the `delta != null && hits.length > 0` branch is DELETED / merged into the plain delta branch).
- [ ] The null-delta + bloat path STILL leads with `Previous turn produced <N> bloated <resultWord>` —
      `resultWord` + `kTokens` + `readDelta` + `readBloatHits` are REUSED unchanged.
- [ ] The tail reads `... (compact a result); run \`mulligan_audit\` for a breakdown.` — "call" (not
      "consider"), ONE line (no `.\nRun`).
- [ ] `npm run typecheck` exits 0; `npx vitest run` is green with test COUNT unchanged.
- [ ] Exactly four files modified: `src/notes.ts`, `test/notes.test.ts`, `test/edge-cases.test.ts`,
      `test/drift_nudge.test.ts` (`git diff --name-only` shows EXACTLY these four).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the EXACT current function body + JSDoc (so the `edit` oldText is unambiguous),
the EXACT target text (spec/07 §2 / architecture note, byte-for-byte), the COMPLETE list of every
call/test site (grep-verified — four files, no others), the current `DRIFT_TAIL` definition and the exact
new shape, the current content of BOTH cross-file test references (E18 + drift_nudge injectNudge test), and
the two validation gates (`npm run typecheck` = `tsc --noEmit` strict; `npx vitest run`). The implementer
makes targeted `edit` calls and runs two commands.

### Documentation & References

```yaml
# MUST EDIT — the function under rewrite
- file: src/notes.ts
  why: Owns renderDriftNudge. JSDoc begins ~line 295 ("renderDriftNudge — Nudge B's text …"); the exported
        function is at line 322. Its body (4-branch if/else + 3-line join) + JSDoc FORMAT block change here.
        kTokens (notes.ts, module-private), readDelta, readBloatHits, resultWord are REUSED unchanged.
  section: "Find the S3 block (comment header 'S3 (P1.M2.T3.S3) — renderBloatReminder + renderDriftNudge'
            at line 226). renderDriftNudge is the SECOND export in that block (renderBloatReminder is first
            — that is T1's scope, leave it). renderDriftNudge's JSDoc is ~line 295; the function is ~line 322."
  pattern: "House style for pure renderers: a 'FORMAT (spec/07 §N — VERBATIM)' JSDoc block, a 'DEFENSIVE —
            NEVER throws' note, and @param lines. Mirror it; only swap the quoted FORMAT text + the
            'consider'→'call' / prefix-removal / tail-condensation details."
  gotcha: "GOTCHA #1: the function is a SINGLE return string now (no .join('\n')). The lead is selected by a
           3-branch if/else (delta wins); the tail is a TEMPLATE-LITERAL suffix appended after `${lead}.`.
           Do NOT keep the old `let firstLine` + array-join shape — the new output has NO embedded newline."

# MUST EDIT — the renderer's own unit tests (DRIFT_TAIL constant + 4 describe blocks)
- file: test/notes.test.ts
  why: Pins renderDriftNudge's output text. Five regions change:
        (1) DRIFT_TAIL constant (~line 405) — 2-element ARRAY → single tail STRING;
        (2) describe('renderDriftNudge — spec/07 §2 pinned format …') ~486–545;
        (3) describe('renderDriftNudge — rounding & pluralization') ~548–568 (logic mostly KEEPS);
        (4) describe('renderDriftNudge — defensive (NEVER throws — GOTCHA #7)') ~571–611;
        (5) describe('renderDriftNudge — snapshot-style') ~614–640 (2 inline snapshots).
  section: "All assert the OLD 3-line [mulligan]-prefixed text via [X, ...DRIFT_TAIL].join('\n') or inline
            snapshots. Move to single-string assertions (no \\n). The type test ~645–646 is UNCHANGED
            (no arity change — renderDriftNudge still takes one DriftNudgeInput arg)."
  pattern: "House test style: vitest, imports from '../src/notes.js', 'it' blocks, expect().toBe/.toContain/
            .toMatchInlineSnapshot. Keep the describe labels (update only the 'first line varies; tails
            FIXED' label if you restructure — the tail is now ONE string, not two fixed lines)."
  gotcha: "GOTCHA #2: DRIFT_TAIL's TYPE changes (string[] → string). Every `[X, ...DRIFT_TAIL].join('\\n')`
           call site MUST become `X + DRIFT_TAIL` (string concat). A missed one is a typecheck error
           (...DRIFT_TAIL on a string spreads CHARACTERS) OR a wrong assertion. grep -n 'DRIFT_TAIL'
           lists all 6 sites in this file."

# MUST EDIT — E18 advisory-tone test (CROSS-FILE — the contract did NOT name this file)
- file: test/edge-cases.test.ts
  why: Lines 988 + 997 assert `text.toContain("consider")` on renderDriftNudge output. The new text says
        "call", so BOTH FAIL. Line 986 `it`-name still says 'SUGGESTS consider'; line 995 comment says
        'advisory (lowercase "consider")'. ALL four update to "call".
  section: "describe('E18 — Model ignores the nudges (advisory text …)') ~line 985. Two it blocks (986, 992).
            The FIRST (986) calls renderDriftNudge({deltaTokens:4000,bloatHits:[]}); the SECOND (992) calls
            it with delta=5000 + a bloat hit. Both still exercise the delta path (bloat dropped) — the
            tool-name assertion (mulligan_rewind|mulligan_shrink) STAYS valid; only the 'consider' word changes."
  pattern: "The test's INTENT is 'the nudge is advisory, not forced' (E18 / D3). 'call' inside a conditional
            'If that growth was wasteful, call …' is still advisory. Keep the mulligan_rewind|shrink regex
            assertion; just swap the word."
  critical: "This file is the #1 reason a 'single-file' (notes.ts only) mental model fails here. Without
             editing it, `npx vitest run test/edge-cases.test.ts` is RED on the 'consider' assertions."

# MUST EDIT — the injectNudge content-shape test (CROSS-FILE — the contract did NOT name this file)
- file: test/drift_nudge.test.ts
  why: Line 155 asserts `(last.content as string).startsWith("[mulligan]")` on the nudge injected by
        injectNudge (which calls renderDriftNudge internally). The prefix is REMOVED → FAILS.
  section: "describe for injectNudge, the it at ~line 151 'produces a non-empty string content via
            renderDriftNudge'. Input metric: deltaTokens:4200 + a bloatHit. With the new logic delta != null
            WINS → delta path (bloat dropped) → output starts with 'Previous turn added ~4.2k tokens'."
  pattern: "Assert the NEW prefix-less lead: startsWith('Previous turn'). Keep typeof==='string'. Add a
            negative regression guard: expect(content).not.toContain('[mulligan]')."
  critical: "This is the #2 cross-file breakage. Without editing it, `npx vitest run test/drift_nudge.test.ts`
             is RED. NOTE: this file ALSO contains renderHighWaterNudge tests (describe at ~line 322) — those
             are a DIFFERENT nudge (§5.2 high-water, which KEEPS its [mulligan] prefix) and are OUT OF SCOPE."

# MUST READ — the spec authority (exact current vs target text)
- file: plan/005_95d30743cdd4/architecture/m4_nudge_text_simplification.md
  why: Pins the EXACT current text + the EXACT target text for this exact subtask (M4.T2). The 'Target design
        → M4.T2' section is the single source of truth for the new branches + new tail.
  critical: "The delta-available target is verbatim there: 'Previous turn added ~<delta>k tokens to your
             context. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink`
             (compact a result); run `mulligan_audit` for a breakdown.' Note: SINGLE line, 'call' (not
             'consider'), '; run' (not '.\\nRun'). The null-delta fallback swaps only the LEAD
             ('Previous turn produced <N> bloated result(s)')."

# MUST READ — spec/07 §2 (the rendered-text authority in the merged PRD)
- docContext: selected_prd_content heading h2.77 + h3.58 (edge cases)
  why: h2.77 gives the canonical single-line delta text + the injectNudge mechanics. h3.58 ('Edge cases')
        gives the 'Bloat counts are cosmetic now, not a firing trigger' rationale that the JSDoc note must
        paraphrase: bloat is retained ONLY as the no-delta fallback firing decision + lead; never rendered
        on the delta path.
  critical: "READ-ONLY. h3.58 explicitly states: 'The rendered drift nudge no longer carries a bloat clause
             at all (see renderDriftNudge), so stale counts cannot appear in it — the rough edge is closed
             at the rendering layer too. (pendingBloatHits are still collected only to drive the no-delta
             fallback firing decision in §5.1; they are never rendered.)' This sentence IS the JSDoc note."

# CONTEXT — the tsconfig/lint facts (same as T1; no arity change so no unused-param concern here)
- file: tsconfig.json
  why: Confirms strict:true. There is NO eslint config in the repo. No new gotchas for T2 (the signature is
        unchanged — still `(metric: DriftNudgeInput): string`).
```

### Current Codebase tree (the relevant slice)

```bash
src/
└── notes.ts             # ← EDIT: renderDriftNudge (JSDoc ~295 + fn ~322) — body + FORMAT block + cosmetic note
test/
├── notes.test.ts        # ← EDIT: DRIFT_TAIL (~405) + renderDriftNudge blocks (~486–640)
├── edge-cases.test.ts   # ← EDIT: E18 (~986–1000) — consider→call (CROSS-FILE)
└── drift_nudge.test.ts  # ← EDIT: ~151–156 — startsWith("[mulligan]") → startsWith("Previous turn") (CROSS-FILE)
# READ-ONLY context:
plan/005_95d30743cdd4/architecture/m4_nudge_text_simplification.md   # target text authority (M4.T2 section)
tsconfig.json            # strict:true, NO eslint
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly four existing files (no creation, no deletion):
src/notes.ts             # renderDriftNudge: 3-branch lead + single-string return + rewritten JSDoc
test/notes.test.ts       # DRIFT_TAIL→string + renderDriftNudge assertions: new single-line text
test/edge-cases.test.ts  # E18: consider→call (×2 assertions + it-name + comment)
test/drift_nudge.test.ts # injectNudge content test: startsWith("Previous turn") + not.toContain("[mulligan]")
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (the output is now ONE string — no .join("\n")):
//   The OLD return was `[ "[mulligan] ${firstLine}.", tailLine2, tailLine3 ].join("\n")` — a 3-line string.
//   The NEW return is a single template literal with NO embedded "\n": `${lead}. <tail>`. The 4-branch
//   if/else (delta && bloat / delta / bloat / fallback) collapses to 3 (delta wins regardless of bloat).
//   Do NOT keep the array-join shape — there is no newline to join on anymore.

// CRITICAL GOTCHA #2 (DRIFT_TAIL's TYPE changes string[] → string — every call site must change):
//   `const DRIFT_TAIL = [ "…consider…", "Run `mulligan_audit`…" ]` (2-elem array) → a single tail STRING.
//   Every test call `[X, ...DRIFT_TAIL].join("\n")` MUST become `X + DRIFT_TAIL` (string concat). There are
//   ~6 DRIFT_TAIL references in test/notes.test.ts (grep -n 'DRIFT_TAIL'). A missed one either fails typecheck
//   (spreading a string yields chars) or asserts the wrong text. The cleanest new DRIFT_TAIL starts with ". "
//   so `lead + DRIFT_TAIL` yields "Previous turn added ~4.2k tokens to your context. If that growth was…" —
//   see Implementation Patterns.

// CRITICAL GOTCHA #3 (TWO cross-file test files break — not just notes.test.ts):
//   (a) test/edge-cases.test.ts:988,997 assert toContain("consider") → the new word is "call". RED until fixed.
//   (b) test/drift_nudge.test.ts:155 asserts startsWith("[mulligan]") → the prefix is gone. RED until fixed.
//   The item contract names only notes.ts + its JSDoc ([Mode A]). grep-confirmed: these four files are the
//   COMPLETE reference set — renderDriftNudge output text appears in NO other test. (renderHighWaterNudge,
//   a DIFFERENT nudge at src/nudges.ts:480, KEEPS its [mulligan] prefix + "Consider" — do NOT touch it.)

// CRITICAL GOTCHA #4 (delta+bloat input now renders as delta-ONLY — do not assert bloat on the delta path):
//   Two existing pinned-format tests feed delta + bloat (5000+1hit at ~495, 8000+3hits at ~504) and assert the
//   OLD "added ~Nk tokens … and produced M bloated result(s)" text. Under the new logic delta != null WINS →
//   bloat is dropped → the output is just "added ~Nk tokens to your context." + tail. UPDATE these assertions
//   AND ADD `expect(out).not.toContain("bloated")` to pin the new behavior (delta path never mentions bloat).

// GOTCHA #5 (the null-delta bloat fallback KEEPS resultWord + bloat — do not delete it):
//   The contract point (d) requires resultWord still used for the no-delta fallback. The test at ~518 (null
//   delta + 2 hits) and the rounding/pluralization block (~555–567, "produced N bloated result(s)") STAY
//   valid — only the tail changes (consider→call, two-lines→one). Do NOT remove the bloat fallback branch;
//   it is the SOLE signal on first-turn / post-reload (spec/07 §2 edge cases, h3.58).

// GOTCHA #6 (line numbers SHIFT because sibling T1 edits the same two files in parallel):
//   T1 (renderBloatReminder) edits src/notes.ts + test/notes.test.ts too. The two edits do not overlap by
//   content, but T1's edits land first (T1 is "Ready", T2 is "Researching"). LOCATE every edit by CONTENT
//   (describe label, function name, exact assertion string), not by line number. The Validation Loop greps
//   are content-keyed. After T1, the renderDriftNudge blocks will be at slightly different line numbers —
//   that is EXPECTED; the content is unchanged.

// GOTCHA #7 (the "both empty" totality fallback KEEPS a deterministic string — tests assert it):
//   The null/array/throwing-Proxy defensive cases (~572, ~607) render the totality fallback
//   "Previous turn changed your context." + tail. The old assertions were .toContain("[mulligan] Previous
//   turn changed your context.") — DROP the "[mulligan] " prefix from BOTH (the substring
//   "Previous turn changed your context." still matches). Do NOT change the fallback lead text itself.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no new data models. `DriftNudgeInput` (notes.ts:236) is UNCHANGED. The only "structure" is the
rewritten return string. `kTokens`, `resultWord`, `readDelta`, `readBloatHits` (all module-private in
notes.ts) are REUSED as-is._

### The exact before → after (the task's core logic)

**`src/notes.ts` — the function (line 322):**

```ts
// BEFORE (current, 4-branch + 3-line join, [mulligan] prefix, "consider"):
export function renderDriftNudge(metric: DriftNudgeInput): string {
  const delta = readDelta(metric);
  const hits = readBloatHits(metric);
  let firstLine: string;
  if (delta != null && hits.length > 0) {
    firstLine = `Previous turn added ~${kTokens(delta)} tokens to your context and produced ${hits.length} bloated ${resultWord(hits.length)}`;
  } else if (delta != null) {
    firstLine = `Previous turn added ~${kTokens(delta)} tokens to your context`;
  } else if (hits.length > 0) {
    firstLine = `Previous turn produced ${hits.length} bloated ${resultWord(hits.length)}`;
  } else {
    firstLine = "Previous turn changed your context"; // unreachable via shouldNudge; totality fallback
  }
  return [
    `[mulligan] ${firstLine}.`,
    "If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).",
    "Run `mulligan_audit` for a breakdown.",
  ].join("\n");
}

// AFTER (target, 3-branch + single-string return, no prefix, "call", condensed tail — spec/07 §2 verbatim):
export function renderDriftNudge(metric: DriftNudgeInput): string {
  const delta = readDelta(metric);
  const hits = readBloatHits(metric);
  let lead: string;
  if (delta != null) {
    lead = `Previous turn added ~${kTokens(delta)} tokens to your context`;
  } else if (hits.length > 0) {
    lead = `Previous turn produced ${hits.length} bloated ${resultWord(hits.length)}`;
  } else {
    lead = "Previous turn changed your context"; // unreachable via shouldNudge; totality fallback
  }
  return `${lead}. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown.`;
}
```

> Rendered examples for verification (delta path, single physical line, NO `\n`):
> - `delta=4200, bloat=[]` → `"Previous turn added ~4.2k tokens to your context. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown."`
> - `delta=5000, bloat=[1 hit]` → SAME as above with `~5k` (bloat is DROPPED on the delta path).
> - `delta=null, bloat=[2 hits]` → `"Previous turn produced 2 bloated results. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown."`
> - `delta=null, bloat=[]` (totality) → `"Previous turn changed your context. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown."`

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE renderDriftNudge in src/notes.ts (function body)
  - EDIT the export at ~line 322: replace the 4-branch if/else (delta && bloat / delta / bloat / fallback)
    with a 3-branch lead selection where `delta != null` WINS regardless of bloat (GOTCHA #1, #4).
  - REPLACE the `[ "[mulligan] ${firstLine}.", tail2, tail3 ].join("\n")` return with a SINGLE template
    literal: `` `${lead}. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or
    \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown.` ``
    (NO embedded "\n"; "call" not "consider"; "; run" joins the audit clause).
  - RENAME the local `firstLine` → `lead` (cosmetic; reflects that it is no longer a full line + now lacks
    the trailing period which the return adds). Optional but recommended for clarity.
  - PRESERVE: `const delta = readDelta(metric);` + `const hits = readBloatHits(metric);` UNCHANGED.
  - PRESERVE (GOTCHA #5): the `hits.length > 0` bloat-fallback branch + `resultWord(hits.length)` — still
    used on the null-delta path.
  - PLACEMENT: same location (do not move the export; renderBloatReminder above it is T1's scope).

Task 2: REWRITE the renderDriftNudge JSDoc in src/notes.ts (the block starting ~line 295)
  - UPDATE the FORMAT block to the new shape (no prefix, 3-branch lead, single-line tail). NEW FORMAT block:
        FORMAT (spec/07 §2 — VERBATIM; a SINGLE physical string with NO embedded "\n"; the LEAD varies by
        input, the tail after "<lead>." is FIXED in all cases):
            <lead>. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or
            `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
        <lead> is a 3-branch selection (delta WINS regardless of bloat):
          - delta != null:         "Previous turn added ~<k> tokens to your context"   (NO bloat mention)
          - delta == null, bloat>0: "Previous turn produced <N> bloated <resultWord>"   (the only bloat path)
          - both empty:            "Previous turn changed your context"                 (unreachable; fallback)
        <k> = kTokens(delta); <N> = bloatHits.length; resultWord = resultWord(N). NO [mulligan] prefix.
        NO trailing newline. NO embedded newline.
  - ADD/STRENGTHEN the "bloat counts are cosmetic / never rendered" note (contract point (c); paraphrase
    spec/07 §2 edge cases h3.58): "BLOAT IS COSMETIC ON THE DELTA PATH: pendingBloatHits are collected at
    tool_result time and are NOT subtracted when a later mulligan_rewind/shrink hides those results, so a
    bloat count on the delta path could surface stale figures (a since-shrunk result re-announced one turn
    later). The delta path therefore NEVER renders bloat — it is retained ONLY as the no-baseline fallback
    LEAD (first turn / post-reload, deltaTokens===null), where it is the sole available signal. (Per
    spec/07 §2 edge cases: the rough edge is closed at the rendering layer too.)"
  - UPDATE the cost note: keep "~25–40 tokens, only when it fires" (the condensed form is still in that
    range; optionally note "condensed to one line, was three").
  - PRESERVE: the "DEFENSIVE — NEVER throws (fail-open nudge handler; spec/07 §2; E13)" note + the
    "renderDriftNudge is reached ONLY when shouldNudge is true" sentence + the "deltaTokens===null means
    UNKNOWN, not ~0k" sentence. UPDATE only the parts that reference the old 3-line / [mulligan] / consider
    shape.

Task 3: UPDATE DRIFT_TAIL constant in test/notes.test.ts (~line 405)
  - REPLACE the 2-element array:
        // OLD:
        const DRIFT_TAIL = [
          "If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).",
          "Run `mulligan_audit` for a breakdown.",
        ];
        // NEW (single string, the tail appended after "<lead>."):
        const DRIFT_TAIL =
          ". If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.";
  - GOTCHA #2: every `[X, ...DRIFT_TAIL].join("\n")` call site becomes `X + DRIFT_X` is WRONG syntax —
    use `X + DRIFT_TAIL` where X is the lead WITHOUT a trailing period. (e.g. the lead for the delta=4200
    case is the string "Previous turn added ~4.2k tokens to your context" — NO period — so
    `"Previous turn added ~4.2k tokens to your context" + DRIFT_TAIL` yields the correct full string.)

Task 4: UPDATE test/notes.test.ts — describe('renderDriftNudge — spec/07 §2 pinned format …') (~486–545)
  - it "delta only (4200 tokens)" (~488): change `expect(out).toBe(["[mulligan] Previous turn added ~4.2k
    tokens to your context.", ...DRIFT_TAIL].join("\n"))` →
    `expect(out).toBe("Previous turn added ~4.2k tokens to your context" + DRIFT_TAIL)`. KEEP
    `expect(out.endsWith("\n")).toBe(false)` (still true — single string). KEEP `expect(out).not.toContain("bloated")`.
  - it "delta + 1 bloat hit" (~495, GOTCHA #4): the input delta=5000 now renders delta-ONLY (bloat dropped).
    UPDATE the it-name (drop "and produced 1 bloated result (singular)" → "delta wins, bloat dropped").
    CHANGE the assertion to `expect(out).toBe("Previous turn added ~5k tokens to your context" + DRIFT_TAIL)`.
    ADD `expect(out).not.toContain("bloated")` (pins the new delta-wins behavior).
  - it "delta + 3 bloat hits" (~504, GOTCHA #4): same — delta=8000 wins. UPDATE it-name. CHANGE assertion
    to `expect(out).toContain("Previous turn added ~8k tokens to your context.")` + ADD `not.toContain("bloated")`.
  - it "null delta + 2 bloat hits (first turn)" (~518, GOTCHA #5): KEEPS the bloat lead. CHANGE
    `expect(out).toBe(["[mulligan] Previous turn produced 2 bloated results.", ...DRIFT_TAIL].join("\n"))` →
    `expect(out).toBe("Previous turn produced 2 bloated results" + DRIFT_TAIL)`. KEEP
    `expect(out).not.toContain("added ~")` (the delta clause is still dropped, not "~0k").
  - it "null delta + empty bloat (defensive)" (~528): CHANGE
    `expect(out).toBe(["[mulligan] Previous turn changed your context.", ...DRIFT_TAIL].join("\n"))` →
    `expect(out).toBe("Previous turn changed your context" + DRIFT_TAIL)`.
  - it "the two tail lines are FIXED and present in EVERY case" (~534): the tail is now ONE string, not two
    lines. UPDATE the it-name ("the tail is FIXED and present in EVERY case") + the loop body:
    `expect(out).toContain(DRIFT_TAIL)` (single substring check; drop the DRIFT_TAIL[0]/DRIFT_TAIL[1] indexing).

Task 5: UPDATE test/notes.test.ts — describe('renderDriftNudge — rounding & pluralization') (~548–568)
  - it "kTokens: 3000→'3k' …" (~549): UNCHANGED — the assertions `toContain("added ~3k tokens")` etc. still
    hold on the delta path. (No edit needed unless you want to add the `+ DRIFT_TAIL` full-string form; the
    toContain checks are fine as-is.)
  - it "pluralization: 1→'result', 2→'results', 5→'results'" (~555): UNCHANGED — the assertions
    `toContain("produced 1 bloated result.")` / "2 bloated results." / "5 bloated results." still hold on the
    null-delta fallback path. (GOTCHA #5 — resultWord is still used here.)

Task 6: UPDATE test/notes.test.ts — describe('renderDriftNudge — defensive (NEVER throws)') (~571–611)
  - it "null metric" (~572, GOTCHA #7): KEEP `expect(() => …).not.toThrow()`. CHANGE
    `.toContain("[mulligan] Previous turn changed your context.")` → `.toContain("Previous turn changed your context.")`
    (drop the "[mulligan] " prefix; the substring still matches the new single-line output).
  - it "array metric" (~577): UNCHANGED (only asserts not.toThrow()).
  - it "non-array bloatHits" (~581): UNCHANGED — `toContain("added ~4k tokens to your context.")` +
    `not.toContain("bloated")` still hold (delta path, no bloat).
  - it "malformed bloat-hit entries" (~586): UNCHANGED — `toContain("produced 1 bloated result.")` still
    holds (null-delta fallback, only valid entry counted).
  - it "throwing-Proxy metric" (~607, GOTCHA #7): KEEP `not.toThrow()`. CHANGE
    `.toContain("[mulligan] Previous turn changed your context.")` → `.toContain("Previous turn changed your context.")`.

Task 7: UPDATE test/notes.test.ts — describe('renderDriftNudge — snapshot-style') (~614–640)
  - it "representative drift-only nudge (~4.2k tokens)" (~615): REWRITE the toMatchInlineSnapshot body to the
    new single-line text:
        "
        Previous turn added ~4.2k tokens to your context. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
        "
    (ONE line between the backticks — no embedded newline. You MAY hand-write it OR run `npx vitest run -u`
    once to auto-write; hand-writing is deterministic.)
  - it "representative first-turn bloat-only nudge (null delta + 2 hits)" (~625): REWRITE the
    toMatchInlineSnapshot body to:
        "
        Previous turn produced 2 bloated results. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
        "
  - Type test (~645): UNCHANGED — `expectTypeOf(renderDriftNudge({deltaTokens:4200,bloatHits:[]})).toEqualTypeOf<string>()`
    (no arity change).

Task 8: UPDATE test/edge-cases.test.ts — E18 (~986–1000, GOTCHA #3)
  - Line 986 it-name: "renderDriftNudge: the text SUGGESTS consider rewind/shrink (it does not force anything)"
    → drop "consider": "renderDriftNudge: the text SUGGESTS rewind/shrink (it does not force anything)".
  - Line 988: `expect(text).toContain("consider")` → `expect(text).toContain("call")`.
  - Line 995 comment: "We assert the text shape is advisory (lowercase \"consider\")." → "(lowercase \"call\").".
  - Line 997: `expect(text.toLowerCase()).toContain("consider")` → `expect(text.toLowerCase()).toContain("call")`.
  - PRESERVE: the `expect(text.includes("mulligan_rewind") || text.includes("mulligan_shrink")).toBe(true)`
    (line 989) + the `expect(text).toMatch(/mulligan_rewind|mulligan_shrink/)` (line 998) — both still pass
    (the new text names both tools). The advisory INTENT (E18/D3) is preserved: "call" inside "If that growth
    was wasteful, call …" is still a suggestion, not a force.

Task 9: UPDATE test/drift_nudge.test.ts — injectNudge content test (~151–156, GOTCHA #3)
  - Line 155: `expect((last.content as string).startsWith("[mulligan]")).toBe(true)` →
    `expect((last.content as string).startsWith("Previous turn")).toBe(true)`.
  - ADD a regression guard after it: `expect((last.content as string)).not.toContain("[mulligan]")`.
  - PRESERVE: `expect(typeof last.content).toBe("string")` (line 154) + the input metric
    (deltaTokens:4200 + a bloatHit — under the new logic delta wins, output starts with
    "Previous turn added ~4.2k tokens").
  - DO NOT touch the renderHighWaterNudge describe (~line 322+) — that is a DIFFERENT nudge (§5.2) that KEEPS
    its [mulligan] prefix.

Task 10: VALIDATE
  - RUN: `npm run typecheck`   → expect exit 0 (catches a DRIFT_TAIL spread-on-string mistake — GOTCHA #2).
  - RUN: `npx vitest run`      → expect full suite green, test COUNT unchanged (assertion rewrites only).
  - RUN scope guard: `git diff --name-only` → expect EXACTLY src/notes.ts, test/notes.test.ts,
    test/edge-cases.test.ts, test/drift_nudge.test.ts (four files, nothing else).
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the renderer's house style (mirror the existing JSDoc on renderNote/renderBloatReminder): a
// "FORMAT (spec/07 §N — VERBATIM)" block quoting the exact output, a "DEFENSIVE — NEVER throws" note, and a
// @param line. Keep that shape; only swap the quoted FORMAT text + add the "bloat is cosmetic on the delta
// path" note (contract point (c), spec/07 §2 edge cases h3.58).

// PATTERN — byte-for-byte target text (do NOT hand-eyeball the diff). The single-line tail is:
const TAIL =
  ". If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.";
// CRITICAL differences from the old tail:
//   (1) "call"  (was "consider")
//   (2) "; run `mulligan_audit` for a breakdown."  (was ".\nRun `mulligan_audit` for a breakdown.")
//   (3) ONE physical string (was two array elements joined by "\n")
// Copy the target BYTE-FOR-BYTE from the architecture note's "Target design → M4.T2" block or spec/07 §2.

// PATTERN — DRIFT_TAIL as a single tail string (the test-side mirror of TAIL above). Defined ONCE at the top
// of the renderDriftNudge test region; every assertion composes `"<lead-without-period>" + DRIFT_TAIL`:
//   const out = renderDriftNudge({ deltaTokens: 4200, bloatHits: [] });
//   expect(out).toBe("Previous turn added ~4.2k tokens to your context" + DRIFT_TAIL);
// This keeps the "tail is FIXED across all branches" invariant executable (the loop test asserts
// `out.toContain(DRIFT_TAIL)` for every input).

// CRITICAL — add EXPLICIT regression guards for the removed phrases/behaviors in the pinned-format block:
//   expect(out).not.toContain("[mulligan]");   // prefix removed
//   expect(out).not.toContain("consider");     // word changed to "call"
//   // delta-path-only (add to the delta+bloat tests at ~495 + ~504):
//   expect(out).not.toContain("bloated");      // bloat dropped from the delta path (GOTCHA #4)
// These negative assertions turn the contract's "drop the prefix / drop the bloat clause / consider→call"
// into executable checks — they fail loudly if a future edit re-introduces any of them.

// PATTERN — the null-delta bloat fallback is the ONLY place bloat appears now. The lead there is:
//   `Previous turn produced ${hits.length} bloated ${resultWord(hits.length)}`
// (resultWord REUSED — contract point (d)). Do NOT also append "and added ~0k tokens" — delta===null means
// UNKNOWN, never rendered as "~0k" (a lie). The existing `not.toContain("added ~")` test (~523) pins this.
```

### Integration Points

```yaml
NO NEW INTEGRATION POINTS — text rewrite of a pure helper (signature UNCHANGED: still (metric: DriftNudgeInput) => string).
  - DATABASE: none
  - CONFIG: none (no knob added/removed)
  - ROUTES: none
  - CODE: injectNudge (src/nudges.ts:354) calls renderDriftNudge(metric) and uses the return as the
          CustomMessage `content` — UNCHANGED (it just gets the new shorter text). renderHighWaterNudge
          (src/nudges.ts:480) is a DIFFERENT nudge — UNCHANGED (keeps its [mulligan] prefix).
  - TESTS: assertion rewrites in test/notes.test.ts (DRIFT_TAIL + 4 describe blocks) + the two cross-file
           fixes (test/edge-cases.test.ts E18, test/drift_nudge.test.ts injectNudge). Test COUNT unchanged.
  - DOCS: [Mode A] — the JSDoc FORMAT block + "bloat is cosmetic" note on renderDriftNudge IS the doc. NO
          separate .md file. README sync is sibling P1.M5.T1.* (do NOT touch README).
```

---

## Validation Loop

A pure-helper text rewrite cannot break runtime behavior, but it MUST typecheck (catches a DRIFT_TAIL
spread-on-string mistake) and the suite MUST stay green with the updated assertions. Run all levels.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The [mulligan] prefix is GONE from the function body (scope to the function region, NOT the JSDoc,
#     which may still mention "no [mulligan] prefix"):
grep -n 'export function renderDriftNudge' src/notes.ts   # locate the function
# Then check its body has no [mulligan]:
awk '/export function renderDriftNudge/,/^}/' src/notes.ts | grep -nF '[mulligan]' && echo "REGRESSION — prefix still in body" || echo "body clean (no [mulligan])"
# Expected: "body clean (no [mulligan])".

# (b) The new tail is present (single line, "call", "; run"):
grep -nF 'If that growth was wasteful, call' src/notes.ts
grep -nF '; run `mulligan_audit` for a breakdown.' src/notes.ts
# Expected: both hit (the body + its echo in the JSDoc FORMAT block).

# (c) "consider" is GONE from renderDriftNudge's body + its JSDoc (it may remain in renderHighWaterNudge's
#     JSDoc/body at src/nudges.ts — that is OUT OF SCOPE and correct):
awk '/export function renderDriftNudge/,/^}/' src/notes.ts | grep -nF 'consider' && echo "REGRESSION — consider still in body" || echo "body clean (no consider)"
# Expected: "body clean (no consider)".

# (d) The 4-branch is collapsed (the `delta != null && hits.length > 0` branch is GONE):
grep -nF 'delta != null && hits.length > 0' src/notes.ts && echo "REGRESSION — old delta&&bloat branch still present" || echo "4-branch collapsed to 3"
# Expected: "4-branch collapsed to 3".

# (e) DRIFT_TAIL is now a single string (not a 2-element array):
grep -n 'const DRIFT_TAIL' test/notes.test.ts
# Expected: a line like `const DRIFT_TAIL =` followed by a single string (no `[` array opener, or if
# multi-line, no second element). Inspect the next ~3 lines to confirm.

# (f) No remaining `[mulligan] Previous` assertion on drift output anywhere:
grep -rn '\[mulligan\] Previous' test/ && echo "REGRESSION — old prefixed assertion still present" || echo "all drift assertions prefix-free"
# Expected: "all drift assertions prefix-free". (renderHighWaterNudge assertions, if any, start with
# "[mulligan] Context" — those are fine and OUT OF SCOPE.)

# (g) No remaining `consider` assertion on drift output in the two cross-file tests:
grep -nF 'toContain("consider")' test/edge-cases.test.ts && echo "REGRESSION — E18 still asserts consider" || echo "E18 updated to call"
# Expected: "E18 updated to call".

# (h) The drift_nudge injectNudge test no longer asserts the prefix:
grep -nF 'startsWith("[mulligan]")' test/drift_nudge.test.ts && echo "REGRESSION — still asserts [mulligan] prefix" || echo "injectNudge test updated"
# Expected: "injectNudge test updated".
```
Expected: all grep checks pass.

### Level 2: Type-check (the strict gate — catches DRIFT_TAIL spread-on-string)

```bash
npm run typecheck        # = tsc --noEmit (strict:true; tsconfig includes src + test)
echo "typecheck exit: $?"
# Expected: exit 0, NO output. The #1 cause of failure is a `[X, ...DRIFT_TAIL].join("\n")` call site you
#           missed (GOTCHA #2) — spreading a string yields chars, and .join on a non-array errors. READ the
#           tsc output; grep -n 'DRIFT_TAIL' test/notes.test.ts to find every site and convert to `X + DRIFT_TAIL`.
```
Expected: exit 0.

### Level 3: Unit Tests (the rewritten assertions must pass)

```bash
# The renderer's own suite (DRIFT_TAIL + the 4 describe blocks + snapshots):
npx vitest run test/notes.test.ts
# Expected: all pass. The renderDriftNudge blocks now assert the new single-line text + the negative guards
#           ([mulligan]/consider/bloated-on-delta absent). The delta+bloat tests (~495, ~504) now assert
#           delta-only output. Test COUNT in this file is UNCHANGED.

# The E18 advisory-tone suite:
npx vitest run test/edge-cases.test.ts
# Expected: all pass. The two "consider" assertions are now "call"; the mulligan_rewind|shrink checks pass.

# The injectNudge suite (the cross-file startsWith fix):
npx vitest run test/drift_nudge.test.ts
# Expected: all pass. The injectNudge content test now asserts startsWith("Previous turn") +
#           not.toContain("[mulligan]"). The renderHighWaterNudge tests (different nudge) are UNCHANGED.

# Full suite (catches any cross-file surprise — there should be none beyond the four files):
npx vitest run
# Expected: all files green. NET test count UNCHANGED (assertion rewrites only — no it added/deleted).
```
Expected: all three files green; full suite green.

### Level 4: Behavior proof (manual reasoning — the contract's four OUTPUT points)

```bash
# Confirm the contract OUTPUT (1) no prefix + single line, (2) delta path no bloat, (3) null-delta keeps
# bloat + resultWord, (4) kTokens/readDelta/readBloatHits/never-throws unchanged:
awk '/export function renderDriftNudge/,/^}/' src/notes.ts | grep -cF '[mulligan]'          # (1a) expect 0
awk '/export function renderDriftNudge/,/^}/' src/notes.ts | grep -cF '`\n`'                  # (1b) no embedded newline — expect 0 (heuristic)
grep -nF 'return `${lead}.' src/notes.ts                                                       # (1c) single-string return present
awk '/export function renderDriftNudge/,/^}/' src/notes.ts | grep -cF 'and produced'           # (2) expect 0 — bloat clause gone from delta path
grep -nF 'produced ${hits.length} bloated ${resultWord' src/notes.ts                            # (3) null-delta fallback keeps bloat + resultWord
grep -nF 'function kTokens' src/notes.ts && grep -nF 'function readDelta' src/notes.ts && grep -nF 'function readBloatHits' src/notes.ts   # (4a) helpers unchanged
grep -nE 'NEVER throws|never throws' src/notes.ts | head -1                                     # (4b) discipline preserved
# Expected: (1a)=0, (1b)=0, (1c)=1 match, (2)=0, (3)=1 match, (4a)=3 matches, (4b)=1+ match.
```
Expected: all contract outputs verified.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
git -C . diff --name-only
# Expected: EXACTLY these four files:
#   src/notes.ts
#   test/notes.test.ts
#   test/edge-cases.test.ts
#   test/drift_nudge.test.ts
git -C . diff --name-only | grep -vE '^(src/notes\.ts|test/notes\.test\.ts|test/edge-cases\.test\.ts|test/drift_nudge\.test\.ts)$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# Expected: "scope OK". renderBloatReminder (T1's scope), renderHighWaterNudge (§5.2, untouched),
#           suppressCheck (T3's scope), README (M5), config, spec/*, package.json must NOT appear.
```
Expected: only the four listed files in the diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms no `[mulligan]`/`consider` in the function body, the 4-branch collapsed to 3,
      DRIFT_TAIL is a single string, and no prefixed/`consider` drift assertion survives anywhere.
- [ ] Level 2: `npm run typecheck` exits 0 (strict mode clean).
- [ ] Level 3: `npx vitest run test/notes.test.ts` + `test/edge-cases.test.ts` + `test/drift_nudge.test.ts`
      pass; full `npx vitest run` green.
- [ ] Level 4: the contract OUTPUT points verified (no prefix, delta-no-bloat, null-delta keeps bloat,
      helpers + never-throws unchanged).
- [ ] Level 5: `git diff --name-only` shows EXACTLY the four files.

### Feature Validation
- [ ] `renderDriftNudge` returns a SINGLE string (NO embedded `\n`), NO `[mulligan]` prefix, for all three
      branches.
- [ ] The delta-available path (`delta != null`) NEVER mentions bloat, even when `bloatHits` is non-empty
      (the `delta != null && hits.length > 0` branch is deleted/merged).
- [ ] The null-delta + bloat path STILL leads with `Previous turn produced <N> bloated <resultWord>`
      (resultWord + kTokens reused; the `not.toContain("added ~")` test still passes).
- [ ] The tail reads `… (compact a result); run \`mulligan_audit\` for a breakdown.` — "call" (not
      "consider"), ONE line.
- [ ] test/notes.test.ts: DRIFT_TAIL is a single string; the 4 describe blocks assert the new text; the
      delta+bloat tests now assert delta-only + `not.toContain("bloated")`; the totality/defensive tests
      drop the `[mulligan]` prefix from their `.toContain`.
- [ ] test/edge-cases.test.ts: E18 `consider`→`call` (×2 assertions + it-name + comment); the
      mulligan_rewind|shrink assertions still pass.
- [ ] test/drift_nudge.test.ts: the injectNudge content test asserts `startsWith("Previous turn")` +
      `not.toContain("[mulligan]")`; renderHighWaterNudge tests UNCHANGED.

### Code Quality / Scope Discipline
- [ ] The renderer's house style is preserved (JSDoc FORMAT block, DEFENSIVE note, @param line).
- [ ] The JSDoc FORMAT block quotes the new verbatim text + the "bloat is cosmetic on the delta path" note
      is added (contract point (c)).
- [ ] Did NOT touch `renderBloatReminder` (T1's scope), `renderHighWaterNudge` (§5.2, different nudge),
      `suppressCheck` (T3's scope), or README (M5).
- [ ] Did NOT change the `renderDriftNudge` signature (still `(metric: DriftNudgeInput): string`) — only
      the body + JSDoc.

### Documentation
- [ ] [Mode A] satisfied: the JSDoc FORMAT block + "bloat is cosmetic" note on `renderDriftNudge` IS the doc.
- [ ] No separate `.md` doc file written; README not touched (sibling P1.M5.T1.* owns it).

---

## Anti-Patterns to Avoid

- ❌ Don't keep the array-join return shape (GOTCHA #1). The new output is ONE template-literal string with
  NO embedded `\n`. Keeping `[ line1, line2, line3 ].join("\n")` re-introduces the newline + the line-break
  fragility the spec removes.
- ❌ Don't forget that `DRIFT_TAIL`'s TYPE changes from `string[]` to `string` (GOTCHA #2). Every
  `[X, ...DRIFT_TAIL].join("\n")` call site MUST become `X + DRIFT_TAIL`. grep -n 'DRIFT_TAIL'
  test/notes.test.ts lists all ~6 sites. A missed one either fails typecheck (spread-on-string) or asserts
  the wrong text.
- ❌ Don't edit only `test/notes.test.ts` (GOTCHA #3). TWO other test files break: `test/edge-cases.test.ts`
  (E18 asserts "consider") and `test/drift_nudge.test.ts` (injectNudge test asserts `startsWith("[mulligan]")`).
  grep-confirmed: these four files are the COMPLETE reference set — renderDriftNudge output text appears in
  NO other test.
- ❌ Don't assert the OLD `delta && bloat` text on the delta+bloat tests (GOTCHA #4). Under the new logic
  `delta != null` WINS → bloat is dropped. The tests at ~495 (5000+1hit) and ~504 (8000+3hits) must assert
  delta-only output + `not.toContain("bloated")`.
- ❌ Don't delete the null-delta bloat fallback or `resultWord` (GOTCHA #5). The contract point (d) requires
  resultWord still used for the no-delta fallback. That branch is the SOLE signal on first-turn/post-reload.
- ❌ Don't rely on absolute line numbers (GOTCHA #6). Sibling T1 edits the same two files in parallel; lines
  shift. Locate edits by `describe` label / function name / exact assertion string.
- ❌ Don't touch `renderHighWaterNudge` (src/nudges.ts:480) or its tests. It is a DIFFERENT nudge (§5.2) that
  KEEPS its `[mulligan]` prefix + "Consider". A `grep '[mulligan]' src/nudges.ts` will show its prefix —
  that is EXPECTED and OUT OF SCOPE.
- ❌ Don't touch `renderBloatReminder` (T1), `suppressCheck` (T3), `injectNudge` (unchanged — just consumes
  the new text), or README (M5).
- ❌ Don't add/remove a test to "balance" the count. Every change is an assertion rewrite at an existing
  `it`. (The only structural change is DRIFT_TAIL's type + the test-name strings — no `it` is added/deleted.)
- ❌ Don't skip `npm run typecheck` because "it's just text." typecheck is the gate that catches a missed
  DRIFT_TAIL spread-on-string call site (GOTCHA #2 — the highest-probability failure mode of this task).

---

## Confidence Score

**9/10** for one-pass implementation success. This is a surgical text rewrite of one pure helper (signature
unchanged) with one production call site (`injectNudge`, unchanged — just consumes the new text) and four
test files. Every fact needed is verified: the exact current function body + JSDoc (so the `edit` oldText is
unambiguous), the exact target text (spec/07 §2 / architecture note, byte-for-byte — "call", "; run", single
line, no prefix), the COMPLETE call/test reference set (grep-confirmed — four files: notes.ts + notes.test.ts
+ edge-cases.test.ts + drift_nudge.test.ts), the current DRIFT_TAIL definition + its new shape, the current
content of BOTH cross-file breakages (E18 + injectNudge test), and the two validation gates
(`npm run typecheck` strict; `npx vitest run`). The two highest-value gotchas are explicitly flagged:
GOTCHA #2 (DRIFT_TAIL string[]→string breaks every `[...DRIFT_TAIL].join` call site — typecheck catches it)
and GOTCHA #3 (two cross-file test files the contract omitted but vitest requires green). The residual
uncertainty is the implementer's choice on the DRIFT_TAIL constant exact form (leading ". " vs separate) and
the inline snapshots (hand-write vs `vitest -u`) — both stylistic and fully specified, hence not 10/10. The
parallel-sibling (T1) line-shift risk is mitigated by content-keyed edits + content-keyed validation greps.