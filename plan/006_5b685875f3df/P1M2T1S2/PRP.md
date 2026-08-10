# PRP — P1.M2.T1.S2: Nudge text test assertions (notes.test.ts)

## Goal

**Feature Goal**: Update the pinned-text nudge assertions in **`test/notes.test.ts`** to match the new (shorter)
nudge renderer strings that sibling **P1.M2.T1.S1** ships in **`src/notes.ts`**. S1 re-shortens
`renderBloatReminder` (drops "This result added … If you don't need … call … with a summary or …(granularity:…)")
and `renderDriftNudge` (drops "that growth was", converts parentheticals to "to undo/compact", removes the
"; run `mulligan_audit`" clause). After S1, `test/notes.test.ts` is RED (it pins the old text); S2 makes it
green again. This is a **test-only** task.

**Deliverable**: Edits to **exactly one file** — `test/notes.test.ts`:
- Update the `DRIFT_TAIL` constant (1 edit → auto-adapts ~5 `.toBe(lead + DRIFT_TAIL)` assertions).
- Update the `renderBloatReminder` pinned assertions (1 exact `.toBe` + 5 `.toContain` + 3 stale test names).
- Regenerate the 3 `toMatchInlineSnapshot` calls (1 bloat + 2 drift) to the new full text.

**Success Definition**: After the edit (given S1 applied), (a) `npx vitest run test/notes.test.ts` passes all
67 tests green; (b) `npx vitest run` (full suite) is green; (c) NO reference to the old nudge strings
("This result added", "that growth was", "mulligan_audit" in a drift/bloat context, "(granularity:…)") remains
in `test/notes.test.ts`; (d) the two auto-adapting consumer suites (`test/nudges.test.ts`, `test/drift_nudge.test.ts`)
remain green WITHOUT editing them.

> ⚠️ **Cross-item dependency (S2 → S1)**: S2's assertions assert the NEW renderer text. If S1 has NOT yet
> changed `src/notes.ts`, the renderers still return the OLD text and S2's NEW assertions would be RED.
> **Assume S1 is applied** (per parallel_execution_context). S2 depends on S1; the two touch **disjoint files**
> (S1 = `src/notes.ts`; S2 = `test/notes.test.ts`) → no merge conflict.

## User Persona (if applicable)

**Target User**: Maintainers/CI running the test suite — they need a green suite that faithfully pins the
shipped nudge text (so a future accidental drift back to verbose text is caught).

**Use Case**: A developer (or CI) runs `npm test`; it must be green after S1's renderer re-shortening.

**Pain Points Addressed**: After S1, `test/notes.test.ts` is red (it pinned the verbose text). Without S2,
the suite blocks merges and masks real regressions. S2 realigns the pinned text to the spec-short form.

## Why

- **Closes the planned S1/S2 split**: S1 ships the renderer TEXT (src/notes.ts); S2 ships the matching test
  SNAPSHOTS (test/notes.test.ts). This is the deliberate two-subtask division documented in S1's PRP and the
  architecture touchpoint map — S2 is the second half.
- **Spec fidelity**: spec/07 §1 (h3.50) + §2 (h3.55) prescribe the short text; the pinned tests must assert
  exactly that text so future drift is caught (the tests ARE the regression guard for the re-shortening).
- **Zero behavioral change**: only test assertions change — no production code, no config, no API surface.

## What

Test-only edits in `test/notes.test.ts`. Three groups:

**(A) `DRIFT_TAIL` constant** (1 edit; auto-adapts ~5 assertions that concatenate `lead + DRIFT_TAIL`):
```ts
// CURRENT (line ~395–396):
const DRIFT_TAIL =
  ". If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.";
// NEW:
const DRIFT_TAIL =
  ". If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.";
```

**(B) `renderBloatReminder` assertions** (manual edits; these are NOT a shared constant):
```ts
// L402 — exact .toBe (the full shipped string). CURRENT:
expect(out).toBe(
  "\n---\nThis result added ~8 KB to your context. If you don't need the full output, call `mulligan_shrink` with a summary or `mulligan_rewind(granularity:\"last_tool_call_group\")` if the whole call was a mistake.",
);
// NEW:
expect(out).toBe(
  "\n---\n~8 KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.",
);

