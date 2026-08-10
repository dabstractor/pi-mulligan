# PRP — P1.M2.T1.S2: Terse result + ctx.ui.notify echo (mulligan_shrink)

## Goal

**Feature Goal**: Make `mulligan_shrink`'s tool result terse (per spec/05 §2 return shape) and surface the
extracted replacement to the human operator via `ctx.ui.notify` — a pure UI side-channel that is **never**
added to the model's context. Today the result is verbose ("…Matched message will show the replacement
from the next turn on. (Matched now: …)") and there is **no** operator echo of the replacement at all
(the model's own summary never reaches the human unless echoed, but echoing in the result would re-enter
the model's context and defeat the tool's purpose). The fix: terse result + a zero-context-cost notify.

**Deliverable**: Edits to **two files**:
1. `src/tools/shrink.ts` — (a) terse `feedbackText(matched)`; (b) a `ctx.ui.notify` echo block (own
   try/catch, E13) inserted after `appendShrinkMarker` and before the return; (c) a `cap(s,n)` helper;
   (d) a `describeTarget(target)` helper.
2. `test/tools/shrink.test.ts` — extend `makeCtx` with a `ui` fake + `hasUI` flag + `notifyCalls[]`
   capture, AND update the **11 existing assertions** that hardcode the OLD verbose feedback text (they
   break as a direct consequence of change (a)).

**Success Definition**: After the edit, (a) `shrinkExecute` returns `Mulligan: shrink recorded. Matched: yes|no.`
(terse) and the result body contains **no** copy of the replacement; (b) when `ctx.hasUI` is true,
`ctx.ui.notify` is called once with `Shrunk <desc> — replacement:\n<<<\n<capped>\n>>>` at `"info"`; when
`hasUI` is false, notify is NOT called; (c) a UI failure inside the notify block does NOT break the tool
(marker already persisted → result still returns); (d) `npx vitest run` passes all tests green (the 11
broken assertions fixed); (e) `npx tsc --noEmit` passes (given S1 applied).

> ⚠️ **Cross-item dependency (S2 → S1)**: this PRP references `config.shrink.notifyMaxChars`, which
> sibling **P1.M2.T1.S1** adds to `MulliganConfig.shrink` (default **2048**, validated). Both type-
> correctness (`config.shrink.notifyMaxChars` exists on the type) and runtime correctness (cap receives a
> real number) REQUIRE S1 to be applied. The two items touch **disjoint files** (S1 = `src/config.ts` +
> `test/config.ts`; S2 = `src/tools/shrink.ts` + `test/tools/shrink.test.ts`) → no merge conflict. The
> `feedbackText` terse change and the 11 assertion fixes are independent of S1 but live in S2's files.
> **Assume S1 is applied** (per parallel_execution_context).

## User Persona (if applicable)

**Target User**: The human operator (developer using Pi in TUI/RPC mode) watching tool results in the UI.

**Use Case**: The model calls `mulligan_shrink` to replace a 9k-token log with a one-line summary. The
operator wants to **see** what summary the model wrote (to trust/audit it) WITHOUT that summary being
re-injected into the model's context (which would defeat the shrink). `ctx.ui.notify` is the only channel
that shows the human at zero token cost.

**Pain Points Addressed**: Today the replacement is invisible to the operator (only persisted for the
filter to apply next turn). The verbose result text wastes context. spec/05 §2 step 5 makes the notify a
**REQUIRED** behavior; this PRP implements it.

## Why

- **spec/05 §2 step 5 (REQUIRED behavior)**: "Notify the operator at zero context cost" — the PRD
  explicitly mandates `ctx.ui.notify` after persisting. Without it the operator is blind to what the
  model told itself.
- **Zero-extra-context invariant (spec §3.1/h3.56)**: `ctx.ui.notify` is the **only** user-facing channel
  that never enters the model's context. Echoing in the result or via `pi.sendMessage` would both re-enter
  context and defeat the tool. Hence: result stays terse, echo goes to `ctx.ui`.
- **E13 robustness**: the notify is wrapped in its own try/catch so a UI failure can never break the tool
  (the marker is already persisted by the time notify runs — failing the tool would lose nothing and risk
  confusing the model into retrying).
- **Aligns the codebase with spec**: the current verbose `feedbackText` predates the spec's terse return
  shape; this makes the implementation match the spec verbatim.

## What

Three production changes in `src/tools/shrink.ts` + two test changes in `test/tools/shrink.test.ts`.

### Production changes (shrink.ts)

