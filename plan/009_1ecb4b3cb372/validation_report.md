# pi-mulligan — Validation Report

**Repo:** `pi-mulligan` (branch `state-reset`, spec v1.2) · **Pi:** `0.84.1` · **Date:** 2026-08-13

---

## 1. Executive summary

`pi-mulligan` gives a Pi coding agent autonomous, token-cheap control over its context window
(rewind / shrink / cancel / audit) plus an opt-in **working-tree-revert** feature (v1.2) and a
narrow human slash-command surface (v1.1).

**The CORE features are correct and production-ready.** All deterministic gates pass:

| Gate | Command | Result |
|---|---|---|
| Type checking (strict) | `npm run typecheck` | ✅ PASS — 0 errors |
| Unit + integration tests | `npm test` (vitest) | ✅ PASS — **1398 / 1398 tests, 31 files** |
| Real-Pi context-filter smoke | `npm run smoke` | ✅ PASS — **14 / 14 scenarios** |
| Spec invariants (static) | grep / source checks | ✅ PASS — nudge never persisted; forbidden-root enforced |

**Two MAJOR defects were found in the v1.2 working-tree-revert feature** (the headline of the
latest PRD amendment, D11 / spec/14). Both are **silent failures that make file-revert do
nothing in real usage**, and neither is caught by the 1398-test suite (which exercises the store
with an explicit `storageDir` and fires `turn_start` exactly once) nor by the smoke harness
(which has no revert scenario). They were uncovered only by driving the **complete** README §5
user workflow through a real `pi` process (a new E2E in `validate.sh`, Phase 5).

| # | Severity | Surface | One-line |
|---|---|---|---|
| **1** | **major** | v1.2 revert — default config | `index.ts` never passes `sessionDir` to `detectAndCreate`; with the documented default config (`revert.enabled:true` only) the store always becomes `NoOpStore`, so revert is silently skipped ("no working-tree snapshot"). Affects git **and** non-git. |
| **2** | **major** | v1.2 revert — real-Pi timing | `turn_start` fires **once per inference** in a real Pi session; each capture overwrites the same `"turn"` snapshot, so by the time a mid-loop `mulligan_rewind(revert_file_changes)` runs the snapshot holds the *post-mutation* state → `restore` reverts **0 files**. |

The defects are confined to the opt-in revert feature (default **off**); they do not affect the
core rewind/shrink/cancel/audit/nudge/banner tools, do not corrupt data, and do not break the
agent loop (revert is fail-open, so the context rewind still happens — only the file restore is a
silent no-op).

---

## 2. Issue tracker

### Issue #1 — Default-config working-tree revert is silently disabled: `sessionDir` never threaded into `detectAndCreate` *(major)*

**Where:** `src/index.ts:138` (session_start handler).

**Symptom (reproduced deterministically).** With exactly the config README §5 documents
(`{ "mulligan": { "revert": { "enabled": true, "allowDeleteCreatedFiles": true } } }` — no
`storageDir`), a real Pi run that writes a file then calls
`mulligan_rewind(granularity:"last_turn", revert_file_changes:true)` produces:

```
rewound last_turn. 2 messages will be hidden … Note left.
(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted) …
```

The file is **not** restored; no shadow repo is ever created on disk.

**Root cause.** `index.ts` creates the store with only two arguments:

```ts
rt.store = await detectAndCreate(ctx.cwd, getConfig().revert);   // ← no sessionDir
```

`detectAndCreate`'s third param (`sessionDir`) is therefore `undefined`. In a git workspace it
constructs `new GitBackend(root, revertConfig, undefined)`. The constructor
(`src/snapshot/git.ts:260-265`) resolves its storage dir as:

```ts
if (revertConfig.storageDir) {              // null (default) → false
  this.storageDir = resolve(revertConfig.storageDir);
} else if (sessionDir) {                    // undefined → false
  this.storageDir = resolve(sessionDir, "mulligan");
} else {
  throw new Error("… no storage dir and no session dir …");   // ← reached
}
```

The throw is caught by `detectAndCreate`'s outer fail-open `try/catch` → it returns a
`NoOpStore` (backend `"none"`). `turnStartCaptureHandler` then short-circuits at
`if (backend === "none") return;`, so **no snapshot is ever captured**, and every rewind reports
"no working-tree snapshot for this boundary".

The non-git (CAS) path is identical in effect: `detectAndCreate`'s CAS branch calls
`resolveStorageDir(storageDir=null, sessionDir=undefined, root)`, which throws
`"no storage dir configured and no session dir provided"` → `NoOpStore`.

