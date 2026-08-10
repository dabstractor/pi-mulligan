# PRP — P1.M4.T1.S1: renderBloatReminder rewrite + call site update

## Goal

**Feature Goal**: Simplify Nudge A's rendered text. `renderBloatReminder` drops the `thresholdBytes`
parameter from its SIGNATURE (it was only ever rendered, never used to gate firing) and its body is
rewritten from a 4-line `[mulligan]`-prefixed form (with threshold mention + a "stays on disk" clause)
to the spec/07 §1 verbatim single-line form (no prefix, no threshold, no "stays on disk"). The single
call site at `src/nudges.ts:133` drops the now-removed `threshold` argument. The threshold still GATES
firing one line above (nudges.ts:131, unchanged) — it just is no longer passed to or rendered by the
helper. Net effect: ~30 tokens per fire (was ~40) and a cleaner, advisory-only message.

**Deliverable**: Edits to **three** files only — `src/notes.ts` (the function body + signature + JSDoc),
`src/nudges.ts` (one call site line), and the test files that call `renderBloatReminder` with the old
3-arg signature / assert the old text (`test/notes.test.ts` + `test/nudges.test.ts`). DOCS = [Mode A]:
the JSDoc FORMAT block update IS the doc — no separate doc file.

**Success Definition**: After the edits, (1) `renderBloatReminder(toolName, bytes)` is a 2-arg function
rendering the exact single-line text; (2) `src/nudges.ts:133` calls it with 2 args (`event.toolName,
bytes`) while `threshold` is still computed + used for the `if (bytes < threshold) return;` gate; (3)
`bytesToKb` and the never-throws discipline are unchanged; (4) `npm run typecheck` exits 0; (5)
`npx vitest run` is green with the renderBloatReminder tests updated to the new text/arity (test COUNT
unchanged — these are assertion rewrites, not additions/deletions).

> ⚠️ **[Mode A] doc update.** The only "documentation" change is the JSDoc `FORMAT` block + signature on
> `renderBloatReminder` itself. There is NO separate `.md` doc file to write or update. The README sync
> (config table / blurbs) is a separate sibling item (P1.M5.T1.*) — do NOT touch README here.

## User Persona (if applicable)

**Target User**: The agent operating under the Mulligan extension (the consumer of the reminder text).

**Use Case**: After a tool result exceeds the bloat threshold, the handler appends this one-line reminder
to the result content. The agent reads it and decides whether to `mulligan_shrink` / `mulligan_rewind`.

**User Journey**: A `read` of a 30 KB file fires Nudge A → the single-line reminder is appended to that
result → the agent either shrinks it (reminder disappears automatically) or ignores it (~30-token cost).

**Pain Points Addressed**: The old `[mulligan]` prefix and threshold mention were noise; the "stays on
disk" clause was irrelevant to the decision. The new text is strictly actionable, ~10 tokens lighter.

## Why

- **The `[mulligan]` prefix and threshold mention are noise** (spec/07 §1, M4 architecture note). The
  reminder is already co-located with the offending result; a prefix and a "(threshold N KB)" aside add
  tokens without adding decision signal.
- **The "stays on disk" clause was a non-sequitur for the agent's decision.** The agent's choice is
  shrink-vs-rewind-vs-ignore *for its own context hygiene*; the on-disk-preservation guarantee is a human-
  facing safety note, not something the agent acts on.
- **Signature hygiene**: `thresholdBytes` was ONLY ever rendered, never used for logic inside the
  renderer (the gate lives in the handler). Carrying it as a parameter implied a false coupling. Dropping
  it makes the renderer a pure `(what, how-big) → text` function.
- **Scope discipline within M4**: this is the *render + call-site* half (T1). The sibling `renderDriftNudge`
  rewrite is T2; the `suppressCheck` §5.3 JSDoc align is T3. Do NOT touch those — T1 is bloat-reminder only.

## What

A surgical rewrite of one pure helper + its single call site + the tests that pin its output.

1. **`src/notes.ts`** — `renderBloatReminder` (the S3 block, JSDoc starts ~line 251, function at
   line 278): change the signature from `(_toolName: string, bytes: number, thresholdBytes: number)`
   to `(toolName: string, bytes: number)`; replace the 4-line body with the single-line form; rewrite the
   JSDoc `FORMAT` block + param docs + the token-cost note (`~40` → `~30`).
2. **`src/nudges.ts:133`** — the one call site: `renderBloatReminder(event.toolName, bytes, threshold)`
   → `renderBloatReminder(event.toolName, bytes)`. The `threshold` variable stays (still computed on the
   line above + still used for the gate on line 131).
3. **`test/notes.test.ts`** — the `renderBloatReminder` test blocks (lines ~410–477) + the type test
   (lines 641–642): drop the 3rd arg everywhere; rewrite the text assertions to the new single-line form;
   delete the now-meaningless "non-finite threshold → threshold 0 KB" defensive case (threshold is no
   longer rendered); keep the `bytesToKb`-bad-number defensive cases but re-point them at `~0 KB`.
