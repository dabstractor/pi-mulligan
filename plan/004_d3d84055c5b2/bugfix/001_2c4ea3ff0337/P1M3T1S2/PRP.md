# PRP — P1.M3.T1.S2: Update spec/09-configuration.md with implementation note

## Goal

**Feature Goal**: Add a single, purely-additive **implementation note** to `spec/09-configuration.md §1`
(the "Source" bullet, line 9) that clarifies HOW Mulligan actually reads configuration — it reads the
`settings.json` files **directly from disk** and does its own deep-merge, because Pi 0.84.x's extension
API exposes no settings accessor — while **leaving the spec's user-visible semantic contract entirely
intact** (project-local wins over global; behavior identical to Pi's normal merge).

**Deliverable**: One surgical markdown edit to **`spec/09-configuration.md` only** — append an
implementation note (sub-bullet, preferred) to the existing Source bullet in §1. The existing
contract sentence (`"...via Pi's normal merge."`) is **preserved verbatim**; the note clarifies the
mechanism behind it. No other file is touched.

**Success Definition**: After the edit, (a) `spec/09-configuration.md §1`'s Source bullet still asserts
the original contract (project-local wins, merged), and (b) immediately below it there is an
implementation note stating that Pi 0.84.x exposes no settings accessor, so Mulligan reads
`settings.json` directly via `getAgentDir()` (global) + session cwd (project-local), deep-merges
internally matching Pi's `deepMergeObjects` semantics, and extracts `settings.mulligan` — with the
explicit reassurance that user-visible merge behavior is identical. (c) `npm run typecheck` exits 0
and `npx vitest run` passes (≥882; currently 912) as the regression gate. (d) No file other than
`spec/09-configuration.md` is modified.

> ⚠️ **This is a [Mode B] documentation-only task — NOT a code change.** It is the spec-half of the
> changeset-level documentation sync (the README-half is sibling **P1.M3.T1.S1**). The implementation
> it documents (`src/settings.ts` + `src/index.ts` wiring) is already COMPLETE (P1.M1). Scope is one
> clarifying note in one spec section — do NOT reword the contract, do NOT touch other sections.

## User Persona (if applicable)

**Target User**: Developers / maintainers reading `spec/09-configuration.md` to understand Mulligan's
config-reading contract and (critically) **how it is implemented** against the Pi extension API.

**Use Case**: A maintainer or downstream contributor reads §1 "Where config is read", sees "the merged
Pi settings object … via Pi's normal merge", and assumes Pi hands Mulligan a ready-made merged object.
They then look for a `getSettings()` call in the code, find none, and are confused — or worse, they
attempt to "fix" it by waiting on an accessor that does not exist. The implementation note tells them
upfront: Pi 0.84.x has no settings accessor; Mulligan reads files directly and merges itself.

**Pain Points Addressed**: The current §1 wording implies a mechanism (Pi merges and hands Mulligan the
result) that is not how the landed implementation works. This is a latent confusion trap for anyone
maintaining or porting the extension. The note removes the ambiguity without weakening the contract.

## Why

- **[Mode B] changeset doc-sync (contract DOCS)**: this is the spec companion to the BUG-001
  config-surface repair (P1.M1). The spec describes the config surface that the changeset makes
  functional; it should now also describe *accurately* how that surface is wired.
- **Truth-in-mechanism**: §1 says config comes from "the merged Pi settings object … via Pi's normal
  merge." That is true at the *behavior* level but false at the *mechanism* level — Pi 0.84.x exposes
  no settings accessor to extensions (verified: `ExtensionAPI`/`ExtensionContext` have no
  `getSettings`/`settings` member; see `architecture/pi_api_research.md §A`). Mulligan reads the files
  itself (`src/settings.ts`) and deep-merges with its own `deepMergeSettings`, which mirrors Pi's
  `deepMergeObjects` byte-for-byte in semantics (verified against
  `node_modules/.../settings-manager.js:11-34`). The note records this so the spec is not misleading.
- **Prevent well-intentioned breakage**: without the note, a future contributor may believe the merge
  "just works via Pi" and (a) remove `deepMergeSettings` as "redundant", or (b) wait for an accessor
  that doesn't exist. The note makes the deliberate direct-read design explicit and durable.
- **Respect sibling boundaries**: the README's merge wording (README:69 "(project-local overrides
  global)") is merge-agnostic and accurate — sibling **P1.M3.T1.S1** owns the README and makes NO
  merge-mechanism edit there. The "Pi's normal merge" phrase lives ONLY in `spec/09 §1`, so THIS task
  is the sole correct place for the implementation note. No duplication, no conflict.

