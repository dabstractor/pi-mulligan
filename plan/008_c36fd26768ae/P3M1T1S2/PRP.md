# PRP — P3.M1.T1.S2: `agent_end` hook (capture `"turn-after"` for `dirtyCheck`)

**Spec refs**: spec/14-working-tree-revert.md §5 (capture lifecycle — `agent_end` → `capture("turn-after")` →
the turn's **after** ref; "the after-ref is what makes `dirtyCheck` effective (it detects post-turn drift)"),
§6 step 3 (restore dirty-guard REFUSES if `afterRef` exists + `dirtyCheck(afterRef, affected)` returns dirty
paths), E30 (concurrent/external modification — the after-snapshot baseline; mid-turn limitation before
`agent_end`). architecture/codebase_patterns.md §6 (event-handler registration pattern) + §8 (store handle on
`SessionRuntime`). JSDoc on the new handler cites `@14 §5/§6` (Mode A — rides with the work; work-item DOCS clause).

---

## Goal

**Feature Goal**: Arm the `agent_end` event hook that captures `"turn-after"` — the **after**-snapshot of the
working tree at the end of the agent's turn — and sets it as `afterRef` on the **EXISTING** `"turn"`
`RevertCheckpoint` held in `SessionRuntime.snapshots`. This after-ref is the baseline the **dirty guard**
(`rewindExecute` step 6b, P4.M2.T1.S1) compares the current tree against to detect a human/other-process edit
made AFTER the agent's turn (E30: refuse-on-dirty, never silently clobber). This is the **second** of the two
capture hooks (`turn_start` = before-ref in P3.M1.T1.S1; `agent_end` = after-ref here).

**Deliverable**:
1. EDIT `src/capture.ts` (CREATED by P3.M1.T1.S1 — this task APPENDS to it): ADD `AgentEndEvent` to the pi
   type-import line; APPEND `agentEndCaptureHandler(event, ctx)` + `registerAgentEndCapture(pi)` after the
   `turn_start` exports.
2. EDIT `src/index.ts` — EXTEND the `./capture.js` import to include `registerAgentEndCapture`; ADD the
   `registerAgentEndCapture(pi);` call in step 5 (right after the `turn_start` registration S1 adds).
3. EDIT `test/capture.test.ts` (CREATED by P3.M1.T1.S1 — this task APPENDS to it): ADD `agent_end` describe
   blocks reusing S1's shared scaffolding (`makePi`/`makeCtx`/`beforeEach`/fake-store helper).

**Success Definition**: `registerAgentEndCapture(pi)` registers `pi.on("agent_end", agentEndCaptureHandler)`.
The handler, when `config.revert.enabled` AND `rt.store` is non-null AND an existing `rt.snapshots.get("turn")`
entry exists: calls `rt.store.capture("turn-after")` and, if it returns a non-null ref, mutates that existing
entry's `afterRef` in place. It is async, **NEVER throws** (E27), reads `sessionId` first, and no-ops cleanly
when revert is disabled / the store is absent / there is no `"turn"` entry to annotate / capture returns null.
`npx tsc --noEmit` clean; `npx vitest run test/capture.test.ts` green; the full suite (`npx vitest run`) green.

## User Persona

**Target User**: Implementer agent (this PRP's consumer). End users never invoke the hook directly — Pi fires
`agent_end` at the end of the agent's loop (after all tool calls + the final assistant message); the hook
maintains the after-ref consumed by `rewindExecute` step 6b (P4.M2.T1.S1).

**Use Case**: A user opts into `config.revert.enabled`; the agent runs a turn that edits files; `agent_end`
fires and snapshots the post-turn tree. The user (or another process) then edits one of those files; later
the agent invokes `mulligan_rewind` with `revert_file_changes:true`. The rewind's dirty guard
(`dirtyCheck(afterRef, affected)`) detects the drift and REFUSES the file-revert (returns `refused[]`) while
the context rewind still proceeds. Without this hook, `afterRef` is absent → the dirty guard has no baseline
→ it cannot detect the concurrent edit → file-revert would silently clobber the human's edit (the one
unrecoverable failure, E30).

**Pain Points Addressed**: silent data loss — clobbering an unsaved human edit is the one unrecoverable
failure (PRD §6 step 3 rationale). The after-ref is the ONLY input that lets the dirty guard detect post-turn
drift and refuse instead. (The documented mid-turn limitation: if the rewind fires *before* `agent_end`, no
after-ref exists yet → the rewind captures a just-in-time after-ref → the guard is trivially satisfied and
cannot detect a concurrent edit during the active turn — E30/PRD §6 step 3. This hook closes the COMMON
post-turn case; the mid-turn gap is accepted.)

## Why

- **The dirty guard's baseline (PRD §5)**: "`agent_end` → `capture("turn-after")` → the turn's after ref. The
  after-ref is what makes `dirtyCheck` effective (it detects post-turn drift)." Without this hook, `afterRef`
  is never captured → the refuse-on-dirty guarantee (E30) is inert for the common case.
- **Foundation for P4.M2.T1.S1 (rewind step 6b)**: that task resolves `rt.snapshots.get("turn")` and reads
  `.beforeRef` (restore source) + `.afterRef` (dirtyCheck baseline). This hook POPULATES `.afterRef`; the
  `turn_start` hook (P3.M1.T1.S1) populates `.beforeRef`. Together they form the `RevertCheckpoint` pair.
- **Siblings to the turn_start hook (P3.M1.T1.S1)**: both hooks live in `src/capture.ts` and both are armed in
  `index.ts` step 5. S1 creates the module skeleton (imports + the 3 `turn_start` exports + the `gc()` store
  method + the `rt.store` field); this task APPENDS the `agent_end` exports. No overlap with S1's in-place work.
- **Scope guard**: this task implements ONLY the `agent_end` hook. It does NOT implement the `turn_start` hook
  (P3.M1.T1.S1 — running in parallel), store creation/assignment in `session_start` (P3.M1.T2.S1 — this task
  only READS `rt.store`, guarded), the checkpoint capture (P3.M2), nor rewind step 6b / dirtyCheck (P4.M2).
  Stay in lane: capture `"turn-after"` + set `afterRef`, nothing else.

## What

### `registerAgentEndCapture(pi)` — the registration seam (EDIT src/capture.ts, APPENDED)
`registerAgentEndCapture(pi: ExtensionAPI): void` — registers `pi.on("agent_end", agentEndCaptureHandler)`.
Mirrors `registerTurnStartCapture`/`registerBloatReminder` exactly (the handler needs no `pi`, so it is
registered DIRECTLY — contrast `registerTurnEndMetric` which wraps to capture `pi`). Always registered (the
gate lives INSIDE the handler, so registering is free when revert is off).

### `agentEndCaptureHandler(event, ctx)` — the handler (EDIT src/capture.ts, APPENDED)
`async agentEndCaptureHandler(event: AgentEndEvent, ctx: ExtensionContext): Promise<void>`. Async (Pi awaits
event handlers; the handler awaits `rt.store.capture("turn-after")`). Body, ALL inside ONE try/catch (E27 —
never throws; read `sessionId` FIRST so the catch can log it):
1. `sessionId = ctx.sessionManager.getSessionId();` (FRESH — C12). **GOTCHA: NOT `ctx.sessionId` (the
   contract pseudocode abbreviates it) — the real API is `ctx.sessionManager.getSessionId()`.**
2. `if (!getConfig().revert.enabled) return;` (gate layer 1).
3. `const rt = getRuntime(sessionId);` (STRING arg — GOTCHA #5 in nudges.ts).
4. `if (!rt.store) return;` (store not created — config was off at `session_start` / P3.M1.T2.S1 not wired
   yet; fail-open no-op).
5. `const afterRef = await rt.store.capture("turn-after");`
6. `if (afterRef) { const existing = rt.snapshots?.get("turn"); if (existing) existing.afterRef = afterRef; }`
   — **mutate the EXISTING object in the Map** (do NOT `set` a replacement; the object S1's turn_start handler
   stored is the one to annotate).
7. catch → `log("error", "capture.agent_end", sessionId, { error: String(e) })` (best-effort; guard the log
   call itself).

### Success Criteria
- [ ] `pi.on("agent_end", …)` is registered exactly once by `registerAgentEndCapture` (assertable via a fake
  `pi` with an `on` spy).
- [ ] When `config.revert.enabled === false`, the handler returns BEFORE calling `store.capture` (the gate is
  the FIRST check after reading sessionId).
- [ ] When `rt.store` is undefined, the handler no-ops (does not throw; no `store.capture` call).
- [ ] When an existing `rt.snapshots.get("turn")` entry exists + `capture("turn-after")` returns a non-null
  ref, the entry's `afterRef` is set to that ref (MUTATED IN PLACE — the same object reference, not a
  replacement).
- [ ] When there is NO `"turn"` entry (`rt.snapshots.get("turn")` is undefined), the handler does NOT throw
  and does NOT create a new entry (there is no before-ref to pair with → nothing to annotate).
- [ ] When `capture("turn-after")` returns `null` (caps exceeded / IO error), `afterRef` is left unset (no-op).
- [ ] The handler NEVER throws on ANY error (store throws, getConfig throws, etc.) — it logs + returns.
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/capture.test.ts` green; full `npx vitest run` green.

## All Needed Context

### Context Completeness Check
✅ "If someone knew nothing about this codebase, would they have everything needed?" — YES. The event-handler
registration pattern (`registerBloatReminder`/`registerTurnEndMetric` + the fail-open/never-throws/log-first-
sessionId discipline), the `AgentEndEvent` shape + `on("agent_end", …)` overload, the `SnapshotStore.capture`
signature, the `RevertCheckpoint` shape (with optional `afterRef`), the `SessionRuntime.snapshots`/`store`
fields, the config gate, and the test idiom are all cited below with exact paths + line anchors + patterns.

### Documentation & References

```yaml
# MUST READ — the authoritative spec for this task
- file: spec/14-working-tree-revert.md
  why: §5 (capture lifecycle — agent_end → capture("turn-after") → the turn's after ref; "the after-ref is
       what makes dirtyCheck effective (it detects post-turn drift)"; turn/* GC'd at the next prompt
       boundary), §6 step 3 (restore dirty-guard: if afterRef exists, dirtyCheck(afterRef, affected); if any
       dirty path → REFUSE the whole file-revert, return refused[]; mid-turn limitation: if the rewind fires
       before agent_end, no afterRef yet → just-in-time after-ref → guard trivially satisfied).
  critical: §5 "`agent_end` — `capture("turn-after")` → the turn's after ref. The after-ref is what makes
       `dirtyCheck` effective (it detects post-turn drift)." §6 step 3 "if the rewind fires before `agent_end`
       (no `afterRef` yet), the tool captures a just-in-time after-ref (= current tree), so `dirtyCheck` is
       trivially satisfied". E30 "the pre-flight dirty guard compares the current tree to the agent_end
       after-snapshot; any drifted affected path → the whole file-revert is refused".

# THE PATTERN TO MIRROR — event-handler registration + fail-open discipline
- file: src/nudges.ts
  why: registerBloatReminder(pi) (registers the handler DIRECTLY — `pi.on("tool_result", bloatReminderHandler)`
       — because the handler needs no pi) + bloatReminderHandler's body (read sessionId FIRST, one try/catch,
       never throws, `log("error", category, sessionId, {error})` in the catch). agentEndCaptureHandler mirrors
       bloatReminderHandler's structure EXACTLY, except it is ASYNC (awaits store.capture). registerAgentEndCapture
       mirrors registerBloatReminder (direct registration; NO pi needed).
  pattern: `export async function agentEndCaptureHandler(event, ctx): Promise<void> { let sessionId=""; try {
       sessionId=ctx.sessionManager.getSessionId(); if(!getConfig().revert.enabled) return; const rt=getRuntime
       (sessionId); if(!rt.store) return; const afterRef=await rt.store.capture("turn-after"); if(afterRef){
       const ex=rt.snapshots?.get("turn"); if(ex) ex.afterRef=afterRef; } } catch(e){ try{ log("error",
       "capture.agent_end",sessionId,{error:String(e)}); }catch{} } }` + `export function registerAgentEndCapture
       (pi: ExtensionAPI): void { pi.on("agent_end", agentEndCaptureHandler); }`.
  gotcha: getRuntime takes a STRING (sessionId from ctx.sessionManager.getSessionId()), NOT ctx and NOT
       ctx.sessionId (the contract pseudocode's `ctx.sessionId` is WRONG — see Known Gotchas). log takes
       (level, category, sessionId, detailsObj), NOT ctx.

# THE SIBLING HOOK (running in parallel) — creates capture.ts, the store field, the gc() method; this task APPENDS
- file: plan/008_c36fd26768ae/P3M1T1S1/PRP.md
  why: the CONTRACT for this task. S1 CREATES src/capture.ts (imports + gcTurnSnapshots + turnStartCaptureHandler
       + registerTurnStartCapture), ADDS rt.store? to SessionRuntime (runtime.ts), ADDS gc() to SnapshotStore +
       all backends, ADDS the registerTurnStartCapture(pi) wiring in index.ts step 5, and CREATES
       test/capture.test.ts (beforeEach + makePi + makeCtx + fake-store helper + turn_start describe blocks).
       This task APPENDS agent_end exports to capture.ts, EXTENDS index.ts's ./capture.js import + adds the
       agent_end registration, and APPENDS agent_end describe blocks to test/capture.test.ts.
  critical: read S1's "Implementation Patterns" block (the complete src/capture.ts) — it defines the EXACT
       import lines this task extends (add AgentEndEvent to the `import type { TurnStartEvent, ExtensionContext,
       ExtensionAPI }` line) + the exact index.ts edit points. Re-read capture.ts at implementation time to
       confirm S1 landed before editing.

# THE RUNTIME — fields this task reads (S1 adds store?; P1.M2.T2.S2 added snapshots?)
- file: src/runtime.ts
  why: SessionRuntime (lines ~75-150) has `snapshots?: Map<string, RevertCheckpoint>` (P1.M2.T2.S2 — present
       TODAY, always initialized to a fresh Map by freshRuntime, read via rt.snapshots?.…). S1 ADDS
       `store?: SnapshotStore;` (type-only import). This task reads BOTH, guarded. getRuntime(sessionId) takes
       a STRING.
  gotcha: the snapshots field is `snapshots?: Map<string, RevertCheckpoint>` (optional in the interface, always
       a live Map from freshRuntime). RevertCheckpoint (markers.ts:121) = { label; backend: "git"|"cas";
       beforeRef: string; afterRef?: string; turnIndex; ts } — afterRef is OPTIONAL → assignment is type-safe.

# THE STORE — capture(label) signature
- file: src/snapshot/store.ts
  why: the SnapshotStore interface — `capture(label: string): Promise<string | null>` (the method this task
       CALLS with label "turn-after"). null = capture failed (caps exceeded — E29, IO error) → handler skips
       (afterRef stays unset). describe().backend is "git"|"cas"|"none" (this task does NOT branch on backend
       — capture("turn-after") is backend-agnostic; a "none" NoOpStore.capture returns null → no-op, correct).
       This task does NOT edit store.ts (S1 adds gc(); the 6 original methods are untouched here).

# THE TYPE — AgentEndEvent shape + the on() overload (verified in node_modules)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: AgentEndEvent (line 540: `{ type: "agent_end"; messages: AgentMessage[] }` — messages is UNUSED by this
       handler) + the on() overload (line 884: `on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>):
       void`) + ExtensionHandler (line 862: `(event, ctx) => Promise<R | void> | R | void` — async handlers are
       awaited). AgentEndEvent IS re-exported at the package root (dist/index.d.ts:7).
  critical: the event arg for tests is `{ type: "agent_end", messages: [] }` (messages unused). The handler
       returns Promise<void> (async; agent_end is a notification event — return value ignored, side-effect only).

