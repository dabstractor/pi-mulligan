# PRP — P1.M3.T1.S1: Verify README Configuration + Disabling sections are accurate post-fix

## Goal

**Feature Goal**: Verify that README.md §3 Configuration (lines 67–124) and the "Disabling"
subsection (lines 120–122) are now **accurate descriptions of the real post-fix behavior**, after the
BUG-001 config-surface repair (P1.M1: `src/settings.ts` + `src/index.ts` wiring) and the BUG-002
type-safety gate (P1.M2) have landed. Fix the one factual error found ("17 knobs" → 19), add the one
minor clarification where the implementation diverges from a blanket claim (checkpoint/audit are
always-on), and confirm via the project validation gates that nothing regressed.

**Deliverable**: A minimal, surgical edit to **`README.md` only** — (a) one required one-word fix at
line 75 (`17 knobs` → `19 knobs`), and (b) one optional-but-recommended clarification sentence at
line 122 (naming the 3 refusing tools + noting checkpoint/audit stay available). No other file is
touched. Plus a completed verification matrix proving every documented behavior now matches the code.

**Success Definition**: After the edit, (a) README:75 reads "All 19 knobs" and that count matches the
table (19 rows), `src/config.ts` DEFAULT_CONFIG (19 leaf knobs), and `spec/09 §3` (19 knobs);
(b) README:122's "the tools refuse cleanly" claim is either left as-is OR clarified to name the 3
refusing tools — the implementer's documented choice; (c) `npm run typecheck` exits 0 and
`npx vitest run` passes (≥882 tests; currently 912); (d) no file other than `README.md` is modified.

> ⚠️ **This is a [Mode B] documentation-sync task — NOT a code change.** The implementation work
> (P1.M1 wiring + P1.M2 typecheck) is already COMPLETE (status confirmed in research: `typecheck`
> exits 0, 912 tests pass). This task SWEEPS the README for coherence with the landed changeset.
> Scope is deliberately tiny: at most 2 small edits in README.md, governed by the verification
> matrix below.

## User Persona (if applicable)

**Target User**: Developers / end users reading the README to learn how to configure Mulligan
(`settings.json` knobs) and how to disable it (`enabled:false`).

**Use Case**: A user adds `"mulligan": { "enabled": false }` to `~/.pi/agent/settings.json` and reads
the README's "Disabling" subsection to know what to expect. They skim the "Defaults table" to learn
which knobs exist. The README must now describe what actually happens.

**Pain Points Addressed**: Pre-fix, the README documented a non-existent capability (BUG-001 made
`enabled:false` a silent no-op). Post-fix the behavior is real; the only remaining risk is stale
*numbers/blanket-statements* in the docs (the "17 knobs" count and the "the tools refuse cleanly"
blanket). This task closes that gap.

## Why

- **[Mode B] changeset doc-sync (contract DOCS)**: this IS the changeset-level documentation sync
  task for the BUG-001/BUG-002 fix. It ensures the most prominent user-facing contract (the README)
  no longer carries a stale count or an over-broad claim now that the implementation is real.
- **Truth-in-advertising**: README:75 advertises "All 17 knobs (source of truth: `src/config.ts`
  `DEFAULT_CONFIG`)" — but DEFAULT_CONFIG has **19** knobs, and the README's OWN table lists 19. A
  user counting rows would lose trust in the doc. One-word fix.
