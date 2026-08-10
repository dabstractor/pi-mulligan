# PRP — P1.M5.T1.S2: README feature blurbs for four behavior changes

## Goal

**Feature Goal**: Sync `README.md`'s **§4 Tools** blurbs and **§5 How It Works** nudge prose so they reflect
the four user-visible behavior changes shipped across M1–M4: (1) `mulligan_cancel` now takes a `target` hint
(same shape as `mulligan_shrink`); (2) `mulligan_shrink` echoes the replacement to the operator via a zero-
context UI toast; (3) `mulligan_checkpoint` auto-expires once a rewind targets it; (4) the bloat/drift nudge
text is shorter and the drift nudge no longer re-announces bloat the agent already addressed. The README §4
blurbs are documented as "verbatim copies" of the LLM-facing description strings, so they must track the
shipped code. Today three of the four blurbs are stale (cancel still says "pass the markerId"; shrink +
checkpoint omit the new behavior; the §5 drift-nudge example text is invented and its thresholds contradict
the §3 config table).

**Deliverable**: **Six text edits to `README.md` only** (no code, no tests, no spec files), all within §4
(`## 4. Tools`, lines ~153–195) and §5 (`## 5. How It Works`, lines ~222–223):

1. **Cancel blockquote** (§4, ~line 191) — replace with the new verbatim `CANCEL_DESC` (mentions `target`).
2. **Cancel "When to use it"** (§4, ~line 193) — rewrite the "pass the markerId" sentence to target-first.
3. **Shrink prose** (§4, after ~line 155) — add an "Operator echo" note (UI toast, terse result). Blockquote
   (= verbatim `SHRINK_DESC`, unchanged) is **NOT touched**.
4. **Checkpoint "When to use it"** (§4, ~line 169) — add the auto-expiry sentence. Blockquote (= verbatim
   `CKPT_DESC`, unchanged) is **NOT touched**.
5. **Bloat reminder** (§5, ~line 222) — note shorter single-line text; fix stale thresholds to match §3.
6. **Drift nudge** (§5, ~line 223) — replace stale example text with the shipped line; add the delta-only /
   no-re-announce-bloat behavior.

**Success Definition**: After the edits, README §4 describes all four behaviors accurately (matching the
shipped `src/tools/*.ts` + `src/notes.ts`), the §4 "verbatim copies" invariant holds (the cancel blockquote
== `CANCEL_DESC`; the shrink + checkpoint blockquotes remain unchanged == their unchanged desc strings), and
§5's bloat/drift nudge prose matches both the shipped nudge text AND the §3 config table (no internal
contradiction). No file other than `README.md` is modified; §3 (config table + JSON) is left to the parallel
sibling P1.M5.T1.S1.

## User Persona (if applicable)

**Target User**: pi-mulligan operators and developers reading `README.md` to understand what each Mulligan
tool does at runtime — and the build agent that treats README §4 as the human-facing mirror of the verbatim
LLM-facing description strings in `src/tools/*.ts`.

**Use Case**: An operator reads §4 `mulligan_cancel` to understand how to retract a mis-targeted marker. They
learn it identifies the marker *by target* (the same hint shape `mulligan_shrink` uses), not only by id —
matching what the agent actually does at runtime.

**Pain Points Addressed**: Today the README is behind the code on all four behaviors: cancel still says "pass
the markerId" (the pre-M1 id-only API); shrink and checkpoint omit the operator-echo / auto-expiry behaviors;
§5's drift-nudge example text is invented (`[mulligan: last turn +4.2k tokens; rewind available]`) and its
bloat thresholds (`bash`: 32 KB, `read`: 20 KB) contradict the §3 table (`bash` unlisted → 16 KB global;
`read`: 24 KB). This task makes §4/§5 whole and self-consistent.

## Why

- **Code↔spec↔README three-way consistency.** M1–M4 shipped four user-visible behavior changes; the spec
  (`spec/05-tools.md` §2/§3/§5, `spec/07-preventive-and-nudges.md` §1/§2/§5) already documents them. The
  README — which the project calls the human-facing tool reference and which states its §4 blurbs are
  "verbatim copies" of the runtime description strings — is the one artifact still behind on all four.
- **The §4 "verbatim copies" invariant is a maintained contract.** README line ~129 states the §4 blockquotes
  are verbatim copies of the LLM-facing desc strings in `src/tools/*.ts`. `mulligan_cancel`'s desc string
  *changed* in M1.T1.S1 (it now mentions `target`), so the blockquote is now stale and violates that
  invariant. The other two desc strings (`SHRINK_DESC`, `CKPT_DESC`) are *unchanged*, so their blockquotes
  stay verbatim and the new behavior is documented in the README's own surrounding prose instead.
- **Internal consistency (§5 vs §3).** §5's bloat-reminder line carries threshold numbers that contradict the
  §3 config table shipped in P4 / S1. Since this task edits that exact line for Change (4), fixing the numbers
  to match §3 is in-scope and prevents the README from contradicting itself.
- **Scope discipline.** This is the *prose-blurbs* half of the M5 README sync. The sibling P1.M5.T1.S1 owns
  §3 (config table + JSON example); this task owns §4 (tool prose) + §5 (How It Works). The two are
  text-disjoint (no overlapping FIND strings) and compose cleanly regardless of landing order.