# THE WIRING — register the hook in index.ts (EXTEND S1's edit)
- file: src/index.ts
  why: step 5 (line ~60) registers the event-driven handlers. S1 ADDS `import { registerTurnStartCapture } from
       "./capture.js"` + a `registerTurnStartCapture(pi);` call. This task EXTENDS the import to also import
       `registerAgentEndCapture` and ADDS `registerAgentEndCapture(pi);` right after S1's call.
  pattern: S1's import becomes `import { registerTurnStartCapture, registerAgentEndCapture } from "./capture.js";`
       and the call block becomes `registerTurnStartCapture(pi);  // turn_start: GC + capture("turn")` then
       `registerAgentEndCapture(pi);  // agent_end: capture("turn-after") for the dirty guard (v1.2)`.

# THE CONFIG — the gate field
- file: src/config.ts
  why: the MulliganConfig.revert block (lines ~82-120) — revert.enabled (boolean, default false) is the layer-1
       gate. Read via getConfig().revert.enabled. This task does NOT edit config.ts.
  critical: revert.enabled default false → zero capture. The handler checks it FIRST (after reading sessionId).

# THE TEST IDIOM — mirror nudges.test.ts (capture.test.ts is created by S1; this task appends)
- file: test/nudges.test.ts
  why: the pattern: vitest flat describe/it/expect, `.js` imports, a fake `pi` with an `on(event, fn)` spy, a
       fake `ctx` (`{ sessionManager: { getSessionId: () => "s1" } }`), setConfig({...}) + clearAll() in
       beforeEach. Drive the EXPORTED handler directly: `await agentEndCaptureHandler(event, ctx)` and assert
       side effects on getRuntime(sid).snapshots.
  gotcha: getRuntime caches per sessionId across tests — clearAll() in beforeEach. setConfig must run BEFORE the
       handler reads getConfig(). To set rt.store, call `getRuntime(sid).store = fakeStore`. The AgentEndEvent
       arg: `{ type: "agent_end", messages: [] }`.
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # step 5 registers hooks — EDIT (extend S1's capture import + add registerAgentEndCapture)
  runtime.ts          # SessionRuntime (snapshots? today; store? added by S1) — READ ONLY
  nudges.ts           # THE PATTERN to mirror (registerBloatReminder + bloatReminderHandler) — READ ONLY
  capture.ts          # CREATED by S1 — this task APPENDS agentEndCaptureHandler + registerAgentEndCapture
  config.ts           # MulliganConfig.revert (the gate) — READ ONLY
  markers.ts          # RevertCheckpoint type (afterRef? consumed) — READ ONLY
  log.ts              # log(level, event, sessionId, data?) — READ ONLY
  snapshot/store.ts   # SnapshotStore.capture(label) (the method called) — READ ONLY (S1 adds gc())
