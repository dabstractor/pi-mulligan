# README Content — Verified Facts (P1.M7.T4.S1 research)

All facts below were verified against the LIVE codebase + spec on 2024 research. The README
implementer should treat these as authoritative source-of-truth for each README section, then
cross-check against the cited `src/` / `spec/` file at write time.

## 1. Project identity (from `package.json` + `spec/SPEC.md` header)
- name: `pi-mulligan`, version: `0.1.0`, license: **MIT** (SPEC.md header line 3).
- type: `module`, main: `src/index.ts`, `pi: { extensions: ["./src/index.ts"] }`.
- dependencies (declared for editor type-resolution only; pi resolves them from its own install
  at runtime — jiti-loaded): `@earendil-works/pi-coding-agent`, `typebox`.
- devDependencies: `typescript@^5`, `vitest@^1`, `@types/node@^22`.
- scripts: `test: "vitest run"`, `smoke: "node test/integration/run-smoke.mjs"`.
- **Name origin (the mulligan metaphor — SPEC.md line 5, VERBATIM):** "a *mulligan* is a courtesy
  do-over in golf — a second shot after a bad one, without penalty. That is exactly what this
  extension gives the agent."

## 2. The four tools — LLM-facing descriptions (from src/tools/*.ts, VERBATIM — copy into README)
- **`mulligan_rewind`** (`src/tools/rewind.ts` `REWIND_DESC`):
  "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction
  turn) and leave yourself a note so you can try again with a clean view. The hidden content
  disappears from your view permanently (it stays on disk for the human). Costs only a short note.
  Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to
  redo the whole turn from the user's last message."
- **`mulligan_shrink`** (`src/tools/shrink.ts`):
  "Replace a specific past tool result with a compact summary you provide, in your view, going
  forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind,
  the call stays in context (just with your summary as its result)."
- **`mulligan_checkpoint`** (`src/tools/checkpoint.ts`):
  "Name the current position so a later mulligan_rewind can jump straight back to it. Use before a
  speculative sub-task you might want to undo in one shot."
- **`mulligan_audit`** (`src/tools/audit.ts`):
  "Show a token breakdown of the context you're currently carrying (what the model actually sees),
  flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to
  rewind or shrink."

### When-to-use guidance (from spec/05 §1-§4 + §5)
- rewind: after a bloated tool result or a wrong-direction turn. Granularities:
  `last_tool_call_group` (surgical — the assistant turn + its tool results), `last_turn` (everything
  after the last user message), `checkpoint` (back to a named checkpoint, requires `checkpoint`).
  Optional `to_previous_prompt` (last_turn only) discards the latest user message too (nuclear).