4. **`test/nudges.test.ts:291–300`** — the cross-file "the appended block is … renderBloatReminder(…)"
   reuse test: drop the 3rd arg (line 299) + update the `it(...)` name string (line 291) that still says
   `renderBloatReminder(toolName,bytes,threshold)`.

### Success Criteria

- [ ] `renderBloatReminder` has the 2-arg signature `(toolName: string, bytes: number): string` and the
      body returns the spec/07 §1 verbatim single-line string (leading `\n---\n`, NO `[mulligan]` prefix,
      NO threshold mention, NO "stays on disk" clause, NO trailing newline).
- [ ] `toolName` is named WITHOUT the leading `_` (spec signature) and is still NOT interpolated into the
      v1 text (no `<toolName>` placeholder). It is a bare-unused param — see GOTCHA #1 (safe: no
      `noUnusedParameters`, no ESLint).
- [ ] `src/nudges.ts:133` calls `renderBloatReminder(event.toolName, bytes)` (2 args). The `threshold`
      variable is STILL computed + STILL gates firing at `if (bytes < threshold) return;` (line 131).
- [ ] `bytesToKb` (module-private, notes.ts:349) is unchanged + reused; the never-throws discipline is
      unchanged (NaN/negative/Infinity bytes still render as `~0 KB`).
- [ ] `npm run typecheck` exits 0; `npx vitest run` is green with test COUNT unchanged (assertion rewrites).
- [ ] Exactly three files modified: `src/notes.ts`, `src/nudges.ts`, `test/notes.test.ts`,
      `test/nudges.test.ts`. (That is four files — see note: "three" in the Deliverable counts the test
      pair as one logical test-surface; `git diff --name-only` must show EXACTLY these four.)

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the EXACT current function body + JSDoc (so the `edit` oldText is unambiguous),
the exact call-site line + its surrounding context, the COMPLETE list of every call/test site
(grep-verified — there are exactly two source sites and two test files, no others), the exact target text
(spec/07 §1 verbatim, byte-for-byte), the two confirmed validation gates (`npm run typecheck` =
`tsc --noEmit` strict; `npx vitest run`), and the tsconfig/lint facts that make the bare-unused-`toolName`
safe. The implementer does four `edit` calls and runs two commands.

### Documentation & References