// L410 — toContain. CURRENT: "This result added ~30 KB to your context."  → NEW: "~30 KB added to your context."
// L415 — toContain. CURRENT: "This result added ~9 KB to your context."   → NEW: "~9 KB added to your context."
// L439, L442, L445 — toContain (NaN/-100/Infinity). CURRENT: "This result added ~0 KB to your context." → NEW: "~0 KB added to your context."

// L420–421 — VERBATIM body assertion. CURRENT:
expect(out).toContain("call `mulligan_shrink` with a summary or");
expect(out).toContain('`mulligan_rewind(granularity:"last_tool_call_group")`');
// NEW:
expect(out).toContain("`mulligan_shrink` to summarize");
expect(out).toContain("`mulligan_rewind` if the whole call was a mistake");
```
Plus 3 stale test NAMES to refresh (the `it("…")` descriptions now reference removed text):
- L399: `"8 KB result → 'This result added ~8 KB …'"` → `"8 KB result → '~8 KB added …'"`
- L408: `"30 KB result (the spec's '30 KB read') → 'This result added ~30 KB …'"` → `…→ '~30 KB added …'`
- L418: `"body text is VERBATIM (backticks, the granularity literal, 'summary or' — no comma — GOTCHA #13)"` → `"body text is VERBATIM (backticks, 'to summarize', 'if the whole call was a mistake' — GOTCHA #13)"`

**(C) 3 `toMatchInlineSnapshot` calls** — regenerate to the new full text (preferred: `npx vitest run -u test/notes.test.ts`):
- bloat 30 KB (multi-line snapshot, ~L457) — new string: `` `\n---\n~30 KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.` ``
- drift-only ~4.2k (single-line `'"..."'`, ~L604) — new: `"Previous turn added ~4.2k tokens to your context. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result."`
- bloat-only null-delta+2 hits (single-line `'"..."'`, ~L618) — new: `"Previous turn produced 2 bloated results. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result."`

### Success Criteria

- [ ] `DRIFT_TAIL` constant holds the new tail (no "that growth was", no "mulligan_audit", no parentheticals).
- [ ] All `renderBloatReminder` `.toBe`/`.toContain` assertions assert the new short text; 3 test names refreshed.
- [ ] The 3 `toMatchInlineSnapshot` calls hold the new full text (bloat 30 KB + 2 drift).
- [ ] `npx vitest run test/notes.test.ts` → 67 passed (67).
- [ ] `npx vitest run` → full suite green (no regression).
- [ ] `grep -nE 'This result added|that growth was wasteful' test/notes.test.ts` → NO hits.
- [ ] No edits to any file other than `test/notes.test.ts` (esp. NOT src/notes.ts, src/nudges.ts, test/nudges.test.ts, test/drift_nudge.test.ts).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim OLD assertion text (current, line-numbered) and the verbatim NEW text
for every edit site, the exact `DRIFT_TAIL` constant, the 3 inline snapshots' new strings, the confirmation
that the two sibling suites auto-adapt (no edit), the preferred snapshot-regeneration command, and the S1
dependency. The implementer needs no exploration beyond opening `test/notes.test.ts`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: test/notes.test.ts
  why: (1) DRIFT_TAIL constant (~L395–396) → 1 edit auto-adapts the lead+DRIFT_TAIL .toBe assertions (L468/481/510/518/531).
        (2) renderBloatReminder block (~L399–461): exact .toBe (L402), toContain (L410/415/439/442/445),
            VERBATIM body (L420–421), 3 stale test names (L399/408/418), 1 inline snapshot (L457).
        (3) renderDriftNudge block (~L468–619): lead+DRIFT_TAIL assertions auto-adapt via (1); 2 inline snapshots (L604/618).
  pattern: "pinned-text assertions: .toBe('<full string>'), .toContain('<substring>'), toMatchInlineSnapshot(`...`).
            The drift assertions concatenate a LEAD const + DRIFT_TAIL const (DRIFT_TAIL is the only shared anchor)."
  gotcha: "Use TEXT-ANCHORED find/replace, NOT line numbers — M1.T1.S3 (if it lands) edits the renderNote region
           ~L178–340 and may shift line numbers. S2's edits are all ≥L395 (the nudge region), text-disjoint from M1.T1.S3."

# MUST READ — the sibling contract (defines the EXACT new strings S2 must match)
- file: plan/006_5b685875f3df/P1M2T1S1/PRP.md
  why: CONTRACT. S1 edits ONLY src/notes.ts: renderBloatReminder body (L271) + renderDriftNudge body (L320) +
        2 JSDoc FORMAT blocks + cost note (~30→~20 tokens). Gives the VERBATIM NEW strings S2 snapshots must equal.
  critical: "S2 REQUIRES S1 applied (renderers must return the new text). S1 touches only src/notes.ts → no file
             conflict with S2 (test/notes.test.ts). Do NOT edit src/notes.ts (S1 owns it)."

# SHOULD READ — the spec the new text must match (cross-check the strings)
- docfile: spec/07-preventive-and-nudges.md
  why: "§1 (h3.50) renderBloatReminder: '~<KB> KB added to your context. `mulligan_shrink` to summarize, or
        `mulligan_rewind` if the whole call was a mistake.' §2 (h3.55) renderDriftNudge: '<lead>. If wasteful,
        `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.'"
  section: "h3.50 (renderBloatReminder); h3.55 (renderDriftNudge)."