## What

A single additive edit to `spec/09-configuration.md` §1, Source bullet (line 9). The contract sentence
is preserved verbatim; an implementation note is appended below it as a sub-bullet (preferred) or
parenthetical.

**Current text (line 9, verbatim — verified by `grep`):**
```markdown
- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge).
```

**Desired text (sub-bullet form — PREFERRED):**
```markdown
- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge).
  - _Implementation note:_ Pi's extension API (v0.84.x) does not expose a settings accessor to extensions. Mulligan therefore reads the `settings.json` files directly from disk — the global file via `getAgentDir()` and the project-local file from the session `cwd` (`.pi/settings.json`) — deep-merges them internally (matching Pi's own `deepMergeObjects` semantics), and extracts `settings.mulligan`. The user-visible merge behavior is identical to Pi's normal merge.
```

(The implementer may instead use a parenthetical appended to line 9 if a more compact form is
preferred — see Implementation Tasks Task 1, option B. Either is acceptable; the sub-bullet is
recommended for readability. The contract sentence MUST be preserved either way.)

### Success Criteria

- [ ] `spec/09-configuration.md §1` Source bullet still contains the original contract sentence
      verbatim, including the phrase `via Pi's normal merge` (`grep` confirms it remains on line 9).
- [ ] An implementation note is present in §1 stating ALL FOUR facts: (1) Pi 0.84.x exposes no settings
      accessor to extensions; (2) Mulligan reads `settings.json` directly via `getAgentDir()` (global)
      + session cwd (project-local); (3) it deep-merges internally matching Pi's `deepMergeObjects`;
      (4) user-visible merge behavior is identical.
- [ ] The note is purely additive — no deletion or weakening of the existing contract, "When", or
      "Validation" bullets.
- [ ] `npm run typecheck` exits 0; `npx vitest run` passes (≥882; currently 912) — no regression.
- [ ] No file other than `spec/09-configuration.md` is modified (`git status --short` shows only it).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the exact target file and line (`spec/09-configuration.md` line 9, quoted
verbatim with the `grep` confirmation), the exact desired replacement text (sub-bullet + parenthetical
options), the precise four facts the note must contain (drawn from the work-item contract step 2b), the
verified implementation evidence behind each fact (file:line citations in `src/settings.ts` and Pi's
own `settings-manager.js`), the explicit scope fence (spec/09 only; README/src/package.json/test are
all out of scope), the two validation gates with their confirmed current pass states (typecheck exit 0;
912 tests), and the cross-reference to the sibling S1 PRP that owns the README half. The implementer
needs to open exactly one file and run two commands.

### Documentation & References

