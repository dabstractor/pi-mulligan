# Research Findings — P1.M3.T1.S2 (Register tool_call hook + thread explicitPaths + clear accumulator)

## The decisive finding: naive threading does NOT fix BUG-003

The item title + CONTRACT point 1 describe the *naive* fix: pass `rt.pendingExplicitPaths` as the
2nd arg to both `capture("turn")` and `capture("turn-after")`. **Verified against source that this is
insufficient** — the before-state is structurally lost:

- `turnStartCaptureHandler` runs at turn_start → `capture("turn")`. At this moment NO tool has run yet,
  so `rt.pendingExplicitPaths` is EMPTY (`[]`). `captureExplicitPaths("turn", [])` iterates `[]` and
  writes a manifest with an EMPTY `files` map (`src/snapshot/cas.ts:465` `for (const rel of explicitPaths ?? [])`).
- The tool_call hooks fire DURING the turn and accumulate paths — but capture("turn") already ran.
- `restore(beforeRef)` (`src/snapshot/cas.ts:743`) iterates `manifest.files` — an EMPTY map ⇒ reverts/
  deletes NOTHING (`reverted:[], deleted:[]`). **BUG-003 stays unfixed.**

The pre-write content of a written file is observable ONLY inside the tool_call hook (before the tool
mutates the disk). Therefore the hook MUST capture the pre-write state itself. The item description's
analysis + OUTPUT (`src/snapshot/cas.ts with appendExplicitPath method`) is the correct path; the
naive CONTRACT wording is the superseded first draft.

## Why appendExplicitPath (capturing at tool_call time) DOES fix it

Verified the restore contract in `src/snapshot/cas.ts:743-830`:
- For each `manifest.files[rel]`: `existed:true` + `revertFileChanges` ⇒ `readBlob(hash)` + write back
  (REVERT to pre-span content). `existed:false` + `deleteCreatedFiles` ⇒ `unlink` (DELETE created file).

So if the `turn` beforeRef manifest contains, per written path, the PRE-WRITE snapshot captured at
tool_call time, restore reverts/deletes correctly. `appendExplicitPath("turn", path)` builds that
manifest incrementally (one append per write/edit hook fire). Pre-write capture is race-safe because:

> **spec/14 §4.2 line 127**: "Pi preflights sibling `tool_call`s sequentially then runs them
> concurrently; the mutex makes capture/restore race-free regardless." + capture.ts JSDoc:
> "ASYNC (Pi awaits event handlers; awaits store.gc()/capture())".

⇒ Pi AWAITS each tool_call hook (preflight) BEFORE running the tool. So `appendExplicitPath` reads the
file's CURRENT (still pre-write) content. Correct.

## Double-write correctness (first-write-wins)

If a path is written twice in one turn: write-1 hook captures pre-turn state; write-2 hook fires before
write-2 with write-1's content already on disk. `appendExplicitPath` MUST NOT overwrite an existing
entry — `if (path in files) return;` (idempotent per label+path). First capture holds the true pre-turn
state. (Mirrors `captureExplicitPaths`'s `seen`-Set dedupe at cas.ts:466.)

## Key source facts (all verified)

- `CasBackend.capture(label, explicitPaths?)` — cas.ts:551. In explicit-paths mode delegates to private
  `captureExplicitPaths(label, explicitPaths)` (cas.ts:457). Whole-tree walk IGNORES the 2nd param.
- Per-file capture logic to mirror in appendExplicitPath (cas.ts:465-511): dangerous-path skip
  (`isDangerousWorkspaceRel`); `resolveSafeWorkspacePath` (escape throws → propagate); `stat` ENOENT ⇒
  `{hash:"",size:0,mtime:0,existed:false}`; oversize (`> maxFileBytes`) ⇒ skip+warn; else
  `readFile`→`hashContent`→`storeBlob`(deduped)⇒`{hash,size,mtime,existed:true}`.
- Manifest shape: `{version:1, label, turnIndex:0, ts, files: Record<rel, CasManifestEntry>}`.
  `manifestPath(label)` = `<storageDir>/manifests/<label>.json`. `serializeManifest`/`parseManifest` (cas.ts:139/152).
- `AsyncMutex` field `this.mutex` (cas.ts:229) — appendExplicitPath MUST acquire it (spec §4.3: ALL store
  ops serialized). capture/dirtyCheck/restore all `await this.mutex.acquire()` … `finally release()`.
- Helpers (all PUBLIC or accessible in-class): `hashContent`, `storeBlob`, `readBlob`, `manifestPath`
  (private), `resolveSafeWorkspacePath`/`isDangerousWorkspaceRel` (imported).
- `SnapshotStore.capture(label)` interface is **1-param** (store.ts:80) + `GitBackend.capture(label)` is
  **1-param** (git.ts:23). ⇒ passing the 2nd arg requires `rt.store as CasBackend` cast (CasBackend-specific
  widening, like S1's notifyBashUsed cast). Use a `backend === "cas"` conditional to keep it type-honest.

## index.ts step 5 (the registration site) — src/index.ts:108-113

```
registerTurnStartCapture(pi);   // pi.on("turn_start", …)
registerAgentEndCapture(pi);    // pi.on("agent_end", …)
```
Add `registerToolCallCapture(pi);` here (import from "./capture.js"). Each is an unconditional
`pi.on(...)`; the gate lives INSIDE the handler (free when revert off).

## capture.ts shape after S1 (the S2 edit targets)

- S1 added: `import type { CasBackend } from "./snapshot/cas.js";` (for the notifyBashUsed cast) — S2 REUSES it.
- S1 added `toolCallCaptureHandler` (write/edit → push path; bash → notifyBashUsed) + `registerToolCallCapture`.
- `turnStartCaptureHandler` (capture.ts:155): `if(!rt.store)return; → gcTurnSnapshots(rt) → backend!=="none" → capture("turn")`. S2 inserts `rt.pendingExplicitPaths = [];` (clear) before capture.
- `agentEndCaptureHandler` (capture.ts:227): `capture("turn-after")`. S2 threads `rt.pendingExplicitPaths` for cas.

## Related gap noted (OUT OF SCOPE — do NOT fix here)

`capturesThisTurn` (cas.ts:233) + `bashWarnedThisTurn` (cas.ts:236) are commented "Reset by lifecycle P3
at the turn boundary" but are NEVER reset anywhere (grep confirms only increment/check sites). This is a
pre-existing cross-backend (git.ts:219 too) latent bug → `maxSnapshotsPerTurn` (default 64) accumulates
across turns. NOT BUG-003. To avoid worsening it: **appendExplicitPath MUST NOT increment
capturesThisTurn** (it appends to an existing manifest, it is not a new snapshot). Reset belongs to a
BUG-006-class turn-boundary task. Documented as a residual risk.

## config defaults (src/config.ts:208,212)

- `nonGitMode: "cas"` (default; explicit-paths is opt-in).
- `maxSnapshotsPerTurn: 64`.