# SHOULD READ — the delta-006 touchpoint map (confirms the S1/S2 split + auto-adapting consumers)
- docfile: plan/006_5b685875f3df/architecture/system_context.md
  why: "§Touchpoint Map + §Verification of PRD Claims confirm M2 touches only renderBloatReminder/renderDriftNudge
        in notes.ts; that nudges.test.ts + drift_nudge.test.ts auto-adapt (no pinned-text assertions); and assign
        the notes.test.ts renderer snapshots to S2."
  critical: "Confirms S2's scope is EXACTLY test/notes.test.ts — the sibling suites need no edit (re-verified by grep)."

# CONTEXT — the renderers S2 snapshots (READ-ONLY; S1 edits them, S2 does not)
- file: src/notes.ts
  why: "renderBloatReminder (L271) + renderDriftNudge (L320) are the functions the assertions call. After S1 they
        return the new text; S2's assertions must equal that output. (Currently pre-S1 = OLD text; baseline green.)"
  gotcha: "S2 must NOT edit src/notes.ts. If you find src/notes.ts still has OLD text, S1 hasn't landed — S2's new
           assertions will be RED until S1 ships. Coordinate so S1 lands with/before S2."

# CONTEXT — the auto-adapting call site + consumers (DO NOT EDIT — re-verified)
- file: src/nudges.ts
  why: "imports renderBloatReminder + renderDriftNudge from ./notes.js and passes them through; auto-adapts."
- file: test/nudges.test.ts
  why: "L299 asserts appended.text === renderBloatReminder('read', OVER_BYTES) (RETURN VALUE) → auto-adapts."
- file: test/drift_nudge.test.ts
  why: "L151 asserts startsWith('Previous turn') + not.toContain('[mulligan]') → both still true → auto-adapts."
```

### Current Codebase tree (the relevant slice)

```bash
src/
├── notes.ts             # READ-ONLY for S2 — S1 edits the renderers here; S2 snapshots their output
└── nudges.ts            # READ-ONLY — call site; auto-adapts (NO edit)
test/
├── notes.test.ts        # ← THIS PRP edits: DRIFT_TAIL + bloat assertions + 3 inline snapshots
├── nudges.test.ts       # READ-ONLY — auto-adapts (return-value assertion)
└── drift_nudge.test.ts  # READ-ONLY — auto-adapts (loose startsWith/not.toContain)
spec/07-preventive-and-nudges.md  # READ-ONLY — §1/§2 VERBATIM text targets
plan/006_5b685875f3df/architecture/system_context.md  # READ-ONLY — touchpoint map + verification claims
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
test/notes.test.ts   # DRIFT_TAIL const + renderBloatReminder assertions + 3 inline snapshots + 3 stale test names
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (S2 REQUIRES S1 applied): the assertions assert the NEW renderer text. If src/notes.ts
//   still returns OLD text (S1 not landed), S2's NEW assertions are RED. Ensure S1 ships with/before S2.
//   Do NOT edit src/notes.ts yourself (S1 owns it).

