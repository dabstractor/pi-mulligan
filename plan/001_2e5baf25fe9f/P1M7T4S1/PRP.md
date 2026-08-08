# PRP — P1.M7.T4.S1: Create README.md with install, config, tools, and guarantees

**Work item:** P1.M7.T4.S1 · **Points:** 1 · **Stage:** Integration, Hardening & Documentation (spec/11-build-order.md
§3 item 6 "definition of done" + §2 Step 9; Mode B documentation task).
**Scope:** CREATE **`README.md`** at the **project root** — the single human-facing summary of the entire
pi-mulligan v1.0 changeset. Comprehensive but concise. **No code changes.** This is a documentation-only task.

> **THIS IS THE V1.0 RELEASE README.** Every module is Complete (foundation → pure core → Pi integration →
> tools → nudges → factory wiring → smoke harness). The README is the last piece a new user / contributor reads:
> it must let someone install pi-mulligan, understand the four tools + configuration, trust the soft-delete +
> fail-open + zero-config guarantees, and know the four known limitations — **without** opening the spec. The spec
> (spec/01-12) remains the deep-detail reference; the README is the curated entry point.

---

## Goal

**Feature Goal**: Ship `README.md` at the repo root that documents, in this order: (1) Overview — what pi-mulligan
is, the mulligan metaphor, why agents need it; (2) Installation — the 3 ways to load it + zero-config smoke;
(3) Configuration — the full `mulligan` settings table with defaults + the "works with zero configuration" note;
(4) Tools — the four tools with their verbatim LLM-facing descriptions + when-to-use guidance; (5) How It Works —
the soft-delete mechanism + context-event filter + `/tree` audit trail; (6) Guarantees — soft-delete, fail-open,
zero-config; (7) Known Limitations — compaction leak, no undo, no hard retry, markers accumulate; (8) License — MIT.

**Deliverable**: ONE file — `README.md` at the pi-mulligan repo root (sibling of `package.json`/`spec/`/`src/`).
Markdown. Comprehensive but concise (~250–400 lines; every claim traceable to a `src/` or `spec/` source; no
content copied wholesale from the spec — the README curates + summarizes, it does not reproduce the spec).

**Success Definition** (all must hold):
- `README.md` exists at repo root; `ls README.md` succeeds.
- The four tool descriptions in the README are **byte-for-byte** the verbatim `REWIND_DESC`/`SHRINK_DESC`/
  `CHECKPOINT_DESC`/`AUDIT_DESC` strings from `src/tools/*.ts` (the implementer copies them, not paraphrases).
- The configuration table lists ALL 12 knobs from `src/config.ts` `DEFAULT_CONFIG` with their EXACT default
  values + a one-line rationale each (sourced from spec/09 §3).
- The four known limitations are present and each names its spec anchor (E7 compaction leak, D6 no undo,
  D1 no hard retry, E15 markers accumulate) with an accurate one-paragraph explanation.
- The zero-config smoke `pi -e ./src/index.ts` (with NO `mulligan` settings) loads without error — this is the
  def-of-done #6 / Step 9 acceptance check; the README's Installation section documents it.
- README is internally consistent: the "Guarantees" section, the "Disabling" note, and the `enabled` config row
  all agree on the post-E14 final behavior (master switch → whole extension no-op).

---

## User Persona

**Target User**: (a) **A human operator installing pi-mulligan** — wants to load the extension, know the knobs,
and trust it won't break their agent runs. (b) **A contributor / future maintainer** — wants a map of what the
extension does + where the deep detail lives (spec links). (The *agent itself* is a Mulligan user, but the agent
reads the tool *descriptions* at runtime, not the README — the README's "Tools" section is for the human who wants
to understand what the agent can now do.)

**Use Case**: A user runs `pi -e ./src/index.ts`, sees the extension loaded, and opens the README to learn: how to
make it permanent (auto-discovery), what the four new tools their agent now has do, whether they need to configure
anything (no), and what the guard-rails are (soft-delete, fail-open).

**Pain Points Addressed**: pi-mulligan has no README (confirmed: `ls README.md` → not found). The spec is 12
files — too deep for a first read. The agent tool descriptions are LLM-facing + terse; a human needs the when/why
framing. The configuration surface has 12 knobs; a table with defaults + rationale is the only way to grasp it.
The four guarantees + four limitations are the trust + expectation-setting the README must deliver.

---

## Why

- **spec/11 §3 "definition of done" item 6** is the explicit requirement: "README documents install, the four
  tools, configuration, and the 'soft-delete / visible-in-/tree' guarantee." This task delivers exactly that.
- **spec/11 §2 Step 9 (Polish)**: "README (install, configure, usage). Confirm `pi -e ./src/index.ts` with no
  mulligan config works out of the box (all defaults)." The zero-config smoke is a README acceptance test.
- **Mode B (changeset-level documentation).** This IS the documentation artifact for the v1.0 changeset. Every
  prior work item built code + per-item docs; this item produces the single top-level doc that ties the whole
  changeset together for release.
- **Trust + discoverability.** pi-mulligan's value props are non-obvious (soft-delete, zero extra requests,
  fail-open). Without a README, a reviewer/user has to read spec/01-12 to trust it. The README is the curated
  trust surface.

---

## What

A single `README.md` at repo root with these sections, in this order. **Every content fact the implementer needs
is in `research/readme-facts.md`** (verified against live code + spec); the section list below names the source
for each. The README must be **comprehensive but concise** — summarize, do not reproduce the spec.

