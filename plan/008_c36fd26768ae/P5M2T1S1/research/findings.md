# Research Findings — P5.M2.T1.S1 (README v1.2 section + stale-reference sweep)

Item: "README.md 'Working-tree revert (v1.2)' section + stale-reference sweep".
Mode B (changeset-level documentation sync). OUTPUT: README has a comprehensive v1.2 section; no stale references (README + src).

This is a DOCUMENTATION-ONLY item. No logic/behavior changes. PRP may authorize **comment-only** fixes in src/ for stale "five tools"/orphan-v1.1 language.

---

## A. README.md — current structure & tone (mirror it)

Sections (top-level, numbered):
1. Overview
2. Installation
3. Configuration (defaults table — "All 21 knobs"; minimal settings.json example; "Disabling" subsection)
4. Tools (4 agent tools, each with a "verbatim copy" blockquote + When-to-use; "### Human commands (v1.1)" subsection)
5. How It Works (data-flow ASCII diagram; ride-along nudges)
6. Guarantees (3: soft-delete/audit trail; fail-open; zero-config)
7. Known Limitations (4 deliberate non-goals; BUG-001..005; v1.1 BUG-001..004)
8. License
- Further reading (spec/ pointers)

Tone markers to mirror: lead one-liner; blockquote verbatim desc strings; "When to use it" lists; spec cross-refs like `spec/14 §N`; tables for enumerations; bold **key term:** prefixes; `**Status:** vX.Y` in the header.

Header line (line 4): `**Pi:** \`0.84.x\` · **License:** MIT · **Status:** v1.1`  ← bump to v1.2.

---

## B. The 7 contract sub-points — verified source of truth (all confirmed in src)

| # | Contract bullet | Verified truth (file:line) |
|---|-----------------|----------------------------|
| 1 | What it is — opt-in file restoration so resumed agent needn't re-read files | spec/14 §0 Motivation (h2.140); config.ts:82-86 "opt-in" |
| 2 | How to enable — `config.revert.enabled: true` | config.ts:91-96 (`enabled: boolean`, default false); validated config.ts:353-354 |
| 3 | Per-call flags — `revert_file_changes`, `delete_created_files` on mulligan_rewind | rewind.ts:132-149 (Type.Optional Type.Boolean) — exact desc strings captured below |
| 4 | Granularity scope — last_turn/checkpoint only; last_tool_call_group refused (noticed) | rewind.ts:605, 649, 816, 822-826 (branch 3 notice); spec/14 §1 table |
| 5 | Git-safety guarantee — never touches user's .git (external shadow repo) | spec/14 §3 five guarantees (h2.143); config.ts:108-111 storageDir NOT under cwd |
| 6 | Dirty-guard behavior — refuses whole file-revert if any file changed since turn ended | spec/14 §6 step 3 (refuse-on-dirty); §3 guarantee #5 |
| 7 | Non-git mode — CAS backend for non-git dirs | spec/14 §4 (cas default / explicit-paths); config.ts:99-103 nonGitMode |

Plus contract emphasis: **this feature touches the WORKING TREE (files on disk), NOT the session tree** (the append-only conversation tree is never mutated). Mirror spec/14 §0 "What it is NOT" framing.

### Exact strings to copy/use (verified verbatim from src)

**REWIND_DESC (rewind.ts:156-157) — the §4 mulligan_rewind blockquote MUST match this exactly (README claims "verbatim copy"):**
```
Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message. Set revert_file_changes to also restore the working-tree files you modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only).
```
NOTE: the current README §4 blockquote is ALREADY out of sync even pre-v1.2 ("disappears from your view permanently" vs current "is hidden from your context going forward") AND missing the v1.2 append sentence. → must replace wholesale.

**revert_file_changes param desc (rewind.ts:136):**
```
v1.2 OPT-IN. When true (granularity last_turn/checkpoint), restore the working-tree files you modified in the rewound span to their pre-span state, so you need not re-read them on resume. Best-effort; failures are logged and never block the rewind. Requires revert to be enabled in config. Ignored at last_tool_call_group granularity (noticed in the result).
```

