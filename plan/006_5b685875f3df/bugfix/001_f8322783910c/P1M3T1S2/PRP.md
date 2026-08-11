# PRP — P1.M3.T1.S2: Update README.md to reflect drift-nudge and tool-disabled behavior changes

## Goal

**Feature Goal**: Sync **`README.md`** (root, 26 KB, 275 lines) to the post-fix codebase after the bug-fix
round (P1.M1 BUG-001/002/003 + P1.M2 BUG-004/005/006/007). A precise grep of README.md finds that **only
TWO** of the contract's four candidate touchpoints have stale claims: **(a) the drift-nudge threshold
(6000 → 4000, BUG-003)** and **(d) the checkpoint tool's disabled behavior (now gated, BUG-007)**. The
other two (suppressCheck suppression window; compaction/pinned-hide) are **NO-OPs** — README never made
the now-stale claim for them, so per the contract's own rule ("if README does not reference these
specifics, no changes needed") they are left untouched.

**Deliverable**: Surgical edits to **`README.md` ONLY** — (1) line 98 (the `driftThresholdTokens` table
row: Default `6000`→`4000` + a rewritten rationale reflecting the `>`→`>=` comparison fix and §5.1
criterion (b)); (2) line 116 (the JSON example: `driftThresholdTokens: 6000`→`4000`); (3) line 123 (the
Disabling paragraph: "four state-affecting tools" → "five tools", and remove the false "Only `checkpoint`
remains available as an always-on read-only diagnostic" claim — checkpoint now refuses like the others
per BUG-007). No other file. No new "Resolved bugs" round-2 table (that lives in VERIFICATION.md, owned
by sibling S1).

**Success Definition**: After the edits, (a) README's `driftThresholdTokens` Default and JSON example both
read `4000`, and the rationale explains the lowering + `>=` comparison (not the stale "Raised from 3k …
makes 6k a quiet trip point"); (b) the Disabling paragraph states all FIVE tools refuse when
`enabled: false`, with no "always-on checkpoint" exception; (c) `grep -n "6000" README.md` returns no
`driftThresholdTokens` hits; (d) `grep -niE "always-on|checkpoint.*remains available|four state-affecting"
README.md` returns 0; (e) `npm run typecheck` exits 0 and `npx vitest run` passes (no-regression sanity —
README edits are non-behavioral); (f) no file other than `README.md` is modified.

> ⚠️ **This is a [Mode B] documentation-sync task — NOT a code change.** The implementation work (P1.M1 +
> P1.M2) is COMPLETE. This task SWEEPS README.md for coherence with the landed changeset. Scope is tiny:
**3 small prose edits in README.md. The contract's 4-touchpoint list is a SEARCH DIRECTIVE, not an edit
> list — 2 of the 4 are no-ops (verified by grep). Do NOT add undocumented behavior (suppressCheck,
> pinned-hide-vs-compaction) to README — that's scope-creep; the code owners documented the fixes in
> VERIFICATION.md (sibling S1).**

## User Persona (if applicable)

**Target User**: Developers / end users reading README.md to learn how to configure Mulligan (the config
table + JSON example) and what happens when it's disabled (the Disabling section).

**Use Case**: (1) A user reads the config table to pick a `driftThresholdTokens` value; the Default +
rationale must match the actual post-fix default (4000) and explain WHY (the §5.1 criterion-(b) fix).
(2) A user adds `"mulligan": { "enabled": false }` and reads the Disabling section to know what to expect
— they must be told ALL FIVE tools now refuse, not that checkpoint stays on.

**Pain Points Addressed**: Pre-sync, README advertises a stale default (`6000`) with a rationale ("Raised
from 3k … makes 6k a quiet trip point") that is the OPPOSITE of the post-fix story (lowered to 4000 + `>=`
to fire on sustained ~4k/turn growth per §5.1 (b)). Worse, the Disabling section promises checkpoint "remains
available as an always-on read-only diagnostic" — a capability BUG-007 removed. Both mislead a user
configuring or disabling the extension.

## Why

- **Truth-in-docs (config table accuracy)**: README:98 advertises `driftThresholdTokens: 6000`, but
  `src/config.ts:158` is `4000`. A user copying the "Default" column sets the wrong value. The rationale
  is doubly stale: it claims the threshold was "Raised from 3k" (it was LOWERED from 6000 to 4000) and
  that "6k [is] a quiet, accurate trip point" (6k + strict `>` FAILED §5.1 criterion (b); the fix is
  4000 + `>=`).
- **Truth-in-docs (E14 disabled contract)**: README:123 explicitly exempts checkpoint from the no-op
  contract ("Only `checkpoint` remains available as an always-on read-only diagnostic"). BUG-007
  (`src/tools/checkpoint.ts:138` — `if (!getConfig().enabled) return refuse(...)`) reversed this: all five
  tools now refuse when disabled. The README must match.
- **Respect sibling boundaries**: the VERIFICATION.md fix-log + DoD #4 refresh is sibling P1.M3.T1.S1's
  scope. README's prior "Resolved bugs (BUG-001–BUG-006)" table (lines 255-260) is a PRIOR round's accurate
  history — the current round re-uses BUG-001..BUG-007 for DIFFERENT issues, so we do NOT touch that table
  (number-collision guard). The round-2 fix-log lives in VERIFICATION.md (S1), not README.
- **[documentation task]**: this IS the changeset-level documentation sync for README (contract DOCS clause).

## What

Three edits in `README.md`. All are REQUIRED (each fixes a verified stale claim). Two of the contract's
four touchpoints (suppressCheck, compaction/pinned-hide) are NO-OPs — README never documented them.

**Edit 1 (REQUIRED)** — README:98, the `driftThresholdTokens` table row:
```diff
-| `nudges.driftThresholdTokens` | `6000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. Raised from the previous 3k default after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point. |
+| `nudges.driftThresholdTokens` | `4000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. The moving average over `driftWindowTurns` is compared with `>=` (not `>`), so sustained growth of ~4k/turn over the window fires (§5.1 criterion (b)) while a single heavy turn amid small ones does not (§5.1 (a)); the earlier 6k + strict-`>` default failed to fire on three consecutive ~4k turns. |
```

**Edit 2 (REQUIRED)** — README:116, the JSON example:
```diff
-  //   "nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "read": 24576 }, "driftThresholdTokens": 6000, "driftWindowTurns": 3, "highWaterFraction": 0.7 }
+  //   "nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "read": 24576 }, "driftThresholdTokens": 4000, "driftWindowTurns": 3, "highWaterFraction": 0.7 }
```

**Edit 3 (REQUIRED)** — README:123, the Disabling paragraph:
```diff
-`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and the four state-affecting tools refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, **and `audit`** all gate on the master switch — audit refuses when disabled while staying read-only). Only `checkpoint` remains available as an always-on read-only diagnostic (it sets a harmless label, no transform). The human can disable Mulligan without uninstalling it.
+`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and **all five tools** refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, `audit`, **and `checkpoint`** all gate on the master switch — each refuses before doing any work; `audit` refuses while staying read-only in its normal operation). The human can disable Mulligan without uninstalling it.
```