```yaml
# MUST READ — the ONLY file this task edits
- file: spec/09-configuration.md
  why: §1 "Where config is read" (lines 7-11). The edit target is the Source bullet on line 9:
        "- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local
        wins over global via Pi's normal merge)." This is the ONLY line containing "Pi's normal merge"
        (grep-confirmed, single match). Append an implementation note here; preserve the sentence.
  pattern: "Markdown spec doc with §-numbered sections. §1 has three bullets: Source (line 9, edit),
            When (line 10, READ-ONLY), Validation (line 11, READ-ONLY)."
  gotcha: "Line numbers are 1-indexed from the file head. PRESERVE the contract sentence verbatim —
           the note clarifies the mechanism, it must NOT delete 'via Pi's normal merge'. Do NOT touch
           the When/Validation bullets (out of scope)."

# MUST READ — the mechanism the note describes (global + project-local read paths)
- file: src/settings.ts
  why: `loadMulliganConfig(cwd?)` is the public entry point. It reads global via
        `join(getAgentDir(), "settings.json")` and project-local via
        `join(cwd ?? process.cwd(), ".pi", "settings.json")`, deep-merges with `deepMergeSettings`,
        returns `merged.mulligan` as `unknown`. This IS the 'reads files directly + merges internally'
        the note must describe. `deepMergeSettings` is `@internal`-exported + documented as mirroring
        Pi's deepMergeObjects.
  pattern: "Pi-bound module (node:fs/node:path/getAgentDir). Fail-open (try/catch→undefined)."
  gotcha: "READ-ONLY — do NOT edit. The note references getAgentDir() and session cwd by NAME; these
           are the exact identifiers in settings.ts."

# MUST READ — PROOF that Mulligan's merge semantics == Pi's (the note's key claim)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js
  why: Lines 11-34 define Pi's own `deepMergeObjects(base, overrides)`: isMergeableObject =
        (typeof object && !null && !array); result = {...base}; iterate own keys of overrides; both
        mergeable → recurse, else override replaces. Mulligan's src/settings.ts `deepMergeSettings`
        mirrors this EXACTLY. This is the evidence behind the note's clause 'matching Pi's own
        deepMergeObjects semantics'. Verified by reading the source at research time.
  pattern: "Pi internal settings merge. Project/overrides win; nested objects recurse; arrays replace."
  gotcha: "READ-ONLY — node_modules is never edited. The only cosmetic diff: Pi skips `undefined`
           override values; Mulligan's readSettingsFile never yields an `undefined` leaf (JSON has no
           undefined), so the two are observationally identical — the note's 'matching semantics' claim
           holds."

# MUST READ — PROOF that Pi exposes no settings accessor (the note's premise)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: The complete `ExtensionAPI` and `ExtensionContext` interfaces. Neither has any settings/config
        accessor (no getSettings/getConfig/settings/loadConfig field). This is the verified fact behind
        the note's 'Pi's extension API (v0.84.x) does not expose a settings accessor to extensions'.
        Full enumeration in architecture/pi_api_research.md §A.
  gotcha: "READ-ONLY. getFlag(name) exists but is for extension-registered CLI flags only, NOT settings."

# CONTEXT — the lifecycle wiring (confirms the note's 'session cwd' reference is accurate)
- file: src/index.ts
  why: Factory body calls `setConfig(loadMulliganConfig(process.cwd()))` (boot); `session_start` handler
        re-calls it with `ctx.cwd` on every reason (startup|reload|new|resume|fork). Confirms the note's
        'session cwd' phrasing: project-local is read against the session's cwd at session_start.
  gotcha: "READ-ONLY. Do NOT touch. The 'session cwd' wording in the note is accurate; the factory uses
           process.cwd() as the cwd-less fallback, session_start uses ctx.cwd."

# CONTEXT — the architectural research that identified this exact spec gap
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/docs_spec_research.md
  why: §2.1 quotes spec/09 §1 verbatim and flags that 'the merged Pi settings object … via Pi's normal
        merge' implies Pi hands Mulligan an already-merged object — the gap this note closes.
  critical: "§2.1 is the authoritative catalogue of this spec line; the note wording in the work-item
             contract (step 2b) was derived from it."

# CONTEXT — the Pi-API research that recommended the direct-file-read approach
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/pi_api_research.md
  why: §A proves no settings accessor; §C.4 recommends reading files directly + using getAgentDir().
        The note's factual claims trace directly to this doc.
  critical: "§C.4 is the design rationale the note alludes to."

# CONTEXT — the parallel-sibling PRP (README doc-sync; confirms scope split)
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/P1M3T1S1/PRP.md
  why: CONTRACT. S1 owns README.md (the "17→19 knobs" count fix + an optional tool-refusal
        clarification). S1 explicitly does NOT touch spec/09 — that is THIS task. S1 confirms both
        validation gates are green (typecheck exit 0; 912 tests) and confirms the "Pi's normal merge"
        phrase lives ONLY in spec/09 (so the note belongs here, not in README). Zero file conflict:
        S1 edits README.md, S2 edits spec/09-configuration.md.
  gotcha: "Do NOT edit README.md or package.json — both are siblings' scope."

# EXTERNAL — markdown formatting fidelity
- note: "spec/09 uses standard markdown with `**bold**` bullet leaders and `inline code` for
         identifiers. The sub-bullet note should be indented 2 spaces under the Source bullet and use
         `_italic_` for the '_Implementation note:_' lead (matching the doc's emphasis style). Preserve
         the backticks around `settings.json`, `getAgentDir()`, `deepMergeObjects`, `settings.mulligan`."
```