// CRITICAL GOTCHA #2 (TEXT-ANCHORED edits, not line numbers): M1.T1.S3 (P1.M1.T1.S3, status Ready) edits the
//   renderNote region of notes.test.ts (~L178–340, the `avoid` field removal) and may SHIFT line numbers in the
//   nudge region (≥L395). S2's edits are TEXT-DISJOINT from M1.T1.S3's, but line numbers may be stale. Use the
//   verbatim OLD text as the find anchor (it is unique per site), NOT the line numbers.

// CRITICAL GOTCHA #3 (the DRIFT_TAIL constant is the leverage point): ~5 drift assertions do `.toBe("<lead>" +
//   DRIFT_TAIL)` or `.toContain(DRIFT_TAIL)`. Updating ONLY the DRIFT_TAIL constant fixes all of them — do NOT
//   edit each individually (you'd risk inconsistency). Edit DRIFT_TAIL once; leave the concatenations alone.

// CRITICAL GOTCHA #4 (the 3 toMatchInlineSnapshot calls are best regenerated, not hand-edited): inline-snapshot
//   text has exact whitespace + backtick-escaping rules (the bloat one is multi-line with a leading blank line
//   for `\n`; the drift ones are single-line `'"..."'`). The RELIABLE one-pass path: after the (A)+(B) manual
//   edits, run `npx vitest run -u test/notes.test.ts` — it rewrites ONLY the 3 stale snapshots to match S1's new
//   renderer output (.toBe/.toContain are not snapshots → untouched by -u). Hand-editing the snapshot text is a
//   fallback if -u is unavailable; reproduce the escaping EXACTLY (backticks around tool names).

// CRITICAL GOTCHA #5 (escaped backticks in the .toBe/.toContain literals): the assertion strings contain literal
//   backticks around tool names (`mulligan_shrink`, `mulligan_rewind`). In a TS double-quoted string these are
//   just backtick characters (no escaping needed in "..."). In a template literal they'd need \`. Match the
//   surrounding code's quoting style. (The current file uses double-quoted "..." for .toContain/.toBe args.)

// CRITICAL GOTCHA #6 (the regression guards stay): tests also assert `.not.toContain("[mulligan]")`,
//   `.not.toContain("threshold")`, `.not.toContain("stays on disk")`, `.not.toContain("consider")`,
//   `.not.toContain("bloated")` — NONE of these substrings appear in the NEW text, so these guards STILL PASS.
//   Do NOT touch them.

// CRITICAL GOTCHA #7 (do NOT touch the sibling suites): test/nudges.test.ts:299 + test/drift_nudge.test.ts:151
//   auto-adapt (return-value / loose-match assertions). Editing them is OUT OF SCOPE and unnecessary. (Verified
//   by grep: only test/notes.test.ts references the old verbose text.)

// OUT OF SCOPE (do NOT touch in this subtask):
#   - src/notes.ts (S1's file), src/nudges.ts (call site), spec/07, README (M3).
#   - test/nudges.test.ts, test/drift_nudge.test.ts (auto-adapt).
#   - The renderNote region of test/notes.test.ts (~L178–340) — M1.T1.S3's territory.
#   - The non-nudge parts of notes.test.ts (estimateTokens, ledger, note-field-validation tests).
# This PRP edits ONLY the nudge-renderer region (~L395–619) of test/notes.test.ts.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data-model change. `DriftNudgeInput`/`resultKb` are unchanged; only the pinned assertion STRINGS
(and the `DRIFT_TAIL` const) change to match S1's new renderer output._

### Implementation Tasks (ordered by dependencies)

Apply the `DRIFT_TAIL` constant first (auto-adapts the drift assertions), then the bloat assertions, then
the 3 snapshots.