## What

Six text edits to `README.md` — three in §4 (cancel blockquote, cancel when-to-use, shrink echo note,
checkpoint expiry note = 4 edits in §4) and two in §5 (bloat reminder, drift nudge). No other file is touched.

### Success Criteria

- [ ] §4 `mulligan_cancel` blockquote (line ~191) equals the new shipped `CANCEL_DESC` verbatim (mentions
      `target` hint + `markerId` fallback).
- [ ] §4 `mulligan_cancel` "When to use it" (line ~193) describes identifying the marker by `target`
      (preferred) + `markerId` fallback, and no longer says "pass the markerId you received in details".
- [ ] §4 `mulligan_shrink` section adds an operator-echo note (UI toast via `ctx.ui.notify`, capped by
      `shrink.notifyMaxChars`, result stays terse, zero context cost); its blockquote is **unchanged**.
- [ ] §4 `mulligan_checkpoint` "When to use it" adds the auto-expiry-on-consumption note; its blockquote is
      **unchanged**.
- [ ] §5 bloat-reminder line (line ~222) reflects a single-line reminder and thresholds matching §3 (`bash`
      + unlisted = 16 KB global; `read` = 24 KB); no `32 KB` / `20 KB` strings remain.
- [ ] §5 drift-nudge line (line ~223) uses the actual shipped nudge text as its example and documents the
      delta-only / no-re-announce-bloat behavior; the stale `[mulligan: last turn +4.2k tokens; rewind
      available]` string is gone.