**(a) Terse `feedbackText`** (lines 143–149) — change the returned string AND its now-stale JSDoc:
```ts
// BEFORE (JSDoc 140–142 + fn 143–149):
/**
 * feedbackText — the spec/05 §2 VERBATIM feedback text with the yes/no slot filled from the best-effort
 * match. Copy verbatim incl. the "from the next turn on" clause and the `(Matched now: yes|no)` slot.
 */
function feedbackText(matched: boolean): string {
  return `Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: ${
    matched ? "yes" : "no"
  })`;
}
// AFTER:
/**
 * feedbackText — the spec/05 §2 VERBATIM TERSE feedback text with the yes/no slot filled from the
 * best-effort match. The replacement is NOT echoed here (echoing re-enters the model's context,
 * defeating the tool) — the operator sees it via ctx.ui.notify (behavior step 5b) at zero context cost.
 */
function feedbackText(matched: boolean): string {
  return `Mulligan: shrink recorded. Matched: ${matched ? "yes" : "no"}.`;
}
```

**(b) Notify echo block** — insert AFTER `} satisfies ShrinkMarkerInput);` (line 295) and BEFORE the
`// (6) return` comment (line 296):
```ts
    } satisfies ShrinkMarkerInput);

    // (5b) operator echo (spec/05 §2 step 5 — zero context cost; the replacement is NOT in the tool result).
    try {
      if (ctx.hasUI) {
        const capped = cap(params.replacement, config.shrink.notifyMaxChars);
        ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
      }
    } catch {
      // E13: a UI failure must never break the tool — the marker is already persisted.
    }

    // (6) return (spec/05 §2 step 5) — feedback text (yes/no from the best-effort match) + details.
```

**(c) + (d) `cap` and `describeTarget` helpers** — add in the module-private helpers region (right after
`feedbackText`, alongside `isNonEmpty` / `targetIsStructurallyValid`):
```ts
/**
 * cap — truncate a string to `max` chars for UI ergonomics (NOT context — ctx.ui.notify is zero-cost).
 * Over-cap, append `…(<N> chars total)`. Defensive typeof mirrors isNonEmpty (never throws).
 */
function cap(s: string, max: number): string {
  if (typeof s !== "string" || s.length <= max) return s;
  return s.slice(0, max) + `…(${s.length} chars total)`;
}

/**
 * describeTarget — a brief human description of the shrink target, for the ctx.ui.notify toast.
 * 'tool call <id>' / '<toolName> result' / 'message containing "<substr>"' / 'message'.
 */
function describeTarget(target: ShrinkArgs["target"]): string {
  if (!target || typeof target !== "object") return "message";
  if ("by_tool_call_id" in target) return `tool call ${target.by_tool_call_id}`;
  if ("by_tool_name" in target) return `${target.by_tool_name} result`;
  if ("by_content_includes" in target) return `message containing "${target.by_content_includes.slice(0, 40)}"`;
  return "message";
}
```

### Test changes (shrink.test.ts)

**(e) Extend `makeCtx`** — add `hasUI?: boolean` (default **true**), a `ui` fake, and return `notifyCalls`:
```ts
// CURRENT: makeCtx(opts) → { ctx: { sessionManager } as unknown as ExtensionContext }
// TARGET:  makeCtx(opts & { hasUI?: boolean }) → { ctx, notifyCalls }
function makeCtx(opts: { /* existing opts... */ hasUI?: boolean } = {}) {
  const notifyCalls: { message: string; type?: string }[] = [];
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: { notify(message: string, type?: string) { notifyCalls.push({ message, type }); } },
    sessionManager: { /* ...existing sessionManager fake unchanged... */ },
    // ...any other existing ctx fields unchanged...
  };
  return { ctx: ctx as unknown as ExtensionContext, notifyCalls };
}
```
This is **additive** — existing `const { ctx } = makeCtx(...)` consumers are unaffected (they ignore
`notifyCalls`). After S2, every passing-shrink test also pushes one notify entry (harmless; only S3
asserts on it).

