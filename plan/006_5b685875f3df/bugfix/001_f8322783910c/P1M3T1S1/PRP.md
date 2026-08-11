# PRP — P1.M3.T1.S1: Update VERIFICATION.md to reflect all 7 bug fixes (Mode B doc sync)

## Goal

**Feature Goal**: Sync `VERIFICATION.md` (root, 211 lines) to the post-fix codebase after the current bug-fix
round (P1.M1 BUG-001/002/003 + P1.M2 BUG-004/005/006/007). The round's fixes make one "deliberate deviation"
note stale (the checkpoint "non-gated" claim → BUG-007 added a gate) and refresh several DoD #4 gate-count
claims; the round itself is undocumented, so a new fix-log/changelog table is added.

**Deliverable**: Edits to **`VERIFICATION.md` ONLY** — (1) update the stale "checkpoint non-gated" note
(lines 95-99) to reflect that checkpoint is now gated; (2) refresh the DoD #4 row (line 20: gate count 5→7
sites) + the grep cheat-sheet (lines 54-56: add audit/cancel/checkpoint.ts) + the code-inspection comment
(lines 58-61: "all five tools"); (3) append a new fix-log table for the round's 7 fixes. No code, no tests,
no other file.

**Success Definition**: After the edits, VERIFICATION.md (a) no longer claims checkpoint is "non-gated" or
excluded from the no-op contract; (b) DoD #4 lists all 7 config-gate sites (filter + 5 tools + 2 nudges) and
names all five tools in the disabled-text inspection; (c) a new fix-log section documents BUG-001 through
BUG-007 of this round with root-cause/fix/test per row; (d) the prior round's "BUG-001 through BUG-006" table
(lines 195-211) is preserved as accurate history (NOT overwritten — the bug numbers collide between rounds);
(e) grep confirms no stale "non-gated"/"not checkpoint" claim remains.

> ⚠️ **CRITICAL — the contract's premise is INACCURATE for 6 of 7 bugs.** Contract step 2 says to "find every
> section that references suppressCheck / resolvePinnedHide / shouldNudge / pendingBloatHits /
> countRetriesAtLatestPrompt / cancel no-op text / checkpoint." A precise grep of VERIFICATION.md finds **ZERO**
> references to 6 of those 7 (suppressCheck/NUDGE_TURN_WINDOW/10-min, resolvePinnedHide/E24, shouldNudge/6000/
> driftThreshold, pendingBloatHits/perTurnDrift, countRetriesAtLatestPrompt, cancel-no-op-text). Those 6 were
> bug-hunt FINDINGS, never framed as "deliberate deviation" notes in VERIFICATION.md. The ONLY genuine stale
> note is the checkpoint one (lines 95-99), which BUG-007 reverses. **Do NOT hunt for 6 non-existent notes.**
> The primary deliverable is the fix-log/changelog table (contract step 3) + the DoD #4 refresh.

## User Persona (if applicable)

**Target User**: Maintainers/release-engineers reading VERIFICATION.md to understand the extension's verified
state and the bug-fix history.

**Use Case**: A maintainer reads the DoD #4 note to know which entry points honor `config.enabled`, and reads
the fix-log to see what the latest remediation round changed.

**Pain Points Addressed**: Pre-sync, the DoD #4 note claims checkpoint is "non-gated" (now false — BUG-007
gated it), the gate-count grep omits 3 of 5 tools, and the round's 7 fixes are entirely undocumented. Stale
claims mislead anyone reasoning about the disabled contract.

## Why

- **Truth-in-docs (E14 disabled contract)**: the DoD #4 note is the authoritative "what honors config.enabled"
  record. After BUG-007, all five tools + filter + 2 nudges gate — the note must say so.
- **Fix-log completeness**: each prior remediation round added a table; this round (7 fixes) needs the same
  treatment so the verification report stays an accurate changelog.
- **Historical integrity**: the prior round's "BUG-001 through BUG-006" table is accurate for ITS round (the
  checkpoint-consumption-break / config-floor / empty-needle / audit-gate / nuclear-last_turn set). It must be
  PRESERVED, not overwritten — the bug numbers collide between rounds (each round re-numbers BUG-001..N).
- **[documentation task]**: this IS the documentation task for the changeset (contract DOCS clause).

## What

Three groups of edits in `VERIFICATION.md`:

**(A) Update the stale checkpoint note (lines 95-99)** — checkpoint is now gated (BUG-007); remove the
"non-gated"/"not checkpoint" exclusion; note it refuses when disabled like the other four tools.

**(B) Refresh DoD #4 (line 20 + lines 54-56 + lines 58-61)** — gate count 5→7 sites; grep file list adds
audit/cancel/checkpoint.ts; code-inspection comment names all five tools.

