---
name: "P1.M3.T1.S3 — Explicit-Paths Integration Test (write/edit file revert in non-git mode)"
description: "Add an end-to-end integration test that exercises the REAL v1.2 hook chain (turnStartCaptureHandler → toolCallCaptureHandler → CasBackend.appendExplicitPath → agentEndCaptureHandler → restore) to verify BUG-003's fix: in non-git `explicit-paths` mode, write/edit files ARE reverted on undo while bash `sed` modifications are NOT reverted (and the once-per-turn warning fires). Test-only change — NO production source edits."
---

## Goal

**Feature Goal**: Prove, end-to-end through the REAL v1.2 working-tree-revert hook chain, that
`revert.nonGitMode:"explicit-paths"` (spec/14 §4.2) actually captures and restores write/edit files
(BUG-003 fixed) and that bash file mutations are correctly NOT captured/NOT restored (with a warning).
This closes the loop on S1+S2: the existing `F-revert-explicit` test in `revert-cas.test.ts` is a
**direct-drive workaround** that bypasses the hooks (its own comment says "there is NO tool_call
hook… drives capture DIRECTLY"); S3 delivers the test that exercises the hooks S1+S2 added.

**Deliverable**: A new file `test/integration/revert-explicit.test.ts` with two vitest `it()`
scenarios (both exercising the REAL hooks): (A) write+edit reverted end-to-end through the REAL
rewind tool; (B) bash `sed` NOT reverted (via `store.restore` direct) + once-per-turn warning fired
through the REAL `toolCallCaptureHandler`. Plus a small companion edit to remove/supersede the stale
workaround `F-revert-explicit` `it()` block in `revert-cas.test.ts` whose header comment becomes
false once the real hook exists.

**Success Definition**: `npx vitest run test/integration/revert-explicit.test.ts` passes (2
scenarios green, sed-skip-guards respected on CI without sed); `npm test` still green (no
regression); `npm run typecheck` clean. The new test exercises `toolCallCaptureHandler`,
`turnStartCaptureHandler`, `agentEndCaptureHandler`, and `store.restore` — i.e. the production code
paths, not a manual simulation.

## Why

- **Closes the BUG-003 verification gap**: S1 (Complete) added `pendingExplicitPaths` +
  `toolCallCaptureHandler`; S2 (in progress, assumed landed) adds `appendExplicitPath`, threads
  `pendingExplicitPaths` into `agentEndCaptureHandler`'s `capture("turn-after", …)`, and registers
  the hook. Without an end-to-end test driving those hooks, the fix is unverified in production
  paths — exactly the situation that let BUG-003 ship undetected (the prior `F-revert-explicit`
  test passed by simulating the hook, masking the missing wiring).
- **Spec compliance**: spec/14 §4.2 + spec/10 §2.1 row `F-revert-explicit` require write/edit
  reverted, bash NOT reverted + warned, backend "cas".
- **Guard against regression**: future refactors of the capture hooks or `captureExplicitPaths`/
  `appendExplicitPath` must keep manifests non-empty; this test pins that contract.

## What

Two integration scenarios (new file `test/integration/revert-explicit.test.ts`), both against REAL
non-git temp dirs, REAL `CasBackend` (via `detectAndCreate`), and the REAL capture hooks.

### Success Criteria

- [ ] **Scenario A** (`F-revert-explicit-write`): non-git dir, `a.ts='A0\n'` + `b.ts='B0\n'`, NO bash;
  drive `turnStartCaptureHandler` → `toolCallCaptureHandler(write a.ts)` → write `a.ts='A1\n'` →
  `toolCallCaptureHandler(edit b.ts)` → edit `b.ts='B1\n'` → `agentEndCaptureHandler`; then drive the
  REAL rewind tool (`granularity:"last_turn", revert_file_changes:true`); ASSERT `a.ts→'A0\n'`,
  `b.ts→'B0\n'`, `firstText(res)` contains "Reverted", `marker.revert.backend==="cas"`, and
  `marker.revert.revertedFiles ⊇ ["a.ts","b.ts"]`.
- [ ] **Scenario B** (`F-revert-explicit-bash`): non-git dir, `a.ts='A0\n'` + `c.ts='C0\n'`; drive
  `turnStartCaptureHandler` → `toolCallCaptureHandler(write a.ts)` → write `a.ts='A1\n'` →
  `toolCallCaptureHandler(bash sed)` [asserts the once-per-turn `console.warn` fires here] → `sed`
  `c.ts` to `'C1\n'` → `agentEndCaptureHandler`; then call `store.restore("turn", {revertFileChanges:
  true, deleteCreatedFiles:false})` DIRECTLY; ASSERT `result.reverted` contains `"a.ts"` but NOT
  `"c.ts"`, `a.ts→'A0\n'`, and `c.ts` stays `'C1\n'` (NOT reverted).
- [ ] The stale workaround `F-revert-explicit` `it()` block in `revert-cas.test.ts` (whose comment
  asserts "there is NO tool_call hook") is either DELETED or has its header comment updated to note it
  is superseded by the new real-hook test (preferred: delete, since the new file supersedes it).
- [ ] `npm test` green; `npm run typecheck` clean.

## All Needed Context

### Context Completeness Check

_Passed_: an engineer with no prior knowledge of this repo can implement this from the file
references below — the test scaffolding is copied verbatim from `revert-cas.test.ts`, the exact
`ToolCallEvent` shape and `appendExplicitPath` contract are quoted, and the one subtle trap (the
dirty-guard false-refuse on bash paths) is called out with the resolution baked into the task split.

### Documentation & References

```yaml
# MUST READ — the spec that defines the contract under test
- url: spec/14-working-tree-revert.md (§4.2 "explicit-paths" — lines ~120-127; §9 integration scenarios;
  §10 testing)
  why: §4.2 specifies "write/edit paths captured at tool_call time (reads event.input.path), bash NOT
    captured + warned once per turn"; §9 row F-revert-explicit is the exact scenario.
  critical: "Bash file commands are NOT captured and NOT promised restorable (warns once per turn when
    bash runs in this mode)." This is the Scenario B contract.

- file: test/integration/revert-cas.test.ts
  why: The PRIMARY pattern to copy — temp-dir helpers (makeNonGitDir/makeStorage/sed/sedAvailable),
    fakes (makePi/makeCtx), contextEntry builders (msgEntry/asstWrite/asstEdit/asstBash/result/user),
    run()/firstText()/rewindMarker(), the beforeEach/afterEach reset, the .js import paths. ALSO contains
    the stale workaround F-revert-explicit it() block to delete/supersede.
  pattern: Copy the file header (imports + helpers + fakes) VERBATIM; only the scenario it() bodies change.
  gotcha: The existing F-revert-explicit it() block is a DIRECT-DRIVE workaround (its comment: "CRITICAL #1
    — there is NO tool_call hook… drives capture DIRECTLY"). Do NOT copy its capture() calls — S3 calls
    the REAL hooks instead. DELETE or supersede that block (do not leave a stale misleading test).

- file: src/capture.ts
  why: Exports the REAL hooks S3 must call: toolCallCaptureHandler (the producer), turnStartCaptureHandler,
    agentEndCaptureHandler. Read to confirm the gate order + that toolCallCaptureHandler pushes path into
    rt.pendingExplicitPaths AND calls (rt.store as CasBackend).appendExplicitPath("turn", path) for
    write/edit, and notifyBashUsed() for bash.
  pattern: Call toolCallCaptureHandler DIRECTLY with a synthetic event (the test does not register via
    pi.on — it invokes the handler function, which is more faithful than registration and has no
    index.ts dependency). event shape: {type:"tool_call", toolCallId:"tc1", toolName:"write",
    input:{path:"a.ts"}} (cast `as ToolCallEvent`).

- file: src/snapshot/cas.ts
  why: restore() (line ~743) is called directly in Scenario B; dirtyCheck() (line ~663) explains the
    false-refuse gotcha; notifyBashUsed() (line ~427) emits the once-per-turn warn; capture() (line ~551)
    is what the hooks call. appendExplicitPath (added by S2 — NOT yet present in current source) is the
    method toolCallCaptureHandler invokes to capture pre-write state; S3 exercises it transitively.
  pattern: For Scenario B call: `const rr = await (store as CasBackend).restore("turn",
    {revertFileChanges:true, deleteCreatedFiles:false});` — restore is on the SnapshotStore interface too,
    so the cast is optional; keep it for parity with the existing test's `cb` cast style.
  gotcha: dirtyCheck marks a path DIRTY if it exists-now but has no entry in the afterRef manifest
    (cas.ts:~685 "exists now, no afterRef baseline ⇒ dirty"). The bash sed path c.ts is NOT in
    pendingExplicitPaths ⇒ absent from the afterRef manifest ⇒ the rewind-tool dirty guard would REFUSE
    a combined write+edit+bash scenario. THAT IS BUG-004 (P1.M4), NOT S3. Resolution: Scenario A has NO
    bash (dirty guard clean); Scenario B calls store.restore DIRECTLY (bypasses the dirty guard) to
    assert the "bash not reverted" contract cleanly.

- file: src/snapshot/store.ts
  why: RestoreOpts {revertFileChanges:boolean; deleteCreatedFiles:boolean} and RestoreResult
    {reverted,deleted,failed,skipped,refused} (all string[] of workspace-rel POSIX paths). Scenario B
    asserts on rr.reverted directly.

- file: test/capture.test.ts (function makeToolCallEvent ~line 928)
  why: Canonical ToolCallEvent factory for this codebase:
    `{ type:"tool_call", toolCallId:"tc1", toolName, input } as ToolCallEvent`. Copy this helper (or its
    shape) into the new test file. CONFIRMS the input field is `path` (NOT file_path — file_path is the
    ledger message-args field name used by asstWrite).
  pattern: `function makeToolCallEvent(toolName, input) { return { type:"tool_call", toolCallId:"tc1",
    toolName, input } as ToolCallEvent; }`

- file: src/tools/rewind.ts (step 6b ~line 843-940)
  why: Confirms affectedPaths = ledger.modifiedFiles (the dirty-guard input) and that store.restore is
    called with checkpoint.beforeRef (the "turn" beforeRef). Scenario A relies on the dirty guard being
    clean (no bash ⇒ modifiedFiles ⊆ afterRef-manifest paths ⇒ not dirty).
```

### Current Codebase tree (relevant slice)

```bash
test/integration/
  revert-cas.test.ts      # F-revert-cas + F-revert-explicit(WORKAROUND) + F-revert-dirtyguard
  revert-git.test.ts      # git-backend scenarios (pattern source for makePi/makeCtx)
  revert-edge.test.ts     # fail-open/delete/granularity edge scenarios
src/
  capture.ts              # turnStartCaptureHandler / agentEndCaptureHandler / toolCallCaptureHandler [REAL hooks]
  snapshot/cas.ts         # CasBackend: capture / captureExplicitPaths / appendExplicitPath(S2) / restore / dirtyCheck / notifyBashUsed
  snapshot/store.ts       # SnapshotStore / RestoreOpts / RestoreResult interfaces
  tools/rewind.ts         # makeRewindTool — step 6b revert decision tree (Scenario A drives this)
  runtime.ts              # SessionRuntime.pendingExplicitPaths (S1) + rt.store + rt.snapshots
  config.js               # setConfig / getConfig
```

### Desired Codebase tree with files to be added/changed

```bash
test/integration/
  revert-explicit.test.ts   # NEW — the real-hook F-revert-explicit scenarios (PRIMARY deliverable)
  revert-cas.test.ts        # MODIFIED — DELETE (or supersede) the stale workaround F-revert-explicit it() block
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — dirty-guard false-refuse on bash paths (BUG-004, NOT S3's concern, but it shapes the test design).
// The rewind tool sets affectedPaths = ledger.modifiedFiles (rewind.ts:849); the ledger extracts c.ts from
// `sed -i ... c.ts`. dirtyCheck(afterRef, [a.ts,b.ts,c.ts]) sees c.ts exists-now + no afterRef-manifest
// entry ⇒ DIRTY ⇒ REFUSE. In the real hook flow c.ts is NEVER in pendingExplicitPaths (bash doesn't push),
// so the afterRef manifest lacks it. RESOLUTION: Scenario A has NO bash (guard clean); Scenario B bypasses
// the rewind tool entirely and calls store.restore directly.

// CRITICAL — wire rt.store BEFORE any capture call. The hooks self-gate on rt.store (undefined ⇒ no-op).
//   const rt = getRuntime(sid); rt.store = store;   // BEFORE turnStartCaptureHandler.

// CRITICAL — storageDir MUST be a SEPARATE temp dir, NOT inside repoDir/cwd. store.ts resolveStorageDir
// has a containment guard that rejects an inside-cwd path ⇒ NoOpStore (backend "none"). Use makeStorage().

// CRITICAL — setConfig merges the FULL revert block over DEFAULT_CONFIG; setConfig(undefined) resets.
// Always setConfig(undefined) in beforeEach/afterEach to avoid cross-test leakage.

// CRITICAL — ToolCallEvent.input field for write/edit is `path` (NOT `file_path`). file_path is the
// LEDGER message-args field (asstWrite uses arguments:{file_path}). The hook reads (input as {path?}).path.

// event.toolName === "write" does NOT narrow event.input in TS (CustomToolCallEvent.toolName is string).
// The production handler casts defensively; the TEST builds the literal shape and casts `as ToolCallEvent`.

// notifyBashUsed is PUBLIC on CasBackend but NOT on the SnapshotStore interface ⇒ cast
// `(store as CasBackend)` to spy on it OR (as S3 does) observe the console.warn it emits via vi.spyOn.

// vitest imports use .js paths (ESM compiled). e.g. import { toolCallCaptureHandler } from "../../src/capture.js";

// sed is not guaranteed on all platforms — every scenario must skip-guard with sedAvailable() (the
// existing pattern). write/edit uses node:fs (no platform dep), so Scenario A's core can run without sed;
// Scenario B needs sed (the bash mutation under test), so it carries the skip-guard.
```

## Implementation Blueprint

### Data models and structure

No new production data models — this is a test-only item. The test consumes:
- `ToolCallEvent` (from `@earendil-works/pi-coding-agent`) — synthetic events built via `makeToolCallEvent`.
- `RestoreResult` / `RestoreOpts` (src/snapshot/store.ts) — asserted in Scenario B.
- `RevertCheckpoint` (src/markers.ts) — `rt.snapshots` entries set by the REAL hooks; the test does NOT
  set these manually (that was the workaround's tell).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/integration/revert-explicit.test.ts — file header + shared scaffolding
  - COPY VERBATIM from test/integration/revert-cas.test.ts: the vitest import block, the node:fs/os/
    path/child_process imports + the `execFile = promisify(execFileCb)` line, the `sed()` +
    `sedAvailable()` helpers, `makeNonGitDir(prefix)`, `makeStorage()`, the `dirs[]` tracker +
    beforeEach/afterEach (clearAll + setConfig(undefined) + rm dirs), and the `VALID_NOTE` constant.
  - ADD imports: `toolCallCaptureHandler` (and `turnStartCaptureHandler`, `agentEndCaptureHandler`) from
    "../../src/capture.js"; `CasBackend` type from "../../src/snapshot/cas.js" (for the cast); `ToolCallEvent`
    from "@earendil-works/pi-coding-agent".
  - ADD a local `makeToolCallEvent(toolName, input)` helper mirroring test/capture.test.ts:928
    (`{ type:"tool_call", toolCallId:"tc1", toolName, input } as ToolCallEvent`).
  - For Scenario A ONLY: copy the makePi/makeCtx/msgEntry/user/asstWrite/asstEdit/asstBash/result/run/
    firstText/rewindMarker helpers from revert-cas.test.ts (Scenario A drives the rewind tool).
  - NAMING: describe("F-revert-explicit real-hook integration (spec/14 §4.2 / spec/10 §2.1)").
  - PLACEMENT: test/integration/revert-explicit.test.ts.

Task 2: Scenario A — write/edit reverted via REAL hooks + REAL rewind tool (NO bash)
  - SETUP: repoDir = makeNonGitDir("rev-ex-write-"); writeFileSync a.ts='A0\n', b.ts='B0\n';
    assert existsSync(.git)===false (prove non-git). storageDir = makeStorage().
  - CONFIG: setConfig({revert:{enabled:true, nonGitMode:"explicit-paths", storageDir}}).
  - STORE+RT: store = await detectAndCreate(repoDir, getConfig().revert); expect(store.describe().backend)
    .toBe("cas"); rt = getRuntime("s1"); rt.store = store;  (BEFORE captures).
  - CAPTURE turn_start (REAL): await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:
    Date.now()}, ctx). EXPECT rt.snapshots.get("turn").beforeRef === "turn" (placeholder manifest exists).
    NOTE: build ctx AFTER setting up contextEntries (see below); makeCtx needs contextEntries.
  - SIMULATE write tool_call (REAL hook, PRE-write capture): await toolCallCaptureHandler(
    makeToolCallEvent("write", {path:"a.ts"}), ctx). This pushes "a.ts" into rt.pendingExplicitPaths AND
    calls appendExplicitPath("turn","a.ts") capturing a.ts='A0\n' (the pre-write state).
  - RUN the tool (mutate): writeFileSync(a.ts, "A1\n").
  - SIMULATE edit tool_call (REAL hook): await toolCallCaptureHandler(makeToolCallEvent("edit",
    {path:"b.ts"}), ctx). Captures b.ts='B0\n' pre-edit.
  - RUN the tool (mutate): writeFileSync(b.ts, "B1\n").
  - CAPTURE agent_end (REAL): await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx). This
    calls capture("turn-after", rt.pendingExplicitPaths /*=["a.ts","b.ts"]*/) and sets
    rt.snapshots.get("turn").afterRef="turn-after".
  - BUILD contextEntries (ledger source — LAST_TURN removes everything after the last user msg, so put
    toolCalls AFTER the user msg): [msgEntry(user("rewrite")), msgEntry(asstWrite("w1","a.ts")),
    msgEntry(result("w1")), msgEntry(asstEdit("e1","b.ts")), msgEntry(result("e1")),
    msgEntry(asst("final")), msgEntry(result("final"))]. Build ctx via makeCtx({sessionId:"s1",
    contextEntries}). (NOTE: because there is NO bash here, ledger.modifiedFiles=["a.ts","b.ts"] — exactly
    the afterRef-manifest paths — so the dirty guard is CLEAN. This is why Scenario A excludes bash.)
  - DRIVE rewind tool: const res = await run(pi, ctx, {note:VALID_NOTE, granularity:"last_turn",
    revert_file_changes:true}, "final").
  - ASSERT: expect(firstText(res)).toContain("Reverted"); a.ts==='A0\n'; b.ts==='B0\n';
    const marker = rewindMarker(appended); marker.revert.backend==="cas";
    marker.revert.revertedFiles.toEqual(expect.arrayContaining(["a.ts","b.ts"])).
  - DEPENDENCIES: makePi/makeCtx/run/firstText/rewindMarker (Task 1); REAL hooks (src/capture.js); REAL
    rewind tool (src/tools/rewind.js).

