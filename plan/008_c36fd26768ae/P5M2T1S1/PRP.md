---
name: "P5.M2.T1.S1 — README.md 'Working-tree revert (v1.2)' section + stale-reference sweep"
description: >
  Mode B (changeset-level documentation sync). Two deliverables, both DOCS-only (no logic/behavior changes):
  (1) Add a new top-level section "## Working-tree revert (v1.2, opt-in)" to README.md, inserted as §5
  (after §4 Tools, renumbering How It Works→§6 … License→§9). The section covers all 7 contract sub-points:
  what it is (opt-in working-tree file restoration so the resumed agent needn't re-read files after a rewind),
  how to enable it (config.revert.enabled), the per-call flags (revert_file_changes / delete_created_files),
  granularity scope (last_turn/checkpoint only; last_tool_call_group refused-with-notice), the git-safety
  guarantee (external shadow repo; never touches the user's .git), the dirty-guard behavior (refuses the
  whole file-revert if any file changed since the turn ended), and non-git mode (CAS backend). It must
  mirror the project's framing: this feature touches the WORKING TREE (files on disk), NOT the append-only
  session tree. (2) A stale-reference sweep across README.md + src/ — fix the "All 21 knobs" caption (now 29
  with the revert.* block), resync the §4 mulligan_rewind blockquote to the current REWIND_DESC (the README
  claims it is a verbatim copy), bump Status v1.1→v1.2, add v1.2 caveats to §7's "No general undo" / "No hard
  retry" limitations, add spec/14 to Further reading, and correct the orphan-v1.1 comment language in
  src/tools/checkpoint.ts (comment-only — "all five tools" count + false "agent-callable/registered" claims;
  the file is a live module, do NOT delete it). The tool count is STILL 4 agent tools + 2 new optional params
  (no new tools) — verify this stays accurate.
---

# PRP — README v1.2 section + stale-reference sweep (P5.M2.T1.S1)

## Goal

**Feature Goal**: Ship the changeset-level documentation for the v1.2 working-tree-revert capability (P1–P4 are complete) — a comprehensive new README section that explains the feature end-to-end in the project's established tone, plus a verified sweep that removes every stale "5 tools"/orphan-v1.1 reference from README.md and src/ so the docs match the shipped reality.

**Deliverable**: A modified `README.md` with (a) a new top-level `## Working-tree revert (v1.2, opt-in)` section (§5, with subsequent sections renumbered), (b) a resynced `mulligan_rewind` blockquote byte-identical to the current `REWIND_DESC`, (c) a corrected knob-count caption, a v1.2 status bump, v1.2 caveats in §7, and `spec/14` in Further reading; and a modified `src/tools/checkpoint.ts` with **comment-only** corrections to its orphan-v1.1 language. No other files change. No new code, no new tests, no behavior change.

**Success Definition**:
- README.md contains a `## Working-tree revert (v1.2, opt-in)` section covering all 7 contract sub-points, mirroring the existing tone/framing, and clearly stating the feature touches the working tree (not the session tree).
- The §4 `mulligan_rewind` blockquote is byte-identical to `src/tools/rewind.ts` `REWIND_DESC` (the "verbatim copy" claim is true again).
- `grep -nE "all five tools|five agent|5 agent" README.md src/` returns nothing; `grep -nE "Status: v1.1" README.md` returns nothing.
- `src/tools/checkpoint.ts` comments no longer claim it is a registered agent tool or assert a "five tools" count (logic unchanged — comment-only edits).
- `npm run typecheck` (=`tsc --noEmit`) is green (sanity check that comment edits didn't break anything).
- README markdown is well-formed (renders; no broken internal anchor links).

## User Persona

**Target User**: A human operator / contributor reading README.md to understand what pi-mulligan does and how to enable v1.2 file restoration. Secondary: the maintainer who needs the docs to stop lying (stale references) about shipped behavior.

**Use Case**: An operator wants opt-in file restoration so that after a `mulligan_rewind` the resumed agent doesn't re-read the files it mutated. They open README.md, find the v1.2 section, learn the three opt-in layers (config master switch + per-call flags + delete kill-switch), enable `config.revert.enabled`, and pass `revert_file_changes` on their next rewind — understanding the git-safety guarantee and the dirty guard before relying on it.

**Pain Points Addressed**: The README currently documents only v1.1; the shipped v1.2 capability is undocumented at the README level. Separately, the README makes a "verbatim copy" claim that is now false (the `mulligan_rewind` blockquote drifted from `REWIND_DESC`), the knob count is stale, and `src/tools/checkpoint.ts` comments still describe the pre-v1.1 world (checkpoint as a registered agent tool / "five tools").

## Why

- P1–P4 implemented the entire v1.2 revert subsystem (config block, `src/snapshot/` store + git/cas backends, capture hooks, rewind integration). The README — the project's top-level documentation — still describes only v1.1. This item closes that gap (Mode B: the changeset-level documentation sync task is itself the deliverable).
- The glossary/decision-log spec-side additions already landed (commit a4767c6f); this task lands the **user-facing** README documentation and reconciles stale references introduced across the P1–P4 changes.
- Accurate docs matter disproportionately here: the feature is opt-in and safety-sensitive (it writes to the working tree, including gitignored files). Operators must understand the three consent layers and the git-safety guarantee before enabling it, and must NOT confuse working-tree restoration with session-tree mutation.

## What

A documentation-only changeset touching exactly two files: `README.md` (new section + sweep fixes) and `src/tools/checkpoint.ts` (comment-only sweep fixes).

### Success Criteria
- [ ] New `## Working-tree revert (v1.2, opt-in)` section in README.md covers all 7 sub-points (see Implementation Task 1).
- [ ] The section explicitly states the feature touches the WORKING TREE (files on disk), NOT the session tree.
- [ ] §4 `mulligan_rewind` blockquote === `REWIND_DESC` (verified by diff).
- [ ] §3 knob-count caption no longer says "All 21 knobs" without acknowledging the v1.2 `revert` block.
- [ ] Header `**Status:**` is `v1.2`.
- [ ] §7 "No general undo" and "No hard retry / replay" carry v1.2 caveats.
- [ ] `spec/14-working-tree-revert.md` is in "Further reading".
- [ ] `src/tools/checkpoint.ts` comments corrected (comment-only); no "all five tools" / false "agent-callable / registerTool" claims remain.
- [ ] `npm run typecheck` green; README renders with no broken anchors.

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge" test: every fact the implementer needs is specified with an exact file:line source and (where it matters) the verbatim string to copy. The 7 contract sub-points each map to a verified source-of-truth citation (config.ts / rewind.ts / spec/14). The exact `REWIND_DESC` and param-description strings are provided verbatim so the resync is a literal copy. The full stale-reference inventory (README + src) is enumerated with file:line and the precise fix. The placement/renumbering decision is justified and the anchor-link audit (showing zero links reference §5–§8) is included. See `plan/008_c36fd26768ae/P5M2T1S1/research/findings.md` for the distilled research.

### Documentation & References

```yaml
# MUST READ — the contract & feature spec
- url: spec/14-working-tree-revert.md  (§0 Motivation/scope; §1 opt-in model + granularity table;
    §3 GitBackend + the five git-safety guarantees; §4 CasBackend/non-git modes; §6 restore/refuse-on-dirty)
  why: the authoritative source for all 7 README sub-points — mirror its framing, especially
    "What it is NOT" (working tree, NOT the session tree; not retry/replay; .git never touched).
  critical: the feature is OPT-IN and three-layer-consented; .gitignore is deliberately NOT consulted
    (gitignored .env IS captured); the dirty guard REFUSES the whole revert (not a silent skip).

# MUST COPY VERBATIM — the resync targets (README claims these are "verbatim copies")
- file: src/tools/rewind.ts (REWIND_DESC, lines 156-157)
  why: the §4 mulligan_rewind blockquote MUST be byte-identical to this (README's "verbatim copy" claim).
  pattern: copy the single concatenated string exactly (provided in Implementation Task 3 below).
  gotcha: the current README blockquote already drifted pre-v1.2 ("disappears from your view permanently"
    vs current "is hidden from your context going forward") AND is missing the v1.2 append sentence —
    replace wholesale, do not patch.
- file: src/tools/rewind.ts (revert_file_changes desc line 136; delete_created_files desc line 141)
  why: the per-call flag documentation in the new section should reflect these exact semantics.

# MUST READ — config surface to document accurately
- file: src/config.ts (revert block DEFAULT_CONFIG lines 86-130; validation lines 350-368)
  why: the 8 revert.* knobs + their defaults + validation rules (storageDir MUST NOT resolve inside cwd;
    numbers > 0; nonGitMode one of two literals; never throws → falls back to defaults).

# MUST READ — current README structure/tone to mirror
- file: README.md (sections 1-8 + "Further reading"; the "### Human commands (v1.1)" subsection precedent)
  why: the new section must match this voice (one-liner lead, bold **term:** prefixes, tables for
    enumerations, spec cross-refs like `spec/14 §N`).
  pattern: §4 Tools (verbatim blockquote + "When to use it" lists) and §3 Configuration (defaults table).
  gotcha: README header line 4 has `**Status:** v1.1` (bump to v1.2); §3 caption says "All 21 knobs"
    (now stale — the revert block added 8).

# STALE-REFERENCE SWEEP TARGETS (src) — comment-only
- file: src/tools/checkpoint.ts (header lines 2-4; lines 25, 33, 134, 179)
  why: these comments are orphan-v1.1 language — they claim checkpoint is a registered agent tool /
    assert "all five tools". checkpoint moved to a human command in v1.1 (commands.ts makeCheckpointCommand).
  gotcha: this file is a LIVE MODULE — commands.ts:34 imports validCheckpointName from it; tests import
    makeCheckpointTool. DO NOT delete it. Comment-only edits only.

# Reference — the contract items this docs task documents
- docfile: plan/008_c36fd26768ae/P5M2T1S1/research/findings.md  (full stale-ref inventory + verified strings)
```

### Current Codebase tree (relevant slice)

```bash
README.md                  # ← PRIMARY EDIT: new §5 v1.2 section + sweep (Status, §3 caption, §4 blockquote, §7 caveats, Further reading)
src/tools/
  rewind.ts                # READ-ONLY source of REWIND_DESC (line 156-157) + param descs (136,141) to copy
  checkpoint.ts            # ← SECONDARY EDIT: comment-only orphan-v1.1 language (lines 2-4, 25, 33, 134, 179)
  cancel.ts                # VERIFY line 137 ("other four tools") — fix only if asserts wrong count
  audit.ts                 # VERIFY line 703 — fix only if asserts checkpoint is a registered agent tool
src/config.ts              # READ-ONLY source of the 8 revert.* knobs + defaults (lines 86-130)
src/index.ts               # READ-ONLY proof: registers exactly 4 agent tools (68-71) + checkpoint as COMMAND (77)
spec/14-working-tree-revert.md  # READ-ONLY authoritative feature spec (mirror its framing)
```

### Desired Codebase tree with file responsibility

```bash
README.md                  # + new "## Working-tree revert (v1.2, opt-in)" §5; resynced §4 blockquote;
                           #   Status v1.2; §3 caption fix; §7 v1.2 caveats; spec/14 in Further reading.
                           #   Sections 5-8 renumbered → 6-9.
src/tools/checkpoint.ts    # comment-only corrections (header + lines 25/33/134/179): no "five tools",
                           #   no false "agent-callable tool"/"registerTool" claims. Logic unchanged.
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: README.md §4 claims its tool blockquotes are "verbatim copies" of the runtime description
# strings. P4 updated REWIND_DESC (rewind.ts:156-157) to append the v1.2 sentence AND reworded
# "disappears from your view permanently" → "is hidden from your context going forward". The README
# blockquote was NOT resynced → the "verbatim" claim is currently FALSE. Task 3 fixes this with a
# literal copy. Do NOT paraphrase — byte-identical is the requirement.

# CRITICAL: src/tools/checkpoint.ts is a LIVE module (commands.ts:34 + tests import it). The stale
# comments are the problem, NOT the file's existence. DO NOT delete checkpoint.ts or remove
# makeCheckpointTool/validCheckpointName exports. Comment-only edits.

# CRITICAL: The v1.2 feature adds optional PARAMS to mulligan_rewind, NOT a new tool. The agent-tool
# count stays 4 (rewind/shrink/audit/cancel — verified index.ts:68-71). Any language implying 5 agent
# tools is stale. checkpoint is a human COMMAND (index.ts:77), not an agent tool, since v1.1.

# GOTCHA: README internal anchor links that exist today are ONLY: #3-configuration, #disabling,
# #human-commands-v11, #4-tools. NONE reference §5/§6/§7/§8. So inserting the new section as §5 and
# renumbering How It Works→§6, Guarantees→§7, Known Limitations→§8, License→§9 breaks ZERO anchors.

# GOTCHA: The feature touches the WORKING TREE (files on disk), NOT the append-only session tree.
# This is the #1 framing the new section must get right (mirror spec/14 §0 "What it is NOT").
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD new section "## Working-tree revert (v1.2, opt-in)" to README.md as §5
  - INSERT: a new top-level numbered section immediately AFTER §4 Tools (before the current §5 "How It Works").
  - RENUMBER: the former §5 How It Works → §6, §6 Guarantees → §7, §7 Known Limitations → §8, §8 License → §9.
    (Anchor audit confirms zero internal links reference these — safe.)
  - CONTENT — cover ALL 7 contract sub-points, mirroring README tone (one-liner lead, **bold term:**
    prefixes, a small table where it aids clarity, spec cross-refs `spec/14 §N`). Required sub-points:
    (1) WHAT IT IS — opt-in, best-effort restoration of working-tree files to the state captured just
        before the rewound span, so the resumed agent need NOT re-read files to reorient (the rewind's
        purpose — a cheap re-attempt — is no longer defeated by re-read bloat). State plainly: this
        touches the WORKING TREE (files on disk), NOT the append-only session tree (the conversation
        history is never mutated); it is NOT retry/replay (no tool call is re-executed); non-filesystem
        effects (git refs/commits, the index, network/DB/processes, excluded dependency dirs) persist.
    (2) HOW TO ENABLE — set `config.revert.enabled: true` in settings.json (the master switch; default
        false → the snapshot machinery is entirely inert, zero overhead). Note it is LAZY-loaded / cached
        / re-read on /reload like the rest of the mulligan config.
    (3) PER-CALL FLAGS — `mulligan_rewind` gains two optional boolean params: `revert_file_changes`
        (restore modified files to pre-span state) and `delete_created_files` (delete files the span
        newly created). The agent MUST set at least one; they are never inferred. `delete_created_files`
        additionally requires the global `config.revert.allowDeleteCreatedFiles: true` (deletion is the
        one irreversible action → behind BOTH the per-call flag AND the config gate). Quote/paraphrase
        the exact param semantics from rewind.ts:136/141 (provided in Task 3 notes).
    (4) GRANULARITY SCOPE — supported at `last_turn` and `checkpoint` only. At `last_tool_call_group`
        the file revert is IGNORED and the tool returns the notice (quote it verbatim from rewind.ts:826):
        "File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the
        whole turn." The context rewind still happens normally. Include the small granularity table
        (mirror spec/14 §1): last_turn ✅, checkpoint ✅, last_tool_call_group ❌ (ignored + noticed).
    (5) GIT-SAFETY GUARANTEE — in a git repo the backend uses an EXTERNAL SHADOW REPOSITORY (GIT_DIR
        under config.revert.storageDir, one shadow repo per source worktree; GIT_WORK_TREE = the user's
        tree). NOTHING is written to the user's .git — not even a transient/dangling object. The only
        command run against the user's git is the read-only `git rev-parse`. List the five guarantees
        (mirror spec/14 §3): no ref-moving/write against source git; .git never written; restore writes
        only working-tree files; delete only deletes span-created files (behind both gates); refuse-on-dirty.
    (6) DIRTY-GUARD BEHAVIOR — before restore, a dirty check compares each affected file's CURRENT
        content to its after-snapshot state; if ANY affected file changed since the turn ended (a
        human/other-process edit), the WHOLE file-revert is REFUSED (not a silent skip) — the context
        rewind still proceeds. Rationale: clobbering an unsaved human edit is the one unrecoverable
        failure; refusing and letting the agent re-request is safe.
    (7) NON-GIT MODE — outside a git repo, a content-addressed store (CAS) backend snapshots/restore
        the same comprehensive file set. `config.revert.nonGitMode` selects `"cas"` (default —
        comprehensive whole-tree) or `"explicit-paths"` (conservative — only write/edit tool paths; bash
        not captured). If neither backend can initialize → revert is unavailable, fail-open (rewind
        succeeds with just the note — today's behavior).
    - ALSO INCLUDE in the section: a short "Configuration" subsection listing the 8 `revert.*` knobs
      with defaults (mirror §3's table style) — enabled:false, allowDeleteCreatedFiles:false,
      nonGitMode:"cas", storageDir:null (→ <sessionDir>/mulligan/, NEVER under cwd), maxFileBytes:262144,
      maxTotalBytes:33554432, maxSnapshotsPerTurn:64, excludeGlobs:[.git,node_modules,dist,build,.next,
      .venv,target]. Note: .gitignore is deliberately NOT consulted — a gitignored .env IS captured
      (snapshot uses its own excludeGlobs); privacy note (local + ephemeral, wiped on session_shutdown).
    - TONE: match existing sections. Cross-ref `spec/14-working-tree-revert.md` for full detail.

Task 2: UPDATE README.md header + §3 caption (stale-reference sweep, README)
  - LINE 4: `**Status:** v1.1` → `**Status:** v1.2`.
  - §3 CONFIGURATION caption (currently "All 21 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`;
    rationale: `spec/09-configuration.md` §3)."): the revert.* block added 8 knobs. RECOMMENDED fix — keep
    the §3 table as the base knobs and update the caption to acknowledge the v1.2 block is documented
    separately, e.g.: "All 21 base knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale:
    `spec/09-configuration.md` §3). The v1.2 `revert` block (8 knobs) is documented in
    [§5 Working-tree revert (v1.2)](#5-working-tree-revert-v12-opt-in)." (Anchor slug must match the new
    §5 heading — GitHub lowercases, drops punctuation, hyphenates spaces.)
  - (Do NOT delete the §3 minimal settings.json example; optionally you may leave it as-is since the new
    section has its own config subsection.)