**(C) Append a new fix-log table** — BUG-001 (suppressCheck turn-based) through BUG-007 (checkpoint gate),
mirroring the existing table format. Label it as a distinct round (the numbers collide with the prior table).

### Success Criteria

- [ ] VERIFICATION.md lines 95-99 no longer claim checkpoint is "non-gated", "always-on", or excluded ("not
      checkpoint") from the no-op contract; they state checkpoint is gated per BUG-007.
- [ ] DoD #4 row (line 20) lists **7 gate sites** (filter + rewind/shrink/audit/cancel/checkpoint + 2 nudges),
      not "5 gates (filter/rewind/shrink/nudges×2)".
- [ ] The DoD #4 grep cheat-sheet (lines 54-56) greps ALL of filter.ts + the 5 tools + nudges.ts; the result
      comment lists all 7 sites.
- [ ] The code-inspection comment (lines 58-61) says the disabled text is in all FIVE tools, not "rewind + shrink".
- [ ] A new fix-log section lists all 7 bugs (BUG-001..BUG-007) with severity, root cause, fix, regression test.
- [ ] The prior round's "BUG-001 through BUG-006" table (lines 195-211) is PRESERVED unchanged (distinct round).
- [ ] `grep -ciE 'non-gated|not checkpoint' VERIFICATION.md` → 0 hits (the stale claim is gone).
- [ ] No file other than `VERIFICATION.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim stale text (FIND anchors) for the checkpoint note + DoD #4 rows, the
verbatim replacement text, the COMPLETE new fix-log table (all 7 rows with verified root-cause/fix/test from
the source + architecture docs), the corrected premise (don't hunt for 6 non-existent notes), and deterministic
grep gates. The implementer opens one file and runs grep.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: VERIFICATION.md
  why: Three stale/missing items: (1) lines 95-99 "checkpoint is non-gated" (BUG-007 reversed it); (2) DoD #4
        gate-count row (line 20) + grep cheat-sheet (54-56) + code-inspection (58-61) undercount the gates;
        (3) no fix-log table exists for the current round's 7 fixes.
  section: "DoD criteria table row #4 (~line 20); Gate-command cheat sheet (~lines 54-61); Notes → DoD #4
            settings-driven disable (~lines 86-100); Bug-fix remediation pass (~lines 195-211, the PRIOR round)."
  pattern: "Prose edits (the note) + table-cell edits (DoD #4) + a new appended table section (the fix-log).
            Use TEXT anchors, not line numbers — the file may have shifted."
  gotcha: "The existing 'Bug-fix remediation pass — BUG-001 through BUG-006' table (lines 195-211) is a PRIOR
           round's accurate history (checkpoint-consumption-break / config-floor / empty-needle / audit-gate /
           nuclear-last_turn). DO NOT overwrite it — ADD the new round's table as a separate section. Bug
           numbers collide between rounds; keep them distinct by labeling the new section."

# MUST READ — the authoritative fix descriptions for the 7 bugs (the fix-log source of truth)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: §Validated Bug Findings (BUG-001..BUG-007) gives root cause + fix approach + files touched per bug —
        the exact content the new fix-log table rows must summarize.
  critical: "The 7 bugs: BUG-001 suppressCheck wall-clock→turn-based; BUG-002 resolvePinnedHide compaction-bail→
             retained-tail; BUG-003 shouldNudge strict > 6000→>= 4000; BUG-004 pendingBloatHits clear after
             early-return→before; BUG-005 retry-budget counts cancelled→cancel-exclusion; BUG-006 cancel no-op
             text unified→split by path; BUG-007 checkpoint no gate→config.enabled gate."

# MUST READ — the post-fix source state (verify the gate sites + defaults the doc must quote)
- file: src/tools/checkpoint.ts
  why: line 138 `if (!getConfig().enabled)` — confirms BUG-007 landed (the doc must now say checkpoint IS gated).
- file: src/config.ts
  why: line 158 `driftThresholdTokens: 4000` — confirms BUG-003 (was 6000). The fix-log row quotes 6000→4000.
- file: src/nudges.ts
  why: line 328 `return avg >= config.nudges.driftThresholdTokens;` (the >→>= fix, BUG-003); suppressCheck is
        turn-based (JSDoc ~line 364); pendingBloatHits cleared before early-return (~line 181, 214-215).
- file: src/tools/rewind.ts
  why: countRetriesAtLatestPrompt cancel-exclusion (~lines 242-281) — confirms BUG-005.
  critical: "READ-ONLY. These confirm the post-fix behavior the doc must describe; do NOT edit src/*."

# MUST READ — the sibling PRP (BUG-007 — defines the exact checkpoint gate behavior the doc must reflect)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M2T4S1/PRP.md
  why: CONTRACT. BUG-007 adds getConfig().enabled gate to checkpointExecute (refuses "Mulligan: refused —
        Mulligan is disabled." before name validation; no label written). The stale checkpoint note (lines
        95-99) must be rewritten to match THIS. Touches checkpoint.ts/checkpoint.test.ts — zero overlap with
        VERIFICATION.md.
  gotcha: "Assume BUG-007 is applied (checkpoint.ts:138 gate present — VERIFIED this session)."

# CONTEXT — the 7 config-gate sites (the accurate count the DoD #4 row must quote)
- note: "Verified this session via grep: filter.ts:240, rewind.ts:511, shrink.ts:286, audit.ts:584,
        cancel.ts:350, checkpoint.ts:138, nudges.ts:122 (bloatReminder) + nudges.ts:217 (perTurnDrift).
        = 7 gate sites across 7 files (filter + 5 tools + 2 nudge handlers). The stale '5 gates
        (filter/rewind/shrink/nudges×2)' predates the audit+cancel+checkpoint gates."
```

### Current Codebase tree (the relevant slice)

```bash
VERIFICATION.md            # ← EDIT: checkpoint note (95-99) + DoD #4 (20, 54-61) + new fix-log table (append)
src/tools/checkpoint.ts    # READ-ONLY — BUG-007 gate (line 138); confirms the note is stale
src/config.ts              # READ-ONLY — driftThresholdTokens=4000 (line 158); BUG-003
src/nudges.ts              # READ-ONLY — shouldNudge >= (328), suppressCheck turn-based, pendingBloatHits clear
src/tools/rewind.ts        # READ-ONLY — countRetriesAtLatestPrompt cancel-aware (242-281); BUG-005
src/tools/{shrink,audit,cancel}.ts  # READ-ONLY — the other config gates (286/584/350)
README.md                  # READ-ONLY — sibling P1.M3.T1.S2 owns it (separate task)
plan/.../architecture/system_context.md  # READ-ONLY — the 7 fix descriptions (fix-log source of truth)
```

### Desired Codebase tree with files to be added or responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
VERIFICATION.md   # checkpoint note rewrite + DoD #4 refresh (3 spots) + new fix-log table (appended section)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL GOTCHA #1 (the contract OVER-CLAIMS stale notes — 6 of 7 don't exist): a precise grep finds ZERO
#   VERIFICATION.md references to suppressCheck/NUDGE_TURN_WINDOW/10-min, resolvePinnedHide/E24,
#   shouldNudge/6000/driftThreshold, pendingBloatHits/perTurnDrift, countRetriesAtLatestPrompt, or
#   cancel-no-op-text. Those 6 were bug-hunt FINDINGS, never "deliberate deviation" notes in VERIFICATION.md.
#   ONLY the checkpoint note (lines 95-99) is a genuine stale "deliberate" claim. Do NOT waste time hunting for
#   the other 6 — they aren't there. The deliverable for those 6 is the NEW fix-log table (documenting the fix),
#   not removing a non-existent note.

# CRITICAL GOTCHA #2 (bug numbers COLLIDE between rounds — preserve the prior table): VERIFICATION.md already
#   has a "Bug-fix remediation pass — BUG-001 through BUG-006" table (lines 195-211) from a PRIOR round
#   (checkpoint-consumption-break / config-floor / empty-needle / audit-gate / nuclear-last_turn). The CURRENT
#   round ALSO numbers its bugs BUG-001..BUG-007, but they are DIFFERENT issues. DO NOT overwrite the prior
#   table — ADD the new table as a SEPARATE, clearly-labeled section (e.g. "## Bug-fix remediation pass —
#   round 2 (PRD-compliance): BUG-001 through BUG-007"). Both tables are accurate for their respective rounds.

# CRITICAL GOTCHA #3 (the gate COUNT is across 7 files, not 5): post-fix, config.enabled is checked at
#   filter.ts:240, rewind.ts:511, shrink.ts:286, audit.ts:584, cancel.ts:350, checkpoint.ts:138, AND
#   nudges.ts:122 + nudges.ts:217. The DoD #4 row's "5 gates (filter/rewind/shrink/nudges×2)" is stale — it
#   predates the audit (prior round BUG-005), cancel, and checkpoint (this round BUG-007) gates. Update to 7.

# CRITICAL GOTCHA #4 (the disabled-text grep is in ALL FIVE tools now): the code-inspection comment
#   (lines 58-61) says "present in rewind.ts + shrink.ts". Post-fix the "Mulligan is disabled" refusal text is
#   in rewind/shrink/audit/cancel/checkpoint. Update to "all five tools".

# CRITICAL GOTCHA #5 (record the CURRENT test count, don't guess): the prior table says "956 passed" (its
#   round's count). The new table must quote THIS round's count. Run `npm test` and record the actual number.
#   Do NOT reuse "956" and do NOT edit the prior table's "956" (it's accurate for its round).

# OUT OF SCOPE (do NOT touch in this subtask):
#   - src/* and test/* → the fixes' owners (P1.M1/P1.M2); READ-ONLY.
#   - README.md → sibling P1.M3.T1.S2 (separate task).
#   - spec/* → READ-ONLY.
#   - The prior round's "BUG-001 through BUG-006" table (lines 195-211) → PRESERVE (accurate history).
# This PRP edits ONLY VERIFICATION.md (the checkpoint note + DoD #4 + a new appended fix-log table).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a markdown prose + table sync. The "model" is the mapping from the stale
VERIFICATION.md claims to the verified post-fix source state (quoted per row in the new fix-log table)._

### Implementation Tasks (ordered by dependencies)

Four edits; apply in any order. Use TEXT anchors (the unique stale substrings), not line numbers.

```yaml
Task 1: EDIT VERIFICATION.md — rewrite the stale checkpoint note (lines 95-99) [BUG-007]
  - FIND (verbatim current — the paragraph; unique anchor — starts "**`checkpoint` is non-gated**"):
      "**`checkpoint` is non-gated** (always-on; a harmless label write). **`audit` IS gated** on the master
      `config.enabled` switch (BUG-005 fix, src/tools/audit.ts: when `enabled` is false the audit refuses
      \"Mulligan is disabled\" before doing any work — matching the other gated entry points). DoD #4's pure-no-op
      applies to the gated entry points (filter, rewind, shrink, audit, bloat nudge, turn_end nudge), not checkpoint.
      An earlier draft of this note claimed audit + checkpoint were \"intentionally non-gated\"; that pre-dates the
      BUG-005 audit gate and is corrected here. (There is still no `config.audit.enabled` sub-switch — audit gates
      on the master only, like the others.)"
    (this spans ~5 lines; match the whole paragraph)
  - REPLACE WITH (checkpoint is NOW gated per BUG-007):
      "**All five tools + the filter + both nudges are gated** on the master `config.enabled` switch (spec/08 E14):
      when `enabled` is false each refuses / no-ops before doing any work. **`checkpoint` is gated** (BUG-007,
      src/tools/checkpoint.ts: refuses \"Mulligan: refused — Mulligan is disabled.\" before name validation — no
      label is written); **`audit` is gated** (BUG-005, src/tools/audit.ts). DoD #4's pure-no-op applies to the
      full gated set: filter, rewind, shrink, audit, cancel, checkpoint, bloat nudge, turn_end nudge. Earlier
      drafts of this note described checkpoint as \"non-gated / always-on\"; that pre-dates the BUG-007 gate and
      is corrected here. (There are still no per-tool `config.<tool>.enabled` sub-switches — every tool gates on
      the master `enabled` only, like the others.)"
  - RATIONALE: BUG-007 added getConfig().enabled to checkpointExecute (checkpoint.ts:138, verified). The old
    "non-gated / not checkpoint" exclusion is now false. The new note records the full gated set.
  - PRESERVE: the surrounding "DoD #4 — settings-driven disable (shipped, end-to-end verified)" heading + the
    setConfig/loadMulliganConfig paragraph above it (lines 86-94) — those are accurate and unchanged.

Task 2: EDIT VERIFICATION.md — DoD #4 gate-count row (line 20)
  - FIND (verbatim current cell): "**5 gates present** (filter/rewind/shrink/nudges×2) + **115 disabled-path tests green**"
  - REPLACE WITH: "**7 gates present** (filter + all 5 tools [rewind/shrink/audit/cancel/checkpoint] + 2 nudges [bloatReminder/perTurnDrift]) + disabled-path tests green"
  - RATIONALE: post-fix there are 7 config-gate sites across 7 files (verified: filter.ts:240, rewind.ts:511,
    shrink.ts:286, audit.ts:584, cancel.ts:350, checkpoint.ts:138, nudges.ts:122 + nudges.ts:217). The "5 gates"
    predates audit+cancel+checkpoint.
  - NOTE on the test count: drop the specific "115" (it was the v1.0 baseline; the disabled-path test COUNT grew
    across rounds). Say "disabled-path tests green" and let the fix-log table carry the exact current count, OR
    run `npx vitest run test/config.test.ts test/filter.test.ts test/tools/{rewind,shrink,audit,cancel,checkpoint}.test.ts`
    and record the actual number. (Keeping "115" risks a stale number.)

Task 3: EDIT VERIFICATION.md — DoD #4 grep cheat-sheet (lines 54-56) + code-inspection (lines 58-61)
  - (3a) FIND (the grep command + result comment):
      "grep -n '!config.enabled\\|!cfg.enabled' src/filter.ts src/tools/rewind.ts src/tools/shrink.ts src/nudges.ts
      # → filter.ts:180, rewind.ts:322, shrink.ts:235, nudges.ts:98, nudges.ts:176"
    REPLACE WITH (add audit/cancel/checkpoint.ts; refresh the result comment to all 7 sites):
      "grep -rn 'getConfig().enabled\\|!config.enabled' src/filter.ts src/tools/rewind.ts src/tools/shrink.ts src/tools/audit.ts src/tools/cancel.ts src/tools/checkpoint.ts src/nudges.ts
      # → filter.ts:240, rewind.ts:511, shrink.ts:286, audit.ts:584, cancel.ts:350, checkpoint.ts:138, nudges.ts:122, nudges.ts:217"
  - (3b) FIND (the code-inspection command + comment):
      "grep -rn \"Mulligan is disabled\" src/tools/      # → present in rewind.ts + shrink.ts"
    REPLACE WITH:
      "grep -rn \"Mulligan is disabled\" src/tools/      # → present in all five tools (rewind/shrink/audit/cancel/checkpoint)"
  - RATIONALE: the grep file list omitted audit/cancel/checkpoint (3 of 5 tools); the disabled-text comment said
    only "rewind + shrink". Both are stale post-fix. The refreshed grep lists all 7 sites; the comment names all
    five tools.
  - GOTCHA: the line numbers in the result comment (filter.ts:240 etc.) are the CURRENT verified sites — if the
    source has shifted, re-run the grep and record the actual line numbers. Do NOT invent numbers.

Task 4: APPEND VERIFICATION.md — new fix-log table for the current round's 7 fixes
  - PLACEMENT: append a NEW section AFTER the prior round's "Bug-fix remediation pass — BUG-001 through BUG-006"
    table (which ends at line 211), as a clearly-labeled DISTINCT round.
  - INSERT (verbatim — the section heading + intro + the 7-row table; mirror the prior table's column format):

      ## Bug-fix remediation pass — round 2 (PRD-compliance): BUG-001 through BUG-007

      A second end-to-end PRD validation pass found seven PRD-compliance deviations (3 Major, 4 Minor; 0 Critical,
      0 data-loss) in behavioral edge cases the suite did not cover. All seven were fixed with regression tests
      added. The table records the engineering detail per bug (the seven implementing subtask PRPs hold the full
      depth). NOTE: the bug numbers below are THIS round's numbering (BUG-001..BUG-007) and are DISTINCT from the
      prior round's "BUG-001 through BUG-006" table above — each remediation round re-numbers its findings.

      | Bug | Severity | Root cause | Fix applied | Regression test added |
      |-----|----------|------------|-------------|-----------------------|
      | BUG-001 | Major | `suppressCheck` (src/nudges.ts) used a fixed 10-minute wall-clock window (`NUDGE_TURN_WINDOW_MS`) instead of the spec §5.3 turn-boundary check — a single rewind/shrink over-suppressed the drift nudge on every turn for ~10 minutes | Turn-based lower bound: a marker is "during the metric's turn" iff `prevMetric.ts < marker.ts <= metric.ts` (uses `recentMetrics[1]?.ts`); `NUDGE_TURN_WINDOW_MS` removed | test/drift_nudge.test.ts (suppressCheck turn-boundary cases) |
      | BUG-002 | Major | `resolvePinnedHide`/`resolvePinnedShrink` (src/transforms.ts) bailed entirely on hitting ANY compaction entry → ALL pinned hides no-op'd after the first compaction (broader than the documented E24 limitation) | Compaction-aware retained-tail walk: find the last compaction entry; the retained tail (entries after it) maps to the last N messages; walk only the tail matching pinned IDs | test/transforms.test.ts (compaction retained-tail cases) |
      | BUG-003 | Major | `shouldNudge` moving-average vs `driftThresholdTokens` (6000) used strict `>` — `avg([4000,4000,4000])=4000 < 6000` did not fire, violating spec §5.1 acceptance criterion (b) | `driftThresholdTokens` default 6000→**4000** (src/config.ts) + comparison `>`→**`>=`** (src/nudges.ts) | test/drift_nudge.test.ts (criterion (b): three ~4k turns → fires) |
      | BUG-004 | Minor | `turnEndMetricHandler` (src/nudges.ts) cleared `rt.pendingBloatHits` AFTER the `perTurnDrift` early-return → unbounded growth when `bloatReminder=true, perTurnDrift=false` | Move the snapshot+clear of `pendingBloatHits` to BEFORE the early-return (runs every turn_end regardless of perTurnDrift) | test/nudges.test.ts (pendingBloatHits bounded when perTurnDrift=false) |
      | BUG-005 | Minor | `countRetriesAtLatestPrompt` (src/tools/rewind.ts) counted ALL post-prompt rewind markers, including ones later retired by `mulligan:cancel` → inflated the E22 retry budget | Cancel-exclusion: scan post-prompt `mulligan:cancel` entries, collect their `data.targetId`, skip counted rewinds whose `data.id` is retired (mirrors filter's `cancelledIds`) | test/tools/rewind.test.ts (cancelled rewind excluded from budget) |
      | BUG-006 | Minor | `mulligan_cancel` (src/tools/cancel.ts) emitted one no-op text ("with that id") for BOTH the target-not-found and markerId-not-found paths; spec/05 §5 specifies distinct texts | Split the no-op text by resolution path: target→"for that target", markerId→"with that id" | test/tools/cancel.test.ts (updated text pins per path) |
      | BUG-007 | Minor | `mulligan_checkpoint` (src/tools/checkpoint.ts) had NO `getConfig().enabled` gate (its header documented the omission as intentional) → wrote a label when disabled, violating spec E14 | Add `getConfig().enabled` gate as step 0 inside the try (before name validation); refuses byte-identical "Mulligan: refused — Mulligan is disabled." (no label written) | test/tools/checkpoint.test.ts (config-disabled describe, 2 tests) |

      `npm test` → **<CURRENT_COUNT> passed, 0 failed** (post-round-2; run `npm test` and record the actual number —
      do not reuse the prior round's "956").

  - RATIONALE: contract step 3 ("Add a brief changelog/fix-log entry summarizing the 7 fixes"). Mirrors the prior
    table's format. The DISTINCT-round labeling prevents number-collision confusion (GOTCHA #2).
  - DO NOT: overwrite the prior round's table (lines 195-211). ADD this as a new section below it.
```

### Implementation Patterns & Key Details

```markdown
# PATTERN (preserve + append): the prior "BUG-001 through BUG-006" table is accurate for ITS round. The current
#   round re-uses the numbers BUG-001..BUG-007 for DIFFERENT issues. Both tables coexist — label the new one
#   "round 2 (PRD-compliance)" so a reader doesn't conflate BUG-001(checkpoint-consumption) with BUG-001(suppressCheck).

# PATTERN (gate count): post-fix = 7 sites across 7 files. The DoD #4 row, the grep cheat-sheet, and the
#   code-inspection comment must ALL agree on the full set: filter + rewind/shrink/audit/cancel/checkpoint + 2 nudges.

# CRITICAL (don't invent line numbers / test counts): the grep-result comment and the "<CURRENT_COUNT>" in the
#   new table must reflect ACTUAL values. Re-run `grep -rn 'getConfig().enabled\|!config.enabled' src/...` and
#   `npm test` and record what they print. Stale line numbers / counts are the failure mode for a doc task.

# CRITICAL (the checkpoint note is the only "deliberate deviation" rewrite): the contract's step-2 list of 7
#   terms yields only ONE stale note (checkpoint, lines 95-99). The other 6 terms have 0 hits — their
#   "documentation" is the NEW fix-log table (Task 4), not a note rewrite.
```

### Integration Points

```yaml
NO CODE/CONFIG/ROUTE INTEGRATION — documentation-only (Mode B doc sync).
  - DATABASE: none
  - CONFIG: none (VERIFICATION.md is not config; it DESCRIBES config-gate behavior)
  - ROUTES: none
  - CODE: none (all src/* is READ-ONLY; this task quotes the post-fix source state but edits nothing)
  - TESTS: none (the fixes' owners added the regression tests; this task only DOCUMENTS them in the fix-log table)
  - DOCS: VERIFICATION.md ONLY. This IS the changeset-level documentation task (contract DOCS clause).
  - PARALLEL-SIBLING COORDINATION: P1.M2.T4.S1 (BUG-007, checkpoint gate) is being implemented in parallel and
    is the source of the checkpoint-note staleness. Assume it is applied (verified: checkpoint.ts:138 gate
    present). README.md is sibling P1.M3.T1.S2 (separate file, no overlap).
  - The only "integration" is DOC CONSISTENCY: VERIFICATION.md must AGREE with the post-fix source (7 gates,
    checkpoint gated, driftThresholdTokens=4000, etc.). The grep gates enforce this.
```

---

## Validation Loop

A VERIFICATION.md-only edit cannot break the build. Validation = grep confirms the stale claim is gone + the
new table is present + DoD #4 is accurate, plus a no-regression sanity run.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The stale checkpoint claim is GONE:
grep -ciE 'non-gated|not checkpoint' VERIFICATION.md          # EXPECT: 0.
grep -ciE 'checkpoint.*always-on' VERIFICATION.md             # EXPECT: 0.

# (b) The new gated claim is PRESENT:
grep -ciE 'checkpoint.*gated|All five tools.*gated' VERIFICATION.md  # EXPECT: ≥1.

# (c) The DoD #4 row lists 7 gates (not 5):
grep -n '7 gates present\|all 5 tools\|all five tools' VERIFICATION.md  # EXPECT: a hit in the DoD #4 row.

# (d) The grep cheat-sheet includes audit/cancel/checkpoint.ts:
grep -n 'src/tools/audit.ts src/tools/cancel.ts src/tools/checkpoint.ts' VERIFICATION.md  # EXPECT: 1 (the refreshed grep).

# (e) The new fix-log table lists all 7 bugs of this round:
grep -c '| BUG-00[1-7] |' VERIFICATION.md                     # EXPECT: ≥7 in the new table (7 rows), PLUS the
                                                              # prior table's 6 = ≥13 total. Confirm the new
                                                              # section heading "round 2 (PRD-compliance)" exists:
grep -n 'round 2 (PRD-compliance)' VERIFICATION.md            # EXPECT: 1 (the new section heading).

# (f) The prior round's table is PRESERVED (not overwritten):
grep -n 'Bug-fix remediation pass — BUG-001 through BUG-006' VERIFICATION.md  # EXPECT: 1 (the prior heading still there).
```
Expected: (a) 0; (b) ≥1; (c) a hit; (d) 1; (e) the new section heading present + 7 new rows; (f) the prior table intact.

### Level 2: Cross-doc consistency (the core gate — VERIFICATION.md agrees with the source)

```bash
# VERIFICATION.md's gate claims must match the ACTUAL source gate sites:
echo "--- source: the 7 config-gate sites (post-fix) ---"
grep -rn 'getConfig().enabled\|!config.enabled' src/filter.ts src/tools/*.ts src/nudges.ts | grep -iE 'enabled' | grep -vE '^\s*\*|//'
# EXPECT: 7 sites — filter.ts, rewind.ts, shrink.ts, audit.ts, cancel.ts, checkpoint.ts, nudges.ts (×2).
# Compare to VERIFICATION.md's DoD #4 grep-result comment — they must agree.

echo "--- source: driftThresholdTokens default (BUG-003) ---"
grep -n 'driftThresholdTokens:' src/config.ts                 # EXPECT: 4000 (the fix-log row quotes 6000→4000).

echo "--- source: checkpoint gate (BUG-007) ---"
grep -n 'getConfig().enabled' src/tools/checkpoint.ts         # EXPECT: present (the note now says checkpoint is gated).
```
Expected: VERIFICATION.md's claims (7 gates, checkpoint gated, driftThresholdTokens 4000) match the source.

### Level 3: Build + tests (no-regression sanity — VERIFICATION.md edits are non-behavioral)

```bash
# VERIFICATION.md edits CANNOT affect tsc or vitest. Run only as sanity + to record the current test count.
npm run typecheck 2>&1 | tail -1   # = tsc --noEmit. EXPECT: exit 0 / clean.
echo "typecheck exit: $?"
npm test 2>&1 | grep -iE 'test files|tests passed|tests failed' | tail -2
# EXPECT: suite green. RECORD the "Tests N passed" number and put it in the new fix-log table's "<CURRENT_COUNT>".
```
Expected: typecheck clean; suite green. The recorded count goes into Task 4's `<CURRENT_COUNT>` placeholder.

### Level 4: Scope-discipline gate (no collateral edits)

```bash
git diff --stat              # EXPECT: VERIFICATION.md ONLY.
git diff --name-only | grep -vE '^VERIFICATION.md$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# EXPECT: "scope OK". src/*, test/*, README.md, spec/* must NOT appear (those are the fixes'/siblings'/read-only).
```
Expected: only `VERIFICATION.md` in the diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms the stale "non-gated"/"not checkpoint" claim is gone (0 hits); the new gated claim,
      7-gate DoD #4 row, refreshed grep (audit/cancel/checkpoint.ts), and the new "round 2" fix-log section are present.
- [ ] Level 2: VERIFICATION.md's gate/gate-site/default claims match the actual source (7 sites; checkpoint gated;
      driftThresholdTokens=4000).
- [ ] Level 3: `npm run typecheck` clean; `npm test` green — and the recorded count fills the new table's placeholder.
- [ ] Level 4: `git diff --name-only` shows ONLY `VERIFICATION.md`.

### Feature Validation
- [ ] Lines 95-99 state checkpoint IS gated (BUG-007); no "non-gated"/"always-on"/"not checkpoint" exclusion.
- [ ] DoD #4 row lists 7 gate sites (filter + 5 tools + 2 nudges).
- [ ] The grep cheat-sheet greps all 7 files; the code-inspection comment names all five tools.
- [ ] A new "round 2 (PRD-compliance)" fix-log section lists all 7 bugs (BUG-001..BUG-007) with root-cause/fix/test.
- [ ] The prior round's "BUG-001 through BUG-006" table is preserved unchanged.
- [ ] The new table's test count is the ACTUAL current count (run `npm test`), not a reused "956".

### Code Quality / Scope Discipline
- [ ] Modified ONLY `VERIFICATION.md`.
- [ ] Did NOT edit any `src/*` or `test/*` (the fixes' owners; READ-ONLY).
- [ ] Did NOT edit `README.md` (sibling P1.M3.T1.S2).
- [ ] Did NOT edit `spec/*`.
- [ ] Did NOT overwrite the prior round's fix-log table (preserved as distinct-round history).
- [ ] Did NOT invent line numbers or test counts (re-ran grep + npm test and recorded actual values).
- [ ] Did NOT hunt for 6 non-existent "deliberate deviation" notes (only the checkpoint one exists).

### Documentation
- [ ] VERIFICATION.md now accurately reflects the post-fix codebase (all 5 tools gated; 7 gate sites; the round's 7 fixes logged).
- [ ] The fix-log table is consistent with the architecture/system_context.md fix descriptions + the verified source.

---

## Anti-Patterns to Avoid

- ❌ Don't hunt for "deliberate deviation" notes for 6 of the 7 bugs — they don't exist in VERIFICATION.md
  (precise grep: 0 hits for suppressCheck/resolvePinnedHide/shouldNudge/pendingBloatHits/countRetriesAtLatestPrompt/
  cancel-no-op-text). ONLY the checkpoint note (lines 95-99) is a genuine stale claim. The deliverable for the
  other 6 is the NEW fix-log table, not a note rewrite. (GOTCHA #1.)
- ❌ Don't overwrite the prior round's "BUG-001 through BUG-006" table (lines 195-211). It's accurate history for
  ITS round (checkpoint-consumption-break / config-floor / etc.). ADD the new round's table as a separate,
  labeled section — the bug numbers collide between rounds. (GOTCHA #2.)
- ❌ Don't keep the "5 gates (filter/rewind/shrink/nudges×2)" count — post-fix there are 7 sites across 7 files
  (filter + 5 tools + 2 nudges). Update the DoD #4 row, the grep cheat-sheet, AND the code-inspection comment to agree.
- ❌ Don't keep "present in rewind.ts + shrink.ts" in the code-inspection comment — the disabled-refusal text is now
  in all FIVE tools (rewind/shrink/audit/cancel/checkpoint).
- ❌ Don't invent line numbers or test counts. Re-run `grep -rn 'getConfig().enabled...' src/...` and `npm test` and
  record what they actually print. A doc task's failure mode is stale numbers.
- ❌ Don't reuse "956" for the new table's count, and don't edit the prior table's "956" — each table quotes its own
  round's count. Run `npm test` and record the current number.
- ❌ Don't edit `src/*`, `test/*`, `README.md`, or `spec/*` — those are the fixes'/siblings'/read-only. This task
  edits ONLY VERIFICATION.md.
- ❌ Don't treat the contract's step-2 term list as "all these notes exist" — it's a search directive, and the
  search finds only the checkpoint one. Correcting the contract's premise is part of doing this right.
- ❌ Don't run only `npm run typecheck`/`npm test` and call it validated — those are no-regression sanity (VERIFICATION.md
  edits can't fail them). The REAL gates are the stale-claim grep (Level 1) + the source-agreement check (Level 2).

---

## Confidence Score

**9/10** for one-pass implementation success. This is a focused markdown sync with: the corrected premise
(don't hunt for 6 non-existent notes — verified by precise grep), the verbatim FIND/REPLACE for the checkpoint
note + the 3 DoD #4 spots, the COMPLETE new fix-log table (all 7 rows with verified root-cause/fix/test from
the architecture doc + source), the gate-count facts (7 sites, verified across 7 files this session), and
deterministic grep gates. The prior-round table is explicitly preserved (number-collision guard). The two
residual risks — both clearly flagged — are (1) inventing line numbers/test counts instead of re-running grep +
npm test (mitigated by GOTCHA #3/#5 + the Level 2/3 "record actual values" instructions) and (2) accidentally
overwriting the prior table (mitigated by GOTCHA #2 + the distinct-round labeling). VERIFICATION.md edits are
provably non-behavioral, so typecheck/tests are guaranteed unchanged by THIS task. No dependency on the parallel
BUG-007 sibling beyond assuming its gate landed (verified: checkpoint.ts:138).