- **Precise disable semantics**: README:122 says "the tools refuse cleanly". 3 of 5 tools (rewind,
  shrink, cancel) do; checkpoint and audit are intentionally always-on read-only diagnostics (per
  in-code GOTCHA #4 comments). Naming the 3 refusing tools removes ambiguity without overclaiming.
- **Respect sibling boundaries**: the "Pi's normal merge → Mulligan merges internally" parenthetical
  (contract step c) belongs in `spec/09-configuration.md` (sibling **P1.M3.T1.S2**), NOT the README —
  README:69's actual merge wording ("project-local overrides global") is accurate and merge-agnostic.
  This task makes NO edit for that; it stays out of S2's file.

## What

Two candidate edits in `README.md`. Edit #1 is REQUIRED; Edit #2 is the implementer's documented
choice (recommended). The full verification matrix (9 checks, all but #1/#2 already ✅) is in the
Implementation Blueprint.

**Edit #1 (required)** — README:75:
```diff
-All 17 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3).
+All 19 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3).
```

**Edit #2 (recommended; implementer may leave as-is with justification)** — README:122, append a
clarifying parenthetical to the existing sentence:
```diff
-`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and the tools refuse cleanly with `Mulligan: refused — Mulligan is disabled.`. The human can disable Mulligan without uninstalling it.
+`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and the three state-changing tools refuse cleanly with `Mulligan: refused — Mulligan is disabled.`. The human can disable Mulligan without uninstalling it.
+
+> The three state-changing tools — `mulligan_rewind`, `mulligan_shrink`, `mulligan_cancel` — refuse when disabled. `mulligan_checkpoint` and `mulligan_audit` have no config gate: they stay available as always-on, read-only diagnostics (you can still inspect markers while disabled).
```
(Implementer may keep the simpler inline form: change "the tools" → "the state-changing tools" on
line 122 and stop there. Either satisfies the clarification; the blockquote is the fuller option.)

### Success Criteria

- [ ] README:75 reads "All **19** knobs" (matches its own 19-row table, `config.ts` 19-leaf
      `DEFAULT_CONFIG`, and `spec/09 §3` 19-row table).
- [ ] README:122 either (a) left unchanged with a documented justification, or (b) clarified so it no
      longer implies ALL FIVE tools refuse — naming rewind/shrink/cancel and noting checkpoint/audit
      are always-on.
- [ ] Every behavior in the README verification matrix (§Blueprint) is confirmed accurate against the
      code; no undocumented divergence remains.
- [ ] `npm run typecheck` exits 0; `npx vitest run` passes (≥882; currently 912) — no regression.
- [ ] No file other than `README.md` is modified (spec/09 is sibling P1.M3.T1.S2's scope).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the exact README lines to verify (67–124, with the two edit targets
quoted verbatim), the authoritative knob count (19, with the per-knob enumeration and three
independent counts that agree), the exact post-fix implementation evidence for each documented
behavior (file:line citations), the two validation gates with their confirmed current pass states
(typecheck exit 0; 912 tests), the explicit scope fence (README only — spec/09 is S2's), and the
"Pi's normal merge" scoping note that prevents the implementer from making an out-of-scope spec/09
edit. The implementer needs to open exactly one file (`README.md`) and run two commands.

### Documentation & References

```yaml
# MUST READ — the ONLY file this task edits
- file: README.md
  why: §3 Configuration (lines 67-124) + Disabling subsection (lines 120-122). Two edit targets:
        line 75 ("17 knobs" count) and line 122 ("the tools refuse cleanly" blanket). Everything
        else in 67-124 is verified accurate (see matrix).
  pattern: "Markdown prose + a 19-row Defaults table (lines 77-103) + a minimal commented-out
            settings.json example (lines 109-118) + a Disabling subsection (120-122)."
  gotcha: "Line numbers are 1-indexed from the file head. The '17 knobs' string appears EXACTLY ONCE
           (grep confirms). Edit #1 is a 2-character change (17→19). Edit #2 is additive prose."

# MUST READ — the authoritative knob count source (verifies the 17→19 fix)
- file: src/config.ts
  why: `MulliganConfig` interface + `DEFAULT_CONFIG` are the source of truth the README:75 cites.
        Count the LEAF knobs (not the section containers enabled/rewind/shrink/nudges/audit/log):
        19 total. README's own table also lists 19 rows. spec/09 §3 also lists 19.
  pattern: "DEFAULT_CONFIG is a typed const; never mutated; getConfig() returns a merged clone."
  gotcha: "READ-ONLY in this task — do NOT edit config.ts. `bloatThresholdBytesByTool` is optional
           (`?`) in the interface but IS present in DEFAULT_CONFIG and IS documented in the table,
           so it counts. `autoOnBloat` is explicitly reserved/NOT v1 — it is NOT counted."

# MUST READ — the landed implementation this task verifies the README AGAINST
- file: src/settings.ts
  why: `loadMulliganConfig(cwd?)` is the only public export; reads global (`join(getAgentDir(),
        "settings.json")`) + project-local (`join(cwd ?? process.cwd(), ".pi", "settings.json")`),
        deep-merges (project wins; nested recurse; arrays replace) via `deepMergeSettings`, returns
        raw `merged.mulligan` (unknown). Fail-open (try/catch → undefined). Confirms README:69 claims.
  pattern: "Pi-bound module (node:fs/node:path/getAgentDir). Counterpart src/config.ts is Pi-free."
  gotcha: "Mulligan does its OWN deepMergeSettings — NOT 'Pi's normal merge' (Pi 0.84.x exposes no
           settings accessor). But README:69 says '(project-local overrides global)' — merge-AGNOSTIC
           and ACCURATE. The 'Pi's normal merge' phrase is in spec/09 §1 (sibling S2's job), NOT README."

# MUST READ — the lifecycle wiring (confirms README:69 'cached' + 're-read on /reload')
- file: src/index.ts
  why: Factory body calls `setConfig(loadMulliganConfig(process.cwd()))` (eager load at boot) +
        `setLogFile(getConfig().log.file)`. The `session_start` handler re-calls both on EVERY reason
        (startup|reload|new|resume|fork). Confirms 'cached for the session' + 're-read on /reload'.
  pattern: "Factory (no ctx) uses process.cwd(); session_start uses the authoritative ctx.cwd (D4)."
  gotcha: "READ-ONLY. Config loads EAGERLY at factory time, not literally 'lazily on first use'
           (README:69). User-facing behavior is identical (read once, cached, re-read on reload).
           RECOMMEND LEAVE THE 'lazy' WORD — it is defensible ('first use'='first load'), it matches
           spec/09 §1's wording, and the contract asserts the README is accurate. Flag only."

# MUST READ — the exact disable refusal string (confirms README:122 quoted string)
- file: src/tools/rewind.ts
  why: Line 454 `if (!config.enabled) return refuse("Mulligan is disabled", granularity);` → the
        `refuse`/`refusal` helper (line 176) emits `Mulligan: refused — ${reason}.` = the EXACT string
        README:122 quotes (`Mulligan: refused — Mulligan is disabled.`). Same pattern in shrink.ts:134
        and cancel.ts:117. Confirms the quoted refusal text is byte-exact for these 3 tools.
  gotcha: "checkpoint.ts and audit.ts have NO config gate (in-code 'GOTCHA #4') — they are always-on
           read-only diagnostics. This is the basis for Edit #2 (the 'the tools refuse cleanly' blanket)."

# CONTEXT — the architectural research that catalogued every documented behavior
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/docs_spec_research.md
  why: §1 maps README:67-124 promises; §2 maps spec/09; §6 covers global/project-local precedence;
        §8 lists the 8 contracts a BUG-001 fix must satisfy (all now satisfied). Cross-check source.
  critical: "§6 notes spec/09 §1 says 'Pi's normal merge' — confirming the merge parenthetical is a
             SPEC/09 concern (S2), not a README concern (this task)."

# CONTEXT — the parallel-sibling PRP (what makes the typecheck gate green)
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/P1M2T1S2/PRP.md
  why: CONTRACT. S2 adds `"typecheck": "tsc --noEmit"` to package.json. That script is ALREADY present
        (confirmed) and exits 0. So `npm run typecheck` is the canonical validation gate for this task.
        S2 touches package.json ONLY — zero file conflict with README.md.
  gotcha: "Do NOT edit package.json or spec/09 — both are other items' scope."

# CONTEXT — sibling that owns spec/09 (the 'Pi's normal merge' parenthetical)
- file: spec/09-configuration.md
  why: §1 contains the phrase 'project-local wins over global via Pi's normal merge' — that is where
        the deepMergeSettings parenthetical (contract step c) belongs. It is SIBLING P1.M3.T1.S2's
        job. This task makes NO edit to spec/09.
  gotcha: "READ-ONLY for this task. If tempted to add the '(Mulligan reads files directly…)' note
           here, STOP — that is S2. The README does not contain 'Pi's normal merge', so no README edit."

# EXTERNAL — em-dash character fidelity (the refusal string must match byte-for-byte)
- note: "README:122 and the code both use U+2014 EM DASH (—) in 'Mulligan: refused — '. Confirmed
         identical by grep. Do not 'normalize' to a hyphen or en-dash when editing README:122."
```

### Current Codebase tree (the relevant slice)

```bash
README.md                 # ← THIS task edits ≤2 spots: line 75 (count) + line 122 (clarify)
src/config.ts             # READ-ONLY — DEFAULT_CONFIG / MulliganConfig (the 19-knob source of truth)
src/settings.ts           # READ-ONLY — loadMulliganConfig (the landed BUG-001 reader; verifies README:69)
src/index.ts              # READ-ONLY — factory + session_start wiring (verifies 'cached' + 're-read on /reload')
src/tools/{rewind,shrink,cancel}.ts   # READ-ONLY — the 3 tools that refuse on enabled:false
src/tools/{checkpoint,audit}.ts       # READ-ONLY — the 2 always-on tools (basis for Edit #2)
spec/09-configuration.md  # READ-ONLY (sibling P1.M3.T1.S2 owns it) — 'Pi's normal merge' lives here
test/settings.test.ts     # READ-ONLY — settings surface is already unit-tested (no new tests needed)
package.json              # READ-ONLY (sibling P1.M2.T1.S2 owns it) — `typecheck` script already present
plan/.../architecture/docs_spec_research.md  # READ-ONLY research cross-check
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES at most README.md (one required edit + one optional clarification).
README.md   # line 75: "17 knobs" → "19 knobs"  (REQUIRED)
            # line 122: clarify "the tools refuse cleanly" → name the 3 + note checkpoint/audit (OPTIONAL, recommended)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL GOTCHA #1 (the count fix is verified THREE ways): "17 knobs" is wrong; it is 19.
#   README:75 says "All 17 knobs". But:
#     - the README's OWN Defaults table (lines 80-103) lists 19 knob rows;
#     - src/config.ts MulliganConfig interface + DEFAULT_CONFIG have 19 leaf knobs;
#     - spec/09-configuration.md §3 table lists 19 knobs.
#   All three agree on 19. Fix = "17" → "19" (2 characters). The string "17 knobs" appears EXACTLY
#   ONCE in README — grep -n "17 knobs" → README.md:75. No other count claims exist in 67-124.

# CRITICAL GOTCHA #2 ("the tools refuse cleanly" is a blanket; 2 of 5 tools never refuse):
#   rewind/shrink/cancel gate on `config.enabled` and refuse with the exact README:122 string.
#   checkpoint (checkpoint.ts "GOTCHA #4 — no config.checkpoint.enabled switch") and audit
#   (audit.ts "GOTCHA #4 — always-on diagnostics, does NOT refuse when config.enabled===false")
#   have NO config gate. So "the tools refuse cleanly" overclaims for 2 of 5 tools. Edit #2 fixes it.
#   This is in scope: contract says "minor clarifications added ONLY IF the implementation diverges
#   from what the README implies" — it diverges (2 tools don't refuse).

# CRITICAL GOTCHA #3 (do NOT add the "Pi's normal merge" parenthetical to README — it's a spec/09 edit):
#   Contract step (c) says "If the README's language about 'Pi's normal merge' is misleading… add a
#   parenthetical". The README does NOT contain "Pi's normal merge" — that phrase is in spec/09 §1.
#   README:69 says "(project-local overrides global)", which is merge-AGNOSTIC and ACCURATE. So for
#   the README, step (c) is a NO-OP. The parenthetical belongs in spec/09 = sibling P1.M3.T1.S2.
#   Making the README edit would (a) duplicate S2 and (b) be misleading (README never claimed Pi merges).

# CRITICAL GOTCHA #4 (leave the word "lazy" on README:69 — judgment call, do NOT change):
#   README:69 says "loaded lazily on first use". Implementation loads EAGERLY at factory time. The
#   user-facing behavior is identical (read once, cached, re-read on /reload). "First use" = "first
#   load" is defensible; the word matches spec/09 §1; the contract asserts the README is accurate.
#   CHANGING it would diverge README from spec/09 (worse). LEAVE AS-IS. Flag only.

# CRITICAL GOTCHA #5 (em-dash fidelity on the refusal string): README:122 quotes
#   `Mulligan: refused — Mulligan is disabled.` using U+2014 EM DASH. The code emits the SAME em-dash
#   (grep confirms byte-identical). If you touch line 122 for Edit #2, preserve the em-dash — do not
#   "normalize" to a hyphen (-) or en-dash (–). The refusal string itself stays unchanged in Edit #2.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - spec/09-configuration.md → sibling P1.M3.T1.S2 (the "Pi's normal merge" → deepMergeSettings note).
#   - src/* (any source) → production code; this is a doc task.
#   - package.json → sibling P1.M2.T1.S2 (the typecheck script).
#   - test/* → no new tests (settings surface already covered by test/settings.test.ts).
# This PRP edits ONLY README.md (line 75 required; line 122 optional).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a documentation-verification + ≤2-line markdown edit. The "model" is
the verification matrix below: each documented behavior mapped to its post-fix implementation
evidence, with a disposition (✅ accurate / 🔧 fix)._

### Verification matrix (run this BEFORE editing — it IS the task's core logic)

Contract step (b): "Verify every documented behavior now works." Each row below was resolved against
the landed code in research (see `research/verification_findings.md` §A). Reproduce by reading the
cited file:line; all should still hold.

| # | README claim | Evidence (file:line) | Disposition |
|---|--------------|----------------------|-------------|
| 1 | :69 reads `mulligan` from Pi `settings.json` | settings.ts `loadMulliganConfig` → `merged.mulligan` | ✅ no edit |
| 2 | :69 global `~/.pi/agent/settings.json` + `.pi/settings.json` | settings.ts: `getAgentDir()` + `<cwd>/.pi/settings.json` | ✅ no edit |
| 3 | :69 project-local overrides global | settings.ts `deepMergeSettings(global, project)` (project wins) | ✅ no edit |
| 4 | :69 cached for the session | config.ts `getConfig()` cache | ✅ no edit |
| 5 | :69 re-read on `/reload` | index.ts `session_start` → `setConfig(loadMulliganConfig(ctx.cwd))` (all reasons) | ✅ no edit |
| 6 | :71 zero-config / never throws / unknown keys ignored / type-mismatch→default+warn | loadMulliganConfig try/catch→undefined; validateConfig never throws; test/settings.test.ts | ✅ no edit |
| 7 | :80 `enabled:false` → entire extension no-op | filter.ts:240, nudges.ts:122/200, tools rewind:454/shrink:263/cancel:182 gate `config.enabled` | ✅ no edit (see #9) |
| 8 | :122 refuse text `Mulligan: refused — Mulligan is disabled.` | refusal() helpers prepend prefix + `.`; refuse("Mulligan is disabled") = exact (rewind:176, shrink:134, cancel:117) | ✅ exact match (3 tools) |
| 9 | :122 "the tools refuse cleanly" (blanket) | checkpoint.ts + audit.ts have NO config gate (GOTCHA #4) — always-on | 🔧 Edit #2 (clarify) |
| 10 | :75 "All 17 knobs" | table has 19 rows; config.ts DEFAULT_CONFIG has 19; spec/09 §3 has 19 | 🔧 Edit #1 (REQUIRED) |
| 11 | :109–118 minimal example values | all 10 shown values match DEFAULT_CONFIG | ✅ no edit |

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY the matrix (no edit) — read each cited file:line and confirm rows 1-8, 11 are accurate
  - OPEN: src/settings.ts, src/index.ts, src/config.ts, src/tools/{rewind,shrink,cancel,checkpoint,audit}.ts
  - CONFIRM: rows 1-8 + 11 hold (they did at research time). If any has drifted, STOP and re-plan.
  - This is contract step (b): "Verify every documented behavior now works: enabled:false is honored,
    all knobs are read, log.file is respected, /reload re-reads." (log.file: index.ts setLogFile(getConfig().log.file).)

Task 2: EDIT README.md:75 — REQUIRED fix (the count)
  - FIND (verbatim): "All 17 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3)."
  - REPLACE WITH:  "All 19 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3)."
  - That is the ENTIRE edit: the digit pair "17" → "19". Nothing else on the line changes.
  - JUSTIFICATION: README's own table (lines 80-103) has 19 knob rows; config.ts DEFAULT_CONFIG has
    19 leaf knobs; spec/09 §3 has 19. The "17" was stale. Verified by grep: "17 knobs" occurs once.

Task 3: EDIT README.md:122 — OPTIONAL clarification (recommended; implementer's documented choice)
  - DECIDE: (a) leave line 122 unchanged with a written justification, OR (b) clarify it.
  - IF clarifying, the minimal form: change "and the tools refuse cleanly" →
    "and the state-changing tools refuse cleanly" AND append a one-line note that checkpoint/audit
    remain available as always-on read-only diagnostics. See "What" §Edit #2 for the blockquote form.
  - JUSTIFICATION (why it is in scope): checkpoint.ts + audit.ts have NO config.enabled gate (in-code
    "GOTCHA #4"). So "the tools refuse cleanly" overclaims for 2 of 5 tools. Contract explicitly
    permits "minor clarifications… only if the implementation diverges" — it diverges.
  - PRESERVE: the exact refusal string `Mulligan: refused — Mulligan is disabled.` (em-dash U+2014,
    trailing period) — do NOT touch the quoted string itself, only the surrounding prose.

Task 4: VALIDATE — no regression (contract step e)
  - RUN: `npm run typecheck`   → expect exit 0 (no output).  [script added by sibling P1.M2.T1.S2]
  - RUN: `npx vitest run`      → expect all pass (≥882; currently 912).  [README edit can't break tests]
  - RUN: `grep -n "17 knobs" README.md` → expect NO matches (proves Task 2 landed; the only prior match was line 75).
  - RUN: `grep -cE '^\| `[a-z]' README.md | head` sanity — the Defaults table still has 19 knob rows.

Task 5: SCOPE-GUARD self-check
  - CONFIRM no file other than README.md was modified: `git status --short` should list ONLY README.md.
  - CONFIRM spec/09-configuration.md was NOT touched (that is sibling P1.M3.T1.S2 — the "Pi's normal
    merge" parenthetical lives THERE, not in README). `git diff --name-only` must not include spec/09.
```

### Implementation Patterns & Key Details

```markdown
# This is a docs task — the only "pattern" is: verify-then-edit-minimally. Two notes:

# (1) Edit #1 is a 2-character change on a single line. Do NOT reflow the line, reword the parenthetical,
#     or touch the table. Just 17 → 19. The rest of README:75 is accurate (the DEFAULT_CONFIG / spec/09
#     §3 citations are correct).

# (2) Edit #2 (if taken) is ADDITIVE: it narrows "the tools" → "the state-changing tools" and adds a
#     clarifying note. It must NOT alter the quoted refusal string `Mulligan: refused — Mulligan is
#     disabled.` — that string is byte-exact with the code's refusal() output for rewind/shrink/cancel.

# (3) The "Pi's normal merge" parenthetical from contract step (c) is NOT applied here. The README does
#     not contain that phrase (README:69 says "project-local overrides global"). It belongs in spec/09
#     §1 — that is sibling P1.M3.T1.S2. Adding it to README would be both out-of-scope and misleading.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only edit (Mode B).
  - DATABASE: none
  - CONFIG: none (src/config.ts is READ-ONLY — the 19-knob source of truth, not edited)
  - ROUTES: none
  - DEPENDENCIES: none
  - CODE: none (all src/* is READ-ONLY verification evidence)
  - DOCS: README.md ONLY. spec/09-configuration.md is explicitly OUT OF SCOPE (sibling P1.M3.T1.S2
          owns the "Pi's normal merge → deepMergeSettings" parenthetical there).
  - The only "integration" is TRUTHINESS: after Edit #1, README:75's count == its own table (19) ==
          config.ts DEFAULT_CONFIG (19) == spec/09 §3 (19). Four-way agreement.
```

---

## Validation Loop

A documentation edit cannot break the build, but the contract (step e) requires the two project
gates to pass as the final validation. Run all three levels.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The required count fix landed and is the ONLY "17"→"19" change.
grep -n "17 knobs" README.md          # Expected: NO output (no matches). If it prints line 75, Edit #1 didn't land.
grep -n "19 knobs" README.md          # Expected: prints README.md:75 exactly.

# (b) The Defaults table still has 19 knob rows (sanity — you didn't accidentally delete a row).
grep -cE '^\| `(enabled|rewind|shrink|nudges|audit|log)\.' README.md   # Expected: 18 (all dotted knobs)
# plus the bare `enabled` row (line 80) = 19 total. (The regex above matches dotted-path knobs; the
# top-level `enabled` is on its own line — count it separately: grep -nE '^\| `enabled`' → 1.)

# (c) If you took Edit #2, the refusal string is byte-intact (em-dash + trailing period preserved).
grep -nF 'Mulligan: refused — Mulligan is disabled.' README.md   # Expected: prints line 122 (or the note you added).
```
Expected: (a) shows 0 matches for "17" and 1 for "19"; (b) shows 19 knob rows total; (c) shows the
exact em-dash string present.

### Level 2: Unit Tests (Component Validation)

```bash
# N/A for a README edit — there is no "unit". But the settings surface IS tested; confirm green:
npx vitest run test/settings.test.ts    # Expected: all settings tests pass (readSettingsFile / deepMergeSettings / loadMulliganConfig).
# This is a regression sanity check only; the README edit changes no code.
```

### Level 3: Integration Testing (System Validation) — the contract's required gates

```bash
# Contract step (e): "Run `npx tsc --noEmit` (exit 0) and `npx vitest run` (882+ tests pass)."
npm run typecheck        # = tsc --noEmit (script added by sibling P1.M2.T1.S2). Expected: exit 0, no output.
echo "typecheck exit: $?" # Expected: 0

npx vitest run            # Expected: 21 files, 912 tests passed, 0 failed (912 ≥ 882 baseline).
                         # (Count rose from 882→912 because P1.M1 added test/settings.test.ts.)
```
Expected: `npm run typecheck` exits 0; `npx vitest run` passes all (≥882, currently 912).

### Level 4: Creative & Domain-Specific Validation

```bash
# Scope guard (the most important doc-task check): ONLY README.md changed.
git status --short        # Expected: " M README.md" (and nothing else). If any other file appears, you went out of scope.
git diff --stat           # Expected: README.md | 2 +-(ish) for Edit #1 alone, or a few more lines if Edit #2 taken.
git diff --name-only | grep -E 'spec/09|package.json|src/' && echo "OUT OF SCOPE — revert" || echo "scope OK"
                         # Expected: "scope OK" (spec/09, package.json, and src/ must NOT appear in the diff).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exits 0 (the BUG-002 gate; green post-P1.M2).
- [ ] `npx vitest run` — all tests pass (≥882; currently 912). README edits cannot change this — if it
      changes, scope leaked into code; revert and re-check.
- [ ] `grep -n "17 knobs" README.md` → no matches; `grep -n "19 knobs" README.md` → line 75 only.

### Feature Validation
- [ ] README:75 reads "All **19** knobs" and the count agrees with its own table (19 rows), config.ts
      DEFAULT_CONFIG (19 leaf knobs), and spec/09 §3 (19 rows).
- [ ] README:122 either unchanged (with written justification) OR clarified to name the 3 refusing
      tools (rewind/shrink/cancel) and note checkpoint/audit are always-on read-only diagnostics.
- [ ] The refusal string `Mulligan: refused — Mulligan is disabled.` is byte-intact (em-dash + period).
- [ ] Verification matrix rows 1–8 + 11 all confirmed accurate against the code (no edit needed).
- [ ] README:69's "(project-local overrides global)" merge wording left accurate and untouched (the
      "Pi's normal merge" parenthetical is spec/09 = sibling P1.M3.T1.S2, NOT this task).

### Code Quality / Scope Discipline
- [ ] Modified ONLY `README.md` (`git status --short` shows nothing else).
- [ ] Did NOT edit `spec/09-configuration.md` (sibling P1.M3.T1.S2 — owns the deepMergeSettings note).
- [ ] Did NOT edit `package.json` (sibling P1.M2.T1.S2 — owns the typecheck script).
- [ ] Did NOT edit any `src/*` or `test/*` (this is a documentation task).
- [ ] Did NOT change the "lazy on first use" wording on README:69 (judgment: leave; it is defensible
      and matches spec/09; changing it would diverge README from spec/09).

### Documentation
- [ ] README §3 Configuration + Disabling now describe the real post-fix behavior with no stale count
      and no over-broad tool-refusal claim.
- [ ] The change is minimal: one required count fix + at most one clarification sentence.

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" things the matrix already marks ✅. README:69's merge wording, the zero-config block,
  the cached/re-read claims, the refusal string, and the example values are all accurate — leave them.
- ❌ Don't add the "Mulligan reads files directly / deepMergeSettings" parenthetical to README. The README
  never claimed "Pi's normal merge" (that phrase is in spec/09 §1 = sibling P1.M3.T1.S2). Adding it to
  README is out-of-scope AND misleading.
- ❌ Don't reword README:75 beyond `17` → `19`. The DEFAULT_CONFIG / spec/09 §3 citations on that line
  are correct; only the count was stale.
- ❌ Don't alter the quoted refusal string `Mulligan: refused — Mulligan is disabled.` when doing Edit #2.
  It is byte-exact with the code; only narrow the surrounding prose ("the tools" → "the state-changing tools").
- ❌ Don't "normalize" the em-dash (—) to a hyphen or en-dash. README and code both use U+2014.
- ❌ Don't change "loaded lazily on first use" on README:69. The implementation loads eagerly at factory
  time, but user-facing behavior is identical, the word matches spec/09, and the contract says the README
  is accurate. Changing it would diverge README from spec/09 — a net negative.
- ❌ Don't touch spec/09, package.json, or any src/test file. `git status --short` must show README.md only.
- ❌ Don't skip the `npm run typecheck` / `npx vitest run` gates because "it's just a doc edit" — the
  contract (step e) requires them as the final validation, and they confirm the full changeset is green.

---

## Confidence Score

**9/10** for one-pass implementation success. The task is a tiny, well-bounded documentation
verification: one REQUIRED 2-character count fix (`17`→`19`, verified three independent ways — the
README's own table, config.ts DEFAULT_CONFIG, and spec/09 §3 all agree on 19) plus one OPTIONAL
clarification sentence (where the only judgment is whether to add it, not what it should say — the
divergence is concretely documented: checkpoint/audit have no config gate per in-code GOTCHA #4).
Every other documented behavior in README §3 + Disabling is mapped to its post-fix implementation
evidence (file:line) and confirmed accurate. The two validation gates are confirmed green at research
time (`npm run typecheck` exit 0; 912 tests pass). The scope fence is explicit (README only; spec/09
is sibling P1.M3.T1.S2; the "Pi's normal merge" parenthetical is a NO-OP for README). The one point
of residual uncertainty is the implementer's judgment call on Edit #2 and the "lazy" word — both are
clearly documented with a recommended disposition, hence not 10/10.