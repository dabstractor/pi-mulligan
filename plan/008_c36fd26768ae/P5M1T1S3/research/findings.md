# Research Findings — P5.M1.T1.S3 (F-revert-granularity + F-revert-reload)

Two integration scenarios in `test/integration/revert-edge.test.ts`. Test-only (no source changes).
The PRP distills these into copy-ready task specs.

---

## FINDING 1 — F-revert-granularity is the SIMPLE scenario (no store, no checkpoint)

`src/tools/rewind.ts` step 6b branch order (LOAD-BEARING):
```ts
const wantRevert = !!params.revert_file_changes || !!params.delete_created_files;
if (wantRevert) {
  try {
    if (!config.revert.enabled) { revertClause = "(file revert requested but disabled in config)"; }
    else if (granularity === "last_tool_call_group") {
      revertClause = "File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.";
    } else { /* branch (4)+(5)+(6): resolve checkpoint + dirtyCheck + store.restore */ }
  } catch { ... }
}
```

- The granularity check (branch 3) is BEFORE the store/checkpoint resolution (branch 4). So with `config.revert.enabled:true` + `granularity:"last_tool_call_group"` + `revert_file_changes:true` → branch (3) fires.
- `store.restore` is NEVER called. `revertBlock` stays `undefined`. The revertClause notice rides the success TEXT (`successText` does `text += " " + revertClause`).
- The context rewind STILL completes: the marker is persisted (step 7) + the note left (step 6) + success returned (step 9).
- **Assertions**: `firstText(res)` contains `"File revert applies to last_turn/checkpoint granularity"`; the mutated file is UNCHANGED on disk (revert ignored); a `mulligan:rewind` marker is in `pi.appended` (context rewind happened); `marker.data.revert === undefined`.
- **No store, no checkpoint, no temp git repo needed.** A plain non-git temp dir with one mutated file suffices to prove "revert IGNORED".

---

## FINDING 2 (CRITICAL) — the reload re-read is NOT implemented in production

- `src/commands.ts` step 4b (makeCheckpointCommand, ~line 213) WRITES the control entry:
  `pi.appendEntry("mulligan:revert-checkpoint", { label:"ckpt:"+name, ref: ckptRef, backend })`.
  Its comment CLAIMS "session_start re-reads mulligan:revert-checkpoint entries to rebuild rt.snapshots".
- **But `src/index.ts` session_start does NOT re-read them.** Verified by grep: `"revert-checkpoint"` appears ONLY in `commands.ts:226` (the write). NO reader exists in src/.
  session_start does: `resetRuntime(sid)` (fresh empty snapshots Map) → `rt.store = detectAndCreate(...)` → `gcTurnSnapshots(rt)`. The snapshots Map is left EMPTY.