### Current Codebase tree (the relevant slice)

```bash
spec/09-configuration.md   # ← THIS task edits ONE spot: §1 Source bullet (line 9) — append impl note
src/settings.ts            # READ-ONLY — loadMulliganConfig / readSettingsFile / deepMergeSettings (the mechanism)
src/index.ts               # READ-ONLY — factory + session_start wiring (confirms 'session cwd')
src/config.ts              # READ-ONLY — validateConfig/setConfig/getConfig (validation, not in the note)
node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js   # READ-ONLY — deepMergeObjects (merge-semantics proof)
node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts # READ-ONLY — no settings accessor (note's premise)
README.md                  # READ-ONLY (sibling P1.M3.T1.S1 owns it)
package.json               # READ-ONLY (sibling P1.M2.T1.S2 owns it; the `typecheck` script)
plan/.../architecture/docs_spec_research.md   # READ-ONLY research cross-check (§2.1)
plan/.../architecture/pi_api_research.md      # READ-ONLY research cross-check (§A, §C.4)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly spec/09-configuration.md — appends one implementation note
# to §1's Source bullet (line 9). The existing contract sentence is preserved verbatim.
spec/09-configuration.md   # §1 Source bullet: keep contract sentence + add impl-note sub-bullet
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL GOTCHA #1 (the edit is ADDITIVE — never delete the contract sentence):
#   The existing Source bullet says "...via Pi's normal merge." That contract is CORRECT at the
#   behavior level (project-local wins; merged). The note clarifies the MECHANISM (direct file read +
#   internal deep-merge) without contradicting it. PRESERVE "via Pi's normal merge" verbatim.
#   `grep -n "Pi's normal merge" spec/09-configuration.md` MUST still print line 9 after the edit.

# CRITICAL GOTCHA #2 (the note must contain all FOUR facts — the contract step 2b wording):
#   (1) Pi 0.84.x exposes no settings accessor to extensions;
#   (2) Mulligan reads settings.json directly via getAgentDir() (global) + session cwd (project-local);
#   (3) it deep-merges internally matching Pi's deepMergeObjects semantics;
#   (4) user-visible merge behavior is identical.
#   The work-item contract (step 2b) supplies the exact recommended sentence — use it (or a faithful
#   paraphrase) verbatim. Do not invent new claims or drop any of the four.

# CRITICAL GOTCHA #3 (do NOT touch the When/Validation bullets in §1):
#   §1 has three bullets: Source (line 9 = edit target), When (line 10), Validation (line 11).
#   The "When" bullet says "loaded lazily on first use" — the implementation actually loads eagerly at
#   factory time then re-reads on session_start (user-facing behavior identical). This task does NOT
#   touch line 10; the contract (step 2b) scopes the note to the Source/merge MECHANISM only. Editing
#   the lazy/eager wording is scope-creep and is not requested. Leave line 10 and line 11 untouched.

# CRITICAL GOTCHA #4 (do NOT duplicate or conflict with sibling S1):
#   S1 (README) and S2 (spec/09) are a split pair. S1 adds the knob-count fix + optional tool-refusal
#   clarification to README.md and explicitly leaves spec/09 to S2. S2 adds the merge-mechanism note
#   to spec/09 and explicitly leaves README to S1. Neither edits the other's file. If you are tempted
#   to also 'fix' README's merge wording — STOP; README:69 ("project-local overrides global") is
#   merge-AGNOSTIC and accurate, and it's S1's scope anyway.

# CRITICAL GOTCHA #5 (the merge-semantics claim is VERIFIED — do not hedge it):
#   The note says Mulligan's deep-merge 'matches Pi's own deepMergeObjects semantics'. This is proven
#   by reading node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:11-34 (Pi's
#   deepMergeObjects) alongside src/settings.ts deepMergeSettings — same isMergeableObject rule, same
#   {...base}+own-keys-of-overrides+recurse-or-replace. State it as fact, not 'approximately'/'similar'.

# CRITICAL GOTCHA #6 (identifier names in the note must match the code):
#   The note names `getAgentDir()`, `deepMergeObjects`, `settings.mulligan`. These are the EXACT
#   identifiers in src/settings.ts (getAgentDir imported from Pi) and the Pi source (deepMergeObjects).
#   Use backticks for all of them. Do not rename to e.g. 'readSettings' or 'mergeConfig'.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - README.md → sibling P1.M3.T1.S1 (knob count + tool-refusal clarification).
#   - src/* (any source) → production code; this is a doc task (the code is the SUBJECT of the note).
#   - node_modules/* → never edited.
#   - package.json → sibling P1.M2.T1.S2 (the typecheck script).
#   - test/* → no new tests.
#   - spec/09 §1 When/Validation bullets, §2-§6 → accurate post-fix; leave untouched.
# This PRP edits ONLY spec/09-configuration.md §1 Source bullet (one additive note).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a one-line additive markdown edit. The "model" is the four-fact
checklist below: the note must state all four facts (verified against `src/settings.ts` and Pi's
`settings-manager.js`)._

### Note content checklist (the note MUST contain all four — from contract step 2b)

| # | Fact | Evidence (file:line) |
|---|------|----------------------|
| 1 | Pi's extension API (v0.84.x) exposes no settings accessor to extensions | `.../types.d.ts` ExtensionAPI/ExtensionContext (no getSettings); `pi_api_research.md §A` |
| 2 | Mulligan reads `settings.json` directly via `getAgentDir()` (global) + session cwd (project-local `.pi/settings.json`) | `src/settings.ts` `loadMulliganConfig`; `src/index.ts` session_start uses `ctx.cwd` |
| 3 | Mulligan deep-merges internally, matching Pi's own `deepMergeObjects` semantics | `src/settings.ts` `deepMergeSettings` ≡ `.../settings-manager.js:11-34` |
| 4 | User-visible merge behavior is identical to Pi's normal merge | (consequence of #3) |

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT spec/09-configuration.md §1 Source bullet — append implementation note (THE edit)
  - FIND (verbatim, line 9): "- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge)."
  - CHOOSE placement:
      OPTION A (PREFERRED — sub-bullet): KEEP line 9 verbatim and ADD an indented sub-bullet
        immediately after it (2-space indent under the bullet):
          "  - _Implementation note:_ Pi's extension API (v0.84.x) does not expose a settings accessor
           to extensions. Mulligan therefore reads the `settings.json` files directly from disk — the
           global file via `getAgentDir()` and the project-local file from the session `cwd`
           (`.pi/settings.json`) — deep-merges them internally (matching Pi's own `deepMergeObjects`
           semantics), and extracts `settings.mulligan`. The user-visible merge behavior is identical
           to Pi's normal merge."
      OPTION B (compact — parenthetical): APPEND to line 9 after "...Pi's normal merge)." a
        parenthetical, e.g.:
          " (Implementation: because Pi 0.84.x exposes no settings accessor to extensions, Mulligan
           reads the `settings.json` files directly — global via `getAgentDir()`, project-local from
           the session `cwd` — deep-merges them internally matching Pi's `deepMergeObjects`, and
           extracts `settings.mulligan`; the user-visible merge behavior is identical.)"
  - PRESERVE: the original contract sentence and the phrase `via Pi's normal merge` MUST remain.
  - COVER: all four facts from the checklist above (getAgentDir + session cwd + deepMergeObjects +
    user-visible identical). Backtick the identifiers.
  - DO NOT touch: the "When" bullet (line 10) or the "Validation" bullet (line 11).