**delete_created_files param desc (rewind.ts:141):**
```
v1.2 OPT-IN, DESTRUCTIVE. When true, DELETE working-tree files the rewound span newly created (files that did not exist before the span). Requires BOTH this flag AND config.revert.allowDeleteCreatedFiles. Best-effort.
```

**Granularity-refusal notice (rewind.ts:826, returned in success text at last_tool_call_group):**
```
File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.
```

### config.revert.* block — all 8 knobs (config.ts:86-130; validated 350-368). Defaults (spec/14 §8 / h2.148):
```
enabled: false                    // master opt-in — DEFAULT OFF
allowDeleteCreatedFiles: false    // global kill-switch on the destructive delete
nonGitMode: "cas"                 // "cas" (default) | "explicit-paths"
storageDir: null                  // shadow-repo / CAS root; null → <sessionDir>/mulligan/. NEVER under cwd.
maxFileBytes: 262144              // 256 KB; skip+warn (fail-closed)
maxTotalBytes: 33554432           // 32 MB per session; partial snapshot beyond
maxSnapshotsPerTurn: 64           // count cap
excludeGlobs: [".git","node_modules","dist","build",".next",".venv","target"]  // BOTH backends; .gitignore NOT used
```

---

## C. STALE-REFERENCE SWEEP — README.md (precise inventory)

| Loc | Current text | Issue | Fix |
|-----|--------------|-------|-----|
| Line 4 (header) | `**Status:** v1.1` | v1.2 feature now documented | → `**Status:** v1.2` |
| Line 79 (§3 caption) | "All 21 knobs" | revert.* added 8 more (now 29); caption stale | Either add a revert.* row-group to the §3 table OR document the 8 knobs in the new v1.2 section and update caption → "All 21 base knobs (the v1.2 `revert` block is documented in [§5 Working-tree revert](#5-working-tree-revert-v12-opt-in))". RECOMMEND the latter (keeps §3 stable, v1.2 self-contained). |
| Line 131 (§4 intro) | "Mulligan registers four agent-callable tools." | ACCURATE (index.ts registers exactly 4: rewind/shrink/audit/cancel). NOT stale. | Keep; optionally add: "(v1.2 adds optional *params* to `mulligan_rewind`, not a new tool.)" to preempt confusion (contract: "still 4 agent tools + 2 new optional params"). |
| Line ~133-135 (§4 mulligan_rewind blockquote) | "…disappears from your view permanently… …from the user's last message." | Out of sync with current REWIND_DESC (verbatim claim broken) | Replace with exact REWIND_DESC (see §B above). |
| Line 125 (Disabling) | "all four tools refuse cleanly" | ACCURATE. | Keep. Optionally note revert machinery is also fully inert when enabled:false (consistency). |
| Line ~233 (§7 "No general undo") | "…no un-rewind that replays hidden content or reverses on-disk side effects (file edits and bash commands persist)…" | Conditionally softened by v1.2 opt-in file-revert | Add caveat: file CONTENT is now reversible on opt-in (v1.2); non-filesystem effects (bash network/DB/git refs) + the session-tree view still persist. |
| Line ~239 (§7 "No hard retry / replay") | "Hidden tool calls' side effects persist on disk (files written, commands run)" | Same — file writes conditionally reversible | Add v1.2 caveat (opt-in revert restores file content; non-filesystem bash effects still persist). |
| "Further reading" | lists spec/05,06,09,08,13 | missing spec/14 | Add `spec/14-working-tree-revert.md` bullet. |

Internal anchor-link audit (for renumbering): the ONLY `](#...)` links are `#3-configuration` (line 29), `#disabling` (80), `#human-commands-v11` (173), `#4-tools` (227). NONE reference §5/§6/§7/§8 → inserting the new section as §5 and renumbering How It Works→§6, Guarantees→§7, Known Limitations→§8, License→§9 will NOT break any anchor. SAFE.