### Success Criteria

- [ ] README:98 `driftThresholdTokens` Default reads `4000` and the rationale explains the lowering + `>=`
      comparison + §5.1 criterion (b) (no "Raised from 3k" / "6k a quiet trip point" language remains).
- [ ] README:116 JSON example reads `"driftThresholdTokens": 4000`.
- [ ] README:123 Disabling paragraph names all FIVE tools (rewind/shrink/cancel/audit/checkpoint) as refusing
      when disabled; no "Only `checkpoint` remains available" / "always-on" exception remains.
- [ ] `grep -n "6000" README.md` returns 0 `driftThresholdTokens` hits (verify any other `6000` is unrelated).
- [ ] `grep -niE "always-on|checkpoint.*remains available|four state-affecting" README.md` returns 0.
- [ ] Did NOT add a suppressCheck or pinned-hide/compaction description (those touchpoints are no-ops — README
      never documented them; adding would be scope-creep).
- [ ] Did NOT edit the prior "Resolved bugs (BUG-001–BUG-006)" table (lines 255-260) — it's a prior round's
      accurate history; the round-2 fix-log lives in VERIFICATION.md (sibling S1).
- [ ] `npm run typecheck` exits 0; `npx vitest run` passes (no-regression sanity).
- [ ] No file other than `README.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the precise grep results proving only 2 of 4 touchpoints need edits (the other
2 are verified no-ops); the verbatim FIND text (exact lines 98, 116, 123 with unique anchors) and verbatim
REPLACE text for all three edits; the post-fix source evidence behind each (file:line — `config.ts:158`
=4000, `nudges.ts:321-322,296-299` = `>=` + §5.1 proof, `checkpoint.ts:138` = gate); the explicit
scope fence (README only; VERIFICATION.md/spec/src/test are out of scope; the prior Resolved-bugs table
is preserved); and the two no-regression gates (`typecheck`, `vitest`) confirmed green. The implementer
opens one file and runs grep.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: README.md
  why: Three stale claims: (1) line 98 driftThresholdTokens table row (Default 6000 + stale rationale);
        (2) line 116 JSON example (driftThresholdTokens: 6000); (3) line 123 Disabling paragraph
        ("four state-affecting tools" + "Only checkpoint remains available as an always-on ...").
  section: "§3 Configuration table (~lines 78-100) + JSON example (~lines 109-117) + Disabling subsection
            (~lines 118-124)."
  pattern: "Markdown prose + a config Defaults table + a commented-out JSON example + a Disabling paragraph.
            Use TEXT anchors (the unique stale substrings), not line numbers — the file may have shifted."
  gotcha: "Line 98's rationale is DOUBLY stale: it claims the threshold was 'Raised from 3k' (it was LOWERED
           6000→4000) AND that '6k [is] a quiet, accurate trip point' (6k + strict > FAILED §5.1 (b)). The
           rewrite must reflect the real story: lowered to 4000 + comparison >→>= so sustained ~4k/turn fires."

# MUST READ — the post-fix source state (verify the values/behavior the doc must quote)
- file: src/config.ts
  why: line 158 `driftThresholdTokens: 4000` — confirms BUG-003 (was 6000). Edits 1 + 2 quote 4000.
  critical: "READ-ONLY. The Default column + JSON example must read 4000 to match this."

# MUST READ — the shouldNudge fix (BUG-003: > → >=) + §5.1 proof
- file: src/nudges.ts
  why: lines 321-322 `shouldNudge` slices recentMetrics + compares `avg >= driftThresholdTokens` (the >→>=
        fix); lines 296-299 JSDoc proves all three §5.1 criteria hold with >= + 4000:
        (a) avg([8k,0.5k,0.5k])=3k >= 4k? No → no fire; (b) avg([4k,4k,4k])=4k >= 4k? Yes → fire;
        (c) avg(~0) >= 4k? No → no fire. This is the rationale Edit 1 must summarize.
  critical: "READ-ONLY. The rewritten rationale on line 98 must say the comparison is >= (not >) and that
             sustained ~4k/turn growth fires (§5.1 (b)) while a single heavy turn does not (§5.1 (a))."

# MUST READ — the checkpoint gate (BUG-007) — the authority for Edit 3
- file: src/tools/checkpoint.ts
  why: lines 27-28 JSDoc + line 138 `if (!getConfig().enabled) return { content:[{type:"text", text:
        "Mulligan: refused — Mulligan is disabled."}], ... }` — confirms checkpoint is now gated, refuses
        BEFORE name validation (no label written), same text as the other four tools.
  critical: "READ-ONLY. Edit 3's claim 'all five tools ... refuse' traces to this. The refusal text is
             byte-identical across all five tools (rewind/shrink/audit/cancel/checkpoint)."

# CONTEXT — the contract's 4 touchpoints, with the grep verdict per touchpoint
- note: "Precise README grep this session found: (a) driftThreshold 6000 → 3 hits (STALE, fix); (b) suppressCheck
         / '10 min' / 'turn-based' → 0 hits (NO-OP — README never documented the suppression window); (c) compaction
         / pinned-hide → hits are about E7 (transient summary leak) and shrink-target robustness, NOT pinned-hide
         permanence (NO-OP — README makes no pinned-hide-survives-compaction claim); (d) checkpoint 'always-on'
         / 'remains available' → 1 hit at line 123 (STALE, fix). So only (a) and (d) need edits."

# CONTEXT — the sibling PRP (VERIFICATION.md sync — confirms scope split)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M3T1S1/PRP.md
  why: CONTRACT. S1 owns VERIFICATION.md (the DoD #4 refresh, checkpoint-note rewrite, AND the round-2 fix-log
        table for BUG-001..BUG-007). S1 explicitly does NOT touch README.md — that is THIS task. Zero file
        overlap: S1 edits VERIFICATION.md, S2 edits README.md. The round-2 fix-log LIVES IN VERIFICATION.md,
        so S2 does NOT add a round-2 table to README.
  gotcha: "Do NOT add a 'round 2' Resolved-bugs table to README — S1 adds it to VERIFICATION.md. README's
           existing 'Resolved bugs (BUG-001–BUG-006)' table (lines 255-260) is a PRIOR round's history; leave it."

# CONTEXT — the spec authorities (for the rationale wording)
- file: spec/07-preventive-and-nudges.md
  why: §5.1 defines the three drift-nudge acceptance criteria: (a) a single ~8k turn amid small ones does NOT
        fire; (b) three ~4k turns in a row DO fire; (c) a single big result with ~0 net growth does NOT fire.
        BUG-003's fix (4000 + >=) makes shouldNudge satisfy all three. The rewritten rationale on line 98 cites §5.1.
  critical: "READ-ONLY. The rationale must reference §5.1 (b) as the reason for the lowering + >=."
- file: spec/08-edge-cases.md
  why: E14 ('tools refuse when disabled') is the contract BUG-007 satisfies. Edit 3's 'all five tools refuse'
        traces to E14.
  critical: "READ-ONLY."

# EXTERNAL — markdown fidelity
- note: "README uses standard markdown: a pipe-delimited config table, a fenced jsonc code block (the example),
         and prose paragraphs. Preserve the table's column alignment (Edit 1 keeps the row on one logical line;
         the cell content can wrap). Preserve the jsonc comment prefix `//` on the JSON example (Edit 2). The
         refusal string `Mulligan: refused — Mulligan is disabled.` uses U+2014 EM DASH (—) — do not normalize
         to a hyphen/en-dash in Edit 3."