test/
  nudges.test.ts      # THE TEST pattern to mirror — READ ONLY
  capture.test.ts     # CREATED by S1 — this task APPENDS the agent_end describe blocks
```

### Desired Codebase tree with files to be added/edited

```bash
src/capture.ts        # EDIT (S1 creates; this task APPENDS) — add AgentEndEvent to the type import;
                      #   APPEND agentEndCaptureHandler(event, ctx) + registerAgentEndCapture(pi).
src/index.ts          # EDIT — extend S1's ./capture.js import to add registerAgentEndCapture; add the call
                      #   in step 5 (right after registerTurnStartCapture(pi);).
test/capture.test.ts  # EDIT (S1 creates; this task APPENDS) — agent_end describe blocks (gating, capture,
                      #   in-place afterRef mutation, no-turn-entry no-op, fail-open). Reuse S1's fakes.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CONTRACT PSEUDOCODE `getRuntime(ctx.sessionId)` IS WRONG: the real API is getRuntime(sessionId: string) where
//   sessionId = ctx.sessionManager.getSessionId(). `ctx` has NO `sessionId` property. nudges.ts GOTCHA #5 + S1's
//   PRP both use ctx.sessionManager.getSessionId(). USE THAT. (Same correction S1 applies; consistency required.)

// WHOLE-BODY try/catch (not the inner-only form in the contract pseudocode): the contract wraps only the
//   capture+set block in try/catch. The ESTABLISHED pattern (nudges.ts + S1's turnStartCaptureHandler) + the E27
//   fail-open law wrap the WHOLE body in one try/catch (read sessionId FIRST). The whole-body form is strictly
//   more robust (a getConfig/getRuntime throw is also caught) and matches the sibling turn_start handler. USE THE
//   WHOLE-BODY form. The contract's "best-effort, never throws" requirement is the binding constraint; the whole-
//   body form satisfies it fully.