Task 3: Scenario B — bash sed NOT reverted + warned (via store.restore DIRECT; bypasses dirty guard)
  - SETUP: repoDir = makeNonGitDir("rev-ex-bash-"); a.ts='A0\n', c.ts='C0\n'. storageDir = makeStorage().
    sedAvailable() skip-guard at the top (return; + console.warn if unavailable).
  - CONFIG/STORE/RT: same as Scenario A (explicit-paths, CasBackend, rt.store=store before captures).
  - BUILD ctx: makeCtx({sessionId:"s1", contextEntries:[]}) — contextEntries can be empty (Scenario B
    does NOT drive the rewind tool; store.restore needs no ctx/ledger).
  - CAPTURE turn_start (REAL): await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:
    Date.now()}, ctx).
  - SIMULATE write tool_call (REAL): await toolCallCaptureHandler(makeToolCallEvent("write",{path:"a.ts"}),
    ctx). Captures a.ts='A0\n'.
  - RUN: writeFileSync(a.ts, "A1\n").
  - SIMULATE bash tool_call (REAL) + ASSERT THE WARNING: const warn = vi.spyOn(console,"warn").
    mockImplementation(()=>{}); await toolCallCaptureHandler(makeToolCallEvent("bash",
    {command:"sed -i s/C0/C1/ c.ts"}), ctx); expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("explicit-paths")); warn.mockRestore().
    (This proves notifyBashUsed fired via the REAL hook — c.ts is NOT pushed to pendingExplicitPaths.)
  - RUN the bash mutation: await sed(join(repoDir,"c.ts"), "s/C0/C1/"). (c.ts now 'C1\n'.)
  - CAPTURE agent_end (REAL): await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx).
    (capture("turn-after", ["a.ts"]) — c.ts absent.)
  - RESTORE DIRECTLY (bypass the rewind-tool dirty guard — the point is capture-doesn't-include-bash,
    NOT dirty-guard behavior): const rr = await (store as CasBackend).restore("turn",
    {revertFileChanges:true, deleteCreatedFiles:false}).
  - ASSERT: expect(rr.reverted).toContain("a.ts"); expect(rr.reverted).not.toContain("c.ts");
    a.ts==='A0\n' (reverted); c.ts==='C1\n' (NOT reverted — never in the manifest).
  - DEPENDENCIES: sed/sedAvailable (Task 1); REAL hooks; store.restore (src/snapshot/cas.js).