```

### Current Codebase tree (the relevant slice)

```bash
README.md                  # ← THIS task edits 3 spots: line 98 (table row), 116 (JSON example), 123 (Disabling para)
src/config.ts              # READ-ONLY — driftThresholdTokens:4000 (line 158); verifies Edits 1+2
src/nudges.ts              # READ-ONLY — shouldNudge >= (321-322) + §5.1 proof (296-299); verifies Edit 1 rationale
src/tools/checkpoint.ts    # READ-ONLY — getConfig().enabled gate (line 138); verifies Edit 3
VERIFICATION.md            # READ-ONLY (sibling P1.M3.T1.S1 owns it — DoD #4 + checkpoint note + round-2 fix-log)
spec/07-preventive-and-nudges.md  # READ-ONLY — §5.1 (the drift-nudge criteria authority)
spec/08-edge-cases.md      # READ-ONLY — E14 (the tools-refuse-when-disabled authority)
plan/.../architecture/system_context.md  # READ-ONLY — the 7 bug descriptions (cross-check)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly README.md (3 prose edits):
README.md   # line 98:  driftThresholdTokens 6000→4000 + rewritten rationale (BUG-003)
            # line 116: JSON example driftThresholdTokens 6000→4000 (BUG-003)
            # line 123: Disabling para — "four"→"five tools", remove "always-on checkpoint" exception (BUG-007)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL GOTCHA #1 (the contract OVER-CLAIMS touchpoints — 2 of 4 are NO-OPs): a precise grep finds README