**(f) Fix the 11 broken assertions** (S2's terse `feedbackText` makes them fail). Exact replacements:
- **L275–277** (one exact `.toBe`):
  - `.toBe("Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: yes)")`
  - → `.toBe("Mulligan: shrink recorded. Matched: yes.")`
- **6×** `.toContain("(Matched now: yes)")` at **L311, L323, L334, L417, L479, L500**
  - → `.toContain("Matched: yes")`
- **4×** `.toContain("(Matched now: no)")` at **L255, L436, L449, L458**
  - → `.toContain("Matched: no")`

> Why `.toContain("Matched: yes")` is valid: the terse string `Mulligan: shrink recorded. Matched: yes.`
> contains the substring `Matched: yes`. Only one feedback string is ever produced, so no false-positive.

### Success Criteria

- [ ] `feedbackText(matched)` returns exactly `Mulligan: shrink recorded. Matched: ${matched?"yes":"no"}.`
      (terse; trailing period; no "from the next turn on" clause; no parenthesized "Matched now").
- [ ] The tool result `content[0].text` does NOT contain the replacement string (echo is via notify only).
- [ ] After `appendShrinkMarker`, before the return, a `try { if (ctx.hasUI) { … ctx.ui.notify(…, "info") } } catch {}` block exists.
- [ ] `cap` + `describeTarget` exist as module-private functions in the helpers region.
- [ ] `makeCtx` returns `{ ctx, notifyCalls }` with `ctx.hasUI` (default true) and `ctx.ui.notify` capturing.
- [ ] All 11 verbose-text assertions updated; `npx vitest run` passes (green).
- [ ] `npx tsc --noEmit` passes (given S1 applied — `config.shrink.notifyMaxChars` typechecks).
- [ ] No file other than `src/tools/shrink.ts` and `test/tools/shrink.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current `feedbackText` (+ its stale JSDoc), the exact persist+return
block with line numbers, the verbatim insertions (notify block + both helpers), the verified Pi API
signatures (`ctx.ui.notify`/`ctx.hasUI` with types.d.ts line cites), the exact 11 broken assertions with
line numbers and exact replacements, the `makeCtx` current-vs-target shapes, the confirmed in-scope
variables (`config`, `params.replacement`, `params.target`, `ctx`, `matched`), the cross-item dependency
on S1, and deterministic validation commands. The implementer needs no exploration beyond opening the two
files.

### Documentation & References

```yaml
# MUST READ — the file being edited (production)
- file: src/tools/shrink.ts
  why: (1) feedbackText at lines 143–149 (+ stale JSDoc 140–142) → make terse + fix JSDoc.
        (2) persist+return block lines 289–300 → insert notify block after `} satisfies ShrinkMarkerInput);` (L295).
        (3) helpers region after feedbackText → add cap() + describeTarget().
  pattern: "module-private pure helpers (isNonEmpty, targetIsStructurallyValid) live after feedbackText;
            never throw; defensive typeof guards. cap/describeTarget follow the SAME style."
  gotcha: "config (L262 `const config = getConfig()`), params.replacement, params.target, ctx, matched are ALL
           in scope at the insertion point. config.shrink.notifyMaxChars is S1's output (default 2048)."

# MUST READ — the file being edited (tests)
- file: test/tools/shrink.test.ts
  why: (1) makeCtx currently returns {ctx:{sessionManager}} with NO ui/hasUI → extend it (additive).
        (2) 11 assertions hardcode the OLD verbose feedback text → S2's terse change BREAKS them → must fix.
  pattern: "vitest, hand-rolled fakes (NO vi.fn), .js imports, clearAll() before/after each, expectTypeOf for types."
  critical: "Line numbers of the 11 broken assertions: .toBe verbose at L275–277; toContain '(Matched now: yes)'
             at L311,L323,L334,L417,L479,L500; toContain '(Matched now: no)' at L255,L436,L449,L458. Replace per
             the 'Test changes (f)' table above. Do NOT add NEW notify/cap tests — those are S3."

# MUST READ — verified Pi API research (this PRP's source of truth for the notify design)
- file: plan/005_95d30743cdd4/architecture/m2_shrink_operator_echo.md
  why: "Verified Pi API surfaces table (ctx.ui.notify signature, ctx.hasUI) + the EXACT terse feedbackText,
        notify block, cap, describeTarget, and makeCtx target shapes. This PRP reproduces them verbatim."
  critical: "§'Verified Pi API surfaces' cites types.d.ts:76 (notify) and :215 (hasUI). §'Target design' gives
             the canonical implementations — follow them exactly (incl. the U+2026 ellipsis and '(N chars total)'
             suffix in cap, and the .slice(0,40) in describeTarget)."

# MUST READ — the sibling contract (config knob this PRP consumes)
- file: plan/005_95d30743cdd4/P1M2T1S1/PRP.md
  why: CONTRACT. S1 adds `notifyMaxChars: number` (default 2048, validated, REQUIRED) to MulliganConfig.shrink
        in src/config.ts. This PRP reads it as `config.shrink.notifyMaxChars`. S1 touches ONLY src/config.ts
        + test/config.ts → zero file overlap with S2 (src/tools/shrink.ts + test/tools/shrink.test.ts).
  critical: "S2's cap/notify correctness REQUIRES S1 applied (else TS error + runtime undefined). Assume S1 done.
             Do NOT edit config.ts (S1 owns it); do NOT add notifyMaxChars config-validation tests (S3 owns them)."

# CONTEXT — the spec this implements
- docfile: spec/05-tools.md
  why: "§2 mulligan_shrink → 'Return shape' (terse, replacement NOT echoed) + 'Behavior' step 5 (ctx.ui.notify
        REQUIRED, zero context cost, cap at notifyMaxChars default 2048, over-cap append '(N chars total)')."
  section: "h2.57 (2. mulligan_shrink) → Return shape + Behavior step 5."