Task 4: MODIFY test/integration/revert-cas.test.ts — remove the superseded workaround
  - FIND the `it("F-revert-explicit: explicit-paths mode — write/edit reverted, bash sed NOT reverted
    (+ once-per-turn warning); …", …)` block (its body calls `cb.capture("turn", ["a.ts","b.ts"])`
    directly and `cb.notifyBashUsed()` directly — the direct-drive workaround).
  - DELETE that entire `it()` block. (The new test/integration/revert-explicit.test.ts supersedes it
    and exercises the REAL hooks. Leaving it would keep a stale, misleading test whose header comment
    claims "there is NO tool_call hook" — now false.)
  - IF deletion is risky (e.g. the describe header references 3 scenarios), also update the describe
    comment in revert-cas.test.ts to drop the F-revert-explicit mention. KEEP F-revert-cas and
    F-revert-dirtyguard (they use the REAL hooks for cas mode and remain valid).
  - PRESERVE: all other it() blocks, the shared helpers, beforeEach/afterEach.
  - GOTCHA: do NOT delete the helper functions (makeNonGitDir/makeStorage/sed/…) that F-revert-cas /
    F-revert-dirtyguard still use — only the one it() block.

Task 5: VALIDATE
  - npx vitest run test/integration/revert-explicit.test.ts  (both scenarios green; sed-guard respected)
  - npx vitest run test/integration/revert-cas.test.ts       (F-revert-cas + F-revert-dirtyguard still green)
  - npm test                                                  (full suite — no regression)
  - npm run typecheck                                         (tsc --noEmit clean)