#   has ZERO references to the suppressCheck suppression window ("10 min"/"minutes"/"turn-based" → 0 hits) and
#   makes NO claim that pinned hides survive compaction (the compaction hits are about E7 transient summary
#   leak and shrink-target robustness — DIFFERENT issues). Per the contract's own rule ("if README does not
#   reference these specifics, no changes needed"), touchpoints (b) suppressCheck and (c) compaction/pinned-hide
#   are NO-OPs. Do NOT add new descriptions of them — that is scope-creep (the code owners' job, documented in
#   VERIFICATION.md by sibling S1). Only (a) drift threshold and (d) checkpoint gate need edits.

# CRITICAL GOTCHA #2 (line 98's rationale is DOUBLY stale — rewrite, don't patch): the current text says
#   "Raised from the previous 3k default ... the §5.1 windowing is what makes 6k a quiet, accurate trip point."
#   Post-fix the story is the OPPOSITE: the threshold was LOWERED 6000→4000 AND the comparison changed >→>=
#   because 6k + strict > FAILED §5.1 criterion (b) (avg([4k,4k,4k])=4k was not > 6000 → no fire). The rewrite
#   must say: lowered to 4000 + >= so sustained ~4k/turn growth over the window fires (§5.1 (b)) while a single
#   heavy turn does not (§5.1 (a)). Do NOT keep any "Raised from 3k" / "6k a quiet trip point" language.

# CRITICAL GOTCHA #3 (Edit 3 removes TWO false claims, not one): the Disabling paragraph (line 123) is wrong on
#   two counts — (i) "the FOUR state-affecting tools refuse" (now FIVE — checkpoint joined via BUG-007), and
#   (ii) "Only checkpoint remains available as an always-on read-only diagnostic (it sets a harmless label,
#   no transform)" (checkpoint now refuses like the others — no always-on exception). The rewrite states all
#   five tools refuse; the "Only checkpoint remains" sentence is DELETED entirely.

