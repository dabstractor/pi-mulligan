# PRP — P3.M1.T1.S1: `turn_start` hook (prompt-boundary GC + capture `"turn"`)

**Spec refs**: spec/14-working-tree-revert.md §5 (capture lifecycle & retention — the prompt-boundary
GC pass), §2 (the `SnapshotStore` interface), §4.3 (AsyncMutex serializes capture/dirtyCheck/restore/
retire/**gc**), §6 (restore consumes `rt.snapshots.get("turn")`), E27/E28 (best-effort fail-open).
architecture/codebase_patterns.md §6 (event-handler registration pattern) + §8 (store-threading
decision: store handle on `SessionRuntime`). JSDoc on the new handler + `gc()` cites `@14 §5` (Mode A,
rides with the work — work-item DOCS clause).

---

## Goal

**Feature Goal**: Arm the `turn_start` event hook that (a) runs the **prompt-boundary GC FIRST** — drop
every `turn/*` snapshot ref on disk (git shadow `refs/mulligan/snapshots/turn/*` / CAS `turn/*`
manifests) and physically reclaim (git `gc --auto --prune=now` / CAS blob mark-sweep) — then (b)
**capture `"turn"`** and store its before-ref in `SessionRuntime.snapshots` so a `last_turn` rewind
(P4.M2.T1.S1 step 6b) can restore the working tree to the start of the turn. This is the **capture
half** of the v1.2 working-tree-revert feature.

**Deliverable**:
1. NEW `src/capture.ts` exporting `gcTurnSnapshots(rt)`, `turnStartCaptureHandler(event, ctx)`,
   `registerTurnStartCapture(pi)` (mirrors the `registerBloatReminder`/`registerTurnEndMetric` seam in
   `nudges.ts`).
2. EDIT `src/snapshot/store.ts` — ADD `gc(): Promise<void>` to the `SnapshotStore` interface +
   `NoOpStore` (the locked interface has NO gc method today — see "Known Gotchas").
3. EDIT `src/snapshot/git.ts` — implement `gc()` (namespace-delete `turn/*` + `git gc --auto --prune=now`).
4. EDIT `src/snapshot/cas.ts` — APPEND `gc()` (mark-sweep; additive after P2.M3.T1.S3 lands).
5. EDIT `src/runtime.ts` — ADD the `store?: SnapshotStore` field to `SessionRuntime` (type-only import).
6. EDIT `src/index.ts` — wire `registerTurnStartCapture(pi)` in step 5.
7. NEW `test/capture.test.ts` — Tier-1 unit tests (fakes, no Pi).

**Success Definition**: `registerTurnStartCapture(pi)` registers a `turn_start` handler that, on every
turn when `config.revert.enabled` and `rt.store` is non-null: calls `rt.store.gc()` (clearing all prior
turns' on-disk `turn/*` refs + reclaiming), clears in-memory `turn/*` entries, then `capture("turn")`
and writes `rt.snapshots.get("turn") = { label:"turn", backend, beforeRef, turnIndex, ts }`. The handler
is async, **NEVER throws** (E27), reads `sessionId` first, and no-ops cleanly when revert is disabled /
the store is absent (NoOpStore / `rt.store` undefined). `npx tsc --noEmit` clean; `npx vitest run
test/capture.test.ts` green; the full suite (`npx vitest run`) still green.

## User Persona

**Target User**: Implementer agent (this PRP's consumer). End users never invoke the hook directly —
Pi fires `turn_start` at the start of every agent turn; the hook maintains the before-ref consumed by
`rewindExecute` step 6b (P4.M2.T1.S1) for `last_turn` / `last_tool_call_group` reverts.

**Use Case**: A user opts into `config.revert.enabled`, runs a turn that edits files, then invokes
`mulligan_rewind` with `revert_file_changes:true`. The rewind tool reads `rt.snapshots.get("turn").beforeRef`
to restore the working tree to the start of the turn. Without this hook, that ref is never captured →
file-revert is impossible.

**Pain Points Addressed**: (1) unbounded snapshot growth — the prompt-boundary GC is the PRIMARY
reclamation strategy (PRD §5); without it, `turn/*` refs accumulate forever. (2) no before-ref for
`last_turn` revert — the capture half of file-revert is missing.

## Why

- **Reclamation (PRD §5)**: "no rewind can cross a user prompt except a checkpoint rewind —
  `last_turn`/`last_tool_call_group` only ever target the current turn, so once a new prompt arrives
  every prior turn's snapshots are dead." GC'ing at `turn_start` (before the new capture) is the safe
  moment. Checkpoints live in a separate namespace (`checkpoint/*`) and are **exempt**.
- **Capture (PRD §5)**: `turn_start` → `capture("turn")` is the turn's **before** ref; the after-ref
  (`agent_end`, P3.M1.T1.S2) makes `dirtyCheck` effective. This task delivers the before-ref.
- **Foundation for P3.M1.T1.S2 (agent_end) + P4.M2.T1.S1 (rewind step 6b)**: both read `rt.snapshots`.
  This hook populates `rt.snapshots.get("turn").beforeRef`. It also defines the shared `gcTurnSnapshots(rt)`
  helper that P3.M1.T2.S1's `session_start` GC will reuse.
- **Scope guard**: this task implements ONLY the `turn_start` hook + the `gc()` store method it needs.
  It does NOT implement the `agent_end` hook (P3.M1.T1.S2), store creation/assignment in `session_start`
  (P3.M1.T2.S1 — this task only ADDS the `rt.store` FIELD and reads it), the checkpoint capture (P3.M2),
  nor rewind step 6b (P4.M2). Stay in lane.

## What

### `registerTurnStartCapture(pi)` — the registration seam (NEW, src/capture.ts)
`registerTurnStartCapture(pi: ExtensionAPI): void` — registers `pi.on("turn_start", turnStartCaptureHandler)`.
Mirrors `registerBloatReminder(pi)` exactly (the handler needs no `pi`, so it is registered directly —
contrast `registerTurnEndMetric` which wraps to capture `pi`). Always registered (the gate lives INSIDE
the handler, so registering is free when revert is off).

### `turnStartCaptureHandler(event, ctx)` — the handler (NEW, src/capture.ts)
`async turnStartCaptureHandler(event: TurnStartEvent, ctx: ExtensionContext): Promise<void>`. Async (Pi
awaits event handlers). Body, ALL inside ONE try/catch (E27 — never throws; read `sessionId` FIRST so
the catch can log it):
1. `sessionId = ctx.sessionManager.getSessionId()` (FRESH — C12).
2. `if (!getConfig().revert.enabled) return;` (gate layer 1).
3. `const rt = getRuntime(sessionId);` (STRING arg — GOTCHA).
4. `if (!rt.store) return;` (store not created — config was off at `session_start` / P3.M1.T2.S1 not
   wired yet; fail-open no-op).
5. `await gcTurnSnapshots(rt);` (GC FIRST — drop all `turn/*` refs + reclaim + clear in-memory turn/*).
6. `const backend = rt.store.describe().backend;` `if (backend === "none") return;` (NoOpStore — skip).
7. `const beforeRef = await rt.store.capture("turn");` `if (beforeRef)` → `rt.snapshots!.set("turn",
   { label:"turn", backend, beforeRef, turnIndex: event.turnIndex, ts: Date.now() })`.
8. catch → `log("error", "capture.turn_start", sessionId, { error: String(e) })` (best-effort; `log`
   never throws but guard it anyway).

### `gcTurnSnapshots(rt)` — the shared prompt-boundary GC helper (NEW, src/capture.ts, EXPORTED)
`async gcTurnSnapshots(rt: SessionRuntime): Promise<void>`. EXPORTED so P3.M1.T2.S1's `session_start`
GC reuses it (PRD §5: "session_start runs the same pass to clear stale turn/* refs from a reloaded
instance"). Body: `if (!rt.store) return;` → `try { await rt.store.gc(); } catch { /* best-effort;
gc() never rejects but be belt-and-suspenders */ }` → clear in-memory `turn/*` entries:
`for (const key of [...(rt.snapshots?.keys() ?? [])]) if (key.startsWith("turn")) rt.snapshots?.delete(key);`
(checkpoint entries keyed `checkpoint:<name>` are PRESERVED — they do NOT start with "turn"). NEVER throws.

### `SnapshotStore.gc()` — the namespace GC (NEW method, ALL backends)
`gc(): Promise<void>` — the prompt-boundary reclamation pass (PRD §5). Drops ALL `turn/*` refs/manifests
(the whole namespace, so prior turns with no in-memory entry are reclaimed too) + physically reclaims
(`git gc --auto --prune=now` / CAS blob mark-sweep). **`checkpoint/*` is EXEMPT** (separate namespace).
Mutex-serialized (§4.3). BEST-EFFORT (E27): NEVER rejects — failure is logged + degrades only to slower
reclamation (objects linger until a later gc or `session_shutdown`); never blocks the turn.

### Success Criteria
- [ ] `pi.on("turn_start", …)` is registered exactly once by `registerTurnStartCapture` (assertable via
  a fake `pi` with an `on` spy).
- [ ] When `config.revert.enabled === false`, the handler returns BEFORE touching the store (no gc, no
  capture) — the gate is the FIRST check after reading sessionId.
- [ ] When `rt.store` is undefined, the handler no-ops (does not throw).
- [ ] When `rt.store.describe().backend === "none"` (NoOpStore), the handler skips capture (no
  `rt.snapshots.set("turn", …)`).
- [ ] GC runs BEFORE capture: `rt.store.gc()` is awaited, THEN `capture("turn")` is called (ordering
  assertable via call-order on fakes).
- [ ] After a successful capture, `rt.snapshots.get("turn")` equals
  `{ label:"turn", backend:<git|cas>, beforeRef:<non-null>, turnIndex:<event.turnIndex>, ts:<number> }`.
- [ ] `gcTurnSnapshots` clears in-memory keys starting with `"turn"` but PRESERVES a `"checkpoint:foo"`
  entry (checkpoint namespace is exempt).
- [ ] `store.gc()` (git) deletes every `refs/mulligan/snapshots/turn/*` ref and leaves
  `refs/mulligan/snapshots/checkpoint/*` intact; runs `git gc --auto --prune=now`; never rejects.
- [ ] `store.gc()` (cas) deletes every `turn/*` manifest + mark-sweeps unreferenced blobs; leaves
  `ckpt:` manifests + their blobs intact; never rejects.
- [ ] The handler NEVER throws on ANY error (store throws, getConfig throws, etc.) — it logs + returns.
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/capture.test.ts` green; full `npx vitest run` green.

## All Needed Context

### Context Completeness Check
✅ "If someone knew nothing about this codebase, would they have everything needed?" — YES. The event-
handler registration pattern (`registerBloatReminder`/`registerTurnEndMetric`), the fail-open/never-
throws/log-first-sessionId discipline, the `SnapshotStore` interface + the backends, the
`SessionRuntime` shape, the git ref namespace, the config block, and the test idiom are all cited below
with exact paths + line anchors + the patterns to copy.

### Documentation & References

```yaml
# MUST READ — the authoritative spec for this task
- file: spec/14-working-tree-revert.md
  why: §5 (capture lifecycle — turn_start capture("turn"); the prompt-boundary GC pass deletes turn/*
       + git gc --auto --prune=now / CAS mark-sweep; checkpoints exempt, separate namespace;
       fail-open: gc failure logged + never blocks), §2 (SnapshotStore interface — the 6 methods; gc
       is NOT yet in it — see "Known Gotchas"), §4.3 (AsyncMutex serializes capture/dirtyCheck/restore/
       retire/gc — gc acquires the mutex), §6 (restore reads rt.snapshots.get("turn").beforeRef).
  critical: §5 "at each new prompt (turn_start), BEFORE capturing the new turn's snapshot, the store
       deletes every refs/mulligan/snapshots/turn/* ref ... and gc's the shadow repo." + "a git gc or
       CAS mark-sweep failure is logged and NEVER blocks the turn." + "Checkpoints are exempt (separate
       namespace)". §4.3 "the prompt-boundary GC pass ALSO acquires the mutex".

# THE PATTERN TO MIRROR — event-handler registration + fail-open discipline
- file: src/nudges.ts
  why: registerBloatReminder(pi) (line ~138 — `pi.on("tool_result", bloatReminderHandler)`, registered
       DIRECTLY because the handler needs no pi) + registerTurnEndMetric(pi) (line ~225 — wraps to
       capture pi in a closure). turnStartCaptureHandler mirrors bloatReminderHandler's structure:
       read sessionId FIRST, one try/catch, never throws, `log("error", category, sessionId, {error})`
       in the catch. The handler is async (await store.gc()/capture) — Pi awaits async handlers.
  pattern: `export function registerXxx(pi: ExtensionAPI): void { pi.on("turn_start",
       turnStartCaptureHandler); }` + `export async function turnStartCaptureHandler(event, ctx) { let
       sessionId=""; try { sessionId=ctx.sessionManager.getSessionId(); if(!getConfig().revert.enabled)
       return; ... } catch(e){ log("error","capture.turn_start",sessionId,{error:String(e)}); } }`.
  gotcha: getRuntime takes a STRING (sessionId), NOT ctx (GOTCHA #5 in nudges.ts). log takes
       (level, category, sessionId, detailsObj) — NOT ctx.

# THE INTERFACE TO EXTEND (add gc()) + the factory that creates the store
- file: src/snapshot/store.ts
  why: the SnapshotStore interface (lines ~38-110) — describe/capture/dirtyCheck/restore/has/retire,
       all ASYNC (Promise return). Append `gc(): Promise<void>` to the interface AFTER retire. NoOpStore
       (lines ~230-280) — add `async gc(): Promise<void> { /* no-op */ }`. AsyncMutex (the GC pass
       acquires it — §4.3). detectAndCreate (the factory P3.M1.T2.S1 calls at session_start — NOT this
       task; this task only reads rt.store).
  critical: there is NO gc() method today — this task ADDS it (the AsyncMutex JSDoc at line ~166 already
       references "the prompt-boundary GC pass" acquiring the mutex, so gc() is an intended-but-unadded
       method). store.ts is APPENDABLE (P2.M1.T1.S2 appended detectAndCreate + NoOpStore to it).

# THE GIT BACKEND — implement gc() here (mirror capture/retire structure)
- file: src/snapshot/git.ts
  why: the structure to mirror for gc(): the `async capture(label)` body (lines ~290-335 — acquire
       mutex → ensureInit → exec git commands via this.exec(git,args,this.shadowEnv()) → catch warn →
       finally release) + `retire(ref)` (lines ~443-465 — for-each-ref → update-ref -d loop). refForLabel
       (lines ~109-111) defines the namespaces: `refs/mulligan/snapshots/turn/<label>` vs
       `refs/mulligan/snapshots/checkpoint/<name>`.
  pattern: `async gc(): Promise<void> { const release=await this.mutex.acquire(); try { await
       this.ensureInit(); const out=await this.exec("git",["for-each-ref","--format=%(refname)",
       "refs/mulligan/snapshots/turn/"],this.shadowEnv()); for(const rn of out.stdout.split("\n").map
       (s=>s.trim()).filter(s=>s.length>0)) await this.exec("git",["update-ref","-d",rn],
       this.shadowEnv()); await this.exec("git",["gc","--auto","--prune=now"],this.shadowEnv()); }
       catch(err){ console.warn(\`[mulligan] snapshot.gc failed: ${...}\`); } finally { release(); } }`
  gotcha: ensureInit() MUST run first (the shadow repo may not exist yet on a fresh session — capture
       calls it). git gc --auto is self-throttling (no-op under the loose-object threshold). The
       for-each-ref PREFIX `refs/mulligan/snapshots/turn/` matches the WHOLE turn namespace (turn/turn,
       turn/turn-after) but NOT checkpoint/* — that is the exempt boundary.

# THE CAS BACKEND — APPEND gc() (mark-sweep); P2.M3.T1.S3 must be COMPLETE first
- file: src/snapshot/cas.ts
  why: after P2.M3.T1.S3 lands, CasBackend has: manifestPath(ref), blobPath(hash), this.fs (readFile/
       writeFile/mkdir/access/stat/readdir/unlink), this.storageDir, this.mutex, this.cfg. ref===label
       (the manifest filename); turn labels are "turn"/"turn-after"; checkpoint labels are "ckpt:<name>".
  pattern: `async gc(): Promise<void> { const release=await this.mutex.acquire(); try { const mdir=join
       (this.storageDir,"manifests"); let names:string[]=[]; try{ names=await this.fs.readdir(mdir); }
       catch{ return; } /* nothing to gc */ const surviving:Set<string>=new Set(); for(const f of
       names){ if(f.startsWith("ckpt")) { /* checkpoint — exempt: keep + collect its blobs */ const
       m=parseManifest((await this.fs.readFile(join(mdir,f))).toString("utf8")); for(const h of
       Object.values(m.files)) if(h.hash) surviving.add(h.hash); continue; } /* turn/* manifest —
       delete */ try{ await this.fs.unlink(join(mdir,f)); }catch{} } /* mark-sweep blobs */ const
       bdir=join(this.storageDir,"blobs"); let blobs:string[]=[]; try{ blobs=await this.fs.readdir(bdir);
       }catch{ return; } for(const b of blobs){ /* blob filename = <hash>; reclaim if unreferenced */ if
       (!surviving.has(b.replace(/\.blob$/,""))) { try{ await this.fs.unlink(join(bdir,b)); }catch{} } } }
       catch(err){ console.warn(\`[mulligan] snapshot.gc failed: ${...}\`); } finally { release(); } }`
  gotcha: ADDITIVE append (new method at the end of the class). P2.M3.T1.S3 edits the 6 existing methods
       IN PLACE, so an append does not conflict once that task is committed. This PRP SEQUENCES its work
       AFTER P2.M3.T1.S3 completes (see "Task Ordering"). Confirm the exact manifest/blob path helpers +
       blob filename convention by reading cas.ts at implementation time (they are defined by P2.M3.T1.S1).

# THE RUNTIME — add the store? field
- file: src/runtime.ts
  why: SessionRuntime (lines ~75-150) — already has `snapshots?: Map<string, RevertCheckpoint>` (P1.M2.
       T2.S2). ADD `store?: SnapshotStore;` (type-only import `import type { SnapshotStore } from
       "./snapshot/store.js"` — erased by tsc, keeps runtime.ts Pi-free). freshRuntime LEAVES it
       undefined (optional; P3.M1.T2.S1 assigns it). getRuntime(sessionId) takes a STRING.
  gotcha: the snapshots field is `snapshots?: Map<string, RevertCheckpoint>` — downstream reads it via
       `rt.snapshots?.…` (it is always initialized to a fresh Map by freshRuntime, but the `?.` keeps a
       hand-built runtime type-checking). RevertCheckpoint (markers.ts line ~121) = { label; backend:
       "git"|"cas"; beforeRef; afterRef?; turnIndex; ts }.

# THE WIRING — register the hook in index.ts
- file: src/index.ts
  why: step 5 (line ~60) registers the 3 existing hooks: registerFilterHandler, registerBloatReminder,
       registerTurnEndMetric. ADD `registerTurnStartCapture(pi);` there. Import it from "./capture.js".
  pattern: `import { registerTurnStartCapture } from "./capture.js";` ... `// 5. Arm the event-driven
       handlers` ... `registerTurnStartCapture(pi); // pi.on("turn_start", …) — v1.2 working-tree revert
       prompt-boundary GC + capture("turn")`. The handler self-guards on revert.enabled, so registration
       is unconditional (mirrors registerBloatReminder).

# THE CONFIG — the gate field
- file: src/config.ts
  why: the `MulliganConfig.revert` block (lines ~82-120) — `revert.enabled` (boolean, default false) is
       the layer-1 gate. Read via `getConfig().revert.enabled`. This task does NOT edit config.ts.
  critical: revert.enabled default false → zero capture, zero GC. The handler checks it FIRST.

# THE TEST IDIOM — mirror nudges.test.ts
- file: test/nudges.test.ts
  why: the pattern for testing registerXxx + an exported handler: a fake `pi` with an `on(event, fn)`
       spy (assert it was called with "turn_start" + the handler), a fake `ctx` (`{ sessionManager:
       { getSessionId: () => "s1" } }`), setConfig({...}) to drive getConfig(), set rt.store to a fake
       store (describe/capture/gc as vi.fn()), then invoke the exported handler directly with
       (event, ctx) and assert side effects. vitest flat describe/it/expect; `.js` imports; call
       clearAll() / setConfig(DEFAULT_CONFIG) in beforeEach to reset module state.
  gotcha: getRuntime caches per sessionId across tests — call clearAll() (runtime.ts) in beforeEach so
       each test gets a fresh runtime. setConfig must run before the handler reads getConfig().
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # step 5 registers hooks — EDIT: add registerTurnStartCapture(pi) + import
  runtime.ts          # SessionRuntime — EDIT: add `store?: SnapshotStore` field (type-only import)
  nudges.ts           # THE PATTERN to mirror (registerBloatReminder/registerTurnEndMetric) — READ ONLY
  config.ts           # MulliganConfig.revert (the gate) — READ ONLY
  markers.ts          # RevertCheckpoint type (consumed) — READ ONLY
  log.ts              # log(level, category, sessionId, details) — READ ONLY
  snapshot/
    store.ts          # SnapshotStore interface + NoOpStore — EDIT: add gc() to both
    git.ts            # GitBackend — EDIT: implement gc()
    cas.ts            # CasBackend (P2.M3.T1.S3 in flight) — EDIT: APPEND gc() AFTER that task lands
    paths.ts          # path helpers (consumed by backends, not this task) — READ ONLY
test/
  nudges.test.ts      # THE TEST pattern to mirror — READ ONLY
  capture.test.ts     # ← NEW — the Tier-1 unit tests
```

### Desired Codebase tree with files to be added/edited

```bash
src/capture.ts        # NEW — gcTurnSnapshots(rt) + turnStartCaptureHandler(event,ctx) +
                      #   registerTurnStartCapture(pi). The turn_start hook module.
src/runtime.ts        # EDIT — add `store?: SnapshotStore` field + type-only import.
src/snapshot/store.ts # EDIT — add `gc(): Promise<void>` to SnapshotStore interface + NoOpStore body.
src/snapshot/git.ts   # EDIT — implement gc() (namespace-delete turn/* + git gc --auto --prune=now).
src/snapshot/cas.ts   # EDIT — APPEND gc() (mark-sweep) after P2.M3.T1.S3 completes.
src/index.ts          # EDIT — import registerTurnStartCapture + call it in step 5.
test/capture.test.ts  # NEW — Tier-1 unit tests (fakes, no Pi).
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// THE gc() GAP: store.ts's SnapshotStore interface (P2.M1.T1.S1) has 6 methods and NO gc(). But PRD §5
//   + the AsyncMutex JSDoc (store.ts line ~166: "the prompt-boundary GC pass ALSO acquires the mutex")
//   require a mutex-acquiring gc operation. This task ADDS gc(): Promise<void> to the interface and
//   implements it in ALL backends (git/cas) + NoOpStore. Do NOT try to do the GC in the handler via
//   per-ref retire() — the in-memory rt.snapshots map only holds the CURRENT turn, so it cannot
//   enumerate prior turns' on-disk refs; only a backend namespace scan (for-each-ref / readdir) can.
//   The store method is the only backend-agnostic seam.

// DESIGN (b) — gc() does the WHOLE namespace pass: delete all turn/* refs/manifests + physical reclaim.
//   The handler does NOT call retire() per ref. checkpoint/* is a SEPARATE namespace (git:
//   refs/mulligan/snapshots/checkpoint/<name>; CAS: ckpt:<name> manifests) and is EXEMPT — gc() only
//   touches turn/*. retire(ref) still exists for single checkpoint revoke/consume (SHA-resolved).

// getRuntime takes a STRING (sessionId), NOT ctx (nudges.ts GOTCHA #5). log takes
//   (level, category, sessionId, detailsObj), NOT ctx (nudges.ts GOTCHA #1 — spec pseudocode passing
//   ctx to log is WRONG). Read sessionId FIRST inside the try{} so the catch{} can log it.

// The handler is ASYNC (await store.gc()/capture()). Pi awaits async event handlers. SYNC handlers
//   (bloatReminder) return R|void; async ones return Promise<void>. turn_start is a notification event
//   — the return value is ignored; the handler runs for its side effect (rt.snapshots mutation + GC).

// rt.store is UNDEFINED until P3.M1.T2.S1 wires detectAndCreate in session_start. The handler MUST
//   guard `if (!rt.store) return` and no-op cleanly. This task ADDS the `store?: SnapshotStore` FIELD
//   (so rt.store type-checks); it does NOT create/assign the store (T2.S1's job).

// SessionRuntime.snapshots is `snapshots?: Map<string, RevertCheckpoint>` — always initialized to a
//   fresh Map by freshRuntime, but typed optional. Read via `rt.snapshots?.…`. RevertCheckpoint.backend
//   is "git"|"cas" (NOT "none") — so guard `if (backend === "none") return` BEFORE building the
//   checkpoint (describe().backend is "git"|"cas"|"none"; the narrowed non-"none" value assigns into
//   RevertCheckpoint.backend with no cast).

// The capture label "turn" maps to refForLabel("turn") = refs/mulligan/snapshots/turn/turn (git).
//   "turn-after" (agent_end, P3.M1.T1.S2) → turn/turn-after. gc()'s for-each-ref prefix
//   `refs/mulligan/snapshots/turn/` matches BOTH. checkpoint/* is exempt.

// git.ts ensureInit() MUST be called first in gc() (capture/retire both call it — the shadow repo may
//   not exist on a fresh session). If ensureInit throws, the catch warns + returns void (fail-open —
//   nothing to gc yet, correct).

// .js import specifiers are MANDATORY (tsc/vitest ESM). capture.ts imports:
//   `import type { TurnStartEvent, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";`
//   (TurnStartEvent IS exported — confirmed in node_modules/.../dist/core/index.d.ts:11 alongside
//   TurnEndEvent), `import { getConfig } from "./config.js"`, `import { getRuntime, type
//   SessionRuntime } from "./runtime.js"`, `import type { SnapshotStore } from "./snapshot/store.js"`,
//   `import { log } from "./log.js"`.

// FAIL-OPEN is the law (E27): the WHOLE handler body is ONE try/catch → log + return. A store throw, a
//   getConfig throw, anything — logged, never propagated. The turn is NEVER broken by a capture/GC
//   failure. gc() itself also never rejects (each backend's catch warns + void).

// COORDINATION with P2.M3.T1.S3 (in flight): this task's cas.ts gc() edit is APPENDITIVE (a new method
//   at the end of the CasBackend class). It must be done AFTER P2.M3.T1.S3 is committed. Read cas.ts at
//   implementation time to confirm the exact manifestPath/blobPath/dir helpers + blob filename
//   convention (defined by P2.M3.T1.S1) before writing the mark-sweep.
```

---

## Implementation Blueprint

### Data models and structure

This task adds **NO new exported types** (besides the functions). It consumes:
- `RevertCheckpoint` (markers.ts) — written into `rt.snapshots`.
- `SnapshotStore` (store.ts) — gains one new method (`gc()`); `rt.store` is typed against it.
- `SessionRuntime` (runtime.ts) — gains one optional field (`store?`).
- `TurnStartEvent` / `ExtensionContext` / `ExtensionAPI` (pi-coding-agent) — the handler signature.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM P2.M3.T1.S3 is COMPLETE (read cas.ts)
  - READ src/snapshot/cas.ts end-to-end. Confirm the 6 SnapshotStore methods are real (no throwing
    stubs) + note the EXACT names/signatures of: manifestPath(ref), blobPath(hash), the blob filename
    convention, this.storageDir layout (manifests/ + blobs/ subdirs), this.fs members, this.mutex,
    parseManifest/serializeManifest, the manifest {files[rel]={hash,size,mtime,existed}} shape.
  - WHY: Task 4 (cas.ts gc) depends on these. If P2.M3.T1.S3 is NOT yet complete, implement Tasks 1-3
    + 5-7 first (they are independent of cas.ts) and do Task 4 last.
  - GOTCHA: the task list says P2.M3.T1.S3 is "Implementing" — it may complete before/while you work.
    Re-check before Task 4.

Task 1: EDIT src/snapshot/store.ts — add gc() to the SnapshotStore interface + NoOpStore
  - ADD to the SnapshotStore interface (immediately AFTER the retire() method block, ~line 110):
      /**
       * The prompt-boundary reclamation pass (spec/14 §5). Drops ALL `turn/*` snapshot refs/manifests
       * (the whole namespace — reclaims prior turns whose in-memory entry no longer exists) AND
       * physically reclaims (`git gc --auto --prune=now` for git / blob mark-sweep for cas).
       * `checkpoint/*` is EXEMPT (separate namespace). Serialized by the mutex (§4.3). BEST-EFFORT
       * (E27): NEVER rejects — failure logs + degrades only to slower reclamation; never blocks the
       * turn. Called by the turn_start capture hook (P3.M1.T1.S1) + the session_start GC (P3.M1.T2.S1).
       */
      gc(): Promise<void>;
  - ADD to the NoOpStore class (after its retire method, ~line 275):
      async gc(): Promise<void> { /* no-op — nothing to reclaim in a no-op store */ }
  - WHY: the locked interface lacks gc() (see Known Gotchas). Append-only (P2.M1.T1.S2 precedent).
  - GOTCHA: do NOT change any of the 6 existing methods. This makes git.ts/cas.ts `implements
      SnapshotStore` REQUIRE a gc() method — Tasks 3 & 4 add it to each, else tsc fails (expected).

Task 2: EDIT src/runtime.ts — add the store? field
  - ADD a type-only import at the top (alongside the existing `import type { RevertCheckpoint } from
      "./markers.js"`):
      import type { SnapshotStore } from "./snapshot/store.js";
  - ADD to the SessionRuntime interface (immediately AFTER the existing `snapshots?: Map<string,
      RevertCheckpoint>` field block, ~line 150):
      /** The working-tree snapshot STORE for this session (v1.2, spec/14 §2). Created once at
       *  session_start by detectAndCreate (P3.M1.T2.S1) when config.revert.enabled; undefined
       *  otherwise (and until that task wires it). The turn_start/agent_end capture hooks (P3.M1.T1)
       *  read it; rewindExecute (P4.M2.T1) reads it. OPTIONAL so a hand-built runtime type-checks;
       *  freshRuntime leaves it undefined (assigned by index.ts session_start). In-memory,
       *  non-persisted; auto-cleared (resetRuntime deletes the entry on session_start; clearAll wipes
       *  all on shutdown). Backend "none" (NoOpStore) is a valid assignment — the hooks guard on it. */
      store?: SnapshotStore;
  - WHY: the turn_start handler reads rt.store (codebase_patterns.md §8 recommended approach). This
      task adds the FIELD; P3.M1.T2.S1 ASSIGNS it. Type-only import keeps runtime.ts Pi-free.
  - GOTCHA: do NOT assign store in freshRuntime (leave undefined — T2.S1 assigns it). Do NOT touch the
      snapshots field or any existing field.

Task 3: EDIT src/snapshot/git.ts — implement gc()
  - ADD the gc() method to the GitBackend class (immediately AFTER retire(), ~line 465). Body:
      async gc(): Promise<void> {
        const release = await this.mutex.acquire(); // §4.3 — serialize ALL store ops incl. gc
        try {
          await this.ensureInit();
          // (1) namespace-delete: drop EVERY refs/mulligan/snapshots/turn/* (checkpoint/* exempt).
          const out = await this.exec(
            "git",
            ["for-each-ref", "--format=%(refname)", "refs/mulligan/snapshots/turn/"],
            this.shadowEnv(),
          );
          const refnames = out.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
          for (const rn of refnames) {
            await this.exec("git", ["update-ref", "-d", rn], this.shadowEnv());
          }
          // (2) physical reclaim — self-throttling (cheap no-op under the loose-object threshold).
          await this.exec("git", ["gc", "--auto", "--prune=now"], this.shadowEnv());
        } catch (err) {
          // E27 best-effort: any git error ⇒ warn + void (objects linger until next gc / shutdown).
          console.warn(`[mulligan] snapshot.gc failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          release();
        }
      }
  - WHY: the prompt-boundary pass (PRD §5). Mirrors retire()'s acquire/try/finally + catch-warn shape.
  - GOTCHA: ensureInit() FIRST (capture/retire both call it). The for-each-ref PREFIX arg matches the
      WHOLE turn namespace (turn/turn + turn/turn-after) but NOT checkpoint/*. Do NOT acquire the mutex
      twice (this method acquires it once; it does NOT call retire()).

Task 4: EDIT src/snapshot/cas.ts — APPEND gc() (mark-sweep) [AFTER P2.M3.T1.S3 is complete]
  - ADD the gc() method to the CasBackend class (at the END of the class, after the last existing
      method — APPENDITIVE, does not touch P2.M3.T1.S3's 6 methods). Body (adapt the exact helper names
      confirmed in Task 0):
      async gc(): Promise<void> {
        const release = await this.mutex.acquire(); // §4.3
        try {
          const mdir = join(this.storageDir, "manifests");
          let names: string[] = [];
          try { names = await this.fs.readdir(mdir); } catch { return; } // no manifests dir ⇒ nothing to gc
          const surviving = new Set<string>(); // blob hashes still referenced by a surviving manifest
          for (const f of names) {
            if (f.startsWith("ckpt")) {
              // checkpoint manifest — EXEMPT: keep it, collect its blobs into the surviving set.
              try {
                const m = parseManifest((await this.fs.readFile(join(mdir, f))).toString("utf8"));
                for (const e of Object.values(m.files)) if (e.hash) surviving.add(e.hash);
              } catch { /* corrupt checkpoint manifest — best-effort skip */ }
              continue;
            }
            // turn/* manifest — DELETE (the reclamation). ref===label===manifest filename.
            try { await this.fs.unlink(join(mdir, f)); } catch { /* already gone */ }
          }
          // mark-sweep: reclaim any blob referenced by NO surviving (checkpoint) manifest.
          const bdir = join(this.storageDir, "blobs");
          let blobs: string[] = [];
          try { blobs = await this.fs.readdir(bdir); } catch { return; }
          for (const b of blobs) {
            const hash = b.replace(/\.blob$/, ""); // confirm exact suffix in Task 0
            if (!surviving.has(hash)) { try { await this.fs.unlink(join(bdir, b)); } catch { /* */ } }
          }
        } catch (err) {
          console.warn(`[mulligan] snapshot.gc failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          release();
        }
      }
  - WHY: the CAS has no native reachability GC (PRD §5 "CAS backend reclamation — the non-git analog").
  - GOTCHA: confirm manifestPath/blobPath/join + the blob filename suffix (Task 0). surviving = the
      union of checkpoint-manifest blob hashes (turn manifests are deleted BEFORE the sweep, so only
      checkpoint blobs survive — exactly the PRD's "surviving set is the active snapshots' union").
      checkpoint manifests are detected by filename starting with "ckpt" (the label prefix).

Task 5: CREATE src/capture.ts — gcTurnSnapshots + turnStartCaptureHandler + registerTurnStartCapture
  - CREATE the file. Full content in "Implementation Patterns" below. JSDoc on each export cites
      `@14 §5`. Imports: getConfig (config.js), getRuntime + SessionRuntime (runtime.js), SnapshotStore
      type (snapshot/store.js), log (log.js), TurnStartEvent/ExtensionContext/ExtensionAPI types (pi).
  - WHY: the deliverable. New module (distinct concern from nudges.ts; holds 2 hooks + a shared helper).
  - GOTCHA: the handler reads sessionId FIRST (so the catch can log it). The whole body is ONE try/
      catch. gc() + capture() are awaited (handler is async). guard order: revert.enabled → rt.store →
      (gc) → backend!=="none" → capture. See Implementation Patterns for the exact body.

Task 6: EDIT src/index.ts — wire registerTurnStartCapture
  - ADD the import (alongside the existing nudges.js import, ~line 8):
      import { registerTurnStartCapture } from "./capture.js";
  - ADD the call in step 5 (after registerTurnEndMetric(pi);, ~line 63):
      registerTurnStartCapture(pi); // pi.on("turn_start", …) — v1.2 working-tree revert prompt-boundary
                                    // GC + capture("turn"). Self-guards on revert.enabled (fail-open).
  - WHY: arm the hook once at startup (mirrors the other register* calls). Unconditional (gate is inside).
  - GOTCHA: do NOT touch the session_start/session_shutdown handlers (T2.S1 owns session_start GC +
      store creation; this task does NOT wire the store). Only ADD the import + the one call.

Task 7: CREATE test/capture.test.ts — Tier-1 unit tests
  - CREATE the file. Mirror test/nudges.test.ts: vitest flat describe/it/expect, `.js` imports, a fake
      pi with an `on` spy, a fake ctx ({sessionManager:{getSessionId:()=>...}}), setConfig({...}) +
      clearAll() in beforeEach. Build a fake store (describe/capture/gc as vi.fn()). Test the EXPORTED
      handler directly + registerTurnStartCapture(pi). See "Level 2" for the cases.
  - WHY: validate the gate ordering, GC-before-capture, snapshots mutation, fail-open, gcTurnSnapshots.
  - GOTCHA: clearAll() (runtime.ts) in beforeEach resets the per-session map. setConfig must run before
      the handler reads getConfig(). To set rt.store, call getRuntime(sessionId).store = fakeStore.
```

### Implementation Patterns & Key Details

```typescript
// src/capture.ts — the complete module. JSDoc cites @14 §5 on each export.
import type { TurnStartEvent, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { getRuntime } from "./runtime.js";
import type { SessionRuntime } from "./runtime.js";
import { log } from "./log.js";

/**
 * gcTurnSnapshots — the prompt-boundary reclamation pass for a session's working-tree snapshots
 * (spec/14 §5). Drops ALL `turn/*` snapshot refs/manifests on disk (via `rt.store.gc()` — the whole
 * turn namespace, reclaiming prior turns whose in-memory entry no longer exists) AND physically
 * reclaims (`git gc --auto --prune=now` / CAS blob mark-sweep). `checkpoint/*` is EXEMPT (gc() only
 * touches turn/*). Then clears the in-memory `turn/*` entries from rt.snapshots (checkpoint entries
 * preserved). BEST-EFFORT: gc() never rejects; this fn never throws. EXPORTED so the session_start GC
 * (P3.M1.T2.S1) reuses the SAME pass to clear stale turn/* refs from a reloaded instance (PRD §5).
 *
 * @param rt the live per-session runtime (reads rt.store + rt.snapshots). No-op if rt.store is unset.
 */
export async function gcTurnSnapshots(rt: SessionRuntime): Promise<void> {
  if (!rt.store) return;
  try {
    await rt.store.gc(); // drop all turn/* refs on disk + reclaim; checkpoint/* exempt; never rejects
  } catch {
    /* belt-and-suspenders: gc() is best-effort by contract, but never let a throw escape */
  }
  // clear in-memory turn/* entries (checkpoint:<name> entries do NOT start with "turn" → preserved).
  for (const key of [...(rt.snapshots?.keys() ?? [])]) {
    if (key.startsWith("turn")) rt.snapshots?.delete(key);
  }
}

/**
 * turnStartCaptureHandler — the v1.2 turn_start capture hook (spec/14 §5). At the start of each agent
 * turn: (1) run prompt-boundary GC FIRST (drop all prior turns' turn/* refs + reclaim), then (2)
 * capture("turn") and store its before-ref in rt.snapshots so a last_turn rewind (P4.M2.T1.S1 step 6b)
 * can restore the working tree to the turn's start. Safe because no non-checkpoint rewind crosses a
 * prompt boundary. ASYNC (Pi awaits event handlers; awaits store.gc()/capture()).
 *
 * NEVER throws (E27): the WHOLE body is ONE try/catch → log + return. Read sessionId FIRST so the catch
 * can log it. Self-guards on config.revert.enabled (layer 1) + rt.store (undefined until P3.M1.T2.S1
 * wires it) + backend!=="none" (NoOpStore — nothing to capture). Best-effort: a capture/GC failure is
 * logged and the turn proceeds (the before-ref is simply absent → file-revert degrades to skipped).
 *
 * @param event { type:"turn_start"; turnIndex; timestamp } (TurnStartEvent — confirmed exported by pi).
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12).
 */
export async function turnStartCaptureHandler(
  event: TurnStartEvent,
  ctx: ExtensionContext,
): Promise<void> {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so the catch can log it
    if (!getConfig().revert.enabled) return;       // layer-1 gate — FIRST check
    const rt = getRuntime(sessionId);              // STRING arg, not ctx
    if (!rt.store) return;                          // store not created (config off / T2.S1 not wired)
    // (1) GC FIRST — prompt-boundary reclamation (drop all turn/* refs + reclaim + clear in-memory).
    await gcTurnSnapshots(rt);
    // (2) THEN CAPTURE — snapshot the working set now → the turn's before-ref.
    const backend = rt.store.describe().backend;
    if (backend === "none") return;                 // NoOpStore — nothing to capture (fail-open)
    const beforeRef = await rt.store.capture("turn");
    if (beforeRef) {
      rt.snapshots?.set("turn", {
        label: "turn",
        backend, // narrowed to "git"|"cas" by the !=="none" guard above (RevertCheckpoint.backend)
        beforeRef,
        turnIndex: event.turnIndex,
        ts: Date.now(),
      });
    }
  } catch (e) {
    // FAIL-OPEN (E27): log + return — the turn is NEVER broken by a capture/GC failure.
    try {
      log("error", "capture.turn_start", sessionId, { error: String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
  }
}

/**
 * registerTurnStartCapture — arm the v1.2 turn_start hook. index.ts (step 5) calls this once at
 * startup: `registerTurnStartCapture(pi);`. The handler needs no `pi` (it reads rt.store, getConfig,
 * getRuntime, log — all module globals), so it is registered DIRECTLY (mirrors registerBloatReminder;
 * contrast registerTurnEndMetric which wraps to capture pi). Unconditional registration — the gate
 * lives INSIDE the handler (free when revert is off).
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerTurnStartCapture(pi: ExtensionAPI): void {
  pi.on("turn_start", turnStartCaptureHandler);
}
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO CONFIG EDITS. This task is pure in-process TS wiring + 3 small backend
method additions. Imports are all type-only (SnapshotStore) or existing modules (config/runtime/log).
EVENT: pi.on("turn_start", …) — Pi fires TurnStartEvent {type, turnIndex, timestamp} at the start of
  every agent turn (after session_start, before any tool_call/context of the turn). The handler is
  async; Pi awaits it.
STORE FIELD (rt.store): this task ADDS the field to SessionRuntime (Task 2). P3.M1.T2.S1 ASSIGNS it
  (rt.store = await detectAndCreate(ctx.cwd, getConfig().revert, ctx.sessionDir) in the session_start
  handler — NOT this task). The handler guards `if (!rt.store) return` so it no-ops until T2.S1 wires
  it. Until then: zero capture, zero GC (correct — the feature is inert without the store).
DOWNSTREAM CONSUMERS (NOT this task's job): P3.M1.T1.S2 (agent_end) sets rt.snapshots.get("turn").afterRef
  via capture("turn-after"); P4.M2.T1.S1 step 6b (rewindExecute) reads rt.snapshots.get("turn").beforeRef
  + afterRef to dirtyCheck + restore; P3.M1.T2.S1 (session_start) reuses gcTurnSnapshots(rt) for the
  reload GC pass. This task populates the before-ref + provides the GC helper; it does NOT implement
  those consumers.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project after Tasks 1-6 (the gc() interface addition makes every backend
# require gc() — tsc will flag git.ts/cas.ts/NoOpStore until each has it; that is the expected signal).
npx tsc --noEmit                              # expect ZERO errors after Tasks 1-6
npx tsc --noEmit 2>&1 | grep -E 'capture.ts|store.ts|git.ts|cas.ts|runtime.ts|index.ts'  # isolate

# LSP diagnostics on each edited file (fast, in-editor)
# (call lsp_diagnostics on src/capture.ts, src/snapshot/store.ts, src/snapshot/git.ts,
#  src/snapshot/cas.ts, src/runtime.ts, src/index.ts — expect no diagnostics)

# Format check
npx prettier --check src/capture.ts src/snapshot/store.ts src/snapshot/git.ts src/snapshot/cas.ts \
  src/runtime.ts src/index.ts test/capture.test.ts

# Expected: Zero errors. The new gc() on SnapshotStore is satisfied by git.ts + cas.ts + NoOpStore.
# TurnStartEvent resolves (it IS exported by @earendil-works/pi-coding-agent). rt.store type-checks.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the new capture suite (fast feedback loop while implementing)
npx vitest run test/capture.test.ts

# Full suite — confirm no regressions (the gc() interface addition + runtime field must not break
# store.test.ts / git.test.ts / cas.test.ts / runtime.test.ts / nudges.test.ts)
npx vitest run

# Expected: ALL green. The existing backend tests still pass (gc() is ADDITIVE — the 6 methods are
# unchanged). runtime.test.ts still passes (store? is an OPTIONAL new field).
```

`test/capture.test.ts` describe/it blocks (driven by a fake store + fake ctx; `clearAll()` +
`setConfig({...revert:{enabled:true,...}})` in beforeEach):

```yaml
describe("registerTurnStartCapture"):
  - it("registers exactly one handler on pi.on('turn_start', <the exported handler>)")
  - it("does not register on any other event")

describe("turnStartCaptureHandler — gating"):
  - it("no-ops (no gc, no capture) when getConfig().revert.enabled === false (gate is FIRST)")
  - it("no-ops when rt.store is undefined (does not throw; rt.snapshots untouched)")
  - it("no-ops (no capture) when rt.store.describe().backend === 'none' (NoOpStore)")
  - it("does NOT throw when getConfig throws — logs + returns (fail-open)")

describe("turnStartCaptureHandler — GC-before-capture ordering"):
  - it("awaits rt.store.gc() BEFORE rt.store.capture('turn') (assert call order via mockImplementation
       that records an ordered log)")
  - it("clears in-memory turn/* entries via gcTurnSnapshots before capture sets the new 'turn'")

describe("turnStartCaptureHandler — capture result"):
  - it("sets rt.snapshots.get('turn') = {label:'turn', backend:'git', beforeRef, turnIndex, ts} when
       capture returns a non-null ref")
  - it("leaves rt.snapshots.get('turn') unset when capture returns null (caps exceeded / IO error)")
  - it("uses event.turnIndex in the stored checkpoint")
  - it("NEVER throws when capture() rejects — logs 'capture.turn_start' + returns")

describe("gcTurnSnapshots"):
  - it("calls rt.store.gc() exactly once when rt.store is set")
  - it("is a no-op when rt.store is undefined")
  - it("deletes in-memory keys starting with 'turn' (turn, turn-after)")
  - it("PRESERVES an in-memory 'checkpoint:foo' entry (checkpoint namespace exempt)")
  - it("does NOT throw when store.gc() rejects (best-effort)")
```

### Level 3: Integration Testing (System Validation)

```bash
# This task is UNIT-tier (spec/10 §1 Tier 1 — fakes, no Pi). There is no service to start. The
# end-to-end turn_start→capture→rewind-restore flow is validated by the F-revert-* integration
# scenarios in P5.M1.T1 (Tier 2 — real temp git/non-git dirs, real backends). This task does NOT add
# those.

# Smoke (optional, manual): exercise the git gc() against a temp shadow repo to confirm the namespace
# delete + git gc reclaim:
tmp=$(mktemp -d) && cd "$tmp" && git init -q && printf 'a\n' > f.txt
node --input-type=module -e "
import { GitBackend } from '<repo>/src/snapshot/git.js';   // resolve to the built src
const cfg = { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:'cas', storageDir:null,
  maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
  excludeGlobs:['.git','node_modules','dist','build','.next','.venv','target'] };
const store = new GitBackend('$tmp', cfg, null);
const r1 = await store.capture('turn'); const r2 = await store.capture('turn-after');
console.log('captured', r1 && r2 ? 'ok' : 'FAIL');
await store.gc();                       // namespace-delete turn/* + git gc
console.log('has turn=', await store.has(r1));        // expect false (ref dropped)
// a checkpoint ref would survive — not asserted here (covered by git.test.ts in P2.M2.T1.S2)
"
cd - && rm -rf "$tmp"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm NO edits to files outside this task's scope (the only files touched: capture.ts (new),
# store.ts, git.ts, cas.ts, runtime.ts, index.ts, test/capture.test.ts (new)):
git status --porcelain | grep -E 'config.ts|markers.ts|paths.ts|nudges.ts|tasks.json|prd_snapshot|PRD.md' \
  && echo "ERROR: touched an out-of-scope/locked file" || echo "OK: scope respected"

# Parity check: git.ts gc() must mirror retire()'s acquire/try/finally+catch-warn shape (only the body
# differs — namespace for-each-ref + update-ref -d loop + git gc vs SHA-points-at resolve).
diff <(sed -n '/async retire/,/^  }/p' src/snapshot/git.ts | grep -E 'mutex.acquire|ensureInit|catch|finally|console.warn') \
     <(sed -n '/async gc/,/^  }/p'     src/snapshot/git.ts | grep -E 'mutex.acquire|ensureInit|catch|finally|console.warn')
# Expected: identical scaffolding lines (acquire/ensureInit position, catch-warn, finally-release).

# Confirm the gc() interface addition is satisfied by ALL three concrete stores (tsc is the gate; this
# is a belt-and-suspenders grep):
rg -n "async gc\(\): Promise<void>" src/snapshot/git.ts src/snapshot/cas.ts src/snapshot/store.ts
# Expected: 3 matches (git + cas + NoOpStore).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean — `gc()` satisfied by git.ts + cas.ts + NoOpStore; `rt.store` + `TurnStartEvent` resolve.
- [ ] `npx vitest run test/capture.test.ts` — ALL green (gating, GC-before-capture, capture result, gcTurnSnapshots, fail-open).
- [ ] `npx vitest run` — full suite green (no regressions in store/git/cas/runtime/nudges tests from the gc() addition + rt.store field).
- [ ] `lsp_diagnostics` on every edited/new file — no diagnostics.
- [ ] `.js` import specifiers + `node:` prefixes preserved (vitest/tsc).
- [ ] No new npm dependencies.

### Feature Validation
- [ ] `registerTurnStartCapture(pi)` registers `pi.on("turn_start", turnStartCaptureHandler)` (assertable).
- [ ] Handler self-guards: revert.enabled (first) → rt.store → backend!=="none" → (gc) → capture.
- [ ] GC runs BEFORE capture (`gcTurnSnapshots` awaited, then `capture("turn")`).
- [ ] After capture, `rt.snapshots.get("turn")` = `{label:"turn", backend, beforeRef, turnIndex, ts}`.
- [ ] `gcTurnSnapshots` preserves `checkpoint:<name>` in-memory entries (turn/* only cleared).
- [ ] Handler NEVER throws (E27) — any error logged via `log("error","capture.turn_start",sessionId,{error})` + returns.
- [ ] `store.gc()` (git) deletes all `turn/*` refs + `git gc --auto --prune=now`; leaves `checkpoint/*`; never rejects.
- [ ] `store.gc()` (cas) deletes all `turn/*` manifests + mark-sweeps unreferenced blobs; leaves `ckpt:` + their blobs; never rejects.

### Code Quality Validation
- [ ] Mirrors the `registerBloatReminder`/`registerTurnEndMetric` pattern (register seam + exported handler).
- [ ] File placement matches the desired tree (NEW `src/capture.ts` + `test/capture.test.ts`; edits to store/git/cas/runtime/index).
- [ ] Anti-patterns avoided (no ctx passed to log/getRuntime; no double mutex acquire in gc; no mutation of the 6 locked interface methods).
- [ ] JSDoc cites `@14 §5` on `gcTurnSnapshots`, `turnStartCaptureHandler`, `registerTurnStartCapture`, and the new `gc()` methods (Mode A — rides with the work).
- [ ] Dependencies respected: P2.M3.T1.S3 (cas.ts) confirmed complete before Task 4; does NOT create/assign rt.store (T2.S1's job); does NOT implement agent_end (S2) / checkpoint capture (P3.M2) / rewind step 6b (P4.M2).

### Documentation & Deployment
- [ ] Code is self-documenting (clear fn/var names; the gate order is commented inline).
- [ ] No new environment variables (config.revert.* already shipped in P1.M1.T1.S1).

---

## Anti-Patterns to Avoid

- ❌ Don't do the GC in the handler via per-ref `retire()` — the in-memory map can't enumerate prior turns' on-disk refs. Use `store.gc()` (namespace scan lives in the backend).
- ❌ Don't add `gc()` to ONLY the interface without implementing it in git.ts/cas.ts/NoOpStore — `implements SnapshotStore` breaks (tsc is the gate).
- ❌ Don't edit cas.ts's 6 existing methods (P2.M3.T1.S3 owns them) — APPEND `gc()` only, and only after P2.M3.T1.S3 is committed.
- ❌ Don't create/assign `rt.store` in this task (P3.M1.T2.S1 owns session_start store creation). This task only ADDS the field + reads it (guarded).
- ❌ Don't pass `ctx` to `log()` or `getRuntime()` — `log(level, category, sessionId, details)` and `getRuntime(sessionId: string)` (nudges.ts GOTCHA #1/#5).
- ❌ Don't let the handler throw (E27) — ONE try/catch around the whole body; read sessionId first so the catch can log it.
- ❌ Don't run capture before GC — the order is GC FIRST, then capture (PRD §5: "BEFORE capturing the new turn's snapshot").
- ❌ Don't touch the 6 locked `SnapshotStore` methods when adding `gc()` — append-only (store.ts, git.ts, cas.ts).

---

## Confidence Score

**8/10** — one-pass success likely. The design is clean (gc() does the whole namespace pass; handler is
a thin guarded capture+GC), mirrors a proven pattern (registerBloatReminder/turnEndMetricHandler), and
every file/line anchor is cited. The two residual risks: (1) the cas.ts `gc()` mark-sweep depends on
the EXACT manifest/blob path + filename helpers that P2.M3.T1.S1/S3 define — Task 0 reads cas.ts first
to confirm them (mitigation); (2) the `rt.store` field is added here but ASSIGNED by P3.M1.T2.S1, so the
hook is inert (correctly no-ops) until T2.S1 lands — the handler's `if (!rt.store) return` guard makes
this safe and the success criteria are independently testable with a fake store.