Task 3: RESYNC the §4 mulligan_rewind blockquote to the current REWIND_DESC (stale-reference sweep, README)
  - FIND: the `> Shed recent context …` blockquote under the "### `mulligan_rewind`" heading in §4.
  - REPLACE its entire text with the EXACT current REWIND_DESC (src/tools/rewind.ts:156-157), verbatim:
      "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn)
       and leave yourself a note so you can try again with a clean view. The content is hidden from your
       context going forward (it stays on disk for the human). Costs only a short note. Use granularity
       'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn
       from the user's last message. Set revert_file_changes to also restore the working-tree files you
       modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only)."
  - WHY: README §4 intro states the blockquotes are "verbatim copies of the LLM-facing description strings
    the agent sees at runtime" — this restores that invariant (it drifted on the reword + the v1.2 append).
  - VERIFY after edit: `diff <(sed -n '156,157p' src/tools/rewind.ts | tr -d '\n" ' ) <(README blockquote
    text stripped)` — must be empty (byte-identical modulo whitespace/quotes).

Task 4: ADD v1.2 caveats to §7 Known Limitations (now §8 after renumber) (stale-reference sweep, README)
  - "No general undo" bullet: currently says rewinds/shrinks persist and "there is no un-rewind that
    replays hidden content or reverses on-disk side effects (file edits and bash commands persist)".
    ADD a clause: working-tree FILE CONTENT is now reversible on opt-in via v1.2 (see §5); non-filesystem
    effects (bash network/DB/git refs, the index) and the session-tree VIEW still persist. mulligan_cancel
    remains forward-only for markers.
  - "No hard retry / replay" bullet: currently says "Hidden tool calls' side effects persist on disk
    (files written, commands run)". ADD: file writes are conditionally reversible on opt-in (v1.2 §5);
    non-filesystem bash effects (network/DB/processes) and git ref/history mutations still persist and are
    NOT reverted.
  - KEEP these as LIMITATIONS (v1.2 is opt-in + best-effort + working-tree-only); the caveats clarify scope,
    not remove the limitation.

