# Research Findings — P3.M1.T1.S2: `agent_end` hook (capture `"turn-after"`)

## 1. Item contract (verbatim, the authority)

Create `registerAgentEndCapture(pi)` registering `pi.on("agent_end", async (event, ctx) => { … })`.
On `agent_end`: if `config.revert.enabled` and `rt.store`, `capture("turn-after")`; if non-null and an
EXISTING `rt.snapshots.get("turn")` entry exists, set its `afterRef`. Best-effort, never throws. Sets
`SessionRuntime.snapshots.get("turn").afterRef`. Consumed by `dirtyCheck` in rewind.ts step 6b
(P4.M2.T1.S1). JSDoc cites `@14 §5/§6` (Mode A, rides with the work).

## 2. Parallel-execution dependency — P3.M1.T1.S1 creates the skeleton this task appends to

This item runs IN PARALLEL with P3.M1.T1.S1 (`turn_start` hook). S1 is treated as a CONTRACT:

- S1 **CREATES** `src/capture.ts` with:
  - type import `import type { TurnStartEvent, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";`
  - runtime imports `import { getConfig } from "./config.js";`, `import { getRuntime } from "./runtime.js";`,
    `import type { SessionRuntime } from "./runtime.js";`, `import { log } from "./log.js";`,
    `import type { SnapshotStore } from "./snapshot/store.js";`
  - exports: `gcTurnSnapshots(rt)`, `turnStartCaptureHandler(event, ctx)`, `registerTurnStartCapture(pi)`.
- S1 **ADDS** `store?: SnapshotStore` field to `SessionRuntime` (runtime.ts) — **already present in runtime.ts
  today? NO** — runtime.ts currently has `snapshots?: Map<string, RevertCheckpoint>` (P1.M2.T2.S2) but NO
  `store` field. S1 adds it. S2 READS it (guarded `if (!rt.store) return`).
- S1 **ADDS** `gc()` to the `SnapshotStore` interface + all backends (git/cas/NoOpStore). S2 does NOT touch gc().
- S1 **CREATES** `test/capture.test.ts` with the shared scaffolding: `beforeEach` (clearAll + setConfig + setLogFile),
  `makePi()` (fake `pi.on` capture), `makeCtx()` (fake sessionManager.getSessionId), and a fake-store helper
  (`describe()/capture()/gc()` vi.fn or hand-rolled). S1's describe blocks cover turn_start + gcTurnSnapshots.