// MUTATE THE EXISTING OBJECT (not Map.set replacement): the contract — "the after-ref is set on the EXISTING turn
//   checkpoint (mutating the object already in the Map)". So:
//     const existing = rt.snapshots?.get("turn"); if (existing) existing.afterRef = afterRef;
//   NOT `rt.snapshots.set("turn", { ...existing, afterRef })`. S1's turn_start handler stored the object; agent_end
//   annotates the SAME object so any held reference sees the update. RevertCheckpoint.afterRef? is optional → safe.

// ASYNC handler (await store.capture): agent_end is a notification event (return value ignored). The handler
//   returns Promise<void>; Pi awaits it. SYNC handlers (bloatReminder) return R|void; this one MUST be async
//   because capture("turn-after") is a Promise (store methods are async — serialized via AsyncMutex, spec §4.3).

// rt.store is UNDEFINED until P3.M1.T2.S1 wires detectAndCreate in session_start. The handler MUST guard
//   `if (!rt.store) return` and no-op cleanly. This task does NOT create/assign the store (T2.S1's job).

// No "turn" entry? SKIP (do not create one): if turn_start didn't fire / capture returned null / GC cleared the
//   entry, rt.snapshots.get("turn") is undefined → there is no before-ref to pair with → file-revert cannot work
//   anyway (needs beforeRef) → nothing to annotate. The `if (existing)` guard is the correct no-op. (The rewind's
//   just-in-time after-ref path in step 6b handles the mid-turn no-afterRef case — NOT this hook's concern.)

// capture("turn-after") label maps (via the backend's refForLabel/manifest name) under the turn/* GC namespace:
//   git → refs/mulligan/snapshots/turn/turn-after; CAS → manifest "turn-after". Both are reclaimed by S1's
//   gcTurnSnapshots/store.gc() at the next prompt boundary. The after-ref only needs to live until the NEXT
//   turn_start GC (or until rewind consumes it this turn). This task just CALLS capture; the backends ship it.

// .js import specifiers are MANDATORY (tsc/vitest ESM). This task EXTENDS S1's existing import lines — it does
//   not create new ones. The AgentEndEvent type is added to S1's `import type { TurnStartEvent, ExtensionContext,
//   ExtensionAPI } from "@earendil-works/pi-coding-agent"` line (→ add AgentEndEvent). AgentEndEvent IS exported
//   by the package (verified: dist/index.d.ts:7 re-exports it).

