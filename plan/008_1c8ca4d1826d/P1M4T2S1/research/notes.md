# Research notes — P1.M4.T2.S1 (README.md v2.0 sync)

## Verified final strings (sources of truth in src/)

### SHRINK_DESC (src/tools/shrink.ts:119, v2.0)
"Replace the current turn's tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Only results from THIS turn can be shrunk — a target from an earlier turn is refused outright. Unlike rewind, the call stays in context (just with your summary as its result)."

### Hard-refusal sentence (src/tools/shrink.ts:368, exact)
"Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk."
(Earlier-turn, no-in-turn-match, and structurally-invalid selectors all share this ONE string.)

### Drift-nudge v2.0 tail (src/notes.ts:340, exact)
`<lead>. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
Lead forms (unchanged by v2.0): "Previous turn added ~<k> tokens to your context" (+ optional " (sustained over the last N turns)"), bloat-fallback "Previous turn produced <N> bloated result(s)", totality fallback "Previous turn changed your context". Awareness-only: no rewind/shrink prescription. Nudge A (renderBloatReminder, notes.ts:278) is the only prescribing nudge — unchanged.

### CANCEL_DESC two-arm (src/tools/cancel.ts:137)
"(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence)" — content arm dropped.

## README.md hit map (line numbers as of HEAD; verify with grep at edit time)
- ~:157 shrink blurb — says "past tool result"; rewrite to current-turn + hard-refusal sentence (per SHRINK_DESC wording).
- ~:169 target matcher list — three bullets incl. `by_content_includes` "(any role)"; reduce to two arms with CURRENT-TURN descriptions (see ShrinkParams descriptions in shrink.ts:67ff: by_tool_call_id "must be a call from the CURRENT turn"; by_tool_name "matches only results from the CURRENT turn", occurrence "first/last matching result within the current turn").
- ~:173 E19 trust note — "even summarizing a user message (E19) is lossless" → E19 MOOT under v2.0 (a non-toolResult / past-turn shrink is no longer expressible). KEEP the view-substitution framing (original on disk, recoverable via /tree); DROP user-message-shrink framing.
- ~:187-189 cancel sections — two retract-hint-shape mentions of `by_content_includes` → two arms.
- ~:234 drift paragraph — quotes OLD tail "If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result." → quote v2.0 tail + add awareness-only note (Nudge A is the prescribing one).
- ~:266 BUG-004 (v1.0 round) — "`mulligan_shrink` `by_content_includes` with an empty substring now matches nothing (returns null)" → mark historical (v1.x); the arm is removed in v2.0. Keep the entry as audit history; prefix with "(v1.x — the `by_content_includes` arm was removed in v2.0)" style wording.
- Sanity sweep: grep for "any role", "three", other three-arm/past-turn language across the tool tables/features sections (no other hits found in scout: only :169 says "any role").

## Scope boundary
- VERIFICATION.md BUG-004 row (:209) is P1.M4.T2.S2's territory (stale-reference sweep) — do NOT touch here.
- Only README.md changes. No src/, test/, spec/ edits.

## Gotchas
- README is long-form prose mirroring spec; keep section anchors ([Human commands (v1.1)](#human-commands-v11)) intact.
- The matcher list intro "resolved live each turn, robust to compaction" stays true for both arms — keep it.
- Cancel paragraph at :189 mentions "resolved live each turn" for hints — under v2.0 hint resolution stays FULL-HISTORY (only covering-marker check is span-bound), so hint wording stays; just drop the content arm from the hint-shape enumeration.