- **Therefore**: after a real `/resume`, `rt.snapshots.get("ckpt:"+name)` returns `undefined` → rewind step 6b branch (4) fires ("no working-tree snapshot for this boundary — 0 files reverted"). A post-reload checkpoint revert would SKIP in production today.
- This is a documented spec/impl divergence (the read-side of E32 was never wired). It is the SAME SHAPE of divergence as S2's CRITICAL FINDING #2 (refuse branch leaves `data.revert` undefined). **The item contract ANTICIPATES it**: it says *"simulate /resume (re-read mulligan:revert-checkpoint entries + restore snapshots Map)"* — the parenthetical describes the rebuild the TEST performs as a SIMULATION.
- **What the test therefore validates**: the DATA DURABILITY contract — the control entries + on-disk refs (shadow-repo protected ref / CAS manifest) survive `resetRuntime` + `detectAndCreate` (same storage) + `gcTurnSnapshots`, and IF you rebuild the Map from the control entries (the way session_start is SPEC'd to), a post-reload `rewind-to-checkpoint with revert` still restores files. This proves E32's "refs live on disk; store still honors them" modulo the (missing, trivial) read-side glue.

---

## FINDING 3 (CRITICAL) — the checkpoint dirty-guard tension + its resolution

- Checkpoint snapshots have NO `afterRef` (commands.ts step 4b captures ONCE: `{label, backend, beforeRef, turnIndex:-1, ts}`).
- rewind.ts step 6b: `const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef;` → for a checkpoint, the dirty baseline IS `beforeRef`.
- git `dirtyCheck` (verified, `src/snapshot/git.ts`): `git diff --name-only <afterRef> -- <paths>` → returns paths where the WORKING TREE differs from `<afterRef>`. Guard: `if (!afterRef || paths.length === 0) return []` (empty paths ⇒ no drift ⇒ ALLOW).
- **Tension**: a checkpoint rewind whose resolved span mutated files ⇒ `ledger.modifiedFiles` non-empty ⇒ `dirtyCheck(beforeRef, [mutated])` ⇒ working tree ≠ beforeRef ⇒ REFUSE. So a checkpoint revert of agent-mutated files would ALWAYS refuse in this implementation.
- **Resolution for F-revert-reload**: the post-reload checkpoint-rewind's SPAN must have **no file-mutating toolCalls** (so `ledger.modifiedFiles === []` ⇒ `affectedPaths === []` ⇒ `dirtyCheck` returns `[]` ⇒ dirty guard SKIPPED ⇒ PROCEED ⇒ `store.restore(beforeRef)` runs). The working tree IS mutated (by a direct `writeFileSync` post-reload, representing accumulated state the revert restores) ⇒ `restore(beforeRef)` restores it ⇒ `revertedFiles` populated.
- This ISOLATES the reload-durability question (what F-revert-reload tests) from the dirty-guard-refuses-on-mutated-span behavior (which is S2's F-revert-dirtyguard concern). Legitimate integration-test scoping.
- The PRE-reload "rewind with revert" (last_turn) does NOT have this tension: it has a real `afterRef` (agent_end capture) ⇒ dirty guard compares working tree vs `afterRef` (the agent's final state) ⇒ they match ⇒ PROCEED ⇒ `restore(beforeRef)` reverts to turn-start. This is the proven S1/S2 pattern.

---

## FINDING 4 — F-revert-reload needs a RICHER ctx (shared backing entries array)

- `checkpointExists(ctx, name)` (rewind.ts step 3) + `readMarkers(ctx)` (filter.ts) + `resolveCheckpoint` (transforms.ts) read `ctx.sessionManager.getEntries()` + `getLabel()`. The simpler `makeCtx` (from rewind.test.ts/revert-git.test.ts) returns `[]` from `getEntries()` + `undefined` from `getLabel()` ⇒ `checkpointExists` would be `false` ⇒ the checkpoint rewind would REFUSE at step 3.
- `setCheckpoint(pi, ctx, name)` (markers.ts) walks `ctx.sessionManager.getBranch()` BACKWARDS to the last `message` entry with a real role ⇒ the branch MUST contain a real user/assistant message for the checkpoint to anchor (else `{error:"no conversation message to checkpoint"}` ⇒ step 4b never runs).
- **Design**: build ONE `{pi, ctx}` pair sharing a mutable `entries` array (the "persisted JSONL"):
  - `pi.appendEntry(customType, data)` → `entries.push({type:"custom", customType, data})`.
  - `pi.setLabel(targetId, label)` → `entries.push({type:"label", targetId, label})`.
  - `ctx.sessionManager.getEntries()` → `entries`; `getBranch()` → `entries`; `buildContextEntries()` → `entries`.
  - `ctx.sessionManager.getLabel(id)` → **latest-wins scan**: walk `entries`, last `{type:"label", targetId:id}` wins; a `setLabel(id, undefined)` appends `{label:undefined}` ⇒ returns `undefined` (cleared). This is EXACTLY Pi's latest-wins label semantics (mirrors `checkpointExists`/`clearCheckpointByName`'s two-phase discovery).
  - `ctx.hasUI = false` ⇒ `notify` no-ops (commands.ts) + `reconcileBanner` returns early (banner.ts:39 `if (!ctx.hasUI) return`). Minimal ctx surface.
- On the simulated `/resume`, the `entries` array PERSISTS (it IS the persisted state); `resetRuntime` + `detectAndCreate` + `gcTurnSnapshots` + the rebuild-from-control-entries operate on runtime/store, while `getEntries`/`getLabel` naturally surface the pre-reload labels + markers (what a real /resume sees).

---

## FINDING 5 — data durability is REAL + testable (the core of E32)

- `ck pt:*` refs survive everything:
  - git: `refForLabel("ckpt:x")` → `refs/mulligan/snapshots/checkpoint/x` (git.ts:130). `gcTurnSnapshots` only deletes `refs/mulligan/snapshots/turn/*` (git.ts:588). checkpoint/* is GC-exempt.
  - cas: manifests whose filename starts with `"ckpt"` are preserved by the mark-sweep (cas.ts:950); only `turn` manifests are deleted.
- After `resetRuntime(sid)` + `rt.store = detectAndCreate(repoDir, cfg)` (NEW store, SAME storageDir), the new store reads the SAME on-disk refs/manifests ⇒ `store.has(beforeRef) === true` + `store.restore(beforeRef)` works.
- **Assertions**: post-reload, `store.has(R0) === true` (the ref survived); after the checkpoint rewind, the file content == pre-checkpoint state (`revertedFiles ⊇ ["a.ts"]`); `marker.data.revert.backend === "git"` (or "cas").

---

## FINDING 6 — git mode is the verified-safe backend choice (dirtyCheck read); gitAvailable() skip guard

- git `dirtyCheck` is read + verified: `git diff --name-only afterRef -- paths`; empty paths ⇒ `[]` ⇒ proceed (FINDING 3's resolution relies on this).
- git `restore` populates `revertedFiles` (S1's F-revert-git asserts `revertedFiles ⊇ [a.ts,b.ts,c.ts]` — consistent).
- Mirror S1 (`test/integration/revert-git.test.ts`): `gitAvailable()` skip-guard (`execFile("git",["--version"])`) ⇒ the scenario SKIPS (not fails) in environments without git. Universally present on Linux/macOS CI.
- Helpers to reuse from S1: `git(cwd,args)`, `makeRepo(prefix)` (`git init -b main`), `makeStorage()` (SEPARATE mkdtemp), `shadowKey`, `hashDir`. Plus the fakes `makePi`/`makeCtx`/`msgEntry`/`user`/`asst`/`asstWrite`/`result`/`run`/`firstText`/`VALID_NOTE` (verbatim shapes from `test/tools/rewind.test.ts`).

---

## FINDING 7 — exact seams + key strings (copy-ready)

- `makeCheckpointCommand(pi)` (commands.ts) → `{ description, handler }`; call `.handler("x", ctx)` (async). Exercises step 4b for real (capture ckpt:x + snapshots.set + appendEntry control entry + setCheckpoint label). Requires `ctx.hasUI` + `ctx.sessionManager.getSessionId/getBranch`.
- `setCheckpoint` anchors on the LAST real message in `getBranch()` (BUG-003 fix). Provide a user/assistant message in the branch.
- `mulligan:revert-checkpoint` control entry shape: `{ label:"ckpt:"+name, ref: ckptRef, backend }` (commands.ts:227). The rebuild reads these.
- The granularity mismatch notice (VERBATIM, with the em-dash): `"File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn."` (rewind.ts step 6b branch 3).
- RevertCheckpoint rebuild shape (from control entry): `{ label, backend, beforeRef: ref, turnIndex:-1, ts: Date.now() }` (mirrors commands.ts:217-223).
- `import { makeCheckpointCommand } from "../../src/commands.js"`.
- `import { gcTurnSnapshots } from "../../src/capture.js"` (exported; reused by session_start).
- `import { detectAndCreate } from "../../src/snapshot/store.js"`.
- `import { makeRewindTool, type RewindArgs, type RewindDetails } from "../../src/tools/rewind.js"`.
- `import { getRuntime, resetRuntime, clearAll } from "../../src/runtime.js"` (resetRuntime EXPORTED — used by session_start).
- `import { setConfig, getConfig } from "../../src/config.js"`.