# CONTEXT — the E13 error case the notify try/catch defends against
- docfile: spec/12-edge-cases-and-error-handling.md
  why: "E13 'Tool throws internally' — the notify's own try/catch ensures a UI failure is swallowed (marker
        already persisted) so the tool still returns its terse result."
  section: "h2.93 E13."

# EXTERNAL — the Pi API surfaces (confirmed against the installed package)
- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: "L68 ExtensionUIContext; L76 notify(message:string, type?:'info'|'warning'|'error'):void;
        L209 ExtensionContext; L211 ui:ExtensionUIContext; L215 hasUI:boolean. Confirms ctx exposes both."
  critical: "notify's type param is the LITERAL union 'info'|'warning'|'error' — pass \"info\" (lowercase).
             notify returns void (fire-and-forget). hasUI is a plain boolean (truthy in TUI+RPC, falsy in print/JSON)."
```

### Current Codebase tree (the relevant slice)

```bash
src/tools/
├── shrink.ts              # ← THIS PRP edits: feedbackText (terse) + notify block + cap + describeTarget
└── (rewind.ts, checkpoint.ts, audit.ts, cancel.ts — READ-ONLY, out of scope)
src/
├── config.ts              # READ-ONLY for S2 — S1 adds notifyMaxChars here (S2 CONSUMES it)
├── markers.ts             # READ-ONLY — appendShrinkMarker (unchanged; called by S2's persist step)
└── transforms.ts          # READ-ONLY — resolveShrinkTarget/ShrinkTarget/MessageLike (unchanged imports)
test/tools/
└── shrink.test.ts         # ← THIS PRP edits: makeCtx (ui fake + hasUI + notifyCalls) + 11 assertion fixes
test/
└── config.ts              # READ-ONLY for S2 — S1's territory (notifyMaxChars validation tests = S3)
spec/
└── 05-tools.md            # READ-ONLY — the spec this implements (h2.57 shrink return shape + behavior step 5)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/tools/shrink.ts        # +terse feedbackText (+JSDoc) ; +notify echo block ; +cap() ; +describeTarget()
test/tools/shrink.test.ts  # +makeCtx ui/hasUI/notifyCalls ; 11 verbose-text assertions → terse form
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (S2's terse change BREAKS 11 existing test assertions): the current shrink.test.ts
//   hardcodes the OLD verbose feedback string in 11 places (1 exact .toBe + 6 toContain yes + 4 toContain no).
//   If S2 changes feedbackText but does NOT update these, `npx vitest run` goes RED. Updating them is S2's
//   job (direct consequence of S2's own change) — NOT S3's (S3 adds NEW notify/cap/config tests). See the
//   exact line numbers + replacements in "Test changes (f)".

// CRITICAL GOTCHA #2 (config.shrink.notifyMaxChars REQUIRES S1): S2 reads config.shrink.notifyMaxChars.
//   S1 adds that field (default 2048). Without S1: (type) `npx tsc --noEmit` fails on the missing property;
//   (runtime) cap receives undefined → slice(0,undefined)==="" → empty replacement shown. Assume S1 applied.
//   Do NOT add the field yourself (S1 owns config.ts) and do NOT add config-validation tests (S3 owns them).

// CRITICAL GOTCHA #3 (notify gets its OWN try/catch, not just the outer one): shrinkExecute's body is
//   already inside one outer try/catch (E13→refusal). But spec/05 §2 + the contract require the notify to
//   have its OWN inner try/catch so a UI failure is silently swallowed AND the intent is self-documenting.
//   Do NOT rely on the outer catch alone — add the dedicated `try {...} catch { /* E13 */ }` around notify.

// CRITICAL GOTCHA #4 (notify type param is the LITERAL union, lowercase): ctx.ui.notify(msg, "info") —
//   the 2nd arg type is "info"|"warning"|"error" (types.d.ts:76). Pass the string literal "info" (lowercase).
//   NOT "INFO", NOT a number, NOT omitted (omitting defaults to info but the contract passes "info" explicitly).

// CRITICAL GOTCHA #5 (the em-dash + the `<<<\n…\n>>>` fence in the notify message): the notify message uses
//   a real em-dash "—" (U+2014) between `<desc>` and "replacement:", and wraps the capped replacement in
//   `<<<\n` … `\n>>>`. Reproduce VERBATIM (the operator/UI may parse or highlight the fence). The file is UTF-8.
//   cap's ellipsis is U+2026 "…". Both are fine in a TS source string.

// CRITICAL GOTCHA #6 (makeCtx change must be ADDITIVE, not breaking): makeCtx currently returns {ctx}.
//   Adding notifyCalls makes it {ctx, notifyCalls}. Existing tests do `const { ctx } = makeCtx(...)` and
//   ignore notifyCalls → safe. Do NOT change the `ctx` field's shape (keep sessionManager + any other fields);
//   only ADD hasUI + ui. Default hasUI to TRUE (contract MOCKING: "hasUI flag (default true)").

// CRITICAL GOTCHA #7 (after S2, passing-shrink tests push a notify entry): because hasUI defaults true and
//   the notify block runs after persist, every existing test that reaches the return now also calls notify
//   once. This is HARMLESS — existing tests ignore notifyCalls. Do NOT add `expect(notifyCalls)...` to existing
//   tests (that's S3's new-test territory). Just let it be captured.

// CRITICAL GOTCHA #8 (describeTarget type = ShrinkArgs["target"], the RAW 3-arm union): describeTarget takes
//   the UNRESOLVED target discriminator (params.target), NOT the resolved ShrinkTarget. Use the indexed access
//   type `ShrinkArgs["target"]`. The 3 arms: {by_tool_call_id} | {by_tool_name,occurrence} | {by_content_includes}.
//   The `"x" in target` discriminators correctly narrow TS to each arm (so target.by_tool_call_id typechecks).

// CRITICAL GOTCHA #9 (.js import extensions): shrink.ts uses ESM/Bundler resolution — imports end in `.js`
//   (e.g. `from "../markers.js"`). S2 adds NO new imports (cap/describeTarget use only string ops + the
//   already-imported ShrinkArgs type), so this gotcha is just "don't accidentally add a bare import".

// OUT OF SCOPE (do NOT touch in this subtask):
#   - src/config.ts → S1 (notifyMaxChars knob). S2 only CONSUMES config.shrink.notifyMaxChars.
#   - test/config.ts → S1/S3 (notifyMaxChars validation tests = S3).
#   - NEW notify-echo tests (hasUI true/false, cap truncation, E13 ui-throws) → S3. S2 only fixes the 11
#     assertions its OWN feedbackText change breaks + the makeCtx ui-fake infra.
#   - ShrinkParams schema, SHRINK_DESC, targetIsStructurallyValid, resolveTargetEntryId, appendShrinkMarker
#     call, ShrinkDetails, the outer try/catch → all UNCHANGED.
#   - Any other tool (rewind/checkpoint/audit/cancel) → out of scope.
# This PRP edits ONLY src/tools/shrink.ts + test/tools/shrink.test.ts.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data-model change. `ShrinkArgs["target"]` (the 3-arm union) and `ShrinkDetails` already exist;
`describeTarget` only reads them. `cap`/`describeTarget` are pure string functions. The notify payload is
a template string, not a persisted structure (it goes to the UI, never the session)._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/shrink.ts — make feedbackText terse (+ fix its stale JSDoc)
  - LOCATE feedbackText (lines 143–149) + its JSDoc (lines 140–142).
  - FIND (verbatim, the JSDoc + fn):
      " * feedbackText — the spec/05 §2 VERBATIM feedback text with the yes/no slot filled from the best-effort\n * match. Copy verbatim incl. the \"from the next turn on\" clause and the `(Matched now: yes|no)` slot.\n */\nfunction feedbackText(matched: boolean): string {\n  return `Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: ${\n    matched ? \"yes\" : \"no\"\n  })`;\n}"
  - REPLACE WITH: the terse JSDoc + `return \`Mulligan: shrink recorded. Matched: ${matched ? "yes" : "no"}.\`;`
    (see "Production changes (a)" for the exact block).
  - RATIONALE: spec/05 §2 return shape. The replacement is NOT echoed (echoing re-enters context).
  - DO NOT: echo the replacement here; keep it a pure function of `matched`.

Task 2: EDIT src/tools/shrink.ts — add cap() + describeTarget() in the helpers region
  - LOCATE the helpers region (immediately after feedbackText, alongside isNonEmpty/targetIsStructurallyValid).
  - ADD the two module-private functions from "Production changes (c)+(d)" verbatim.
  - RATIONALE: cap truncates the replacement for UI ergonomics at config.shrink.notifyMaxChars (over-cap →
    "…(N chars total)"); describeTarget renders a brief human target description for the toast.
  - GOTCHA: cap uses U+2026 ellipsis; describeTarget uses ShrinkArgs["target"] indexed type + `"x" in target`
    discriminators; both are defensive (typeof guards) like isNonEmpty.

Task 3: EDIT src/tools/shrink.ts — insert the ctx.ui.notify echo block after persist, before return
  - LOCATE the persist+return block (lines 289–300). The persist ends at `} satisfies ShrinkMarkerInput);` (L295).
  - FIND (verbatim):
      "    } satisfies ShrinkMarkerInput);\n\n    // (6) return (spec/05 §2 step 5) — feedback text (yes/no from the best-effort match) + details."
  - REPLACE WITH: the same `} satisfies ShrinkMarkerInput);` + a blank line + the notify try/catch block
    (see "Production changes (b)") + a blank line + the (6) return comment.
  - RATIONALE: spec/05 §2 behavior step 5 — operator echo at ZERO context cost (ctx.ui.notify is never added
    to the model's context). Own try/catch = E13 isolation (UI failure never breaks the tool).
  - GOTCHA: uses `config.shrink.notifyMaxChars` (S1), `params.replacement`, `params.target`, `ctx.hasUI`,
    `ctx.ui.notify`. All in scope at this point. Pass "info" (lowercase literal) as the notify type.

Task 4: EDIT test/tools/shrink.test.ts — extend makeCtx with ui fake + hasUI + notifyCalls
  - LOCATE makeCtx (returns { ctx: { sessionManager } as unknown as ExtensionContext }).
  - ADD `hasUI?: boolean` to the opts type (default true); build `notifyCalls: {message:string;type?:string}[]`;
    add `hasUI: opts.hasUI ?? true` + `ui: { notify(m,t){ notifyCalls.push({message:m, type:t}); } }` to the
    ctx object; return `{ ctx: ctx as unknown as ExtensionContext, notifyCalls }`.
  - PRESERVE: the existing `ctx.sessionManager` fake and any other existing ctx fields UNCHANGED.
  - GOTCHA: additive return — existing `const { ctx } = makeCtx(...)` consumers still work (ignore notifyCalls).

Task 5: EDIT test/tools/shrink.test.ts — fix the 11 verbose-text assertions (S2's text change broke them)
  - L275–277: `.toBe("Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: yes)")`
    → `.toBe("Mulligan: shrink recorded. Matched: yes.")`
  - L311, L323, L334, L417, L479, L500: `.toContain("(Matched now: yes)")` → `.toContain("Matched: yes")`
  - L255, L436, L449, L458: `.toContain("(Matched now: no)")` → `.toContain("Matched: no")`
  - RATIONALE: S2's terse feedbackText (Task 1) makes these fail. Fixing them keeps the suite green.
  - DO NOT: add NEW notify/cap/E13 assertions (S3 owns those) or change any non-feedback assertion.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: module-private pure helper (matches isNonEmpty/targetIsStructurallyValid) — never throws,
// defensive typeof guard, placed in the helpers region after feedbackText.
function cap(s: string, max: number): string {
  if (typeof s !== "string" || s.length <= max) return s;
  return s.slice(0, max) + `…(${s.length} chars total)`;
}

// PATTERN: target-discriminator narrowing via `"x" in target` (TS narrows each arm so field access typechecks).
function describeTarget(target: ShrinkArgs["target"]): string {
  if (!target || typeof target !== "object") return "message";
  if ("by_tool_call_id" in target) return `tool call ${target.by_tool_call_id}`;
  if ("by_tool_name" in target) return `${target.by_tool_name} result`;
  if ("by_content_includes" in target) return `message containing "${target.by_content_includes.slice(0, 40)}"`;
  return "message";
}

// PATTERN: isolated UI side-effect with E13 defense (own try/catch, AFTER persist so marker is safe).
try {
  if (ctx.hasUI) {
    const capped = cap(params.replacement, config.shrink.notifyMaxChars);
    ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
  }
} catch {
  /* E13: UI failure must never break the tool */
}

// PATTERN: additive test-fake extension (makeCtx gains notifyCalls without breaking existing destructure).
const notifyCalls: { message: string; type?: string }[] = [];
const ctx = { hasUI: opts.hasUI ?? true, ui: { notify(m, t) { notifyCalls.push({ message: m, type: t }); } },
              sessionManager: { /* unchanged */ } };
return { ctx: ctx as unknown as ExtensionContext, notifyCalls };
```

### Integration Points

```yaml
NO PERSISTENCE/CONFIG/ROUTE INTEGRATION — this is a tool-result + UI-side-effect change (Mode A).
  - DATABASE/session: none (the marker is already persisted by appendShrinkMarker BEFORE notify; notify
        is fire-and-forget to the UI and is NEVER appended to the session — zero context cost).
  - CONFIG: CONSUMES config.shrink.notifyMaxChars (S1's output, default 2048). S2 does NOT add it.
  - ROUTES: none.
  - UI: ADDS a ctx.ui.notify("info") call, guarded by ctx.hasUI. This is the only integration surface.
  - CODE: src/tools/shrink.ts (edited) + test/tools/shrink.test.ts (edited). S1 edits disjoint files
          (config.ts, test/config.ts) → no conflict. S3 will add NEW tests to shrink.test.ts (notify/cap)
          and config.ts-validation tests → S2 leaves room (does not pre-write them).
```

---

## Validation Loop

A tool-result + UI-side-effect change. Validation = type-check + full vitest suite (the 11 fixed assertions
must stay green; no existing test regresses) + a targeted behavioral check of the terse result and notify.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (given S1 applied — config.shrink.notifyMaxChars typechecks).
# Before S2: passes (assuming S1). After S2: must STILL pass (no new TS errors from the edits).
npx tsc --noEmit
echo "tsc exit: $?"   # expect 0

# Confirm the terse feedbackText and the notify block are present:
grep -n "Mulligan: shrink recorded. Matched:" src/tools/shrink.ts         # expect ≥1 hit (the terse return)
grep -n "ctx.ui.notify" src/tools/shrink.ts                              # expect 1 hit (the echo)
grep -n "function cap\|function describeTarget" src/tools/shrink.ts      # expect 2 hits
grep -n "hasUI" src/tools/shrink.ts                                      # expect 1 hit (the guard)
```
Expected: `npx tsc --noEmit` exits 0; the greps print the expected hits.

### Level 2: Unit Tests (Component Validation)

```bash
# The shrink suite specifically (the file touched) — MUST be green after the 11 assertion fixes.
npx vitest run test/tools/shrink.test.ts
# Expected: ALL tests pass. The 11 formerly-broken assertions now match the terse text. If ANY fail, read
# the diff — it's either a missed assertion (there are exactly 11; re-check the line list) or a notify
# block that threw into the outer catch (check makeCtx's ui fake is wired).

# Full suite — regression guard (S2 changes only shrink.ts + shrink.test.ts).
npx vitest run
# Expected: full suite passes (the same count as before S2). If a NON-shrink test fails, S2 accidentally
# touched something beyond scope — re-check.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. The "system" validation IS Level 2 (the tool behaves under the real
# execute path with a faked ctx). For a live TUI smoke (optional, manual): run the extension, invoke
# mulligan_shrink, and confirm (a) the tool result shows only "Mulligan: shrink recorded. Matched: yes."
# and (b) a UI toast shows "Shrunk <desc> — replacement:\n<<<\n<replacement>\n>>>".
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral spot-checks the implementer can run as one-off vitest `it()` blocks (these are EXACTLY the
# kind of NEW tests S3 will formalize — do NOT commit them here; use them only to self-verify, then delete
# or leave for S3). They prove the three behaviors this PRP adds:
#
# (1) hasUI=true → notify called once, type "info", message fences the replacement:
#     const { ctx, notifyCalls } = makeCtx({ contextEntries: [msgEntry("toolResult", toolResult("call-A","read","big"))] });
#     const { pi } = makePi();
#     await run(pi, ctx, { target:{by_tool_call_id:"call-A"}, replacement:"summary" });
#     assert notifyCalls.length===1 && notifyCalls[0].type==="info" && notifyCalls[0].message.includes("<<<\nsummary\n>>>");
#
# (2) hasUI=false → notify NOT called (guard works):
#     const { ctx, notifyCalls } = makeCtx({ hasUI:false, contextEntries:[...] });
#     await run(pi, ctx, { target:{...}, replacement:"x" });
#     assert notifyCalls.length===0;
#
# (3) result does NOT contain the replacement (zero-context-cost invariant):
#     const res = await run(pi, ctx, { target:{...}, replacement:"SECRET-SUMMARY" });
#     assert !firstText(res).includes("SECRET-SUMMARY");
#
# (4) cap truncates a long replacement at notifyMaxChars (default 2048) with the "(N chars total)" suffix:
#     const long = "x".repeat(3000);
#     await run(pi, ctx, { target:{...}, replacement:long });
#     assert notifyCalls[0].message.includes("chars total)"); assert !notifyCalls[0].message.includes("x".repeat(2048));
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` exits 0 (given S1 applied — `config.shrink.notifyMaxChars` typechecks).
- [ ] `npx vitest run test/tools/shrink.test.ts` — all shrink tests pass (the 11 fixed assertions green).
- [ ] `npx vitest run` — full suite passes (no regression outside shrink).

### Feature Validation
- [ ] `feedbackText(matched)` returns `Mulligan: shrink recorded. Matched: ${matched?"yes":"no"}.` (terse).
- [ ] The tool result `content[0].text` does NOT contain the replacement string.
- [ ] After `appendShrinkMarker`, a `try { if (ctx.hasUI) { cap + ctx.ui.notify(..., "info") } } catch {}` block exists.
- [ ] `cap` + `describeTarget` exist as module-private functions in the helpers region.
- [ ] `makeCtx` returns `{ ctx, notifyCalls }` with `ctx.hasUI` (default true) + `ctx.ui.notify` capturing.
- [ ] All 11 verbose-text assertions updated to the terse form (1 `.toBe` + 6 `.toContain("Matched: yes")` + 4 `.toContain("Matched: no")`).

### Code Quality / Scope Discipline
- [ ] Did NOT edit `src/config.ts` (S1 owns notifyMaxChars; S2 only consumes it).
- [ ] Did NOT add NEW notify-echo / cap / E13-ui-throw tests (S3's job) — only fixed the 11 S2 broke.
- [ ] Did NOT add notifyMaxChars config-validation tests (S3's job).
- [ ] Did NOT touch `ShrinkParams`, `SHRINK_DESC`, `targetIsStructurallyValid`, `resolveTargetEntryId`,
      the `appendShrinkMarker` call, `ShrinkDetails`, or the outer try/catch.
- [ ] Did NOT touch any other tool (rewind/checkpoint/audit/cancel) or any non-shrink test.
- [ ] `makeCtx` change is additive (existing `const { ctx } = makeCtx(...)` consumers unaffected).

### Documentation
- [ ] Updated the now-stale `feedbackText` JSDoc (it claimed "from the next turn on" clause + `(Matched now)` slot).
- [ ] The new code is self-documenting (notify block has an E13 comment; helpers have JSDoc).
- [ ] [Mode A] No separate doc file change (SHRINK_DESC unchanged; the terse result + notify are internal).

---

## Anti-Patterns to Avoid

- ❌ Don't echo the replacement in the tool result (or via `pi.sendMessage`) — both re-enter the model's
  context and defeat the tool's purpose. The echo goes ONLY to `ctx.ui.notify` (zero context cost).
- ❌ Don't skip the notify's OWN try/catch ("the outer try/catch will catch it") — spec/05 §2 + the contract
  require a dedicated `try {...} catch { /* E13 */ }` so a UI failure is isolated and the intent is explicit.
- ❌ Don't leave the 11 verbose-text assertions unfixed — S2's `feedbackText` change makes them fail, and a
  red suite means S2 failed its own validation gate. Fixing them is S2's responsibility (S3 adds NEW tests).
- ❌ Don't add the NEW notify/cap/E13/config tests here — that's S3's scope. S2 only fixes what S2 broke +
  wires the makeCtx ui-fake infra that the whole suite (and S3) depends on.
- ❌ Don't edit `src/config.ts` to add `notifyMaxChars` — S1 owns it. S2 CONSUMES `config.shrink.notifyMaxChars`.
- ❌ Don't pass a non-literal notify type — the 2nd arg to `ctx.ui.notify` is the literal union
  `"info"|"warning"|"error"`; pass the string `"info"` (lowercase), not a variable or "INFO".
- ❌ Don't change `makeCtx`'s return in a breaking way — it must stay `{ ctx, notifyCalls }` so existing
  `const { ctx } = makeCtx(...)` callers keep working. Add `notifyCalls`; don't remove `ctx`.
- ❌ Don't make `cap`/`describeTarget` throw — they're module-private pure helpers that must never break the
  tool (mirror `isNonEmpty`'s defensive `typeof` guard).
- ❌ Don't change the `describeTarget` input type away from `ShrinkArgs["target"]` (the RAW 3-arm union) —
  it describes the UNRESOLVED discriminator (`params.target`), not the resolved `ShrinkTarget`.
- ❌ Don't forget the em-dash `—` (U+2014) and the `<<<\n…\n>>>` fence in the notify message — reproduce them
  verbatim (the UI/operator may rely on the fence shape).

---

## Confidence Score

**9/10** for one-pass implementation success. The production change is small and fully specified (verbatim
`feedbackText` + JSDoc, the exact notify block with verified Pi API signatures cited to types.d.ts:76/:215,
and the two helpers from the verified architecture doc). The two real risks are both fully mitigated in the
PRP: (1) the 11 broken test assertions are enumerated with exact line numbers and exact replacements; (2)
the S1 dependency (`config.shrink.notifyMaxChars`) is explicitly called out as a precondition with disjoint
files (no merge conflict). The one residual uncertainty (hence 9 not 10) is the exact current text of
`makeCtx`'s body — the PRP gives the target shape and mandates an additive change, but the implementer must
preserve any existing ctx fields beyond `sessionManager` when merging the `ui`/`hasUI` additions. Deterministic
gates: `npx tsc --noEmit` exits 0; `npx vitest run` green (11 assertions fixed); behavioral spot-checks for
terse result + hasUI-guarded notify + zero-context-cost (result excludes replacement).