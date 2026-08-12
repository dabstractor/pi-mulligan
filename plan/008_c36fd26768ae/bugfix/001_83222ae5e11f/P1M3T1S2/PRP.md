# PRP — P1.M3.T1.S2: Register `tool_call` hook + thread explicitPaths + clear accumulator (BUG-003)

> **Bug context**: BUG-003 (Major) — `revert.nonGitMode:"explicit-paths"` is non-functional. See
> `architecture/bug_fix_analysis.md §BUG-003`, spec/14-working-tree-revert.md §4.2.
> **Consumes S1**: S1 (`P1M3T1S1/PRP.md`) delivered `rt.pendingExplicitPaths?: string[]` (init `[]` in
> `freshRuntime`) + a dormant `toolCallCaptureHandler`/`registerToolCallCapture` (write/edit → push path;
> bash → `notifyBashUsed`). S2 makes the feature **functional**: capture the pre-write file state at
> `tool_call` time, register the hook, thread the path list into the `agent_end` capture, and clear the
> accumulator at `turn_start`.

---

## Goal

**Feature Goal**: Make `revert.nonGitMode:"explicit-paths"` actually restore `write`/`edit` files on a
`last_turn` rewind with `revert_file_changes`. The pre-write state of each written file is captured
**at `tool_call` time** (before the tool mutates the disk) into the `"turn"` beforeRef manifest via a
new `CasBackend.appendExplicitPath(label, path)`; the hook is registered; the accumulated path list is
threaded into the `agent_end` `capture("turn-after", …)`; and the accumulator is cleared at `turn_start`.

**Deliverable**:
1. `src/snapshot/cas.ts` — new **public** `appendExplicitPath(label: string, path: string): Promise<void>`
   (mutex-serialized, create-or-append, first-write-wins idempotency, mirrors `captureExplicitPaths`
   per-file capture logic, does NOT bump `capturesThisTurn`).