Task 5: ADD spec/14 to "Further reading" + optional §4 consistency note (stale-reference sweep, README)
  - "Further reading": add a bullet: "`spec/14-working-tree-revert.md` — the v1.2 working-tree-revert
    feature (opt-in file restoration, snapshot backends, git-safety, dirty guard)."
  - OPTIONAL (preempt confusion, per contract "still 4 agent tools + 2 new optional params"): in §4 Tools
    intro (currently "Mulligan registers four agent-callable tools."), append a parenthetical: "(v1.2 adds
    optional *params* to `mulligan_rewind` — see [§5 Working-tree revert (v1.2)](#5-working-tree-revert-v12-opt-in) — not a new tool.)"

Task 6: CORRECT orphan-v1.1 comment language in src/tools/checkpoint.ts (stale-reference sweep, src; COMMENT-ONLY)
  - CONSTRAINT: comment-only edits. Do NOT change any code, exports, types, or logic. Do NOT delete the file
    (commands.ts:34 imports validCheckpointName; tests import makeCheckpointTool). Run `npm run typecheck`
    after to confirm nothing broke.
  - LINES 2-4 (file header comment): currently "the `mulligan_checkpoint` agent-callable tool (spec/05 §3;
    spec/04 §6)" and "THIRD of the four Mulligan agent-callable tools (P1.M5.T3.S1)". This is FALSE — since
    v1.1 the checkpoint is a human COMMAND (spec/13), registered via makeCheckpointCommand in commands.ts,
    NOT pi.registerTool. REWORD to: checkpoint shared helper / validation module; the user-facing surface is
    the `/mulligan_checkpoint` command (spec/13) since v1.1; makeCheckpointTool is retained for unit/integration
    test coverage. Reference spec/13 (human commands), not spec/05 §3 (agent tool).
  - LINES 25 & 179: currently "index.ts (P1.M7.T1.S1) will do `pi.registerTool(makeCheckpointTool(pi))`".
    FALSE — index.ts never does this. REWORD to: "exercised by unit/integration tests (test/tools/checkpoint.test.ts,
    test/integration/smoke.ts); the `/mulligan_checkpoint` command is the user-facing surface (commands.ts)."
  - LINE 33: currently "byte-identical disabled text across all five tools". STALE COUNT (pre-v1.1: 5 tools).
    Fix to "across the four agent tools" (rewind/shrink/audit/cancel) OR reword to avoid asserting a count.
  - LINE 134: currently "Byte-identical to the other four tools' disabled text." Reconcile with the corrected
    header (checkpoint is not a registered agent tool).
  - VERIFY (secondary, fix only if clearly stale): cancel.ts:137 ("other four tools") and audit.ts:703
    (grouping makeCheckpointTool with the agent tools). If they assert checkpoint is a registered agent tool
    or a 5-tool count, correct them comment-only; otherwise leave.