- [ ] No file other than `README.md` is modified; §3 is left untouched (sibling S1's scope).

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text of every README edit site (with line numbers), the
verbatim target text for each (derived from the shipped `CANCEL_DESC` / `SHRINK_DESC` (unchanged) /
`CKPT_DESC` (unchanged) / `renderBloatReminder` / `renderDriftNudge` / `rewind.ts` checkpoint-consumption
step), and the source-of-truth file:line for each. The implementer needs to open only `README.md` and apply
six find/replace edits (two of which append a sentence/paragraph to an existing line).

### Documentation & References

```yaml
# MUST EDIT — the sole deliverable target
- file: README.md
  why: §4 Tools (lines ~153–195) — cancel blockquote (~191) + cancel when-to-use (~193); shrink echo note
        (append after ~155); checkpoint expiry note (append to ~169). §5 How It Works (lines ~222–223) —
        bloat reminder + drift nudge.
  pattern: "§4 blockquotes are VERBATIM copies of the LLM-facing desc strings (README line ~129 states this).
            When a desc string changed (cancel), update the blockquote to match verbatim. When the desc
            string is unchanged (shrink, checkpoint), do NOT touch the blockquote — add the new-behavior note
            to the README's own surrounding prose ('When to use it'). §5 nudge prose is the README's own
            description (not verbatim) — edit freely but keep it consistent with the §3 config table."
  gotcha: "the §4 'When to use it:' / '**When to use it' string appears in MULTIPLE tool sections — never use
           it alone as a FIND anchor; always anchor on the full unique sentence that follows it."

# SOURCE OF TRUTH — cancel desc (the blockquote must match it verbatim)
- file: src/tools/cancel.ts
  why: CANCEL_DESC export — the new desc string the README §4 cancel blockquote must equal verbatim. It now
        mentions `target` (same hint shape as mulligan_shrink) + `markerId` fallback.
  section: "CANCEL_DESC (the exported const; ~line 150)."
  critical: "this is the ONLY one of the three desc strings that CHANGED — its blockquote is the only §4
             blockquote that gets replaced. SHRINK_DESC + CKPT_DESC are unchanged."

# SOURCE OF TRUTH — shrink behavior (desc unchanged; echo is the change)
- file: src/tools/shrink.ts
  why: SHRINK_DESC (~line 109) is UNCHANGED → shrink blockquote stays verbatim, do NOT touch. The CHANGE is
        the operator echo: ctx.ui.notify (lines 324–326) capped by config.shrink.notifyMaxChars (default
        2048); the tool result stays terse via feedbackText (line 146) = 'Mulligan: shrink recorded.
        Matched: yes/no.'. Zero context cost (ctx.ui.notify never enters the model's context).
  section: "SHRINK_DESC (109–112); feedbackText (145–147); ctx.ui.notify echo (320–326)."

# SOURCE OF TRUTH — checkpoint desc (unchanged) + rewind consumption step (the change)
- file: src/tools/checkpoint.ts
  why: CKPT_DESC (line 79) is UNCHANGED → checkpoint blockquote stays verbatim, do NOT touch.
- file: src/tools/rewind.ts
  why: step (7b) checkpoint consumption (lines 558–577) — on the checkpoint-granularity success path, the
        checkpoint label `mulligan:checkpoint:<name>` is cleared (consumed) so it no longer lingers in the
        active-marker list; re-creating the same name later is allowed. Best-effort, own try/catch (E13).
  section: "step (7b), the `if (granularity === \"checkpoint\")` block."

# SOURCE OF TRUTH — nudge text (the change is the text itself)
- file: src/notes.ts
  why: renderBloatReminder (274–276) now 2-arg, single-line text after a `\\n---\\n` separator; renderDriftNudge
        (311–322) single physical line, NO bloat clause on the delta path (bloat only as no-baseline fallback).
        README §5 must describe this new text and the no-re-announce-bloat behavior.
  section: "renderBloatReminder (251–276); renderDriftNudge (280–323)."

# CROSS-CHECK — the §3 config table the §5 thresholds must match
- file: README.md
  why: §3 config table (line ~96) documents `nudges.bloatThresholdBytesByTool: { "read": 24576 }` and global
        `bloatThresholdBytes: 16384`. §5's stale `bash: 32 KB, read: 20 KB` contradicts this — the §5 fix
        makes them agree (bash + unlisted = 16 KB global; read = 24 KB).
  gotcha: "this is the SAME file (README.md) — the §3 table is the authority the §5 line is reconciled to."

# CONTEXT — the architecture research (pins README edit regions)
- file: plan/005_95d30743cdd4/architecture/system_context.md
  why: "README.md | 262 LOC | M5 | ... tool blurbs at §4" — pins the §4/§5 edit region and confirms M1–M4 are
        all Complete (the behavior is shipped; README is the lagging artifact).

# CONTEXT — the parallel sibling PRP (confirms non-overlap)
- file: plan/005_95d30743cdd4/P1M5T1S1/PRP.md
  why: S1 owns §3 (config table + JSON) ONLY. Its GOTCHA #6 explicitly defers the §4 tool blurbs + §5 prose
        to THIS task (S2). Text-disjoint FIND anchors — the two compose cleanly.
  critical: "do NOT edit §3 — that is S1's scope and may be landing in parallel."

# CONTEXT — the research notes (verbatim source extracts for all four changes)
- file: plan/005_95d30743cdd4/P1M5T1S2/research/research_notes.md
  why: captures the verbatim CANCEL_DESC / SHRINK_DESC (unchanged) / CKPT_DESC (unchanged) /
        renderBloatReminder / renderDriftNudge / rewind (7b) text + the README §4 "verbatim copies" rule.
```

### Current Codebase tree (the only relevant slice)

```bash
README.md                 # ← EDIT: 6 edits (§4 cancel blockquote + when-to-use; §4 shrink echo note;
                          #              §4 checkpoint expiry note; §5 bloat reminder; §5 drift nudge).
src/tools/cancel.ts       # READ-ONLY source of truth (CANCEL_DESC — the new desc the blockquote must match)
src/tools/shrink.ts       # READ-ONLY (SHRINK_DESC unchanged; ctx.ui.notify echo lines 324–326 — the behavior)
src/tools/checkpoint.ts   # READ-ONLY (CKPT_DESC unchanged, line 79)
src/tools/rewind.ts       # READ-ONLY (checkpoint consumption step (7b), lines 558–577 — the behavior)
src/notes.ts              # READ-ONLY (renderBloatReminder + renderDriftNudge — the new nudge text)
plan/005_95d30743cdd4/architecture/system_context.md   # READ-ONLY (pins README §4/§5 edit region; M1–M4 Complete)
plan/005_95d30743cdd4/P1M5T1S1/PRP.md                  # READ-ONLY (sibling — owns §3; confirms non-overlap)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
README.md   # §4: cancel blockquote (verbatim CANCEL_DESC) + cancel when-to-use (target-first);
            #      shrink prose (+operator echo note); checkpoint prose (+auto-expiry note).
            # §5: bloat reminder (shorter text + thresholds reconciled to §3); drift nudge (shipped text +
            #      delta-only / no-re-announce-bloat).
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- GOTCHA #1 (§4 blockquotes are VERBATIM copies of the runtime desc strings — README line ~129). This
     determines WHERE each edit goes:
       - CANCEL_DESC CHANGED in M1 → the cancel BLOCKQUOTE must be replaced with the new verbatim CANCEL_DESC.
       - SHRINK_DESC + CKPT_DESC are UNCHANGED → their blockquotes stay verbatim; the new behavior (echo /
         auto-expiry) is documented in the README's OWN "When to use it" prose BELOW the blockquote.
     Never edit a §4 blockquote unless its backing desc string changed (verify against src/tools/*.ts). -->

<!-- GOTCHA #2 (the "When to use it" anchor is NOT unique). The string "**When to use it" / "**When to use
     it:**" appears in the shrink, checkpoint, audit, AND cancel sections. NEVER use it alone as a FIND
     anchor — always anchor on the FULL unique sentence/paragraph that follows it (e.g. the checkpoint one
     starts "before a speculative sub-task you might want to discard wholesale"; the cancel one starts "the
     safety valve for a mis-targeted"). Each full paragraph IS unique. -->

<!-- GOTCHA #3 (the §5 threshold numbers are stale and contradict §3 — fix them as part of Change 4). §5 line
     ~222 says "`bash`: 32 KB, `read`: 20 KB"; the §3 config table (line ~96) says
     `bloatThresholdBytesByTool: { "read": 24576 }` and global 16384, i.e. read = 24 KB and bash (unlisted)
     uses the 16 KB global. Since you are rewriting that exact line for Change (4), make the thresholds match
     §3: "bash and unlisted tools: the 16 KB global default; read: 24 KB". Leaving the stale 32/20 KB would
     make the README contradict its own §3 table two sections apart. -->

<!-- GOTCHA #4 (the §5 drift-nudge EXAMPLE TEXT is invented — replace with the shipped line). §5 line ~223
     shows the example `[mulligan: last turn +4.2k tokens; rewind available]`, which is NOT what the code
     emits. The shipped renderDriftNudge (src/notes.ts) emits a single line with NO `[mulligan]` prefix:
     "Previous turn added ~<k> tokens to your context. If that growth was wasteful, call `mulligan_rewind`
     (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown." Use that
     (with a concrete delta like ~4.2k) as the new example. -->

<!-- GOTCHA #5 (Change 2 is NOT a desc-string change — do not touch the shrink blockquote). The operator echo
     is a BEHAVIOR change (ctx.ui.notify in shrink.ts), but SHRINK_DESC itself is unchanged. So the shrink
     blockquote (line ~155) stays byte-identical; the echo note is appended to the README's own prose. If you
     find yourself editing the shrink blockquote, STOP — you have the wrong edit. -->

<!-- GOTCHA #6 (Change 3 is NOT a desc-string change — do not touch the checkpoint blockquote). Same logic:
     CKPT_DESC (checkpoint.ts line 79) is unchanged; the auto-expiry is a rewind.ts behavior. The checkpoint
     blockquote (line ~169) stays verbatim; the expiry note goes in "When to use it". -->

<!-- GOTCHA #7 (do NOT touch §3 — that is sibling P1.M5.T1.S1's scope). S1 owns the config table + JSON
     example. This task owns §4 (tool prose) + §5 (How It Works). If S1 lands in parallel, its §3 edits
     (caption count, notifyMaxChars row, JSON shrink block) are text-disjoint from these §4/§5 edits — the
     two compose cleanly. Do not pre-empt or "help" with §3. -->

<!-- GOTCHA #8 (Unicode em-dashes and §5 formatting). The §5 nudge lines use Unicode em-dashes (—) and
     markdown bold/italics. Reproduce the FIND anchors EXACTLY (the edit tool matches byte-for-byte). The
     numbered list items "1." / "2." / "3." must stay ordered; do not renumber. -->

<!-- GOTCHA #9 (spec cross-ref style in README is `spec/NN-name.md`, NOT the spec's `@NN-name.md`). Mirror
     the existing README convention (see existing rows: `spec/05-tools.md`, `spec/07-preventive-and-nudges.md`,
     `spec/08-edge-cases.md`). When citing spec/05 §5 for cancel, write `spec/05-tools.md §5`, not `@05`. -->
```

## Implementation Blueprint

### Data models and structure

N/A — pure documentation. No types, schemas, or runtime models change. The only "models" are the README §4
blockquote (which must equal a shipped desc string verbatim) and the §5 prose paragraphs (the README's own
description).

### Implementation Tasks (ordered by dependencies — all independent; apply in one pass)

```yaml
Task 1: EDIT README.md §4 — replace the mulligan_cancel BLOCKQUOTE with the new verbatim CANCEL_DESC
  - FIND (the full blockquote, line ~191 — unique):
      "> Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Pass the markerId you received in details when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."
  - REPLACE (the NEW verbatim CANCEL_DESC — the desc string itself changed in M1.T1.S1):
      "> Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Identify the marker by `target` (same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."
  - WHY: README line ~129 declares §4 blockquotes are VERBATIM copies of the runtime desc strings. CANCEL_DESC
    changed in M1.T1.S1 to mention `target`; the blockquote must follow. The only blockquote of the three that
    gets replaced (GOTCHA #1).
  - DO NOT: change anything outside the blockquote on this edit (the "When to use it" is Task 2). Do not
    reword CANCEL_DESC — copy it verbatim from src/tools/cancel.ts.

Task 2: EDIT README.md §4 — rewrite the mulligan_cancel "When to use it" (target-first)
  - FIND (the full paragraph, line ~193 — unique; it starts "the safety valve"):
      "**When to use it:** the safety valve for a mis-targeted `mulligan_rewind` or `mulligan_shrink` — a shrink issued against the wrong message, a rewind that hid something you still need, or any marker pointed at the wrong target. Without it, the mistaken transform would apply on every turn for the rest of the session, and a `mulligan_rewind` of the issuing call does **not** retire it (markers are control entries outside the rewind's span). Pass the `markerId` you received in `details` when you issued the marker; the transform stops applying from the next turn on. Cancelling a non-existent or already-cancelled id is a safe no-op — call it freely if unsure."
  - REPLACE (target-first, markerId as fallback; spec pointer):
      "**When to use it:** the safety valve for a mis-targeted `mulligan_rewind` or `mulligan_shrink` — a shrink issued against the wrong message, a rewind that hid something you still need, or any marker pointed at the wrong target. Without it, the mistaken transform would apply on every turn for the rest of the session, and a `mulligan_rewind` of the issuing call does **not** retire it (markers are control entries outside the rewind's span). Identify the marker by `target` — the same hint shape `mulligan_shrink` uses (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`), resolved live each turn; the most recent marker covering that content is retired. An explicit `markerId` (from `details`) is accepted as a fallback if you have one. The transform stops applying from the next turn on; cancelling a non-existent or already-cancelled marker is a safe no-op — call it freely if unsure. (`spec/05-tools.md` §5.)"
  - WHY: the paragraph still says "Pass the `markerId` you received in `details`" — the pre-M1 id-only path.
    Change (1) is the target param; the when-to-use prose must reflect it. Keeps the safety-valve framing and
    the forward-only semantics (unchanged).
  - GOTCHA: anchor on the FULL paragraph (GOTCHA #2) — "**When to use it:**" alone is not unique.

Task 3: EDIT README.md §4 — add the mulligan_shrink "Operator echo" note (blockquote UNCHANGED)
  - FIND (the shrink "When to use it" line — unique; starts "rewind = the call was a *mistake*"):
      "**When to use it (vs `mulligan_rewind`):** rewind = the call was a *mistake* — it is gone, replaced by a fresh attempt; shrink = the call was *fine* but its *output* is bloated — the call stays, and its result is swapped for your summary."
  - REPLACE (same line + a new "**Operator echo**" paragraph appended):
      "**When to use it (vs `mulligan_rewind`):** rewind = the call was a *mistake* — it is gone, replaced by a fresh attempt; shrink = the call was *fine* but its *output* is bloated — the call stays, and its result is swapped for your summary.\n\n**Operator echo (zero context cost).** The tool result stays terse (\"Matched: yes/no\") and does **not** echo the replacement — echoing it would place a second copy in context, defeating the tool's purpose. Instead the replacement is surfaced to the *operator* via a UI toast (`ctx.ui.notify`), capped at `shrink.notifyMaxChars` (default 2048) chars for ergonomics — the model never sees it. (`spec/05-tools.md` §2.)"
  - WHY: Change (2). SHRINK_DESC is UNCHANGED so the blockquote (line ~155) is NOT touched (GOTCHA #5); the
    echo behavior is documented in the README's own prose. The note matches shrink.ts lines 320–326 (ctx.ui.notify
    + notifyMaxChars cap) and 145–147 (terse feedbackText).
  - DO NOT: edit the shrink blockquote or the "Target matchers" / "replacement must be faithful" lines below.

Task 4: EDIT README.md §4 — add the mulligan_checkpoint auto-expiry note (blockquote UNCHANGED)
  - FIND (the checkpoint "When to use it" line — unique; starts "before a speculative sub-task"):
      "**When to use it:** before a speculative sub-task you might want to discard wholesale — set a checkpoint, and a later `mulligan_rewind(granularity:\"checkpoint\", checkpoint:\"<name>\")` returns to it in one shot."
  - REPLACE (same sentence + auto-expiry clause + spec pointer):
      "**When to use it:** before a speculative sub-task you might want to discard wholesale — set a checkpoint, and a later `mulligan_rewind(granularity:\"checkpoint\", checkpoint:\"<name>\")` returns to it in one shot. A checkpoint **auto-expires** once a rewind targets it: its label is cleared so it no longer lingers in the active-marker list (`mulligan_audit`); re-creating a checkpoint of the same name later is allowed. (`spec/05-tools.md` §3.)"
  - WHY: Change (3). CKPT_DESC is UNCHANGED so the blockquote (line ~169) is NOT touched (GOTCHA #6); the
    auto-expiry (rewind.ts step (7b), lines 558–577) is documented in the README's own prose.
  - DO NOT: edit the checkpoint blockquote or the "name must match /^[a-z0-9_-]{1,40}$/" line below.

Task 5: EDIT README.md §5 — bloat reminder (shorter text + thresholds reconciled to §3)
  - FIND (line ~222 — unique; the numbered item "1."):
      "1. **Bloated-result reminder** — a `tool_result` hook appends a short reminder to any result exceeding the per-tool bloat threshold (`bash`: 32 KB, `read`: 20 KB, others: the 16 KB global default)."
  - REPLACE (single-line reminder; thresholds match §3; spec pointer):
      "1. **Bloated-result reminder** (`spec/07-preventive-and-nudges.md` §1) — a `tool_result` hook appends a single-line reminder to any result exceeding the per-tool bloat threshold (`bash` and unlisted tools: the 16 KB global default; `read`: 24 KB). The reminder is appended, not replacing (the agent may still need the data) and costs ~30 tokens, once, only when the threshold is crossed."
  - WHY: Change (4a). The new renderBloatReminder (notes.ts 274–276) is a single line after a `\\n---\\n`
    separator. The stale thresholds (`bash: 32 KB, read: 20 KB`) contradict §3 (read = 24 KB via
    bloatThresholdBytesByTool; bash unlisted → 16 KB global) — GOTCHA #3. Fixing them is part of making the
    nudge description accurate and internally consistent.
  - DO NOT: change the "2." / "3." items in this edit (Tasks 6 / leave-high-water-alone).

Task 6: EDIT README.md §5 — drift nudge (shipped text + delta-only / no-re-announce-bloat)
  - FIND (line ~223 — unique; the numbered item "2."):
      "2. **Per-turn drift nudge** — at `turn_end` Mulligan records the token delta; on the *next* inference it injects a one-line annotation (e.g. `[mulligan: last turn +4.2k tokens; rewind available]`). The delta is **windowed** (`spec/07-preventive-and-nudges.md` §5.1): smoothed over a rolling window of the last `nudges.driftWindowTurns` turns (default 3) before the threshold, so a single heavy turn (reading several source files, a pasted reference doc) does **not** fire it, but *sustained* growth across consecutive turns does. The `mulligan:nudge` annotation is **never persisted**."
  - REPLACE (shipped example text; delta-only firing; no-re-announce-bloat; spec pointer):
      "2. **Per-turn drift nudge** (`spec/07-preventive-and-nudges.md` §2/§5) — at `turn_end` Mulligan records the token delta; on the *next* inference it injects a single-line annotation (e.g. `Previous turn added ~4.2k tokens to your context. If that growth was wasteful, call mulligan_rewind or mulligan_shrink; run mulligan_audit for a breakdown.`). The delta is **windowed** (§5.1): smoothed over a rolling window of the last `nudges.driftWindowTurns` turns (default 3) before the threshold, so a single heavy turn (reading several source files, a pasted reference doc) does **not** fire it, but *sustained* growth across consecutive turns does. The nudge fires on **delta-only**: a single big result is already covered by Nudge A above, so the cross-turn nudge no longer re-announces bloat the agent already addressed — it stays quiet unless there is no baseline yet (first turn / post-reload). The `mulligan:nudge` annotation is **never persisted**."
  - WHY: Change (4b). The example text was invented (GOTCHA #4); the shipped renderDriftNudge (notes.ts 311–322)
    is a single line with no `[mulligan]` prefix and no bloat clause on the delta path (§5.3 — bloat only as the
    no-baseline fallback). Documents the simplification the work item calls out.
  - DO NOT: touch the "3. High-water signal" item below it.
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN: README §4 blockquote == shipped desc string (verbatim). Verify against src/tools/*.ts before
     editing any blockquote. Only CANCEL_DESC changed (M1) → only the cancel blockquote is replaced.
     SHRINK_DESC + CKPT_DESC are byte-identical to their current blockquotes → leave them; document the new
     behavior in the README's own "When to use it" prose instead. -->

<!-- PATTERN: README §5 prose is the README's own description (not verbatim) — edit freely, but keep numbers
     consistent with the §3 config table (the documented source of truth). The bloat-reminder thresholds are
     the one place §5 carried stale numbers; fixing them is a consistency fix on the same line being edited. -->

<!-- PATTERN: spec cross-refs use `spec/NN-name.md` (the README convention), not the spec's internal `@NN`.
     Every new note ends with a `(spec/NN-name.md §X.)` pointer (cancel→§5, shrink→§2, checkpoint→§3,
     bloat→spec/07 §1, drift→spec/07 §2/§5). -->

<!-- The six edits are INDEPENDENT (no ordering dependency) but MUST all land: the four §4 edits together
     make §4 whole; the two §5 edits together make §5 whole + self-consistent with §3. Apply all six in one
     pass. None overlap with sibling S1's §3 edits. -->
```

### Integration Points

```yaml
CODE:        none — no source files touched.
TESTS:       none — no tests touch README; `npx vitest run` / `tsc` are unaffected and irrelevant as gates.
SPEC:        none — spec/05, spec/07 are READ-ONLY (already specify the behaviors); cited only.
CONFIG/DB:   none.
REGISTRATION: none.
DOCS:
  - modify: README.md §4 (Tools: cancel blockquote + when-to-use; shrink echo note; checkpoint expiry note)
            and §5 (How It Works: bloat reminder + drift nudge).
  - NOT modified: README §3 (config table + JSON example — sibling P1.M5.T1.S1); §1/§2/§6/§7/§8.
  - this IS the Mode B changeset-level doc sync for the four behavior changes' prose — no other doc file is
    in scope.
```

## Validation Loop

> This is a documentation-only change. There is **no** `tsc`/`vitest` gate that exercises README (no markdown
> linter is configured). Validation is **grep + cross-check** (same approach as sibling S1). Each level below
> is a concrete, runnable command with its expected output.

### Level 1: Edit landing (grep — proves the six edits applied, no stale orphans)

```bash
# Task 1 landed: cancel blockquote now mentions target (verbatim CANCEL_DESC).
grep -n "Identify the marker by \`target\` (same hint shape as mulligan_shrink" README.md   # expect 1 hit (§4 cancel blockquote)
grep -n "Pass the markerId you received in details when you issued the marker" README.md     # expect NO output (old blockquote gone)

# Task 2 landed: cancel when-to-use is target-first; old markerId-only phrasing gone.
grep -n "the most recent marker covering that content is retired" README.md                  # expect 1 hit (§4 cancel when-to-use)
grep -n "Pass the \`markerId\` you received in \`details\` when you issued the marker" README.md  # expect NO output (old phrasing gone)

# Task 3 landed: shrink echo note present; shrink blockquote UNCHANGED.
grep -n "Operator echo (zero context cost)" README.md                                        # expect 1 hit (§4 shrink prose)
grep -n "Replace a specific past tool result with a compact summary" README.md               # expect 1 hit (shrink blockquote, byte-identical)

# Task 4 landed: checkpoint auto-expiry note present; checkpoint blockquote UNCHANGED.
grep -n "A checkpoint \*\*auto-expires\*\* once a rewind targets it" README.md               # expect 1 hit (§4 checkpoint prose)
grep -n "Name the current position so a later mulligan_rewind can jump straight back" README.md  # expect 1 hit (checkpoint blockquote, byte-identical)

# Task 5 landed: §5 bloat reminder uses §3 thresholds; stale numbers gone.
grep -n "the 16 KB global default; \`read\`: 24 KB" README.md                                 # expect 1 hit (§5 bloat line)
grep -n "\`bash\`: 32 KB" README.md                                                          # expect NO output (stale)
grep -n "\`read\`: 20 KB" README.md                                                          # expect NO output (stale)

# Task 6 landed: §5 drift nudge uses shipped text; invented example gone.
grep -n "Previous turn added ~4.2k tokens to your context" README.md                         # expect 1 hit (§5 drift example)
grep -n "no longer re-announces bloat the agent already addressed" README.md                 # expect 1 hit (§5 drift behavior)
grep -n "\[mulligan: last turn +4.2k tokens; rewind available\]" README.md                   # expect NO output (invented example gone)
```
Expected: every "expect" above holds. Any mismatch ⇒ an edit was missed or mis-targeted.

### Level 2: Source-of-truth cross-check (proves the documented behavior matches the shipped code)

```bash
# Cancel blockquote == verbatim CANCEL_DESC (the §4 "verbatim copies" invariant).
grep -c "Identify the marker by \`target\` (same hint shape as mulligan_shrink" src/tools/cancel.ts README.md
#   expect: src/tools/cancel.ts:1   README.md:1   (the phrase appears once in each, verbatim)

# Shrink echo: README note matches shrink.ts ctx.ui.notify + notifyMaxChars cap.
grep -n "ctx.ui.notify" src/tools/shrink.ts                       # expect 1 hit (line ~326)
grep -n "notifyMaxChars" src/tools/shrink.ts                      # expect 1 hit (line ~325)
grep -n "shrink.notifyMaxChars" README.md                         # expect 2 hits: §3 config row + §4 echo note

# Checkpoint expiry: README note matches rewind.ts step (7b).
grep -n "checkpoint consumption\|consumed by the rewind\|granularity === \"checkpoint\"" src/tools/rewind.ts  # expect hits at step (7b)
grep -n "auto-expires" README.md                                  # expect 1 hit (§4 checkpoint note)

# Nudge text: README §5 describes the shipped renderBloatReminder / renderDriftNudge.
grep -n "This result added" src/notes.ts                          # expect 1 hit (renderBloatReminder, line ~276)
grep -n "If that growth was wasteful" src/notes.ts                # expect 1 hit (renderDriftNudge, line ~322)
```
Expected: all hits present. The README phrases derive directly from these source lines.

### Level 3: §4 "verbatim copies" invariant + §3↔§5 threshold reconciliation

```bash
# The §4 cancel blockquote is byte-identical to CANCEL_DESC (copy the desc string from src/tools/cancel.ts
# and confirm it appears verbatim under the §4 mulligan_cancel heading). Manual eyeball + the Level-1 grep
# (the "Identify the marker by `target`..." phrase) together prove it.

# §3↔§5 threshold agreement: §3 table and §5 bloat line now state the SAME thresholds.
grep -n 'bloatThresholdBytesByTool.*{ "read": 24576 }' README.md  # §3 table (line ~96) — 1 hit
grep -n "the 16 KB global default; \`read\`: 24 KB" README.md     # §5 bloat line — 1 hit
# Both say: read = 24 KB (24576); bash/unlisted = 16 KB global. No contradiction.

# §3 left untouched (sibling S1's scope) — the config-table row count + caption are S1's concern, not ours,
# but confirm we did not accidentally edit §3:
git diff --stat README.md    # expect ONLY §4 + §5 hunks (lines ~150–225 region); no §3 (lines ~75–120) hunk
```
Expected: §3↔§5 thresholds agree; the diff touches only §4 + §5.

### Level 4: Render sanity (proves the markdown still parses cleanly)

```bash
# §4 still has exactly five ### tool headings; §5 numbered list still 1./2./3.
grep -cE '^### `mulligan_' README.md            # expect 5 (rewind, shrink, checkpoint, audit, cancel)
grep -nE '^[0-9]+\. \*\*' README.md | sed -n '/How It Works/,/^---/p'  # eyeball: the §5 nudge list is still 1./2./3.

# The §4 shrink + checkpoint sections still each have their blockquote (>) + When-to-use line intact.
sed -n '/### `mulligan_shrink`/,/### `mulligan_checkpoint`/p' README.md | grep -c '^> '   # expect 1 (shrink blockquote)
sed -n '/### `mulligan_checkpoint`/,/### `mulligan_audit`/p' README.md | grep -c '^> '    # expect 1 (checkpoint blockquote)
```
Expected: 5 tool headings; §5 list intact; shrink + checkpoint blockquotes each still present (we appended
prose, did not remove the blockquotes). A human eyeball of the rendered §4 + §5 is the final check.

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 grep: cancel blockquote mentions `target`; cancel when-to-use is target-first; shrink echo note
      present; checkpoint auto-expiry note present; §5 bloat uses 16 KB global + read 24 KB; §5 drift uses
      shipped text + notes no-re-announce-bloat; all stale strings (`Pass the markerId`, `32 KB`, `20 KB`,
      `[mulligan: last turn...`) gone.
- [ ] Level 2 cross-check: README phrases match `src/tools/cancel.ts` (CANCEL_DESC), `src/tools/shrink.ts`
      (ctx.ui.notify + notifyMaxChars), `src/tools/rewind.ts` (step (7b)), `src/notes.ts` (renderBloatReminder
      + renderDriftNudge).
- [ ] Level 3: §4 cancel blockquote == verbatim CANCEL_DESC; §3↔§5 thresholds agree; diff touches only §4 + §5.
- [ ] Level 4: 5 tool headings; §5 list 1./2./3.; shrink + checkpoint blockquotes intact.

### Feature Validation
- [ ] Change (1): §4 cancel blockquote + when-to-use describe the `target` hint (preferred) + `markerId`
      fallback (most-recent covering marker retired, LIFO). spec/05 §5 cited.
- [ ] Change (2): §4 shrink prose notes the operator echo via `ctx.ui.notify`, capped by
      `shrink.notifyMaxChars` (2048), result stays terse, zero context cost. spec/05 §2 cited.
- [ ] Change (3): §4 checkpoint prose notes auto-expiry-on-consumption (label cleared, no longer in
      active-marker list; re-creating later allowed). spec/05 §3 cited.
- [ ] Change (4): §5 bloat reminder is a single-line reminder with §3-matching thresholds; §5 drift nudge
      uses the shipped text and documents delta-only / no-re-announce-bloat. spec/07 §1/§2/§5 cited.
- [ ] §4 "verbatim copies" invariant holds: cancel blockquote == CANCEL_DESC; shrink + checkpoint blockquotes
      unchanged (== their unchanged desc strings).

### Code Quality / Scope Discipline
- [ ] ONLY `README.md` modified — no `src/`, `test/`, `spec/`, or other files touched.
- [ ] Only §4 + §5 edited; §3 (config table + JSON) left to sibling P1.M5.T1.S1 — GOTCHA #7.
- [ ] Shrink + checkpoint blockquotes NOT touched (desc strings unchanged) — GOTCHA #5 / #6.
- [ ] Cancel blockquote replaced with VERBATIM CANCEL_DESC (not reworded) — GOTCHA #1.
- [ ] §5 thresholds reconciled to §3 (bash+unlisted=16 KB; read=24 KB) — GOTCHA #3.
- [ ] §5 drift example uses the shipped text (no `[mulligan]` prefix) — GOTCHA #4.
- [ ] spec cross-refs use `spec/NN-name.md` form (not `@NN`) — GOTCHA #9.

### Documentation
- [ ] Each new note is one tight sentence/clause with a spec pointer (spec/05 or spec/07) — "these are
      refinements, not new features."
- [ ] No new env vars, no code, no behavior change — README is the entire deliverable.

---

## Anti-Patterns to Avoid

- ❌ Don't edit the shrink or checkpoint §4 blockquotes — their desc strings (`SHRINK_DESC`, `CKPT_DESC`) are
  unchanged, so the "verbatim copies" rule means they must stay byte-identical. Document the new behavior in
  the README's own "When to use it" prose instead.
- ❌ Don't reword CANCEL_DESC when replacing the cancel blockquote — copy it VERBATIM from
  `src/tools/cancel.ts`. The §4 invariant is "verbatim copies," not "close paraphrase."
- ❌ Don't use "**When to use it:**" alone as a FIND anchor — it appears in 4 tool sections. Always anchor on
  the full unique paragraph (GOTCHA #2).
- ❌ Don't leave the §5 stale thresholds (`bash: 32 KB, read: 20 KB`) — they contradict the §3 config table
  two sections away. Since you're rewriting that line for Change (4), fix them to match §3.
- ❌ Don't keep the invented `[mulligan: last turn +4.2k tokens; rewind available]` drift example — the code
  emits a prefix-less single line. Use the shipped text.
- ❌ Don't touch §3 (config table / JSON example) — that's sibling P1.M5.T1.S1's scope and may be landing in
  parallel.
- ❌ Don't over-expand the blurbs into multi-paragraph essays — the work item says "one sentence each with a
  spec pointer … keep it tight, these are refinements, not new features." Each note is one sentence/clause.
- ❌ Don't run `npx vitest run` / `tsc` as a gate for *this* change — no code changed; they're irrelevant. The
  gates are the grep + cross-check commands in the Validation Loop.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a six-edit markdown sync against four already-shipped,
already-specified behavior changes, with verbatim FIND/REPLACE for every site, exact line numbers, the
verbatim source-of-truth strings (CANCEL_DESC copied verbatim; SHRINK_DESC/CKPT_DESC confirmed unchanged so
their blockquotes are left alone; renderBloatReminder/renderDriftNudge and the rewind (7b) step quoted), and a
grep-based validation loop that catches every stale-string orphan. The non-obvious risks are all surfaced:
(1) the §4 "verbatim copies" rule and which blockquotes to touch (GOTCHA #1/#5/#6), (2) the non-unique
"**When to use it:**" anchor (GOTCHA #2), (3) the §3↔§5 threshold contradiction (GOTCHA #3), (4) the invented
drift example text (GOTCHA #4), and (5) the non-overlap with sibling S1's §3 edits (GOTCHA #7). All are caught
by the Level 1 grep gates. Residual risk: an em-dash/Unicode mismatch in a FIND string — mitigated by every
FIND being quoted verbatim from the current README and asserted unique via the grep gates. No dependency on
the parallel item P1.M5.T1.S1 beyond not editing §3 (text-disjoint).