`ctx.sessionManager.getSessionDir()` is available and would fix it (it resolves to the session
directory under `~/.pi/agent/sessions/`, which is outside `cwd`), but it is never passed.

**Impact.** The feature documented in README §5 ("Set `config.revert.enabled: true` … the master
switch") is **non-functional out of the box**. A user who enables it as documented gets a silently
inert feature. It only works if the user *also* sets `revert.storageDir` to an explicit path —
which the README does not require and whose default (`null` → `<sessionDir>/mulligan/`) is the
documented, intended behavior.

**Why the test suite misses it.** Every revert integration test sets `storageDir` explicitly
(`test/integration/revert-git.test.ts:376`:
`setConfig({ revert: { enabled: true, storageDir } })`), so the constructor always takes the
first branch and never reaches the throw. No test drives `detectAndCreate` with the default
`storageDir: null` config and an absent `sessionDir`.

**Reproduction:** `./validate.sh` Phase 5a (default config). Expected-to-pass assertion (file
restored) FAILS.

**Suggested fix (for the implementer):** pass the session dir at the call site —
`detectAndCreate(ctx.cwd, getConfig().revert, ctx.sessionManager.getSessionDir())` — and/or have
`detectAndCreate`/the GitBackend constructor `mkdir -p` a default `<sessionDir>/mulligan/` (the
CAS branch already does `mkdir -p`; the git branch does not, so even a passed `sessionDir` leaves
`git init --bare` failing if the dir does not yet exist — see Issue #1b note below).

> **Issue #1b (related, minor).** Even when `storageDir` *is* set explicitly, `GitBackend.ensureInit`
> runs `git init --bare` with `GIT_DIR = <storageDir>/<key>` but never `mkdir -p`s the
> `storageDir` parent. If the configured `storageDir` does not already exist, `git init --bare`
> fails (`fatal: Invalid path …: No such file or directory`) — reproduced in the investigation.
> The CAS branch creates the dir; the git branch should too.

---

### Issue #2 — `turn_start` fires per-inference in real Pi, overwriting the pre-span snapshot → revert captures the post-mutation state *(major)*

**Where:** `src/capture.ts` (`turnStartCaptureHandler`) + the rewind tool's revert resolution
(`src/tools/rewind.ts` step 6b).

**Symptom (reproduced deterministically).** Even with a valid explicit `storageDir` (bypassing
Issue #1), driving the real workflow — *write a file in one step, then rewind with
`revert_file_changes:true` in the next* — leaves the file **un-restored**:

```
5b explicit-storageDir: file1.txt now = AGENT-MUTATED (store dir: /tmp/tmp.…)
FAIL 5b explicit-storageDir revert — file NOT restored
```

The rewind result reads `Reverted 0 file(s), deleted 0; 0 skipped/failed, 0 refused` — i.e. the
restore **ran** (a snapshot existed) but found **0 differences**.

**Root cause.** Pi fires `turn_start` once **per inference cycle** within the agent loop, not once
per user message. (The installed type def says `TurnStartEvent` = *"Fired at the start of each
turn"*; spec/01 §6 defines a *"turn = one model inference + its tools"*; `agent_start`/`agent_end`
are the per-user-message boundaries.) An instrumented real run for a single `-p` prompt logged
**three** `turn_start` events:

```
turn_start #1: file1.txt = "original content line1"   ← capture the original (good)
[inference 1 → model writes file1.txt = AGENT-MUTATED]
turn_start #2: file1.txt = "AGENT-MUTATED"             ← re-capture, OVERWRITES the snapshot
[inference 2 → model calls mulligan_rewind]
turn_start #3: file1.txt = "AGENT-MUTATED"
```

`turnStartCaptureHandler` stores each capture under the **same key**
`rt.snapshots.set("turn", { beforeRef, … })`, so turn #2's capture (the mutated tree) replaces
turn #1's (the original). When the rewind runs in inference 2, `rt.snapshots.get("turn")` returns
the **post-mutation** `beforeRef`. `store.restore` then `read-tree`s that mutated tree and
`git diff`s the working tree against itself → 0 files → "Reverted 0".

**This is the canonical real-world workflow** (mutate, *then* decide it was wrong and rewind) —
it spans two inferences, so the snapshot is always stale by the time the rewind fires. The
single-inference "write and rewind in the same assistant message" case is unrealistic (the model
cannot know to rewind until it sees the write result).

**Impact.** Even with Issue #1 fixed, the working-tree-revert feature reverts **0 files** in the
common multi-inference mutate-then-rewind workflow. The feature is silently non-functional.

**Why the test suite misses it.** The integration tests fire `turnStartCaptureHandler` **exactly
once** by hand (e.g. `revert-git.test.ts:409`) and then mutate + rewind — they never model the
real per-inference `turn_start` cadence. The smoke harness has no revert scenarios at all. So no
existing test reproduces the overwrite.

**Suggested fix (for the implementer):** capture the per-user-message "before" state on
`agent_start` / `before_agent_start` (which fire once per user message) instead of — or in
addition to — `turn_start`; or gate the `turn_start` capture so it does not overwrite an
in-progress `"turn"` snapshot for the current agent loop (e.g. only capture on the first
`turn_start` after an `agent_start`, keyed by the agent-loop boundary).

**Reproduction:** `./validate.sh` Phase 5b (explicit storageDir). Expected-to-pass assertion
(file restored) FAILS.

---

## 3. What was verified (besides the two issues)

**Core features — all green, end-to-end through a real Pi process:**
- The `context`-filter rewind (permanent soft-delete via pinned entry IDs), `mulligan_shrink`
  (view substitution + `<context-shrunk>` stamp), `mulligan_cancel` (marker retraction),
  `mulligan_audit` (filtered-view token accounting), the `tool_result` bloat nudge (Nudge A) and
  the `turn_end`→`context` drift nudge (Nudge B), the v1.1 consent model / guardrail, the three
  human slash commands, and the active-checkpoint banner — all wired in `index.ts` and verified
  by the 14/14 smoke scenarios (real `pi` runs).
- The rewind→filter→auto-continue loop works (a second assistant message is produced after a
  rewind with no resume code).
- `mulligan:nudge` is provably never persisted (asserted against a smoke session JSONL).
- Token accounting uses the filtered view, never `getContextUsage()` (D5).
- E22 runaway-loop backstops present (`maxDepth`, `maxRetriesPerPrompt`, `abortContextFraction`).

**v1.2 revert — the safety surfaces are correct (the bugs are lifecycle/timing, not safety):**
- `GitBackend`/`CasBackend.restore()` each re-check `isForbiddenRoot(this.cwd)` at entry and
  refuse with zero filesystem mutation (spec/14 §2 SAFETY INVARIANT).
- `detectAndCreate` uses lexical `existsSync('.git')` with **no upward git discovery**; workspace
  root is always `realpath(cwd)`. The subdir-not-promoted safety property holds.
- The git integration test asserts the user's `.git` is **byte-identical** before vs after a full
  capture→mutate→rewind sequence (git-safety guarantee #2) — passes.
- Dirty guard, caps, and the OVERSIZE-DELETE (BUG-001) guard are implemented and unit-tested.
- The store's capture/restore *logic* is correct in isolation (integration tests pass when
  `turn_start` is fired once and `storageDir` is set) — the defects are purely in how the
  production wiring feeds it (missing `sessionDir`) and in the real-Pi event cadence
  (per-inference `turn_start`).

**No code-smell debt:** `tsc --noEmit` is clean; no `TODO`/`FIXME`/`@ts-ignore` left in `src/`.

---

## 4. Why these slipped through

The project has an unusually strong test suite (1398 tests incl. real-git integration). The two
defects survive because the revert E2E is **the one place the tests stop short of a real Pi
process**:

- The revert integration tests construct the store directly (`detectAndCreate(repoDir, cfg)`)
  with an explicit `storageDir`, and fire `turn_start` / `agent_end` **manually, once**. They
  verify the store + rewind tool in isolation, but not the production wiring in `index.ts`
  (which omits `sessionDir`) nor Pi's real per-inference `turn_start` cadence.
- The smoke harness (`run-smoke.mjs`) drives real Pi but covers only the **context-filter**
  features; it has **no** revert scenario (the PRD's `F-revert-*` scenarios from spec/10 §2.1 are
  implemented as vitest integration tests, not real-Pi smoke).

So the exact seam where `index.ts`'s production call site meets Pi's real event timing is
untested. `validate.sh` Phase 5 closes that seam.

---

## 5. Conclusion

The `pi-mulligan` core (rewind / shrink / cancel / audit / nudges / commands / banner) is correct,
complete against the PRD, and verified end-to-end through real Pi (14/14 smoke, 1398 tests,
clean typecheck). The v1.2 **working-tree-revert** feature has two major defects that together
make it silently non-functional in real usage: the default-config store is always a no-op
(missing `sessionDir`), and even with a valid store the per-inference `turn_start` overwrites the
pre-span snapshot so revert restores 0 files. Both are reproduced by `./validate.sh` Phase 5 and
are absent from the existing suite only because no test drives revert through a real Pi process.
The defects are confined to the opt-in (default-off) revert feature; core behavior and all
safety guarantees are unaffected.