```yaml
Task 1: EDIT test/notes.test.ts — the DRIFT_TAIL constant (~L395–396)
  - FIND (verbatim current):
      "const DRIFT_TAIL =\n  \". If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.\";"
  - REPLACE WITH:
      "const DRIFT_TAIL =\n  \". If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.\";"
  - RATIONALE: the new drift tail (spec/07 §2 h3.55). This SINGLE edit auto-adapts ~5 lead+DRIFT_TAIL
    assertions (L468/481/510/518/531) — do NOT edit those individually.
  - DO NOT: edit the LEAD strings ("Previous turn added ~4.2k tokens to your context", etc.) — leads are unchanged.

Task 2: EDIT test/notes.test.ts — renderBloatReminder 8 KB exact .toBe (~L402)
  - FIND (verbatim current, the full old string):
      "      \"\\n---\\nThis result added ~8 KB to your context. If you don't need the full output, call `mulligan_shrink` with a summary or `mulligan_rewind(granularity:\\\"last_tool_call_group\\\")` if the whole call was a mistake.\","
  - REPLACE WITH:
      "      \"\\n---\\n~8 KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.\","
  - RATIONALE: matches S1's new renderBloatReminder output (spec/07 §1 h3.50).

Task 3: EDIT test/notes.test.ts — the 5 toContain bloat assertions (L410, L415, L439, L442, L445)
  - FIND/REPLACE (5 sites, each a unique substring; apply per the "What (B)" table):
      "This result added ~30 KB to your context." → "~30 KB added to your context."
      "This result added ~9 KB to your context."  → "~9 KB added to your context."
      "This result added ~0 KB to your context."  → "~0 KB added to your context."   # ×3 (NaN, -100, Infinity)
  - GOTCHA: the "~0 KB" string appears 3× (identical) — if your editor requires unique anchors, include the
    preceding line (the `renderBloatReminder("read", NaN|...|-100|Infinity)` arg) to disambiguate, OR apply a
    replace-all of that exact substring (all 3 must change identically → replace-all is safe).

Task 4: EDIT test/notes.test.ts — the VERBATIM body assertion (~L420–421)
  - FIND (verbatim current, 2 lines):
      "    expect(out).toContain(\"call `mulligan_shrink` with a summary or\");\n    expect(out).toContain('`mulligan_rewind(granularity:\"last_tool_call_group\")`');"
  - REPLACE WITH:
      "    expect(out).toContain(\"`mulligan_shrink` to summarize\");\n    expect(out).toContain(\"`mulligan_rewind` if the whole call was a mistake\");"
  - RATIONALE: the granularity literal + "with a summary or" are GONE in the new text; assert the new phrases.

Task 5: EDIT test/notes.test.ts — refresh the 3 stale test names (L399, L408, L418)
  - L399: "8 KB result → 'This result added ~8 KB …'" → "8 KB result → '~8 KB added …'"
  - L408: "30 KB result (the spec's '30 KB read') → 'This result added ~30 KB …'" → replace inner "'This result added ~30 KB …'" with "'~30 KB added …'"
  - L418: "body text is VERBATIM (backticks, the granularity literal, 'summary or' — no comma — GOTCHA #13)" → "body text is VERBATIM (backticks, 'to summarize', 'if the whole call was a mistake' — GOTCHA #13)"
  - RATIONALE: stale test names reference removed text (granularity literal, 'summary or'). Optional but
    recommended for clarity; the tests PASS either way (the name is not asserted).

Task 6: REGENERATE the 3 toMatchInlineSnapshot calls (bloat L457; drift L604 + L618)
  - PREFERRED (reliable one-pass): after Tasks 1–5, run:
        npx vitest run -u test/notes.test.ts
    This rewrites ONLY the 3 stale inline snapshots to match S1's new renderer output (the .toBe/.toContain
    are not snapshots → untouched). Verify the rewritten snapshots contain "~KB added"/"If wasteful" (new text).
  - FALLBACK (manual, if -u unavailable) — set each snapshot to the exact new full string:
      bloat (multi-line, represents `\n---\n~30 KB added …mistake.`):
        snapshot body → blank line, then "---", then
        "~30 KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake."
      drift-only (single-line '"..."'):
        '"Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."'
      bloat-only (single-line '"..."'):
        '"Previous turn produced 2 bloated results. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."'
  - DO NOT: change the renderer INPUTS (the args to renderBloatReminder/renderDriftNudge) — only the expected snapshot.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the drift assertions all share ONE constant (DRIFT_TAIL). Editing it once is the minimal, consistent fix:
//   expect(out).toBe("Previous turn added ~4.2k tokens to your context" + DRIFT_TAIL);   // L468 — auto-adapts
//   expect(out).toBe("Previous turn added ~5k tokens to your context"   + DRIFT_TAIL);   // L481 — auto-adapts
//   expect(out).toBe("Previous turn produced 2 bloated results"         + DRIFT_TAIL);   // L510 — auto-adapts
//   expect(out).toBe("Previous turn changed your context"               + DRIFT_TAIL);   // L518 — auto-adapts
//   for (...) expect(out).toContain(DRIFT_TAIL);                                          // L531 — auto-adapts
// The LEAD consts are UNCHANGED ("Previous turn added ~4.2k tokens to your context" etc.) — only DRIFT_TAIL changes.

