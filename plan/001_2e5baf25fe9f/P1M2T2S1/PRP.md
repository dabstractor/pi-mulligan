# PRP — P1.M2.T2.S1: `extractFileLedger` (deterministic read/modified/bash classification)

**Work item:** P1.M2.T2.S1 · **Points:** 1.5 · **Stage:** Pure Helper Library → File Ledger Extraction
**Scope:** **CREATE two new files** — `src/ledger.ts` (the `FileLedger` interface + `extractFileLedger` pure
function) and `test/ledger.test.ts` (vitest Tier‑1 unit tests). **No other file is touched.** No Pi dependency,
no imports, never throws.

---

## Goal

**Feature Goal**: Ship Mulligan's **deterministic file‑ledger extractor** — a pure, Pi‑free, import‑free,
side‑effect‑free function that scans a *span* of agent messages (by index range) and classifies the tool calls in
that span into three de‑duplicated, sorted buckets: `readFiles` (paths the agent *read*), `modifiedFiles` (paths
the agent *wrote/edited*), and `bashSideEffects` (non‑read‑only shell commands, captured verbatim). This is the
**state‑ledger primitive** that prevents the resumed agent from blindly redoing side‑effectful work after a rewind
(spec/04 §2.2, spec/08 E5).

**Deliverable** (two NEW files):
1. `src/ledger.ts` — exports:
   - `export interface FileLedger { readFiles: string[]; modifiedFiles: string[]; bashSideEffects: string[] }` (spec/04 §2.2 verbatim).
   - `export function extractFileLedger(messages: MessageLike[] | null | undefined, range: number[] | null | undefined): FileLedger`
   - `export interface MessageLike` (local structural type; real Pi `AgentMessage[]` assigns in with no cast — like `tokens.ts`'s `MessageLike`).
   - module‑local structural content types (`ToolCallContent` etc.) + module‑private defensive helpers (`isRecord`, `readOwn`, `readStringField`, `stripQuotes`) + module‑private bash‑classification helpers.
   - **ZERO imports** (`grep -cE '^import|^from' src/ledger.ts` → **0**). `Buffer`/`Math`/`RegExp` are globals/builtins (none are actually needed here — pure string work).
2. `test/ledger.test.ts` — vitest, `import { extractFileLedger, type FileLedger, type MessageLike } from "../src/ledger.js"`, mirrors `test/tokens.test.ts` conventions (no `beforeEach`, `describe`/`it`/`expect`/`expectTypeOf`).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (new module + test type‑sound under `strict`).
- `npx vitest run` is **all‑green** — the new `ledger` suite **AND** the pre‑existing `tokens`/`config`/`log`/`runtime` suites (107 → 107+N).
- `src/ledger.ts` has **zero imports**.
- `extractFileLedger` **never throws** (defensive on null/non‑array messages, null/non‑array range, out‑of‑bounds indices, non‑assistant messages, non‑array content, non‑record/non‑`toolCall` blocks, missing/​mistyped `name`/`arguments`/`path`/`command`, circular `arguments`, throwing‑Proxy blocks) — it sits on the rewind‑tool hot path (spec/05 step 5; spec/08 E13).
- The **pinned Tier‑1 test (spec/10 §1.6)** reproduces EXACTLY: `read(path="a.ts")`, `edit(path="b.ts")`, `bash(command="git commit")`, `bash(command="ls")` → `{ readFiles:["a.ts"], modifiedFiles:["b.ts"], bashSideEffects:["git commit"] }` (the `ls` is read‑only → omitted). Empty span → all three arrays empty.

---

## User Persona

**Target User**: The implementing AI agent for `tools/rewind.ts` (`mulligan_rewind`, P1.M5.T1.S1) — the SOLE consumer in v1.
The rewind tool does a **read‑only** resolution of the target span (via the same pure helpers the filter uses,
operating on a `buildContextEntries()` snapshot converted to messages — spec/05 step 5), then calls
`extractFileLedger(spanMessages, spanIndices)` to build the ledger it persists into the `RewindMarker.ledger`
(spec/04 §3) and renders into the note's `<files-read>` / `<files-modified>` / `<bash-side-effects>` blocks
(spec/04 §2.3). The ledger is explicitly **advisory / best‑effort** (spec/05 step 5: *"extract over the available
span best‑effort; the ledger is advisory"*), so extraction must degrade gracefully and never block the rewind.

**Use Case**: An agent just wasted a turn — it ran `grep -r auth .` (40k tokens) then `rm scratch.ts` then
`git commit`. It calls `mulligan_rewind(granularity:"last_turn")`. The tool resolves the span's message indices,
hands them to `extractFileLedger`, and gets back:
```ts
{ readFiles: [], modifiedFiles: ["scratch.ts"], bashSideEffects: ["git commit"] }
```
…which it renders into the note so the resumed model knows: *scratch.ts was deleted and a commit was made — those
persist on disk, do not redo them* (spec/08 E5).

**User Journey**:
1. Agent calls `mulligan_rewind(note, granularity)`.
2. Tool resolves the target span's message indices (`number[]`) via the rewind resolver (transforms.ts, P1.M3.T2 — `resolveLastToolCallGroup` returns `number[] | null`; `resolveLastTurn` returns `{ remove: number[] }`).
3. Tool calls `extractFileLedger(eventMessages, spanIndices)` → `FileLedger`.
4. Tool persists the ledger in `RewindMarker.ledger` and renders it into the `mulligan:note` via `renderNote` (P1.M2.T3.S2 — the IMMEDIATE downstream consumer of `FileLedger`).
5. Resumed model reads the note + ledger blocks → re‑plans instead of redoing side effects.

**Pain Points Addressed**: After a rewind, the abandoned span is **hidden from the model's view** — but the *file
mutations and shell side effects it performed PERSIST on disk*. Without an authoritative, deterministically‑extracted
ledger, the resumed model would blindly redo a `mkdir`, re‑apply an edit, or make a duplicate commit (spec/08 E5:
"compounding side effects"). The `FileLedger` is the spec's defense (D/D17): it tells the resumed model exactly
what was touched, *extracted from the tool calls themselves* (not a model call — deterministic, no extra request).

---

## Why

- **Unblocks `tools/rewind.ts` (P1.M5.T1.S1) AND `renderNote` (P1.M2.T3.S2).** `FileLedger` is the structured input
  `renderNote(note, ledger, granularity)` renders into the note's `<files-modified>`/`<bash-side-effects>` blocks.
  `RewindMarker.ledger` (spec/04 §3) persists it for audit/debug. Shipping the pure extractor now (foundation tier,
  alongside `tokens.ts`) lets both downstream tasks focus on glue, not classification.
- **Deterministic by mandate (spec/04 §2.2, spec/03 §2.3).** The ledger is *"Extracted from the tool calls in the
  rewound span (NOT a model call)"* and `extractFileLedger` is a named pure helper in the architecture's pure‑helper
  tier. No tokenizer, no LLM, no Pi handle — just message inspection + a shell heuristic.
- **High‑recall on side effects is the load‑bearing safety property (spec/08 E5).** A *missed* write here means the
  resumed agent blindly redoes a `mkdir`/`git commit`/`rm`. So the bash classifier uses a conservative
  **"when in doubt, include"** policy (spec/04 §2.2): any command not *provably* read‑only lands in
  `bashSideEffects`. False positives (a read‑only command flagged) are cheap noise; false negatives (a missed write)
  are the dangerous, expensive failure.
- **Foundation‑tier & import‑free (like `tokens.ts`).** `ledger.ts` adds **zero imports** and mirrors the
  `tokens.ts` defensive discipline (`isRecord`/`readOwn`/`stringLength` + never‑throws/fail‑open). It defines its OWN
  local structural `MessageLike`/`ToolCallContent` types — it does **NOT** import `tokens.ts` (both are foundation‑tier
  "consumer of NO other module"; spec/11 §1 lists them as sibling pure helpers).

---

## What

CREATE `src/ledger.ts` exporting `FileLedger`, `extractFileLedger`, and `MessageLike`. The function:

- **Iterates `range` (a `number[]` of message indices)** — NOT `[start,end)`. Each index selects `messages[i]`.
  Out‑of‑bounds / non‑number indices are skipped defensively. The range comes from the rewind resolver
  (`resolveLastToolCallGroup` → `number[] | null`; the tool passes `[]` when null).
- **Inspects only `assistant` messages** in the range — `role === "assistant"`. Tool‑result / user / custom / etc.
  messages carry no `toolCall` blocks and are skipped (the range from a resolver includes BOTH assistant and
  toolResult indices, because a "unit" groups them — spec/06 §2/§3).
- **For each `toolCall` block** (`block.type === "toolCall"`) reads `name` + `arguments` and classifies:
  - **`name ∈ {read, grep, rg, glob, find, ls}`** → `readFiles += arguments.path ?? arguments.file_path`. *(Contract
    set is {read, grep, rg, glob}; `find` + `ls` added because those are Pi's ACTUAL read‑only discovery tool names —
    see GOTCHA #3. The set is a `const Set`, trivially extensible.)*
  - **`name ∈ {write, edit}`** → `modifiedFiles += arguments.path ?? arguments.file_path`.
  - **`name === "bash"`** → read `arguments.command`; if the command is *provably read‑only* → ignore; else
    `bashSideEffects += command` (verbatim) AND, if a high‑confidence file path is parseable, `modifiedFiles += path`.
  - **unknown `name`** → ignore (forward‑compat; e.g. `mulligan_rewind`'s own call, if it ever appears in range).
- **De‑duplicates + sorts** each of the three arrays (lexicographic) before returning.

This subtask does **NOT**: touch `index.ts`/`config.ts`/`log.ts`/`runtime.ts`/`tokens.ts`; implement the rewind tool
or `renderNote` (P1.M5.T1.S1 / P1.M2.T3.S2); implement the resolver (P1.M3.T2); do path normalization relative to
`cwd` (see GOTCHA #6); import anything; or mutate inputs.

### Success Criteria

- [ ] `src/ledger.ts` is CREATED and exports `FileLedger`, `extractFileLedger`, `MessageLike`.
- [ ] `src/ledger.ts` has **zero imports** (`grep -cE '^import|^from' src/ledger.ts` → 0).
- [ ] `test/ledger.test.ts` is CREATED; `npx vitest run` is all‑green (ledger + tokens + config + log + runtime).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **Pinned test (spec/10 §1.6)**: `read(a.ts)`+`edit(b.ts)`+`bash(git commit)`+`bash(ls)` over range `[0,1,2,3]`
      → `{ readFiles:["a.ts"], modifiedFiles:["b.ts"], bashSideEffects:["git commit"] }`.
- [ ] **Empty span** (`range: []`) → all three arrays empty; **null messages / null range** → all empty (defensive).
- [ ] **read classification**: `read`/`write`/`edit` accept BOTH `path` AND `file_path` (Pi's `read` display reads
      `args?.file_path ?? args?.path` — read.js:39); `grep`/`rg`/`glob`/`find`/`ls` with a path → readFiles.
- [ ] **bash read‑only → omitted**: `ls`, `cat foo`, `grep bar`, `cat foo | grep bar`, `ls 2>&1 | cat`, `wc -l x`,
      `find . -name '*.ts'` → NOT in bashSideEffects.
- [ ] **bash side‑effect → included** ("when in doubt"): `git commit`, `git commit -m "wip"`, `npm install`,
      `node script.js`, `my-tool --x`, `find . -delete`, `find . -exec rm {} \;` → bashSideEffects (verbatim command).
- [ ] **bash + parseable path → modifiedFiles**: `echo x > out.txt`→modifiedFiles:["out.txt"]; `rm file.ts`→["file.ts"];
      `mv a.ts b.ts`→["a.ts","b.ts"]; `sed -i 's/a/b/' f.ts`→["f.ts"]; `curl -o out.txt <url>`→["out.txt"];
      `echo x > /dev/null`→modifiedFiles:[] (`/dev/null` excluded).
- [ ] **bashSideEffects stores the FULL command string** (e.g. `"git commit -m \"wip\""`), not a normalized form.
- [ ] **`git commit` (no path) → bashSideEffects only, modifiedFiles empty** (the contract's key example).
- [ ] **De‑dup + sort**: two `read(a.ts)` → readFiles:["a.ts"]; `touch z.ts`+`edit z.ts` → modifiedFiles:["z.ts"].
- [ ] **Defensive — never throws** (E13): null messages, null range, non‑array content, non‑record block, block with
      `type !== "toolCall"`, circular `arguments`, a throwing‑Proxy message — all return a valid (empty/partial)
      ledger; `expect(() => extractFileLedger(...)).not.toThrow()`.
- [ ] **range as index list, not tuple**: a range that includes a toolResult index is skipped (only assistant scanned);
      messages outside the range are ignored even if they contain tool calls.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `src/ledger.ts` to CREATE is given verbatim below (Task 1) and the exact
> `test/ledger.test.ts` (Task 2), including the pinned test and ~30 validated classification cases. The bash
> classification regexes/sets were **validated by a runnable prototype** (see `research/`) against 30 real commands
> (all correct). The `ToolCall` block shape and `arguments.command`/`arguments.path` field names are quoted from
> Pi's installed `.d.ts`/tool sources (verified). The `range: number[]` semantics are confirmed against
> spec/06 §3/§4. No prior knowledge beyond "this is a foundation‑tier pure helper sibling to `tokens.ts`" is
> required.

### Scope decision (READ BEFORE CODING)

- **CREATE `src/ledger.ts` — it does NOT exist.** Foundation‑tier sibling of `tokens.ts`. Define your OWN local
  structural types (`MessageLike`, `ToolCallContent`, etc.) — do **NOT** import them from `tokens.ts` (both are
  "consumer of NO other module"; spec/11 §1). Mirror `tokens.ts`'s defensive helpers (`isRecord`/`readOwn`); add
  `readStringField` + `stripQuotes` for path/command extraction.
- **CREATE `test/ledger.test.ts` — it does NOT exist.** Mirror `test/tokens.test.ts` conventions exactly.
- **Do NOT import anything.** Zero‑imports gate (`grep -cE '^import|^from' src/ledger.ts` → 0). Pure string/regex
  work — no `Buffer`, no `path`, no Pi, no `tokens.ts`. `RegExp`/`Math`/`Set` are language builtins.
- **Do NOT do path normalization relative to `cwd`.** The function is PURE and has no `cwd` parameter. It returns
  path strings **verbatim as they appear in tool `arguments`** (which are agent‑authored relative‑to‑cwd strings —
  Pi resolves paths against cwd; agents pass relative paths). The spec/04 §2.2 "Relative to cwd" describes the
  DESIRED representation; extracting args verbatim satisfies it. See GOTCHA #6.
- **Do NOT implement the rewind tool, `renderNote`, or the resolver.** Those are P1.M5.T1.S1 / P1.M2.T3.S2 /
  P1.M3.T2. This task ships ONLY the pure extractor they call.
- **Do NOT classify by tool‑result content.** Tool results carry no path info we extract; only the assistant
  `toolCall` blocks (name + arguments) drive classification.

### The bash‑classification crux (read this — it is the heart of the contract)

The contract (spec/04 §2.2, item_description §LOGIC) pins an **asymmetric, high‑recall** bash policy:

1. **`readFiles` / `modifiedFiles`** come from the `read`/`write`/`edit` family — these are EXACT (the tool name +
   `path`/`file_path` arg are unambiguous). No heuristic.
2. **`bashSideEffects`** uses a **conservative read‑only allowlist**: a command is ignored ONLY if it is *provably*
   read‑only (every top‑level segment's command name ∈ a read‑only set, AND no output redirect, AND `find` has no
   destructive flag). **Everything else → `bashSideEffects`** (verbatim command). This is "when in doubt, include"
   (spec/04 §2.2): a missed write is the dangerous failure (E5); a false‑positive side effect is cheap noise.
3. **`modifiedFiles` from bash** is **precision‑favoring** (the opposite trade‑off): extract a path ONLY when
   confident — redirect targets (`> file`) always, plus file‑like args from commands KNOWN to mutate files by path
   (`rm`/`mv`/`cp`/`mkdir`/`touch`/`sed`/`tee`/`curl`/`wget`/…). For other mutating commands (`git commit`, `node`,
   `npm`, `make`), the path is NOT a reliable "modified file" → it stays only in `bashSideEffects` (the full command
   string preserves the info). This avoids phantom entries like `script.js` or sed's `s/a/b/` in `modifiedFiles`.

**Why the two opposite trade‑offs are both correct:** `bashSideEffects` is the *safety net* (high recall — never
miss a possible write; the agent always sees the full command). `modifiedFiles` is a *convenience extraction*
(precision — don't confuse the agent with phantom files; if unsure, the command is already in `bashSideEffects`).
The pinned test encodes exactly this: `git commit` → `bashSideEffects:["git commit"]`, `modifiedFiles:[]`.

### Documentation & References

```yaml
# MUST READ — authoritative sources for extractFileLedger
- file: spec/04-data-model.md
  section: "§2.2 FileLedger — deterministically extracted, appended to the note"
  why: "THE source of the FileLedger interface + the extraction rules (readFiles/modifiedFiles/bashSideEffects
        sets + 'De-duplicated, sorted. Relative to cwd' + 'when in doubt, include')."
  critical: "readFiles: path/file_path from {read,grep,rg,glob}. modifiedFiles: path/file_path from {write,edit,bash}
        (bash only when write heuristic AND path parseable). bashSideEffects: non-read-only bash (regex heuristic;
        when in doubt, include)."

- file: spec/10-testing.md
  section: "§1.6 extractFileLedger"
  why: "The PINNED Tier-1 test: read(a.ts)+edit(b.ts)+bash(git commit)+bash(ls) → {readFiles:[a.ts],
        modifiedFiles:[b.ts], bashSideEffects:['git commit']}. Empty span → all empty. Implement EXACTLY this."

- file: spec/05-tools.md
  section: "§1 mulligan_rewind, step 5 (Compose ledger + note)"
  why: "The CONSUMER: the tool does a read-only resolution of the span and calls extractFileLedger. 'extract over
        the available span best-effort; the ledger is advisory.' Pins fail-open/advisory semantics."

- file: spec/08-edge-cases.md
  section: "E5 (side-effectful span), E1 (orphan toolResult), E8 (empty/no-op span), E13 (tool throws → fail-open)"
  why: "E5 is WHY FileLedger exists (the mutation warning fires when modifiedFiles/bashSideEffects non-empty →
        extraction MUST be robust, a missed write is dangerous). E1: range may include toolResult indices with no
        toolCall → skip non-assistant messages. E8: empty range → empty ledger, no error. E13: never throw."

- file: spec/03-architecture.md
  section: "§2.3 Pure helpers + §7 Module layout"
  why: "extractFileLedger(messages, range) is a named pure helper, sibling of tokens.ts/notes.ts. 'PURE: extractFileLedger'."

- file: spec/06-context-filter.md
  section: "§2 Unit/indices, §3 resolveLastToolCallGroup, §4 resolveLastTurn"
  why: "Confirms `range` is a number[] of MESSAGE INDICES (NOT [start,end)). resolveLastToolCallGroup → number[]|null
        (the unit's indices); resolveLastTurn → { remove: number[] }. A unit's indices include BOTH assistant AND
        toolResult messages → extractFileLedger must filter to assistant messages."
  critical: "range = number[] of indices into messages[]. Iterate them; skip non-assistant messages."

- file: src/tokens.ts            # READ-ONLY sibling — the discipline + types to MIRROR (not import)
  why: "The foundation sibling. Mirror: isRecord (151-154), readOwn (158-163), the local structural
        ToolCallContent/MessageLike types (25-50), the zero-imports/never-throws/fail-open discipline (8-16).
        Add: readStringField + stripQuotes for path/command extraction. Do NOT import tokens.ts."
  pattern: "isRecord/readOwn swallow Proxy-trap throws; readOwn(obj,key) reads an own property safely."

- file: plan/001_2e5baf25fe9f/P1M2T3S2  # (downstream — renderNote) — referenced, not yet written
  why: "renderNote(note, ledger, granularity) is the IMMEDIATE consumer of FileLedger (renders the
        <files-read>/<files-modified>/<bash-side-effects> blocks, omitting empty ones). So FileLedger's field
        names/casing (readFiles/modifiedFiles/bashSideEffects) are a load-bearing contract — match spec/04 verbatim."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§6.1 AssistantMessage, §6.2 ToolCall, §6.4 pairing invariant"
  why: "VERIFIED Pi shapes: AssistantMessage.content = (Text|Thinking|ToolCall)[]; ToolCall =
        {type:'toolCall';id;name;arguments:Record<string,unknown>}. The input extractFileLedger receives."

# VERIFIED Pi tool argument field names (grep'd from installed dist/core/tools/*.js):
#   read.js:17    -> readSchema.path  (read.js:39 display reads `args?.file_path ?? args?.path` → ACCEPT BOTH)
#   write.js:12   -> writeSchema.path
#   edit.js:18    -> editSchema.path
#   grep.js:14,16 -> pattern + glob (no path by default — but accept path/file_path if a caller passes one)
#   find.js:19,23 -> pattern + path   (Pi's glob-like tool is named `find`; there is NO `glob`/`rg` tool in Pi)
#   bash.js:30    -> command          (CONFIRMS arguments.command for the bash tool)
#   => path extraction reads arguments.path ?? arguments.file_path; bash reads arguments.command.

- file: plan/001_2e5baf25fe9f/P1M2T2S1/research/external_bash_classification.md
  why: "External research: READ_ONLY_COMMANDS taxonomy (with mutating-form caveats), REDIRECT_WRITE_RE (excludes
        2>&1 fd-dup and >= comparison), looksLikeFilePath (rejects URLs/flags/numbers/user@host), per-segment
        pipeline classification, /dev/null exclusion, the 'when in doubt include' rationale. URLs to POSIX/GNU/bash docs."
- file: plan/001_2e5baf25fe9f/P1M2T2S1/research/codebase_consumer_recon.md
  why: "First-hand recon: range=number[] (not tuple), no reusable ledger logic in looper-smoke (greenfield), the
        exact tokens.ts defensive helpers to mirror, the pinned test, E5/E1/E8/E13 applicability, test conventions."

- url: https://www.gnu.org/software/bash/manual/html_node/Redirections.html
  why: "Authoritative semantics of > >> &> 2>&1 >| — grounds the REDIRECT_WRITE_RE that writes-to-file while
        excluding fd-duplication (2>&1) and comparison (>=)."
- url: https://www.gnu.org/software/coreutils/manual/coreutils.html
  why: "Confirms which utilities are read-only (ls/cat/grep/…) vs have mutating forms (sort -o, dd, tee writes,
        sed -i) — grounds the READ_ONLY_BASH_COMMANDS set and the FILE_MUTATING_COMMANDS path-extraction set."
```

### Current Codebase tree (state at this subtask's start — verified live)

```bash
pi-mulligan/
├── package.json            # type:'module'; devDeps typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts           # MulliganConfig (read-only sibling). DO NOT TOUCH.
│   ├── log.ts              # fail-open JSONL logger (read-only sibling). DO NOT TOUCH.
│   ├── runtime.ts          # per-session map (read-only sibling). DO NOT TOUCH.
│   └── tokens.ts           # foundation sibling to MIRROR (not import): isRecord/readOwn/stringLength, MessageLike.
├── test/
│   ├── config.test.ts      # test convention (vitest, '../src/<file>.js'). Read-only.
│   ├── log.test.ts / runtime.test.ts / tokens.test.ts   # Read-only.
└── spec/                   # 04 §2.2 + 10 §1.6 + 05 step5 + 08 E5/E1/E8/E13 + 03 §2.3 + 06 §2-§4 are authoritative.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   4 files / 107 tests green. This task is pure + additive (2 new files); it cannot regress the baseline.
```

### Desired Codebase tree with files to be CREATED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── ledger.ts           # CREATED — FileLedger + extractFileLedger + MessageLike + bash classifier. ZERO imports.
└── test/
    └── ledger.test.ts      # CREATED — vitest Tier-1: pinned test + read/modified/bash/defensive/types describe blocks.
# No other files touched.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — range is a number[] of MESSAGE INDICES, NOT a [start,end) tuple, and NOT a Unit object.
#   resolveLastToolCallGroup returns number[]|null (the unit's indices); resolveLastTurn returns { remove: number[] }.
#   A unit's indices include BOTH assistant AND toolResult messages (spec/06 §2). So extractFileLedger MUST:
#     for (const i of range) { const msg = messages[i]; if (role(msg) !== 'assistant') continue; ... }
#   Iterate the indices; skip non-assistant messages; skip out-of-bounds indices defensively.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — Only assistant messages carry toolCall blocks. AssistantMessage.content is
#   (Text|Thinking|ToolCall)[]. Scan content[] for blocks with type==='toolCall'; read block.name + block.arguments.
#   toolResult/user/custom/bashExecution/branchSummary/compactionSummary messages have NO toolCall blocks → skip.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — The read-tool set is {read, grep, rg, glob} per the CONTRACT (spec/04 §2.2). Pi's ACTUAL read-only
#   discovery tools are named `find` and `ls` (there is NO `glob` or `rg` tool in Pi — dist/core/tools/ has find.js,
#   ls.js, grep.js, read.js; no glob.js/rg.js). So the contract's `glob` is generic. To make the ledger CORRECT for
#   real Pi sessions (the agent uses `find`/`ls`, not `glob`), ADD `find` and `ls` to the read set. This is a
#   well-documented superset of the contract (the contract set ⊂ this set; the pinned test only uses `read`, so it is
#   unaffected). The set is a `const Set` — trivially extensible. Do NOT add write/edit/bash here.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — Accept BOTH `arguments.path` AND `arguments.file_path`. Pi's `read` tool display logic reads
#   `args?.file_path ?? args?.path` (read.js:39), i.e. callers may pass EITHER. The contract says "union of
#   path/file_path args". So pathArg() = readStringField(args,'path') || readStringField(args,'file_path'). Missing/
#   non-string → "" → contributes nothing.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — The bash policy is ASYMMETRIC:
#     bashSideEffects = HIGH RECALL ("when in doubt, include"): ignore ONLY provably-read-only; else include (verbatim).
#     modifiedFiles   = HIGH PRECISION: redirect targets always; file-like args ONLY from FILE_MUTATING_COMMANDS.
#   git commit → bashSideEffects:['git commit'], modifiedFiles:[]  (no reliable path). node script.js → bashSideEffects
#   only (script.js is a script, not a modified file). This is the load-bearing design decision — see the crux above.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — Do NOT normalize paths to cwd. The function is PURE (no cwd param). Return path strings VERBATIM as
#   they appear in tool arguments (agent-authored relative-to-cwd strings). spec/04 §2.2 "Relative to cwd" describes
#   the desired representation, satisfied by extracting verbatim. Path resolution/normalization is OUT OF SCOPE
#   (would require cwd + the `path` module → breaks purity + zero-imports). Document this; do not attempt it.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (CRITICAL) — NEVER throw (rewind-tool hot path; spec/05 step5; E13). Mirror tokens.ts: isRecord/readOwn
#   swallow Proxy-trap throws; guard non-array messages/range/content → empty ledger; non-record/non-toolCall blocks
#   → skipped; missing/mistyped fields → contribute nothing. circular arguments → readOwn returns undefined (no
#   serialization of arguments is needed — we only read .path/.command/.file_path, never JSON.stringify arguments,
#   so circular refs are harmless here, unlike tokens.ts which sizes arguments).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — The REDIRECT_WRITE_RE must EXCLUDE fd-duplication (2>&1, 1>&2, >&1) and comparison (>=), else
#   `ls 2>&1 | cat` (read-only!) would be flagged a write and `[[ $a >= $b ]]` a false positive. Validated regex:
#   /(?:\d?&?>{1,2}\|?)\s*(?!&|=)([^\s;|&<>]+)/  — lookahead (?!&|=) after the optional spaces rejects &/= targets.
#   Known residual: `>` inside [[ ]] / (( )) (a comparison) is a rare false positive → safe per "when in doubt include".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — find is read-only per the contract BUT has destructive forms (-delete/-exec/-ok). Add a
#   FIND_MUTATING_RE guard: if the find segment matches /(?:^|\s)-(?:delete|exec|ok|okdir|fls|fprint|fprint0)(?=\s|$|=)/
#   → NOT read-only → bashSideEffects. This prevents `find . -delete` (a destructive op) from being mis-classified
#   read-only (which would be the dangerous E5 false-negative). Validated.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — looksLikeFilePath must REJECT false positives: URLs (scheme://), ssh hostspecs (user@host:path),
#   flags (-x, --foo), pure numbers, operators/redirect tokens, fd-dup targets (&1), bare `.`/`..`, and sed/awk
#   program shapes (s/a/b/, y/a/b/ — `^[a-z]/.*/[a-z]*$`). It must ACCEPT: has '/', a short extension (foo.ts),
#   ./x or ../x, dotfiles (.env). This keeps modifiedFiles free of phantom entries. Validated against 30 commands.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — /dev/null (and /dev/stdout, /dev/stderr, /dev/tty, /dev/full, /dev/zero) must NEVER appear in
#   modifiedFiles. `echo x > /dev/null` → bashSideEffects:['echo x > /dev/null'], modifiedFiles:[]. Maintain an
#   IGNORE_PATHS set; filter it in BOTH extractRedirectTargets and the token scan. Validated.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — De-dup + sort ALL THREE arrays before returning. Use a Set during accumulation; return
#   [...set].sort() (lexicographic by UTF-16 code unit — deterministic, correct for ASCII paths). The pinned test's
#   single-element arrays are unaffected; multi-element arrays (mv a.ts b.ts) must be sorted deterministically.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 — bashSideEffects stores the FULL command string verbatim (e.g. 'git commit -m "wip"'), NOT a
#   normalized/parsed form. spec/04 §2.3 example and the pinned test both expect the verbatim command. De-dup is on
#   the verbatim string (two identical commands → one entry).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #14 — cd / export / source (`.`) / pushd are intentionally NOT in READ_ONLY_BASH_COMMANDS. `source`/`.`
#   execute arbitrary code (can mutate files!) — must NOT be read-only. cd/export mutate shell state (not files) but
#   leaving them as side-effects is the SAFE "when in doubt include" default (only adds noise). `cd src && ls` →
#   bashSideEffects (safe). Documented, not a bug. Do NOT add `.`/source to the read-only set under any circumstance.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/ledger.ts — local structural types (mirror tokens.ts; api_verification.md §6.1/§6.2). NOT imported.

/** A tool-call content block (assistant only) — the substance is name + arguments (api_verification.md §6.2). */
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Any content block (we only care about toolCall; others are ignored). */
type ContentBlock = ToolCallContent | { type: string; [key: string]: unknown };

/**
 * Minimal structural message shape. Any Pi AgentMessage variant assigns in with NO cast (each carries a `content`
 * that is a plain string OR an array of content blocks — api_verification.md §6.1). We read `role` + `content` only.
 * EXPORTED (like tokens.ts's MessageLike) so tests + the rewind tool can type their inputs.
 */
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

/** The deterministic file ledger appended to the rewind note (spec/04 §2.2 — implement EXACTLY these field names). */
export interface FileLedger {
  /** Paths from read/grep/rg/glob/find/ls tool calls' path/file_path args (de-duplicated, sorted). */
  readFiles: string[];
  /** Paths from write/edit tool calls' path/file_path args + high-confidence bash write paths (de-dup, sorted). */
  modifiedFiles: string[];
  /** Non-read-only bash command strings, verbatim (de-duplicated, sorted). High-recall ("when in doubt, include"). */
  bashSideEffects: string[];
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 4 files / 107 tests green
  - RUN: test ! -e src/ledger.ts && echo "ok: ledger.ts absent (this task CREATES it)"
  - NOTE: ledger.ts is greenfield (no reusable scanning logic in looper-smoke — confirmed by recon).

Task 1: CREATE src/ledger.ts   (exact content below — copy verbatim)
  - CREATE the file with: the header doc, the local structural types, FileLedger, MessageLike, the tool-name sets,
    the bash-classification constants (READ_ONLY_BASH_COMMANDS, FILE_MUTATING_COMMANDS, IGNORE_PATHS, regexes),
    extractFileLedger (the public function), and all module-private helpers.
  - CONSTRAINTS:
      * ZERO imports (GOTCHA — zero-imports gate; grep must be 0).
      * Iterate range indices; skip non-assistant messages (GOTCHA #1/#2).
      * Accept path OR file_path (GOTCHA #4).
      * Asymmetric bash policy (GOTCHA #5): high-recall bashSideEffects, precision modifiedFiles.
      * Return verbatim paths (GOTCHA #6); never throw (GOTCHA #7); redirect regex excludes 2>&1/>= (GOTCHA #8);
        find -delete guard (GOTCHA #9); looksLikeFilePath rejects URLs/flags/sed-programs (GOTCHA #10);
        /dev/null excluded (GOTCHA #11); de-dup+sort all three (GOTCHA #12); verbatim bash commands (GOTCHA #13).
  - NAMING/PLACEMENT: src/ledger.ts. Exported: FileLedger, extractFileLedger, MessageLike. Module-local: everything else.

Task 2: CREATE test/ledger.test.ts   (exact content below — copy verbatim)
  - CREATE the file with: the vitest import, the ledger import, a small `asst()` test helper, and the describe
    blocks: pinned contract (spec/10 §1.6), readFiles, modifiedFiles, bashSideEffects (when-in-doubt), range
    iteration, defensive (never-throws), types.
  - CONSTRAINTS: NO beforeEach (pure, stateless). Mirror tokens.test.ts conventions.
  - COVERAGE: the pinned test; read with path AND file_path; grep/glob/find/ls; write/edit; bash read-only omission;
    bash side-effect inclusion; bash+path→modifiedFiles; /dev/null exclusion; git-commit-no-path; de-dup+sort;
    empty/null range; null messages; non-assistant-in-range skipped; non-toolCall blocks ignored; defensive never-throws.

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + zero-imports grep) and Level 2 (vitest). Levels 3/4 N/A (pure helper, no Pi runtime).
```

#### Exact content to CREATE — `src/ledger.ts` (Task 1 — copy verbatim)

```ts
/**
 * ledger.ts — deterministic file-ledger extraction for Mulligan's rewind note.
 * spec/04-data-model.md §2.2 (FileLedger + extraction rules), spec/10-testing.md §1.6 (pinned test),
 *   spec/05-tools.md §1 step 5 (the rewind tool is the consumer; "the ledger is advisory / best-effort"),
 *   spec/08-edge-cases.md E5/E1/E8/E13 (side-effect safety, orphan toolResult, empty span, fail-open),
 *   spec/03-architecture.md §2.3/§7 (pure helper, sibling of tokens.ts), spec/06 §2-§4 (range = number[] of indices).
 *
 * DESIGN (read GOTCHA #1–#14 in the PRP):
 * - Foundation-tier and Pi-FREE. Imports NOTHING — not Pi, not config, not log, not runtime, NOT tokens.ts. It is a
 *   pure, deterministic, side-effect-free function fully unit-testable in isolation; it is the consumer of NO other
 *   module (sibling of tokens.ts per spec/11 §1). It defines its OWN local structural types.
 * - `extractFileLedger(messages, range)` scans the assistant messages at the given indices, classifies their toolCall
 *   blocks into readFiles / modifiedFiles / bashSideEffects, de-duplicates + sorts each, and returns the FileLedger.
 *   `range` is a number[] of MESSAGE INDICES (from the rewind resolver — NOT a [start,end) tuple; a unit's indices
 *   include both assistant and toolResult messages, so we filter to assistant messages).
 * - The bash policy is ASYMMETRIC (the contract crux): bashSideEffects is HIGH-RECALL ("when in doubt, include" — a
 *   missed write is the dangerous failure, E5); modifiedFiles-from-bash is HIGH-PRECISION (redirect targets always,
 *   file-like args only from commands known to mutate files by path). git commit → bashSideEffects only, no
 *   modifiedFiles. Paths are returned VERBATIM (no cwd normalization — pure function, GOTCHA #6).
 * - NEVER throws (rewind-tool hot path, E13). isRecord/readOwn swallow Proxy-trap throws; non-array messages/range/
 *   content → empty ledger; out-of-bounds/non-assistant/non-toolCall → skipped. We only read .path/.file_path/.command
 *   (never JSON.stringify arguments), so circular arguments are harmless (unlike tokens.ts which sizes arguments).
 */

// ── local structural types (mirror tokens.ts; api_verification.md §6.1/§6.2) ────

/** A tool-call content block (assistant only) — the substance is name + arguments. */
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Any content block (we only ever inspect toolCall blocks; others are ignored). */
type ContentBlock = ToolCallContent | { type: string; [key: string]: unknown };

/**
 * Minimal structural message shape. Any Pi AgentMessage variant (user / assistant / toolResult / custom /
 * bashExecution / branchSummary / compactionSummary) satisfies this: each carries a `content` that is a plain string
 * or an array of content blocks. EXPORTED so tests + tools/rewind.ts can type their inputs (like tokens.ts's MessageLike).
 */
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

/** The deterministic file ledger appended to the rewind note (spec/04 §2.2 — field names are load-bearing). */
export interface FileLedger {
  /** Paths from read/grep/rg/glob/find/ls tool calls' path/file_path args (de-duplicated, sorted). */
  readFiles: string[];
  /** Paths from write/edit tool calls + high-confidence bash write paths (de-duplicated, sorted). */
  modifiedFiles: string[];
  /** Non-read-only bash command strings, verbatim (de-duplicated, sorted). High-recall ("when in doubt, include"). */
  bashSideEffects: string[];
}

// ── tool-name sets ──────────────────────────────────────────────────────────────
// Contract (spec/04 §2.2): readFiles from {read,grep,rg,glob}; modifiedFiles from {write,edit,bash}. We ADD `find`
// and `ls` to the read set because those are Pi's ACTUAL read-only discovery tool names (there is no `glob`/`rg` tool
// in Pi — GOTCHA #3). The set is a const Set; trivially extensible. Do NOT add write/edit/bash here.
const READ_TOOL_NAMES: ReadonlySet<string> = new Set(["read", "grep", "rg", "glob", "find", "ls"]);
const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(["write", "edit"]);
const BASH_TOOL_NAMES: ReadonlySet<string> = new Set(["bash"]);

// ── bash classification constants ───────────────────────────────────────────────
// Commands PROVABLY read-only (stdout only, no fs mutation in their common form). Excludes commands with mutating
// forms that need flag inspection (sort -o, hostname <name>, date -s, dd) — those default to side-effect (safe).
// `find` IS here (contract lists it read-only) but is guarded by FIND_MUTATING_RE (GOTCHA #9). `cd`/`export`/`source`
// are intentionally ABSENT: `.`/source execute arbitrary code; cd/export are shell-state (left as side-effect = safe).
const READ_ONLY_BASH_COMMANDS: ReadonlySet<string> = new Set([
  // listing / inspection
  "ls", "tree", "file", "stat", "readlink", "realpath", "du", "df", "free", "find",
  // reading / paging
  "cat", "head", "tail", "less", "more", "tac", "nl",
  // counting / formatting (stdout only)
  "wc", "echo", "printf", "seq", "column", "fold", "rev",
  // identity / system info
  "pwd", "whoami", "id", "uname", "uptime", "tty", "arch", "nproc", "getconf",
  // command lookup
  "which", "type", "command", "whereis", "hash",
  // environment print
  "env", "printenv", "locale",
  // comparison
  "diff", "cmp", "comm", "test", "[",
  // text filters (stdout only)
  "uniq", "cut", "paste", "tr",
  // search
  "grep", "egrep", "fgrep", "rg", "ag",
  // path components
  "basename", "dirname",
  // control / no-op
  "sleep", "true", "false",
]);

// Commands KNOWN to mutate files by PATH argument (used for precision-favoring modifiedFiles extraction from bash).
// For these, non-flag args that look like file paths → modifiedFiles. curl/wget included: looksLikeFilePath rejects
// URLs, so `curl -o out.txt <url>` → out.txt and `curl <url>` → no path. git/node/npm/make are intentionally ABSENT:
// their path-like args (script.js, build target) are NOT reliable "modified files" → bashSideEffects only (GOTCHA #5).
const FILE_MUTATING_COMMANDS: ReadonlySet<string> = new Set([
  "rm", "rmdir", "mv", "cp", "mkdir", "touch", "chmod", "chown", "chgrp", "ln", "tee", "truncate",
  "install", "patch", "sed", "split", "csplit", "curl", "wget",
]);

// Device/special targets that must NEVER appear in modifiedFiles (GOTCHA #11).
const IGNORE_PATHS: ReadonlySet<string> = new Set([
  "/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/full", "/dev/zero",
]);

// Output redirect that WRITES TO A FILE. Excludes fd-duplication (2>&1, 1>&2, >&1 — target begins with '&') and
// comparison (>= — '>' followed by '='). Capture group 1 = the target path. Validated (GOTCHA #8).
const REDIRECT_WRITE_RE: RegExp = /(?:\d?&?>{1,2}\|?)\s*(?!&|=)([^\s;|&<>]+)/;

// find's destructive flags → the find command is NOT read-only (prevents `find . -delete` mis-classification, GOTCHA #9).
const FIND_MUTATING_RE: RegExp = /(?:^|\s)-(?:delete|exec|ok|okdir|fls|fprint|fprint0)(?=\s|$|=)/;

/**
 * extractFileLedger — deterministic read/modified/bash classification of the tool calls in a message span.
 *
 * Iterates `range` (a number[] of message indices into `messages`), inspects only `assistant` messages' `toolCall`
 * blocks, and classifies each by tool name: read family → readFiles; write/edit → modifiedFiles; bash → read-only
 * (ignored) or bashSideEffects (+ a high-confidence modifiedFiles path when parseable). Unknown tool names are
 * ignored (forward-compat). All three arrays are de-duplicated + sorted. Returns the FileLedger.
 *
 * Pure + defensive: null/non-array `messages` or `range` → empty ledger; out-of-bounds indices, non-assistant
 * messages, non-array content, non-record/non-toolCall blocks, missing/mistyped fields, circular `arguments`, and
 * throwing-Proxy messages are all skipped — NEVER throws (E13; sits on the rewind-tool hot path).
 *
 * @param messages the full message list (a real Pi AgentMessage[] assigns in with no cast)
 * @param range    number[] of MESSAGE INDICES defining the span to scan (NOT a [start,end) tuple)
 * @returns { readFiles, modifiedFiles, bashSideEffects } — each a de-duplicated, sorted string[]
 */
export function extractFileLedger(
  messages: MessageLike[] | null | undefined,
  range: number[] | null | undefined,
): FileLedger {
  const read = new Set<string>();
  const modified = new Set<string>();
  const bash = new Set<string>();

  const list = Array.isArray(messages) ? messages : [];
  const indices = Array.isArray(range) ? range : [];

  for (const i of indices) {
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= list.length) continue; // out-of-bounds/garbage
    const msg = list[i];
    if (!isRecord(msg)) continue;
    if (readOwn(msg, "role") !== "assistant") continue; // only assistant messages carry toolCall blocks
    const content = readOwn(msg, "content");
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (readOwn(block, "type") !== "toolCall") continue; // only toolCall blocks
      const name = readStringField(block, "name");
      const args = readOwn(block, "arguments");
      classifyToolCall(name, args, read, modified, bash);
    }
  }

  return {
    readFiles: dedupeSorted(read),
    modifiedFiles: dedupeSorted(modified),
    bashSideEffects: dedupeSorted(bash),
  };
}

/** Classify one tool call into the three accumulating buckets (module-private). */
function classifyToolCall(
  name: string,
  args: unknown,
  read: Set<string>,
  modified: Set<string>,
  bash: Set<string>,
): void {
  if (!name) return;
  if (READ_TOOL_NAMES.has(name)) {
    const p = pathArg(args);
    if (p) read.add(p);
    return;
  }
  if (WRITE_TOOL_NAMES.has(name)) {
    const p = pathArg(args);
    if (p) modified.add(p);
    return;
  }
  if (BASH_TOOL_NAMES.has(name)) {
    const command = isRecord(args) ? readStringField(args, "command") : "";
    if (!command || isReadOnlyBash(command)) return; // read-only (or empty) → ignore
    bash.add(command); // HIGH-RECALL: any non-provably-read-only command → bashSideEffects (verbatim)
    for (const p of extractWritePaths(command)) modified.add(p); // HIGH-PRECISION: confident paths only
    return;
  }
  // unknown tool name → ignore (forward-compat; e.g. mulligan_rewind's own call, if ever in range)
}

/** Read the path argument: arguments.path ?? arguments.file_path (Pi's read accepts either — GOTCHA #4). */
function pathArg(args: unknown): string {
  if (!isRecord(args)) return "";
  const path = readStringField(args, "path");
  if (path) return path;
  return readStringField(args, "file_path");
}

// ── bash classification helpers (module-private) ───────────────────────────────

/** True iff the command is PROVABLY read-only: every top-level segment is a read-only command, no write redirect,
 *  and no destructive find flags. Conservative by design ("when in doubt, include" → return false). */
function isReadOnlyBash(command: string): boolean {
  for (const seg of splitTopLevel(command)) {
    if (seg.trim() === "") continue;
    if (!isSegmentReadOnly(seg)) return false;
  }
  return true;
}

/** One pipeline/compound segment is read-only iff: no write redirect, its command is in the read-only set, and (for
 *  find) it has no destructive flag. */
function isSegmentReadOnly(seg: string): boolean {
  if (hasWriteRedirect(seg)) return false; // any output redirect → not read-only
  const name = firstCommandName(seg);
  if (!READ_ONLY_BASH_COMMANDS.has(name)) return false; // unknown / mutating command → not read-only
  if (name === "find" && FIND_MUTATING_RE.test(seg)) return false; // find -delete/-exec → not read-only (GOTCHA #9)
  return true;
}

/** Extract high-confidence MODIFIED-FILE paths from a non-read-only command: redirect targets (always) + file-like
 *  args from segments whose command is a known file-mutator. Precision-favoring (GOTCHA #5). */
function extractWritePaths(command: string): string[] {
  const paths = new Set<string>();
  for (const p of extractRedirectTargets(command)) paths.add(p); // `> file` / `>> file` / `&> file` (excludes /dev/null)
  for (const seg of splitTopLevel(command)) {
    const name = firstCommandName(seg);
    if (!FILE_MUTATING_COMMANDS.has(name)) continue; // git/node/npm/make → no token-scan (their args aren't reliable)
    for (const tok of splitShellTokens(seg)) {
      const t = stripQuotes(tok);
      if (looksLikeFilePath(t) && !IGNORE_PATHS.has(t)) paths.add(t);
    }
  }
  return [...paths];
}

/** True if the command contains an output redirect that writes to a file (excludes 2>&1 fd-dup and >= comparison). */
function hasWriteRedirect(command: string): boolean {
  return REDIRECT_WRITE_RE.test(command);
}

/** Extract the file-path targets of write-redirect operators, dropping device/special paths (GOTCHA #11). */
function extractRedirectTargets(command: string): string[] {
  const global = /(?:\d?&?>{1,2}\|?)\s*(?!&|=)([^\s;|&<>]+)/g; // global-flag copy for the exec loop
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = global.exec(command)) !== null) {
    const p = stripQuotes(m[1]);
    if (p && !IGNORE_PATHS.has(p)) out.push(p);
  }
  return out;
}

/** True iff a token is LIKELY a file path (rejects URLs, flags, numbers, operators, fd-dup, bare ., sed-programs). */
function looksLikeFilePath(token: string): boolean {
  if (!token) return false;
  const t = stripQuotes(token);
  if (!t) return false;
  if (t === "." || t === "..") return false; // bare dot/dotdot
  if (/^-/.test(t)) return false; // flags: -x, --foo
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return false; // URLs: scheme://
  if (/^[^/\s@]+@[^:\s]+:/.test(t)) return false; // ssh/scp: user@host:path
  if (/^\d+$/.test(t)) return false; // pure number
  if (/^[<>|&;]+$/.test(t)) return false; // operators / redirect tokens
  if (/^&\d/.test(t)) return false; // fd-dup targets: &1 &2
  if (/^[a-z]\/.*\/[a-z]*$/.test(t)) return false; // sed/awk program shape: s/a/b/, y/a/b/, g/.../  (GOTCHA #10)
  // positive signals
  return (
    t.includes("/") || // any path separator
    /\.[a-zA-Z0-9]{1,8}$/.test(t) || // a short file extension: foo.ts, report.md
    /^\.\.?(\/|$)/.test(t) || // ./x, ../x, ..
    /^\.[A-Za-z_]/.test(t) // dotfile: .env, .gitignore
  );
}

/**
 * Split a command into top-level segments on | ; && || and newlines, quote-aware (so pipes inside quotes / `||` /
 * `$(...)` are not naively split — though `$(...)` is handled only by quote-awareness, not full subshell tracking; an
 * unbalanced edge is a rare, safe false-positive per "when in doubt, include"). Module-private.
 */
function splitTopLevel(command: string): string[] {
  const segs: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      cur += c;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      cur += c;
      continue;
    }
    if (!inSingle && !inDouble) {
      const two = command.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        segs.push(cur);
        cur = "";
        i++;
        continue;
      }
      if (c === "|" || c === ";" || c === "\n") {
        segs.push(cur);
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  segs.push(cur);
  return segs;
}

/** The command name of a segment: the first non-env-assignment token's basename (/usr/bin/ls → ls). Module-private. */
function firstCommandName(seg: string): string {
  const tokens = seg.trim().split(/\s+/);
  for (let raw of tokens) {
    if (!raw) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue; // skip leading VAR=val env assignments
    raw = stripQuotes(raw);
    if (!raw) continue;
    const base = raw.split("/").pop();
    return base ?? raw;
  }
  return "";
}

/** Quote-aware whitespace tokenizer (strips surrounding quotes). Module-private. */
function splitShellTokens(seg: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(c) && !inSingle && !inDouble) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ── module-private defensive helpers (mirror tokens.ts — never throw) ───────────

/** De-duplicate + sort a string set (lexicographic) → string[] (GOTCHA #12). */
function dedupeSorted(set: Set<string>): string[] {
  return [...set].sort();
}

/** Strip a single layer of surrounding single/double quotes from a token (module-private). */
function stripQuotes(token: string): string {
  return typeof token === "string" ? token.replace(/^['"]|['"]$/g, "") : "";
}

/** Read a string field from a record; "" if absent/mistyped/non-string (module-private). */
function readStringField(obj: unknown, key: string): string {
  const v = readOwn(obj, key);
  return typeof v === "string" ? v : "";
}

/** True for plain records (and Object.create(null)); false for null, primitives, and arrays (mirror tokens.ts). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable (mirror tokens.ts). */
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}
```

#### Exact content to CREATE — `test/ledger.test.ts` (Task 2 — copy verbatim)

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import { extractFileLedger, type FileLedger, type MessageLike } from "../src/ledger.js";

// No beforeEach needed: ledger.ts has NO module-scoped mutable state (pure over its arguments).

/** Build an assistant message whose content is a list of toolCall blocks. */
function asst(...calls: Array<{ name: string; arguments: Record<string, unknown> }>): MessageLike {
  return {
    role: "assistant",
    content: calls.map((c, idx) => ({
      type: "toolCall",
      id: `call_${idx}`,
      name: c.name,
      arguments: c.arguments,
    })),
  };
}

describe("extractFileLedger — spec/10 §1.6 PINNED contract (the load-bearing test)", () => {
  it("read(a.ts) + edit(b.ts) + bash(git commit) + bash(ls) → the exact pinned ledger", () => {
    const msgs: MessageLike[] = [
      asst({ name: "read", arguments: { path: "a.ts" } }),
      asst({ name: "edit", arguments: { path: "b.ts" } }),
      asst({ name: "bash", arguments: { command: "git commit" } }),
      asst({ name: "bash", arguments: { command: "ls" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1, 2, 3])).toEqual({
      readFiles: ["a.ts"],
      modifiedFiles: ["b.ts"],
      bashSideEffects: ["git commit"], // ls is read-only → omitted
    });
  });

  it("empty span (range []) → all three arrays empty", () => {
    const msgs: MessageLike[] = [asst({ name: "read", arguments: { path: "a.ts" } })];
    expect(extractFileLedger(msgs, [])).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
  });

  it("empty messages → all empty", () => {
    expect(extractFileLedger([], [0, 1, 2])).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
  });

  it("null messages / null range → all empty (defensive)", () => {
    expect(extractFileLedger(null, [0])).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
    expect(extractFileLedger(undefined, null)).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
    expect(extractFileLedger([asst({ name: "read", arguments: { path: "x" } })], null)).toEqual({
      readFiles: [],
      modifiedFiles: [],
      bashSideEffects: [],
    });
  });
});

describe("readFiles classification (read/grep/rg/glob/find/ls → path ?? file_path)", () => {
  it("read with path", () => {
    expect(extractFileLedger([asst({ name: "read", arguments: { path: "src/a.ts" } })], [0]).readFiles).toEqual([
      "src/a.ts",
    ]);
  });

  it("read with file_path (Pi's read accepts either — read.js:39)", () => {
    expect(extractFileLedger([asst({ name: "read", arguments: { file_path: "b.ts" } })], [0]).readFiles).toEqual([
      "b.ts",
    ]);
  });

  it("grep/rg/glob/find/ls with a path arg → readFiles", () => {
    const msgs: MessageLike[] = [
      asst({ name: "grep", arguments: { pattern: "x", path: "g.ts" } }),
      asst({ name: "glob", arguments: { pattern: "*.ts", path: "lib" } }),
      asst({ name: "find", arguments: { pattern: "*.ts", path: "src" } }),
      asst({ name: "ls", arguments: { path: "dist" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1, 2, 3]).readFiles).toEqual(["dist", "g.ts", "lib", "src"]);
  });

  it("read with NO path (missing/mistyped) → contributes nothing", () => {
    expect(extractFileLedger([asst({ name: "read", arguments: { pattern: "x" } })], [0]).readFiles).toEqual([]);
    expect(extractFileLedger([asst({ name: "read", arguments: { path: 42 } })], [0]).readFiles).toEqual([]);
  });

  it("de-duplicates repeated reads and sorts", () => {
    const msgs: MessageLike[] = [
      asst({ name: "read", arguments: { path: "z.ts" } }),
      asst({ name: "read", arguments: { path: "a.ts" } }),
      asst({ name: "read", arguments: { path: "z.ts" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1, 2]).readFiles).toEqual(["a.ts", "z.ts"]);
  });
});

describe("modifiedFiles classification (write/edit path; bash high-confidence paths)", () => {
  it("write + edit paths", () => {
    const msgs: MessageLike[] = [
      asst({ name: "write", arguments: { path: "new.ts", content: "x" } }),
      asst({ name: "edit", arguments: { path: "old.ts", edits: [] } }),
    ];
    expect(extractFileLedger(msgs, [0, 1]).modifiedFiles).toEqual(["new.ts", "old.ts"]);
  });

  it("bash redirect → modifiedFiles (+ command in bashSideEffects)", () => {
    const r = extractFileLedger([asst({ name: "bash", arguments: { command: "echo x > out.txt" } })], [0]);
    expect(r.modifiedFiles).toEqual(["out.txt"]);
    expect(r.bashSideEffects).toEqual(["echo x > out.txt"]);
  });

  it("bash rm/mv/cp/sed → modifiedFiles", () => {
    const msgs: MessageLike[] = [
      asst({ name: "bash", arguments: { command: "rm file.ts" } }),
      asst({ name: "bash", arguments: { command: "mv a.ts b.ts" } }),
      asst({ name: "bash", arguments: { command: "sed -i 's/a/b/' f.ts" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1, 2]).modifiedFiles).toEqual(["a.ts", "b.ts", "f.ts", "file.ts"]);
  });

  it("bash /dev/null redirect → NOT a modified file", () => {
    const r = extractFileLedger([asst({ name: "bash", arguments: { command: "echo x > /dev/null" } })], [0]);
    expect(r.modifiedFiles).toEqual([]);
    expect(r.bashSideEffects).toEqual(["echo x > /dev/null"]);
  });

  it("git commit (no parseable path) → bashSideEffects ONLY, modifiedFiles empty (the contract crux)", () => {
    const r = extractFileLedger(
      [asst({ name: "bash", arguments: { command: 'git commit -m "wip"' } })],
      [0],
    );
    expect(r.modifiedFiles).toEqual([]);
    expect(r.bashSideEffects).toEqual(['git commit -m "wip"']);
  });

  it("node/npm (path-like arg is a SCRIPT/TARGET, not a modified file) → modifiedFiles empty", () => {
    expect(extractFileLedger([asst({ name: "bash", arguments: { command: "node script.js" } })], [0]).modifiedFiles).toEqual([]);
    expect(extractFileLedger([asst({ name: "bash", arguments: { command: "npm install" } })], [0]).modifiedFiles).toEqual([]);
  });

  it("curl -o extracts the output file; curl to stdout does not (URL rejected)", () => {
    expect(
      extractFileLedger([asst({ name: "bash", arguments: { command: "curl -o out.txt https://x.com/y" } })], [0])
        .modifiedFiles,
    ).toEqual(["out.txt"]);
    expect(
      extractFileLedger([asst({ name: "bash", arguments: { command: "curl https://x.com/y" } })], [0])
        .modifiedFiles,
    ).toEqual([]);
  });

  it("de-duplicates modifiedFiles across write tool + bash", () => {
    const msgs: MessageLike[] = [
      asst({ name: "edit", arguments: { path: "z.ts" } }),
      asst({ name: "bash", arguments: { command: "rm z.ts" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1]).modifiedFiles).toEqual(["z.ts"]);
  });
});

describe("bashSideEffects classification — 'when in doubt, include' (high recall)", () => {
  it("read-only commands are OMITTED", () => {
    const msgs: MessageLike[] = [
      asst({ name: "bash", arguments: { command: "ls" } }),
      asst({ name: "bash", arguments: { command: "cat foo" } }),
      asst({ name: "bash", arguments: { command: "grep bar" } }),
      asst({ name: "bash", arguments: { command: "wc -l x" } }),
      asst({ name: "bash", arguments: { command: "find . -name '*.ts'" } }),
      asst({ name: "bash", arguments: { command: "echo done" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1, 2, 3, 4, 5]).bashSideEffects).toEqual([]);
  });

  it("read-only pipelines are omitted (all segments read-only, no redirect)", () => {
    expect(
      extractFileLedger([asst({ name: "bash", arguments: { command: "cat foo | grep bar" } })], [0]).bashSideEffects,
    ).toEqual([]);
    expect(
      extractFileLedger([asst({ name: "bash", arguments: { command: "ls 2>&1 | cat" } })], [0]).bashSideEffects,
    ).toEqual([]); // 2>&1 is fd-dup, not a file write → read-only pipeline
  });

  it("non-read-only commands are INCLUDED (verbatim)", () => {
    const msgs: MessageLike[] = [
      asst({ name: "bash", arguments: { command: "git commit" } }),
      asst({ name: "bash", arguments: { command: "npm install" } }),
      asst({ name: "bash", arguments: { command: "node script.js" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1, 2]).bashSideEffects).toEqual([
      "git commit",
      "node script.js",
      "npm install",
    ]); // sorted
  });

  it("unknown command → included (when in doubt)", () => {
    expect(
      extractFileLedger([asst({ name: "bash", arguments: { command: "my-weird-tool --foo" } })], [0])
        .bashSideEffects,
    ).toEqual(["my-weird-tool --foo"]);
  });

  it("find with destructive flags → included (NOT read-only; GOTCHA #9)", () => {
    expect(
      extractFileLedger([asst({ name: "bash", arguments: { command: "find . -delete" } })], [0]).bashSideEffects,
    ).toEqual(["find . -delete"]);
    expect(
      extractFileLedger([asst({ name: "bash", arguments: { command: "find . -exec rm {} \\;" } })], [0])
        .bashSideEffects,
    ).toEqual(["find . -exec rm {} \\;"]);
  });

  it("tee via pipe → side effect (the pipe target is a write)", () => {
    const r = extractFileLedger([asst({ name: "bash", arguments: { command: "ls | tee out.txt" } })], [0]);
    expect(r.bashSideEffects).toEqual(["ls | tee out.txt"]);
    expect(r.modifiedFiles).toEqual(["out.txt"]);
  });

  it("de-duplicates identical bash commands", () => {
    const msgs: MessageLike[] = [
      asst({ name: "bash", arguments: { command: "git commit" } }),
      asst({ name: "bash", arguments: { command: "git commit" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1]).bashSideEffects).toEqual(["git commit"]);
  });

  it("bash with empty/missing command → ignored (no crash)", () => {
    expect(extractFileLedger([asst({ name: "bash", arguments: { command: "" } })], [0]).bashSideEffects).toEqual([]);
    expect(extractFileLedger([asst({ name: "bash", arguments: {} })], [0]).bashSideEffects).toEqual([]);
  });
});

describe("range iteration — index list, not tuple; only assistant messages scanned", () => {
  it("a toolResult message in the range is skipped (no toolCall blocks)", () => {
    const msgs: MessageLike[] = [
      asst({ name: "read", arguments: { path: "a.ts" } }),
      { role: "toolResult", toolCallId: "call_0", toolName: "read", content: [{ type: "text", text: "..." }] },
    ];
    // range includes the toolResult index [1] — it must be ignored
    expect(extractFileLedger(msgs, [0, 1]).readFiles).toEqual(["a.ts"]);
  });

  it("messages OUTSIDE the range are ignored even if they contain tool calls", () => {
    const msgs: MessageLike[] = [
      asst({ name: "read", arguments: { path: "in.ts" } }),
      asst({ name: "read", arguments: { path: "out.ts" } }),
    ];
    expect(extractFileLedger(msgs, [0]).readFiles).toEqual(["in.ts"]);
  });

  it("out-of-bounds indices are skipped defensively", () => {
    const msgs: MessageLike[] = [asst({ name: "read", arguments: { path: "a.ts" } })];
    expect(extractFileLedger(msgs, [0, 5, 99]).readFiles).toEqual(["a.ts"]);
  });

  it("garbage (non-integer) indices are skipped", () => {
    const msgs: MessageLike[] = [asst({ name: "read", arguments: { path: "a.ts" } })];
    expect(extractFileLedger(msgs, [0, -1, 1.5, Number.NaN] as unknown as number[]).readFiles).toEqual(["a.ts"]);
  });

  it("a user message in the range is skipped", () => {
    const msgs: MessageLike[] = [
      { role: "user", content: "please read a.ts" }, // not a toolCall — even though content mentions a file
      asst({ name: "read", arguments: { path: "a.ts" } }),
    ];
    expect(extractFileLedger(msgs, [0, 1]).readFiles).toEqual(["a.ts"]);
  });
});

describe("defensive — never throws (spec/08 E13; rewind-tool hot path)", () => {
  it("non-array content → skipped (no throw)", () => {
    const msgs: MessageLike[] = [
      { role: "assistant", content: "just a string" },
      { role: "assistant", content: undefined },
    ] as unknown as MessageLike[];
    expect(() => extractFileLedger(msgs, [0, 1])).not.toThrow();
    expect(extractFileLedger(msgs, [0, 1])).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
  });

  it("non-record / non-toolCall blocks → skipped", () => {
    const msgs: MessageLike[] = [
      {
        role: "assistant",
        content: [
          null,
          42,
          "raw",
          { type: "text", text: "hi" },
          { type: "thinking", thinking: "..." },
          { name: "read", arguments: { path: "a.ts" } }, // missing type:'toolCall' → ignored
        ],
      } as unknown as MessageLike,
    ];
    expect(() => extractFileLedger(msgs, [0])).not.toThrow();
    expect(extractFileLedger(msgs, [0]).readFiles).toEqual([]); // the block has no type:'toolCall'
  });

  it("a toolCall with non-record arguments → skipped (no throw)", () => {
    const msgs: MessageLike[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "1", name: "read", arguments: "not-a-record" } as unknown as never],
      } as unknown as MessageLike,
    ];
    expect(() => extractFileLedger(msgs, [0])).not.toThrow();
    expect(extractFileLedger(msgs, [0]).readFiles).toEqual([]);
  });

  it("circular arguments → does not throw (we never JSON.stringify arguments)", () => {
    const args: Record<string, unknown> = { path: "a.ts" };
    args.self = args; // circular
    const msgs: MessageLike[] = [
      { role: "assistant", content: [{ type: "toolCall", id: "1", name: "read", arguments: args }] },
    ] as unknown as MessageLike[];
    expect(() => extractFileLedger(msgs, [0])).not.toThrow();
    expect(extractFileLedger(msgs, [0]).readFiles).toEqual(["a.ts"]); // .path read fine despite the cycle
  });

  it("a throwing-Proxy block → contributes nothing, never crashes (fail-open like tokens.ts)", () => {
    const trap = new Proxy(
      { type: "toolCall", id: "1", name: "read", arguments: { path: "a.ts" } },
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    const msgs = [{ role: "assistant", content: [trap] }] as unknown as MessageLike[];
    expect(() => extractFileLedger(msgs, [0])).not.toThrow();
    // every property read throws → readOwn swallows → block classified as non-toolCall → contributes nothing
    expect(extractFileLedger(msgs, [0])).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
  });

  it("accepts a real-ish Pi AgentMessage[] shape (structural typing)", () => {
    const content = [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "real.ts" } }] as const;
    const msgs = [{ role: "assistant", content }] as unknown as MessageLike[];
    expect(extractFileLedger(msgs, [0]).readFiles).toEqual(["real.ts"]);
  });
});

describe("types (P1.M2.T2.S1)", () => {
  it("FileLedger has the spec/04 §2.2 shape", () => {
    const ledger: FileLedger = { readFiles: [], modifiedFiles: [], bashSideEffects: [] };
    expectTypeOf(ledger).toEqualTypeOf<FileLedger>();
    expectTypeOf(ledger.readFiles).toEqualTypeOf<string[]>();
    expectTypeOf(ledger.modifiedFiles).toEqualTypeOf<string[]>();
    expectTypeOf(ledger.bashSideEffects).toEqualTypeOf<string[]>();
  });

  it("extractFileLedger returns a FileLedger", () => {
    expectTypeOf(extractFileLedger([], [])).toEqualTypeOf<FileLedger>();
  });

  it("MessageLike accepts an assistant message with a toolCall content block", () => {
    const msg: MessageLike = {
      role: "assistant",
      content: [{ type: "toolCall", id: "x", name: "read", arguments: { path: "a.ts" } }],
    };
    expectTypeOf(msg).toEqualTypeOf<MessageLike>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: iterate range indices, skip non-assistant, classify toolCall blocks (GOTCHA #1/#2).
export function extractFileLedger(messages, range) {
  const read = new Set(), modified = new Set(), bash = new Set();
  const list = Array.isArray(messages) ? messages : [];
  for (const i of (Array.isArray(range) ? range : [])) {
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= list.length) continue;
    const msg = list[i];
    if (!isRecord(msg) || readOwn(msg, "role") !== "assistant") continue;   // GOTCHA #1/#2
    const content = readOwn(msg, "content");
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || readOwn(block, "type") !== "toolCall") continue;
      classifyToolCall(readStringField(block, "name"), readOwn(block, "arguments"), read, modified, bash);
    }
  }
  return { readFiles: dedupeSorted(read), modifiedFiles: dedupeSorted(modified), bashSideEffects: dedupeSorted(bash) };
}

// PATTERN: asymmetric bash policy (GOTCHA #5). HIGH-RECALL bashSideEffects; HIGH-PRECISION modifiedFiles.
function classifyToolCall(name, args, read, modified, bash) {
  if (READ_TOOL_NAMES.has(name))   { const p = pathArg(args); if (p) read.add(p); return; }
  if (WRITE_TOOL_NAMES.has(name))  { const p = pathArg(args); if (p) modified.add(p); return; }
  if (BASH_TOOL_NAMES.has(name)) {
    const command = isRecord(args) ? readStringField(args, "command") : "";
    if (!command || isReadOnlyBash(command)) return;            // provably read-only → ignore
    bash.add(command);                                           // HIGH-RECALL (verbatim command)
    for (const p of extractWritePaths(command)) modified.add(p); // HIGH-PRECISION (confident paths only)
    return;
  }
  // unknown name → ignore (forward-compat)
}

// PATTERN: redirect regex excludes fd-dup (2>&1) + comparison (>=) — GOTCHA #8.
const REDIRECT_WRITE_RE = /(?:\d?&?>{1,2}\|?)\s*(?!&|=)([^\s;|&<>]+)/;   // hasWriteRedirect: .test(); extract: /g exec loop
// GOTCHA #7: NEVER throw — isRecord/readOwn swallow Proxy traps; we never JSON.stringify arguments (circular-safe).
// GOTCHA #9: find read-only ONLY if no -delete/-exec/-ok (FIND_MUTATING_RE).   GOTCHA #11: IGNORE_PATHS filter.
// GOTCHA #10: looksLikeFilePath rejects URLs/flags/numbers/sed-programs/bare-dot.   GOTCHA #12: [...set].sort().
```

### Integration Points

```yaml
DOWNSTREAM CONSUMERS (all later subtasks — none import extractFileLedger yet):
  - tools/rewind.ts (P1.M5.T1.S1): resolve the target span's message indices read-only (via the resolver pure
      helpers on a buildContextEntries() snapshot), then call extractFileLedger(spanMessages, spanIndices); persist
      the result in RewindMarker.ledger (spec/04 §3); if requireMutationWarning && (ledger.modifiedFiles.length ||
      ledger.bashSideEffects.length) append the mutation warning (spec/05 step 7, spec/08 E5).
  - renderNote (P1.M2.T3.S2): renderNote(note, ledger, granularity) renders ledger into the <files-read>/
      <files-modified>/<bash-side-effects> blocks, OMITTING empty lists (spec/04 §2.3). FileLedger field names are
      load-bearing for this consumer.
  - RewindMarker (spec/04 §3): ledger: FileLedger is persisted (self-describing marker for /tree + future tooling).

NO DATABASE / NO ROUTES / NO NEW DEPS — extractFileLedger uses only RegExp/Set/Math (builtins) + local helpers.
Nothing is added to package.json. No persistence, no logging, no Pi handle (pure over arguments).
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Task 1)

```bash
# Type-check the new module + test (include:["src","test"] covers them):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# Scope gate — ledger.ts is import-free (foundation-tier sibling of tokens.ts):
test "$(grep -cE '^import|^from' src/ledger.ts)" = "0"   # expect 0
# Confirm the required exports exist:
grep -cE 'export (interface|function) (FileLedger|extractFileLedger|MessageLike)\b' src/ledger.ts  # expect 3
# Confirm it is a NEW file (not a regression of an existing one):
test -f src/ledger.ts && echo "ok: ledger.ts created"

# Expected: tsc exit 0; all grep gates pass. If tsc errors, READ the output — common causes: importing tokens.ts
# (forbidden — define local types), a stray `import`, or a type mismatch on the structural MessageLike.
```

### Level 2: Unit tests (run after Task 2)

```bash
# The new ledger suite (the pinned test + read/modified/bash/range/defensive/types blocks):
npx vitest run test/ledger.test.ts        # MUST be all-green

# Full suite — must NOT regress the baseline (pure, additive, import-free new files):
npx vitest run                             # MUST be all-green (ledger + tokens + config + log + runtime; 107+N tests)

# Expected: every ledger test green. If any fail, debug the ROOT CAUSE — do not weaken asserts. Particular attention:
#   - the pinned test (spec/10 §1.6): exact deep-equal of the whole FileLedger.
#   - 'git commit' → modifiedFiles empty (the crux); 'ls'/'cat|grep'/'ls 2>&1|cat' → NOT in bashSideEffects.
#   - 'echo x > /dev/null' → modifiedFiles empty (IGNORE_PATHS); 'node script.js' → modifiedFiles empty.
#   - the never-throws cases (circular args, throwing-Proxy, non-array content) — these must .not.toThrow().
```

### Level 3: Integration testing

```bash
# N/A for this subtask — extractFileLedger is a PURE helper with no Pi runtime, no server, no DB. The Pi-coupled
# consumer (tools/rewind.ts, P1.M5.T1.S1) is where integration validation happens (F-rewind-core, spec/10 §2.1).
# The pure-function correctness is fully covered by Level 2.
```

### Level 4: Creative & domain-specific validation

```bash
# (Optional, high-value) Re-confirm the bash classification on a broader command corpus to catch regressions:
#   the regexes/sets were validated against 30 real commands in research/external_bash_classification.md. If a new
#   command class appears in real sessions that mis-classifies, EXTEND READ_ONLY_BASH_COMMANDS (precision) or
#   FILE_MUTATING_COMMANDS (modifiedFiles recall) — both are const Sets, trivially extensible. Document the change.
# No automated domain gate beyond Level 2 for v1.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] All validation levels completed: `npx tsc --noEmit -p tsconfig.json` exit 0; `npx vitest run` all-green.
- [ ] `test "$(grep -cE '^import|^from' src/ledger.ts)" = "0"` (zero imports).
- [ ] No regressions: pre-existing tokens/config/log/runtime suites still green.

### Feature Validation
- [ ] The **pinned spec/10 §1.6 test** passes EXACTLY (read/edit/bash-git/bash-ls → the exact ledger).
- [ ] Empty span / null messages / null range → all-empty ledger (defensive).
- [ ] read accepts `path` OR `file_path`; read set includes find/ls (Pi reality, GOTCHA #3).
- [ ] bash: `ls`/`cat|grep`/`ls 2>&1|cat` omitted; `git commit`/`npm install`/`node script.js`/unknown → bashSideEffects.
- [ ] bash+path: `> out.txt`/`rm file.ts`/`mv a.ts b.ts`/`sed -i … f.ts`/`curl -o out.txt url` → modifiedFiles;
      `/dev/null` excluded; `git commit`/`node script.js` → modifiedFiles empty.
- [ ] De-dup + sort on all three arrays; bashSideEffects stores verbatim commands.
- [ ] NEVER throws on malformed input (E13) — `expect(() => …).not.toThrow()` for all defensive cases.

### Code Quality Validation
- [ ] Mirrors `tokens.ts` conventions (defensive `isRecord`/`readOwn`, local structural types, zero imports, fail-open).
- [ ] `FileLedger`/`MessageLike`/`extractFileLedger` exported; everything else module-local.
- [ ] Anti-patterns avoided (see below): no imports, no cwd normalization, no tool‑result scanning, no JSON.stringify of arguments.

### Documentation & Deployment
- [ ] Code is self-documenting (header doc + inline comments citing spec sections + GOTCHA numbers).
- [ ] No new env vars / config (pure helper). Nothing added to package.json.

---

## Anti-Patterns to Avoid

- ❌ **Don't import anything** (tokens.ts, Pi, `path`, `Buffer`). Foundation‑tier = zero imports. Define local types.
- ❌ **Don't normalize paths to cwd.** Pure function, no cwd param — return args verbatim (GOTCHA #6).
- ❌ **Don't scan toolResult messages / tool‑result content.** Only assistant `toolCall` blocks carry (name, arguments).
- ❌ **Don't JSON.stringify `arguments`.** It can be circular (GOTCHA #7) — read only `.path`/`.file_path`/`.command`.
- ❌ **Don't make bash classification high‑precision (allowlist writes).** bashSideEffects is HIGH‑RECALL ("when in
  doubt, include") — a missed write is the dangerous E5 failure. Precision is for modifiedFiles only.
- ❌ **Don't add `.`/`source`/`exec` to READ_ONLY_BASH_COMMANDS.** They execute arbitrary code (GOTCHA #14).
- ❌ **Don't treat `node script.js`/`npm install`/`git commit` paths as modifiedFiles.** Their path‑like args are not
  reliable modified‑file indicators → bashSideEffects only (GOTCHA #5).
- ❌ **Don't skip the defensive cases.** This sits on the rewind‑tool hot path; it must NEVER throw (E13).
- ❌ **Don't catch all exceptions broadly inside the function** — the design never throws by construction
  (`isRecord`/`readOwn`/guards); no try/catch is needed in `extractFileLedger` itself (mirror tokens.ts).

---

## Confidence Score

**9/10** for one‑pass implementation success. The exact `src/ledger.ts` and `test/ledger.test.ts` are given verbatim
(copy‑pasteable). The bash classification regexes/sets were **validated by a runnable prototype** against 30 real
commands (all correct — see `research/external_bash_classification.md`). The `range: number[]` semantics, the
`ToolCall`/`arguments` shapes, and the tool argument field names (`path`/`file_path`/`command`) are all quoted from
verified Pi `.d.ts`/tool sources + spec/06. The one residual risk (‑1): the bash heuristic is necessarily imperfect
on adversarial shell (`$(…)`, heredoc‑with‑redirect, `[[ a > b ]]` comparisons) — but the "when in doubt, include"
policy makes every imperfection a *safe* false‑positive (captured in bashSideEffects), never the dangerous false‑
negative, and the ledger is explicitly advisory (spec/05 step 5). Documented known limitations: tee‑via‑pipe path
extraction, `wget` default‑save filenames, extensionless‑dir paths (land only in bashSideEffects).