```yaml
# MUST EDIT — the function under rewrite
- file: src/notes.ts
  why: Owns renderBloatReminder. The S3 block: JSDoc begins ~line 251 ("renderBloatReminder — Nudge A's
        text …"), the exported function is at line 278. Its body (4-line [mulligan] form) + JSDoc FORMAT
        block + signature all change here. bytesToKb (module-private, line 349) is REUSED unchanged.
  section: "Find the S3 block (the comment header 'S3 (P1.M2.T3.S3) — renderBloatReminder + renderDriftNudge'
            at line 226 locates the region). renderBloatReminder's JSDoc is the first export after that
            header (line 251); the function itself is at line 278. renderDriftNudge (below it) is NOT touched."
  pattern: "The module's house style for pure renderers: leading '\\n---\\n' for a markdown horizontal rule,
            no trailing newline, JSDoc with a 'FORMAT (spec/07 §N — VERBATIM)' block, 'DEFENSIVE — NEVER
            throws' note, and '@param' lines. Mirror that style for the rewritten JSDoc."
  gotcha: "GOTCHA #1: toolName becomes a BARE unused param (no _ underscore). tsconfig.json has strict:true
           but NOT noUnusedParameters/noUnusedLocals (verified — those are separate from strict), and there
           is NO ESLint config in the repo. So a bare-unused param compiles + lints clean. Do NOT re-add the
           underscore and do NOT add an eslint-disable."

# MUST EDIT — the single call site
- file: src/nudges.ts
  why: bloatReminderHandler (Nudge A's tool_result handler) calls renderBloatReminder at line 133. This is
        the ONLY production call site (grep-verified). Drop the 3rd arg (threshold).
  section: "Line 133 inside bloatReminderHandler: 'const reminder = renderBloatReminder(event.toolName,
            bytes, threshold);'. The 'threshold' on line 132 (const threshold = bloatThresholdFor(...)) and
            the gate 'if (bytes < threshold) return;' on line 131 STAY."
  pattern: "The handler reads bytes + threshold, gates on threshold, then renders. Post-edit the threshold
            is used ONLY for the gate — it is no longer threaded into the renderer."
  gotcha: "Do NOT delete the 'threshold' variable or the gate — they are load-bearing for when the nudge
           fires. Only the ARGUMENT to renderBloatReminder is removed."

# MUST EDIT — the renderer's own unit tests
- file: test/notes.test.ts
  why: Pins renderBloatReminder's output text + arity. Four regions change:
        (1) describe('renderBloatReminder — spec/07 §1 pinned format', …) lines 410–449;
        (2) describe('renderBloatReminder — defensive …', …) lines 452–469;
        (3) describe('renderBloatReminder — snapshot-style …', …) lines 471–477;
        (4) the type test 'renderBloatReminder returns a string' lines 641–642.
  section: "All four call renderBloatReminder with the OLD 3-arg signature and assert the OLD 4-line text.
            They MUST move to 2-arg calls + the new single-line assertions. The 'non-finite threshold →
            threshold 0 KB' defensive case (line 463) is DELETED (threshold no longer rendered)."
  pattern: "House test style (mirrors the rest of the file): vitest imports from '../src/notes.js', 'it'
            blocks, expect(...).toBe/.toContain/.toMatchInlineSnapshot. Keep the describe labels + the
            'toolName accepted but NOT interpolated' test (still valid — see Implementation Patterns)."
  gotcha: "GOTCHA #2: the inline snapshot (line 475) is AUTO-WRITTEN by 'npx vitest run -u' if the assertion
           body is left as toMatchInlineSnapshot() with no arg. You MAY hand-write it OR run -u once. Prefer
           hand-writing the exact expected string (deterministic, no extra tooling step)."

# MUST EDIT — the cross-file reuse assertion (the contract did NOT name this file; grep found it)
- file: test/nudges.test.ts
  why: Line 299 asserts the appended reminder block equals renderBloatReminder(...) BYTE-FOR-BYTE. It calls
        renderBloatReminder('read', OVER_BYTES, READ_THRESHOLD) with 3 args — a 3rd arg that no longer
        exists. This is a COMPILE ERROR after the signature change (tsc: 'Expected 2 arguments, but got 3').
        The 'it(...)' name on line 291 also still says 'renderBloatReminder(toolName,bytes,threshold)'.
  section: "The describe block around line 280 ('…the appended block is {type:'text', text:
            renderBloatReminder(…)} EXACTLY (reuse)'). Edit line 299 (drop READ_THRESHOLD) + line 291
            (update the name string to drop 'threshold')."
  pattern: "This test reuses the helper as the source of truth for the appended text — it does NOT
            hard-code the string. So it needs NO text-assertion change, ONLY the arity fix. That is the
            point of the reuse test: it tracks renderBloatReminder automatically."
  critical: "This file is the one the contract omitted. Without editing it, 'npm run typecheck' FAILS on
             the 3-arg call. It is the #1 reason a 'single-file' mental model of this task is wrong."

# MUST READ — the spec authority (verbatim target text)
- file: plan/005_95d30743cdd4/architecture/m4_nudge_text_simplification.md
  why: Pins the EXACT current text + the EXACT target text for this exact subtask (M4.T1). The 'Target
        design → M4.T1' section is the single source of truth for the new signature + new body.
  critical: "The target body is verbatim there: '\\n---\\nThis result added ~<KB> KB to your context. If you
             don't need the full output, call `mulligan_shrink` with a summary or `mulligan_rewind
             (granularity:\"last_tool_call_group\")` if the whole call was a mistake.' Copy it BYTE-FOR-BYTE
             (note: 'summary or' — no comma, unlike the old 'with a\\nsummary, or')."

# MUST READ — spec/07 §1 (the rendered-text authority in the merged PRD)
- docContext: selected_prd_content heading h3.50 ('renderBloatReminder(toolName, bytes)')
  why: The PRD block gives the canonical single-line text + the signature (toolName, bytes) + the
        '~30 tokens incurred once' note. This is the same text as the architecture note; cite either.
  critical: "READ-ONLY. The PRD block also confirms (h3.49 Mechanism) the call site is
             'renderBloatReminder(event.toolName, bytes)' — 2 args, no threshold passed. This is the
             post-edit shape of nudges.ts:133."

# CONTEXT — the TS/lint facts that make the bare-unused param safe (GOTCHA #1)
- file: tsconfig.json
  why: Confirms strict:true is set but noUnusedParameters / noUnusedLocals are NOT (those are separate
        compiler options, not part of 'strict'). So an unused, non-underscore param compiles clean.
  critical: "There is NO eslint config in the repo (eslint.config.* / .eslintrc* do not exist). So nothing
             else lints the unused param. Do NOT add an eslint-disable comment — there is no eslint."
```

### Current Codebase tree (the relevant slice)

```bash
src/
├── notes.ts              # ← EDIT: renderBloatReminder (JSDoc ~251 + fn ~278) — signature, body, JSDoc
└── nudges.ts             # ← EDIT: line 133 (the call site) — drop `threshold` arg
test/
├── notes.test.ts         # ← EDIT: renderBloatReminder test blocks (~410-477) + type test (641-642)
└── nudges.test.ts        # ← EDIT: line 291 (it name) + line 299 (3-arg call → 2-arg)
# READ-ONLY context:
plan/005_95d30743cdd4/architecture/m4_nudge_text_simplification.md   # target text authority
tsconfig.json            # strict:true, NO noUnusedParameters (makes bare toolName safe)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly four existing files (no creation, no deletion):
src/notes.ts     # renderBloatReminder: 2-arg signature + single-line body + rewritten JSDoc
src/nudges.ts    # line 133: renderBloatReminder(event.toolName, bytes)  (threshold arg dropped)
test/notes.test.ts   # renderBloatReminder tests: 2-arg calls + new single-line assertions
test/nudges.test.ts  # line 291 it-name + line 299 call: drop the threshold arg
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (bare-unused toolName is SAFE — verified, do not over-engineer):
//   The spec demands the param be named `toolName` (no `_` underscore) even though it is NOT interpolated
//   into the v1 text (reserved for future personalization). A bare-unused param normally trips
//   noUnusedParameters or @typescript-eslint/no-unused-vars. BOTH are off here: tsconfig.json has
//   strict:true but NOT noUnusedParameters/noUnusedLocals (verified), and there is NO eslint config in the
//   repo. So `toolName` compiles + lints clean as-is. DO NOT re-add the underscore (the spec names it
//   without one) and DO NOT add `void toolName;` or an eslint-disable comment. Just accept + don't use it.

// CRITICAL GOTCHA #2 (there are TWO test files, not one — the contract named only notes.test.ts):
//   test/nudges.test.ts:299 calls renderBloatReminder("read", OVER_BYTES, READ_THRESHOLD) with 3 args.
//   After the signature drops to 2 args, tsc FAILS: "Expected 2 arguments, but got 3." This is a
//   typecheck-blocking change the contract's "DOCS / call site" framing did not surface. You MUST edit
//   line 299 (drop READ_THRESHOLD) + line 291 (the it-name still says `renderBloatReminder(toolName,
//   bytes, threshold)`). grep-confirmed: these four files are the COMPLETE reference set — no others.

// CRITICAL GOTCHA #3 (the target text differs from the old text in more than "drop a line"):
//   The OLD body had a comma: "call `mulligan_shrink` with a\nsummary, or `mulligan_rewind(...)`".
//   The NEW body has NO comma + a single clause: "call `mulligan_shrink` with a summary or
//   `mulligan_rewind(granularity:\"last_tool_call_group\")`". Copy the new text BYTE-FOR-BYTE from the
//   architecture note / spec §1 — do not "diff-patch" the old string by eye. Also: the leading "\n---\n"
//   (markdown horizontal rule separator) is RETAINED; only the body after it changes.

// CRITICAL GOTCHA #4 (the threshold variable + gate are LOAD-BEARING — do not remove them):
//   In src/nudges.ts the `threshold` local (line 132) and the gate `if (bytes < threshold) return;`
//   (line 131) STAY. Only the ARGUMENT passed to renderBloatReminder changes. A common mistake is to
//   read "drop threshold" and delete the variable — that would make the nudge fire on EVERY result.

// GOTCHA #5 (one defensive test becomes meaningless and should be deleted, not rewritten):
//   The old "non-finite threshold → 'threshold 0 KB'" test (notes.test.ts:463) asserted on the THRESHOLD
//   clause. With no threshold rendered, that assertion is impossible. DELETE that one it block. The other
//   defensive cases (NaN/negative/Infinity BYTES → "~0 KB") STAY — just re-point them from "This result
//   is ~0 KB in your context (threshold 8 KB)." to "This result added ~0 KB to your context.".

// GOTCHA #6 (the "toolName not interpolated" test STILL HOLDS — keep it, just fix arity):
//   notes.test.ts:444-448 asserts renderBloatReminder("read", …) === renderBloatReminder("grep", …)
//   (identical output, no toolName in text). This invariant is UNCHANGED by the rewrite — toolName is
//   still accepted + still unused. Keep the test; drop the 3rd arg from both calls. The `not.toContain
//   ("read")` / `not.toContain("grep")` assertions still pass (the new text has neither substring).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no new data models. The only "structure" is the rewritten function body string. `bytesToKb`
(notes.ts:349, module-private) is reused as-is: `bytesToKb(8192)=8`, `bytesToKb(30720)=30`,
`bytesToKb(8704)=9`, and NaN/negative/Infinity → 0._

### The exact before → after (the task's core logic)

**`src/notes.ts` — the function (line 278):**

```ts
// BEFORE (current, 3 args + 4-line body):
export function renderBloatReminder(
  _toolName: string,
  bytes: number,
  thresholdBytes: number,
): string {
  const resultKb = bytesToKb(bytes);
  const thresholdKb = bytesToKb(thresholdBytes);
  const body = [
    `[mulligan] This result is ~${resultKb} KB in your context (threshold ${thresholdKb} KB).`,
    "If you don't need the full output going forward, call `mulligan_shrink` with a",
    'summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole',
    "call was a mistake. (The hidden/shrunk content stays on disk for the human.)",
  ].join("\n");
  return `\n---\n${body}`;
}

// AFTER (target, 2 args + single-line body — spec/07 §1 verbatim):
export function renderBloatReminder(toolName: string, bytes: number): string {
  const resultKb = bytesToKb(bytes);
  return `\n---\nThis result added ~${resultKb} KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:"last_tool_call_group")\` if the whole call was a mistake.`;
}
```

**`src/nudges.ts` — the call site (line 133):**

```ts
// BEFORE:
const reminder = renderBloatReminder(event.toolName, bytes, threshold);
// AFTER:
const reminder = renderBloatReminder(event.toolName, bytes);
```

> Rendered example for verification: with `bytes=8192`, the new return value is EXACTLY
> `"\n---\nThis result added ~8 KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:\"last_tool_call_group\")\` if the whole call was a mistake."`

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE renderBloatReminder in src/notes.ts (function body + signature)
  - EDIT the export at line 278: signature `(_toolName: string, bytes: number, thresholdBytes: number)`
    → `(toolName: string, bytes: number)` (GOTCHA #1: bare `toolName`, no underscore — safe).
  - REPLACE the body (the resultKb/thresholdKb/body/return 5 statements) with:
      const resultKb = bytesToKb(bytes);
      return `\n---\nThis result added ~${resultKb} KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:"last_tool_call_group")\` if the whole call was a mistake.`;
  - FOLLOW pattern: the module's renderer house style — leading "\n---\n" (markdown hr), no trailing
    newline, bytesToKb reused. (GOTCHA #3: byte-for-byte from the architecture note — "summary or", no comma.)
  - NAMING: `toolName` (spec signature), `bytes` (unchanged), `resultKb` (unchanged local).
  - PLACEMENT: same location (do not move the export; renderDriftNudge below it is untouched).

Task 2: REWRITE the renderBloatReminder JSDoc in src/notes.ts (the block starting ~line 251)
  - UPDATE the signature line in the prose + the FORMAT block + the token-cost note.
  - NEW FORMAT block (replace the 4-line [mulligan]/threshold/stays-on-disk block):
        FORMAT (spec/07 §1 — VERBATIM; leading "\n---\n" is a markdown horizontal rule; single line):
            \n---\nThis result added ~<KB> KB to your context. If you don't need the full output, call
            `mulligan_shrink` with a summary or `mulligan_rewind(granularity:"last_tool_call_group")` if
            the whole call was a mistake.
        <KB> = bytesToKb(bytes). NO [mulligan] prefix, NO threshold mention, NO "stays on disk" clause.
        NO trailing newline.
  - UPDATE the cost note: "~40 tokens" → "~30 tokens, incurred once per bloated result" (h3.50 says ~30).
  - UPDATE @param lines: drop `@param thresholdBytes`; rename `@param _toolName` → `@param toolName`
    with the same "ACCEPTED, NOT used in v1 text; reserved for future use" note (drop the "hence the `_`
    prefix" sentence — there is no prefix now; add: "named without underscore per spec/07 §1 signature;
    bare-unused is safe — no noUnusedParameters, no eslint (GOTCHA #1)").
  - PRESERVE: the "DEFENSIVE — NEVER throws (fail-open nudge handler; spec/07 §1; E13)" note + the
    "Non-finite/negative bytes render as 0 KB" sentence (drop only the "/or thresholdBytes" part).

Task 3: UPDATE the call site src/nudges.ts:133
  - EDIT line 133: `renderBloatReminder(event.toolName, bytes, threshold)` → `renderBloatReminder(event.toolName, bytes)`.
  - PRESERVE (GOTCHA #4): line 132 `const threshold = bloatThresholdFor(event.toolName, config);` and
    line 131 `if (bytes < threshold) return;` — UNCHANGED. The threshold still GATES firing.

Task 4: UPDATE test/notes.test.ts (the renderBloatReminder blocks)
  - Block 1 — describe('renderBloatReminder — spec/07 §1 pinned format') lines 410–449:
      * Drop the 3rd arg from ALL calls (412, 427, 432, 437, 444, 445): `renderBloatReminder("read", 8192)`
        etc.
      * Rewrite the pinned-format assertion (line 412, the `.toBe(...)`) to the new single-line string:
            "\n---\nThis result added ~8 KB to your context. If you don't need the full output, call
            `mulligan_shrink` with a summary or `mulligan_rewind(granularity:\"last_tool_call_group\")` if
            the whole call was a mistake."
      * Line 427 (30 KB): change the toContain from "[mulligan] This result is ~30 KB in your context
        (threshold 8 KB)." to "This result added ~30 KB to your context.".
      * Line 432 (rounding 8704→9): toContain "This result added ~9 KB to your context.".
      * Line 437 (VERBATIM body): rewrite to assert the new substrings — `call \`mulligan_shrink\` with a
        summary or` (note: "summary or", no comma/newline) + the granularity literal + assert the ABSENCE
        of removed phrases: expect(out).not.toContain("[mulligan]"); expect(out).not.toContain("threshold");
        expect(out).not.toContain("stays on disk").
      * Lines 444–448 (toolName not interpolated): KEEP the test logic (a===b for read vs grep, neither
        substring present); just drop the 3rd arg from both calls.
  - Block 2 — describe('renderBloatReminder — defensive …') lines 452–469:
      * Drop the 3rd arg from ALL calls (454, 457, 460, 463, 466, 467).
      * Lines 454/457/460 (NaN/negative/Infinity BYTES): re-point toContain from "This result is ~0 KB in
        your context (threshold 8 KB)." to "This result added ~0 KB to your context.".
      * Line 463 (non-finite THRESHOLD → "threshold 0 KB"): DELETE this it block (GOTCHA #5 — threshold no
        longer rendered, the assertion is impossible).
      * Lines 466–467 (never throws): KEEP (drop the 3rd arg; still pass NaN/NaN, -Infinity/Infinity).
  - Block 3 — describe('renderBloatReminder — snapshot-style') lines 471–477:
      * Drop the 3rd arg from the call (475). Rewrite the toMatchInlineSnapshot body to the new text:
            "
            ---
            This result added ~30 KB to your context. If you don't need the full output, call
            \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:\"last_tool_call_group\")\`
            if the whole call was a mistake."
        (GOTCHA #2: hand-write it; or run `npx vitest run -u` once to auto-write.)
  - Type test — lines 641–642: drop the 3rd arg: `expectTypeOf(renderBloatReminder("read", 8192)).toEqualTypeOf<string>();`.

Task 5: UPDATE test/nudges.test.ts (the cross-file reuse assertion — GOTCHA #2)
  - Line 291 (the it NAME): change "renderBloatReminder(toolName,bytes,threshold)" → "renderBloatReminder(toolName,bytes)".
  - Line 299 (the call): `renderBloatReminder("read", OVER_BYTES, READ_THRESHOLD)` → `renderBloatReminder("read", OVER_BYTES)`.
  - PRESERVE the test logic: it asserts `appended.text === renderBloatReminder(...)` byte-for-byte — that
    invariant is unchanged; only the arity of the reused call changes. No text-assertion edit needed here.

Task 6: VALIDATE
  - RUN: `npm run typecheck`   → expect exit 0 (catches any 3-arg call you missed — esp. nudges.test.ts).
  - RUN: `npx vitest run`      → expect full suite green, test COUNT unchanged (assertion rewrites only).
  - RUN scope guard: `git diff --name-only` → expect EXACTLY src/notes.ts, src/nudges.ts,
    test/notes.test.ts, test/nudges.test.ts (four files, nothing else).
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the renderer's house style (mirror the existing renderDriftNudge/renderNote JSDoc): a
// "FORMAT (spec/07 §N — VERBATIM)" block quoting the exact output, a "DEFENSIVE — NEVER throws" note,
// and @param lines. Keep that shape; only swap the quoted FORMAT text + drop the threshold param.

// PATTERN — byte-for-byte target text (do NOT hand-eyeball the diff). The single-line body is:
const TARGET_BODY =
  "This result added ~${resultKb} KB to your context. " +
  "If you don't need the full output, call `mulligan_shrink` with a summary or " +
  '`mulligan_rewind(granularity:"last_tool_call_group")` if the whole call was a mistake.';
// Note: it is ONE physical line in the source (the template literal has no embedded \n). The return is:
//   return `\n---\n${TARGET_BODY-with-resultKb-interpolated}`;
// CRITICAL: "summary or" (no comma). The OLD text was "with a\nsummary, or" (comma + newline). Easy to
// mis-transcribe — copy from the architecture note's "Target design → M4.T1" block.

// PATTERN — the "toolName not interpolated" test is a NEGATIVE-space test (asserts ABSENCE). After the
// rewrite it ALSO guards against accidentally interpolating toolName later:
//   const a = renderBloatReminder("read", 8192);
//   const b = renderBloatReminder("grep", 8192);
//   expect(a).toBe(b);
//   expect(a).not.toContain("read");
//   expect(a).not.toContain("grep");
// (identical regardless of toolName — still true post-rewrite.)

// CRITICAL — add an EXPLICIT regression guard for the removed phrases in the pinned-format block:
//   expect(out).not.toContain("[mulligan]");     // prefix removed
//   expect(out).not.toContain("threshold");      // threshold mention removed
//   expect(out).not.toContain("stays on disk");  // clause removed
// These three negative assertions are the "did you actually remove it" guard — they fail loudly if a
// future edit re-introduces any of the three. The contract lists all three as things to drop; pinning
// their absence turns the contract into an executable check.
```

### Integration Points

```yaml
NO NEW INTEGRATION POINTS — text + signature rewrite of a pure helper.
  - DATABASE: none
  - CONFIG: none (no knob added/removed; bloatThresholdBytes + bloatThresholdBytesByTool unchanged)
  - ROUTES: none
  - CODE: the threshold gate (src/nudges.ts:131) + bloatThresholdFor (src/nudges.ts) are UNCHANGED.
          Only the renderer's signature/body + the one argument dropped at the call site change.
  - TESTS: assertion rewrites in test/notes.test.ts (4 blocks) + arity fix in test/nudges.test.ts (1 call
           + 1 it-name). Test COUNT unchanged.
  - DOCS: [Mode A] — the JSDoc FORMAT block on renderBloatReminder IS the doc. NO separate .md file.
          README sync is sibling P1.M5.T1.* (do NOT touch README).
```

---

## Validation Loop

A pure-helper text rewrite cannot break runtime behavior, but it MUST typecheck (catches any missed
3-arg call) and the suite MUST stay green with the updated assertions. Run all levels.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The signature dropped to 2 args (grep the function declaration):
grep -nE 'export function renderBloatReminder\(' src/notes.ts
# Expected: a line matching  `export function renderBloatReminder(toolName: string, bytes: number): string {`

# (b) The new body is present (single line, "summary or", no comma):
grep -nF 'This result added ~' src/notes.ts
grep -nF 'with a summary or' src/notes.ts
# Expected: both hit (the body + its echo in the JSDoc FORMAT block).

# (c) The three removed phrases are GONE from the function (NOT from the file — the JSDoc may still
#     mention "no [mulligan] prefix" etc.; scope this to the FUNCTION body region, lines ~278-281):
sed -n '278,282p' src/notes.ts | grep -nE '\[mulligan\]|threshold|stays on disk' && echo "REGRESSION — removed phrase still in body" || echo "body clean"
# Expected: "body clean".

# (d) The call site dropped the 3rd arg:
grep -nF 'renderBloatReminder(event.toolName, bytes)' src/nudges.ts   # Expected: 1 match (line 133).
grep -nF 'renderBloatReminder(event.toolName, bytes, threshold)' src/nudges.ts && echo "OLD CALL STILL PRESENT" || echo "call site updated"
# Expected: "call site updated".

# (e) No remaining 3-arg call ANYWHERE (the typecheck-blocking risk — GOTCHA #2):
grep -rnE 'renderBloatReminder\([^)]*,[^)]*,[^)]*\)' src/ test/ && echo "STILL A 3-ARG CALL — typecheck will fail" || echo "all calls are 2-arg"
# Expected: "all calls are 2-arg".
```
Expected: all grep checks pass; no 3-arg call survives anywhere in src/ or test/.

### Level 2: Type-check (the strict gate — catches missed call sites)

```bash
npm run typecheck        # = tsc --noEmit (strict:true; tsconfig includes src + test)
echo "typecheck exit: $?"
# Expected: exit 0, NO output. If it errors, the #1 cause is a 3-arg call you missed (GOTCHA #2 — re-run
#           the Level 1(e) grep). The #2 cause is a stale JSDoc @param. READ the tsc output; fix the CALL,
#           not the signature (the 2-arg signature is the target).
```
Expected: exit 0.

### Level 3: Unit Tests (the rewritten assertions must pass)

```bash
# The renderer's own suite (the file with the bulk of the assertion rewrites):
npx vitest run test/notes.test.ts
# Expected: all pass. The renderBloatReminder blocks now assert the new single-line text + the negative
#           guards ([mulligan]/threshold/stays-on-disk absent). The deleted "non-finite threshold" case is
#           gone (test count in THIS file drops by 1 — that is expected for this file only).

# The handler suite (the cross-file reuse assertion — GOTCHA #2):
npx vitest run test/nudges.test.ts
# Expected: all pass. The "appended block is renderBloatReminder(...) EXACTLY" test now calls with 2 args
#           and still passes (it reuses the helper, so it tracks the new text automatically).

# Full suite (catches any cross-file surprise — there should be none beyond the two test files):
npx vitest run
# Expected: all files green. NET test count is UNCHANGED minus one (the deleted "non-finite threshold"
#           case). If the count changed by anything other than -1 (or if you chose to KEEP that case
#           rewritten instead of deleting it, ±0), scope leaked — re-check.
```
Expected: notes.test.ts green (−1 case); nudges.test.ts green; full suite green.

### Level 4: Behavior proof (manual reasoning — the contract's four OUTPUT points)

```bash
# Confirm the contract's OUTPUT (1) 2-arg signature, (2) new single-line text, (3) call site 2-arg,
# (4) bytesToKb + never-throws unchanged:
grep -nE 'export function renderBloatReminder\(toolName: string, bytes: number\)' src/notes.ts   # (1)
grep -nF 'This result added ~' src/notes.ts                                                      # (2)
grep -nF 'renderBloatReminder(event.toolName, bytes)' src/nudges.ts                             # (3)
grep -nF 'function bytesToKb' src/notes.ts                                                      # (4a) unchanged
grep -nE 'NEVER throws|never throws' src/notes.ts | head -1                                     # (4b) discipline preserved
# Expected: each line hits exactly once (bytesToKb may hit in JSDoc + decl — fine).
```
Expected: all four contract outputs verified.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
git -C . diff --name-only
# Expected: EXACTLY these four files:
#   src/notes.ts
#   src/nudges.ts
#   test/notes.test.ts
#   test/nudges.test.ts
git -C . diff --name-only | grep -vE '^(src/notes\.ts|src/nudges\.ts|test/notes\.test\.ts|test/nudges\.test\.ts)$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# Expected: "scope OK". renderDriftNudge (T2's scope), suppressCheck (T3's scope), README (M5's scope),
#           config, spec/*, package.json must NOT appear.
```
Expected: only the four listed files in the diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms the 2-arg signature, the new body, the three removed phrases absent from the
      function body, the updated call site, and NO 3-arg call anywhere in src/ or test/.
- [ ] Level 2: `npm run typecheck` exits 0 (strict mode clean).
- [ ] Level 3: `npx vitest run test/notes.test.ts` + `test/nudges.test.ts` pass; full `npx vitest run` green.
- [ ] Level 4: the four contract OUTPUT points verified (signature, text, call site, bytesToKb/never-throws).
- [ ] Level 5: `git diff --name-only` shows EXACTLY the four files.

### Feature Validation
- [ ] `renderBloatReminder(toolName, bytes)` renders the spec/07 §1 verbatim single-line text (leading
      `\n---\n`, no `[mulligan]` prefix, no threshold mention, no "stays on disk", no trailing newline).
- [ ] `toolName` is named WITHOUT underscore and is NOT interpolated (the "read" vs "grep" test still
      asserts identical output).
- [ ] `src/nudges.ts:133` passes 2 args; the `threshold` variable + the `if (bytes < threshold) return;`
      gate are unchanged (nudge still fires only over threshold).
- [ ] `bytesToKb` unchanged; NaN/negative/Infinity bytes still render as `~0 KB`; the renderer still
      never throws.
- [ ] test/notes.test.ts: pinned-format + defensive + snapshot + type tests all updated to 2-arg / new text;
      the "non-finite threshold" defensive case deleted; negative guards for the three removed phrases added.
- [ ] test/nudges.test.ts: the reuse test calls with 2 args + its `it` name updated.

### Code Quality / Scope Discipline
- [ ] The renderer's house style is preserved (leading `\n---\n`, no trailing newline, JSDoc FORMAT block,
      DEFENSIVE note, @param lines).
- [ ] The JSDoc cost note updated (~40 → ~30 tokens) + the FORMAT block quotes the new verbatim text.
- [ ] Did NOT touch `renderDriftNudge` (sibling T2's scope), `suppressCheck` (T3's scope), or README (M5).
- [ ] Did NOT delete the `threshold` variable or the gate in nudges.ts (GOTCHA #4).
- [ ] Did NOT re-add the `_` underscore to `toolName` or add an eslint-disable (GOTCHA #1 — none needed).

### Documentation
- [ ] [Mode A] satisfied: the JSDoc FORMAT block + signature on `renderBloatReminder` IS the doc.
- [ ] No separate `.md` doc file written; README not touched (sibling P1.M5.T1.* owns it).

---

## Anti-Patterns to Avoid

- ❌ Don't delete the `threshold` local or the `if (bytes < threshold) return;` gate in `src/nudges.ts`
  (GOTCHA #4). "Drop threshold" applies ONLY to the renderer's parameter + the call-site argument. The
  gate is what makes the nudge fire selectively — removing it fires it on every result.
- ❌ Don't forget `test/nudges.test.ts` (GOTCHA #2). It is NOT named in the item contract, but it calls
  `renderBloatReminder` with 3 args at line 299. A "single test file" mental model leaves a 3-arg call
  that FAILS `npm run typecheck`. grep-confirmed: the four files in this PRP are the COMPLETE reference set.
- ❌ Don't re-add the `_` underscore to `toolName` (GOTCHA #1). The spec names it without one; it compiles
  clean (no `noUnusedParameters`, no eslint). Adding `void toolName;` or an eslint-disable is noise.
- ❌ Don't hand-eyeball the text diff (GOTCHA #3). The old text had "with a\nsummary, or" (comma + newline);
  the new text has "with a summary or" (no comma, one line). Copy the target BYTE-FOR-BYTE from the
  architecture note's "Target design → M4.T1" block or spec/07 §1 (h3.50).
- ❌ Don't rewrite the "non-finite threshold → threshold 0 KB" defensive test (GOTCHA #5) — DELETE it.
  The threshold is no longer rendered, so the assertion is impossible. The bytes-side defensive cases
  (NaN/negative/Infinity → "~0 KB") STAY, re-pointed to the new text.
- ❌ Don't touch `renderDriftNudge` (T2), `suppressCheck` (T3), `renderHighWaterNudge`, `injectNudge`, or
  the README. This item is bloat-reminder render + call site ONLY.
- ❌ Don't add/remove a test to "balance" the count. The only intentional count change is −1 (the deleted
  threshold defensive case). Everything else is an assertion rewrite at the same `it`.
- ❌ Don't skip `npm run typecheck` because "it's just text." typecheck is the gate that catches a missed
  3-arg call site (the highest-probability failure mode of this task).

---

## Confidence Score

**9/10** for one-pass implementation success. This is a surgical text + signature rewrite of one pure
helper with a single production call site and two test files. Every fact needed is verified: the exact
current function body (so the `edit` oldText is unambiguous), the exact target text (spec/07 §1 /
architecture note, byte-for-byte), the COMPLETE call/test reference set (grep-confirmed — four files, no
others), and the two validation gates (`npm run typecheck` strict; `npx vitest run`). The two highest-
value gotchas are explicitly flagged: GOTCHA #1 (bare-unused `toolName` is safe — tsconfig/lint verified)
and GOTCHA #2 (`test/nudges.test.ts` is a second test file the contract omitted but typecheck requires).
The residual uncertainty is the implementer's choice on the inline snapshot (hand-write vs `vitest -u`)
and whether to keep vs delete the threshold defensive case (the PRP recommends delete; either is
defensible) — both are stylistic and fully specified, hence not 10/10.