# CRITICAL GOTCHA #4 (do NOT add a round-2 Resolved-bugs table to README): README's "Resolved bugs (BUG-001–
#   BUG-006)" table (lines 255-260) is a PRIOR round's accurate history (checkpoint-consumption, config-floor,
#   empty-needle, audit-gate, etc.). The CURRENT round re-uses BUG-001..BUG-007 for DIFFERENT issues. The
#   round-2 fix-log LIVES IN VERIFICATION.md (sibling S1 adds it there, where the prior round's table already
#   lives). Do NOT touch README's prior table and do NOT add a new one — number-collision confusion.

# CRITICAL GOTCHA #5 (em-dash fidelity in the refusal string): the refusal text `Mulligan: refused — Mulligan
#   is disabled.` uses U+2014 EM DASH (—). Edit 3's replacement must preserve it — do not "normalize" to a
#   hyphen (-) or en-dash (–). The existing line 123 already uses the em-dash; keep it.

# CRITICAL GOTCHA #6 (verify no OTHER "6000" in README is driftThreshold-related): after Edit 1+2,
#   `grep -n "6000" README.md` should return 0 driftThreshold hits. If it returns a hit, check whether it's
#   an unrelated number (e.g. a token estimate in an example). Only the driftThresholdTokens Default (line 98)
#   and JSON example (line 116) should have changed. The perTurnDrift row (line 95) says "token threshold"
#   generically (no number) — LEAVE IT.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - VERIFICATION.md → sibling P1.M3.T1.S1 (owns the DoD #4 + checkpoint note + round-2 fix-log).
#   - src/* and test/* → the fixes' owners (P1.M1/P1.M2); READ-ONLY.
#   - spec/* → READ-ONLY (spec/07 §5.1, spec/08 E14 are the cited authorities).
#   - README's "Resolved bugs (BUG-001–BUG-006)" table (lines 255-260) → PRIOR round's history; preserve.
#   - Adding suppressCheck / pinned-hide-vs-compaction descriptions → NO-OP touchpoints; scope-creep.
# This PRP edits ONLY README.md (3 prose spots: lines 98, 116, 123).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a 3-spot markdown prose sync. The "model" is the mapping from the 3 stale
README claims to the verified post-fix source state (quoted per edit above in §What)._

### Implementation Tasks (ordered by dependencies)

Three independent edits; apply in any order. Use TEXT anchors (unique stale substrings), not line numbers.

```yaml
Task 1: EDIT README.md:98 — driftThresholdTokens table row (Default + rationale) [BUG-003]
  - FIND (verbatim — the full table row; unique anchor — the cell starts "`nudges.driftThresholdTokens` | `6000`"):
      "| `nudges.driftThresholdTokens` | `6000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. Raised from the previous 3k default after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point. |"
  - REPLACE WITH (Default 6000→4000; rationale rewritten to reflect lowering + >= + §5.1 (b)):
      "| `nudges.driftThresholdTokens` | `4000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. The moving average over `driftWindowTurns` is compared with `>=` (not `>`), so sustained growth of ~4k/turn over the window fires (§5.1 criterion (b)) while a single heavy turn amid small ones does not (§5.1 (a)); the earlier 6k + strict-`>` default failed to fire on three consecutive ~4k turns. |"
  - RATIONALE: src/config.ts:158 is 4000; src/nudges.ts:321-322 uses >=; src/nudges.ts:296-299 proves §5.1 (b)
    now holds. The old "Raised from 3k / 6k a quiet trip point" rationale describes the pre-fix state.
  - PRESERVE: the table row's pipe structure and the §5.1 spec link. Keep it one logical table row.

Task 2: EDIT README.md:116 — JSON example driftThresholdTokens [BUG-003]
  - FIND (verbatim — the commented JSON line; unique anchor — the inline "driftThresholdTokens": 6000):
      "  //   \"nudges\": { \"bloatThresholdBytes\": 16384, \"bloatThresholdBytesByTool\": { \"read\": 24576 }, \"driftThresholdTokens\": 6000, \"driftWindowTurns\": 3, \"highWaterFraction\": 0.7 }"
  - REPLACE WITH (6000 → 4000; everything else on the line unchanged):
      "  //   \"nudges\": { \"bloatThresholdBytes\": 16384, \"bloatThresholdBytesByTool\": { \"read\": 24576 }, \"driftThresholdTokens\": 4000, \"driftWindowTurns\": 3, \"highWaterFraction\": 0.7 }"
  - RATIONALE: the example must match the Default (Task 1) and src/config.ts:158. A user copying the example
    should get the real default.
  - PRESERVE: the `//` comment prefix and all other knobs on the line. Change ONLY the 6000→4000 digit.