**This task (S2) APPENDS:**
- `src/capture.ts`: ADD `AgentEndEvent` to the pi type-import line; APPEND `agentEndCaptureHandler` +
  `registerAgentEndCapture` at the END of the file (after S1's 3 functions).
- `src/index.ts`: EXTEND S1's import `import { registerTurnStartCapture } from "./capture.js"` → add
  `registerAgentEndCapture`; ADD the `registerAgentEndCapture(pi);` call right after S1's call in step 5.
- `test/capture.test.ts`: APPEND agent_end describe blocks (reuse S1's `makePi`/`makeCtx`/`beforeEach`/fake-store).

No conflict with S1's in-place work: S1 creates `capture.ts` from scratch + edits index.ts's step 5; S2 appends
to capture.ts and extends index.ts's import + adds a sibling registration line. Both touch index.ts step 5 and
capture.ts — but at NON-OVERLAPPING anchor points (S1 = the import line creation + the turn_start call; S2 =
extend the import + add the agent_end call after it).

## 3. Verified pi API surface (read from node_modules dist .d.ts)

- `AgentEndEvent` IS exported by `@earendil-works/pi-coding-agent` (dist/index.d.ts:7 re-exports it from
  core/extensions/index.ts:9 → types.ts:540). Shape:
  ```ts
  /** Fired when an agent loop ends */
  export interface AgentEndEvent { type: "agent_end"; messages: AgentMessage[]; }
  ```
- `on()` overload exists: `on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;`
  (types.d.ts:884).
- `ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;`
  (types.d.ts:862). So an ASYNC handler returning `Promise<void>` is valid (Pi awaits it). agent_end is a
  NOTIFICATION event (R defaults to undefined) — return value ignored; side-effect only (rt.snapshots mutation).
- This matches `turn_start`/`turn_end` exactly (same handler-arity pattern already used in nudges.ts).

## 4. The pattern to mirror — `registerBloatReminder` / `registerTurnEndMetric` (src/nudges.ts)

- `registerBloatReminder(pi)` registers the handler DIRECTLY: `pi.on("tool_result", bloatReminderHandler)`
  (handler needs no `pi` → no wrapper). This is the right shape for S2: `registerAgentEndCapture(pi)` does
  `pi.on("agent_end", agentEndCaptureHandler)` — the handler reads only module globals (getConfig, getRuntime,
  log, rt.store). NO `pi` needed → register directly (NOT the registerTurnEndMetric closure-wrap variant).
- Handler body discipline (bloatReminderHandler / turnStartCaptureHandler):
  - `let sessionId = "";` then FIRST line inside try: `sessionId = ctx.sessionManager.getSessionId();` so the
    catch can log it.
  - WHOLE body in ONE try/catch → fail-open (E27). catch: `try { log("error", <category>, sessionId,
    {error: String(e)}) } catch {}`.
  - ASYNC for this handler (awaits `rt.store.capture("turn-after")`) → returns `Promise<void>`.

## 5. GOTCHA — contract pseudocode `getRuntime(ctx.sessionId)` is WRONG

The contract's pseudocode writes `const rt = getRuntime(ctx.sessionId)`. The REAL API (runtime.ts) is
`getRuntime(sessionId: string)` where `sessionId = ctx.sessionManager.getSessionId()`. `ctx` has NO
`sessionId` property directly. nudges.ts GOTCHA #5 + S1's PRP both use `ctx.sessionManager.getSessionId()`.
**Implementation MUST use `ctx.sessionManager.getSessionId()`, not `ctx.sessionId`.** This is the same
correction S1 applies; consistency is required.

## 6. GOTCHA — try/catch placement (whole-body vs. inner-only)

The contract pseudocode wraps ONLY the capture+set block in try/catch, with the gate checks OUTSIDE. The
ESTABLISHED codebase pattern (nudges.ts + S1's turnStartCaptureHandler) + the E27 fail-open law wrap the
WHOLE body in one try/catch (read sessionId first). The whole-body form is STRICTLY MORE ROBUST (a
getConfig/getRuntime throw is also caught) and MATCHES the sibling turn_start handler. **Implementation
uses the whole-body try/catch.** The contract's "best-effort, never throws" requirement is the binding
constraint; the whole-body form satisfies it fully.

## 7. Mutation semantics — set afterRef on the EXISTING object in the Map

The contract: "The after-ref is set on the EXISTING turn checkpoint (mutating the object already in the Map)."
Implementation (NOT a Map.set replacement):
```ts
const existing = rt.snapshots.get("turn");
if (existing) existing.afterRef = afterRef;
```
Why mutate-in-place (not `set`): S1's turn_start handler stored the RevertCheckpoint object; agent_end adds
the optional `afterRef` field to that SAME object. Any code holding a reference (e.g. rewindExecute reads it)
sees the update. `RevertCheckpoint.afterRef?: string` (markers.ts:125) is optional → assignment is type-safe.
- If NO "turn" entry exists (turn_start didn't fire / capture returned null / GC'd): `existing` is undefined →
  skip. Correct: no before-ref to pair with → file-revert can't work anyway (needs beforeRef).
- `capture("turn-after")` returns `Promise<string | null>`; null = caps exceeded / IO error → skip (afterRef
  stays unset → dirty guard captures a just-in-time after-ref at rewind time, per PRD §6 step 3 mid-turn path).

## 8. The capture label "turn-after" — backend ref namespace

- `SnapshotStore.capture(label: string): Promise<string | null>` (store.ts). label "turn-after" is the agent_end
  capture-namespace key. GitBackend maps it via `refForLabel("turn-after")` →
  `refs/mulligan/snapshots/turn/turn-after` (under the `turn/*` GC namespace). CasBackend: manifest filename
  "turn-after". Both are GC'd at the next prompt boundary by S1's `gcTurnSnapshots`/`store.gc()`. Correct — the
  after-ref only needs to live until the NEXT turn_start GC (or until rewind consumes it this turn).
- S2 does NOT implement capture — it just CALLS `rt.store.capture("turn-after")`. The backends ship this.

## 9. log() + config gate signatures (verified in source)

- `log(level: Level, event: string, sessionId: string, data?: unknown): void` (log.ts:61). S2 category:
  `"capture.agent_end"` (mirrors S1's `"capture.turn_start"`). Call: `log("error", "capture.agent_end",
  sessionId, { error: String(e) })`.
- Gate: `getConfig().revert.enabled` (config.ts:86 block + :354 coercion). S2 reads it FIRST (after sessionId).
  Default false → zero capture. S2 does NOT edit config.ts.

## 10. Downstream consumer (NOT this task — boundary check)

rewindExecute step 6b (P4.M2.T1.S1) reads `rt.snapshots.get("turn")` → uses `beforeRef` (restore source) +
`afterRef` (dirtyCheck baseline). If `afterRef` is absent, step 6b captures a just-in-time after-ref (current
tree) so dirtyCheck is trivially satisfied (PRD §6 step 3 mid-turn limitation; E30). So S2 POPULATES afterRef
for the common post-turn case; its absence degrades gracefully (documented, not a bug). S2 does NOT implement
step 6b or dirtyCheck.

## 11. Test idiom (test/nudges.test.ts — mirror for test/capture.test.ts)

- vitest flat describe/it/expect; `.js` imports; `clearAll()` + `setConfig({...})` in beforeEach.
- `makePi()` returns `{ handlers, pi }` capturing `pi.on(event, fn)` last-write-wins.
- `makeCtx({sessionId})` → `{ sessionManager: { getSessionId: () => sessionId } }`.
- Drive the EXPORTED handler directly: `await agentEndCaptureHandler(event, ctx)` and assert side effects on
  `getRuntime(sessionId).snapshots`.
- Fake store on `getRuntime(sid).store = { describe: () => ({backend:"git"}), capture: vi.fn(), gc: vi.fn() }`
  (S1 establishes this fake-store helper; S2 reuses it).
- AgentEndEvent shape for the event arg: `{ type: "agent_end", messages: [] }` (messages unused by the handler).