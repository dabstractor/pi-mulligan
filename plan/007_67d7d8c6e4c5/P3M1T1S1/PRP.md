# PRP — P3.M1.T1.S1: README.md v1.1 sweep

> **Mode B — changeset-level documentation sync.** This is the FINAL documentation sweep. It runs LAST,
> after ALL implementing subtasks (Phase 1 + Phase 2). It edits **only `README.md`** — no spec files, no
> source, no tests. The v1.1 surface already exists in `src/`; README must reflect it.

---

## Goal

**Feature Goal**: Sweep `README.md` so every stale v1.0 reference is replaced with the v1.1 surface, and
zero stale strings remain. The v1.1 surface is: **4 agent tools** (`mulligan_rewind`, `mulligan_shrink`,
`mulligan_audit`, `mulligan_cancel` — `mulligan_checkpoint` removed as an agent tool), **3 human commands**
(`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit`), the **active-checkpoint banner**,
**no `to_previous_prompt`**, and an **agent-attributable drift delta** (user prompts exempt).

**Deliverable**: A modified `README.md` (one file, ~13 deterministic edits) that matches the v1.1 surface
implemented in `src/`. All edits are exact old→new string swaps — no new prose authored from scratch except
one short "Human commands (v1.1)" subsection drafted from the real command/banner source strings.

**Success Definition**: `grep` verification shows ZERO occurrences of stale terms (`to_previous_prompt`,
`nuclear`, `all five tools`, `five agent-callable`, `no human-facing command`, `BUG-006`, `five tools'`) and
PRESENCE of the new terms (`four agent-callable tools`, `Human commands (v1.1)`, the narrow-surface framing).
The §4 Tools section lists exactly 4 `mulligan_*` tool subsections. Markdown structure is intact.

## Why

- README is the human-facing entry point; a README that documents 5 tools when the agent registers 4, or
  documents a removed `to_previous_prompt` nuclear mode, actively misleads. This is the single source a new
  user reads first (`spec/12-repo-layout.md` §1.1, `spec/00-SPEC.md` §0).
- The v1.1 consent model (E23 RESOLVED) moved checkpoints to the human; the README must surface the three
  human commands + the active-checkpoint banner, or a user will never know `/mulligan_checkpoint` exists.
- Per the task contract, this is Mode B: it is THE changeset-level sync, depends on every implementing
  subtask, and runs last so it can state the final v1.1 surface once, authoritatively.

## What

### Visible behavior (README content changes)
README reflects:
1. Tool count 5 → 4 (§3 Disabling parenthetical, §4 heading, Further reading).
2. `to_previous_prompt` paragraph removed → one-line guardrail note.
3. `### mulligan_checkpoint` tool subsection removed → cross-reference to a new Human commands section.
4. NEW `### Human commands (v1.1)` subsection listing the 3 commands + the banner.
5. §5 "no human-facing command" → narrow-surface framing.
6. Drift-nudge delta noted as agent-attributable (user prompts exempt).
7. BUG-006 (moot) removed; bug-list range/intro updated; BUG-001 reframed.
8. `Status: v1.0` → `v1.1`; `ui.activeCheckpointBanner` added to the config table.

### Success Criteria
- [ ] All 13 exact old→new edits applied (see Implementation Tasks) with byte-exact source strings.
- [ ] `grep` stale-term check returns ZERO matches (see Validation Loop).
- [ ] §4 Tools lists exactly 4 agent-tool subsections (rewind, shrink, audit, cancel) — no `mulligan_checkpoint` h3.
- [ ] New `### Human commands (v1.1)` subsection present and correct.
- [ ] No file other than `README.md` is touched.

---

## All Needed Context

### Context Completeness Check
_Pass._ An agent with zero knowledge of this repo can execute this PRP as a deterministic string-swap task:
every edit is given as an exact `OLD → NEW` pair, the placement of the one new subsection is pinned, and the
verification is a copy-pasteable `grep` command. The v1.1 surface strings are captured from the real source
files (`commands.ts`, `banner.ts`, `index.ts`) so no judgment calls are needed.

### Documentation & References