- shrink: call was fine but output too big; you want a compact summary to REMAIN (vs rewind where
  it's gone). Target matchers: `by_tool_call_id`, `by_tool_name` (+`occurrence: last|first`),
  `by_content_includes`. Replacement must be non-empty + faithful (model treats it as ground truth).
- checkpoint: `name` must match `/^[a-z0-9_-]{1,40}$/`. Use before a speculative sub-task.
- audit: `top` (default 8) — token breakdown of the FILTERED view (NOT getContextUsage). Read-only,
  persists nothing. Closes the feedback loop ("that one read is 9.4k → shrink it").
- Rewind's note has 4 required non-empty fields: `what_happened`, `avoid`, `true_current_state`,
  `next` (the confabulation defense — validateNote refuses vacuous notes).

## 3. Configuration — defaults table (from `src/config.ts` `DEFAULT_CONFIG` + spec/09 §2-§3)
| Knob | Default | Why |
|---|---|---|
| `enabled` | `true` | master switch (false → entire extension is a no-op; tools refuse "Mulligan is disabled") |
| `rewind.enabled` | `true` | core feature |
| `rewind.protectedRoles` | `["first:user","latest:user"]` | never rewind past original task / current ask (v1 supports these 2 selectors) |
| `rewind.maxDepth` | `5` | max simultaneous active rewind markers (bounds accumulation; markers are permanent) |
| `rewind.requireMutationWarning` | `true` | append ⚠ warning when hidden span wrote files / ran mutating bash |
| `shrink.enabled` | `true` | core feature |
| `nudges.bloatReminder` | `true` | annotate a tool_result exceeding threshold |
| `nudges.perTurnDrift` | `true` | inject one-line context drift nudge when a turn grew past threshold |
| `nudges.bloatThresholdBytes` | `8192` | 8 KB in-context → reminder (below Pi's ~50 KB cap) |
| `nudges.driftThresholdTokens` | `3000` | turn token-delta → drift nudge |
| `audit.estimateConfidence` | `"medium"` | honesty label with token estimates (low|medium|high) |
| `log.file` | `null` | off by default; absolute path to append-only JSONL debug log |

Read from `settings.json` `mulligan` object (global `~/.pi/agent/settings.json` + project-local
`.pi/settings.json`, project wins). **Zero-config: works out of the box** — all defaults safe;
unknown keys ignored; type-mismatched values fall back to default with a warn (validateConfig NEVER
throws). Coercion rules (spec/09 §4): booleans `!!`; numbers finite + `>0` (thresholds) / `>=0`;
protectedRoles array of known selectors (unknown dropped); estimateConfidence one of low|medium|high.

## 4. Installation — verified mechanism (pi `docs/extensions.md` §Quick Start + §Extension Locations + spec/11 §1.1 note)
- **Quick test:** `pi -e ./src/index.ts` (the `--extension`/`-e` flag loads one extension).
- **Auto-discovery (recommended for daily use; supports `/reload`):** place a file in
  `.pi/extensions/*.ts` (project-local, loads after project trust), `~/.pi/agent/extensions/*.ts`
  (global), or `.pi/extensions/*/index.ts` (subdirectory form). pi-mulligan ships as a subdir
  extension — symlink or copy the repo so `src/index.ts` is discoverable, OR use `pi -e`.
- **npm for editor types / IntelliSense:** the repo already has `package.json` with the runtime
  deps declared; `npm install` in the extension dir resolves `node_modules/` for local
  type-resolution. (At runtime pi resolves `@earendil-works/pi-coding-agent` + `typebox` from its
  OWN install — extensions are jiti-loaded in pi's process; spec/11 §1.1 note.)
- **As a distributed pi package:** `pi install` (npm or git) per `docs/packages.md`.
- **Zero-config smoke (spec/11 §2 Step 9 + def-of-done #6):** `pi -e ./src/index.ts` with NO
  `mulligan` config MUST load without error (setConfig(undefined) → validated DEFAULT_CONFIG).

## 5. How it works — the soft-delete mechanism (spec §1, §4; spec/02 C1-C12)
- Pi's conversation is an **append-only tree** an agent CANNOT structurally mutate from a tool
  (C1: ReadonlySessionManager; C2: sendUserMessage bypasses command dispatch; C3: navigateTree is
  command-context-only + unreachable). But the agent CAN drop persisted "view instructions" that the
  `context` event honors every inference (C4: per-inference non-destructive; C5: takes effect next
  inference + model auto-continues).
- **Rewind = permanent soft-delete:** `pi.appendEntry("mulligan:rewind", {spec})` [control state,
  NOT in context] + `pi.sendMessage({customType:"mulligan:note", content})` [IN context]. The note
  is the most-recent context the resumed model reads. On the NEXT inference, the `context` handler
  reads markers from `getEntries()` + rewrites the message copy (hides the span). Auto-continues.
- **The view, never the disk:** originals remain on disk + are visible in `/tree` (the audit trail).
  Resolved live each turn (relative targeting, D7) — robust across compaction.
- **Shrink = view substitution:** `pi.appendEntry("mulligan:shrink", {target, replacement})`; the
  context handler substitutes content in place (preserves role/toolCallId/toolName/isError so the
  tool-pairing invariant holds). Replacement persists for the life of the marker.
- **Two ride-along nudges (zero extra requests, design principle #3):** (1) `tool_result` bloat
  reminder — appends a short reminder to a result exceeding `bloatThresholdBytes`; (2) per-turn
  drift nudge — at `turn_end` records the delta, on the NEXT inference's `context` injects a one-line
  annotation (`[mulligan: last turn +4.2k tokens; rewind available]`). `mulligan:nudge` is NEVER
  persisted (def-of-done #3).

## 6. The three guarantees (for README's "Guarantees" framing)
1. **Soft-delete / audit trail:** hidden content is NEVER lost — remains in session JSONL, visible in
   `/tree`. (spec §1, spec/02 C4; def-of-done #4, #6.)
2. **Fail-open:** any internal error → logged no-op, never a broken agent turn. Every tool +
   handler is try/catch-wrapped. (spec §3 #4; spec/08 E13; def-of-done #5.)
3. **Zero-config + zero extra requests:** works out of the box with all defaults; nudges ride
   inferences that were already happening. (spec §3 #3, §7; def-of-done #6.)

## 7. Known limitations (from spec §2.6 Non-goals + spec/08 + spec §9 decision log)
- **Compaction leak (spec/08 E7):** auto-compaction may summarize a span that included a
  Mulligan-hidden message → a transient "leak" via the summary until the next compaction. v1 accepts
  this as bounded + transient (Mulligan reduces context → compaction fires later + over less-important
  content). No v1 mitigation.
- **No undo (spec §9 D6 + §2.6):** agent-initiated rewinds/shrinks are permanent (persist across
  reload + `/resume`). There is no un-rewind. A human who wants to explore hidden content uses Pi's
  native `/tree`.
- **No hard retry / replay (spec §9 D1 + §2.6):** soft retry only (rewind + note + re-plan). Hidden
  tool calls' side effects PERSIST on disk; replay would compound them (double mkdir, duplicate
  commit). The mutation warning + the note's `true_current_state`/FileLedger are the safeguards.
- **Markers accumulate (spec/08 E15):** v1 does NO marker GC. Markers persist intentionally (the
  audit trail). `rewind.maxDepth=5` bounds simultaneous ACTIVE rewind markers; disk growth (not
  context growth — markers aren't in context) is the only cost. Filter is O(markers × messages)
  but cheap in practice (few markers; messages bounded by compaction).

## 8. README does NOT yet exist — confirmed
`ls README.md` → "No such file or directory" (2024 research). This task CREATES it at project root.
spec/11 §1 layout shows `README.md` at repo root (sibling of `package.json`/`spec/`).

## 9. Parallel-item dependency (P1.M7.T3.S1 — the E14 fix)
The README's "Disabling" note (config section) should reflect the POST-E14 final behavior:
`config.enabled=false` makes the WHOLE extension a no-op (context pass-through + nudges no-op +
tools refuse "Mulligan is disabled"). The E14 fix (master switch gates the tools) is being applied
in parallel by P1.M7.T3.S1. Write the README to the INTENDED final v1 behavior; verify the fix
landed before finalizing (the E14 PRP documents this exact text). Do NOT block README on it.