Task 7: VALIDATE (no edits — verification only)
  - `grep -nE "all five tools|five agent|5 agent tools|Status: v1\.1" README.md src/` → expect NO matches.
  - `grep -nE "All 21 knobs" README.md` → expect NO match (caption updated).
  - Confirm §4 mulligan_rewind blockquote === REWIND_DESC (manual/diff).
  - `npm run typecheck` (=`tsc --noEmit`) green (sanity — comment edits touched checkpoint.ts).
  - README renders (preview); internal anchors intact (the new §5 anchor slug is consistent with the
    caption/Further-reading cross-refs you added in Tasks 2/5).
```

### Implementation Patterns & Key Details

```markdown
# Tone pattern to mirror (from existing README sections):
# - Lead one-liner, then "**<Term>:**" bold-prefix enumerations.
# - Tables for enumerations (granularity, config knobs) — see §3 defaults table + §4 granularity table.
# - spec cross-refs as inline code: `spec/14 §6`.
# - Blockquotes for verbatim tool description strings (the §4 convention).
# - Cross-link new section as [§5 Working-tree revert (v1.2)](#5-working-tree-revert-v12-opt-in).

# Granularity table to include in the new section (mirror spec/14 §1):
| Granularity            | File revert?               | Notes |
|------------------------|----------------------------|-------|
| `last_turn`            | ✅                          | Restore to the turn-start snapshot. The natural, common case. |
| `checkpoint`           | ✅                          | Restore to the checkpoint-creation snapshot. |
| `last_tool_call_group` | ❌ (ignored + noticed)      | A group-granularity file revert would over-revert to turn-start (undoing earlier good edits in the same turn) — a semantic mismatch the tool refuses rather than silently performing. The context rewind still happens. |