// FAIL-OPEN is the law (E27): the WHOLE handler body is ONE try/catch → log + return. A store throw, a getConfig
//   throw, anything — logged, never propagated. The turn is NEVER broken by an after-capture failure. (If the
//   after-ref is missing, the rewind's dirty guard degrades to the just-in-time after-ref path — documented, safe.)

// COORDINATION with S1 (in flight): this task's capture.ts + index.ts + test/capture.test.ts edits are ALL
//   APPEND/EXTEND on the skeleton S1 creates. Read each file at implementation time to confirm S1 landed. The
//   edits land at NON-OVERLAPPING anchor points: capture.ts (append 2 fns at the end + extend the type import),
//   index.ts (extend the ./capture.js import + add the registration call after S1's), test/capture.test.ts
//   (append describe blocks after S1's; reuse its makePi/makeCtx/beforeEach/fake-store).
```

---

## Implementation Blueprint

### Data models and structure

This task adds **NO new exported types** (besides the two functions). It consumes:
- `RevertCheckpoint` (markers.ts:121) — annotates `afterRef?` on the existing `"turn"` entry.
- `SnapshotStore.capture` (store.ts) — calls `capture("turn-after")`.
- `SessionRuntime` (runtime.ts) — reads `rt.store` (S1 adds the field) + `rt.snapshots`.
- `AgentEndEvent` / `ExtensionContext` / `ExtensionAPI` (pi-coding-agent) — the handler signature.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM S1 (P3.M1.T1.S1) LANDED (read capture.ts + runtime.ts + index.ts + test/capture.test.ts)
  - READ src/capture.ts end-to-end. Confirm S1's 3 exports (gcTurnSnapshots, turnStartCaptureHandler,
    registerTurnStartCapture) + the import lines exist. Note the EXACT type-import line text (to extend with
    AgentEndEvent) + where the file ENDS (append point).
  - READ src/runtime.ts: confirm `store?: SnapshotStore` field exists (S1 adds it). If absent, S1 has not
    landed yet — implement Task 1's logic anyway (the handler guards `if (!rt.store)` so it type-checks only
    once the field exists; tsc will flag it until S1 lands — expected; coordinate with S1).
  - READ src/index.ts step 5: confirm `import { registerTurnStartCapture } from "./capture.js"` + the call
    exist (S1 adds them). This is the line to extend.
  - READ test/capture.test.ts: confirm S1's beforeEach (clearAll + setConfig + setLogFile), makePi(),
    makeCtx(), and a fake-store helper exist. This task reuses them.
  - WHY: this task is purely APPEND/EXTEND on S1's skeleton. If S1 has NOT landed, STOP and wait (the edits
    have no anchor points without it). Re-check before each task.

Task 1: EDIT src/capture.ts — APPEND agentEndCaptureHandler + registerAgentEndCapture; extend the type import
  - EDIT the pi type-import line (S1 wrote `import type { TurnStartEvent, ExtensionContext, ExtensionAPI } from
    "@earendil-works/pi-coding-agent";`) → ADD AgentEndEvent:
      import type { TurnStartEvent, AgentEndEvent, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
    (S1 already imports getConfig (config.js), getRuntime + SessionRuntime (runtime.js), log (log.js), SnapshotStore
    type (snapshot/store.js). This task REUSES them — do NOT add duplicate imports.)
  - APPEND at the END of the file (after registerTurnStartCapture) the two functions in "Implementation
    Patterns" below. JSDoc on each cites `@14 §5/§6`.
  - WHY: the deliverable. agent_end is the sibling capture-lifecycle hook to turn_start; they share the module.
  - GOTCHA: the handler reads sessionId FIRST (so the catch can log it). The whole body is ONE try/catch.
    capture("turn-after") is awaited (handler is async). Guard order: revert.enabled → rt.store → capture →
    (existing?) → mutate afterRef. See Implementation Patterns for the exact body. DO NOT add gc() or change the
    turn_start exports — this task only ADDS.

Task 2: EDIT src/index.ts — EXTEND the ./capture.js import + add the registration call
  - EDIT the import S1 added (`import { registerTurnStartCapture } from "./capture.js";`) →
      import { registerTurnStartCapture, registerAgentEndCapture } from "./capture.js";
  - ADD the call in step 5 (immediately after the `registerTurnStartCapture(pi);` call S1 added):
      registerAgentEndCapture(pi); // pi.on("agent_end", …) — v1.2 working-tree revert: capture("turn-after")
                                   // for the dirty guard (E30). Self-guards on revert.enabled (fail-open).
  - WHY: arm the hook once at startup (mirrors the other register* calls). Unconditional (gate is inside).
  - GOTCHA: do NOT touch the session_start/session_shutdown handlers (T2.S1 owns session_start store creation +
    GC; this task does NOT wire the store). Only EXTEND the capture import + ADD the one call. Do NOT reorder
    S1's existing registrations.

Task 3: EDIT test/capture.test.ts — APPEND the agent_end describe blocks
  - APPEND describe blocks after S1's turn_start/gcTurnSnapshots blocks. Reuse S1's beforeEach (clearAll +
    setConfig + setLogFile), makePi(), makeCtx(), and the fake-store helper (S1 defines a store fake with
    describe()/capture()/gc() for its turn_start tests; reuse it — set getRuntime(sid).store = fakeStore).
  - Test the EXPORTED handler directly: `await agentEndCaptureHandler({ type:"agent_end", messages:[] }, ctx)`
    and assert side effects on getRuntime(sid).snapshots. ALSO test registerAgentEndCapture(pi) via the fake
    pi.on spy. See "Level 2" for the cases.
  - WHY: validate the gate ordering, in-place afterRef mutation, no-turn-entry no-op, null-capture no-op,
    fail-open. Mirror nudges.test.ts's flat describe/it/expect + `.js` imports + clearAll/setConfig in beforeEach.
  - GOTCHA: clearAll() in beforeEach resets the per-session map. setConfig must run before the handler reads
    getConfig(). To seed a "turn" entry: `getRuntime(sid).snapshots.set("turn", { label:"turn", backend:"git",
    beforeRef:"b1", turnIndex:0, ts:1 })` then call the handler and assert `.afterRef === "a1"`.
```