```

### Implementation Patterns & Key Details

```typescript
// PATTERN A — synthetic ToolCallEvent (copy from test/capture.test.ts:928). input.path for write/edit.
function makeToolCallEvent(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { type: "tool_call", toolCallId: "tc1", toolName, input } as ToolCallEvent;
}
// usage: makeToolCallEvent("write", { path: "a.ts" })        // captures a.ts pre-write
//        makeToolCallEvent("edit",  { path: "b.ts" })        // captures b.ts pre-edit
//        makeToolCallEvent("bash",  { command: "sed -i s/C0/C1/ c.ts" })  // fires notifyBashUsed warning

// PATTERN B — drive the REAL hooks directly (NO pi.on registration; the handler fns are exported).
// rt.store MUST be set first (hooks self-gate on it); ctx needs a live sessionManager.getSessionId().
await turnStartCaptureHandler({ type:"turn_start", turnIndex:0, timestamp:Date.now() }, ctx);
await toolCallCaptureHandler(makeToolCallEvent("write", { path:"a.ts" }), ctx); // PRE-write capture
writeFileSync(join(repoDir,"a.ts"), "A1\n");                                    // the tool runs
await agentEndCaptureHandler({ type:"agent_end", messages:[] }, ctx);          // capture("turn-after", paths)