```yaml
- file: README.md
  why: THE file being edited (275 lines). Read it in full before editing — the OLD strings below MUST be
        matched byte-exactly (em-dashes —, smart quotes, backticks).
  gotcha: |
    README uses typographic em-dashes (—) and curly punctuation in places. The `edit` tool oldText must
    match EXACTLY including these glyphs. Re-read the exact line from README before each edit; do NOT retype
    from this PRP (this PRP reproduces them, but always confirm against the live file). Each oldText must be
    UNIQUE in the file — if a phrase repeats, include surrounding context to disambiguate.

- file: src/index.ts
  why: Source of truth for the v1.1 surface: lines 8-13 (imports), 53-56 (4 registerTool calls),
        58-64 (3 registerCommand calls), 83-87 (reconcileBanner on session_start). Confirms tool count.
  pattern: 4 tools + 3 commands; NO checkpoint registerTool.

- file: src/commands.ts
  why: The three human-command descriptions (verbatim) for drafting the new "Human commands" subsection:
        L164 "Set a Mulligan checkpoint — the agent may rewind across your subsequent prompts back to this point"
        L216 "Revoke a Mulligan checkpoint"
        L270 "Run the Mulligan context-bloat diagnostic — see what the model is carrying"
        All output goes to ctx.ui.notify (NEVER event.messages).

- file: src/banner.ts
  why: The verbatim active-checkpoint banner line (L63) to cite in the new subsection:
        `⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent
        prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>`
  critical: Copy the ⚠ emoji (U+26A0) byte-exact when citing. placement is "aboveEditor".

- file: src/config.ts
  why: Confirms the ui.activeCheckpointBanner knob exists (default true) to add as a config-table row.

- file: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: The contract document. §"README Sweep" is NOT present there, but the change surface confirms the
        v1.1 surface (4 tools, 3 commands, banner, to_previous_prompt removed). Use it to cross-check counts.

- docfile: spec/13-human-commands.md
  why: Authoritative spec for the 3 human commands + banner (§2 set, §3 revoke, §4 audit, §5 banner).
        The README subsection is a one-line-each summary that cites this spec.

- prd: spec/00-SPEC.md §6 (heading h2.132 "Interaction with the rest of the spec")
  why: States v1.1 deltas verbatim: tool count 5→4 (mulligan_checkpoint removed; agent retains
        rewind-to-checkpoint); guardrail (last_turn/last_tool_call_group never wipe user input; checkpoint
        rewind may); drift delta excludes user-attributable content; config adds ui.activeCheckpointBanner.
```

### Current Codebase tree (relevant slice)

```
README.md            # THE file edited by this task (275 lines, v1.0 content)
src/
  index.ts           # v1.1 wiring: 4 tools + 3 commands + reconcileBanner (READ-ONLY reference)
  commands.ts        # 3 human-command factories (READ-ONLY — command descriptions live here)
  banner.ts          # reconcileBanner + verbatim banner line (READ-ONLY reference)
  config.ts          # ui.activeCheckpointBanner knob (READ-ONLY reference)
  tools/
    checkpoint.ts    # unregistered dead code — README must NOT document it as an agent tool
```

### Desired Codebase tree (delta)

```
README.md            # MODIFIED — ~13 exact string swaps + 1 new "### Human commands (v1.1)" subsection
                     #   (no other file is touched)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL #1 — em-dashes & smart typography. README uses "—" (U+2014) and curly quotes in places.
#   The edit oldText must match byte-exact. ALWAYS re-read the exact line from README before each edit;
#   this PRP reproduces the strings, but confirm against the live file (typography can drift).

# CRITICAL #2 — each edit oldText MUST be unique in README.md. If a short phrase repeats (e.g. "checkpoint"
#   appears 10+ times), widen oldText to include disambiguating surrounding text. The full-paragraph
#   replacements below are already unique; the short ones are scoped to be unique.

# CRITICAL #3 — the ⚠ emoji (U+26A0) in the banner citation. Copy it byte-exact from src/banner.ts L63.

# CRITICAL #4 — README is the ONLY file you touch. spec/*.md is DONE (Mode B = README sync only).
#   src/*.ts is DONE (all implementing subtasks). Do NOT "fix" spec or source.

# CRITICAL #5 — the markdown anchor for the cross-reference: a heading "### Human commands (v1.1)"
#   produces the GitHub anchor "#human-commands-v11" (lowercase, spaces→-, drop the dot/parens).
#   Use that exact anchor in the cross-reference link from the removed checkpoint subsection.

# CRITICAL #6 — BUG-006 removal is coupled to the heading + intro edit. BUG-006 is moot ONLY because
#   to_previous_prompt was removed in v1.1. Remove the bullet AND update "BUG-001–BUG-006"→"…BUG-005"
#   AND "six edge-case bugs (1 Major, 5 Minor)"→"five edge-case bugs (1 Major, 4 Minor)" — all together.

# CRITICAL #7 — ordering: do the "remove §4 mulligan_checkpoint subsection" edit and the "add Human
#   commands subsection" edit as conceptual neighbors so the cross-reference anchor resolves. They are
#   independent edits but the cross-ref text depends on the new heading existing.
```