# The framing sentence the section MUST contain (working tree, not session tree):
"Like the rest of Mulligan, this feature never mutates the append-only session tree (your conversation
history). It restores files on disk — the working tree — so the resumed agent's mental model of 'what was
there before this turn' matches the disk, removing the need to re-read files after a rewind."

# Git-safety one-liner (mirror spec/14 §3):
"In a git repo the backend uses an external shadow repository; the user's `.git` is never written — not
even a transient object. The only command run against the user's git is the read-only `git rev-parse`."
```

### Integration Points

```yaml
DOCUMENTATION (README.md):
  - new section: "## 5. Working-tree revert (v1.2, opt-in)" inserted after §4 Tools
  - renumber: former §5→§6, §6→§7, §7→§8, §8→§9 (zero broken anchors — verified)
  - header: Status v1.1 → v1.2
  - §3 caption: "All 21 knobs" → "All 21 base knobs (+ v1.2 revert block, see §5)"
  - §4 mulligan_rewind blockquote: resync to current REWIND_DESC (byte-identical)
  - §4 Tools intro: optional "(v1.2 adds params to mulligan_rewind, not a new tool)"
  - §8 (was §7) Known Limitations: v1.2 caveats on "No general undo" + "No hard retry"
  - Further reading: + spec/14-working-tree-revert.md

