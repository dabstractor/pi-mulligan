# Research Findings — P1.M3.T1.S3: Explicit-Paths Integration Test

## The Gap S3 Closes

`test/integration/revert-cas.test.ts` ALREADY contains an `F-revert-explicit` `it()` block (~lines
where the comment says "CRITICAL #1 — there is NO `pi.on('tool_call',…)` hook... F-revert-explicit
drives capture DIRECTLY"). That test was written BEFORE S1+S2 landed: it bypasses the hooks entirely
and calls `cb.capture("turn", ["a.ts","b.ts"])` + `cb.capture("turn-after", [...])` directly, sets
`rt.snapshots` manually, and calls `cb.notifyBashUsed()` directly. It explicitly simulates the
(unwired) tool_call hook.

**S1+S2 make that workaround OBSOLETE.** S3's deliverable is the REAL end-to-end test that exercises
the actual hook chain (`turnStartCaptureHandler` → `toolCallCaptureHandler` → `appendExplicitPath`
→ `agentEndCaptureHandler` → restore), proving BUG-003 is fixed in production code paths, not just
in a direct-drive simulation.

## The Real Hook Chain (post S1+S2 — the CONTRACT S3 consumes)

1. **`turnStartCaptureHandler`** (src/capture.ts, S2-enhanced): runs `gcTurnSnapshots`, sets
   `rt.pendingExplicitPaths = []` (clear), then `rt.store.capture("turn")` → an EMPTY placeholder
   manifest (the hooks append to it during the turn). Stores `rt.snapshots["turn"] = {beforeRef:"turn"}`.
2. **`toolCallCaptureHandler(event, ctx)`** (src/capture.ts, exported; S1+S2-enhanced). Gates:
   config.revert.enabled → rt.store → backend==="cas" → nonGitMode==="explicit-paths". Then:
   - `write`/`edit`: pushes `event.input.path` into `rt.pendingExplicitPaths` AND calls
     `await (rt.store as CasBackend).appendExplicitPath("turn", path)` → captures the file's
     PRE-write state (current bytes → hash+storeBlob → manifest entry `{hash,size,mtime,existed:true}`;
     ENOENT → `{existed:false}`). **This is the KEY mechanism** — pre-write capture at tool_call time.
   - `bash`: calls `(rt.store as CasBackend).notifyBashUsed()` → once-per-turn console.warn.
3. **`agentEndCaptureHandler`** (src/capture.ts, S2-enhanced): for cas backend →
   `(rt.store as CasBackend).capture("turn-after", rt.pendingExplicitPaths ?? [])`; mutates the
   existing `rt.snapshots["turn"].afterRef` in place.
4. **restore** (src/snapshot/cas.ts:743): iterates the `beforeRef` manifest.files; `existed:true` +
   `revertFileChanges` → readBlob(hash)+writeFile (REVERT); `existed:false` + deleteCreatedFiles →
   unlink (DELETE). Paths NOT in the manifest are NOT touched (the explicit-paths guarantee).

## ToolCallEvent Shape (from test/capture.test.ts `makeToolCallEvent`)

```ts
{ type: "tool_call", toolCallId: "tc1", toolName: "write", input: { path: "a.ts" } }
```
- The field is `input.path` (NOT `file_path` — that's the ledger's message-args field name).
- `event.toolName === "write"` is runtime-valid but does NOT narrow `event.input` in TS → the
  production handler casts `(event.input as {path?:string}).path`. In the TEST, build the event
  with the literal shape above (cast `as ToolCallEvent`).

## RestoreResult / RestoreOpts (src/snapshot/store.ts)

```ts
interface RestoreOpts  { revertFileChanges: boolean; deleteCreatedFiles: boolean; }
interface RestoreResult { reverted:string[]; deleted:string[]; failed:string[]; skipped:string[]; refused:string[]; }
```
- All path arrays are workspace-relative POSIX.
- restore NEVER throws (E27); per-path failures → `failed[]`.

## CRITICAL GOTCHA — Dirty-Guard False-Refuse on Bash Paths (BUG-004, NOT S3's concern)

- The rewind tool (src/tools/rewind.ts:849) sets `affectedPaths = ledger.modifiedFiles`.
- The ledger's bash high-precision parser extracts `c.ts` from `sed -i ... c.ts` into `modifiedFiles`
  (sed ∈ FILE_MUTATING_COMMANDS).
- `dirtyCheck(afterRef, affectedPaths)` (src/snapshot/cas.ts:663): for `c.ts`, if it exists now AND
  has no entry in the afterRef manifest → **DIRTY** ("exists now, no afterRef baseline ⇒ dirty
  (conservative)").
- In the REAL hook flow, `pendingExplicitPaths` holds ONLY write/edit paths → the afterRef manifest
  has NO `c.ts` entry.
- ∴ A combined write+edit+bash-sed scenario routed through the rewind tool → the dirty guard
  REFUSES (c.ts "dirty") → restore is skipped. This is BUG-004 (P1.M4.T2 — dirty-guard affected set),
  a SEPARATE work item. **S3 must NOT try to make that combined scenario pass the dirty guard.**

**RESOLUTION for S3**: isolate concerns.
- Scenario A (write/edit reverted): exercise the REAL hooks + the REAL rewind tool, NO bash in the
  turn → dirty guard is clean (afterRef has exactly the write/edit paths; hashes match → not dirty).
- Scenario B (bash sed NOT reverted + warned): exercise the REAL hooks, then call `store.restore`
  DIRECTLY (bypassing the rewind tool's dirty guard) and assert `RestoreResult.reverted` excludes
  c.ts and c.ts is unchanged. Assert the warning fires via the REAL `toolCallCaptureHandler(bash)`
  (which calls `notifyBashUsed`).

## Test Infrastructure (reuse VERBATIM from test/integration/revert-cas.test.ts)

- vitest: `describe/it/expect/beforeEach/afterEach/vi`.
- node:fs `mkdtempSync/rmSync/writeFileSync/readFileSync/existsSync`; node:os `tmpdir`; node:path `join`;
  `execFile` promisified from node:child_process.
- `makeNonGitDir(prefix)` = `mkdtempSync(join(tmpdir(), prefix))` (NO `git init`).
- `makeStorage()` = SEPARATE temp dir for snapshot storage (MUST NOT be inside cwd/repoDir —
  store.ts resolveStorageDir containment guard rejects it → NoOpStore backend "none").
- `sed(path, expr)` + `sedAvailable()` guard (skip scenario if sed not on PATH).
- `setConfig({revert:{enabled:true, nonGitMode:"explicit-paths", storageDir}})` (the FULL revert block
  merges over DEFAULT_CONFIG — CRITICAL #8: setConfig(undefined) resets).
- `detectAndCreate(repoDir, getConfig().revert)` → CasBackend; `getRuntime(sid)`; **`rt.store = store`
  BEFORE any capture call** (the hooks self-gate on rt.store).
- `.js` import paths (ESM compiled). `clearAll()` + `setConfig(undefined)` before/after each; rm
  temp dirs in afterEach.
- For the rewind-tool scenario: `makePi()`/`makeCtx()` fakes (hand-rolled, NO vi.fn()); contextEntries
  via `msgEntry`/`user`/`asstWrite`/`asstEdit`/`asstBash`/`result`; `run(pi, ctx, {note, granularity:
  "last_turn", revert_file_changes:true}, "final")`; `firstText(res)`; `rewindMarker(appended)`.
- For the store.restore-direct scenario: no fakes needed — call `(store as CasBackend).restore(...)`
  directly.

## Validation Commands (VERIFIED in package.json)

- `npm test` → `vitest run` (runs ALL tests including test/integration/*.test.ts — no separate filter).
- `npm run typecheck` → `tsc --noEmit`.
- Targeted: `npx vitest run test/integration/revert-explicit.test.ts`.

## appendExplicitPath (S2 contract — NOT yet in current cas.ts; S3 assumes it lands)

`CasBackend.appendExplicitPath(label: string, path: string): Promise<void>` — mutex-serialized,
create-or-append to `manifestPath(label)`, idempotent per path (first-write-wins), mirrors
captureExplicitPaths per-file capture (existing → {hash,size,mtime,existed:true}+storeBlob; ENOENT →
{existed:false}). Does NOT bump capturesThisTurn. S3 does NOT call it directly — it is invoked
INSIDE `toolCallCaptureHandler` (S2 wired it). S3 exercises it transitively via the real hook.

## index.ts Registration Status (confirming S2 is the gating dependency)

- index.ts:90 `registerTurnStartCapture(pi)`, index.ts:92 `registerAgentEndCapture(pi)`.
- `registerToolCallCapture(pi)` is NOT YET called in index.ts (grep confirms) — that's S2's contract
  (index.ts step 5). S3 assumes S2 lands this. BUT S3's test calls `toolCallCaptureHandler` DIRECTLY
  (not via pi.on), so S3 does NOT depend on index.ts registration — it depends only on the handler +
  appendExplicitPath existing (capture.ts + cas.ts). This makes S3 robust even pre-registration.