---

## Implementation Blueprint

### Data models and structure
None — this is a documentation edit. The only "data" is the exact old/new strings below.

### Implementation Tasks (ordered by dependencies)

> **Process:** Re-read each target line from the LIVE `README.md` right before editing it (to capture exact
> typography), apply the edit, then move on. Do all 13 edits. The tasks are grouped by README section.
> Every `OLD` block below is reproduced from README; confirm byte-exactness against the file.

```yaml
Task 1: HEADER — Status line (README L5)
  OLD: **Pi:** `0.84.x` · **License:** MIT · **Status:** v1.0
  NEW: **Pi:** `0.84.x` · **License:** MIT · **Status:** v1.1
  WHY: a v1.1 sweep that leaves "Status: v1.0" is self-contradictory.

Task 2: §3 CONFIG — defaults-table intro count (README ~L73)
  OLD: All 20 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3).
  NEW: All 21 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3).
  VERIFY: open src/config.ts DEFAULT_CONFIG and count top-level + nested keys; the README said "20" for v1.0,
          +ui.activeCheckpointBanner = 21. If your count differs, use your count — the live DEFAULT_CONFIG wins.
  WHY: the table claims to list every knob; v1.1 added one.

Task 3: §3 CONFIG — add the new knob ROW to the defaults table
  PLACEMENT: inside the table, after the `log.file` row (the last row, ~L90), add a new group+row.
             Insert a "**ui** | |" group row then the knob row (mirror the existing group/row style).
  ADD these two table rows:
    | **ui** | | |
    | `ui.activeCheckpointBanner` | `true` | Show a persistent above-editor banner while a checkpoint is active (`spec/13` §5; `spec/08` E26). `false` hides the banner without disabling checkpoints. |
  WHY: the v1.1 config surface (P2.M3.T1.S1) added this knob; the table must list it.

Task 4: §3 DISABLING paragraph (README L123) — tool count + checkpoint + human-command gating
  OLD: `enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and **all five tools** refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, `audit`, **and `checkpoint`** all gate on the master switch — each refuses before doing any work; `audit` refuses while staying read-only in its normal operation). The human can disable Mulligan without uninstalling it.
  NEW: `enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, **all four tools** refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, `audit` all gate on the master switch — each refuses before doing any work; `audit` refuses while staying read-only in its normal operation), and the three human commands (`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit`) refuse the same way. The human can disable Mulligan without uninstalling it.
  WHY: contract (a) — 'all five tools'→'all four tools'; drop 'and checkpoint'; note master switch also gates the human commands.

Task 5: §4 TOOLS heading sentence (README L129) — tool count
  OLD: Mulligan registers five agent-callable tools. The descriptions below are **verbatim copies** of the LLM-facing description strings the agent sees at runtime (from `src/tools/*.ts`) — they are the agent's documentation, reproduced here so a human knows exactly what the agent can now do. When-to-use guidance follows each one (from `spec/05-tools.md`).
  NEW: Mulligan registers four agent-callable tools. The descriptions below are **verbatim copies** of the LLM-facing description strings the agent sees at runtime (from `src/tools/*.ts`) — they are the agent's documentation, reproduced here so a human knows exactly what the agent can now do. When-to-use guidance follows each one (from `spec/05-tools.md`).
  WHY: contract (b).

Task 6: §4 REWIND — Granularities table checkpoint row (README L147)
  OLD: | `checkpoint` | Back to a named checkpoint set via `mulligan_checkpoint` (requires the `checkpoint` param). |
  NEW: | `checkpoint` | Back to a named checkpoint the human set via `/mulligan_checkpoint` (requires the `checkpoint` param). |
  WHY: checkpoints are no longer set by an agent tool; the reference 'mulligan_checkpoint' (tool) is stale → '/mulligan_checkpoint' (human command). (Found by the contract (g) grep for 'checkpoint'.)

Task 7: §4 REWIND — REMOVE the to_previous_prompt paragraph (README L149) → guardrail one-liner
  OLD: The optional `to_previous_prompt` (only valid with `last_turn`) is the *nuclear* option: it also discards the most recent user message, abandoning the current ask entirely. It is refused if there is no prior user message (it would otherwise cross the protected first user message).
  NEW: `last_turn` keeps your latest message; to rewind further (across your own subsequent prompts), set a checkpoint first.
  WHY: contract (c) — to_previous_prompt removed in v1.1; replace with the guardrail note. Exact replacement string is from the task contract.

Task 8: §4 — REMOVE the `### mulligan_checkpoint` tool subsection (README L169–L176) → cross-reference
  SCOPE: the entire block from the heading line `### \`mulligan_checkpoint\`` up to (but NOT including) the
         next heading `### \`mulligan_audit\``. That block is the h3 heading + the blockquote + the
         "When to use it:" paragraph + the "name must match" paragraph.
  OLD (the whole subsection, ~7 lines): reproduce exactly from README L169–L176, i.e.
    ### `mulligan_checkpoint`
    [blank]
    > Name the current position so a later mulligan_rewind can jump straight back to it. Use before a speculative sub-task you might want to undo in one shot.
    [blank]
    **When to use it:** before a speculative sub-task you might want to discard wholesale — set a checkpoint, and a later `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` returns to it in one shot. A checkpoint **auto-expires** once a rewind targets it: its label is cleared so it no longer lingers in the active-marker list (`mulligan_audit`); re-creating a checkpoint of the same name later is allowed. The match clears **all** concurrently-labeled targets — a name can be set on more than one target, and the rewind retires every one whose current `getLabel===needle`. (`spec/05-tools.md` §3.)
    [blank]
    The `name` must match `/^[a-z0-9_-]{1,40}$/` (lowercase, digits, hyphen, underscore; 1–40 chars). Invalid names are refused.
    [blank]
  NEW (replace with a short cross-reference paragraph, keeping the blank lines so spacing stays clean):
    Checkpoints moved to the human in v1.1 (the destructive cross-prompt power belongs to the user). See [Human commands (v1.1)](#human-commands-v11) below for `/mulligan_checkpoint` and `/mulligan_checkpoint_revoke`. The agent still rewinds to a checkpoint via `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")`; a checkpoint auto-expires once a rewind targets it.
  WHY: contract (d) — remove the tool subsection, replace with a cross-reference to the new Human commands section.

Task 9: §4 — ADD the new `### Human commands (v1.1)` subsection
  PLACEMENT: immediately AFTER the `### mulligan_cancel` subsection content and BEFORE the `## 5. How It Works`
             heading (i.e. insert at the end of §4 Tools). Find the line "## 5. How It Works" and insert the
             new subsection + a blank line before it.
  ADD (verbatim; strings sourced from src/commands.ts L164/L216/L270 + src/banner.ts L63):

    ### Human commands (v1.1)

    Checkpoints and the bloat diagnostic are the three narrow human commands (the destructive cross-prompt rewind power belongs to the *user*, not the agent — `spec/13-human-commands.md`). Each is a `pi.registerCommand` handler; output goes to `ctx.ui.notify` (the TUI), never into the model's context.

    - **`/mulligan_checkpoint <name>`** — set a named checkpoint at the current position. Until revoked, the agent may `mulligan_rewind` across your subsequent prompts back to this point (the `last_turn` granularity never wipes your latest message, but a `checkpoint` rewind may). A checkpoint auto-expires once a rewind targets it. `name` must match `/^[a-z0-9_-]{1,40}$/`.
    - **`/mulligan_checkpoint_revoke <name>`** — revoke a checkpoint so the agent can no longer rewind to it.
    - **`/mulligan_audit`** — run the same context-bloat diagnostic the agent's `mulligan_audit` tool runs, surfaced to you only (never injected into the model's context).
    - **Active-checkpoint banner** — while any checkpoint is active, a persistent above-editor line reminds you: `⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>`. Disable the banner without disabling checkpoints via `ui.activeCheckpointBanner: false`.

  WHY: contract (e). One line each, citing that checkpoints grant the agent cross-prompt rewind power for their lifetime.

Task 10: §5 — "/tree is the audit trail" narrow-surface framing (README L228)
  OLD: **`/tree` is the audit trail.** Every rewind, shrink, and checkpoint is a persisted entry — the human can inspect the full un-filtered history (including every hidden span) via Pi's native `/tree`. Mulligan adds no human-facing command of its own, because `/tree` already serves that need.
  NEW: **`/tree` is the audit trail.** Every rewind, shrink, and checkpoint is a persisted entry — the human can inspect the full un-filtered history (including every hidden span) via Pi's native `/tree`. Mulligan adds three narrow human commands — checkpoint set/revoke (the destructive cross-prompt power belongs to the user) and audit (the bloat diagnostic a human monitors); `/tree` remains the audit trail.
  WHY: contract (f). Exact replacement string is from the task contract.

Task 11: §5 — drift-nudge delta is agent-attributable (contract 1.f, optional but in-scope)
  LOCATE: the "Per-turn drift nudge" item in the "Ride-along nudges & signals" list (the sentence beginning
          "at `turn_end` Mulligan records the token delta").
  OLD: 2. **Per-turn drift nudge** (`spec/07-preventive-and-nudges.md` §2/§5) — at `turn_end` Mulligan records the token delta; on the *next* inference it injects a single-line annotation
  NEW: 2. **Per-turn drift nudge** (`spec/07-preventive-and-nudges.md` §2/§5) — at `turn_end` Mulligan records the **agent-attributable** token delta (your prompts are exempt, so a large paste you made does not trip the nudge); on the *next* inference it injects a single-line annotation
  WHY: P1.M2 (D10) made the delta agent-attributable. NOTE: only edit the cited sentence prefix; leave the
       rest of the bullet (the e.g. annotation + the windowed/§5.1 explanation) unchanged.
  GOTCHA: if the exact OLD prefix above does not match the live line (e.g. surrounding punctuation differs),
          edit ONLY by inserting the clause "(your prompts are exempt, so a large paste you made does not
          trip the nudge)" right after "token delta" and bolding **agent-attributable** before "token delta".

Task 12: §7 KNOWN LIMITATIONS — bug-list heading + intro (README L251) and BUG-001 reframing (L255) and BUG-006 removal (L259)
  12a. OLD heading: ### Resolved bugs (BUG-001–BUG-006)
       NEW heading: ### Resolved bugs (BUG-001–BUG-005)
  12b. OLD intro: A post-v1.0 validation pass found and fixed six edge-case bugs (1 Major, 5 Minor; 0 Critical, 0 data-loss). These are **resolved** corrections to shipped behavior, listed separately from the ongoing limitations above. All six have regression tests; see VERIFICATION.md "Bug-fix remediation pass" for the full engineering record (root cause, fix, test) and the post-fix test count.
       NEW intro: A post-v1.0 validation pass found and fixed five edge-case bugs (1 Major, 4 Minor; 0 Critical, 0 data-loss). These are **resolved** corrections to shipped behavior, listed separately from the ongoing limitations above. All five have regression tests; see VERIFICATION.md "Bug-fix remediation pass" for the full engineering record (root cause, fix, test) and the post-fix test count.
  12c. OLD BUG-001 bullet: - **BUG-001 (Major)** — `mulligan_checkpoint` consumption now clears **all** concurrently-labeled targets (previously cleared only the first).
       NEW BUG-001 bullet: - **BUG-001 (Major)** — consuming a checkpoint via `mulligan_rewind` now clears **all** concurrently-labeled targets (previously cleared only the first).
       WHY: checkpoints are no longer an agent tool; consumption is by rewind. The behavior (clearing all
            concurrently-labeled targets) is unchanged and still applies to user-set checkpoints.
  12d. REMOVE the BUG-006 bullet entirely (the whole line):
       OLD: - **BUG-006 (Minor)** — `mulligan_rewind` `to_previous_prompt` now refuses when there is no prior user message (would cross the protected first user message).
       WHY: to_previous_prompt was REMOVED in v1.1 → BUG-006 is moot. (Removing it is why the heading range
            and the intro count also drop by one.)
  DO 12a–12d as ONE edit if they are contiguous enough, or as separate edits — but all four must land together.

Task 13: FURTHER READING — spec/05 reference (README L273)
  OLD: - `spec/05-tools.md` — the five tools' full specification.
  NEW: - `spec/05-tools.md` — the four agent tools' full specification.
  WHY: contract (g) grep flags 'five'. (Optionally also append a bullet for `spec/13-human-commands.md` —
       the three human commands + banner — to round out Further reading. OPTIONAL; include it for parity
       with the new §4 subsection: "- `spec/13-human-commands.md` — the three human commands + active-checkpoint banner.")

Task 14: VERIFY (no edit) — contract (g) grep sweep
  RUN the Validation Loop Level 1 grep commands. If ANY stale term remains, locate and fix it. Common
  stragglers: the word "checkpoint" appears legitimately in many places (the banner, the rewind table row,
  the new subsection) — those are FINE. Only stale MEANINGS are failures: an agent-tool framing of
  mulligan_checkpoint, any to_previous_prompt/nuclear mention, any "five tools" / "five agent-callable" /
  "no human-facing command" / "BUG-006" string.
```

### Implementation Patterns & Key Details

```markdown
# Pattern: deterministic string-swap. This task has NO design decisions. Every edit is OLD→NEW with the
# exact text given. The only verification is grep. Resist the urge to "improve" surrounding prose — out of scope.

# Pattern: re-read before edit. README typography (em-dashes, smart quotes) is easy to mis-transcribe.
#   For each task, read the exact line range with the read tool (offset/limit), then issue the edit with the
#   VERBATIM text you just saw as oldText. This is the #1 safeguard against a failed match.

# Pattern: keep blank-line spacing clean. When removing a subsection (Task 8) or adding one (Task 9),
#   ensure you don't leave 3+ consecutive blank lines or remove the blank line between sections.

# The cross-reference anchor (Task 8) and the new heading (Task 9) MUST agree:
#   heading "### Human commands (v1.1)"  →  anchor "#human-commands-v11"
```

### Integration Points

```yaml
DOCS:
  - file: README.md  (the ONLY file touched)
  - none other: spec/*.md is DONE (Mode A per-task already done); src/*.ts is DONE (all implementing subtasks).
CONFIG:
  - none (the ui.activeCheckpointBanner knob already exists in src/config.ts; this task only DOCUMENTS it).
BUILD/TEST:
  - none affected — README.md is not compiled or imported. An optional `npm test` confirms no test asserts
    on README content (none should), but it is not required for this task's correctness.
```

---

## Validation Loop

### Level 1: Stale-reference grep (THE primary gate — contract (g))

```bash
# 1a. These MUST return ZERO matches after the sweep.
grep -nE 'to_previous_prompt|\bnuclear\b|all five tools|five agent-callable|no human-facing command|BUG-006|five tools' README.md
# Expected: no output. If any line prints, fix it (it is a stale reference).

# 1b. These MUST each return ≥1 match (the new v1.1 content is present).
grep -n 'four agent-callable tools' README.md
grep -n 'Human commands (v1.1)' README.md
grep -n 'three narrow human commands' README.md        # the §5 narrow-surface framing
grep -n '/mulligan_checkpoint_revoke' README.md         # appears in the new subsection + §3 + §5
grep -n 'ui.activeCheckpointBanner' README.md           # the new config-table row
# Expected: each prints at least one line.

# 1c. §4 Tools lists exactly 4 agent-tool subsections (NO mulligan_checkpoint h3 in §4).
grep -nE '^### `mulligan_' README.md
# Expected: exactly four lines — mulligan_rewind, mulligan_shrink, mulligan_audit, mulligan_cancel.
#           (If a `### mulligan_checkpoint` line prints, Task 8 was not applied.)

# 1d. The new "Human commands" heading is h3 and sits at the end of §4.
grep -nE '^### Human commands' README.md
# Expected: exactly one line "### Human commands (v1.1)".
```

### Level 2: Markdown sanity (structure intact)

```bash
# Heading levels still well-formed (no broken '## 4' / '## 5' structure).
grep -nE '^## [0-9]' README.md
# Expected: ## 1 .. ## 8 headings present and in order.

# No accidental triple-blank-line gaps from the subsection add/remove.
awk 'BEGIN{b=0} /^$/{b++; if(b>=3) print NR": triple blank gap"; next} {b=0}' README.md
# Expected: no output.

# The cross-reference anchor target exists.
grep -nE '^### Human commands \(v1\.1\)' README.md
# Expected: one line (the heading Task 9 added).
```

### Level 3: Suite non-regression (optional, confirms no README-asserting test)

```bash
npm test
# Expected: green. README.md is not imported by any test, so this should be a no-op pass — run it only to
# confirm nothing in the parallel-landing test work (P2.M3.T1.S4) asserted on README text.
```

### Level 4: Human read-through (domain validation)

```bash
# Render-readiness: confirm the two contract replacement strings landed verbatim.
grep -n '`last_turn` keeps your latest message; to rewind further' README.md   # Task 7 (contract c)
grep -n 'Mulligan adds three narrow human commands' README.md                  # Task 10 (contract f)
# Expected: both print exactly one line each.
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1a grep returns ZERO stale matches.
- [ ] Level 1b grep shows all new terms present.
- [ ] Level 1c: exactly 4 `### mulligan_*` tool subsections; no `### mulligan_checkpoint` in §4.
- [ ] Level 1d: one `### Human commands (v1.1)` heading.
- [ ] Level 2: headings `## 1`–`## 8` intact; no triple-blank gaps.

### Feature Validation (contract acceptance)
- [ ] (a) Disabling: "all four tools"; no "and checkpoint"; human commands noted as gated.
- [ ] (b) §4 heading: "four agent-callable tools".
- [ ] (c) to_previous_prompt paragraph replaced by the guardrail one-liner (verbatim).
- [ ] (d) `### mulligan_checkpoint` subsection removed; cross-reference to Human commands present.
- [ ] (e) `### Human commands (v1.1)` subsection present with the 3 commands + banner.
- [ ] (f) §5 narrow-surface framing (verbatim).
- [ ] (1.f) drift-nudge delta noted agent-attributable (user prompts exempt).
- [ ] (g) grep sweep clean (no stale references).
- [ ] (h) only README.md touched.

### Code Quality / Scope Validation
- [ ] No edits to `spec/*.md`, `src/*.ts`, `test/*`, or any `tasks.json` / PRD snapshot.
- [ ] No "improvements" to surrounding prose beyond the enumerated edits.
- [ ] Em-dashes / smart quotes / the `⚠` emoji preserved byte-exact where cited.

### Documentation Validation
- [ ] `Status: v1.1` in the header.
- [ ] Config table lists `ui.activeCheckpointBanner` (+ count updated to match DEFAULT_CONFIG).
- [ ] BUG-006 removed; heading/intro/BUG-001 updated consistently.

---

## Anti-Patterns to Avoid

- ❌ Do NOT edit any file other than `README.md` — spec is done, source is done (Mode B = README sync only).
- ❌ Do NOT retype the em-dash/`⚠`/smart-quote strings from memory — re-read the live line and copy exact.
- ❌ Do NOT leave BUG-006 in "for the record" — it is moot (to_previous_prompt is gone); keeping it would
  document a field that no longer exists, failing the contract (g) grep.
- ❌ Do NOT document `mulligan_checkpoint` as an agent tool anywhere — it is a human command (`/mulligan_checkpoint`).
   The `checkpoint` GRANULARITY of `mulligan_rewind` still exists (the agent rewinds to user-set checkpoints);
   only the standalone checkpoint agent tool is gone.
- ❌ Do NOT touch the `spec/05-tools.md §3` cross-reference in BUG-001 wording in a way that implies an agent
   tool — reframe to "consuming a checkpoint via mulligan_rewind".
- ❌ Do NOT add the `ui.activeCheckpointBanner` row with a wrong default — it is `true` (src/config.ts).
- ❌ Do NOT renumber or reorder README sections — this is an in-place sweep, not a restructure.
- ❌ Do NOT split the BUG heading/intro/BUG-001/BUG-006 edits — they are coupled (the count and range must
   all move from 6→5 together or the section is internally inconsistent).

---

## Confidence Score: 9/10

Every edit is a deterministic OLD→NEW string swap with the exact text captured from the live `README.md`
and cross-checked against the real v1.1 source (`index.ts`, `commands.ts`, `banner.ts`, `config.ts`). The
only residual uncertainty is (1) the exact config-knob COUNT in `config.ts DEFAULT_CONFIG` (Task 2 says
verify; the live DEFAULT_CONFIG is authoritative) and (2) byte-exact typography matching on a couple of
paragraphs — both are resolved by re-reading the line before editing. There are no design decisions, so
one-pass success is highly likely. The validation is a copy-pasteable grep that mechanically confirms
"no stale refs + new content present."

---
~1 file edited (README.md). ~13 exact string swaps + 1 new subsection. No build/test impact.