// PATTERN: renderBloatReminder assertions are NOT shared (each pins a fragment) → edit each site. The "~0 KB"
// fragment appears 3× identically → a replace-all of that exact substring is SAFE (all 3 must change the same way).

// PATTERN (inline snapshots): prefer `npx vitest run -u <file>` over hand-editing snapshot text — vitest writes
// the canonical whitespace/escaping. After -u, the snapshot matches the renderer's ACTUAL output (which is S1's
// new text). The -u flag leaves .toBe/.toContain untouched (they are not snapshots).

// CRITICAL: do NOT edit src/notes.ts, src/nudges.ts, test/nudges.test.ts, or test/drift_nudge.test.ts.
//   - src/notes.ts is S1's deliverable (the renderer TEXT).
//   - test/nudges.test.ts + test/drift_nudge.test.ts auto-adapt (verified by grep).
```

### Integration Points

```yaml
NO CODE/CONFIG/ROUTE INTEGRATION — this is a test-assertion update (Mode A).
  - DATABASE/session/config/routes/registration: none.
  - CODE: NONE. S2 does NOT touch any src/* file. The renderers (src/notes.ts) are S1's; S2 only snapshots them.
  - TESTS: the ONLY integration is "the pinned text now equals S1's renderer output". The two sibling suites
          (nudges.test.ts, drift_nudge.test.ts) are unaffected (auto-adapting).
```

---

## Validation Loop

A test-only change. Validation = the notes.test.ts suite green + full suite green + grep confirms no old text remains.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check is NOT meaningfully affected (S2 changes only string literals in assertions). Run it to confirm
# S2 introduced NO new errors (baseline may have up to 2 pre-existing errors from the in-progress M1.T1.S3 —
# notes.test.ts:323, rewind.test.ts:843; S2 adds none of its own).
npx tsc --noEmit 2>&1 | grep -E 'error TS' | sort
# EXPECT: error set UNCHANGED vs. baseline (S2's edits are pure string literals). No NEW errors in test/notes.test.ts.

# Grep: confirm NO old nudge text remains in test/notes.test.ts (the "fully migrated" proof):
grep -nE 'This result added|that growth was wasteful|granularity:"last_tool_call_group"|with a summary or' test/notes.test.ts
# EXPECT: NO output (all migrated). If any line prints, you missed a site (re-check Tasks 2–4).
```
Expected: tsc introduces no new errors; the grep prints nothing.

### Level 2: Unit Tests (the primary gate)

```bash
# notes.test.ts — the file S2 owns. MUST be green (67 tests).
npx vitest run test/notes.test.ts
# EXPECT: 67 passed (67). If FAILURES: read the diff — a stale assertion still pins old text (re-check the edit map)
#   OR an inline snapshot wasn't regenerated (re-run `npx vitest run -u test/notes.test.ts`).

# The two auto-adapting consumer suites — confirm they're STILL green (proves S2 didn't need to touch them):
npx vitest run test/nudges.test.ts test/drift_nudge.test.ts
# EXPECT: all green (they compare to the renderer return value / use loose matches).

# Full suite — regression guard (S2 changes only test/notes.test.ts).
npx vitest run
# EXPECT: full suite green (same count as before S1+S2). If a NON-notes test fails, S2 accidentally touched
#   something beyond scope — re-check.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. The "system" validation for a test-assertion update IS Level 2.
# Optional direct proof the new text ships (given S1 applied): the renderer returns exactly what S2 snapshots.
npx tsx -e "
import { renderBloatReminder, renderDriftNudge } from './src/notes.js';
console.log(JSON.stringify(renderBloatReminder('read', 8192)));
console.log(JSON.stringify(renderDriftNudge({ deltaTokens: 4200, bloatHits: [] })));
"
# EXPECT (given S1 applied):
#   "\n---\n~8 KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake."
#   "Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."
# These two strings are exactly what S2's 8 KB .toBe + drift inline snapshot now assert.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for a test-text migration. No UI/perf/security surface. Levels 1–3 fully cover correctness.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — NO new errors (string-literal edits only; baseline unchanged).
- [ ] `npx vitest run test/notes.test.ts` — 67/67 green.
- [ ] `npx vitest run` — full suite green (no regression).
- [ ] `grep -nE 'This result added|that growth was wasteful' test/notes.test.ts` — NO hits.

### Feature Validation
- [ ] `DRIFT_TAIL` constant holds the new tail (". If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.").
- [ ] The 8 KB `.toBe` asserts the new full string; the 5 `.toContain` bloat fragments assert new short fragments.
- [ ] The VERBATIM body assertion checks "`mulligan_shrink` to summarize" + "`mulligan_rewind` if the whole call was a mistake".
- [ ] The 3 `toMatchInlineSnapshot` calls hold the new full text (bloat 30 KB + drift-only + bloat-only).
- [ ] No edits to any file other than `test/notes.test.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT edit `src/notes.ts` (S1's file), `src/nudges.ts` (call site), or any `src/*`.
- [ ] Did NOT edit `test/nudges.test.ts` or `test/drift_nudge.test.ts` (they auto-adapt).
- [ ] Did NOT touch the renderNote region of `test/notes.test.ts` (~L178–340, M1.T1.S3's territory).
- [ ] Used TEXT-ANCHORED find/replace (not line numbers) — robust to M1.T1.S3 line shifts.
- [ ] Edited `DRIFT_TAIL` once (not each concatenation individually).
- [ ] Left the regression guards (`.not.toContain("[mulligan]"|"threshold"|"stays on disk"|"consider"|"bloated")`) unchanged.

### Documentation
- [ ] Refreshed the 3 stale test names to not reference removed text (granularity literal, 'summary or').
- [ ] [Mode A] No separate doc file change (test-only; no user-facing/config/API surface).

---

## Anti-Patterns to Avoid

- ❌ Don't edit each `lead + DRIFT_TAIL` assertion individually — edit the `DRIFT_TAIL` constant ONCE; the ~5
  concatenations auto-adapt. Editing them individually risks inconsistency.
- ❌ Don't hand-edit the 3 inline snapshots if you can run `npx vitest run -u test/notes.test.ts` — the `-u`
  flag writes canonical whitespace/escaping and only touches stale snapshots (the `.toBe`/`.toContain` are safe).
- ❌ Don't use line numbers as anchors — M1.T1.S3 (if it lands first) shifts line numbers in the renderNote
  region and may cascade. Use the verbatim OLD text as the find anchor (unique per site).
- ❌ Don't edit `src/notes.ts` — that's S1's file (the renderer TEXT). S2 only updates the test SNAPSHOTS.
- ❌ Don't touch `test/nudges.test.ts` or `test/drift_nudge.test.ts` — they auto-adapt (verified by grep: only
  `test/notes.test.ts` references the old verbose text).
- ❌ Don't expect a green suite if S1 hasn't landed — the assertions assert the NEW renderer text; without S1
  the renderers return OLD text and S2's new assertions are RED. Coordinate so S1 lands with/before S2.
- ❌ Don't forget the "~0 KB" fragment appears 3× (NaN, -100, Infinity) — either replace-all (safe: all change
  identically) or disambiguate with the preceding `renderBloatReminder(...)` arg.
- ❌ Don't change the renderer INPUTS in the snapshot tests (the args to `renderBloatReminder("read", 30720)` etc.)
  — only the expected snapshot text.
- ❌ Don't remove or alter the `.not.toContain(...)` regression guards — they still pass and guard against drift.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a mechanical, fully-enumerated test-text migration: every
edit site has verbatim OLD text (find anchor) + verbatim NEW text (replace), the single-point-of-leverage
`DRIFT_TAIL` constant is identified, the 3 inline snapshots have a reliable regeneration path (`-u`), and the
scope is verified tight (grep confirms only `test/notes.test.ts` references the old text; the two sibling suites
auto-adapt). The two residual risks are both mitigated: (1) the S1 dependency — S2's assertions are RED until S1
ships the new renderer text (flagged prominently; coordinate S1 with/before S2); (2) the M1.T1.S3 line-shift
risk — mitigated by TEXT-anchored find/replace and the explicit "don't use line numbers" guidance (S2's region
is text-disjoint from M1.T1.S3's). Deterministic gates: `npx vitest run test/notes.test.ts` 67/67; full suite
green; grep for old text returns nothing.