Task 3: EDIT README.md:123 — Disabling paragraph (checkpoint now gated) [BUG-007]
  - FIND (verbatim — the full paragraph; unique anchor — "the four state-affecting tools refuse cleanly"):
      "`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and the four state-affecting tools refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, **and `audit`** all gate on the master switch — audit refuses when disabled while staying read-only). Only `checkpoint` remains available as an always-on read-only diagnostic (it sets a harmless label, no transform). The human can disable Mulligan without uninstalling it."
  - REPLACE WITH (five tools; remove the always-on checkpoint exception):
      "`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and **all five tools** refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, `audit`, **and `checkpoint`** all gate on the master switch — each refuses before doing any work; `audit` refuses while staying read-only in its normal operation). The human can disable Mulligan without uninstalling it."
  - RATIONALE: src/tools/checkpoint.ts:138 added getConfig().enabled (BUG-007) — checkpoint now refuses with
    the same text as the other four tools. The "Only checkpoint remains available as an always-on read-only
    diagnostic" sentence is deleted (it describes the pre-fix state).
  - PRESERVE: the em-dash (U+2014) in the refusal string; the backticks around tool names and the refusal
    text; the "The human can disable Mulligan without uninstalling it." closing sentence.

Task 4: VALIDATE — grep gates + no-regression sanity
  - RUN: `grep -n "6000" README.md` → expect 0 driftThreshold hits (verify any hit is unrelated).
  - RUN: `grep -niE "always-on|checkpoint.*remains available|four state-affecting" README.md` → expect 0 hits.
  - RUN: `grep -n "driftThresholdTokens.*4000\|all five tools"` README.md → expect hits (the new claims landed).
  - RUN: `npm run typecheck` → expect exit 0 (README edits can't affect tsc; sanity only).
  - RUN: `npx vitest run` → expect suite green (README edits can't affect tests; sanity only).

Task 5: SCOPE-GUARD self-check
  - CONFIRM no file other than README.md was modified: `git status --short` lists ONLY README.md.
  - CONFIRM VERIFICATION.md, spec/*, src/*, test/* were NOT touched.
    `git diff --name-only | grep -vE '^README.md$'` → expect NO output.
```

### Implementation Patterns & Key Details

```markdown
# This is a docs task — the only "pattern" is: grep-verify-then-edit-minimally. Three notes:

# (1) Edit 1 is a full-row rewrite (the rationale is doubly stale — can't patch a word or two). The new
#     rationale cites §5.1 (b) and the >= comparison. Keep the row as one logical table line (the cell
#     content may wrap visually; that's fine).

# (2) Edit 2 is a single-digit change on one line (6000 → 4000). Do NOT touch any other knob on the JSON
#     example line. The `//` comment prefix stays.

# (3) Edit 3 deletes the "Only checkpoint remains available..." sentence entirely and changes "four" to
#     "five tools" (naming checkpoint in the refusal list). The refusal string itself is UNCHANGED (still
#     `Mulligan: refused — Mulligan is disabled.` with the em-dash). Only the surrounding prose changes.

# (4) The 2 NO-OP touchpoints: do NOT add a suppressCheck description (README never had one) and do NOT add
#     a pinned-hide-vs-compaction note (README's compaction mention is E7, a different issue). Adding either
#     is scope-creep; the fixes are documented in VERIFICATION.md by sibling S1.
```

### Integration Points

```yaml
NO CODE/CONFIG/ROUTE INTEGRATION — documentation-only (Mode B doc sync).
  - DATABASE: none
  - CONFIG: none (src/config.ts is READ-ONLY — the 4000 value the doc quotes, not edited)
  - ROUTES: none
  - CODE: none (all src/* is READ-ONLY verification evidence)
  - TESTS: none (README edits are non-behavioral; the fixes' regression tests are in P1.M1/P1.M2)
  - DOCS: README.md ONLY. VERIFICATION.md is sibling P1.M3.T1S1's scope. This IS the changeset-level
          documentation task for README (contract DOCS clause).
  - PARALLEL-SIBLING COORDINATION: S1 edits VERIFICATION.md (DoD #4 + checkpoint note + round-2 fix-log);
          S2 edits README.md. Zero file overlap. The round-2 fix-log lives in VERIFICATION.md, NOT README.
  - The only "integration" is DOC CONSISTENCY: README's driftThresholdTokens Default (4000) must match
          src/config.ts:158; README's Disabling claim (all five tools refuse) must match the 5 gate sites
          (filter + rewind/shrink/audit/cancel/checkpoint). The grep gates enforce this.
```

---

## Validation Loop

A README-only edit cannot break the build. Validation = grep confirms the stale claims are gone + the new
claims are present + they match the source, plus a no-regression sanity run.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The stale driftThreshold 6000 is GONE from the table + JSON example:
grep -n '"driftThresholdTokens": 6000\|| `6000` |' README.md      # EXPECT: 0 hits (both the table cell + JSON example).
grep -n 'driftThresholdTokens.*4000\|"driftThresholdTokens": 4000' README.md  # EXPECT: ≥2 hits (table row + JSON example).

# (b) The stale rationale language is GONE:
grep -niE 'Raised from the previous 3k|6k a quiet, accurate trip point' README.md  # EXPECT: 0 hits.

# (c) The stale Disabling claims are GONE:
grep -niE 'always-on|checkpoint.*remains available|four state-affecting' README.md  # EXPECT: 0 hits.

# (d) The new Disabling claim is PRESENT:
grep -niE 'all five tools|`checkpoint`.*gate on the master' README.md  # EXPECT: ≥1 hit (the rewritten paragraph).

# (e) Em-dash fidelity preserved in the refusal string:
grep -nF 'Mulligan: refused — Mulligan is disabled.' README.md  # EXPECT: ≥1 hit (the em-dash U+2014 is intact).
```
Expected: (a) 0 stale / ≥2 new; (b) 0; (c) 0; (d) ≥1; (e) the em-dash string present.

### Level 2: Cross-doc consistency (the core gate — README agrees with the source)

```bash
# README's driftThresholdTokens Default must match src/config.ts:
echo "--- source: driftThresholdTokens default (BUG-003) ---"
grep -n 'driftThresholdTokens:' src/config.ts                    # EXPECT: 4000. README line 98 + 116 must say 4000.

# README's "all five tools refuse" must match the actual gate sites:
echo "--- source: the 5 tool config-gate sites (BUG-007 makes checkpoint the 5th) ---"
grep -rn 'getConfig().enabled\|!config.enabled' src/tools/checkpoint.ts src/tools/rewind.ts src/tools/shrink.ts src/tools/audit.ts src/tools/cancel.ts | grep -iE 'enabled' | grep -vE '^\s*\*|//'
# EXPECT: a gate in ALL FIVE tool files (checkpoint.ts:138 confirms BUG-007 landed). README line 123 names all five.

# README's shouldNudge >= claim must match src/nudges.ts:
echo "--- source: shouldNudge comparison (BUG-003: > → >=) ---"
grep -n 'avg >= config.nudges.driftThresholdTokens\|>= driftThresholdTokens\|>=' src/nudges.ts | grep -iE 'nudge|avg|>=' | head -3
# EXPECT: the >= comparison (the rationale on README line 98 cites it).
```
Expected: README's claims (4000 default; five gated tools; >= comparison) match the source.

### Level 3: Build + tests (no-regression sanity — README edits are non-behavioral)

```bash
# README edits CANNOT affect tsc or vitest. Run only as sanity.
npm run typecheck 2>&1 | tail -1   # = tsc --noEmit. EXPECT: exit 0 / clean.
echo "typecheck exit: $?"
npx vitest run 2>&1 | grep -iE 'test files|tests passed|tests failed' | tail -2
# EXPECT: suite green (the bug fixes landed in P1.M1/P1.M2). Unaffected by the README edit.
```
Expected: typecheck clean; suite green.

### Level 4: Scope-discipline gate (no collateral edits)

```bash
git diff --stat              # EXPECT: README.md ONLY.
git diff --name-only | grep -vE '^README.md$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# EXPECT: "scope OK". src/*, test/*, VERIFICATION.md, spec/* must NOT appear.
```
Expected: only `README.md` in the diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms the stale `6000` / "Raised from 3k" / "6k a quiet trip point" / "always-on" /
      "checkpoint remains available" / "four state-affecting" claims are GONE; the new `4000` / "all five
      tools" claims are PRESENT; the em-dash refusal string is intact.
- [ ] Level 2: README's `driftThresholdTokens` Default (4000) matches `src/config.ts:158`; the "five tools
      refuse" claim matches the 5 gate sites (incl. `checkpoint.ts:138`); the `>=` rationale matches `src/nudges.ts`.
- [ ] Level 3: `npm run typecheck` clean; `npx vitest run` green (no-regression sanity).
- [ ] Level 4: `git diff --name-only` shows ONLY `README.md`.

### Feature Validation
- [ ] README:98 `driftThresholdTokens` Default reads `4000`; the rationale explains the lowering + `>=`
      comparison + §5.1 criterion (b) (no "Raised from 3k" / "6k a quiet trip point" remains).
- [ ] README:116 JSON example reads `"driftThresholdTokens": 4000`.
- [ ] README:123 Disabling paragraph names all FIVE tools (rewind/shrink/cancel/audit/checkpoint) as refusing
      when `enabled: false`; the "Only `checkpoint` remains available" / "always-on" exception is removed.
- [ ] The refusal string `Mulligan: refused — Mulligan is disabled.` is byte-intact (em-dash U+2014 + period).

### Code Quality / Scope Discipline
- [ ] Modified ONLY `README.md` (`git status --short` shows nothing else).
- [ ] Did NOT edit `VERIFICATION.md` (sibling P1.M3.T1.S1 — owns DoD #4 + checkpoint note + round-2 fix-log).
- [ ] Did NOT edit any `src/*` or `test/*` (the fixes' owners; READ-ONLY).
- [ ] Did NOT edit `spec/*` (READ-ONLY authorities).
- [ ] Did NOT edit README's prior "Resolved bugs (BUG-001–BUG-006)" table (lines 255-260) — prior round's history.
- [ ] Did NOT add a round-2 Resolved-bugs table to README (that lives in VERIFICATION.md, sibling S1).
- [ ] Did NOT add suppressCheck or pinned-hide-vs-compaction descriptions (NO-OP touchpoints — README never
      documented them; adding is scope-creep).

### Documentation
- [ ] README's config table + JSON example + Disabling section now accurately reflect the post-fix codebase.
- [ ] The edits are minimal: 3 prose spots, each fixing a verified stale claim; no speculative additions.

---

## Anti-Patterns to Avoid

- ❌ Don't treat the contract's 4-touchpoint list as "4 edits." A precise grep finds only 2 of 4 have stale
  claims (drift threshold, checkpoint gate). The other 2 (suppressCheck window, compaction/pinned-hide) are
  NO-OPs — README never documented them. Per the contract's own rule, leave them. (GOTCHA #1.)
- ❌ Don't PATCH line 98's rationale with a word swap — it's doubly stale ("Raised from 3k" + "6k a quiet trip
  point" both describe the PRE-fix state). Rewrite the cell to reflect the real story: lowered 6000→4000 +
  comparison `>`→`>=` so sustained ~4k/turn growth fires per §5.1 (b). (GOTCHA #2.)
- ❌ Don't keep the "Only `checkpoint` remains available as an always-on read-only diagnostic" sentence in
  line 123 — BUG-007 removed that exception. Delete it; state all five tools refuse. (GOTCHA #3.)
- ❌ Don't add a "round 2" Resolved-bugs table to README. The round-2 fix-log lives in VERIFICATION.md
  (sibling S1, where the prior round's table already lives). README's prior table (lines 255-260) is a
  DIFFERENT round's accurate history — the bug numbers collide between rounds. Leave it. (GOTCHA #4.)
- ❌ Don't normalize the em-dash in the refusal string. README and code both use U+2014 (`—`). Edit 3's
  replacement must preserve it — not a hyphen or en-dash. (GOTCHA #5.)
- ❌ Don't add suppressCheck or pinned-hide-vs-compaction descriptions to README "for completeness." Those
  touchpoints were never user-documented; adding them is scope-creep (the code owners' job, in VERIFICATION.md).
- ❌ Don't edit VERIFICATION.md, src/*, test/*, or spec/*. `git status --short` must show README.md only.
- ❌ Don't run only `npm run typecheck`/`npx vitest run` and call it validated — those are no-regression sanity
  (README edits can't fail them). The REAL gates are the stale-claim grep (Level 1) + the source-agreement
  check (Level 2).

---

## Confidence Score

**9/10** for one-pass implementation success. This is a focused 3-spot markdown sync with: the corrected
premise (only 2 of 4 touchpoints need edits — verified by precise grep), the verbatim FIND/REPLACE for all
three edits (lines 98, 116, 123 with unique anchors), the post-fix source evidence behind each
(`config.ts:158`=4000, `nudges.ts:321-322,296-299`=`>=`+§5.1 proof, `checkpoint.ts:138`=gate), the explicit
scope fence (README only; VERIFICATION.md/spec/src/test out of scope; prior Resolved-bugs table preserved),
and deterministic grep gates. The two residual risks — both clearly flagged — are (1) over-editing (adding
the 2 NO-OP touchpoints or a round-2 table — mitigated by GOTCHA #1/#4) and (2) patching rather than
rewriting the doubly-stale line-98 rationale (mitigated by GOTCHA #2 + the verbatim replacement text).
README edits are provably non-behavioral, so typecheck/tests are guaranteed unchanged by THIS task. No
dependency on the parallel S1 sibling beyond assuming the fixes landed (verified: config.ts:158 + checkpoint.ts:138).