---

## D. STALE-REFERENCE SWEEP — src/ (comment-only; DO NOT delete checkpoint.ts)

CRITICAL: `src/tools/checkpoint.ts` is a LIVE module — `commands.ts:34` imports `validCheckpointName` from it, and `test/tools/checkpoint.test.ts`, `test/edge-cases.test.ts`, `test/integration/smoke.ts` import `makeCheckpointTool`. It is just NOT registered as an agent tool (index.ts:68-71 registers rewind/shrink/audit/cancel; index.ts:77 registers the checkpoint as a COMMAND via makeCheckpointCommand). So the file stays; only its stale COMMENTS (orphan-v1.1 language) get corrected.

| File:line | Current comment text | Issue | Fix (comment-only) |
|-----------|----------------------|-------|--------------------|
| checkpoint.ts:2-4 | "`mulligan_checkpoint` agent-callable tool (spec/05 §3)" / "THIRD of the four Mulligan agent-callable tools" | FALSE — checkpoint moved to a human command in v1.1 (commands.ts makeCheckpointCommand; not registerTool). This is the "orphan v1.1 language". | Reword to: the checkpoint *command* helper / shared validation; note it is registered as a human command (spec/13), not an agent tool, since v1.1. |
| checkpoint.ts:25, 179 | "index.ts will do `pi.registerTool(makeCheckpointTool(pi))`" | FALSE — index.ts never does this. | Correct: makeCheckpointTool is exercised by unit/integration tests; the user-facing surface is the `/mulligan_checkpoint` command. |
| checkpoint.ts:33 | "byte-identical disabled text across all five tools" | STALE COUNT — pre-v1.1 (was 5). Now 4 agent tools. | "across the four agent tools" (rewind/shrink/audit/cancel) — or reword to not assert a count. |
| checkpoint.ts:134 | "Byte-identical to the other four tools' disabled text." | Count off (checkpoint not a registered tool). | Reconcile with the corrected header. |
| cancel.ts:137 | " * other four tools." | Verify context — cancel IS one of the 4 agent tools; "the other four" implies 5. | If it implies checkpoint is the 5th, fix to "the other three agent tools" or reword. Minor. |
| audit.ts:703 | "makeCheckpointTool/makeRewindTool/makeShrinkTool" grouped | Verify — may be an accurate historical reference to factory pattern. | Fix only if it asserts checkpoint is a registered agent tool. |

Conservative scope: the unambiguous stale items are checkpoint.ts:2-4, 25, 33, 134, 179 (the "five tools" count + false "agent-callable/registered" claims). cancel.ts:137 and audit.ts:703 are secondary — verify and fix only if clearly asserting a wrong tool count/registration.

---

## E. Placement decision for the new section

Insert "## Working-tree revert (v1.2, opt-in)" as a NEW top-level numbered section §5, immediately after §4 Tools. Renumber: How It Works→§6, Guarantees→§7, Known Limitations→§8, License→§9. Anchor audit (above) confirms zero broken links. Rationale: the contract specifies the `##` heading; the feature is architecturally distinct (working-tree, not context-tree) and substantial; the v1.1 precedent (subsection under §4) was for smaller command-surface additions. Decisive recommendation = top-level §5.

---

## F. Test/validation posture

This is a DOCS task. There is no new code, so `npm test`/`tsc` remain green by construction (comment-only src edits don't change behavior). Validation = (1) README renders (markdown lint / manual), (2) the resynced blockquote is BYTE-IDENTICAL to REWIND_DESC (diff check), (3) `grep` confirms no remaining "five tools"/"all five"/orphan-v1.1 language in README+src, (4) `npm run typecheck` still green (sanity, since checkpoint.ts comments are touched). No new tests required.

---

## G. Dependency on parallel item P5.M1.T1.S3

S3 is a TEST-only item (test/integration/revert-edge.test.ts). It does NOT touch README or src comments. Zero overlap with this docs item. No coordination needed.