SOURCE COMMENTS (src/tools/checkpoint.ts — comment-only, no logic):
  - header (2-4): "agent-callable tool" → "human command (spec/13) since v1.1"
  - 25, 179: drop false "pi.registerTool(makeCheckpointTool(pi))" claim
  - 33: "all five tools" → "the four agent tools" (or reword)
  - 134: reconcile with corrected header
  - verify cancel.ts:137 + audit.ts:703 (fix only if clearly stale)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# This is a DOCS task — no lint/type config beyond the existing TS project. Sanity-check comment edits:
npm run typecheck          # = tsc --noEmit; MUST stay green (comment-only checkpoint.ts edits must not break anything)

# README markdown sanity (render / link check). If a markdown linter is available:
npx --yes markdownlint-cli README.md 2>/dev/null || echo "(no markdownlint configured — manual render check)"

# Expected: typecheck green; README renders with no broken internal anchors.
```

### Level 2: Stale-Reference Sweep Verification (the core acceptance gate)

```bash
# MUST return NOTHING (all stale language gone):
grep -rnE "all five tools|five agent|5 agent tools" README.md src/
grep -nE "Status: v1\.1" README.md
grep -nE "All 21 knobs" README.md            # caption updated
grep -rnE "pi\.registerTool\(makeCheckpointTool" src/   # no false registration claim in comments