Task 2: VALIDATE content (self-checks, no commands yet)
  - CONFIRM `grep -n "Pi's normal merge" spec/09-configuration.md` still prints line 9 (contract preserved).
  - CONFIRM the note contains all of: "settings accessor", "getAgentDir()", "deepMergeObjects",
    "settings.mulligan", and "identical" (the four facts). `grep -nE` each token against the file.
  - CONFIRM the "When" and "Validation" bullets are unchanged (`git diff` shows only the Source area).

Task 3: VALIDATE no regression (contract step e — the required gates)
  - RUN: `npm run typecheck`   → expect exit 0 (no output).  [script from P1.M2.T1.S2; a markdown edit
    cannot break typecheck, but it is the canonical regression gate.]
  - RUN: `npx vitest run`      → expect all pass (≥882; currently 912).  [unaffected by a spec edit.]

Task 4: SCOPE-GUARD self-check
  - CONFIRM no file other than spec/09-configuration.md was modified: `git status --short` should
    list ONLY spec/09-configuration.md.
  - CONFIRM README.md, package.json, src/, test/, node_modules/ were NOT touched.
    `git diff --name-only | grep -Ev 'spec/09-configuration.md'` → expect NO output.
```

### Implementation Patterns & Key Details

```markdown
# This is a docs task — the only "pattern" is: preserve-then-clarify. Three notes:

