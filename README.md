# pi-mulligan

> Autonomous, token-cheap context self-rewind for a [Pi](https://github.com/earendil-works/pi-coding-agent) coding agent. The agent sheds context it produced by mistake and redoes a turn with a self-authored note — no human in the loop.

**Pi:** `0.84.x` · **License:** MIT · **Status:** v1.2

---

## 1. Overview

**pi-mulligan** is a Pi extension that gives a coding agent autonomous, token-cheap control over its own context window — the ability to shed context it produced by mistake (a giant un-suppressed command output, a too-large file read, a wrong-direction exploration) and to *redo* a turn with a self-authored note, without a human in the loop.

The name comes from golf: a *mulligan* is a courtesy do-over in golf — a second shot after a bad one, without penalty. That is exactly what this extension gives the agent.

**Why agents need this:**

- **Unbounded output capture.** A `grep -r foo .` over a monorepo or a `cat` on a log produces ~10k tokens of output that then persists in *every* subsequent turn.
- **Wrong-direction work.** The agent pursues an approach across turns, accumulates a footprint, then reaches an insight that invalidates it — but the sunk context keeps taxing every future inference.
- **Silent accumulation.** No single result is catastrophic, but the turn grew the context sharply and the agent has no built-in signal that it is drifting toward an auto-compaction it would rather avoid.

**Why Pi's existing tools don't solve it:** compaction summarizes the *head* and *keeps the tail* (it sheds *old* context — the wrong direction for this use case), and `/tree`, `/compact`, and `/fork` are all human-driven — an agent tool has no route to invoke them (proven in `spec/02-proven-constraints.md`). There is no agent-callable primitive for "forget what I just did and try again." Mulligan provides it.

See `spec/SPEC.md` §1–§2 for the full executive summary and problem statement.

---

## 2. Installation

> **Works with zero configuration.** No `mulligan` settings are needed — the extension loads with all defaults (see [Configuration](#3-configuration) below).

### Three ways to load the extension

1. **Quick test — the `-e` / `--extension` flag:**

   ```bash
   pi -e ./src/index.ts
   ```

   If you already have pi-mulligan registered globally (see options 2–3 below) and get a `Tool "mulligan_*" conflicts with <path>` error, add `-ne` (`pi -ne -e ./src/index.ts`) to suppress global auto-loading for that run.

2. **Auto-discovery (recommended for daily use; supports `/reload`):** place the extension in one of Pi's extension directories:

   - `.pi/extensions/*.ts` — project-local (loads after project trust), or
   - `~/.pi/agent/extensions/*.ts` — global.

   This repo ships as `src/index.ts`; symlink or copy it into the auto-discovery directory so it is discoverable, or keep using `pi -e` for development.

3. **As a distributed Pi package:** `pi install` (npm or git), per Pi's `docs/packages.md`.

### npm for editor types (optional)

The repo already declares its runtime deps (`@earendil-works/pi-coding-agent` + `typebox`) in `package.json`. Running `npm install` resolves `node_modules/` so editors get IntelliSense/type-resolution. **It is not required to run** — at runtime, Pi resolves these deps from its own install (extensions are jiti-loaded in Pi's process).

### Zero-config smoke (the acceptance check)

```bash
pi -ne -e ./src/index.ts    # loads with NO mulligan config → all defaults → works out of the box
```

This is the `spec/11-build-order.md` §2 Step 9 acceptance check: the extension must load without error with an absent/empty `mulligan` config block.

> **`-ne` (no global extensions).** `-ne` disables Pi's global extension + package auto-discovery so the `-e` copy is the *only* one loaded. If a copy of pi-mulligan is already registered globally (via `pi install`, `~/.pi/agent/settings.json` → `packages`, or a symlink in `~/.pi/agent/extensions/`), loading it again with `-e` produces a `Tool "mulligan_*" conflicts with <path>` duplicate-name error and `pi` exits non-zero. `-ne` is what `npm run smoke` uses too (see [How to run the smoke](#how-to-run-the-smoke)).

### Requirements

- **Pi** `0.84.x`.
- **Node ESM** (the project's `package.json` has `"type": "module"`).

### How to run the smoke

The end-to-end acceptance gate is `npm run smoke`, which drives 14 deterministic scenarios (9 `F-*` + 5 edge cases `E7`/`E11`/`E12`/`E15`/`E20`) through a **real Pi process** firing the real `context` filter.

```bash
npm run smoke            # → 14/14 scenarios passed
```

The harness (`test/integration/run-smoke.mjs`) spawns each scenario as:

```bash
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID> -p "..." -p "..."
```

> **`-ne` is load-bearing.** It disables Pi's global extension + package auto-discovery so the `-e ./src/index.ts` copy is the *only* copy of pi-mulligan registered. **If a copy of pi-mulligan is already registered globally** — via `pi install`, an entry in `~/.pi/agent/settings.json` → `packages`, or a `src/index.ts` symlink/copy in `~/.pi/agent/extensions/` or `.pi/extensions/` — then loading it again with `-e` collides on the tool names (`Tool "mulligan_*" conflicts with <path>`) and `pi` exits non-zero, which the harness reports as `EXTENSION LOAD FAILED` for every scenario. `-ne` prevents this by suppressing the global registration. If you still see the conflict (e.g. a second copy loaded another way), the harness detects the signature and prints a single actionable diagnostic naming the conflicting path and the remediation.

> **Precondition.** No *second* copy of pi-mulligan may be loaded via an explicit `-e` or auto-discovery dir at the same time as the harness's own `-e ./src/index.ts`. A single globally-registered copy is fine because `-ne` suppresses it for the run.

---

## 3. Configuration

Mulligan reads a `mulligan` object from Pi `settings.json` — the global `~/.pi/agent/settings.json` and/or the project-local `.pi/settings.json` (project-local overrides global). It is loaded lazily on first use, cached for the session, and re-read on `/reload`. See `spec/09-configuration.md` §1.

> **Zero configuration.** Every option has a safe default. Unknown keys are ignored; type-mismatched values fall back to the default with a `warn`; **validation never throws.** The extension works with an empty or absent `mulligan` block.

### Defaults table

All 21 base knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3). The v1.2 `revert` block (8 more knobs) is documented separately in [§5 Working-tree revert (v1.2)](#5-working-tree-revert-v12-opt-in).

| Knob | Default | What it does |
|------|---------|--------------|
| **master** | | |
| `enabled` | `true` | Master switch. `false` → the entire extension is a no-op (see [Disabling](#disabling)). |
| **rewind** | | |
| `rewind.enabled` | `true` | Enable the `mulligan_rewind` tool. |
| `rewind.protectedRoles` | `["first:user", "latest:user"]` | Message selectors that can never be rewound past (the original task / the current ask). v1 supports these two selectors; unknown entries are dropped. |
| `rewind.maxDepth` | `5` | Max simultaneous *active* `mulligan:rewind` markers on a branch. Bounds accumulation (markers are permanent). |
| `rewind.maxRetriesPerPrompt` | `5` | Max *consecutive* rewinds that re-land at the same latest user prompt before refusal — the runaway-loop bound (`spec/08-edge-cases.md` E22). Distinct from `maxDepth` (cumulative markers). |
| `rewind.abortContextFraction` | `0.9` | Refuse any rewind once the filtered-context estimate reaches this fraction of the window — the zero-marker-loop guard (`spec/08-edge-cases.md` E22). |
| `rewind.requireMutationWarning` | `true` | Append a ⚠ warning when the hidden span wrote files / ran side-effecting bash (those effects persist on disk). |
| **shrink** | | |
| `shrink.enabled` | `true` | Enable the `mulligan_shrink` tool. |
| `shrink.maxActive` | `32` | Cap on simultaneous *active* `mulligan:shrink` markers; the oldest is retired when exceeded. Mirrors `rewind.maxDepth` as a bound on marker accumulation. A fractional value floors to a minimum of 1 (silent fallback to the default if it would floor below 1). |
| `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent for this many consecutive filter fires (`spec/08-edge-cases.md` E15/E21). Stops dead markers being walked every fire. A fractional value floors to a minimum of 1 (silent fallback to the default if it would floor below 1). |
| `shrink.notifyMaxChars` | `2048` | Caps the replacement text shown to the operator via `ctx.ui.notify` when a shrink is recorded. Pure UI side-channel — **zero context cost** (the tool result itself stays terse). See `spec/05-tools.md` §2. |
| **nudges** | | |
| `nudges.bloatReminder` | `true` | Annotate a `tool_result` exceeding the byte threshold with a rewind reminder. |
| `nudges.perTurnDrift` | `true` | Inject a one-line drift nudge when a turn grew past the token threshold. |
| `nudges.bloatThresholdBytes` | `16384` | Global catch-all: in-context byte size of a single tool result above which the bloat reminder fires (16 KB — below Pi's ~50 KB cap). A tool listed in `bloatThresholdBytesByTool` uses its own value instead; tools not listed fall back to this. |
| `nudges.bloatThresholdBytesByTool` | `{ "read": 24576 }` | Per-tool byte thresholds (keyed by Pi `toolName`). A tool listed here uses its own value instead of the global `bloatThresholdBytes`; tools not listed fall back to the global. `bash` is intentionally NOT listed — it is the primary bloat surface, so it uses the 16 KB global default to stay maximally sensitive; `read` gets 24 KB because large source-file reads are routine. |
| `nudges.driftThresholdTokens` | `4000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. The moving average over `driftWindowTurns` is compared with `>=` (not `>`), so sustained growth of ~4k/turn over the window fires (§5.1 criterion (b)) while a single heavy turn amid small ones does not (§5.1 (a)); the earlier 6k + strict-`>` default failed to fire on three consecutive ~4k turns. |
| `nudges.driftWindowTurns` | `3` | Rolling window (in turns) over which the per-turn token delta is smoothed before thresholding (`spec/07-preventive-and-nudges.md` §5.1). Turns a noisy single-turn signal into a sustained-growth signal. A fractional value floors to a minimum of 1 (silent fallback to the default if it would floor below 1). |
| `nudges.highWaterFraction` | `0.7` | Fraction of the context window at which the §5.2 high-water annotation fires (edge-triggered — fires once on crossing, clears when the total drops back below). Catches slow, steady accumulation the delta nudge misses. |
| **audit** | | |
| `audit.estimateConfidence` | `"medium"` | Honesty label reported with token estimates (`low` \| `medium` \| `high`). |
| **log** | | |
| `log.file` | `null` | Off by default. An absolute path to an append-only JSONL debug log. |
| **ui** | | |
| `ui.activeCheckpointBanner` | `true` | Show a persistent above-editor banner while a checkpoint is active (`spec/13` §5; `spec/08` E26). `false` hides the banner without disabling checkpoints. |

### Minimal example `settings.json`

The `mulligan` block is **optional** — omit it entirely for all defaults. Here is its shape, commented out so you can see the keys:

```jsonc
{
  // "mulligan": {
  //   "enabled": true,
  //   "rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },
  //   "shrink": { "maxActive": 32, "staleAfterFires": 3, "notifyMaxChars": 2048 },
  //   "nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "read": 24576 }, "driftThresholdTokens": 4000, "driftWindowTurns": 3, "highWaterFraction": 0.7 }
  // }
}
```

#### Disabling

`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, **all four tools** refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, `audit` all gate on the master switch — each refuses before doing any work; `audit` refuses while staying read-only in its normal operation), and the three human commands (`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit`) refuse the same way. The human can disable Mulligan without uninstalling it.

---

## 4. Tools

Mulligan registers four agent-callable tools. (v1.2 adds optional *params* to `mulligan_rewind` — see [§5 Working-tree revert (v1.2)](#5-working-tree-revert-v12-opt-in) — not a new tool.) The descriptions below are **verbatim copies** of the LLM-facing description strings the agent sees at runtime (from `src/tools/*.ts`) — they are the agent's documentation, reproduced here so a human knows exactly what the agent can now do. When-to-use guidance follows each one (from `spec/05-tools.md`).

### `mulligan_rewind`

> Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message. Set revert_file_changes to also restore the working-tree files you modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only).

**When to use it:**

- After a bloated tool result you cannot undo (e.g. an un-redirected `grep -r`) — shed it and re-approach.
- After a whole turn pursued the wrong direction — drop the work since the last user message and re-attempt.
- To jump back to a named checkpoint before a speculative sub-task you want to discard wholesale.

**Granularities:**

| `granularity` | What it hides |
|---------------|---------------|
| `last_tool_call_group` | Surgical — the most recent assistant turn that issued tool calls *plus* its tool-result messages. Keeps surrounding reasoning. |
| `last_turn` | Everything after the most recent user message (assistant + tool-result work produced this turn). The model lands back at the current user prompt. |
| `checkpoint` | Back to a named checkpoint the human set via `/mulligan_checkpoint` (requires the `checkpoint` param). |

`last_turn` keeps your latest message; to rewind further (across your own subsequent prompts), set a checkpoint first.

**The three-field note (confabulation defense).** A rewind requires a `note` with three non-empty fields — `what_happened` (what happened and the lesson to avoid repeating), `true_current_state` (task progress, decisions, and conclusions — files/commands are auto-captured in the ledger), and `next` (the immediate next action). Vacuous notes are refused. The resumed model reads this note as the most-recent context.

### `mulligan_shrink`

> Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result).

**When to use it (vs `mulligan_rewind`):** rewind = the call was a *mistake* — it is gone, replaced by a fresh attempt; shrink = the call was *fine* but its *output* is bloated — the call stays, and its result is swapped for your summary.

**Operator echo (zero context cost).** The tool result stays terse ("Matched: yes/no") and does **not** echo the replacement — echoing it would place a second copy in context, defeating the tool's purpose. Instead the replacement is surfaced to the *operator* via a UI toast (`ctx.ui.notify`), capped at `shrink.notifyMaxChars` (default 2048) chars for ergonomics — the model never sees it. (`spec/05-tools.md` §2.)

**Target matchers** (resolved live each turn, robust to compaction):

- `by_tool_call_id` — the unique toolCallId of the result to shrink.
- `by_tool_name` + `occurrence` (`"last"` / `"first"`) — semantic match by tool name.
- `by_content_includes` — the first message (any role) whose text contains the substring. An empty substring matches nothing (resolves to null).

The `replacement` must be non-empty and **faithful** — the model treats it as ground truth from then on.

**View substitution (trust note).** Shrink never deletes anything — it is a *view substitution*: the original message stays on disk and is recoverable by the human via `/tree`, so only the model's in-context copy is replaced — even summarizing a user message (E19) is lossless at the session level.

Checkpoints moved to the human in v1.1 (the destructive cross-prompt power belongs to the user). See [Human commands (v1.1)](#human-commands-v11) below for `/mulligan_checkpoint` and `/mulligan_checkpoint_revoke`. The agent still rewinds to a checkpoint via `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")`; a checkpoint auto-expires once a rewind targets it.

### `mulligan_audit`

> Show a token breakdown of the context you're currently carrying (what the model actually sees), flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to rewind or shrink.

**When to use it:** when you suspect context is bloated and want to decide between rewind (mistake) and shrink (fine-but-big). The report ranks the top messages by size (`top`, default `8`), flags results above the per-tool bloat threshold, and lists active rewind/shrink markers + checkpoints — closing the feedback loop ("that one read is 9.4k → shrink it").

The token total is computed from the **filtered view** (what the model actually sees after Mulligan's transforms) — *not* Pi's `getContextUsage()`, which would count already-hidden tokens. The audit is **read-only** and persists nothing. It refuses with the standard disabled message (`Mulligan: refused — Mulligan is disabled.`) when `enabled: false`.

### `mulligan_cancel`

> Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Identify the marker by `target` (same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op.

**When to use it:** the safety valve for a mis-targeted `mulligan_rewind` or `mulligan_shrink` — a shrink issued against the wrong message, a rewind that hid something you still need, or any marker pointed at the wrong target. Without it, the mistaken transform would apply on every turn for the rest of the session, and a `mulligan_rewind` of the issuing call does **not** retire it (markers are control entries outside the rewind's span). Identify the marker by `target` — the same hint shape `mulligan_shrink` uses (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`), resolved live each turn; the most recent marker covering that content is retired. An explicit `markerId` (from `details`) is accepted as a fallback if you have one. The transform stops applying from the next turn on; cancelling a non-existent or already-cancelled marker is a safe no-op — call it freely if unsure. (`spec/05-tools.md` §5.)

Retraction is **forward-only**: it suppresses the marker from the filtered view going forward. It does **not** undo on-disk side effects (file edits and bash commands persist) or replay originally-hidden content into the live turn — that stays recoverable by the human via `/tree`. This softens D6: a mistaken marker is no longer irrevocably permanent.

### Human commands (v1.1)

Checkpoints and the bloat diagnostic are the three narrow human commands (the destructive cross-prompt rewind power belongs to the *user*, not the agent — `spec/13-human-commands.md`). Each is a `pi.registerCommand` handler; output goes to `ctx.ui.notify` (the TUI), never into the model's context.

- **`/mulligan_checkpoint <name>`** — set a named checkpoint at the current position. Until revoked, the agent may `mulligan_rewind` across your subsequent prompts back to this point (the `last_turn` granularity never wipes your latest message, but a `checkpoint` rewind may). A checkpoint auto-expires once a rewind targets it. `name` must match `/^[a-z0-9_-]{1,40}$/`.
- **`/mulligan_checkpoint_revoke <name>`** — revoke a checkpoint so the agent can no longer rewind to it.
- **`/mulligan_audit`** — run the same context-bloat diagnostic the agent's `mulligan_audit` tool runs, surfaced to you only (never injected into the model's context).
- **Active-checkpoint banner** — while any checkpoint is active, a persistent above-editor line reminds you: `⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>`. Disable the banner without disabling checkpoints via `ui.activeCheckpointBanner: false`.

---

## 5. Working-tree revert (v1.2, opt-in)

**Working-tree revert** is an opt-in, best-effort restoration of the files on disk (the *working tree*) to the state captured just before a rewound span, so the resumed agent need not re-read files to reorient. The whole point of a rewind is a cheap re-attempt; re-reading entire files to rebuild "what was there before this turn" *adds* more context than the rewind just shed — defeating its purpose. Restoring the files removes that need: the disk matches the model's mental model of "what was there before I started this turn."

**This feature touches the WORKING TREE (files on disk), not the append-only session tree.** Like the rest of Mulligan, it never mutates the conversation history — your session tree stays append-only. It is **not retry/replay**: no tool call is re-executed, it is a state-restore (the `spec/SPEC.md` §9 D1 hard-retry limitation stands). It reverts working-tree file state from **any** tool — `write`/`edit` **and** bash file commands (`sed -i`, `awk -i inplace`, `cp`, `mv`, `rm`, heredocs, `python -c` writing files) alike. **Non-filesystem effects persist and are NOT reverted:** git refs/history (`git commit`/`push`/`tag` — refs are never touched), the git index (`git add`), excluded dependency/generated dirs (`node_modules`/`.venv`/`dist` — so `npm`/`pip` installs persist), and network/DB/process effects.

Full design in `spec/14-working-tree-revert.md` (§0 scope; §1 opt-in model + granularity table; §3 `GitBackend` + the five git-safety guarantees; §4 `CasBackend` / non-git modes; §6 restore / refuse-on-dirty).

### How to enable it

Set `config.revert.enabled: true` in your `mulligan` settings block (the **master switch**). It is `false` by default, which means the snapshot machinery is entirely inert — zero capture, zero storage, zero overhead; the rewind tool still accepts the flags but ignores them with a one-line notice. Like the rest of the `mulligan` config, the `revert` block is lazy-loaded, cached for the session, and re-read on `/reload`.

### Per-call flags

`mulligan_rewind` gains two optional boolean params. The agent **must set at least one** — they are never inferred:

- **`revert_file_changes`** — restore the working-tree files modified in the rewound span to their pre-span state, so the agent need not re-read them on resume. Best-effort; failures are logged and never block the rewind. Files skipped at capture time because a cap was hit (`maxFileBytes`/`maxTotalBytes`/`maxSnapshotsPerTurn`) are surfaced in the result (the success text notes "N skipped/failed" and the marker's `revert.skipped` flag is set), so the agent is told its file-revert was incomplete rather than silently dropped. Requires `config.revert.enabled`. Ignored at `last_tool_call_group` granularity (noticed in the result).
- **`delete_created_files`** — **destructive.** Delete working-tree files the rewound span newly created (files that did not exist before the span). Requires **both** this flag **and** the global `config.revert.allowDeleteCreatedFiles: true`. Deletion is the one irreversible action, so it sits behind two gates (the per-call flag **and** a config kill-switch).

### Granularity scope

File revert is supported at `last_turn` and `checkpoint` only:

| Granularity            | File revert?              | Notes |
|------------------------|---------------------------|-------|
| `last_turn`            | ✅                         | Restore to the turn-start snapshot. The natural, common case. |
| `checkpoint`           | ✅                         | Restore to the checkpoint-creation snapshot. Checkpoints are rebuilt from the persisted `mulligan:revert-checkpoint` control entries on session start, so a checkpoint-granularity `revert_file_changes` still finds its snapshot after `/resume`. |
| `last_tool_call_group` | ❌ (ignored + noticed)     | Whole-tree snapshots are boundary-granular; a group-granularity file revert would over-revert to turn-start (undoing earlier good edits in the same turn) — a semantic mismatch the tool refuses rather than silently performing. The context rewind still happens normally. |

At `last_tool_call_group`, the file revert is ignored and the tool returns the notice: "File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn." (The context rewind still proceeds.)

### Git-safety guarantee

In a git repo the backend uses an **external shadow repository**: its `GIT_DIR` lives under `config.revert.storageDir` (one shadow repo per source worktree), and its `GIT_WORK_TREE` points at the user's working tree. The user's `.git` is **never written — not even a transient/dangling object**, and — because the workspace root is resolved as `realpath(cwd)` with no upward discovery (see Workspace-root safety below) — **no command of any kind, read or write, is ever issued against it.** The five git-safety guarantees (`spec/14` §3):

1. **No command of any kind — read or write — is ever issued against the user's git** (the root is `realpath(cwd)` and needs no `rev-parse`; see Workspace-root safety below): every write (`add`, `write-tree`, `commit-tree`, `update-ref`, `read-tree`, `checkout`, `gc`) targets the shadow repo. Forbidden everywhere: `commit`, `reset`, `checkout <branch>`, `merge`, `stash`, `rebase` against the source.
2. **The user's `.git` is never written — not even a dangling object.** This is strictly cleaner than a `git stash create`-in-source design: there is nothing to reclaim from the user's repo because nothing was ever put there. `git status`, `git log`, `git stash list`, and the reflog of the source repo are byte-for-byte unaffected.
3. **Restore writes only working-tree files.** The source index and all source refs are never touched.
4. **`delete_created_files` only deletes files the span created** (present now, absent from the before-snapshot), behind the per-call flag **and** `config.revert.allowDeleteCreatedFiles`. **Defense-in-depth size floor:** a delete-candidate whose current size exceeds `revert.maxFileBytes` is always spared — even if its capture record was lost — so deletion safety never depends solely on the best-effort capture note/manifest (a leftover large file is recoverable; a deleted pre-existing one is not).
5. **Pre-flight refuse-on-dirty** (below): if any affected path drifted since the after-snapshot, the **whole file-revert is refused** — never a silent clobber.

### Workspace-root safety

The snapshot subsystem never walks up the tree to find an enclosing repository. The workspace root is always `realpath(cwd)` — exactly the directory the session was launched in — resolved lexically, with **no upward git discovery** (no `rev-parse --show-toplevel` / `--git-dir` / `--absolute-git-dir`), so a subdirectory launch can never be silently promoted to a parent directory. If `realpath(cwd)` is the user's home directory, the filesystem root (`/`), or any depth-1 system directory (`/home`, `/etc`, `/usr`, `/var`, `/bin`, …), the backend is **refused** and revert is unavailable (backend `"none"`; the rewind still proceeds with just the note). Because the root needs no `rev-parse` to resolve it, **no command of any kind — read or write — is ever issued against the user's `.git`**: the external shadow repo is the only git that receives any command. `restore()` additionally re-checks this invariant at its entry and refuses (zero filesystem mutation) if the root is forbidden — a last line of defense independent of detection. (`spec/14` §2 SAFETY INVARIANT; §3 git-safety guarantee #1.)

### Dirty-guard behavior

Before restore, a dirty check compares each **affected** file's **current** content to its after-snapshot state. The **affected** set is the comprehensive snapshot diff — every workspace path that differs between the pre-span snapshot and the current tree — so it covers `write`/`edit` **and** bash file mutations (`sed -i`, `awk -i inplace`, `cp`/`mv`/`rm`, `python -c`, `perl -i`, heredocs), not just the write/edit tool calls. If **any** affected file drifted since the turn ended (a human/other-process edit), the **whole file-revert is refused** — not a silent clobber — and the context rewind still proceeds; the rewind result names the drifted paths in the marker's `refusedFiles` field.

The dirty guard is a **turn-level** guarantee: it needs the turn's after-snapshot (captured at `agent_end`). A **checkpoint** captures once and has no after-snapshot, so checkpoint-granularity revert **skips** the dirty guard and restores to the checkpoint snapshot directly (a checkpoint's entire purpose is wholesale rollback to a known point). Rationale: clobbering an unsaved human edit is the one unrecoverable failure; for turns the guard refuses and lets the agent re-request, while checkpoints restore outright. See `spec/14` §6 step 3.

### Non-git mode

Outside a git repo, a content-addressed store (**CAS**) backend snapshots and restores the same comprehensive file set. `config.revert.nonGitMode` selects the strategy:

- **`"cas"`** (default) — comprehensive whole-tree: walks cwd minus `excludeGlobs`, dedupes content by hash, reuses unchanged-file hashes via `(mtime, size)` short-circuiting. Universal fallback.
- **`"explicit-paths"`** — conservative: snapshots only the explicit `write`/`edit` tool paths. Bash file commands are **not** captured (the tool warns once per turn); use this for cost-sensitive workspaces where whole-tree scanning is too broad.

If neither backend can initialize (no git, unwritable storage) → revert is unavailable and the system **fails open**: the rewind still succeeds with just the note (today's pre-v1.2 behavior).

### Configuration

The eight `revert.*` knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/14` §8):

| Knob | Default | What it does |
|------|---------|--------------|
| `revert.enabled` | `false` | Master switch (opt-in). `false` → the snapshot machinery is entirely inert. |
| `revert.allowDeleteCreatedFiles` | `false` | Global kill-switch on the destructive `delete_created_files` path. Required in addition to the per-call flag. |
| `revert.nonGitMode` | `"cas"` | Non-git capture strategy: `"cas"` (comprehensive whole-tree, default) or `"explicit-paths"` (conservative — `write`/`edit` only). |
| `revert.storageDir` | `null` | Shadow-repo / CAS root; `null` → `<sessionDir>/mulligan/`. **Never resolves inside `cwd`** (validation rejects it). |
| `revert.maxFileBytes` | `262144` | Per-file cap (256 KB); skip + warn at capture (fail-closed) — a huge gitignored data file is not silently captured. Also the restore-time safety floor that spares oversize files from `delete_created_files` (see Git-safety guarantee #4). |
| `revert.maxTotalBytes` | `33554432` | Per-session cap (32 MB); capture stops beyond it (partial snapshot). |
| `revert.maxSnapshotsPerTurn` | `64` | Count cap; capture stops beyond it (partial snapshot). |
| `revert.excludeGlobs` | `[".git","node_modules","dist","build",".next",".venv","target"]` | Snapshot excludes for **both** backends. `.gitignore` is deliberately **not** consulted — see the privacy note. |

> **`.gitignore` is deliberately not consulted.** The snapshot uses its own `excludeGlobs`, not `.gitignore`, so a gitignored `.env` (or secrets/dotfiles) **is** captured and restored on rewind — `.gitignore` means "don't commit to VCS", not "don't snapshot". **Privacy:** captured files live in local snapshot storage (the shadow repo / CAS dir under `storageDir`, **outside** `cwd`), are **never sent anywhere**, and are wiped on `session_shutdown`. Restoring those files is the feature's job.

---

## 6. How It Works

The core insight (established empirically in the feasibility spike, `spec/02-proven-constraints.md`): Pi's conversation is an **append-only tree** that an agent *cannot* structurally mutate from a tool, but the agent **can** drop persisted "view instructions" that the `context` event honors on every inference. A rewind is therefore not a deletion — it is a **permanent soft-delete**: a persisted marker that hides a span from every future inference, while the originals remain on disk and are visible in `/tree`.

### Data flow on a rewind

```
agent calls mulligan_rewind(note, granularity)
   │
   ├─ appendEntry("mulligan:rewind", {spec, ...})         ← control state (NOT sent to the model)
   ├─ sendMessage({customType:"mulligan:note", content})   ← the note (IN context)
   └─ tool returns a short confirmation
        │
        ↓  (normal agent loop continues)
next inference → context handler
   ├─ read mulligan:* markers from the session entries
   ├─ rewrite the message copy: hide the span / substitute the shrink
   └─ return { messages: transformed }
        │
        ↓
model sees [kept prefix] + [your note] + [confirmation], resumes — no resume code needed
```

**Shrink** = view substitution: `appendEntry("mulligan:shrink", {target, replacement})`; the context handler substitutes content in place (preserving `role` / `toolCallId` / `toolName` / `isError` so the tool-call/result pairing invariant holds).

Both rewind and shrink markers are **retractable**: `mulligan_cancel` retires a mis-targeted marker so it stops applying from the next turn on — a safety valve when a rewind hid something still needed or a shrink hit the wrong message (see [§4 Tools](#4-tools)). Retraction is forward-only: on-disk side effects persist and originally-hidden content stays recoverable via `/tree`.

**Ride-along nudges & signals (zero extra model requests):**

1. **Bloated-result reminder** (`spec/07-preventive-and-nudges.md` §1) — a `tool_result` hook appends a single-line reminder to any result exceeding the per-tool bloat threshold (`bash` and unlisted tools: the 16 KB global default; `read`: 24 KB). The reminder is appended, not replacing (the agent may still need the data) and costs ~20 tokens, once, only when the threshold is crossed.
2. **Per-turn drift nudge** (`spec/07-preventive-and-nudges.md` §2/§5) — at `turn_end` Mulligan records the **agent-attributable** token delta (your prompts are exempt, so a large paste you made does not trip the nudge); on the *next* inference it injects a single-line annotation (e.g. ``Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.``). The delta is **windowed** (§5.1): smoothed over a rolling window of the last `nudges.driftWindowTurns` turns (default 3) before the threshold, so a single heavy turn (reading several source files, a pasted reference doc) does **not** fire it, but *sustained* growth across consecutive turns does. The nudge fires on **delta-only**: a single big result is already covered by Nudge A above, so the cross-turn nudge no longer re-announces bloat the agent already addressed — it stays quiet unless there is no baseline yet (first turn / post-reload). The `mulligan:nudge` annotation is **never persisted**.
3. **High-water signal** (`spec/07-preventive-and-nudges.md` §5.2) — a one-time annotation (`[mulligan] Context is at ~70% of the window; review recent output for reclaimable space.`) the first time the *filtered* context crosses `nudges.highWaterFraction` of the window (default 0.7). It is **edge-triggered** — it fires once on the upward crossing and stays quiet until the total drops back below the fraction, so it never nags. This catches slow, steady accumulation that no single-turn delta nudge sees.

**`/tree` is the audit trail.** Every rewind, shrink, and checkpoint is a persisted entry — the human can inspect the full un-filtered history (including every hidden span) via Pi's native `/tree`. Mulligan adds three narrow human commands — checkpoint set/revoke (the destructive cross-prompt power belongs to the user) and audit (the bloat diagnostic a human monitors); `/tree` remains the audit trail.

See `spec/SPEC.md` §1, §4 and `spec/06-context-filter.md` for the full architecture.

---

## 7. Guarantees

1. **Soft-delete / audit trail.** Hidden content is **never lost** — it stays in the session JSONL on disk and is visible in Pi's native `/tree`.
2. **Fail-open.** Any internal error degrades to a logged no-op, never a broken agent turn. Every tool and handler is try/catch-wrapped.
3. **Zero-config + zero extra requests.** The extension works out of the box with all defaults. The nudges ride inferences that were already happening — they add no model requests.

---

## 8. Known Limitations

Mulligan is deliberately minimal. These are the four things it deliberately does **not** do in v1.

- **Compaction leak (`spec/08-edge-cases.md` E7).** Pi's auto-compaction may summarize a span that included a Mulligan-hidden message, producing a transient "leak" via the summary until the next compaction settles. v1 accepts this as bounded and transient — and Mulligan *reducing* context makes compaction fire later and over less-important content. There is no v1 mitigation.
- **No general undo (`spec/SPEC.md` §9 D6; softened by `spec/08-edge-cases.md` E21).** Agent-initiated rewinds and shrinks persist across reload and `/resume`, and there is no un-rewind that *replays* hidden content or *reverses* on-disk side effects — a human who wants to explore hidden content uses Pi's native `/tree`. Working-tree **file content** is now *conditionally* reversible on opt-in via v1.2 (see [§5](#5-working-tree-revert-v12-opt-in)); **non-filesystem** effects (bash network/DB/git refs, the git index) and the **session-tree view** still persist. One safety valve now exists: a mis-targeted marker is **retractable** via `mulligan_cancel`, which stops the transform applying from the next turn on (the marker stays on disk for the audit trail). This softens D6 for marker mistakes; it does not make rewinds/shrinks generally reversible.
- **No hard retry / replay (`spec/SPEC.md` §9 D1).** Mulligan supports *soft* retry only (rewind + note + re-plan). Hidden tool calls' **side effects persist on disk** (files written, commands run); replaying them would compound those effects (a duplicate commit, a double `mkdir`). File **writes** are *conditionally* reversible on opt-in (v1.2 [§5](#5-working-tree-revert-v12-opt-in) restores working-tree file content); **non-filesystem** bash effects (network/DB/processes) and **git ref/history mutations** still persist and are NOT reverted. The mutation warning and the note's `true_current_state` / auto-appended file ledger are the safeguards.
- **Markers accumulate (`spec/08-edge-cases.md` E15).** v1 does no marker garbage-collection — markers persist intentionally (they are the audit trail). `rewind.maxDepth=5` bounds simultaneous *active* rewind markers; the only cost is disk growth (markers are control state, not in context). The filter is cheap in practice (few markers × messages bounded by compaction). Two hard backstops guard against runaway same-prompt retry loops (`spec/08-edge-cases.md` E22): a per-prompt retry budget (`rewind.maxRetriesPerPrompt`) and a context-fraction stop (`rewind.abortContextFraction`) that refuse a rewind *before* it can drive the context to a provider 'Prompt too long' rejection.

### Resolved bugs (BUG-001–BUG-005)

A post-v1.0 validation pass found and fixed five edge-case bugs (1 Major, 4 Minor; 0 Critical, 0 data-loss). These are **resolved** corrections to shipped behavior, listed separately from the ongoing limitations above. All five have regression tests; see VERIFICATION.md "Bug-fix remediation pass" for the full engineering record (root cause, fix, test) and the post-fix test count.

- **BUG-001 (Major)** — consuming a checkpoint via `mulligan_rewind` now clears **all** concurrently-labeled targets (previously cleared only the first).
- **BUG-002 / BUG-003 (Minor)** — config integer validation now floors fractional knobs (`driftWindowTurns`, `shrink.maxActive`, `shrink.staleAfterFires`) to a minimum of 1.
- **BUG-004 (Minor)** — `mulligan_shrink` `by_content_includes` with an empty substring now matches nothing (returns null).
- **BUG-005 (Minor)** — `mulligan_audit` now refuses when `enabled: false` (stays read-only).

### Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)

A second validation pass (v1.1) found and fixed four more edge-case bugs (2 Major, 2 Minor; 0 Critical, 0 data-loss) in the nudge / audit / guard layers. These are **resolved** corrections to shipped behavior, listed separately from the prior round above (the bug numbers below are THIS round's numbering and are distinct from the "BUG-001–BUG-005" round). All four have regression tests; see VERIFICATION.md "Bug-fix remediation pass — round 2" for the full engineering record.

- **BUG-001 (Major)** — `driftThresholdTokens` default (4000) and the `shouldNudge` comparison (`>=`, not `>`) are reconciled with spec/07 §5.1 acceptance criterion (b): three ~4k turns in a row now fire the drift nudge (previously the strict-`>` + 6000 default failed to fire).
- **BUG-002 (Major)** — the §5.2 high-water nudge is now **awareness-only** (`Context is at ~<pct>% of the window; review recent output for reclaimable space.`) and no longer prescribes `mulligan_rewind`/`mulligan_shrink`, since the signal fires on user-attributable content the agent cannot legitimately shed (D10).
- **BUG-003 (Minor)** — the `mulligan_audit` "Active markers" checkpoint clause now appends ` (user-set)` and singularizes the count (spec/13 §4 step 3), so the human sees exactly what they have armed.
- **BUG-004 (Minor)** — the rewind depth guard (`rewind.maxDepth`) now counts only **active** markers, excluding those retired by `mulligan_cancel` (spec/05 §1 step 4 "count active"), so the cancel-then-retry workflow is no longer blocked at 5 cumulative rewinds.

---

## 9. License

**MIT** (per `spec/SPEC.md`). The MIT text is in the top-level [`LICENSE`](./LICENSE) file.

---

## Further reading

The `spec/` directory is the deep-detail reference. Start with `spec/SPEC.md` (the master document: PRD + architecture), then the companion sections:

- `spec/05-tools.md` — the four agent tools' full specification.
- `spec/06-context-filter.md` — the context-event view transform.
- `spec/09-configuration.md` — the configuration surface + coercion rules.
- `spec/08-edge-cases.md` — edge cases (E7 compaction leak, E14 master switch, E15 markers).
- `spec/13-human-commands.md` — the three human commands + active-checkpoint banner.
- `spec/14-working-tree-revert.md` — the v1.2 working-tree-revert feature (opt-in file restoration, snapshot backends, git-safety, dirty guard).