### Implementation Patterns & Key Details

```typescript
// src/capture.ts — the two functions to APPEND (after registerTurnStartCapture). JSDoc cites @14 §5/§6.
// The import line is EDITED (add AgentEndEvent) — shown for context; the rest are S1's existing imports.

// (S1's imports — this task only EXTENDS the type import line:)
//   import type { TurnStartEvent, AgentEndEvent, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
//   import { getConfig } from "./config.js";
//   import { getRuntime } from "./runtime.js";
//   import type { SessionRuntime } from "./runtime.js";
//   import { log } from "./log.js";
//   (import type { SnapshotStore } from "./snapshot/store.js"; — S1 adds this; NOT needed by agent_end unless
//    referencing the type, which it does not directly. Reuse whatever S1 imported.)

/**
 * agentEndCaptureHandler — the v1.2 agent_end capture hook (spec/14 §5/§6). Fires at the end of the agent's
 * loop (after all tool calls + the final assistant message): snapshots the working tree via
 * `capture("turn-after")` and sets the ref as `afterRef` on the EXISTING `"turn"` RevertCheckpoint in
 * rt.snapshots (the object the turn_start hook stored). This after-ref is the baseline the dirty guard
 * (rewindExecute step 6b, P4.M2.T1.S1) compares the current tree against to detect a human/other-process
 * edit made AFTER the agent's turn — the E30 refuse-on-dirty guarantee (never silently clobber an unsaved
 * edit). ASYNC (Pi awaits event handlers; awaits store.capture).
 *
 * NEVER throws (E27): the WHOLE body is ONE try/catch → log + return. Read sessionId FIRST so the catch can
 * log it. Self-guards on config.revert.enabled (layer 1) + rt.store (undefined until P3.M1.T2.S1 wires it).
 * MUTATES the existing turn checkpoint in place (does NOT Map.set a replacement). No-ops cleanly when: revert
 * is off / the store is absent / there is no "turn" entry to annotate (no before-ref to pair with) / capture
 * returns null (caps exceeded — E29 / IO error). Best-effort: a capture failure is logged and the turn ends
 * (afterRef stays unset → the rewind's dirty guard degrades to its just-in-time after-ref path, PRD §6 step 3).
 *
 * @param event { type:"agent_end"; messages: AgentMessage[] } — messages is UNUSED by this handler.
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12).
 */
export async function agentEndCaptureHandler(
  event: AgentEndEvent,
  ctx: ExtensionContext,
): Promise<void> {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so the catch can log it
    if (!getConfig().revert.enabled) return;        // layer-1 gate — FIRST check
    const rt = getRuntime(sessionId);               // STRING arg, not ctx (NOT ctx.sessionId)
    if (!rt.store) return;                           // store not created (config off / T2.S1 not wired)
    const afterRef = await rt.store.capture("turn-after");
    if (afterRef) {
      // MUTATE the existing "turn" checkpoint in place (spec/14 §5: the after-ref rides the same RevertCheckpoint
      // the turn_start before-ref lives on). Do NOT Map.set a replacement — held references must see the update.
      const existing = rt.snapshots?.get("turn");
      if (existing) existing.afterRef = afterRef;
      // else: no "turn" entry (turn_start didn't fire / capture null / GC'd) → nothing to annotate → no-op.
    }
    // capture returned null → no-op (afterRef stays unset; the rewind's dirty guard degrades gracefully).
  } catch (e) {
    // FAIL-OPEN (E27): log + return — the turn is NEVER broken by an after-capture failure.
    try {
      log("error", "capture.agent_end", sessionId, { error: String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
  }
}

/**
 * registerAgentEndCapture — arm the v1.2 agent_end hook. index.ts (step 5) calls this once at startup:
 *   `registerAgentEndCapture(pi);`. The handler needs no `pi` (it reads rt.store, getConfig, getRuntime, log —
 *   all module globals), so it is registered DIRECTLY (mirrors registerBloatReminder / registerTurnStartCapture;
 *   contrast registerTurnEndMetric which wraps to capture pi). Unconditional registration — the gate lives
 *   INSIDE the handler (free when revert is off).
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerAgentEndCapture(pi: ExtensionAPI): void {
  pi.on("agent_end", agentEndCaptureHandler);
}
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO CONFIG EDITS. This task is pure in-process TS wiring (2 appended functions + 1
extended import + 1 added registration call + appended tests). Imports are all type-only (AgentEndEvent) or
reused from S1's existing capture.ts imports.
EVENT: pi.on("agent_end", …) — Pi fires AgentEndEvent {type:"agent_end", messages} at the end of the agent's
  loop (after all tool calls + the final assistant message; brackets the turn_start before-ref). The handler is
  async; Pi awaits it.
STORE FIELD (rt.store): S1 ADDS the field to SessionRuntime; P3.M1.T2.S1 ASSIGNS it (rt.store =
  detectAndCreate(...) in session_start). This task READS it (guarded `if (!rt.store) return`). Until T2.S1
  wires it: zero after-capture (correct — the feature is inert without the store; the handler no-ops).
DOWNSTREAM CONSUMERS (NOT this task's job): P4.M2.T1.S1 (rewindExecute step 6b) reads
  rt.snapshots.get("turn").afterRef as the dirtyCheck baseline (refuse-on-dirty, E30). If afterRef is absent,
  step 6b captures a just-in-time after-ref (current tree) → dirtyCheck trivially satisfied (mid-turn
  limitation). P3.M1.T1.S1 (turn_start) writes the beforeRef on the SAME "turn" entry. This task POPULATES
  afterRef for the common post-turn case; it does NOT implement the consumer (step 6b) or dirtyCheck.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project after Tasks 1-3. The AgentEndEvent import resolves (re-exported at the package
# root — verified). rt.store resolves (S1 adds the field). The appended functions are async; no signature clash.
npx tsc --noEmit                              # expect ZERO errors after S1 has landed
npx tsc --noEmit 2>&1 | grep -E 'capture.ts|index.ts'  # isolate this task's files

# LSP diagnostics on each edited file (fast, in-editor)
# (call lsp_diagnostics on src/capture.ts, src/index.ts, test/capture.test.ts — expect no diagnostics)

# Format check
npx prettier --check src/capture.ts src/index.ts test/capture.test.ts

# Expected: Zero errors. If tsc flags `rt.store` as absent, S1 has NOT landed yet — coordinate (Task 0).
# If tsc flags `AgentEndEvent`, confirm the type-import line was extended (Task 1).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the capture suite (fast feedback loop while implementing). S1's turn_start tests + this task's
# agent_end tests both live here.
npx vitest run test/capture.test.ts

# Full suite — confirm no regressions (the capture.ts append + index.ts wiring must not break nudges/runtime/
# store tests).
npx vitest run

# Expected: ALL green. S1's existing turn_start/gcTurnSnapshots tests still pass (this task only APPENDS).
```