### Section 1 — Overview
- **What it is** (1 short para): a Pi extension giving a coding agent autonomous, token-cheap control over its own
  context window — shed context produced by mistake + redo a turn with a self-authored note, no human in the loop.
  Source: `spec/SPEC.md` §1 (h2.1 selected-PRD content) + `research/readme-facts.md` §1.
- **The mulligan metaphor** (1 sentence, VERBATIM from SPEC.md): "a *mulligan* is a courtesy do-over in golf — a
  second shot after a bad one, without penalty."
- **Why agents need it** (3-4 bullets): unbounded output capture (a `grep -r` over a monorepo = ~10k tokens that
  persists every turn); wrong-direction work (sunk cost that taxes every future inference); silent accumulation
  (no built-in signal that a turn drifted toward auto-compaction). Why Pi's built-ins don't solve it: compaction
  summarizes the *head*/keeps the *tail* (wrong direction); `/tree`/`/compact`/`/fork` are human-driven (an agent
  tool can't reach them — proven in spec/02). Source: `spec/SPEC.md` §2.1-§2.2.

### Section 2 — Installation
- **Three ways to load** (verified in `research/readme-facts.md` §4, source pi `docs/extensions.md`):
  1. **Quick test:** `pi -e ./src/index.ts` (the `-e`/`--extension` flag).
  2. **Auto-discovery (recommended; supports `/reload`):** place the extension under `.pi/extensions/*.ts`
     (project-local, loads after project trust) or `~/.pi/agent/extensions/*.ts` (global). For this repo:
     symlink/copy so `src/index.ts` is discoverable, OR just keep using `pi -e`.
  3. **As a distributed pi package:** `pi install` (npm/git) per pi's `docs/packages.md`.
- **npm for editor types:** `npm install` in the extension dir resolves `node_modules/` for local IntelliSense
  (the runtime deps `@earendil-works/pi-coding-agent` + `typebox` are declared in `package.json`; at runtime pi
  resolves them from its own install — spec/11 §1.1 note). **Not required to run.**
- **Zero-config note (prominent):** works out of the box with all defaults — no `mulligan` settings needed. The
  acceptance check: `pi -e ./src/index.ts` with NO `mulligan` config loads without error (spec/11 §2 Step 9).
- **Requirements:** Pi `0.84.x` (target; from SPEC.md header). Node ESM (`"type":"module"`).

### Section 3 — Configuration
- **Where read:** the `mulligan` object in Pi `settings.json` — global `~/.pi/agent/settings.json` and/or
  project-local `.pi/settings.json` (project-local wins). Loaded lazily, cached for the session, re-read on
  `/reload`. Source: `spec/09-configuration.md` §1.
- **"Zero configuration" note (prominent, repeat):** every option has a safe default; unknown keys ignored;
  type-mismatched values fall back to the default with a warn; validation NEVER throws. The extension works with
  an empty/absent `mulligan` block.
- **The defaults table** — ALL 12 knobs, exact default + one-line rationale (sourced from
  `research/readme-facts.md` §3, which is verified from `src/config.ts` `DEFAULT_CONFIG` + spec/09 §3). Render as
  a markdown table grouped by section (master / rewind / shrink / nudges / audit / log).
- **A minimal example `settings.json` snippet** showing a commented-out `mulligan` block (so users see the shape
  + know they can omit it entirely). Source: spec/09 §2 (the jsonc block).
- **Disabling note:** `enabled: false` makes the entire extension a no-op (no context transform; nudges pass
  through; tools refuse "Mulligan is disabled"). The human can disable without uninstalling.

### Section 4 — Tools
- **One subsection per tool** (`mulligan_rewind`, `mulligan_shrink`, `mulligan_checkpoint`, `mulligan_audit`),
  each with: (a) the tool's **verbatim LLM-facing description** copied from `src/tools/*.ts`
  (`research/readme-facts.md` §2 — copy byte-for-byte, do NOT paraphrase — these strings ARE the agent's
  documentation); (b) **when to use it** (2-4 bullets, human framing — source spec/05 §1-§5).
- **Rewind granularities table:** `last_tool_call_group` (surgical — the assistant turn that issued tool calls +
  their results), `last_turn` (everything after the last user message), `checkpoint` (back to a named checkpoint).
  Mention the optional `to_previous_prompt` (last_turn only — nuclear: also discards the latest user message).
  Source: spec/05 §1.
- **Rewind vs shrink decision framing** (1-2 sentences): rewind = the call was a *mistake* (gone + replaced by a
  fresh attempt); shrink = the call was *fine* but its *output* is bloated (call stays, output swapped for your
  summary). Source: spec/05 §2 "When to use it (vs mulligan_rewind)".
- **The four-field note** (rewind): `what_happened` / `avoid` / `true_current_state` / `next` — all required
  non-empty (the confabulation defense; a deterministic FileLedger is auto-appended to `true_current_state`).
  Source: spec/05 §1 + `research/readme-facts.md` §2.
- **Shrink target matchers:** `by_tool_call_id`, `by_tool_name` (+`occurrence: last|first`), `by_content_includes`.
  Replacement must be non-empty + faithful (the model treats it as ground truth). Source: spec/05 §2.
- **Checkpoint:** `name` must match `/^[a-z0-9_-]{1,40}$/`. Source: spec/05 §3.
- **Audit:** `top` (default 8) — token breakdown of the **filtered** view (what the model actually sees), NOT
  Pi's `getContextUsage()`. Read-only; persists nothing. Source: spec/05 §4 + D5.

### Section 5 — How It Works
- **The core insight** (2-3 sentences): Pi's conversation is an append-only tree an agent can't structurally
  mutate from a tool, but the agent CAN drop persisted "view instructions" that the `context` event honors every
  inference. A rewind is therefore a **permanent soft-delete**: a persisted marker that hides a span from every
  future inference, while the originals remain on disk + visible in `/tree`. Source: `spec/SPEC.md` §1 + spec/02.
- **The data flow** (a small ASCII diagram, adapted from `spec/SPEC.md` §4): agent calls `mulligan_rewind` →
  `appendEntry("mulligan:rewind", {spec})` [control state, NOT in context] + `sendMessage({customType:
  "mulligan:note", …})` [IN context] → tool returns → next inference's `context` handler reads markers +
  rewrites the message copy → model auto-continues with [kept prefix] + [note] + [confirmation]. No resume code.
- **Shrink** = view substitution: `appendEntry("mulligan:shrink", {target, replacement})`; the context handler
  substitutes content in place (preserves `role`/`toolCallId`/`toolName`/`isError` so tool pairing holds).
- **Two ride-along nudges (zero extra requests):** (1) `tool_result` bloat reminder (appends a short reminder to
  a result exceeding `bloatThresholdBytes`); (2) per-turn drift nudge (at `turn_end` records the delta; on the
  NEXT inference injects `[mulligan: last turn +4.2k tokens; rewind available]`). `mulligan:nudge` is NEVER
  persisted.
- **`/tree` is the audit trail:** every rewind/shrink/checkpoint is a persisted entry; the human can inspect the
  full un-filtered history (including hidden spans) via Pi's native `/tree`. No Mulligan command duplicates it.

### Section 6 — Guarantees
Three short bullets (the trust surface — source `research/readme-facts.md` §6):
1. **Soft-delete / audit trail:** hidden content is NEVER lost — stays in the session JSONL, visible in `/tree`.
2. **Fail-open:** any internal error → a logged no-op, never a broken agent turn (every tool + handler is
   try/catch-wrapped).
3. **Zero-config + zero extra requests:** works out of the box with all defaults; the nudges ride inferences that
   were already happening.

### Section 7 — Known Limitations
Four bullets, each naming the spec anchor + an accurate one-paragraph explanation (source `research/readme-facts.md`
§7 — verified from spec/08 + spec §2.6 + spec §9 decision log):
- **Compaction leak (spec/08 E7):** auto-compaction may summarize a span that included a Mulligan-hidden message →
  a transient leak via the summary until the next compaction. v1 accepts this as bounded + transient; Mulligan
  reducing context makes compaction fire later + over less-important content. No v1 mitigation.
- **No undo (spec §9 D6):** agent-initiated rewinds/shrinks are permanent (persist across reload + `/resume`).
  No un-rewind. A human exploring hidden content uses `/tree`.
- **No hard retry / replay (spec §9 D1):** soft retry only (rewind + note + re-plan). Hidden tool calls' side
  effects PERSIST on disk; replay would compound them. The mutation warning + the note's `true_current_state` /
  FileLedger are the safeguards.
- **Markers accumulate (spec/08 E15):** v1 does NO marker GC — markers persist intentionally (the audit trail).
  `rewind.maxDepth=5` bounds simultaneous active rewind markers; the only cost is disk growth (markers aren't in
  context). The filter is cheap in practice.

### Section 8 — License
- **MIT** (from `spec/SPEC.md` header line 3). One line + a pointer to add a `LICENSE` file if the project
  convention wants one (out of scope for this task — README states the license only).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** Every content fact (the verbatim tool descriptions, the exact config defaults table,
> the install commands, the four limitations with their spec anchors, the mulligan metaphor, the MIT license) is
> captured in `research/readme-facts.md`, each with its `src/`/`spec/`/pi-docs source citation. The implementer
> reads the facts file + the 4 named spec sections, then writes markdown. No codebase reasoning required beyond
> opening the cited files to copy the verbatim strings.

### Documentation & References

```yaml
# MUST READ — the verified content facts (THIS task's research output — the README's source-of-truth)
- file: plan/001_2e5baf25fe9f/P1M7T4S1/research/readme-facts.md
  why: "Every fact the README needs: verbatim tool descriptions (§2), exact config defaults table (§3), the
        3 install mechanisms (§4), the soft-delete mechanism (§5), the 3 guarantees (§6), the 4 known limitations
        with spec anchors (§7), project identity + MIT license (§1). Copy the verbatim strings from here."
  section: "All 9 sections; especially §2 (tool descriptions — copy VERBATIM) + §3 (config table) + §7 (limitations)."

# MUST READ — the spec sections the README summarizes (open these to verify + for the detail the README points to)
- file: spec/SPEC.md
  why: "§1 (overview + mulligan metaphor), §2.1-§2.2 (the pain + why Pi's tools don't solve it), §3 (design
        principles — minimal surface / soft over hard / zero extra requests / fail open), §4 (architecture +
        the data-flow diagram to ADAPT), §9 decision log (D1 no hard retry, D6 no undo — for the limitations)."
  pattern: "ADAPT the §4 ASCII data-flow diagram into the README's How-It-Works section (condense it; do not copy verbatim)."
- file: spec/05-tools.md
  why: "The four tools' purposes + when-to-use guidance (§1-§4) + the verbatim LLM description strings (§5).
        README's Tools section is the human-facing summary of THIS."
  gotcha: "The verbatim description strings LIVE in src/tools/*.ts (rewind REWIND_DESC etc.) — copy from there
           (or from research/readme-facts.md §2), NOT by paraphrasing spec/05 §5. Byte-for-byte match required."
- file: spec/09-configuration.md
  why: "§1 (where read + zero-config), §2 (the settings jsonc block — adapt as the example snippet), §3 (the
        rationale-per-knob table — README's config table is this, condensed)."
  gotcha: "src/config.ts DEFAULT_CONFIG is the AUTHORITATIVE default values; spec/09 §3 is the rationale. Cross-
           check the README table against BOTH."
- file: spec/08-edge-cases.md
  why: "E7 (compaction leak) + E15 (markers accumulate) — the two limitation bullets sourced from spec/08."

# MUST READ — the implementation the README documents (verify the verbatim strings + config values)
- file: src/tools/rewind.ts
  section: "REWIND_DESC constant (the verbatim description) + RewindParams schema (granularity + note fields)."
  why: "Copy REWIND_DESC byte-for-byte into README's rewind subsection. Confirm the 4 note fields + 3 granularities."
- file: src/tools/shrink.ts
  section: "SHRINK_DESC + ShrinkParams (the 3 target matchers + replacement)."
- file: src/tools/checkpoint.ts
  section: "CHECKPOINT_DESC + the /^[a-z0-9_-]{1,40}$/ name rule."
- file: src/tools/audit.ts
  section: "AUDIT_DESC + the filtered-view (not getContextUsage) emphasis + top default 8."
- file: src/config.ts
  section: "DEFAULT_CONFIG constant — the AUTHORITATIVE default values for the config table."
  why: "Cross-check every default in the README table against this constant. Also: validateConfig never throws
        (the zero-config guarantee) + the enabled master switch."
- file: src/index.ts
  why: "The factory wiring — confirms what the README claims is registered (4 tools + context filter + 2 nudges +
        session lifecycle). Confirms zero-config: setConfig(undefined) → DEFAULT_CONFIG at load."

# MUST READ — the install mechanism (README's Installation section accuracy)
- docfile: (pi install) node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  why: "§Quick Start (pi -e ./src/index.ts) + §Extension Locations (the auto-discovery table: .pi/extensions/*.ts
        project-local, ~/.pi/agent/extensions/*.ts global) + the npm-install-for-types note. README's install
        section is the human summary of THIS."
  section: "Quick Start (line ~56) + Extension Locations table (line ~109)."
- docfile: (pi packages) node_modules/@earendil-works/pi-coding-agent/docs/packages.md
  why: "The `pi install` (npm/git) path for distributing pi-mulligan as a package — README mentions it, points here."

# SIBLING PRP — the parallel edge-case task (the E14 fix the README's Disabling note depends on)
- file: plan/001_2e5baf25fe9f/P1M7T3S1/PRP.md
  section: "Artifact 3 (the E14 fix: master switch gates the tools → 'Mulligan is disabled' refusal)."
  why: "README's config 'Disabling' note must reflect the POST-E14 final behavior. Verify the fix landed before
        finalizing; write the README to the intended final v1 behavior regardless."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # name: pi-mulligan, version: 0.1.0, license-in-spec: MIT, main: src/index.ts
├── tsconfig.json           # strict, include:['src','test']
├── .gitignore              # dist/, node_modules/, .env — NOT README (good)
├── README.md               # DOES NOT EXIST — THIS TASK CREATES IT.
├── spec/                   # SPEC.md + 01-12 + reference/ (the deep-detail source the README points to)
├── src/                    # THE COMPLETE EXTENSION (index.ts + config.ts + tools/ + ... — all Complete)
│   ├── index.ts            # the factory (4 tools + context filter + 2 nudges + lifecycle)
│   ├── config.ts           # MulliganConfig interface + DEFAULT_CONFIG (the config-table source of truth)
│   ├── tools/{rewind,shrink,checkpoint,audit}.ts   # the 4 verbatim *_DESC strings live here
│   └── ... (transforms/filter/nudges/markers/notes/log/runtime/tokens/ledger.ts)
├── test/                   # vitest unit tests + integration/smoke harness
└── .pi/extensions/         # EMPTY — the auto-discovery dir (README documents placing the extension here)
# VERIFIED: `ls README.md` → not found (2024 research). MIT license is in spec/SPEC.md header, NOT a LICENSE file yet.
```

### Desired Codebase tree with files to be CREATED (THIS subtask)

```bash
pi-mulligan/
└── README.md   # NEW. Project root. The v1.0 release README. Comprehensive but concise (~250-400 lines).
# (Optionally also create LICENSE if project wants the MIT text — OUT OF SCOPE here; README states the license.)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (the tool descriptions must be VERBATIM, not paraphrased) — the four *_DESC strings
#   (REWIND_DESC, SHRINK_DESC, CHECKPOINT_DESC, AUDIT_DESC) in src/tools/*.ts ARE the agent's runtime
#   documentation (the LLM reads them when deciding whether to call the tool). The README's Tools section
#   reproduces them for the HUMAN reader so they know exactly what the agent sees. Copy byte-for-byte from
#   research/readme-facts.md §2 (which copied them from src/). Do NOT "improve" or paraphrase — a mismatch
#   between README + the actual description string is a documentation bug. (After copying, run the cross-check
#   in the Validation Loop to confirm byte-equality.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (DEFAULT_CONFIG is the config-table source of truth, NOT spec/09 §2 alone) — spec/09 §2 + §3
#   are the spec's INTENT; src/config.ts DEFAULT_CONFIG is the IMPLEMENTED reality. They agree, but if they
#   ever diverge the code wins (the README documents what ships). Cross-check the README table against
#   DEFAULT_CONFIG: all 12 knobs (enabled; rewind.{enabled,protectedRoles,maxDepth,requireMutationWarning};
#   shrink.enabled; nudges.{bloatReminder,perTurnDrift,bloatThresholdBytes,driftThresholdTokens};
#   audit.estimateConfidence; log.file). Note shrink has NO autoOnBloat (reserved for future, NOT v1 — do not
#   document it as a knob).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (the README must reflect the POST-E14 final behavior) — the parallel P1.M7.T3.S1 applies the E14
#   fix: config.enabled=false now also gates the tools (refuse "Mulligan is disabled"), making the whole
#   extension a no-op. The README's config "Disabling" note + the Guarantees/Known-Limitations framing must
#   state this final behavior. BEFORE finalizing the README, run `grep -n "Mulligan is disabled" src/tools/`
#   to confirm the fix landed; if not yet landed, write the README to the INTENDED final behavior (it is
#   documented in the P1.M7T3S1 PRP Artifact 3) and add a NOTE that E14 is in-flight. Do NOT block on it.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (comprehensive but CONCISE — do not reproduce the spec) — the README is the curated entry point,
#   not an omnibus. Rule of thumb: each section is 2-6 paragraphs or one table; the full README is ~250-400
#   lines. Link to spec/NN-*.md for deep detail rather than inlining it. The one exception is the data-flow
#   ASCII diagram (spec §4) — ADAPT it (condense), do not copy the whole architecture section.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (license: MIT is in the SPEC.md header, no LICENSE file exists yet) — the README's License section
#   states "MIT" (per spec/SPEC.md header line 3). Creating a LICENSE file with the MIT text is a SEPARATE
#   concern; this task states the license in the README ONLY. Do not fabricate a copyright holder line — if
#   unsure, state "MIT — see spec/SPEC.md" or use a placeholder the human fills in. (Recommend a brief note
#   that a LICENSE file should be added, but do not create it — out of scope.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (markdown is human-facing — the validation is ACCURACY, not compile) — there is no linter/formatter
#   gate for README.md in this repo (no markdownlint/prettier config). The validation is: (a) every verbatim
#   string matches its source (byte-equality); (b) every config default matches DEFAULT_CONFIG; (c) the
#   zero-config smoke actually loads; (d) internal consistency (Disabling note ↔ enabled row ↔ Guarantees).
#   See the Validation Loop.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (the `.pi/extensions/` auto-discovery dir is EMPTY) — the README's Installation section documents
#   placing the extension in `.pi/extensions/*.ts` for auto-discovery, but that dir is currently empty (the
#   extension loads via `pi -e` during dev). The README should explain BOTH paths honestly: `pi -e` for quick
#   testing, + auto-discovery (symlink/copy src/index.ts into .pi/extensions/) for daily use + `/reload`.
#   Do not imply the extension is already auto-installed.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

None. `README.md` is a markdown document. The "model" is the section structure in the **What** section above +
the content facts in `research/readme-facts.md`. No TypeScript, no schemas.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITES + GATHER THE VERBATIM STRINGS (no edits — read only)
  - RUN: ls README.md                      # confirm it does NOT exist (this task creates it)
  - RUN: cat research/readme-facts.md      # the verified content facts (THIS task's research output)
  - RUN (verbatim sources):
      • grep -A6 "^export const REWIND_DESC" src/tools/rewind.ts
      • grep -B1 -A4 "Replace a specific past" src/tools/shrink.ts
      • grep -B1 -A4 "Name the current position" src/tools/checkpoint.ts
      • grep -B1 -A4 "Show a token breakdown" src/tools/audit.ts
      → COPY these 4 strings byte-for-byte into the README's Tools section.
  - RUN (config source of truth):
      grep -A30 "^export const DEFAULT_CONFIG" src/config.ts
      → cross-check every default in the README config table against this.
  - RUN (E14 dependency — GOTCHA #3):
      grep -n "Mulligan is disabled" src/tools/rewind.ts src/tools/shrink.ts
      → if present, the fix landed → write the Disabling note confidently; if absent, write the INTENDED
        final behavior + add a NOTE (do not block).
  - READ: spec/SPEC.md §1-§4,§9 ; spec/05 §1-§5 ; spec/09 §1-§3 ; spec/08 E7/E15 (the detail the README summarizes).

Task 1: WRITE README.md — Section by Section (the PRIMARY deliverable)
  - CREATE README.md at repo root (sibling of package.json).
  - HEADER: title "pi-mulligan" + one-line tagline (autonomous agent context self-rewind for Pi) + badges/labels
    optional (Pi 0.84.x, MIT). No version badge needed (package.json has 0.1.0).
  - §1 Overview: what it is (1 para) + the mulligan metaphor (VERBATIM sentence) + why agents need it (3 bullets)
    + why Pi's built-ins don't solve it (1-2 sentences). Sources: SPEC.md §1,§2.1-§2.2 ; readme-facts.md §1,§5.
  - §2 Installation: the 3 ways (pi -e quick-test; .pi/extensions auto-discovery; pi install package) + npm-for-types
    note + the prominent "works with zero configuration" note + the acceptance smoke (`pi -e ./src/index.ts` with no
    mulligan config loads without error). Sources: readme-facts.md §4 ; pi docs/extensions.md.
  - §3 Configuration: where-read (1 sentence) + zero-config note + the 12-knob defaults TABLE (grouped: master /
    rewind / shrink / nudges / audit / log) + a minimal example settings.json snippet (commented mulligan block,
    omitted = all defaults) + the Disabling note (POST-E14 final behavior). Sources: readme-facts.md §3 ;
    src/config.ts DEFAULT_CONFIG ; spec/09 §1-§3.
  - §4 Tools: one subsection per tool, each = (a) the VERBATIM *_DESC string + (b) when-to-use (2-4 bullets).
    Rewind subsection ALSO includes the granularities table + the optional to_previous_prompt + the 4-field note.
    Shrink subsection ALSO includes the 3 target matchers. Include the "rewind vs shrink" decision framing.
    Sources: readme-facts.md §2 ; src/tools/*.ts ; spec/05 §1-§5.
  - §5 How It Works: the core insight (append-only tree + view instructions) + the data-flow ASCII diagram (ADAPT
    from SPEC.md §4 — condense) + shrink-as-view-substitution + the two ride-along nudges + the /tree audit-trail
    point. Sources: readme-facts.md §5 ; SPEC.md §1,§4,§6 ; spec/02.
  - §6 Guarantees: 3 bullets (soft-delete/audit trail; fail-open; zero-config + zero extra requests). Sources:
    readme-facts.md §6.
  - §7 Known Limitations: 4 bullets, each = spec anchor + 1-paragraph explanation (E7 compaction leak; D6 no undo;
    D1 no hard retry; E15 markers accumulate). Sources: readme-facts.md §7.
  - §8 License: MIT (per spec/SPEC.md header). 1-2 lines. (Do NOT create a LICENSE file — out of scope; optional
    note that one should be added.)
  - (OPTIONAL, last) "Further reading" footer: a one-line pointer to spec/SPEC.md + the spec/ index for deep detail.

Task 2: CROSS-CHECK ACCURACY (the validation — no edits unless a mismatch is found)
  - VERIFY (verbatim tool descriptions): for each tool, the README string === the src/tools/*.ts *_DESC string.
    (The Validation Loop Task 2 commands do this with grep + diff.)
  - VERIFY (config table): every default in the README table === src/config.ts DEFAULT_CONFIG. (12 knobs.)
  - VERIFY (zero-config smoke): `pi -e ./src/index.ts -p "hi"` (or equivalent) loads with NO mulligan config + no
    error. (spec/11 §2 Step 9 acceptance.)
  - VERIFY (internal consistency): the Disabling note ↔ the `enabled` config row ↔ the Guarantees framing all
    agree (master switch → whole extension no-op; POST-E14).
  - FIX any mismatch by editing README.md (the facts file + src/ are the source of truth; the README is wrong if
    they disagree — UNLESS the README intentionally states the POST-E14 final behavior before the fix lands).

Task 3: FINAL CONSISTENCY PASS
  - READ README.md top-to-bottom. Check: section order matches the Goal; no broken markdown links; the 4 tool
    descriptions are verbatim; the config table is complete; the 4 limitations are present + accurate; the
    metaphor + MIT license are present; tone is "comprehensive but concise" (GOTCHA #4).
```

### Implementation Patterns & Key Details

```markdown
# The config defaults table (render as grouped markdown — values verified from src/config.ts DEFAULT_CONFIG):

| Knob | Default | What it does |
|------|---------|--------------|
| `enabled` | `true` | Master switch. `false` → the whole extension is a no-op. |
| **rewind** | | |
| `rewind.enabled` | `true` | Enable the `mulligan_rewind` tool. |
| `rewind.protectedRoles` | `["first:user", "latest:user"]` | Messages never rewound past (original task / current ask). |
| `rewind.maxDepth` | `5` | Max simultaneous active rewind markers (they're permanent). |
| `rewind.requireMutationWarning` | `true` | Append ⚠ when a hidden span wrote files / ran mutating bash. |
| **shrink** | | |
| `shrink.enabled` | `true` | Enable the `mulligan_shrink` tool. |
| **nudges** | | |
| `nudges.bloatReminder` | `true` | Annotate a `tool_result` exceeding the byte threshold. |
| `nudges.perTurnDrift` | `true` | Inject a one-line drift nudge when a turn grew past the token threshold. |
| `nudges.bloatThresholdBytes` | `8192` | In-context bytes above which the bloat reminder fires (8 KB). |
| `nudges.driftThresholdTokens` | `3000` | Per-turn token delta above which the drift nudge fires. |
| **audit** | | |
| `audit.estimateConfidence` | `"medium"` | Honesty label reported with token estimates (`low`\|`medium`\|`high`). |
| **log** | | |
| `log.file` | `null` | Off. Absolute path to an append-only JSONL debug log. |

# The data-flow diagram (ADAPT + condense from spec/SPEC.md §4 — this is the README's "How it works" skeleton):

```
agent calls mulligan_rewind(note, granularity)
   │
   ├─ appendEntry("mulligan:rewind", {spec, …})   ← control state (NOT sent to the model)
   ├─ sendMessage({ customType:"mulligan:note", content })   ← the note (IN context)
   └─ tool returns a short confirmation
        ↓  (normal agent loop continues)
next inference → context handler
   ├─ read markers from the session entries
   ├─ rewrite the message copy: hide the span / substitute the shrink
   └─ return { messages: transformed }
        ↓
model sees [kept prefix] + [your note] + [confirmation], resumes — no resume code needed
```

# The zero-config smoke (the spec/11 §2 Step 9 acceptance — put in the Installation section):
```bash
pi -e ./src/index.ts        # loads with NO mulligan config → all defaults → works out of the box
```
```

### Integration Points

```yaml
DOCUMENTATION (this task's only output):
  - README.md at repo root. The v1.0 release entry point. Summarizes spec/01-12; points to spec/ for deep detail.
  - Do NOT create LICENSE (out of scope; README states MIT per spec/SPEC.md header).
  - Do NOT modify any src/ or spec/ file (READ-ONLY — this is a documentation task).
  - Do NOT modify package.json / tsconfig.json / .gitignore.

CONFIG (the README documents, does not change):
  - The README's config table mirrors src/config.ts DEFAULT_CONFIG. If a future task changes a default, the
    README must be updated (note this coupling). The zero-config + never-throws guarantees are load-bearing claims.

PARALLEL-ITEM COUPLING (P1.M7.T3.S1 — the E14 fix):
  - README's Disabling note assumes POST-E14 final behavior (master switch gates the tools). Verify the fix
    landed before finalizing (GOTCHA #3). If P1.M7.T3.S1's E14 fix changes the refusal text, update the README
    quote to match. Do NOT block the README on it — write to the intended final v1 behavior.

NEXT TASK (P1.M7.T4.S2 — "Verify zero-config default behavior and finalize"):
  - S2 will RUN the zero-config smoke + finalize the docs. This task (S1) CREATES the README; S2 verifies it.
    So S1 must leave the README in a state S2 can verify (the zero-config claim must be testable + true).
```

---

## Validation Loop

> **This is a documentation task.** There is no `tsc`/`vitest` gate for `README.md`. Validation = ACCURACY
> (the README matches the code + spec) + the zero-config smoke actually loads. Markdown renders correctly by
> inspection. Run each level; fix any mismatch by editing README.md.

### Level 1: Markdown Sanity (Immediate)

```bash
# README exists at root + is non-trivial:
ls -la README.md && wc -l README.md          # Expected: exists; ~250-400 lines (GOTCHA #4).

# No obviously broken markdown (a quick structural check):
grep -c "^#" README.md                         # Expected: >= 8 top-level sections (the 8 in the Goal).
grep -n "^## " README.md                       # Expected: the 8 section headers (Overview/Installation/.../License).
# Render-check (if a markdown viewer is available): open README.md; confirm tables + code fences + links render.
```

### Level 2: Content Accuracy (the core gate — verify verbatim strings + config defaults)

```bash
# (a) The 4 tool descriptions in README are VERBATIM from src/tools/*.ts (GOTCHA #1). For each, extract the
#     README's quoted description + the source *_DESC string + confirm byte-equality:
node -e '
  const fs = require("fs");
  const read = (f) => fs.readFileSync(f, "utf8");
  const rm = read("README.md");
  const checks = [
    ["rewind", read("src/tools/rewind.ts").match(/REWIND_DESC\s*=\s*"([\s\S]*?)";/)?.[1]],
    ["shrink", read("src/tools/shrink.ts").match(/"Replace a specific[\s\S]*?result\)\.";?\s*\n/)?.[0]?.trim().replace(/[;"]$/,"")],
    ["checkpoint", read("src/tools/checkpoint.ts").match(/"Name the current[\s\S]*?in one shot\.";?\s*\n/)?.[0]?.trim().replace(/[;"]$/,"")],
    ["audit", read("src/tools/audit.ts").match(/"Show a token breakdown[\s\S]*?rewind or shrink\.";?\s*\n/)?.[0]?.trim().replace(/[;"]$/,"")],
  ];
  let ok = true;
  for (const [name, src] of checks) {
    if (!src) { console.log(`WARN: could not extract ${name} description from src — inspect manually`); continue; }
    const present = rm.includes(src.replace(/"\s*\+\s*"/g, "")); // join split string literals
    console.log(`${name}: ${present ? "VERBATIM PRESENT ✓" : "MISSING / PARAPHRASED ✗"}`);
    if (!present) ok = false;
  }
  process.exit(ok ? 0 : 1);
'
# Expected: all 4 → "VERBATIM PRESENT ✓". If any ✗: copy the EXACT string from src/tools/*.ts into README.

# (b) The config table has all 12 knobs + correct defaults (cross-check src/config.ts DEFAULT_CONFIG):
grep -c "first:user\|maxDepth\|8192\|3000\|estimateConfidence\|log.file" README.md   # Expected: >= 6 (the distinctive defaults appear).
# Manual: open README's config table + src/config.ts DEFAULT_CONFIG side-by-side; confirm every row matches.

# (c) The 4 known limitations are present + named:
grep -ciE "compaction|no undo|hard retry|replay|markers accumulate" README.md   # Expected: >= 4 hits.
```

### Level 3: Zero-Config Smoke (System Validation — spec/11 §2 Step 9 acceptance)

```bash
# THE acceptance check: the extension loads with NO mulligan config (all defaults). spec/11 §2 Step 9 + def-of-done #6.
# Run pi with the extension + a trivial prompt; expect NO load error + a normal response.
pi -e ./src/index.ts -p "Reply with the single word: ok" 2>&1 | head -40
# Expected: no "Error loading extension" / no stack trace; pi responds normally. If it errors, the README's
# "zero-config" claim is FALSE → that's a CODE bug (P1.M7.T3.S1 / earlier), not a README bug — file it, but
# the README must still document the INTENDED behavior (do not document a broken state).

# (E14 dependency — GOTCHA #3): confirm the master-switch final behavior the README claims:
grep -n "Mulligan is disabled" src/tools/rewind.ts src/tools/shrink.ts
# Expected: present in BOTH (the E14 fix landed). If absent: the README still states the intended behavior;
#           add a NOTE that E14 is in-flight (do not block).
```

### Level 4: Consistency & Tone

```bash
# Internal consistency: the Disabling note ↔ the enabled config row ↔ the Guarantees agree.
# (Manual read.) Confirm: "enabled:false → whole extension no-op (context pass-through + nudges no-op + tools
#  refuse 'Mulligan is disabled')" is stated consistently in the Config Disabling note + aligns with the
#  Fail-open + Zero-config guarantees.

# Tone check (GOTCHA #4): comprehensive but concise. Confirm no section reproduces a spec file wholesale.
wc -l README.md                          # Expected: ~250-400 lines (not 1000+).
grep -c "spec/" README.md                # Expected: >= 1 (the README LINKS to spec/ for deep detail rather than inlining).

# Scope check: README does NOT promise un-shipped features (autoOnBloat, hard retry, undo, marker GC).
grep -ciE "autoOnBloat|hard retry|undo|garbage collect" README.md   # Expected: 0 in the "what it does" sense
#   (these terms may appear ONLY in Known Limitations as things Mulligan does NOT do).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `ls README.md` succeeds; `wc -l` ~250-400 lines.
- [ ] 8 section headers present (`grep -n "^## " README.md`).
- [ ] (Level 2a) all 4 tool descriptions are VERBATIM from `src/tools/*.ts` (byte-equality — the node check).
- [ ] (Level 2b) config table has all 12 knobs with correct defaults (cross-checked against `DEFAULT_CONFIG`).
- [ ] (Level 3) `pi -e ./src/index.ts -p "..."` loads with NO mulligan config + no error (zero-config smoke).
- [ ] (Level 3) E14 dependency resolved: the Disabling note reflects the post-fix final behavior (or a NOTE).

### Feature Validation (spec/11 §3 def-of-done #6)
- [ ] Install is documented (the 3 load paths + npm-for-types + zero-config note).
- [ ] The four tools are documented (verbatim descriptions + when-to-use + rewind-vs-shrink framing).
- [ ] Configuration is documented (the 12-knob defaults table + the zero-config guarantee).
- [ ] The "soft-delete / visible-in-/tree" guarantee is documented (How It Works + Guarantees sections).
- [ ] (Bonus) the four known limitations + the mulligan metaphor + MIT license are present.

### Code Quality / Documentation Validation
- [ ] Every claim is traceable to a `src/` or `spec/` source (no invented facts).
- [ ] README LINKS to spec/ for deep detail rather than reproducing it (GOTCHA #4 — concise).
- [ ] Internal consistency (Disabling note ↔ enabled row ↔ Guarantees).
- [ ] No `src/` / `spec/` / `package.json` / `tsconfig.json` / `.gitignore` modified (documentation-only).
- [ ] No LICENSE file created (out of scope; README states MIT only).

---

## Anti-Patterns to Avoid

- ❌ **Don't paraphrase the tool descriptions.** Copy `REWIND_DESC`/`SHRINK_DESC`/`CHECKPOINT_DESC`/`AUDIT_DESC`
  byte-for-byte — they ARE the agent's runtime documentation; a mismatch is a doc bug (GOTCHA #1).
- ❌ **Don't reproduce the spec.** The README is the curated entry point, not an omnibus. Link to `spec/NN-*.md`
  for deep detail; condense the §4 data-flow diagram rather than copying it whole (GOTCHA #4).
- ❌ **Don't invent config knobs.** The table is the 12 knobs in `DEFAULT_CONFIG` — no `shrink.autoOnBloat`
  (reserved, NOT v1), no env overrides (v1.1 future). Cross-check against `src/config.ts` (GOTCHA #2).
- ❌ **Don't state pre-E14 behavior.** The Disabling note must say the master switch makes the WHOLE extension a
  no-op (tools refuse "Mulligan is disabled"), which is the post-E14 final behavior (GOTCHA #3).
- ❌ **Don't document un-shipped features.** No hard retry, no undo, no marker GC, no auto-shrink — these appear
  ONLY in Known Limitations as things Mulligan deliberately does NOT do.
- ❌ **Don't create a LICENSE file or modify any code/spec/config file.** This task writes README.md ONLY.
- ❌ **Don't skip the zero-config smoke.** spec/11 §2 Step 9 makes it the acceptance check — if `pi -e
  ./src/index.ts` errors with no config, the README's central claim is false (and that's a code bug to flag).