# (1) The edit is ADDITIVE. Whether you use the sub-bullet (Option A) or parenthetical (Option B),
#     the original contract sentence stays. The note clarifies the mechanism; it never deletes or
#     weakens "via Pi's normal merge". After the edit, that phrase is still on line 9 (or its
#     immediate vicinity) — `grep` must still find it.

# (2) Use the contract's recommended wording (work-item step 2b) verbatim or near-verbatim. It already
#     contains all four required facts and the correct tone. Do not editorialize beyond light markdown
#     formatting (italics for the "_Implementation note:_" lead, backticks for identifiers).

# (3) Identifier fidelity: backtick EXACTLY these tokens as they appear in code — `getAgentDir()`,
#     `deepMergeObjects`, `settings.mulligan`, `settings.json`, `.pi/settings.json`. Do not rename them.
#     `getAgentDir()` is exported by `@earendil-works/pi-coding-agent` (imported in src/settings.ts);
#     `deepMergeObjects` is Pi's internal merge in settings-manager.js.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only edit (Mode B).
  - DATABASE: none
  - CONFIG: none (src/settings.ts + src/config.ts are READ-ONLY — the SUBJECT of the note, not edited)
  - ROUTES: none
  - DEPENDENCIES: none
  - CODE: none (all src/* + node_modules/* are READ-ONLY verification evidence)
  - DOCS: spec/09-configuration.md ONLY (§1 Source bullet). README.md is sibling P1.M3.T1.S1's scope.
  - The only "integration" is TRUTHINESS: after the edit, spec/09 §1's Source bullet accurately
          describes BOTH the contract (unchanged) AND the mechanism (new note) — and the mechanism
          claim is backed by src/settings.ts + Pi's settings-manager.js.
```

---

## Validation Loop

A documentation edit cannot break the build, but the contract (step e) requires the two project gates
to pass as the final validation. Run all levels.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The contract sentence is PRESERVED (the note is additive, not a replacement).
grep -n "Pi's normal merge" spec/09-configuration.md
# Expected: still prints line 9 (or the parenthetical on line 9). If NO match, you deleted the contract — revert.

# (b) The note contains all four required facts (the contract step 2b content).
grep -nE "settings accessor" spec/09-configuration.md   # Expected: 1 match in §1.
grep -nE "getAgentDir\(\)" spec/09-configuration.md     # Expected: 1 match in §1.
grep -nE "deepMergeObjects" spec/09-configuration.md    # Expected: 1 match in §1.
grep -nE "session .cwd.|session cwd" spec/09-configuration.md  # Expected: 1 match in §1 (project-local path).

# (c) The "When" and "Validation" bullets are unchanged (sanity — you didn't reflow §1).
grep -n "loaded lazily on first use" spec/09-configuration.md   # Expected: still line 10, unchanged.
grep -n "unknown keys are ignored" spec/09-configuration.md     # Expected: still line 11, unchanged.
```
Expected: (a) the contract phrase still present; (b) all four fact tokens present once each in §1;
(c) the When/Validation bullets byte-unchanged.

### Level 2: Unit Tests (Component Validation)

```bash
# N/A for a spec markdown edit — there is no "unit". The settings surface is already tested; confirm green
# as a regression sanity check only (the spec edit changes no code):
npx vitest run test/settings.test.ts   # Expected: all settings tests pass (readSettingsFile / deepMergeSettings / loadMulliganConfig).
```

### Level 3: Integration Testing (System Validation) — the contract's required gates

```bash
# Contract step (e): "Run `npx tsc --noEmit` (exit 0) and `npx vitest run` (882+ tests pass)."
npm run typecheck        # = tsc --noEmit (script added by P1.M2.T1.S2). Expected: exit 0, no output.
echo "typecheck exit: $?" # Expected: 0

npx vitest run            # Expected: 21 files, 912 tests passed, 0 failed (912 ≥ 882 baseline).
                         # A spec/09 markdown edit cannot change this — if it does, scope leaked into code; revert.
```
Expected: `npm run typecheck` exits 0; `npx vitest run` passes all (≥882, currently 912).

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guard (the most important doc-task check): ONLY spec/09-configuration.md changed.
git status --short        # Expected: " M spec/09-configuration.md" (and nothing else).
git diff --stat           # Expected: spec/09-configuration.md | a few insertions (the note); ~0 deletions.
git diff --name-only | grep -Ev 'spec/09-configuration.md' && echo "OUT OF SCOPE — revert" || echo "scope OK"
                         # Expected: "scope OK" (README.md, package.json, src/, test/ must NOT appear).

# Note-placement sanity (visual): the note reads as a clarifying aside, not a contradiction.
sed -n '7,14p' spec/09-configuration.md   # Eyeball §1: contract bullet intact + note below/within it.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exits 0 (the BUG-002 gate; green post-P1.M2).
- [ ] `npx vitest run` — all tests pass (≥882; currently 912). A spec edit cannot change this — if it
      changes, scope leaked into code; revert and re-check.
- [ ] `grep -n "Pi's normal merge" spec/09-configuration.md` → still matches (contract preserved).

### Feature Validation
- [ ] `spec/09 §1` Source bullet still contains the original contract sentence verbatim ("the merged
      Pi settings object … via Pi's normal merge").
- [ ] An implementation note is present in §1 containing ALL FOUR facts: (1) no settings accessor in
      Pi 0.84.x; (2) direct file read via `getAgentDir()` (global) + session cwd (project-local);
      (3) internal deep-merge matching Pi's `deepMergeObjects`; (4) user-visible behavior identical.
- [ ] The note is purely additive — the "When" (line 10) and "Validation" (line 11) bullets are
      byte-unchanged (`git diff` confined to the Source bullet area).
- [ ] Identifiers are backtick-fenced exactly as in code: `getAgentDir()`, `deepMergeObjects`,
      `settings.mulligan`, `settings.json`.

### Code Quality / Scope Discipline
- [ ] Modified ONLY `spec/09-configuration.md` (`git status --short` shows nothing else).
- [ ] Did NOT edit `README.md` (sibling P1.M3.T1.S1 — owns the knob-count + tool-refusal edits).
- [ ] Did NOT edit `package.json` (sibling P1.M2.T1.S2 — owns the typecheck script).
- [ ] Did NOT edit any `src/*`, `test/*`, or `node_modules/*` (this is a documentation task; the code
      is the SUBJECT of the note, not edited).
- [ ] Did NOT reword the "When" bullet's "loaded lazily on first use" (out of scope for S2; behavior is
      identical; the contract scopes the note to the Source/merge mechanism only).

### Documentation
- [ ] `spec/09 §1` now accurately describes BOTH the contract (unchanged) AND the implementation
      mechanism (new note), so a maintainer reading it is not misled into expecting a Pi settings
      accessor or a Pi-performed merge.
- [ ] The change is minimal: one additive implementation note; no contract weakening.

---

## Anti-Patterns to Avoid

- ❌ Don't DELETE or REWORD the contract sentence. The note clarifies the mechanism behind "Pi's normal
  merge"; it must not remove that phrase. After the edit, `grep "Pi's normal merge"` must still match.
- ❌ Don't touch the "When" (lazy/cached/re-read) or "Validation" bullets. The contract (step 2b)
  scopes this note to the Source/merge MECHANISM. Editing the lazy/eager wording is scope-creep.
- ❌ Don't hedge the merge-semantics claim ("roughly matches", "similar to"). It is proven byte-equivalent
  in semantics against Pi's `settings-manager.js:11-34`. State "matching Pi's own deepMergeObjects
  semantics" as fact.
- ❌ Don't rename identifiers. `getAgentDir()`, `deepMergeObjects`, `settings.mulligan` are the exact
  code/Pi-source tokens — backtick them verbatim.
- ❌ Don't duplicate this note in README.md. README:69's "(project-local overrides global)" is
  merge-AGNOSTIC and accurate, and README is sibling S1's scope. The "Pi's normal merge" phrase lives
  ONLY in spec/09 §1 — that is why the note belongs here and only here.
- ❌ Don't touch §2 (schema), §3 (rationale table), §4 (validation rules), §5, or §6 — all accurate
  post-fix; out of scope.
- ❌ Don't edit src/*, node_modules/*, package.json, or test/*. `git status --short` must show only
  spec/09-configuration.md.
- ❌ Don't skip `npm run typecheck` / `npx vitest run` because "it's just a doc edit" — the contract
  (step e) requires them as the final validation and they confirm the full changeset is green.

---

## Confidence Score

**9/10** for one-pass implementation success. The task is a single additive markdown note in one
precisely-located line (`spec/09-configuration.md §1` Source bullet, line 9, grep-confirmed unique
"Pi's normal merge" match). The exact note wording is supplied by the work-item contract (step 2b) and
contains all four required facts, each backed by verified file:line evidence (`src/settings.ts` for the
mechanism; `node_modules/.../settings-manager.js:11-34` proving the merge-semantics equivalence;
`.../types.d.ts` proving no settings accessor). The scope fence is explicit and non-overlapping with
sibling S1 (README) and P1.M2.T1.S2 (package.json). Both validation gates are confirmed green at
research time. The one point of residual uncertainty is the implementer's placement choice (sub-bullet
vs parenthetical) — both are fully specified with exact text, so this is a formatting preference, not a
risk; hence not 10/10.