# MUST return the new content:
grep -nE "Working-tree revert \(v1\.2" README.md        # new section heading present
grep -nE "Status: v1\.2" README.md                       # status bumped
grep -nE "spec/14-working-tree-revert\.md" README.md     # Further reading updated

# Expected: the first group returns zero matches; the second group returns matches.
```

### Level 3: Verbatim-Copy Resync Verification

```bash
# The §4 mulligan_rewind blockquote must be byte-identical to REWIND_DESC (README's "verbatim" claim).
# Extract REWIND_DESC (single string) and eyeball-diff against the README blockquote:
sed -n '156,157p' src/tools/rewind.ts
# Then read the README §4 mulligan_rewind blockquote and confirm an exact textual match
# (the README blockquote is the same string minus the surrounding JS quotes/concatenation).

# Expected: identical text (the v1.2 append sentence + "is hidden from your context going forward").
```

### Level 4: Render & Cross-Reference Validation

```bash
# Confirm the new section's anchor slug is consistent everywhere it is cross-referenced
# (GitHub anchor = lowercase, spaces→hyphens, punctuation dropped). For heading
# "## 5. Working-tree revert (v1.2, opt-in)" the slug is:
#   #5-working-tree-revert-v12-opt-in
grep -nE "#5-working-tree-revert-v12-opt-in" README.md   # caption + Further reading + optional §4 note all use this