`test/capture.test.ts` describe/it blocks APPENDED by this task (driven by a fake store + fake ctx; reuses
S1's `beforeEach` + `makePi` + `makeCtx` + fake-store helper):

```yaml
describe("registerAgentEndCapture"):
  - it("registers exactly one handler on pi.on('agent_end', <the exported agentEndCaptureHandler>)")
  - it("does not register on any other event (e.g. not 'turn_end')")

describe("agentEndCaptureHandler — gating"):
  - it("no-ops (no store.capture call) when getConfig().revert.enabled === false (gate is FIRST)")
  - it("no-ops when rt.store is undefined (does not throw; rt.snapshots untouched)")
  - it("does NOT call store.capture when revert is disabled — assert the fake capture spy call count is 0")
  - it("does NOT throw when getConfig throws — logs + returns (fail-open)")

describe("agentEndCaptureHandler — in-place afterRef mutation"):
  - it("sets afterRef on the EXISTING 'turn' entry when capture('turn-after') returns a non-null ref")
  - it("MUTATES IN PLACE — the SAME object reference (assert getRuntime(sid).snapshots.get('turn') === <pre-stored ref>)")
  - it("preserves the existing beforeRef/turnIndex/ts/backend (only afterRef is added)")
  - it("leaves afterRef unset when capture('turn-after') returns null (caps exceeded / IO error)")

describe("agentEndCaptureHandler — no 'turn' entry"):
  - it("does NOT throw and does NOT create a new entry when rt.snapshots.get('turn') is undefined")
  - it("does NOT call Map.set (assert the snapshots map size is unchanged)")

describe("agentEndCaptureHandler — fail-open"):
  - it("NEVER throws when store.capture('turn-after') rejects — logs 'capture.agent_end' + returns")
  - it("leaves the existing 'turn' entry's afterRef unset when capture rejects")
```

### Level 3: Integration Testing (System Validation)

```bash
# This task is UNIT-tier (spec/10 §1 Tier 1 — fakes, no Pi). There is no service to start. The end-to-end
# agent_end→afterRef→dirtyCheck-refuse flow is validated by the F-revert-* integration scenarios in P5.M1.T1
# (Tier 2 — real temp git/non-git dirs, real backends; specifically F-revert-dirtyguard exercises the after-ref
# dirty-guard refuse path). This task does NOT add those.

# Smoke (optional, manual): confirm agent_end captures a turn-after ref against a real temp backend + that the
# ref lands on the existing turn checkpoint:
tmp=$(mktemp -d) && cd "$tmp" && git init -q && printf 'a\n' > f.txt
node --input-type=module -e "
import { GitBackend } from '<repo>/src/snapshot/git.js';   // resolve to the built src
const cfg = { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:'cas', storageDir:null,
  maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
  excludeGlobs:['.git','node_modules','dist','build','.next','.venv','target'] };
const store = new GitBackend('$tmp', cfg, null);
// simulate turn_start then agent_end:
const before = await store.capture('turn');   console.log('before ref:', before);
const after  = await store.capture('turn-after'); console.log('after ref:', after);
console.log('after resolvable:', await store.has(after));  // expect true (ref created)
"
cd - && rm -rf "$tmp"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm NO edits to files outside this task's scope (the only files touched: capture.ts, index.ts,
# test/capture.test.ts):
git status --porcelain | grep -E 'config.ts|markers.ts|runtime.ts|nudges.ts|snapshot/|tasks.json|prd_snapshot|PRD.md' \
  && echo "ERROR: touched an out-of-scope/locked file" || echo "OK: scope respected"

# Parity check: agentEndCaptureHandler must mirror bloatReminderHandler/turnStartCaptureHandler's fail-open
# scaffolding (whole-body try/catch, read sessionId first, log in catch). Diff the scaffolding lines:
diff <(sed -n '/export async function agentEndCaptureHandler/,/^}/p' src/capture.ts | grep -E 'let sessionId|getSessionId|getConfig|getRuntime|catch|log\(') \
     <(sed -n '/export async function turnStartCaptureHandler/,/^}/p' src/capture.ts | grep -E 'let sessionId|getSessionId|getConfig|getRuntime|catch|log\(')
# Expected: near-identical scaffolding (both read sessionId first, both gate on getConfig().revert.enabled,
# both call getRuntime(sessionId), both catch + log). The agent_end variant adds the capture + afterRef block.

# Confirm the handler does NOT Map.set a replacement (mutates in place):
rg -n "snapshots\?\.(get|set)\(" src/capture.ts
# Expected for agent_end: only `rt.snapshots?.get("turn")` (a get) — NO `set`. (S1's turn_start uses set; that
# is the before-ref creation — correct, out of this task's scope.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean — `AgentEndEvent` resolves (import extended); `rt.store` resolves (S1 landed); the
      appended async handler type-checks; the `existing.afterRef = afterRef` assignment is type-safe (optional field).
- [ ] `npx vitest run test/capture.test.ts` — ALL green (gating, in-place afterRef mutation, no-turn-entry no-op,
      null-capture no-op, fail-open; S1's turn_start/gcTurnSnapshots blocks still pass).
- [ ] `npx vitest run` — full suite green (no regressions from the capture.ts append + index.ts wiring).
- [ ] `lsp_diagnostics` on src/capture.ts, src/index.ts, test/capture.test.ts — no diagnostics.
- [ ] `.js` import specifiers preserved (this task EXTENDS S1's existing import line; no new runtime imports).
- [ ] No new npm dependencies.

### Feature Validation
- [ ] `registerAgentEndCapture(pi)` registers `pi.on("agent_end", agentEndCaptureHandler)` (assertable).
- [ ] Handler self-guards: revert.enabled (first) → rt.store → capture → (existing turn entry?) → mutate afterRef.
- [ ] After a successful capture with an existing "turn" entry, `rt.snapshots.get("turn").afterRef === <capture ref>`
      and the entry is the SAME object reference (mutated in place, not replaced).
- [ ] No-op (no afterRef set, no new entry) when: revert disabled / rt.store undefined / no "turn" entry / capture
      returns null.
- [ ] Handler NEVER throws (E27) — any error logged via `log("error","capture.agent_end",sessionId,{error})` + returns.

### Code Quality Validation
- [ ] Mirrors the `registerBloatReminder`/`registerTurnStartCapture` pattern (register seam + exported async handler;
      whole-body try/catch; read sessionId first).
- [ ] File placement matches the desired tree (APPEND to src/capture.ts + test/capture.test.ts; EXTEND src/index.ts).
- [ ] Anti-patterns avoided (no ctx passed to log/getRuntime; no ctx.sessionId; no Map.set replacement for afterRef;
      no new gc()/store edits; no turn_start handler changes; no out-of-scope edits).
- [ ] JSDoc cites `@14 §5/§6` on `agentEndCaptureHandler` + `registerAgentEndCapture` (Mode A — rides with the work).
- [ ] Dependencies respected: S1 (capture.ts skeleton + rt.store field + test scaffolding) confirmed landed before
      editing; does NOT create/assign rt.store (T2.S1's job); does NOT implement turn_start (S1) / checkpoint
      capture (P3.M2) / rewind step 6b + dirtyCheck (P4.M2).

### Documentation & Deployment
- [ ] Code is self-documenting (clear fn/var names; the gate order + mutation + no-op cases are commented inline).
- [ ] No new environment variables (config.revert.* already shipped in P1.M1.T1.S1).

---

## Anti-Patterns to Avoid

- ❌ Don't use `ctx.sessionId` (the contract pseudocode) — use `ctx.sessionManager.getSessionId()` (the real API;
  nudges.ts GOTCHA #5). `ctx` has no `sessionId` property.
- ❌ Don't wrap only the inner capture block in try/catch (contract pseudocode) — wrap the WHOLE body (read
  sessionId first) so a getConfig/getRuntime throw is also caught (E27 fail-open; matches the sibling turn_start
  handler).
- ❌ Don't `rt.snapshots.set("turn", {...})` to add afterRef — MUTATE the existing object in place
  (`existing.afterRef = afterRef`). The contract is explicit: "mutating the object already in the Map."
- ❌ Don't create a new "turn" entry if none exists — no before-ref to pair with → nothing to annotate → no-op
  (`if (existing)` guard).
- ❌ Don't pass `ctx` to `log()` or `getRuntime()` — `log(level, category, sessionId, details)` and
  `getRuntime(sessionId: string)`.
- ❌ Don't let the handler throw (E27) — ONE try/catch around the whole body; read sessionId first so the catch
  can log it.
- ❌ Don't edit S1's turn_start exports / gcTurnSnapshots / the store.ts gc() / runtime.ts store field (S1 owns
  them) — this task only APPENDS agent_end functions + EXTENDS the type import + EXTENDS index.ts's capture import
  + ADDS one registration call + APPENDS test describe blocks.
- ❌ Don't branch on `describe().backend` in the handler — `capture("turn-after")` is backend-agnostic; a "none"
  NoOpStore returns null → no-op (correct, no special-case needed).
- ❌ Don't duplicate S1's imports (getConfig/getRuntime/log/SnapshotStore) — REUSE them; only ADD AgentEndEvent to
  the type-import line.

---

## Confidence Score

**9/10** — one-pass success highly likely. This is a small, surgical task (2 appended functions + 1 extended
import + 1 added call + appended tests) that mirrors a proven pattern (`registerBloatReminder`/`bloatReminderHandler`
+ S1's `turnStartCaptureHandler`) line-for-line. The `AgentEndEvent` type and `on("agent_end", …)` overload are
verified present in the pi package; `RevertCheckpoint.afterRef?` is an existing optional field; `SnapshotStore.capture`
is an existing async method. The contract's two pseudocode inaccuracies (`ctx.sessionId`, inner-only try/catch) are
flagged in Known Gotchas with the correct forms. The single residual risk is the **parallel-execution coordination
with S1**: this task APPENDS to the skeleton S1 creates (capture.ts, index.ts step 5, test/capture.test.ts). Task 0
confirms S1 landed first; if S1 has not landed, the edits have no anchor points and the implementer must wait (or
the harness sequences them). The handler's `if (!rt.store)` guard makes it type-check-safe even if the rt.store
field is the only S1 artifact still in flight. The success criteria are independently testable with a fake store.