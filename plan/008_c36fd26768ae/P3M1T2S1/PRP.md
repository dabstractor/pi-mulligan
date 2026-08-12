# PRP — P3.M1.T2.S1: Wire store into index.ts + session_start GC + session_shutdown teardown

**Spec refs**: spec/14-working-tree-revert.md §5 (capture lifecycle & retention — "session_start runs the
same pass to clear stale turn/* refs from a reloaded instance"; "Both stores are deleted entirely on
session_shutdown (no cross-session buildup)"; "a git gc or CAS mark-sweep failure is logged and NEVER blocks
the turn"), §2 ("Detection, cached per session" — the store is created ONCE at session_start and cached on
SessionRuntime), §8 (storageDir resolution). E28 (fail-open — detection failure is non-fatal), E32 (post-reload
snapshot loss → RESOLVED via on-disk refs + the session_start GC pass). architecture/codebase_patterns.md §6
(event-handler registration pattern — the store is created in session_start when config.revert.enabled, destroyed
in session_shutdown) + §8 (store-threading decision: the handle lives on SessionRuntime, read via rt.store).
JSDoc on the new session_start store block + session_shutdown destroy loop cites `@14 §5` (Mode A — rides with
the work; work-item DOCS clause).

---

## Goal

**Feature Goal**: Wire the working-tree snapshot store into the Pi extension lifecycle. At `session_start`,
when `config.revert.enabled`, create the per-session store via `detectAndCreate` and cache it on
`SessionRuntime.store`, then run the SAME prompt-boundary GC pass as `turn_start` (`gcTurnSnapshots`) to clear
stale `turn/*` refs left on disk by a reloaded instance (E32). At `session_shutdown`, best-effort destroy
every session's store (git shadow repo / CAS dir wiped entirely — no cross-session buildup) BEFORE `clearAll()`.
This is the STORE-LIFECYCLE half of the v1.2 feature: it makes the `rt.store` handle that the capture hooks
(P3.M1.T1 — turn_start/agent_end), the rewind tool (P4.M2.T1 — step 6b), and the checkpoint command (P3.M2)
all read actually exist and be torn down cleanly.

**Deliverable**:
1. EDIT `src/snapshot/store.ts` — ADD `destroy(): Promise<void>` to the `SnapshotStore` interface (backend-agnostic
   teardown, mirroring `gc()`) + ADD a no-op `async destroy()` to `NoOpStore`.
2. EDIT `src/snapshot/git.ts` — ADD `async destroy()` to `GitBackend` (acquire mutex → best-effort
   `fs.rm(this.shadowDir, {recursive, force})` → never rejects).
3. EDIT `src/snapshot/cas.ts` — ADD `async destroy()` to `CasBackend` (acquire mutex → best-effort
   `fs.rm(this.storageDir, {recursive, force})` → never rejects).
4. EDIT `src/runtime.ts` — ADD exported `getActiveStores(): SnapshotStore[]` (enumerate the private `runtimes`
   Map for teardown — 4 lines).
5. EDIT `src/index.ts` — EXTEND imports (`detectAndCreate`, `gcTurnSnapshots`, `getRuntime`, `getActiveStores`,
   `log`); make `session_start` ASYNC + add the store-creation + GC block (after resetRuntime + reconcileBanner,
   gated on revert.enabled, try/catch fail-open); make `session_shutdown` ASYNC + destroy every active store
   best-effort before `clearAll()`.
6. EDIT `test/index.test.ts` — ADD session_start store-creation tests (mock `detectAndCreate`) + session_shutdown
   destroy tests.

**Success Definition**: `session_start` (when `config.revert.enabled`) creates a store via `detectAndCreate`,
caches it on `getRuntime(sid).store`, and runs `gcTurnSnapshots(rt)` — all best-effort (a failure logs +
continues; resetRuntime + reconcileBanner always run). `session_shutdown` calls `destroy()` on every active
store (best-effort) then `clearAll()`. The store handle on `SessionRuntime.store` is readable by all downstream
consumers (capture hooks already read it guarded; rewindExecute P4 / checkpoint P3.M2 will read it). When revert
is disabled (the default), session_start/session_shutdown behave as before (no store, no GC, destroy loop is a
no-op). `npx tsc --noEmit` clean; `npx vitest run test/index.test.ts` green; full `npx vitest run` green.

## User Persona

**Target User**: Implementer agent (this PRP's consumer). End users never invoke the lifecycle directly — Pi
fires `session_start` on startup|reload|new|resume|fork and `session_shutdown` on exit; this task hooks both.

**Use Case**: A user opts into `config.revert.enabled` (with `revert.storageDir` set). On every session start,
the extension creates a store (git shadow repo if in a git workspace, else CAS), caches it for the session, and
clears any stale `turn/*` snapshot refs left on disk by a previous instance of the same session (so a reloaded
session doesn't accumulate dead turn snapshots — E32). The capture hooks then populate `rt.snapshots` against
that store across the turn. On shutdown, every session's store is wiped (git shadow repo subdir + CAS dir
deleted) so there is no cross-session disk buildup.

**Pain Points Addressed**: (1) the store must EXIST before the capture hooks can capture — without this wiring,
`rt.store` is always `undefined` and the entire file-revert feature is inert (the hooks already guard on it and
no-op). (2) Cross-session disk leakage — snapshot stores persist on disk across process restarts; without
shutdown teardown, shadow repos + CAS dirs accumulate forever. (3) Stale-refs-after-reload — a reloaded session
inherits whatever `turn/*` refs the prior instance wrote; without the session_start GC pass, they linger and
are never reclaimed (E32's "resolved" status depends on this pass running at session_start).

## Why

- **The store must exist before capture (PRD §5/§2)**: "`config.revert.enabled` default false → zero capture,
  zero storage." When on, the store is "created once at session_start by detectAndCreate" (PRD §2 "Detection,
  cached per session") and threaded onto `SessionRuntime`. The turn_start/agent_end hooks (P3.M1.T1) read
  `rt.store` guarded; without this task assigning it, they no-op forever — the feature never fires.
- **Cross-reload correctness (PRD §5, E32)**: "(session_start runs the same pass to clear stale turn/* refs
  from a reloaded instance.)" + "File-revert survives reload for checkpoints and for already-issued rewinds."
  The session_start GC pass (reusing `gcTurnSnapshots`) reclaims on-disk `turn/*` refs the prior instance
  wrote, so a reloaded session starts clean. This task wires that pass.
- **No cross-session buildup (PRD §5)**: "Both stores are deleted entirely on session_shutdown (no cross-session
  buildup)." This task implements that teardown (via the new `destroy()` interface method).
- **Foundation for all consumers**: the store handle on `SessionRuntime.store` is THE single read point for
  capture hooks (P3.M1.T1 — already guard on it), rewindExecute step 6b (P4.M2.T1 — reads `getRuntime(sid).store`
  for `dirtyCheck`/`restore`), and the checkpoint command (P3.M2 — reads it for checkpoint capture). This task
  POPULATES it.
- **Scope guard**: this task implements the store LIFECYCLE only — creation at session_start, GC at session_start,
  teardown at session_shutdown. It does NOT implement the capture hooks themselves (P3.M1.T1 — S1 turn_start
  landed, S2 agent_end in flight), the checkpoint capture (P3.M2), nor rewind step 6b (P4.M2). It ADDS the
  `destroy()` interface method + backend impls (REQUIRED for teardown — see Known Gotchas) but does NOT change
  the capture/restore/dirtyCheck/gc semantics. It does NOT add `registerAgentEndCapture` to index.ts (S2 owns
  that — parallel task).

## What

### `session_start` handler — store creation + GC (EDIT src/index.ts)
Becomes ASYNC (`async (_event, ctx) => {...}`). Preserves the existing body verbatim (setConfig → setLogFile →
resetRuntime(sid) → reconcileBanner) — read `sid = ctx.sessionManager.getSessionId()` ONCE and reuse for both
resetRuntime + getRuntime. AFTER reconcileBanner, APPEND a gated best-effort block:
```ts
if (!getConfig().revert.enabled) return;     // layer-1 gate (default false → no store, no GC)
try {
  const rt = getRuntime(sid);                 // the fresh runtime resetRuntime just (re)created
  rt.store = await detectAndCreate(ctx.cwd, getConfig().revert);  // create + cache (NEVER rejects)
  await gcTurnSnapshots(rt);                   // reuse turn_start's GC pass — clear stale on-disk turn/* (E32)
} catch (e) {
  try { log("error", "session_start.store", sid, { error: String(e) }); } catch { /* never throw */ }
}
```
detectAndCreate NEVER rejects (→ NoOpStore on any error); gcTurnSnapshots never throws. The try/catch is
belt-and-suspenders for the CRITICAL session_start path (a store failure must NEVER block config reload /
runtime reset / banner reconcile).

### `session_shutdown` handler — teardown (EDIT src/index.ts)
Becomes ASYNC (`async () => {...}`). BEFORE `clearAll()`, destroy every active store best-effort:
```ts
for (const store of getActiveStores()) {       // enumerate all sessions' stores (runtime.ts helper)
  try { await store.destroy(); } catch { /* best-effort — never blocks teardown */ }
}
clearAll();
```

### `destroy()` — the backend-agnostic teardown method (ADD to the SnapshotStore interface + 3 impls)
- `GitBackend.destroy()`: acquire mutex → best-effort `fs.rm(this.shadowDir, { recursive: true, force: true })`
  (the per-repo shadow repo subdir — NOT the shared storageDir) → never rejects. The shadow repo is keyed by
  `repoRoot` (stable for a cwd) so deleting it at shutdown is correct; it is recreated on the next session's
  first capture (PRD §5 "no cross-session buildup").
- `CasBackend.destroy()`: acquire mutex → best-effort `fs.rm(this.storageDir, { recursive: true, force: true })`
  (the whole CAS dir) → never rejects.
- `NoOpStore.destroy()`: no-op (nothing to reclaim).

### `getActiveStores()` — enumerate stores for teardown (ADD to src/runtime.ts)
`export function getActiveStores(): SnapshotStore[]` — iterate the module-private `runtimes` Map, return every
runtime's `store` that is non-undefined. ~4 lines. (The Map is private; consumers read a single session's store
via `getRuntime(sid).store`; only teardown needs to enumerate ALL sessions.)

### Success Criteria
- [ ] When `config.revert.enabled === false` (the default), `session_start` returns BEFORE calling
      `detectAndCreate`/`getRuntime`/`gcTurnSnapshots` (gate is the FIRST check in the store block) — behaves
      exactly as before.
- [ ] When `config.revert.enabled === true`, after session_start resolves: `getRuntime(sid).store` is a
      non-undefined `SnapshotStore` (the value `detectAndCreate` returned) AND `store.gc()` was called exactly
      once (via gcTurnSnapshots).
- [ ] `session_start` is ASYNC; Pi awaits it; the handler NEVER rejects on any error (detectAndCreate/gc throw,
      getConfig throw, anything) — it logs via `log("error","session_start.store",sid,{error})` + continues.
- [ ] resetRuntime + reconcileBanner run EVEN IF the store block throws (they are BEFORE the try/catch; the
      store block is the tail).
- [ ] `session_shutdown` is ASYNC; it calls `destroy()` on every active store (best-effort) BEFORE `clearAll()`.
- [ ] `GitBackend.destroy()` deletes the shadow repo dir (recursive, force) and NEVER rejects; `CasBackend.destroy()`
      deletes the CAS dir (recursive, force) and NEVER rejects; `NoOpStore.destroy()` is a no-op.
- [ ] `getActiveStores()` returns the non-undefined `store` of every runtime in the module Map.
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/index.test.ts` green; full `npx vitest run` green.
- [ ] NO edits to capture.ts semantics (gcTurnSnapshots is REUSED, not changed), NO edits to store.ts
      capture/restore/dirtyCheck/gc, NO new handler registrations (turn_start=S1 ✓, agent_end=S2's job).

## All Needed Context

### Context Completeness Check
✅ "If someone knew nothing about this codebase, would they have everything needed?" — YES. The factory shape
(index.ts steps + the exact session_start/session_shutdown handlers), the detectAndCreate signature + fail-open
contract, the gcTurnSnapshots export, the SessionRuntime.store field (already present), the backend private
path fields (git shadowDir / cas storageDir), the mutex acquire/release idiom, the ExtensionContext shape
(cwd + sessionManager, NO sessionDir), and the test idiom (vi.mock + fake pi + makeCtx) are all cited below
with exact paths + line anchors + patterns.

### Documentation & References

```yaml
# MUST READ — the authoritative spec for this task
- file: spec/14-working-tree-revert.md
  why: §5 (capture lifecycle & retention — "session_start runs the same pass to clear stale turn/* refs from a
       reloaded instance"; "Both stores are deleted entirely on session_shutdown (no cross-session buildup)";
       "a git gc or CAS mark-sweep failure is logged and NEVER blocks the turn"), §2 ("Detection, cached per
       session" — the store is created ONCE at session_start and cached on SessionRuntime — this task wires that),
       §8 (storageDir resolution), §1 (opt-in — config.revert.enabled is layer 1).
  critical: §5 "(session_start runs the same pass to clear stale turn/* refs from a reloaded instance.)" + "Both
       stores are deleted entirely on session_shutdown (no cross-session buildup)." §2 "Detection, cached per
       session." E28 "fail-open" + E32 "post-reload snapshot loss → RESOLVED".

# THE FACTORY TO EDIT — index.ts (steps 6 + 7 are THIS task's edit points)
- file: src/index.ts
  why: the extension factory. Step 6 = the session_start handler (currently SYNC: setConfig → setLogFile →
       resetRuntime(sid) → reconcileBanner). Step 7 = the session_shutdown handler (currently `() => { clearAll(); }`).
       Step 5 registers handlers (registerTurnStartCapture present from S1; registerAgentEndCapture NOT present
       yet — S2's job, parallel). This task makes BOTH step 6 + step 7 async and adds the store lifecycle.
  pattern: see "Implementation Patterns" for the exact new handler bodies. Read sessionId ONCE into a local `sid`
       and reuse for resetRuntime + getRuntime. Gate the store block on getConfig().revert.enabled FIRST.
  gotcha: do NOT add registerAgentEndCapture (S2 owns it — parallel task; adding it would conflict). Do NOT touch
       step 5's existing registrations. The store block goes AFTER resetRuntime + reconcileBanner (the contract's
       "after resetRuntime" ordering; reconcileBanner is also fail-open so it can stay before the store block).

# THE STORE FIELD + THE ENUMERATION HELPER — runtime.ts
- file: src/runtime.ts
  why: SessionRuntime ALREADY has `store?: SnapshotStore` (contract part (a) is DONE — verify in Task 0; do NOT
       re-add). getRuntime(sid: string) returns the live mutable runtime. resetRuntime(sid) deletes the entry
       (next getRuntime creates a fresh one — store undefined, snapshots a fresh Map). clearAll() wipes all. The
       `runtimes` Map is MODULE-PRIVATE → THIS TASK ADDS `getActiveStores(): SnapshotStore[]` to enumerate it
       for teardown (the only consumer that needs ALL sessions, not one).
  gotcha: getRuntime takes a STRING (sessionId from ctx.sessionManager.getSessionId()), NOT ctx (nudges.ts
       GOTCHA #5; the contract pseudocode's getRuntime(ctx.sessionId) is WRONG — ctx has no sessionId property).

# THE GC HELPER TO REUSE — capture.ts (DO NOT EDIT — REUSE)
- file: src/capture.ts
  why: `gcTurnSnapshots(rt: SessionRuntime): Promise<void>` is ALREADY EXPORTED (created by S1). It: guards
       `if (!rt.store) return`; awaits `rt.store.gc()` (drop all turn/* refs on disk + reclaim; checkpoint/*
       exempt); clears in-memory turn/* entries. NEVER throws. session_start reuses it verbatim for the E32
       stale-refs cleanup. THIS TASK IMPORTS IT (index.ts) — does NOT edit capture.ts.
  pattern: `import { registerTurnStartCapture, gcTurnSnapshots } from "./capture.js";` (extend the existing
       import line that S1 added — S1 imported only registerTurnStartCapture).

# THE STORE FACTORY + INTERFACE TO EXTEND — store.ts
- file: src/snapshot/store.ts
  why: detectAndCreate(cwd, revertConfig, sessionDir?) is the front door — NEVER rejects (→ NoOpStore on any
       error; E28 fail-open). The SnapshotStore interface has describe/capture/dirtyCheck/restore/has/retire/gc
       — NO destroy. THIS TASK ADDS `destroy(): Promise<void>` to the interface + a no-op impl to NoOpStore.
  gotcha: detectAndCreate's 3rd arg sessionDir is OPTIONAL — ctx has NO sessionDir (ExtensionContext has cwd +
       sessionManager only), so session_start calls detectAndCreate with 2 args. When revert.storageDir is null
       AND no sessionDir → GitBackend/CasBackend throw "storageDir is null and no sessionDir provided" →
       detectAndCreate catches → NoOpStore (fail-open). So a NON-NoOp store REQUIRES the user to configure
       revert.storageDir. This matches the contract's 2-arg call — do NOT invent a sessionDir source.

# THE BACKENDS — add destroy() to each (they hold the private paths)
- file: src/snapshot/git.ts
  why: GitBackend holds `private shadowDir = join(this.storageDir, shadowKey(this.repoRoot))` (set in the
       memoized `ensureInit()`). `shadowKey` is MODULE-PRIVATE (line 134). THIS TASK ADDS `async destroy()`:
       acquire this.mutex → best-effort fs.rm(this.shadowDir, {recursive, force}) → never rejects. The shadow
       repo is keyed by repoRoot (stable per cwd) so deleting it at shutdown is correct (recreated next session).
  gotcha: shadowDir is only resolved AFTER ensureInit() runs. Use the mutex acquire/release idiom (see capture/
       restore for the `const release = await this.mutex.acquire(); try {...} finally { release(); }` pattern).
       fs.rm with {recursive:true, force:true} is a no-op if the dir is absent (force:true) — so a never-init'd
       backend (shadowDir unset) must GUARD: only rm if init ran (check `this.initPromise !== null`) OR wrap the
       rm in try/catch (preferred — simpler + force:true tolerates a missing dir; but the !-asserted field is
       undefined pre-init → pass `this.shadowDir ?? <no-op>`). Simplest robust form: `try { await
       this.ensureInit(); } catch {} /* may have never run / failed */ if (this.shadowDir) { try { await
       fsRm(this.shadowDir, {recursive:true, force:true}); } catch {} }`. ensureInit is idempotent + memoized.
- file: src/snapshot/cas.ts
  why: CasBackend holds `private storageDir` (known at construction — resolved in the ctor). THIS TASK ADDS
       `async destroy()`: acquire this.mutex → best-effort fs.rm(this.storageDir, {recursive, force}) → never
       rejects. Simpler than git (storageDir is always set; no init gate needed).
  pattern: `async destroy(): Promise<void> { const release = await this.mutex.acquire(); try { await
       fsRm(this.storageDir, { recursive: true, force: true }); } catch { /* best-effort */ } finally {
       release(); } }`. fs.rm + force:true tolerates a missing dir.

# THE CONFIG — the gate field
- file: src/config.ts
  why: MulliganConfig.revert.enabled (boolean, default false) is the layer-1 gate. Read via
       getConfig().revert.enabled. This task does NOT edit config.ts.
  critical: revert.enabled default false → zero capture, zero storage. session_start checks it FIRST in the
       store block (early return → behaves as before).

# THE TYPE — ExtensionContext (cwd + sessionManager, NO sessionDir)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: ExtensionContext (line 209) has cwd (217) + sessionManager.getSessionId() (219) but NO sessionDir. The
       session_start handler reads ctx.cwd (for detectAndCreate) + ctx.sessionManager.getSessionId() (for
       resetRuntime/getRuntime). Pi event handlers may be async (ExtensionHandler returns Promise<R|void>|R|void;
       turn_start is already async) — so making session_start/session_shutdown async is safe (Pi awaits them).

# THE TEST IDIOM — index.test.ts (mock detectAndCreate + fake pi + makeCtx)
- file: test/index.test.ts
  why: the pattern: vitest flat describe/it/expect; `vi.mock("../src/settings.js")` + `vi.mock("../src/log.js")`
       (file-scoped); a hand-rolled fake ExtensionAPI capturing `.on`/`.registerTool`/`.registerCommand`;
       makeCtx(sid, cwd); makeStartEvent(reason); beforeEach: clearAll(). The existing session_start tests use
       DEFAULT_CONFIG (revert.enabled=false) → the store block is skipped → they STILL PASS when the handler goes
       async (the gate early-returns before any await). The "sync factory" test checks the FACTORY return (stays
       sync) — unaffected.
  pattern: to test the store block, `vi.mock("../src/snapshot/store.js", () => ({ detectAndCreate: vi.fn(),
       NoOpStore: ... }))` + program detectAndCreate.mockResolvedValue(<RecordingStore with gc+destroy spies>);
       setConfig({ revert: { enabled: true, storageDir: "<tmp>" } }); fire `await
       handlers["session_start"]!(makeStartEvent("reload"), makeCtx("s1","/proj"))`; assert
       getRuntime("s1").store === <the fake> + fake.gc called once. For session_shutdown: assert fake.destroy
       called + clearAll ran (next getRuntime is fresh).
  gotcha: detectAndCreate is imported in index.ts from "./snapshot/store.js"; the test mocks "../src/snapshot/
       store.js". The fake pi's `.on` returns handlers keyed by event; session_start/session_shutdown are in there.

# THE PARALLEL SIBLING — P3.M1.T1.S2 (agent_end) owns registerAgentEndCapture wiring
- file: plan/008_c36fd26768ae/P3M1T1S2/PRP.md
  why: S2 adds `registerAgentEndCapture(pi)` to index.ts step 5 (Task 2 of S2). THIS TASK DOES NOT add it — doing
       so would duplicate/conflict with S2 (parallel execution context). This task only VERIFIES
       registerTurnStartCapture is present (S1 ✓) in Task 0. The store lifecycle (this task) is independent of
       the agent_end hook: rt.store works whether or not agent_end is wired.
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # steps 6 (session_start) + 7 (session_shutdown) — EDIT (both go async + store lifecycle)
  runtime.ts          # SessionRuntime.store? ALREADY present — EDIT (ADD getActiveStores() only)
  capture.ts          # gcTurnSnapshots(rt) ALREADY exported — READ ONLY (REUSE; do not edit)
  config.ts           # revert.enabled gate — READ ONLY
  log.ts              # log(level, event, sid, details?) — READ ONLY (import log)
  snapshot/store.ts   # detectAndCreate + SnapshotStore interface + NoOpStore — EDIT (ADD destroy() to both)
  snapshot/git.ts     # GitBackend (private shadowDir, mutex) — EDIT (ADD destroy())
  snapshot/cas.ts     # CasBackend (private storageDir, mutex) — READ-ONLY-ish; EDIT (ADD destroy())
test/
  index.test.ts       # the factory tests — EDIT (ADD session_start store + session_shutdown destroy blocks)
```

### Desired Codebase tree with files to be added/edited

```bash
src/snapshot/store.ts # EDIT — add `destroy(): Promise<void>` to SnapshotStore interface + no-op to NoOpStore
src/snapshot/git.ts   # EDIT — add async destroy() to GitBackend (mutex + fs.rm(shadowDir, {recursive,force}))
src/snapshot/cas.ts   # EDIT — add async destroy() to CasBackend (mutex + fs.rm(storageDir, {recursive,force}))
src/runtime.ts        # EDIT — add exported getActiveStores(): SnapshotStore[] (enumerate private Map)
src/index.ts          # EDIT — extend imports; session_start async + store-creation+GC block; session_shutdown
                      #   async + destroy-all-stores-before-clearAll
test/index.test.ts    # EDIT — ADD session_start store-creation tests + session_shutdown destroy tests
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CONTRACT PSEUDOCODE `getRuntime(ctx.sessionId)` IS WRONG: the real API is getRuntime(sessionId: string) where
//   sessionId = ctx.sessionManager.getSessionId(). `ctx` has NO sessionId property. nudges.ts GOTCHA #5 + the
//   turn_start/agent_end handlers all use ctx.sessionManager.getSessionId(). Read it ONCE into a local `sid` and
//   reuse for resetRuntime(sid) + getRuntime(sid) (a second getSessionId() call is harmless but redundant).

// CONTRACT (a) "Add store?: SnapshotStore to SessionRuntime" IS ALREADY DONE: runtime.ts ALREADY declares
//   `store?: SnapshotStore` (with the type-only import). freshRuntime leaves it undefined. This task only
//   VERIFIES it in Task 0 — do NOT re-add (a duplicate field is a TS error).

// CONTRACT (d) "fs.rm <storageDir>/<key> in index.ts" IS INFEASIBLE AS WRITTEN: git's shadow dir is
//   `join(storageDir, shadowKey(repoRoot))` where `shadowKey` is MODULE-PRIVATE in git.ts (line 134) and
//   repoRoot is resolved via ASYNC rev-parse in the memoized ensureInit(). index.ts cannot reconstruct the git
//   shadow path without breaking encapsulation. CORRECT DESIGN (this task): add `destroy(): Promise<void>` to
//   the SnapshotStore interface — backend-agnostic (mirrors gc()), each backend knows its own path. The
//   contract's INTENT ("wipe it entirely, best-effort") is preserved exactly; only the fs.rm call moves INTO the
//   backend where the path knowledge belongs. This is the SAME principle the whole v1.2 design uses ("the rewind
//   tool orchestrates dirtyCheck + restore and NEVER knows which backend ran").

// NO sessionDir ON ctx: ExtensionContext has cwd + sessionManager but NO sessionDir. So detectAndCreate is a
//   2-ARG call: detectAndCreate(ctx.cwd, getConfig().revert). When revert.storageDir is null, the backends
//   throw "storageDir is null and no sessionDir provided" → detectAndCreate catches → NoOpStore (fail-open). So
//   a NON-NoOp store REQUIRES the user to configure revert.storageDir. Do NOT invent a sessionDir source.

// session_start GOES ASYNC: it now awaits detectAndCreate + gcTurnSnapshots. Pi event handlers may be async
//   (turn_start is). The existing index.test.ts session_start tests use DEFAULT_CONFIG (revert.enabled=false)
//   → the store block early-returns BEFORE any await → those tests still pass (the handler behaves sync when
//   revert is off). NEW store-block tests set revert.enabled=true + MUST `await` the returned promise.

// resetRuntime BEFORE the store block: resetRuntime(sid) deletes the runtime entry; getRuntime(sid) then
//   creates a FRESH one (store undefined, snapshots a fresh Map). So assign rt.store AFTER getRuntime returns
//   the fresh rt. (The contract's "after resetRuntime" ordering.) Holding the `rt` reference across the await
//   is safe — single-threaded JS; no other handler mutates it mid-await.

// destroy() MUST be BEST-EFFORT + NEVER REJECT: session_shutdown is teardown; a store.destroy failure (locked
//   file, permission, transient IO) must NEVER block clearAll/exit. Each backend's destroy() wraps its fs.rm in
//   try/catch (swallowed) + uses fs.rm {force:true} (no-op on missing dir). NoOpStore.destroy() is a no-op.

// destroy() MUST ACQUIRE THE MUTEX (serialized like gc()): a destroy racing an in-flight capture/restore would
//   corrupt state. Use the SAME `const release = await this.mutex.acquire(); try {...} finally { release(); }`
//   idiom as capture/restore/gc. NoOpStore has no mutex → its destroy() is a plain async no-op.

// GIT shadowDir IS UNSET PRE-INIT: `private shadowDir!: string` is assigned only inside the memoized ensureInit().
//   If destroy() is called before any capture (init never ran), this.shadowDir is undefined. ROBUST form:
//   `try { await this.ensureInit(); } catch {} if (this.shadowDir) { try { await fsRm(this.shadowDir,
//   {recursive:true, force:true}); } catch {} }`. ensureInit is idempotent + memoized (calling it in destroy
//   just resolves shadowDir; if it creates the bare repo right before we delete it, that's harmless). force:true
//   makes rm a no-op on a missing dir.

// CAS storageDir IS ALWAYS SET (constructor) — no init gate needed: CasBackend.destroy() can rm this.storageDir
//   directly (it's resolved in the ctor; no ensureInit for CAS — detectAndCreate already mkdir'd it).

// DO NOT ADD registerAgentEndCapture: S2 (P3.M1.T1.S2 — parallel) owns adding `registerAgentEndCapture(pi)` to
//   index.ts step 5. Adding it here would duplicate/conflict. This task only VERIFIES registerTurnStartCapture
//   is present (S1 ✓) in Task 0. rt.store works independently of the agent_end hook.

// .js import specifiers are MANDATORY (tsc/vitest ESM). This task EXTENDS existing import lines — it does not
//   create new modules. detectAndCreate is imported from "./snapshot/store.js"; gcTurnSnapshots from "./capture.js";
//   getRuntime + getActiveStores from "./runtime.js"; log from "./log.js".

// FAIL-OPEN is the law: detectAndCreate NEVER rejects (→ NoOpStore); gcTurnSnapshots NEVER throws (catches
//   internally); destroy() NEVER rejects (swallows). session_start's try/catch is belt-and-suspenders for the
//   CRITICAL path (config reload / runtime reset must ALWAYS run). session_shutdown's per-store try/catch
//   ensures one failing store doesn't skip the rest or skip clearAll.
```

---

## Implementation Blueprint

### Data models and structure

This task adds **NO new exported types**. It adds:
- `destroy(): Promise<void>` — a new METHOD on the `SnapshotStore` interface (store.ts) + 3 impls.
- `getActiveStores(): SnapshotStore[]` — a new exported FUNCTION (runtime.ts).

It consumes: `detectAndCreate` (store.ts), `gcTurnSnapshots` (capture.ts), `getRuntime`/`resetRuntime`/`clearAll`
(runtime.ts), `log` (log.ts), `getConfig` (config.ts), the backend mutex + private path fields.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM PREREQUISITES (read runtime.ts + capture.ts + store.ts + index.ts + the sibling PRPs)
  - READ src/runtime.ts: CONFIRM `store?: SnapshotStore` field EXISTS (contract part (a) — ALREADY DONE). Note the
    module-private `runtimes` Map (getActiveStores will enumerate it). Note getRuntime/resetRuntime/clearAll signatures.
  - READ src/capture.ts: CONFIRM `gcTurnSnapshots(rt)` is EXPORTED (S1 ✓). This task REUSES it — does not edit capture.ts.
  - READ src/index.ts: CONFIRM step 5 has `registerTurnStartCapture(pi)` (S1 ✓). NOTE: registerAgentEndCapture is
    NOT present (S2 in flight — do NOT add it; this task's store lifecycle is independent of it).
  - READ src/snapshot/store.ts + git.ts + cas.ts: CONFIRM the SnapshotStore interface + the backend private fields
    (git shadowDir/mutex; cas storageDir/mutex) + the mutex acquire/release idiom (copy it from capture/restore).
  - WHY: this task is EDIT/EXTEND across 6 files. Confirming the exact current shape avoids guess-work. The
    interface addition (destroy) is backward-compatible (additive) — the "Complete" P2 backends stay green.

Task 1: EDIT src/snapshot/store.ts — ADD destroy() to the SnapshotStore interface + a no-op to NoOpStore
  - ADD to the SnapshotStore interface (after gc(), the last method):
      /**
       * Best-effort full teardown (spec/14 §5: "Both stores are deleted entirely on session_shutdown — no
       * cross-session buildup"). Wipes the backend's on-disk storage: GitBackend deletes its shadow repo dir;
       * CasBackend deletes its CAS dir; NoOpStore is a no-op. Serialized by the mutex (like gc()). NEVER rejects
       * — a failure is swallowed (teardown must never block). Called by index.ts session_shutdown BEFORE clearAll().
       * IMPLEMENTED BY: GitBackend/CasBackend/NoOpStore.
       */
      destroy(): Promise<void>;
  - ADD to NoOpStore (after its gc()):
      async destroy(): Promise<void> { /* no-op — nothing to reclaim in a no-op store */ }
  - WHY: the backend-agnostic teardown seam. index.ts calls store.destroy() without knowing the backend.
  - GOTCHA: this is a REQUIRED interface addition — git.ts + cas.ts MUST also implement it (Tasks 2-3) or tsc
    fails ("GitBackend incorrectly implements SnapshotStore: missing destroy"). NoOpStore's no-op is required too.

Task 2: EDIT src/snapshot/git.ts — ADD async destroy() to GitBackend
  - ADD the method (mirroring the gc()/capture() mutex idiom). ROBUST form (shadowDir unset pre-init):
      async destroy(): Promise<void> {
        const release = await this.mutex.acquire();      // serialize vs in-flight capture/restore/gc
        try {
          try { await this.ensureInit(); } catch { /* never init'd / transient — nothing to reclaim */ }
          if (this.shadowDir) {
            try { await fsRm(this.shadowDir, { recursive: true, force: true }); } catch { /* best-effort */ }
          }
        } finally {
          release();
        }
      }
  - ADD the import of fs.rm: `import { rm as fsRm } from "node:fs/promises";` (git.ts already imports from
    node:fs — check the existing import block + extend it; do NOT duplicate). If git.ts uses a `deps.unlink` DI
    seam for fs, mirror that seam for rm (optional — rm is teardown-only; a direct import is acceptable + matches
    the "teardown never blocks" contract). Prefer the direct import unless the existing tests' DI seam requires it.
  - WHY: delete the per-repo shadow repo subdir on shutdown (PRD §5 "no cross-session buildup"). shadowDir is
    `join(storageDir, shadowKey(repoRoot))` — deleting it leaves the (possibly shared) storageDir + other repos'
    shadow dirs intact. The shadow repo is recreated on the next session's first capture (idempotent init).
  - GOTCHA: shadowDir is `!`-asserted + assigned only in ensureInit(). The `if (this.shadowDir)` guard + the
    ensureInit() try/catch handle the pre-init case. force:true makes rm a no-op on a missing dir. Ensure the
    `release()` is in a `finally` (a forgotten release deadlocks all later acquire()s — AsyncMutex GOTCHA #5).

Task 3: EDIT src/snapshot/cas.ts — ADD async destroy() to CasBackend
  - ADD the method (simpler than git — storageDir is always set, no init gate):
      async destroy(): Promise<void> {
        const release = await this.mutex.acquire();
        try {
          try { await fsRm(this.storageDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        } finally {
          release();
        }
      }
  - ADD the import of fs.rm: `import { rm as fsRm } from "node:fs/promises";` (cas.ts already imports
    mkdir/readFile/etc from node:fs/promises — extend that import line; do NOT duplicate). If cas.ts uses a
    `deps.fs` DI seam, prefer routing rm through it for testability; otherwise a direct import is fine.
  - WHY: delete the whole CAS dir on shutdown (PRD §5 "delete <storageDir> entirely").
  - GOTCHA: storageDir is resolved in the ctor (always set) — no ensureInit gate. force:true tolerates a missing
    dir. release() in finally.

Task 4: EDIT src/runtime.ts — ADD exported getActiveStores()
  - ADD (near clearAll):
      /**
       * Enumerate the snapshot STORE of every active runtime (for session_shutdown teardown — index.ts destroys
       * each before clearAll()). Returns only runtimes whose `store` was assigned (i.e. session_start ran with
       config.revert.enabled). Empty array when no session created a store. Never throws.
       */
      export function getActiveStores(): SnapshotStore[] {
        const stores: SnapshotStore[] = [];
        for (const rt of runtimes.values()) {
          if (rt.store) stores.push(rt.store);
        }
        return stores;
      }
  - WHY: session_shutdown enumerates ALL sessions' stores (the Map is private). Consumers that need ONE session's
    store read getRuntime(sid).store directly; only teardown needs the full set.
  - GOTCHA: SnapshotStore is ALREADY type-imported in runtime.ts (`import type { SnapshotStore } from
    "./snapshot/store.js"`) — reuse it; do NOT add a duplicate import. This is a ~6-line additive function.

Task 5: EDIT src/index.ts — wire the store lifecycle into session_start + session_shutdown
  - EXTEND the imports:
      import { resetRuntime, clearAll, getRuntime, getActiveStores } from "./runtime.js";
      import { setLogFile, log } from "./log.js";                 // was: import { setLogFile } from "./log.js";
      import { registerTurnStartCapture, gcTurnSnapshots } from "./capture.js";  // was: { registerTurnStartCapture }
      import { detectAndCreate } from "./snapshot/store.js";       // NEW line
  - REWRITE the session_start handler (step 6) to be ASYNC + APPEND the gated store block (see Implementation
    Patterns). Preserve setConfig → setLogFile → resetRuntime → reconcileBanner verbatim; read `sid` once; the
    store block is the tail, gated on getConfig().revert.enabled, wrapped in try/catch → log on error.
  - REWRITE the session_shutdown handler (step 7) to be ASYNC + destroy all active stores before clearAll()
    (see Implementation Patterns). Per-store try/catch (best-effort).
  - WHY: the deliverable — the store lifecycle is wired into the Pi session lifecycle.
  - GOTCHA: do NOT add registerAgentEndCapture (S2 owns it). Do NOT touch step 5. Do NOT reorder the existing
    session_start body (resetRuntime + reconcileBanner stay before the store block). The `async` keyword on the
    handler is the only signature change (Pi awaits async handlers — verified).

Task 6: EDIT test/index.test.ts — ADD session_start store + session_shutdown destroy tests
  - ADD `vi.mock("../src/snapshot/store.js", ...)` at the top (alongside the existing settings/log mocks) OR a
    RecordingStore fake defined inline + program via detectAndCreate spy. Minimal: mock detectAndCreate to return
    a fake store with gc + destroy spies (a plain object cast to SnapshotStore). Reuse makeCtx + makeStartEvent.
  - ADD describe block "index.ts session_start store lifecycle (T2.S1)":
      - it("does NOT call detectAndCreate when revert.enabled is false (gate is first)") — DEFAULT_CONFIG →
        detectAndCreate NOT called (assert spy call count 0); getRuntime(sid).store is undefined.
      - it("creates the store + caches it on rt.store when revert.enabled is true") — setConfig({revert:{enabled:
        true, storageDir:"<tmp>"}}); program detectAndCreate.mockResolvedValue(fakeStore); await
        handlers["session_start"]!(makeStartEvent("reload"), makeCtx("s1","/proj")); assert getRuntime("s1").store
        === fakeStore; assert detectAndCreate called with (cwd, revertConfig).
      - it("runs the prompt-boundary GC after store creation") — assert fakeStore.gc called exactly once (via
        gcTurnSnapshots). (Optionally: assert gcTurnSnapshots was called by checking the fake.gc spy.)
      - it("NEVER rejects when detectAndCreate rejects — logs + continues") — program detectAndCreate to reject;
        await the handler → no throw; resetRuntime still ran (getRuntime(sid).seq===0); a log line was emitted.
      - it("resetRuntime still runs when the store block throws") — same as above but assert runtime is fresh.
  - ADD describe block "index.ts session_shutdown teardown (T2.S1)":
      - it("calls destroy() on every active store before clearAll()") — seed getRuntime("s1").store=fakeStore +
        getRuntime("s2").store=otherFake; await handlers["session_shutdown"]!(); assert fakeStore.destroy +
        otherFake.destroy each called once; assert clearAll ran (next getRuntime is fresh / stores gone).
      - it("destroy failure on one store does NOT skip the rest or clearAll") — fakeStore.destroy rejects;
        otherFake.destroy resolves; await → no throw; otherFake.destroy still called; clearAll ran.
      - it("is a no-op (no destroy calls) when no session created a store") — no stores seeded; await → no throw.
  - UPDATE the "arms the N event handlers" test ONLY IF S2 landed (registerAgentEndCapture adds "agent_end" → the
    expected list grows by one). If S2 has NOT landed, leave the test as-is (6 handlers). Do NOT add agent_end
    yourself — coordinate: if the test fails on "agent_end missing", that means S2 hasn't wired it (not this task).
  - WHY: validate the gate ordering, store caching, GC invocation, fail-open, teardown destroy + clearAll ordering.
  - GOTCHA: detectAndCreate is imported in index.ts from "./snapshot/store.js"; the mock path is "../src/snapshot/
    store.js". The fake pi's `.on` captures handlers keyed by event; session_start/session_shutdown are present
    (registered in steps 6/7). Use `await handlers["session_start"]!(...)` (it's now async). revert.enabled tests
    must setConfig BEFORE firing the handler (getConfig is read inside).
```

### Implementation Patterns & Key Details

```typescript
// src/index.ts — the EDITED session_start handler (step 6). Preserves the existing body; APPENDS the store block.
// The imports are EXTENDED (detectAndCreate, gcTurnSnapshots, getRuntime, getActiveStores, log) — shown below.

// import lines (EXTEND — do not duplicate):
//   import { resetRuntime, clearAll, getRuntime, getActiveStores } from "./runtime.js";
//   import { setLogFile, log } from "./log.js";
//   import { registerTurnStartCapture, gcTurnSnapshots } from "./capture.js";
//   import { detectAndCreate } from "./snapshot/store.js";

pi.on("session_start", async (_event, ctx) => {
  setConfig(loadMulliganConfig(ctx.cwd));
  setLogFile(getConfig().log.file);
  const sid = ctx.sessionManager.getSessionId(); // FRESH (C12); read once, reuse below
  resetRuntime(sid);
  reconcileBanner(ctx); // [P2.M3.T1.S3 / spec/13 §5] restore the banner on every session start

  // [P3.M1.T2.S1 / spec/14 §5] v1.2 working-tree revert: create the per-session store (cached on rt.store) +
  // run the prompt-boundary GC pass (reuses turn_start's gcTurnSnapshots) to clear stale turn/* refs left on
  // disk by a RELOADED instance (E32 — "session_start runs the same pass"). detectAndCreate NEVER rejects
  // (→ NoOpStore on any error, E28); gcTurnSnapshots NEVER throws. The try/catch is belt-and-suspenders for
  // this CRITICAL path — a store failure must NEVER block config reload / runtime reset / banner reconcile.
  if (!getConfig().revert.enabled) return; // layer-1 gate (default false → zero capture, zero storage)
  try {
    const rt = getRuntime(sid); // the FRESH runtime resetRuntime just (re)created (store undefined, empty snapshots)
    rt.store = await detectAndCreate(ctx.cwd, getConfig().revert); // create + cache (NEVER rejects → NoOpStore)
    await gcTurnSnapshots(rt); // REUSE capture.ts's pass — gc() drops all turn/* refs on disk + clears in-memory
  } catch (e) {
    try {
      log("error", "session_start.store", sid, { error: String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
  }
});

// src/index.ts — the EDITED session_shutdown handler (step 7). ASYNC; destroy every store best-effort first.
pi.on("session_shutdown", async () => {
  // [P3.M1.T2.S1 / spec/14 §5] v1.2 working-tree revert: best-effort destroy every session's snapshot store
  // (git shadow repo / CAS dir) BEFORE clearAll() wipes the runtime map — "Both stores are deleted entirely
  // on session_shutdown (no cross-session buildup)." A destroy failure is swallowed — teardown never blocks.
  for (const store of getActiveStores()) {
    try {
      await store.destroy(); // backend-agnostic: git → rm shadowDir; cas → rm storageDir; none → no-op
    } catch {
      /* best-effort — a store.destroy failure never blocks teardown / clearAll */
    }
  }
  clearAll();
});

// src/snapshot/git.ts — the NEW destroy() method on GitBackend (add inside the class, near gc()).
// shadowDir is `!`-asserted + set in ensureInit(); the guard + force:true handle the pre-init case.
async destroy(): Promise<void> {
  const release = await this.mutex.acquire(); // serialize vs in-flight capture/restore/gc (spec §4.3)
  try {
    try {
      await this.ensureInit(); // resolve shadowDir (idempotent + memoized; may init-then-we-delete — harmless)
    } catch {
      /* never initialized / transient failure — shadowDir unset → nothing to reclaim */
    }
    if (this.shadowDir) {
      try {
        await fsRm(this.shadowDir, { recursive: true, force: true }); // force:true → no-op if absent
      } catch {
        /* best-effort — never reject teardown */
      }
    }
  } finally {
    release(); // AsyncMutex GOTCHA #5 — forgotten release deadlocks all later acquire()s
  }
}

// src/snapshot/cas.ts — the NEW destroy() method on CasBackend (simpler — storageDir always set).
async destroy(): Promise<void> {
  const release = await this.mutex.acquire();
  try {
    try {
      await fsRm(this.storageDir, { recursive: true, force: true }); // the whole CAS dir (spec §5)
    } catch {
      /* best-effort — never reject teardown */
    }
  } finally {
    release();
  }
}

// src/runtime.ts — the NEW getActiveStores() (add near clearAll). SnapshotStore is ALREADY type-imported.
export function getActiveStores(): SnapshotStore[] {
  const stores: SnapshotStore[] = [];
  for (const rt of runtimes.values()) {
    if (rt.store) stores.push(rt.store);
  }
  return stores;
}

// src/snapshot/store.ts — the interface addition + NoOpStore no-op.
// (SnapshotStore interface, after gc():)
//   /** Best-effort full teardown (spec/14 §5). Wipes on-disk storage. Serialized by the mutex. NEVER rejects. */
//   destroy(): Promise<void>;
// (NoOpStore, after its gc():)
//   async destroy(): Promise<void> { /* no-op — nothing to reclaim in a no-op store */ }
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES. This task is in-process TS wiring (interface method + 3 impls + 1 runtime helper + 2
handler rewrites + tests). Imports are .js-specifier ESM.
EVENT: pi.on("session_start", …) — fires on startup|reload|new|resume|fork. Now ASYNC (Pi awaits it). The store
  block is the tail, gated on revert.enabled, try/catch fail-open.
EVENT: pi.on("session_shutdown", …) — fires on exit. Now ASYNC. Destroys all stores best-effort then clearAll().
STORE INTERFACE: SnapshotStore gains destroy() — GitBackend/CasBackend/NoOpStore implement it. Backward-
  compatible (additive; the 3 impls are added in the same task → tsc stays green).
RUNTIME: SessionRuntime.store ALREADY EXISTS (P1.M2.T2.S2 + S1 added the type). getActiveStores() NEW. The store
  is created in session_start (this task) and read by: capture hooks (P3.M1.T1 — already guard `if (!rt.store)`),
  rewindExecute (P4.M2.T1 — reads getRuntime(sid).store for dirtyCheck/restore), checkpoint command (P3.M2 —
  reads it for capture). This task POPULATES it; the consumers read it.
CONFIG: getConfig().revert.enabled is the layer-1 gate (default false → no store). revert.storageDir must be
  configured (non-null) for a non-NoOp store (no sessionDir on ctx). This task does NOT edit config.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project after Tasks 1-6. The destroy() interface addition resolves in all 3 impls;
# getActiveStores resolves (SnapshotStore type-import already present); the async handlers type-check; the
# new index.ts imports resolve.
npx tsc --noEmit
npx tsc --noEmit 2>&1 | grep -E 'index.ts|runtime.ts|snapshot/(store|git|cas).ts'  # isolate this task's files

# LSP diagnostics on each edited file (fast, in-editor)
# (call lsp_diagnostics on src/index.ts, src/runtime.ts, src/snapshot/store.ts, src/snapshot/git.ts,
#  src/snapshot/cas.ts, test/index.test.ts — expect no diagnostics)

# Format check
npx prettier --check src/index.ts src/runtime.ts src/snapshot/store.ts src/snapshot/git.ts \
  src/snapshot/cas.ts test/index.test.ts

# Expected: Zero errors. If tsc flags "GitBackend/CasBackend incorrectly implements SnapshotStore: missing
# destroy", Tasks 2/3 didn't add the method — add it. If tsc flags "Property 'store' does not exist on
# SessionRuntime", runtime.ts's existing store field is somehow absent — re-add it (it should be present).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the index suite (fast feedback while implementing).
npx vitest run test/index.test.ts

# Confirm the snapshot backend suites still pass (the destroy() additions are additive — capture/restore/gc
# untouched). Run these to be safe.
npx vitest run test/git.test.ts test/cas.test.ts test/store.test.ts

# Full suite — confirm no regressions.
npx vitest run

# Expected: ALL green. The existing index.test.ts session_start tests (revert off) still pass (the store block
# early-returns before any await). The new store/teardown tests pass. The backend suites pass (destroy is additive).
```

`test/index.test.ts` describe/it blocks ADDED by this task (driven by a mocked detectAndCreate + fake stores):

```yaml
describe("index.ts session_start store lifecycle (T2.S1)"):
  - it("does NOT call detectAndCreate when revert.enabled is false (gate is first; DEFAULT_CONFIG)")
  - it("creates the store via detectAndCreate + caches it on getRuntime(sid).store when revert.enabled is true")
  - it("passes (ctx.cwd, getConfig().revert) to detectAndCreate (2-arg call)")
  - it("runs the prompt-boundary GC (store.gc called once via gcTurnSnapshots) after store creation")
  - it("NEVER rejects when detectAndCreate rejects — logs 'session_start.store' + the runtime is still fresh")
  - it("resetRuntime still ran (seq===0) when the store block throws — config reload + banner unaffected")

describe("index.ts session_shutdown teardown (T2.S1)"):
  - it("calls destroy() on EVERY active store before clearAll() (2 seeded stores → 2 destroy calls)")
  - it("a destroy() rejection on one store does NOT skip the other stores OR clearAll()")
  - it("is a no-op (no destroy calls, no throw) when no session created a store")
  - it("clearAll ran after destroy (next getRuntime(sid) is fresh; getActiveStores() is empty)")
```

### Level 3: Integration Testing (System Validation)

```bash
# This task is UNIT-tier (test/index.test.ts). The end-to-end store-creation→capture→restore→teardown flow is
# validated by the F-revert-* integration scenarios in P5.M1.T1 (Tier 2 — real temp git/non-git dirs, real
# backends; specifically F-revert-reload exercises the session_start GC + cross-reload, and F-revert-delete
# exercises session_shutdown teardown). This task does NOT add those.

# Smoke (optional, manual): confirm session_start creates a real store + session_shutdown wipes it, against a
# real temp git repo + configured storageDir:
tmp=$(mktemp -d) && storeDir=$(mktemp -d) && cd "$tmp" && git init -q && printf 'a\n' > f.txt
node --input-type=module -e "
import detectAndCreate from '<repo>/src/snapshot/store.js';   // resolve to the built src
const cfg = { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:'cas', storageDir:'$storeDir',
  maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
  excludeGlobs:['.git','node_modules','dist','build','.next','.venv','target'] };
const store = await detectAndCreate('$tmp', cfg);
console.log('backend:', store.describe().backend);            // expect 'git'
console.log('gc ok:', await store.gc());                        // expect undefined (void)
await store.destroy();
import { existsSync } from 'node:fs';
console.log('shadow dir gone after destroy:', !existsSync('$storeDir'));  // git wipes the per-repo subdir
"
cd - && rm -rf "$tmp" "$storeDir"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm NO edits to files outside this task's scope (the only files touched: index.ts, runtime.ts,
# snapshot/{store,git,cas}.ts, test/index.test.ts):
git status --porcelain | grep -E 'capture.ts|config.ts|markers.ts|nudges.ts|tools/|commands.ts|tasks.json|prd_snapshot|PRD.md' \
  && echo "ERROR: touched an out-of-scope/locked file" || echo "OK: scope respected"

# Parity check: session_start + session_shutdown handlers must mirror the fail-open discipline. Confirm both are
# async + wrap the NEW work in try/catch (the existing session_start body stays try/catch-free as before):
rg -n "session_start|session_shutdown|async \(_event|async \(\) =>|detectAndCreate|gcTurnSnapshots|getActiveStores|destroy" src/index.ts
# Expected: both handlers `async`; session_start has the `if (!getConfig().revert.enabled) return` gate + try/catch
# around detectAndCreate+gcTurnSnapshots; session_shutdown has the for-loop + per-store try/catch + clearAll.

# Confirm destroy() is implemented by ALL three (or tsc would have failed — but double-check the impls exist):
rg -n "async destroy" src/snapshot/store.ts src/snapshot/git.ts src/snapshot/cas.ts
# Expected: 3 matches (NoOpStore in store.ts, GitBackend in git.ts, CasBackend in cas.ts).

# Confirm getActiveStores is exported + does not leak the private Map:
rg -n "export function getActiveStores" src/runtime.ts
# Expected: 1 match. (The runtimes Map stays private — getActiveStores returns an array of stores, not the Map.)

# Confirm registerAgentEndCapture was NOT added by this task (S2 owns it — avoid conflict):
rg -n "registerAgentEndCapture" src/index.ts
# Expected: 0 matches (or 1 ONLY if S2 landed — if present, S2 wired it; this task did not). If 0, that's correct
# for this task (S2 is parallel).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean — `destroy()` resolves in GitBackend/CasBackend/NoOpStore; `getActiveStores()`
      resolves; the async session_start/session_shutdown handlers type-check; the new index.ts imports resolve.
- [ ] `npx vitest run test/index.test.ts` — ALL green (session_start store-creation gate/caching/GC/fail-open;
      session_shutdown destroy-all/clearAll ordering; existing revert-off tests still pass).
- [ ] `npx vitest run test/git.test.ts test/cas.test.ts test/store.test.ts` — green (destroy is additive; the
      backend suites' capture/restore/gc are untouched).
- [ ] `npx vitest run` — full suite green (no regressions).
- [ ] `lsp_diagnostics` on all 6 edited files — no diagnostics.
- [ ] `.js` import specifiers preserved (EXTEND existing import lines; one NEW line for detectAndCreate).
- [ ] No new npm dependencies (node:fs/promises rm is built-in; git.ts/cas.ts already import from node:fs).

### Feature Validation
- [ ] When `config.revert.enabled === false`, session_start returns before detectAndCreate/getRuntime/gcTurnSnapshots
      (gate first) — behaves exactly as before; `rt.store` stays undefined.
- [ ] When enabled, after session_start resolves: `getRuntime(sid).store` is the detectAndCreate return + `store.gc()`
      was called once (via gcTurnSnapshots).
- [ ] session_start NEVER rejects on any error (detectAndCreate/gc throw, getConfig throw) — logs + continues;
      resetRuntime + reconcileBanner always ran.
- [ ] session_shutdown calls `destroy()` on every active store (best-effort) BEFORE clearAll(); a destroy failure
      on one store doesn't skip the rest or clearAll.
- [ ] GitBackend.destroy() deletes shadowDir (recursive, force, never rejects); CasBackend.destroy() deletes
      storageDir (recursive, force, never rejects); NoOpStore.destroy() is a no-op.

### Code Quality Validation
- [ ] The `destroy()` interface addition follows the backend-agnostic principle (mirrors gc()) — index.ts never
      branches on backend or reconstructs private paths.
- [ ] File placement matches the desired tree (EDIT index.ts, runtime.ts, snapshot/{store,git,cas}.ts, test/index.test.ts).
- [ ] Anti-patterns avoided (no ctx.sessionId; no fs.rm in index.ts; no new handler registrations; no capture.ts
      edits; no duplicate store field; no out-of-scope edits).
- [ ] JSDoc on the session_start store block + session_shutdown destroy loop cites `@14 §5` (Mode A — rides with
      the work); destroy() interface JSDoc + each impl JSDoc cite `@14 §5`.
- [ ] Dependencies respected: registerTurnStartCapture confirmed present (S1 ✓); registerAgentEndCapture NOT
      added (S2 owns it — parallel); the store field confirmed present (P1.M2.T2.S2/S1); does NOT implement
      capture hooks (P3.M1.T1) / checkpoint capture (P3.M2) / rewind step 6b (P4.M2).

### Documentation & Deployment
- [ ] Code is self-documenting (clear var/fn names; the gate ordering + GC reuse + teardown ordering are commented inline).
- [ ] No new environment variables (config.revert.* already shipped in P1.M1.T1.S1).

---

## Anti-Patterns to Avoid

- ❌ Don't re-add `store?: SnapshotStore` to SessionRuntime — it ALREADY EXISTS (runtime.ts). Contract part (a) is
  done; only VERIFY it. A duplicate field is a TS error.
- ❌ Don't do `fs.rm` directly in index.ts (contract (d)'s literal form) — git's shadow path needs the
  module-private `shadowKey` + async `repoRoot`. ADD a backend-agnostic `destroy()` to the interface instead; each
  backend knows its own path. index.ts calls `await store.destroy()`.
- ❌ Don't add `registerAgentEndCapture(pi)` — S2 (P3.M1.T1.S2, parallel) owns it. Adding it here duplicates/conflicts.
  This task only VERIFIES `registerTurnStartCapture` is present (S1 ✓).
- ❌ Don't use `ctx.sessionId` (doesn't exist) — use `ctx.sessionManager.getSessionId()`. Read it ONCE into `sid`
  and reuse for resetRuntime + getRuntime.
- ❌ Don't make session_start synchronous-after-await or skip the try/catch — detectAndCreate/gcTurnSnapshots are
  already fail-open, but session_start is CRITICAL; wrap the store block in try/catch → log + continue so config
  reload / runtime reset / banner reconcile ALWAYS run.
- ❌ Don't forget `release()` in destroy()'s `finally` — a forgotten AsyncMutex release deadlocks all later
  acquire()s (AsyncMutex GOTCHA #5). Mirror the capture/restore/gc mutex idiom exactly.
- ❌ Don't let `destroy()` reject — it's teardown; a locked file / permission / transient IO failure must NEVER
  block clearAll/exit. try/catch the fs.rm + use `{force:true}` (no-op on missing dir).
- ❌ Don't skip the mutex in destroy() — a destroy racing an in-flight capture/restore would corrupt state.
  Acquire the mutex (serialized like gc()).
- ❌ Don't gate session_start's store block with anything other than `getConfig().revert.enabled` FIRST — it is the
  layer-1 gate (default false → zero storage). Put it as the FIRST statement of the store block.
- ❌ Don't edit capture.ts's `gcTurnSnapshots` — REUSE it (import into index.ts). Editing it risks the turn_start
  hook (P3.M1.T1.S1). gcTurnSnapshots already guards `if (!rt.store) return` + never throws — perfect for reuse.
- ❌ Don't invent a `sessionDir` source — ExtensionContext has none. detectAndCreate is a 2-arg call; when
  storageDir is null the store fails-open to NoOpStore (correct, safe — a non-NoOp store requires revert.storageDir).
- ❌ Don't reorder the existing session_start body — setConfig → setLogFile → resetRuntime → reconcileBanner stay
  in that order; the store block is the TAIL (after reconcileBanner).
- ❌ Don't touch the SnapshotStore interface's existing methods (capture/restore/dirtyCheck/has/retire/gc) — only
  ADD destroy(). The P2 backends are Complete; the addition is backward-compatible.

---

## Confidence Score

**8.5/10** — one-pass success highly likely. This is well-scoped lifecycle wiring (2 async handler rewrites + 1
interface method + 3 impls + 1 runtime helper + tests) that follows established patterns verbatim: the store
block mirrors the capture hooks' fail-open discipline (gate → guarded store access → try/catch → log); `destroy()`
mirrors `gc()` (interface method + mutex + best-effort + never-reject); `getActiveStores()` is a 6-line
enumeration of the private Map. The two design decisions are FORCED by the codebase (not arbitrary): (1)
`destroy()` is REQUIRED because git's shadow path is module-private (contract (d)'s literal fs.rm-in-index.ts is
infeasible); (2) `getActiveStores()` is REQUIRED because the runtimes Map is private (no other clean enumeration
seam). The `store?` field is already present (contract (a) done). Residual risks: (a) the async session_start
handler — mitigated by the revert.enabled gate (default false → existing tests see synchronous behavior); (b)
coordination with S2 (registerAgentEndCapture) — mitigated by explicit deferral (this task's store lifecycle is
independent of the agent_end hook); (c) the git shadowDir-unset-pre-init edge in destroy() — mitigated by the
`if (this.shadowDir)` guard + `force:true` + the ensureInit try/catch. The success criteria are independently
testable with a mocked detectAndCreate + recording fake stores.