// PATTERN C — Scenario A end-to-end via the REAL rewind tool (NO bash ⇒ dirty guard clean).
const res = await run(pi, ctx, { note:VALID_NOTE, granularity:"last_turn", revert_file_changes:true }, "final");
expect(firstText(res)).toContain("Reverted");
const marker = rewindMarker(appended);
expect(marker.revert?.backend).toBe("cas");
expect(marker.revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts","b.ts"]));

// PATTERN D — Scenario B bypasses the rewind tool's dirty guard (store.restore direct) to assert the
// "bash not reverted" contract cleanly. (The dirty guard would falsely refuse because c.ts exists-now
// but is absent from the afterRef manifest — BUG-004, P1.M4, out of scope here.)
const rr = await (store as CasBackend).restore("turn",
  { revertFileChanges: true, deleteCreatedFiles: false });
expect(rr.reverted).toContain("a.ts");
expect(rr.reverted).not.toContain("c.ts");   // c.ts never captured ⇒ not touched
expect(readFileSync(join(repoDir,"c.ts"),"utf8")).toBe("C1\n"); // unchanged by restore

// PATTERN E — assert the once-per-turn bash warning fires through the REAL hook (not a direct
// notifyBashUsed call). The hook calls notifyBashUsed internally for toolName==="bash".
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
await toolCallCaptureHandler(makeToolCallEvent("bash", { command:"sed -i s/C0/C1/ c.ts" }), ctx);
expect(warn).toHaveBeenCalledTimes(1);
expect(warn).toHaveBeenCalledWith(expect.stringContaining("explicit-paths"));
warn.mockRestore();
```

### Integration Points

```yaml
NO production source changes (test-only item). The test:
  - imports the REAL hooks from src/capture.js (toolCallCaptureHandler / turnStartCaptureHandler / agentEndCaptureHandler)
  - imports the REAL CasBackend type + detectAndCreate + store.restore from src/snapshot/*.js
  - imports the REAL makeRewindTool from src/tools/rewind.js (Scenario A)
  - depends on S2's CasBackend.appendExplicitPath being present (exercised transitively inside toolCallCaptureHandler)
CONFIG:
  - setConfig({revert:{enabled:true, nonGitMode:"explicit-paths", storageDir}}) per scenario (temp storageDir)
ROUTES/DB: none
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating the test file — fix type errors before running it.
npm run typecheck          # tsc --noEmit — zero errors (the new file + the revert-cas.test.ts edit)
# Expected: clean. If errors, READ them — the most likely cause is a ToolCallEvent cast or a .js import path.
```

### Level 2: Unit/Integration Tests (Component Validation)

```bash
# Run the NEW test file in isolation first.
npx vitest run test/integration/revert-explicit.test.ts -t "F-revert-explicit"
# Expected: 2 scenarios green. On CI without sed, Scenario B self-skips (sedAvailable() guard).

# Confirm the modified revert-cas.test.ts still passes (F-revert-cas + F-revert-dirtyguard).
npx vitest run test/integration/revert-cas.test.ts
# Expected: green (the deleted workaround must not have been load-bearing for the others).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full suite — no regression across the 1277-test baseline.
npm test
# Expected: all green. If a revert-git/revert-cas/revert-edge test fails, the revert-cas.test.ts edit
# (Task 4) likely removed a shared helper — re-add it (only the it() block should be deleted).
```

### Level 4: Domain-Specific Validation

```bash
# Manual end-to-end sanity (optional): prove the hook captures a pre-write state by inspecting the
# manifest AFTER toolCallCaptureHandler(write) but BEFORE the mutate — the "turn" manifest must list a.ts
# with its 'A0\n' hash (existed:true). This is the BUG-003 root-cause verification (non-empty manifest).
# (The scenarios already assert the downstream effect — revert succeeds — so this is optional drill-down.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (the new file + the revert-cas.test.ts deletion).
- [ ] `npx vitest run test/integration/revert-explicit.test.ts` — 2 scenarios green.
- [ ] `npm test` — full suite green (no regression).

### Feature Validation

- [ ] Scenario A: write+edit reverted through the REAL hooks + REAL rewind tool; `a.ts→'A0\n'`,
      `b.ts→'B0\n'`; marker.revert.revertedFiles ⊇ {a.ts,b.ts}; backend "cas".
- [ ] Scenario B: bash sed NOT reverted (via store.restore direct); `rr.reverted` contains a.ts but
      NOT c.ts; `c.ts` stays `'C1\n'`; once-per-turn `console.warn` (containing "explicit-paths") fires
      through the REAL `toolCallCaptureHandler(bash)`.
- [ ] The stale direct-drive `F-revert-explicit` it() block is removed from revert-cas.test.ts.
- [ ] NO production source files modified (test-only).

### Code Quality Validation

- [ ] Reuses the existing integration-test scaffolding (makeNonGitDir/makeStorage/sed/makePi/makeCtx)
      verbatim — no divergent test idiom introduced.
- [ ] The new test exercises the REAL hooks (toolCallCaptureHandler/turnStartCaptureHandler/
      agentEndCaptureHandler), NOT a direct capture() simulation — this is what distinguishes it from
      the superseded workaround.
- [ ] The dirty-guard false-refuse gotcha is documented in the test (a comment at Scenario B explaining
      why store.restore is called directly instead of the rewind tool).

### Documentation & Deployment

- [ ] Each scenario's `it()` name + leading comment cites spec/14 §4.2 + spec/10 §2.1 F-revert-explicit.
- [ ] No new env vars / config / migrations.

---

## Anti-Patterns to Avoid

- ❌ Don't drive capture DIRECTLY (`cb.capture("turn", [...])`) — that is the OLD workaround this task
  supersedes. Call the REAL `toolCallCaptureHandler` / `agentEndCaptureHandler` hooks instead.
- ❌ Don't combine write+edit+bash-sed in ONE scenario routed through the rewind tool — the dirty guard
  will falsely REFUSE (c.ts "dirty": exists-now, no afterRef-manifest entry). That is BUG-004 (P1.M4),
  not S3. Scenario A excludes bash; Scenario B calls store.restore directly.
- ❌ Don't set `rt.snapshots` manually (the workaround did). The REAL hooks populate it.
- ❌ Don't forget `rt.store = store` BEFORE the first `turnStartCaptureHandler` call (hooks self-gate).
- ❌ Don't put the storageDir inside repoDir/cwd (store.ts rejects ⇒ NoOpStore, backend "none").
- ❌ Don't use `file_path` in the ToolCallEvent input — the field is `path` (file_path is the ledger's
  message-args field). The hook reads `(event.input as {path?:string}).path`.
- ❌ Don't leave the stale `F-revert-explicit` workaround block in revert-cas.test.ts — its comment
  ("there is NO tool_call hook") becomes false; delete or supersede it.

---

## Confidence Score

**9/10** — The contract is precise: the exact hooks, the exact ToolCallEvent shape, the exact
RestoreResult fields, the copy-verbatim scaffolding, and the one subtle trap (dirty-guard false-refuse)
are all spelled out with a concrete resolution (Scenario A excludes bash; Scenario B calls store.restore
directly). The only residual risk is whether S2's `appendExplicitPath` lands with the exact
mutex/manifest semantics assumed — but S3 exercises it transitively through the real hook, so any S2
deviation surfaces as a clear capture/restore failure (not a silent false-pass). Deducted 1 point for
that cross-item dependency.