# Manual: open README.md in a renderer (or `gh repo view`/VS Code preview) and confirm:
#  - the new §5 renders with its table + config subsection
#  - §6-§9 are correctly renumbered
#  - internal links (#3-configuration, #4-tools, #disabling, #human-commands-v11) still resolve
# Expected: clean render, no broken links.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` green (comment-only src edits introduced no breakage).
- [ ] Stale-language greps (Level 2, first group) return ZERO matches.
- [ ] New-content greps (Level 2, second group) return matches.
- [ ] §4 mulligan_rewind blockquote is byte-identical to `REWIND_DESC` (Level 3).
- [ ] New §5 anchor slug (`#5-working-tree-revert-v12-opt-in`) is consistent across all cross-refs (Level 4).

### Feature Validation
- [ ] New §5 section covers all 7 contract sub-points (what/enable/flags/granularity/git-safety/dirty-guard/non-git).
- [ ] Section explicitly states: working tree (files on disk), NOT the session tree; not retry/replay.
- [ ] §7 (now §8) "No general undo" + "No hard retry" carry accurate v1.2 caveats.
- [ ] Header Status is v1.2; §3 caption acknowledges the v1.2 revert block; spec/14 in Further reading.

### Code Quality Validation (docs)
- [ ] New section matches existing README tone/voice/formatting.
- [ ] Section numbering (§5 new; §6–§9 renumbered) is consistent; no duplicate/orphaned numbers.
- [ ] No claims in README or src contradict shipped behavior (4 agent tools; checkpoint = human command; opt-in revert).
- [ ] checkpoint.ts edits are comment-only (diff shows no code/export/type changes).

### Documentation & Deployment
- [ ] README is self-consistent (the "verbatim copy" claim is true again; knob count is accurate).
- [ ] No new environment variables or config introduced (this is pure documentation).

---

## Anti-Patterns to Avoid

- ❌ Don't paraphrase `REWIND_DESC` — the README's "verbatim copy" claim requires a byte-identical copy (Task 3).
- ❌ Don't delete `src/tools/checkpoint.ts` or remove its exports — it is a live module (commands.ts + tests import it). Comment-only fixes.
- ❌ Don't change any code/logic/types in `src/` — this is a docs task. Comment-only src edits; if typecheck breaks, you changed code, revert it.
- ❌ Don't describe the feature as touching the session tree or as retry/replay — it is working-tree restoration only (the #1 framing trap).
- ❌ Don't say the tool count changed — it is STILL 4 agent tools; v1.2 adds optional *params* to mulligan_rewind.
- ❌ Don't skip the renumbering of §5–§8 → §6–§9, and don't leave the §3 caption saying "All 21 knobs" — both are stale references.
- ❌ Don't soften §7 limitations into non-limitations — v1.2 is opt-in + best-effort + working-tree-only; the caveats clarify scope, not erase it.