2. `src/capture.ts` — enhance `toolCallCaptureHandler` (S1's) to `await (rt.store as CasBackend).appendExplicitPath("turn", path)` for write/edit (alongside the S1 push); `turnStartCaptureHandler` clears `rt.pendingExplicitPaths = []`; `agentEndCaptureHandler` threads `rt.pendingExplicitPaths` into `capture("turn-after", …)` for the `cas` backend.
3. `src/index.ts` — import + call `registerToolCallCapture(pi)` in step 5 (alongside `registerTurnStartCapture`/`registerAgentEndCapture`).
4. `test/capture.test.ts` + a CAS unit-test block — component tests for the handler enhancement, the clear, the agent_end threading, the index registration, and `appendExplicitPath`.

**Success Definition**:
- `npm run typecheck` (strict `tsc --noEmit`) is clean — incl. the `as CasBackend` casts and the new method.
- `npm test` (full `vitest run`, ~1277 tests + new) is green.
- The BUG-003 repro from `architecture/bug_fix_analysis.md §BUG-003` now PASSES: non-git temp dir,
  `nonGitMode:"explicit-paths"`, `write` a.ts during a turn, `agent_end` capture, then
  `store.restore(turnSnap.beforeRef, {revertFileChanges:true})` ⇒ `reverted:["a.ts"]` and a.ts is back to
  its pre-turn content. (End-to-end integration test is S3's deliverable; S2 delivers the mechanism +
  component tests. S2's `appendExplicitPath` unit test is the proof the mechanism works.)

## Why

- BUG-003 makes a documented, user-facing config knob silently do nothing. S1 stood up the *producer*
  half (accumulate paths). S2 stands up the *capture + wire* half that makes snapshots non-empty and
  restore effective. S3 adds the end-to-end integration test.
- **The naive "pass `pendingExplicitPaths` to both `capture` calls" described in the item CONTRACT is
  provably insufficient** — at `turn_start` the accumulator is empty (no tool has run), so
  `captureExplicitPaths("turn", [])` writes an EMPTY manifest and `restore` reverts nothing. The pre-write
  content of a file is observable ONLY inside the `tool_call` hook (Pi awaits/preflights it before the
  tool runs — spec §4.2 line 127). So the hook itself must snapshot each path's current state. See
  `research/findings.md` ("The decisive finding") for the line-by-line proof against `src/snapshot/cas.ts`.

## What

### User-visible behavior
In a non-git workspace with `revert.nonGitMode:"explicit-paths"`: `write`/`edit` files mutated during a
turn become restorable on `mulligan_rewind` (`last_turn`, `revert_file_changes:true`). The first `bash`
of a turn still prints the existing once-per-turn "bash changes NOT captured" warning (unchanged from S1).
Files created during the turn (`existed:false`) are deleted on restore when `deleteCreatedFiles`+`allowDeleteCreatedFiles` are set.

### Success Criteria
- [ ] `CasBackend.appendExplicitPath(label, path)` exists, is PUBLIC, acquires `this.mutex`, and create-or-appends one `{hash,size,mtime,existed}` entry (mirroring `captureExplicitPaths`' per-file logic) to the manifest at `manifestPath(label)` WITHOUT bumping `capturesThisTurn`.
- [ ] `appendExplicitPath` is **idempotent per (label, path)** — a 2nd call for the same path is a no-op (first-write-wins preserves the true pre-turn state across a double-write turn).
- [ ] `toolCallCaptureHandler` (S1's, enhanced) calls `(rt.store as CasBackend).appendExplicitPath("turn", path)` for write/edit in cas+explicit-paths mode, **in addition to** S1's push to `rt.pendingExplicitPaths`. Ordering: push-then-await (or await-then-push — neither touches the other's concern).
- [ ] `registerToolCallCapture(pi)` is called once in `src/index.ts` step 5.
- [ ] `turnStartCaptureHandler` sets `rt.pendingExplicitPaths = [];` (clear) before `capture("turn")`. `capture("turn")` stays **argless** (writes an empty manifest placeholder that the hooks append to during the turn — see Known Gotchas).
- [ ] `agentEndCaptureHandler` threads `rt.pendingExplicitPaths` into `capture("turn-after", …)` for the `cas` backend (cast `as CasBackend`); unchanged for `git`/`none`.
- [ ] `npm run typecheck` clean; `npm test` green.

## All Needed Context

### Context Completeness Check
_Pass_: an implementer who has never seen this repo can implement S2 from this PRP alone. All file
paths, the exact methods to mirror (`captureExplicitPaths`), the manifest shape, the mutex contract, the
Pi-await guarantee, the cast requirement, the gate order, and the test fakes are specified below.

### Documentation & References
```yaml
- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M3T1S1/PRP.md
  why: "S1 CONTRACT — defines pendingExplicitPaths, toolCallCaptureHandler, registerToolCallCapture, makeCasStore fake, the gate order, the ToolCallEvent narrowing caveat, the as-CasBackend cast pattern. S2 CONSUMES these; do not duplicate S1's field/handler creation."
  pattern: "S1's handler skeleton (sessionId→revert.enabled→getRuntime→rt.store→backend==='cas'→nonGitMode==='explicit-paths'→write/edit/bash branches→fail-open catch). S2 ADDS one line in the write/edit branch (the appendExplicitPath await)."

- file: architecture/bug_fix_analysis.md
  why: "§BUG-003 — root cause + repro (capture('turn') with no explicitPaths ⇒ empty manifest ⇒ restore reverts nothing)."
  section: "## BUG-003 (Major): explicit-paths non-git mode non-functional"

- file: spec/14-working-tree-revert.md
  why: "§4.2 (explicit-paths: 'the tool-call hook reads event.input.path and snapshots that path current state before the tool runs') + line 127 AsyncMutex ('Pi preflights sibling tool_calls sequentially then runs them concurrently' ⇒ hook is awaited BEFORE the tool runs ⇒ pre-write read is race-safe). §6 restore semantics (revert existed:true / delete existed:false)."

- file: src/snapshot/cas.ts
  why: "The appendExplicitPath host. Mirror captureExplicitPaths (lines 457-535) per-file logic EXACTLY: isDangerousWorkspaceRel skip, resolveSafeWorkspacePath (escape throws), stat ENOENT ⇒ existed:false, oversize skip+warn, else readFile→hashContent→storeBlob⇒{hash,size,mtime,existed:true}. Reuse: this.mutex (acquire/release), this.fs, this.cfg.maxFileBytes, manifestPath(), serializeManifest/parseManifest, this.cwd, this.storageDir."
  gotcha: "appendExplicitPath MUST acquire this.mutex (spec §4.3 ALL store ops serialized). MUST NOT bump capturesThisTurn (it appends to an existing manifest, not a new snapshot — avoids worsening the pre-existing never-reset cap; see Known Gotchas). MUST be create-or-append (manifest may be absent if turn_start capture returned null) + idempotent per path (first-write-wins)."

- file: src/capture.ts
  why: "turnStartCaptureHandler (clear site, capture('turn') stays argless), agentEndCaptureHandler (thread site), toolCallCaptureHandler (S1 — enhance with appendExplicitPath call). S1 already added `import type { CasBackend } from './snapshot/cas.js';` — REUSE it for both casts."
  pattern: "fail-open try/catch + log('error', 'capture.<name>', sessionId, {error}) — identical to turnStart/agentEnd."

- file: src/index.ts
  why: "Step 5 (lines ~108-113) — the registration block. registerTurnStartCapture(pi)/registerAgentEndCapture(pi) sit there; add registerToolCallCapture(pi) alongside. Import it from './capture.js' (extend the existing named import)."

- file: src/runtime.ts
  why: "pendingExplicitPaths field + freshRuntime [] (S1). S2 READS+CLEARS it. No new field in S2."

- file: test/capture.test.ts
  why: "Component-test conventions (makePi/makeCtx/RecordingStore/S1's makeCasStore/setLogFile+readLogLines). S2 extends makeCasStore with an appendExplicitPath spy + adds handler-enhancement / clear / agent_end-threading tests."
```

### Current Codebase tree (relevant slice)
```bash
src/
  snapshot/cas.ts     # CasBackend: capture/captureExplicitPaths/restore/dirtyCheck/notifyBashUsed — EDIT (add appendExplicitPath)
  capture.ts          # turnStart/agentEnd/toolCall hooks + gcTurnSnapshots — EDIT (clear + thread + enhance toolCall handler)
  index.ts            # step-5 registration — EDIT (register registerToolCallCapture)
  runtime.ts          # pendingExplicitPaths (S1) — READ ONLY
  snapshot/store.ts   # SnapshotStore.capture(label) 1-param interface — READ ONLY
  config.ts           # revert.{enabled,nonGitMode} — READ ONLY
test/
  capture.test.ts     # component tests — EDIT (handler enhancement + clear + thread + register)
```

### Desired Codebase tree with files to be added/edited
```bash
src/snapshot/cas.ts   # + appendExplicitPath(label, path): Promise<void>  (PUBLIC, mutex-serialized)
src/capture.ts        # toolCallCaptureHandler: + appendExplicitPath await (write/edit); turnStartCaptureHandler: + clear; agentEndCaptureHandler: + thread for cas
src/index.ts          # step 5: + registerToolCallCapture(pi)
test/capture.test.ts  # + appendExplicitPath spy on makeCasStore; + enhancement/clear/thread/register tests
```
**No new files.** Additive edits to 3 source files + 1 test file.

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL #0 — naive threading does NOT fix BUG-003. (Proof in research/findings.md.)
// At turn_start rt.pendingExplicitPaths is [] (no tool ran yet) ⇒ captureExplicitPaths("turn", []) writes
// an EMPTY manifest ⇒ restore reverts nothing. The pre-write content is observable ONLY in the tool_call
// hook (Pi AWAITS it before the tool runs — spec §4.2 line 127: "Pi preflights sibling tool_calls
// sequentially"). So the hook MUST snapshot each path's current state via appendExplicitPath. Do NOT
// "simplify" S2 down to just passing the accumulator to capture("turn") — that regresses the bug.

// CRITICAL #1 — appendExplicitPath acquires this.mutex itself (it is a TOP-LEVEL public method, NOT run
// inside capture()'s mutex). Pattern: const release = await this.mutex.acquire(); try{…}finally{release();}
// (mirror restore()/dirtyCheck()/capture() at cas.ts:555/664/744). Forgetting release() deadlocks every
// later acquire() (AsyncMutex GOTCHA #5, cas.ts:913).

// CRITICAL #2 — appendExplicitPath must NOT bump capturesThisTurn. capturesThisTurn is the
// maxSnapshotsPerTurn counter; it is (a pre-existing latent bug: see below) NEVER reset at the turn
// boundary, so every bump inches toward the 64 cap → eventual capture starvation. appendExplicitPath
// appends to an EXISTING manifest (the "turn" placeholder turn_start wrote) — it is not a new snapshot,
// so it must not count. The turn_start capture("turn") + agent_end capture("turn-after") each bump it
// once (2/turn) — that is existing behavior, leave it.

// GOTCHA #3 — pre-existing latent bug, OUT OF SCOPE: capturesThisTurn (cas.ts:233) + bashWarnedThisTurn
// (cas.ts:236) [and git.ts:219] are commented "Reset by lifecycle P3 at the turn boundary" but are NEVER
// reset anywhere (grep confirms only increment/check sites). Do NOT fix this in S2 (cross-backend,
// BUG-006-class). Just ensure appendExplicitPath doesn't worsen it (CRITICAL #2). Document as residual risk.

// GOTCHA #4 — appendExplicitPath is create-or-append + idempotent per path.
//  - create-or-append: the manifest at manifestPath(label) may be ABSENT (turn_start capture("turn")
//    returned null on caps/error) ⇒ try read+parse; on miss/corrupt start from {version:1,label,turnIndex:0,ts:Date.now(),files:{}}.
//  - idempotent: if files[path] already has an entry, RETURN without overwriting (first-write-wins — a
//    path written twice in a turn: write-2's hook fires with write-1's content on disk; overwriting would
//    lose the true pre-turn state). Mirrors captureExplicitPaths' `seen`-Set dedupe (cas.ts:466).

// GOTCHA #5 — the SnapshotStore interface capture(label) is 1-param (store.ts:80); GitBackend.capture is
// 1-param (git.ts:23). The 2nd arg is a CasBackend widening. agentEndCaptureHandler must CAST:
// `backend==='cas' ? await (rt.store as CasBackend).capture("turn-after", rt.pendingExplicitPaths ?? [])
//                   : await rt.store.capture("turn-after")`. The conditional keeps it type-honest for git/none.
// S1 already added `import type { CasBackend }` to capture.ts — REUSE it.

// GOTCHA #6 — turnStartCaptureHandler's capture("turn") stays ARGLESS. In explicit-paths mode that writes
// an EMPTY manifest placeholder (captureExplicitPaths loops []). That is CORRECT and REQUIRED: the hooks
// append the real pre-write entries during the turn, and beforeRef (the label "turn") resolves to the
// same manifest file they mutate. Do NOT pass rt.pendingExplicitPaths to capture("turn") — it is empty at
// turn_start (and would need a pointless cast). (This deliberately diverges from the item CONTRACT's
// naive wording; see CRITICAL #0.)

// GOTCHA #7 — clear the accumulator at turn_start BEFORE capture("turn") (so the new turn starts fresh).
// Place `rt.pendingExplicitPaths = [];` in turnStartCaptureHandler right after the `if(!rt.store) return;`
// gate (session_start's resetRuntime already gives a fresh [], so gcTurnSnapshots/session_start need no change).

// GOTCHA #8 — the tool_call hook is registered UNCONDITIONALLY (registerToolCallCapture(pi) in step 5),
// like registerTurnStartCapture/registerAgentEndCapture. The gate (revert.enabled / rt.store / backend
// / nonGitMode) lives INSIDE the handler — free when revert is off. (Mirrors S1 + the nudges pattern.)
```

## Implementation Blueprint

### Data models and structure
No new data model. `appendExplicitPath` consumes the existing `CasManifest` / `CasManifestEntry` shapes
(see cas.ts:139-153 `serializeManifest`/`parseManifest` + the entry shape in `captureExplicitPaths`).
`rt.pendingExplicitPaths` (S1) is the path list threaded into `agent_end`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD CasBackend.appendExplicitPath in src/snapshot/cas.ts
  - PLACE: immediately AFTER captureExplicitPaths (private) and BEFORE the public capture() — or directly
    after capture() — so the public explicit-paths API (capture + appendExplicitPath + notifyBashUsed) is grouped.
  - SIGNATURE: `async appendExplicitPath(label: string, path: string): Promise<void>`
  - JSDoc: cite spec/14 §4.2 + BUG-003; state it is PUBLIC (the P3 tool_call hook casts store as CasBackend
    to call it, like notifyBashUsed); mutex-serialized (§4.3); create-or-append; idempotent per (label,path)
    (first-write-wins); mirrors captureExplicitPaths per-file capture; does NOT bump capturesThisTurn
    (it appends to an existing manifest, not a new snapshot — avoids worsening the never-reset cap).
  - BODY (concrete — mirror captureExplicitPaths cas.ts:465-511):
      const release = await this.mutex.acquire();            // §4.3 — serialize ALL store ops
      try {
        if (isDangerousWorkspaceRel(path)) return;           // safety floor (.git/.pi/node_modules/../abs)
        const abs = resolveSafeWorkspacePath(this.cwd, path);// THROWS on escape ⇒ propagate to caller's try/catch
        // load existing manifest (create-or-append): absent/corrupt ⇒ fresh empty manifest.
        let manifest: CasManifest;
        try {
          const buf = await this.fs.readFile(this.manifestPath(label));
          manifest = parseManifest(buf.toString("utf8"));
        } catch {
          manifest = { version: 1, label, turnIndex: 0, ts: Date.now(), files: {} };
        }
        if (manifest.files[path] !== undefined) return;      // IDEMPOTENT — first-write-wins (double-write turn)
        // per-file capture — mirror captureExplicitPaths exactly:
        let st: { size: number; mtimeMs: number };
        try {
          st = await this.fs.stat(abs);
        } catch {
          manifest.files[path] = { hash: "", size: 0, mtime: 0, existed: false }; // created by the upcoming write
          await this.fs.mkdir(join(this.storageDir, "manifests"), { recursive: true });
          await this.fs.writeFile(this.manifestPath(label), Buffer.from(serializeManifest(manifest), "utf8"));
          return;
        }
        if (st.size > this.cfg.maxFileBytes) {               // fail-closed (§4.3) — skip+warn, NO entry
          console.warn(`[mulligan] snapshot.appendExplicitPath: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${path}`);
          return;
        }
        const content = await this.fs.readFile(abs);
        const hash = await this.hashContent(content);
        await this.storeBlob(content);                       // deduped via access
        manifest.files[path] = { hash, size: st.size, mtime: st.mtimeMs, existed: true };
        await this.fs.mkdir(join(this.storageDir, "manifests"), { recursive: true });
        await this.fs.writeFile(this.manifestPath(label), Buffer.from(serializeManifest(manifest), "utf8"));
        // NOTE: deliberately NO this.capturesThisTurn++ (see GOTCHA #2 / CRITICAL #2).
      } finally {
        release();                                           // AsyncMutex GOTCHA #5 — never forget
      }
  - NAMING: appendExplicitPath (camelCase public method; parallels notifyBashUsed — CasBackend-specific,
    NOT on the SnapshotStore interface).
  - VERIFY: `npm run typecheck`. A CasBackend-typed ref can call it; a SnapshotStore-typed ref cannot
    (the handler casts — see Task 2).

Task 2: ENHANCE toolCallCaptureHandler in src/capture.ts (S1's handler — add the appendExplicitPath call)
  - FIND: S1's toolCallCaptureHandler write/edit branch:
        if (event.toolName === "write" || event.toolName === "edit") {
          const path = (event.input as { path?: string }).path;
          if (typeof path === "string" && path.length > 0) {
            rt.pendingExplicitPaths?.push(path);
          }
          return;
        }
  - EDIT: AFTER the push (or before — order is immaterial; push mutates the array, append reads disk),
    add the pre-write capture:
          if (typeof path === "string" && path.length > 0) {
            rt.pendingExplicitPaths?.push(path);
            // [P1.M3.T1.S2 / BUG-003] snapshot the path's PRE-WRITE state BEFORE the tool runs (Pi awaits
            // this hook in preflight — spec §4.2 line 127). appendExplicitPath appends to the "turn"
            // beforeRef manifest (the empty placeholder turn_start wrote) so restore can revert it.
            // appendExplicitPath is CasBackend-specific (not on SnapshotStore) ⇒ cast (S1 added the type import).
            await (rt.store as CasBackend).appendExplicitPath("turn", path);
          }
  - NOTE: the handler is already `async` (S1). Pi awaits it, so the tool does NOT run until appendExplicitPath
    finishes reading the (still pre-write) file. If appendExplicitPath throws (escape path / fs error), the
    handler's outer try/catch (S1) logs + returns (fail-open — a tool_call is NEVER blocked, E27). Best-effort:
    a failed pre-write capture simply means that path won't be reverted (degrades to skipped).
  - UPDATE the handler JSDoc: note it now ALSO captures pre-write state via appendExplicitPath (S2), and
    cite spec §4.2 + BUG-003 + the Pi-await guarantee.
  - DO NOT touch the bash branch (notifyBashUsed) or the no-op branch (S1 owns those; unchanged).
  - DO NOT re-gate (backend!=="cas"/nonGitMode!=="explicit-paths" already done by S1 before this branch).

Task 3: CLEAR rt.pendingExplicitPaths at turn_start in src/capture.ts
  - FIND turnStartCaptureHandler's body:
        const rt = getRuntime(sessionId);
        if (!rt.store) return;
        await gcTurnSnapshots(rt);          // (1) GC FIRST
  - EDIT: insert the clear between the rt.store gate and gcTurnSnapshots (or immediately before capture):
        if (!rt.store) return;
        rt.pendingExplicitPaths = [];        // [P1.M3.T1.S2 / BUG-003] fresh per-turn accumulator
        await gcTurnSnapshots(rt);
  - KEEP `capture("turn")` ARGLESS (GOTCHA #6 — empty manifest placeholder; the hooks append during the turn).
  - session_start (index.ts) calls resetRuntime(sid) ⇒ freshRuntime gives a new [] ⇒ NO change needed there.

Task 4: THREAD rt.pendingExplicitPaths into agent_end capture in src/capture.ts
  - FIND agentEndCaptureHandler's body:
        const afterRef = await rt.store.capture("turn-after");
  - EDIT: branch on backend (type-honest — git/none stay 1-param; cas gets the widening via cast):
        const backend = rt.store.describe().backend;
        const afterRef =
          backend === "cas"
            ? await (rt.store as CasBackend).capture("turn-after", rt.pendingExplicitPaths ?? [])
            : await rt.store.capture("turn-after");
  - WHY thread at agent_end (not turn_start): at agent_end the accumulator holds ALL paths written this
    turn and the files are at their POST-write state — exactly the afterRef (dirty-guard baseline) we want.
    In explicit-paths mode captureExplicitPaths("turn-after", paths) captures those paths' post-write state
    (correct). In cas/git mode the arg is ignored (whole-tree / git capture).
  - KEEP the rest of agentEndCaptureHandler unchanged (mutate the existing "turn" checkpoint's afterRef, fail-open catch).
  - ACCEPTABLE ALTERNATIVE (simpler, type-lie): `await (rt.store as CasBackend).capture("turn-after", rt.pendingExplicitPaths ?? [])`
    unconditionally — runtime-harmless for git/none (extra arg ignored) but casts git→CasBackend. The
    conditional above is preferred (type-honest); pick ONE and be consistent.

Task 5: REGISTER registerToolCallCapture in src/index.ts step 5
  - FIND the capture import block:
        import {
          registerTurnStartCapture,
          registerAgentEndCapture,
          gcTurnSnapshots,
          rebuildCheckpointSnapshots,
        } from "./capture.js";
  - EDIT: add `registerToolCallCapture,` to the named import.
  - FIND step 5:
        registerTurnStartCapture(pi);
        registerAgentEndCapture(pi);
  - EDIT: add immediately after registerAgentEndCapture(pi):
        registerToolCallCapture(pi); // [P1.M3.T1.S2 / BUG-003] pi.on("tool_call", …) — capture pre-write
        // file state in explicit-paths non-git mode. Self-guards on revert.enabled (fail-open).
  - No other index.ts change (the gate lives inside the handler).

Task 6: TESTS — test/capture.test.ts (component) + a cas unit-test block
  - EXTEND S1's makeCasStore fake with an appendExplicitPath spy:
        function makeCasStore(opts: { appendCalls?: string[]; notifyBashUsedCalls?: string[] } = {}) {
          const appendCalls = opts.appendCalls ?? [];
          const notifyCalls = opts.notifyBashUsedCalls ?? [];
          const store = {
            appendCalls, notifyCalls,
            describe() { return { backend: "cas" }; },
            async capture() { return "ref"; },
            async appendExplicitPath(label: string, path: string) { appendCalls.push(`${label}:${path}`); },
            // …dirtyCheck/restore/has/retire/gc/notifyBashUsed as in S1…
          };
          return store as unknown as import("../src/snapshot/store.js").SnapshotStore;
        }
  - toolCallCaptureHandler — enhancement (write/edit NOW also captures):
        - backend 'cas' + nonGitMode 'explicit-paths' + write {path:"src/a.ts"} ⇒ rt.pendingExplicitPaths === ["src/a.ts"]
          AND appendCalls includes "turn:src/a.ts".
        - same + edit {path:"src/b.ts", edits:[…]} ⇒ pushes "src/b.ts" AND appendCalls includes "turn:src/b.ts".
        - backend 'git' (or 'none') + write ⇒ NO append call (backend gate). nonGitMode 'cas' + write ⇒ NO append (mode gate).
        - appendExplicitPath THROWING (inject a fake that rejects) ⇒ handler fail-open: no throw escapes,
          error logged (setLogFile+readLogLines pattern); the push may or may not have happened depending on
          order — assert no-throw is the contract.
  - turnStartCaptureHandler — clears the accumulator:
        - seed rt.pendingExplicitPaths = ["stale.ts"]; call turnStartCaptureHandler; assert rt.pendingExplicitPaths === [].
        - (revert.enabled=false ⇒ early-return BEFORE the clear is acceptable, OR clear-before-gate — match your
          placement: the clear sits AFTER the rt.store gate but the revert.enabled gate is earlier. To make the
          clear testable regardless of revert state, either (a) keep revert.enabled=true in the test, or (b) place
          the clear after the revert.enabled gate. Recommended: clear AFTER `if(!rt.store)return;` and AFTER the
          revert.enabled gate is fine since the test runs with revert enabled.)
  - agentEndCaptureHandler — threads for cas:
        - seed rt.pendingExplicitPaths = ["src/a.ts","src/b.ts"]; rt.snapshots.set("turn", {label:"turn",backend:"cas",beforeRef:"turn",turnIndex:0,ts:0});
          use a RecordingStore whose capture records (label, explicitPaths); call agentEndCaptureHandler;
          assert capture was called with ("turn-after", ["src/a.ts","src/b.ts"]) AND the existing "turn" checkpoint's afterRef was set.
        - backend 'git' (describe().backend='git') ⇒ capture called with ONLY ("turn-after") — NO 2nd arg (the
          RecordingStore must distinguish 1-arg vs 2-arg calls, e.g. record args.length or use a fake whose capture
          signature reflects the union).
  - registerToolCallCapture (S1) + index.ts registration:
        - registerToolCallCapture registers 'tool_call' once (S1 already asserts — keep).
        - index.ts: add a focused test that imports the default factory, builds a recording `pi` (records on()
          calls), calls the factory, and asserts pi.on was called with "tool_call" (and "turn_start"/"agent_end").
          NOTE: the factory also loads config + registers tools/commands — keep the recording pi stubs minimal
          (registerTool/registerCommand/on are no-ops that record). If the factory's side effects make this fragile,
          defer the wiring proof to S3's integration test and instead assert via the Level-4 grep gate below.
  - CasBackend.appendExplicitPath unit tests (new describe block — mirror the existing cas unit-test style; use
    the DI fs fake via `new CasBackend(cwd, cfg, null, { fs: fakeFs })`):
        - fresh label (no prior manifest) + write to an EXISTING file (fakeFs has src/a.ts="A0") ⇒ manifest
          manifests/turn.json has files["src/a.ts"]={hash:sha256("A0"),size,existed:true}; blob stored.
        - file does NOT exist (ENOENT) ⇒ files[path]={hash:"",size:0,mtime:0,existed:false}; NO blob stored.
        - oversize (> cfg.maxFileBytes) ⇒ NO entry added, NO blob; warn emitted.
        - dangerous path (".git/config") ⇒ NO entry, no throw, no fs read of the real path.
        - IDEMPOTENT: call appendExplicitPath("turn","src/a.ts") twice ⇒ files has ONE entry (first-write-wins);
          the 2nd call does NOT re-read/re-hash/overwrite (assert the fs fake's readFile count).
        - create-or-append: pre-seed manifests/turn.json with an existing entry for src/x.ts; call
          appendExplicitPath("turn","src/y.ts") ⇒ manifest now has BOTH entries (append, not overwrite).
        - escape path ("../escape") ⇒ throws (resolveSafeWorkspacePath) ⇒ propagates to the caller (the handler's
          try/catch). Assert appendExplicitPath itself rejects/throws on escape (the handler swallows it).
        - does NOT bump capturesThisTurn (no public getter — assert indirectly: a subsequent capture() is NOT
          starved; OR expose nothing and assert via behavior: after N appendExplicitPath calls, capture() still
          succeeds within maxSnapshotsPerTurn).
  - COVERAGE: all branches (existing-file / ENOENT / oversize / dangerous / idempotent / append) + the
    handler/turn_start/agent_end/index wiring. PLACEMENT: alongside S1's blocks + the cas unit-test file.

Task 7: VERIFY (no code) — run the gates (see Validation Loop).
```

### Implementation Patterns & Key Details
```ts
// ── PATTERN: appendExplicitPath mirrors captureExplicitPaths' per-file capture (cas.ts:465-511). ──
// SAME ordering + SAME entry shapes so restore() (cas.ts:743) treats them identically:
//   existed:true  ⇒ restore readBlob(hash)+writeFile (REVERT)
//   existed:false ⇒ restore unlink (DELETE created) when deleteCreatedFiles+allowDeleteCreatedFiles
async appendExplicitPath(label: string, path: string): Promise<void> {
  const release = await this.mutex.acquire();                 // §4.3 — serialize ALL store ops
  try {
    if (isDangerousWorkspaceRel(path)) return;
    const abs = resolveSafeWorkspacePath(this.cwd, path);     // throws on escape (propagates)
    let manifest: CasManifest;
    try {
      manifest = parseManifest((await this.fs.readFile(this.manifestPath(label))).toString("utf8"));
    } catch {
      manifest = { version: 1, label, turnIndex: 0, ts: Date.now(), files: {} }; // create-or-append
    }
    if (manifest.files[path] !== undefined) return;           // idempotent — first-write-wins
    let st: { size: number; mtimeMs: number };
    try { st = await this.fs.stat(abs); }
    catch { manifest.files[path] = { hash: "", size: 0, mtime: 0, existed: false }; } // created by upcoming write
    if (st!) {                                                // existed branch (TS: use a flag, not `st!`)
      if (st.size > this.cfg.maxFileBytes) { console.warn(`…oversize…`); return; } // fail-closed, no entry
      const content = await this.fs.readFile(abs);
      const hash = await this.hashContent(content);
      await this.storeBlob(content);                          // deduped
      manifest.files[path] = { hash, size: st.size, mtime: st.mtimeMs, existed: true };
    }
    await this.fs.mkdir(join(this.storageDir, "manifests"), { recursive: true });
    await this.fs.writeFile(this.manifestPath(label), Buffer.from(serializeManifest(manifest), "utf8"));
    // NO this.capturesThisTurn++ (GOTCHA #2).
  } finally { release(); }
}
// (Refine the `st!` guard into a clean existed/did-not-exist flag before submitting — the pseudo above is
//  illustrative; the EXACT entry logic must match captureExplicitPaths cas.ts:465-511.)

// ── PATTERN: handler enhancement (S1's toolCallCaptureHandler write/edit branch). ──
if (event.toolName === "write" || event.toolName === "edit") {
  const path = (event.input as { path?: string }).path;       // cast REQUIRED (=== doesn't narrow — S1 GOTCHA #1)
  if (typeof path === "string" && path.length > 0) {
    rt.pendingExplicitPaths?.push(path);
    await (rt.store as CasBackend).appendExplicitPath("turn", path); // S2 — pre-write capture (Pi awaits before tool runs)
  }
  return;
}

// ── PATTERN: agent_end threading (type-honest conditional cast). ──
const backend = rt.store.describe().backend;
const afterRef = backend === "cas"
  ? await (rt.store as CasBackend).capture("turn-after", rt.pendingExplicitPaths ?? [])
  : await rt.store.capture("turn-after");
```

### Integration Points
```yaml
CASBACKEND (src/snapshot/cas.ts):
  - add method: "async appendExplicitPath(label, path): Promise<void>" (PUBLIC; mutex-serialized; not on SnapshotStore)

CAPTURE (src/capture.ts):
  - toolCallCaptureHandler (S1): + `await (rt.store as CasBackend).appendExplicitPath("turn", path)` in write/edit branch
  - turnStartCaptureHandler: + `rt.pendingExplicitPaths = [];` after the rt.store gate (capture("turn") stays argless)
  - agentEndCaptureHandler: branch capture("turn-after") on backend==='cas' (cast + thread paths)
  - import: REUSE S1's `import type { CasBackend } from "./snapshot/cas.js";` (no new import)

INDEX (src/index.ts):
  - import: add registerToolCallCapture to the ./capture.js named import
  - step 5: add `registerToolCallCapture(pi);` after registerAgentEndCapture(pi)

RUNTIME / CONFIG / STORE-INTERFACE: NO CHANGE (read-only).
```

## Validation Loop

### Level 1: Syntax & Type (the PRIMARY gate)
```bash
npm run typecheck        # tsc --noEmit (strict) — MUST be clean
# Diagnose:
#  - "Property 'appendExplicitPath' does not exist on type 'SnapshotStore'" → you called it on rt.store
#    without the `as CasBackend` cast (Tasks 2 + 4).
#  - "Property 'appendExplicitPath' does not exist on type 'CasBackend'" → the method isn't PUBLIC or isn't on the class.
#  - capture("turn-after", paths) type error on git/none branch → you didn't gate on backend==='cas' (Task 4).
#  - Cannot find name 'registerToolCallCapture' in index.ts → missing named import (Task 5).
# tsc is the lint gate (no ruff/eslint here).
```

### Level 2: Component Tests (the new mechanism + wiring)
```bash
npx vitest run test/capture.test.ts          # handler enhancement + clear + agent_end thread + register
# + the CasBackend.appendExplicitPath unit tests (whichever cas test file S1's makeCasStore/DI pattern lives in)
# Expected: green. If the append test fails, re-check create-or-append + idempotency + the per-file entry logic.
# If the handler-enhancement test fails (append not called), confirm the cast + that backend/mode gates pass.
```

### Level 3: Full Suite (regression — S2 must not break anything)
```bash
npm test                 # vitest run (~1277 + new tests)
# Expected: green. S2 is additive (one method + handler/clear/thread/register edits + tests). A failure
# usually means the agent_end conditional or the turn_start clear disturbed a sibling — re-read the diff.
# NOTE: the full BUG-003 repro (write → agent_end → restore ⇒ reverted:["a.ts"]) is S3's integration test.
# S2 proves the mechanism via the appendExplicitPath unit test (an existing-file capture ⇒ restore-shaped entry).
```

### Level 4: Wiring + dormancy-inverse checks
```bash
# Confirm the hook IS now registered (inverse of S1's dormancy gate):
rg -n "registerToolCallCapture" src/index.ts          # ⇒ the import + the step-5 call
rg -n "appendExplicitPath" src/                        # ⇒ cas.ts method + capture.ts handler call (+ tests)
rg -n "rt\.pendingExplicitPaths = \[\]" src/capture.ts # ⇒ the turn_start clear
# Expected: all three return hits. Confirms S2 wired the producer (S1) into the capture lifecycle.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm test` green (~1277 + new).
- [ ] `git diff --name-only` lists `src/snapshot/cas.ts`, `src/capture.ts`, `src/index.ts`, `test/capture.test.ts` (+ any cas unit-test file).

### Feature Validation (BUG-003 actually fixed)
- [ ] `appendExplicitPath("turn", path)` for an existing file ⇒ manifest entry `{hash,size,mtime,existed:true}`; restore reverts it.
- [ ] `appendExplicitPath` for an ENOENT path ⇒ `{existed:false}`; restore deletes it (with deleteCreatedFlags).
- [ ] `appendExplicitPath` is idempotent per path (first-write-wins) — double-write turn keeps the true pre-turn state.
- [ ] `toolCallCaptureHandler` calls `appendExplicitPath` for write/edit in cas+explicit-paths mode (and no-ops otherwise).
- [ ] `turnStartCaptureHandler` clears `rt.pendingExplicitPaths`; `agentEndCaptureHandler` threads it into `capture("turn-after", …)` for cas.
- [ ] `registerToolCallCapture(pi)` is called in index.ts step 5.

### Scope Discipline
- [ ] `capture("turn")` at turn_start stays ARGLESS (empty placeholder — hooks append during the turn). Do NOT regress to naive threading.
- [ ] `appendExplicitPath` does NOT bump `capturesThisTurn` (GOTCHA #2).
- [ ] NO fix to the capturesThisTurn/bashWarnedThisTurn turn-boundary reset (out of scope — BUG-006-class; documented as residual risk).
- [ ] NO end-to-end integration test (S3) — only component + unit tests.

### Code Quality
- [ ] JSDoc on `appendExplicitPath` cites spec §4.2 + BUG-003 + mutex/create-or-append/idempotent/first-write-wins/no-capturesThisTurn-bump.
- [ ] Handler enhancement JSDoc updated (S2) — pre-write capture + Pi-await guarantee.
- [ ] `CasBackend` imported type-only in capture.ts (S1's import reused — no runtime graph cycle).
- [ ] Fail-open preserved (a throwing appendExplicitPath ⇒ handler logs + returns; the tool_call is never blocked, E27).

---

## Anti-Patterns to Avoid
- ❌ Don't "simplify" S2 to just passing `rt.pendingExplicitPaths` to `capture("turn")` — at turn_start it is EMPTY ⇒ empty beforeRef ⇒ restore reverts nothing ⇒ BUG-003 UNFIXED. The pre-write capture MUST happen in the tool_call hook via `appendExplicitPath`.
- ❌ Don't forget to acquire `this.mutex` in `appendExplicitPath` (§4.3: ALL store ops serialized) — and ALWAYS `release()` in `finally`.
- ❌ Don't bump `capturesThisTurn` in `appendExplicitPath` — it appends to an existing manifest, not a new snapshot, and the counter is (pre-existing) never reset.
- ❌ Don't overwrite an existing manifest entry for the same path — first-write-wins (a double-write turn must keep the TRUE pre-turn state, not write-1's content).
- ❌ Don't call `rt.store.appendExplicitPath(...)` or `rt.store.capture("turn-after", …)` without the `as CasBackend` cast — both are CasBackend-specific (not on `SnapshotStore`).
- ❌ Don't block a tool_call if `appendExplicitPath` throws — fail-open (E27): log + return; the path simply won't be reverted.
- ❌ Don't pass `rt.pendingExplicitPaths` to `capture("turn")` at turn_start — it's empty there; the argless call writes the correct empty placeholder the hooks append to.
- ❌ Don't add the capturesThisTurn/bashWarnedThisTurn reset here — cross-backend (git too), BUG-006-class, out of scope.

---

## Confidence Score: 9/10

**Rationale**: The single hardest part — proving the naive CONTRACT wording is insufficient and that
`appendExplicitPath` at tool_call time is required — is resolved with line-level evidence against
`src/snapshot/cas.ts` (restore iterates `manifest.files`; an empty map reverts nothing; the pre-write
content is observable only in the preflighted tool_call hook per spec §4.2 line 127). The implementation
mirrors an EXACT existing method (`captureExplicitPaths`) for the per-file capture logic, so there is no
novel algorithm — only a create-or-append + idempotent wrapper under the existing mutex. Every type
detail (1-param interface, the cast, the backend conditional) and every integration site (index.ts step 5,
turn_start clear, agent_end thread) is pinned to specific lines. The -1 accounts for (a) the
`capturesThisTurn` never-reset latent bug that S2 must carefully NOT worsen, and (b) the residual
ambiguity between the item's naive CONTRACT wording and its `appendExplicitPath` OUTPUT — this PRP
resolves it in favor of the correctness-proven `appendExplicitPath` path and documents why.

**Residual risk (out of scope, documented)**: `capturesThisTurn`/`bashWarnedThisTurn` are never reset at
the turn boundary (cross-backend, git.ts:219 too) — after ~32 turns (64 cap ÷ 2 captures/turn) all
captures would starve. S2 must NOT worsen this (appendExplicitPath skips the bump). The reset belongs to a
BUG-006-class turn-boundary task.

**Downstream contract for S3** (the end-to-end integration test): S3 will add an `F-revert-explicit`
scenario (spec/14 §9) — non-git temp dir, `nonGitMode:"explicit-paths"`, `write`/`edit` during a turn,
`agent_end` capture, then `mulligan_rewind(last_turn, revert_file_changes:true)` ⇒ files match pre-span;
a `bash sed` mutation is NOT reverted + the once-per-turn warning fired. S2's `appendExplicitPath` +
handler enhancement + agent_end thread + index registration are the mechanism S3 exercises end-to-end.