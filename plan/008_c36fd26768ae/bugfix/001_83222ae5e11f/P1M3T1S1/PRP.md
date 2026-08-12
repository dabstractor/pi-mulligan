# PRP — P1.M3.T1.S1: Add `pendingExplicitPaths` accumulator + `tool_call` capture hook

> **Bug context**: BUG-003 (Major) — `revert.nonGitMode:'explicit-paths'` is non-functional because no
> caller ever feeds write/edit tool paths to `CasBackend.capture(label, explicitPaths?)`. Every capture
> today passes NO second arg, so `captureExplicitPaths` loops `undefined ?? [] = []` and writes an EMPTY
> manifest → restore reverts nothing. See `architecture/bug_fix_analysis.md §BUG-003`,
> `architecture/codebase_patterns.md §1` (event-handler pattern), spec/14-working-tree-revert.md §4.2.

---

## Goal

**Feature Goal**: Stand up the *producer half* of the BUG-003 explicit-paths fix — a `tool_call` event
hook that, in explicit-paths non-git mode, observes every `write`/`edit` tool call BEFORE it runs,
extracts `event.input.path`, and accumulates the paths into a new per-turn `rt.pendingExplicitPaths`
array on `SessionRuntime`; and warns (once per turn) when a `bash` tool runs in explicit-paths mode
(its file changes are not capturable by path). This makes explicit-paths mode *observable* and gives
the downstream task (S2) a populated accumulator to thread into `capture()`.

**Deliverable**:
1. `src/runtime.ts` — new `pendingExplicitPaths?: string[]` field on the `SessionRuntime` interface
   (JSDoc) + initialized to `[]` in `freshRuntime()`.
2. `src/capture.ts` — new exported `toolCallCaptureHandler(event: ToolCallEvent, ctx: ExtensionContext): Promise<void>`
   + new exported `registerToolCallCapture(pi: ExtensionAPI): void` (with `ToolCallEvent` added to the
   Pi type import).
3. `test/capture.test.ts` — component tests for the new handler (gating order, write/edit accumulation,
   bash-warning delegation, fail-open).

**Success Definition**:
- `npm run typecheck` passes (strict `tsc --noEmit`) — including the type-narrowing + cast correctness.
- `npm test` passes (full `vitest run` suite, currently ~1277 tests, + new handler tests).
- The new handler, when invoked with a `write`/`edit` event in explicit-paths + CasBackend mode, pushes
  `event.input.path` into `rt.pendingExplicitPaths`; a `bash` event calls `(rt.store as CasBackend).notifyBashUsed()`;
  and it is a clean no-op (early return) for every other mode/backend/tool combination.
- **NO `index.ts` registration, NO capture-threading, NO accumulator-clear is added by this task** —
  those are S2's contract (see Out-of-Scope). The new exports are *dormant* until S2 wires them.

## Why

- BUG-003 makes a documented, user-facing config knob (`revert.nonGitMode:'explicit-paths'`, spec/14
  §4.2/§8) **silently do nothing**: snapshots are empty, file-revert is a no-op. This is the first of
  three sub-tasks that fix it end-to-end.
- The `tool_call` event is the ONLY place where write/edit tool paths are observable before the tool
  mutates the tree (spec/14 §4.2: "the tool-call hook reads `event.input.path` and snapshots that path's
  current state before the tool runs"). `CasBackend.capture(label, explicitPaths?)` already supports the
  second arg and delegates to `captureExplicitPaths` — the missing piece is a *producer* of that arg.
- S1 deliberately delivers ONLY the accumulator + the hook, so S2 (registration + threading + clear) and
  S3 (integration test) can proceed on a stable, unit-tested foundation. Decomposing this way keeps each
  change small and reviewable and avoids touching `index.ts` in the same patch as the new handler.

## What

### User-visible behavior
None directly in S1 (the hook is not yet registered, so it never fires in production until S2). When S2
wires it, the end-to-end effect (validated by S3) is: in a non-git workspace with
`revert.nonGitMode:'explicit-paths'`, `write`/`edit` files become restorable on `mulligan_rewind`, and
the first `bash` of a turn prints the existing once-per-turn "bash changes NOT captured" warning.

### Success Criteria
- [ ] `SessionRuntime` has a new `pendingExplicitPaths?: string[]` field with full JSDoc; `freshRuntime()`
      initializes it to a fresh `[]` (per-session isolated — GOTCHA #5: never a shared module-level array).
- [ ] `toolCallCaptureHandler` follows the EXACT gating order of `turnStartCaptureHandler`
      (sessionId-first → `revert.enabled` → getRuntime → `rt.store` → backend → nonGitMode) and is fully
      fail-open (E27: whole body in one try/catch → `log("error", …)`).
- [ ] write/edit events push `event.input.path` (defensively `typeof === "string"`-checked) into
      `rt.pendingExplicitPaths`; bash events call `(rt.store as CasBackend).notifyBashUsed()`.
- [ ] The handler early-returns (no work) when backend ≠ `"cas"`, when `nonGitMode ≠ "explicit-paths"`,
      when `revert.enabled` is false, or when `rt.store` is unset.
- [ ] `registerToolCallCapture(pi)` calls `pi.on("tool_call", toolCallCaptureHandler)` exactly once.
- [ ] **Out-of-scope guard**: `src/index.ts` is NOT modified by this task; the accumulator is NOT cleared
      or consumed here; `capture()` calls are NOT changed here.

## All Needed Context

### Context Completeness Check
_Pass_: an implementer who has never seen this repo can implement S1 from this PRP alone — all file
paths, the exact handler-template to copy, the exact Pi type shapes (`event.toolName` / `event.input.path`),
the narrowing caveat, the cast requirement, the gate order, and the test fakes are specified below.

### Documentation & References
```yaml
- file: architecture/bug_fix_analysis.md
  why: "§BUG-003 — root cause (no caller passes explicitPaths; no tool_call hook) + fix strategy (tool_call hook accumulates write/edit paths + notifyBashUsed)."
  section: "## BUG-003 (Major): explicit-paths non-git mode non-functional"

- file: architecture/codebase_patterns.md
  why: "§1 — the registerXxxHandler(pi) factory pattern + the handler gating skeleton S1 MUST mirror."
  pattern: "export async function xxxHandler(event, ctx){ let sessionId=''; try{ sessionId=...; if(!getConfig().revert.enabled)return; ... }catch(e){log('error',...)} } export function registerXxx(pi){ pi.on('event', xxxHandler) }"

- file: src/capture.ts
  why: "turnStartCaptureHandler + agentEndCaptureHandler are the EXACT structural templates (gate order, fail-open, registerXxx). Copy their shape verbatim, change only the event-type + the inner work."
  pattern: "sessionId-first; getConfig().revert.enabled layer-1 gate; getRuntime(sessionId); rt.store check; backend check; try/catch → log('error', 'capture.<name>', sessionId, {error: String(e)})."

- file: src/runtime.ts
  why: "The SessionRuntime interface + freshRuntime() — the field-add site. Precedent fields: snapshots?: Map<…> (optional + initialized in freshRuntime), store?: SnapshotStore (optional, left undefined by freshRuntime)."
  gotcha: "Foundation-tier + Pi-FREE. New field MUST stay primitive (string[]) — no Pi imports. Field is OPTIONAL in the interface but freshRuntime MUST init it. Per-session isolated: literal [] in freshRuntime (GOTCHA #5 — never module-level shared array)."

- file: src/snapshot/cas.ts
  why: "notifyBashUsed() (PUBLIC, CasBackend-specific, NOT on SnapshotStore interface) + capture(label, explicitPaths?) (2nd param is the CasBackend widening S2 will consume). S1 only CALLS notifyBashUsed via a cast."
  gotcha: "notifyBashUsed self-guards on nonGitMode==='explicit-paths' + once-per-turn; by the time S1's handler calls it, the handler has already gated nonGitMode==='explicit-paths', so it WILL warn. The cast (rt.store as CasBackend) is REQUIRED — a SnapshotStore-typed ref cannot reach it."

- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: "ToolCallEvent union + WriteToolCallEvent/EditToolCallEvent/BashToolCallEvent shapes + the isToolCallEventType narrowing caveat (lines ~640-770)."
  critical: "Direct `event.toolName === 'write'` does NOT narrow TS types (CustomToolCallEvent.toolName is `string`, overlapping all literals). Use a defensive `(event.input as {path?: string}).path` + `typeof === 'string'` check, OR the `isToolCallEventType('write', event)` type guard."

- file: test/capture.test.ts
  why: "Component-test conventions: hand-rolled fakes (makePi/makeCtx/RecordingStore), module-level reset, vitest describe/it/expect. S1's new tests slot in alongside the existing registerTurnStartCapture/registerAgentEndCapture blocks."
```

### Current Codebase tree (relevant slice)
```bash
src/
  runtime.ts          # SessionRuntime interface + freshRuntime/getRuntime/resetRuntime/clearAll — EDIT (add field)
  capture.ts          # turn_start/agent_end hooks + gcTurnSnapshots — EDIT (add ToolCallEvent import + 2 exports)
  config.ts           # getConfig().revert.{enabled, nonGitMode} — READ ONLY
  snapshot/
    store.ts          # SnapshotStore interface (capture(label) — NO 2nd param) — READ ONLY
    cas.ts            # CasBackend: capture(label,explicitPaths?), notifyBashUsed(), describe() — READ ONLY
  index.ts            # step-5 registration — NOT TOUCHED by S1 (S2's job)
test/
  capture.test.ts     # component tests for the hooks — EDIT (add tool_call handler tests)
```

### Desired Codebase tree with files to be added/edited
```bash
src/runtime.ts        # + pendingExplicitPaths?: string[] field (JSDoc) + freshRuntime init []
src/capture.ts        # + ToolCallEvent import; + toolCallCaptureHandler; + registerToolCallCapture
test/capture.test.ts  # + describe("registerToolCallCapture" …) + describe("toolCallCaptureHandler" …)
```
**No new files.** This is purely additive to two source files + one test file.

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL #1 — TS narrowing of ToolCallEvent.
// `event.toolName === "write"` is a VALID runtime value-check but does NOT narrow event.input in TS,
// because CustomToolCallEvent.toolName is `string` (overlaps every literal). So after the `===` check
// you MUST cast event.input: `const path = (event.input as { path?: string }).path;` then guard
// `if (typeof path !== "string") return;`. (Alternative: isToolCallEventType("write", event) narrows
// cleanly — see Implementation Patterns.)

// CRITICAL #2 — notifyBashUsed is NOT on the SnapshotStore interface.
// rt.store is typed SnapshotStore; rt.store.notifyBashUsed() is a TYPE ERROR. Cast:
// `(rt.store as CasBackend).notifyBashUsed()`. The method is PUBLIC on CasBackend (src/snapshot/cas.ts).
// Import the TYPE: `import type { CasBackend } from "./snapshot/cas.js";` (type-only — erased by tsc).

// CRITICAL #3 — runtime.ts is Pi-FREE and must stay so.
// Do NOT import ToolCallEvent (or any Pi type) into runtime.ts. pendingExplicitPaths is a plain string[].
// The only imports runtime.ts already has are type-only (RevertCheckpoint, SnapshotStore).

// GOTCHA #5 (inherited) — per-session isolation.
// Initialize pendingExplicitPaths with a literal [] inside freshRuntime(), NEVER a module-level shared
// array (would leak write/edit paths across sessions). freshRuntime creates a NEW array each call.

// GOTCHA — gate order must mirror turnStartCaptureHandler exactly.
// sessionId FIRST (so the catch can log it) → getConfig().revert.enabled → getRuntime → rt.store →
// backend describe() → nonGitMode. Reordering breaks the fail-open logging contract.

// GOTCHA — backend !== "cas" gate is MORE restrictive than turnStart's backend === "none".
// explicit-paths is CasBackend-specific; a git repo (GitBackend) captures the whole tree via git, so it
// never needs explicit paths. Checking backend !== "cas" first correctly skips git AND none.

// GOTCHA — DO NOT register the hook in index.ts, DO NOT clear/consume the accumulator, DO NOT change
// capture() call sites. Those are S2's contract. S1 is producer-only and must stay dormant until S2.
```

## Implementation Blueprint

### Data models and structure
```ts
// src/runtime.ts — ONE new optional field on SessionRuntime (+ init in freshRuntime).
// Field is a plain string[] (primitive) so runtime.ts stays Pi-free (no new imports needed).

export interface SessionRuntime {
  // … existing fields …
  /** [P1.M3.T1.S1 / spec/14 §4.2 / BUG-003] Per-turn accumulator of write/edit tool paths observed
   *  by the tool_call capture hook (pendingExplicitPaths) for CasBackend explicit-paths mode. The hook
   *  pushes `event.input.path` here BEFORE the tool runs; the turn_start/agent_end capture hooks (S2)
   *  thread it into `rt.store.capture("turn", rt.pendingExplicitPaths)` as the CasBackend-specific 2nd
   *  arg, then clear it at the next turn_start (parity with gcTurnSnapshots' turn/* clear). EMPTY/never
   *  populated when revert is off, the backend is not CasBackend, or nonGitMode !== "explicit-paths"
   *  (the hook early-returns in all those cases) — so captureExplicitPaths loops [] and writes an empty
   *  manifest, exactly the current (pre-fix) behavior, i.e. S1 is inert until S2 threads the arg.
   *  WHO WRITES: toolCallCaptureHandler (src/capture.ts). WHO READS+CLEARS: S2's capture call sites +
   *  turn_start clear. OPTIONAL in the interface so a hand-built {} type-checks; freshRuntime ALWAYS
   *  initializes it to a fresh [] (per-session isolated — GOTCHA #5). Auto-reset by resetRuntime
   *  (entry deleted on session_start) and clearAll (shutdown). In-memory, non-persisted (spec/04 §8). */
  pendingExplicitPaths?: string[];
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/runtime.ts — add the pendingExplicitPaths field
  - ADD: `pendingExplicitPaths?: string[];` to the SessionRuntime interface, placed AFTER `store?: SnapshotStore;`
    (the last existing field). Use the JSDoc block in "Data models" above verbatim (spec/14 §4.2, BUG-003,
    WHO WRITES/READS, GOTCHA #5, per-session isolation).
  - ADD: `pendingExplicitPaths: [],` to the object literal returned by freshRuntime() (after `snapshots: new Map<string, RevertCheckpoint>(),`).
  - NO new imports (string[] is primitive; runtime.ts stays Pi-free).
  - NAMING: pendingExplicitPaths (camelCase field; matches pendingBloatHits precedent).
  - VERIFY: `npm run typecheck` — a hand-built `{} as SessionRuntime` still type-checks (field optional),
    AND freshRuntime()'s return now satisfies the populated shape.

Task 2: EDIT src/capture.ts — extend the Pi type import
  - MODIFY the existing `import type { TurnStartEvent, AgentEndEvent, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";`
    to ALSO import `ToolCallEvent` (alphabetical/comma insertion). Keep it type-only.
  - ADD (near the other local imports): `import type { CasBackend } from "./snapshot/cas.js";` (type-only —
    needed for the `(rt.store as CasBackend).notifyBashUsed()` cast; erased by tsc, no runtime cycle).
  - GOTCHA: do NOT add a runtime (value) import of CasBackend — that would pull snapshot/cas.ts into the
    capture module's runtime graph. TYPE-only (`import type`) is safe.

Task 3: CREATE toolCallCaptureHandler in src/capture.ts (place it AFTER registerAgentEndCapture,
        following the file's top-to-bottom "gcTurnSnapshots → turnStart → registerTurnStart → agentEnd
        → registerAgentEnd" ordering — the new pair appends last)
  - SIGNATURE: `export async function toolCallCaptureHandler(event: ToolCallEvent, ctx: ExtensionContext): Promise<void>`
  - BODY (mirror turnStartCaptureHandler's skeleton EXACTLY):
      let sessionId = "";
      try {
        sessionId = ctx.sessionManager.getSessionId();        // FRESH (C12); first so catch can log
        if (!getConfig().revert.enabled) return;              // layer-1 gate — FIRST check
        const rt = getRuntime(sessionId);                     // STRING arg, not ctx (GOTCHA #5)
        if (!rt.store) return;                                // store not created (config off / T2.S1 not wired)
        const backend = rt.store.describe().backend;
        if (backend !== "cas") return;                        // explicit-paths is CasBackend-specific (skips git + none)
        if (getConfig().revert.nonGitMode !== "explicit-paths") return; // mode won't consume the paths
        // ── write/edit: accumulate the path BEFORE the tool runs (spec/14 §4.2) ──
        if (event.toolName === "write" || event.toolName === "edit") {
          // `===` does NOT narrow TS (CustomToolCallEvent.toolName is string) → defensive cast + typeof guard.
          const path = (event.input as { path?: string }).path;
          if (typeof path === "string" && path.length > 0) {
            rt.pendingExplicitPaths?.push(path); // S2 threads rt.pendingExplicitPaths into capture()
          }
          return;
        }
        // ── bash: warn once per turn that its changes are not captured (notifyBashUsed self-guards) ──
        if (event.toolName === "bash") {
          (rt.store as CasBackend).notifyBashUsed(); // PUBLIC CasBackend method; cast required (not on SnapshotStore)
          return;
        }
        // read/grep/find/ls/custom → no file mutation captured by path → no-op
      } catch (e) {
        // FAIL-OPEN (E27): log + return — a tool_call must NEVER be blocked by a capture-hook failure.
        try { log("error", "capture.tool_call", sessionId, { error: String(e), toolName: event?.toolName }); } catch {}
      }
  - JSDoc: full multi-line block citing spec/14 §4.2, BUG-003, the gate order, the narrowing caveat, the
    cast requirement, the notifyBashUsed self-guard, and the "producer-only until S2 wires it" scope note.
    Mirror the density of turnStartCaptureHandler's JSDoc.
  - READS event?.toolName in the catch log defensively (event could be malformed; optional-chain).

Task 4: CREATE registerToolCallCapture in src/capture.ts (immediately after toolCallCaptureHandler)
  - SIGNATURE: `export function registerToolCallCapture(pi: ExtensionAPI): void`
  - BODY: `pi.on("tool_call", toolCallCaptureHandler);`
  - JSDoc: cite the registerXxx pattern; note index.ts (S2) will call this once at startup; the gate lives
    INSIDE the handler (free when revert is off). Mirror registerTurnStartCapture/registerAgentEndCapture.

Task 5: EDIT test/capture.test.ts — add component tests for the new handler + register fn
  - IMPORT: add `toolCallCaptureHandler, registerToolCallCapture` to the existing `from "../src/capture.js"` import.
  - ADD a CasBackend-shaped fake (the existing RecordingStore is SnapshotStore-shaped, lacking notifyBashUsed):
      function makeCasStore(opts: { notifyBashUsedCalls?: number[] } = {}) {
        const calls = opts.notifyBashUsedCalls ?? [];
        const store = {
          calls,
          describe() { return { backend: "cas" }; },
          async capture() { return "ref"; },
          async gc() {},
          async dirtyCheck() { return []; },
          async restore() { return { reverted: [], deleted: [], failed: [], skipped: [], refused: [] }; },
          async has() { return true; },
          async retire() {},
          notifyBashUsed() { calls.push("notifyBashUsed"); }, // PUBLIC CasBackend method the handler casts to
        };
        return store as unknown as import("../src/snapshot/store.js").SnapshotStore;
      }
  - ADD event factory: function makeToolCallEvent(toolName, input) { return { type:"tool_call", toolCallId:"tc1", toolName, input }; }
  - TEST CASES (vitest describe/it/expect, mirroring the existing registerTurnStartCapture block):
      registerToolCallCapture:
        - registers a handler for 'tool_call' (and only 'tool_call'); calls pi.on exactly once.
      toolCallCaptureHandler — gating (early-return, no work):
        - revert.enabled=false → rt.pendingExplicitPaths stays [] (after setting rt.store).
        - rt.store undefined → no throw, stays [].
        - backend 'git' (or 'none') → stays [] (explicit-paths is cas-only).
        - nonGitMode 'cas' (default) with backend 'cas' → write event does NOT push (stays []).
        - getSessionId throws → fail-open: no throw escapes, error is logged (use setLogFile(file)+readLogLines pattern from existing tests).
      toolCallCaptureHandler — accumulation (the happy path):
        - backend 'cas' + nonGitMode 'explicit-paths' + write event {path:"src/a.ts"} → rt.pendingExplicitPaths === ["src/a.ts"].
        - same + edit event {path:"src/b.ts", edits:[...]} → pushes "src/b.ts"; a second write {"src/c.ts"} → ["src/a.ts"?…]. NOTE: clear rt between independent accumulation tests (each test's beforeEach does clearAll(); within a test, push is cumulative — assert accordingly).
        - write event with input.path MISSING / non-string (e.g. {}) → no push, no throw (defensive typeof guard).
      toolCallCaptureHandler — bash delegation:
        - backend 'cas' + nonGitMode 'explicit-paths' + bash event → the fake's notifyBashUsedCalls gets exactly one "notifyBashUsed" entry.
        - second bash event same turn → notifyBashUsed is STILL called once more (the once-per-turn dedup lives INSIDE CasBackend.notifyBashUsed, NOT the handler — the handler always calls it; assert the handler calls it each time and let the fake record each call). Document this clearly: S1's handler does NOT dedup bash; CasBackend does.
        - bash event with backend 'git' → notifyBashUsed NOT called (backend gate).
      toolCallCaptureHandler — inert tools:
        - read/grep/find/ls/custom events (cas + explicit-paths) → no push, no notifyBashUsed (no-op branch).
  - COVERAGE: all 3 branches (write/edit accumulate, bash delegates, others no-op) × the gate matrix.
  - PLACEMENT: after the existing registerAgentEndCapture describe block.

Task 6: VERIFY (no code) — run the gates
  - `npm run typecheck` (tsc --noEmit strict) — MUST be clean. This is the PRIMARY gate: it catches the
    ToolCallEvent import, the CasBackend type import, the cast, and any narrowing mistake.
  - `npm test` (vitest run) — full suite green (~1277 + new tests).
```

### Implementation Patterns & Key Details
```ts
// ── PATTERN A (contract-specified): `===` value-check + defensive cast. ──
// Used by toolCallCaptureHandler for write/edit. The `===` is runtime-correct; the cast handles TS.
if (event.toolName === "write" || event.toolName === "edit") {
  const path = (event.input as { path?: string }).path;   // cast REQUIRED (=== doesn't narrow)
  if (typeof path === "string" && path.length > 0) {
    rt.pendingExplicitPaths?.push(path);                   // optional-chain: field may be unset on a hand-built rt
  }
  return;
}

// ── PATTERN B (idiomatic alternative — equally valid; pick ONE and be consistent): isToolCallEventType. ──
// import { isToolCallEventType } from "@earendil-works/pi-coding-agent";  // VALUE import (it's a function)
// if (isToolCallEventType("write", event)) {
//   rt.pendingExplicitPaths?.push(event.input.path);       // narrowed: event.input.path is `string`
//   return;
// }
// if (isToolCallEventType("edit", event)) {
//   rt.pendingExplicitPaths?.push(event.input.path);
//   return;
// }
// NOTE: Pattern A matches item_description verbatim and needs only a type import; Pattern B needs a value
// import but avoids the cast. Either passes typecheck. The PRP specifies A as primary.

// ── PATTERN: bash delegation via cast (notifyBashUsed is CasBackend-specific, not on SnapshotStore). ──
if (event.toolName === "bash") {
  (rt.store as CasBackend).notifyBashUsed();
  // notifyBashUsed self-guards: no-op unless cfg.nonGitMode==='explicit-paths' (already gated above) and
  // once-per-turn via this.bashWarnedThisTurn. The handler does NOT replicate those guards — CasBackend owns them.
  return;
}

// ── PATTERN: fail-open catch (E27) — identical to turnStartCaptureHandler/agentEndCaptureHandler. ──
} catch (e) {
  try { log("error", "capture.tool_call", sessionId, { error: String(e), toolName: event?.toolName }); } catch {}
}
```

### Integration Points
```yaml
SESSION_RUNTIME (src/runtime.ts):
  - add field: "pendingExplicitPaths?: string[]"
  - init in freshRuntime(): "pendingExplicitPaths: [],"

CAPTURE MODULE (src/capture.ts):
  - import: add ToolCallEvent to the @earendil-works/pi-coding-agent type import
  - import: add `import type { CasBackend } from "./snapshot/cas.js";`
  - export: toolCallCaptureHandler(event, ctx)
  - export: registerToolCallCapture(pi)

INDEX.TS (src/index.ts):
  - NO CHANGE in S1. (S2 will add `registerToolCallCapture(pi);` to step 5, thread rt.pendingExplicitPaths
    into the capture("turn")/capture("turn-after") calls, and clear the accumulator in/after gcTurnSnapshots.)

CONFIG (src/config.ts):
  - NO CHANGE. (Read-only: getConfig().revert.enabled + getConfig().revert.nonGitMode.)

SNAPSHOT/CAS (src/snapshot/cas.ts):
  - NO CHANGE. (Read-only: notifyBashUsed() + capture(label, explicitPaths?) already exist and are correct.)
```

## Validation Loop

### Level 1: Syntax & Type (Immediate Feedback — the PRIMARY gate for this task)
```bash
# After editing src/runtime.ts and src/capture.ts:
npm run typecheck        # tsc --noEmit (strict) — MUST be clean
# Expected: zero errors. If errors appear, READ them:
#   - "Property 'notifyBashUsed' does not exist on type 'SnapshotStore'" → you forgot the `as CasBackend` cast.
#   - "Property 'path' does not exist on type 'WriteToolInput | EditToolInput | …'" → `===` didn't narrow; add the cast (Pattern A) or use isToolCallEventType (Pattern B).
#   - "Cannot find name 'ToolCallEvent'" → add it to the pi type import.
# There is NO ruff/mypy/eslint for these files; typecheck (tsc) is the lint gate.
```

### Level 2: Component Tests (the new handler)
```bash
# Run the capture suite (fast, isolated):
npx vitest run test/capture.test.ts
# Expected: all existing tests + the new registerToolCallCapture / toolCallCaptureHandler tests pass.
# If a gating test fails, re-check the gate order (sessionId → revert.enabled → getRuntime → rt.store → backend → nonGitMode).
# If the bash test fails (notifyBashUsed not called), confirm the cast `(rt.store as CasBackend).notifyBashUsed()`.
# If the write-accumulation test fails, confirm rt.pendingExplicitPaths is initialized (freshRuntime) and
#   the typeof guard isn't rejecting a valid string path.
```

### Level 3: Full Suite (regression — S1 must not break anything)
```bash
npm test                 # vitest run (full suite, ~1277 tests)
# Expected: green. S1 is purely additive (one optional field + two new exports + tests); no existing
# behavior changes. A failure here usually means the freshRuntime change or the capture.ts import edit
# disturbed a sibling — re-read the diff.
```

### Level 4: Dormancy check (S1 must NOT have side effects until S2 wires it)
```bash
# Confirm index.ts was NOT touched (S2's job):
git diff --name-only
# Expected: ONLY src/runtime.ts, src/capture.ts, test/capture.test.ts. If src/index.ts appears, REVERT that
# hunk — registration is S2's contract. Grep the new exports are unused outside tests (dormant until S2):
rg -n "registerToolCallCapture|pendingExplicitPaths|toolCallCaptureHandler" src/
# Expected: definitions in capture.ts/runtime.ts ONLY (no index.ts usage). This proves S1 is producer-only.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` is clean (the strict-tsc gate — catches imports, casts, narrowing).
- [ ] `npm test` is green (full vitest suite + new component tests).
- [ ] `git diff --name-only` lists ONLY `src/runtime.ts`, `src/capture.ts`, `test/capture.test.ts`.
- [ ] `rg -n "registerToolCallCapture|pendingExplicitPaths" src/index.ts` returns NOTHING (S2 owns registration).

### Feature Validation
- [ ] `pendingExplicitPaths?: string[]` exists on SessionRuntime with full JSDoc; freshRuntime inits `[]`.
- [ ] toolCallCaptureHandler mirrors turnStartCaptureHandler's gate order + fail-open catch.
- [ ] write/edit events push `event.input.path` (defensive typeof guard) into rt.pendingExplicitPaths (cas + explicit-paths mode only).
- [ ] bash events call `(rt.store as CasBackend).notifyBashUsed()` (cas + explicit-paths mode only).
- [ ] read/grep/find/ls/custom events are no-ops; non-cas backends, non-explicit-paths mode, revert off, store unset → all early-return cleanly.
- [ ] registerToolCallCapture calls `pi.on("tool_call", toolCallCaptureHandler)` exactly once.

### Scope Discipline (Anti-over-build)
- [ ] NO change to src/index.ts (registration is S2).
- [ ] NO threading of rt.pendingExplicitPaths into capture("turn")/capture("turn-after") (S2).
- [ ] NO accumulator clear at turn_start (S2).
- [ ] NO end-to-end explicit-paths integration test (S3) — only component tests of the handler in isolation.

### Code Quality
- [ ] JSDoc density matches turnStartCaptureHandler (spec/14 §4.2, BUG-003, gate order, narrowing caveat, cast, fail-open, scope note).
- [ ] runtime.ts stays Pi-free (pendingExplicitPaths is a plain string[]; no Pi import added).
- [ ] CasBackend imported type-only in capture.ts (no runtime graph cycle).
- [ ] Per-session isolation: `[]` literal in freshRuntime (GOTCHA #5), never a module-level shared array.

---

## Anti-Patterns to Avoid
- ❌ Don't register the hook in `index.ts`, thread paths into `capture()`, or clear the accumulator — **that is S2**. S1 is producer-only and must stay dormant.
- ❌ Don't rely on `event.toolName === "write"` to narrow `event.input` in TS — it does NOT (CustomToolCallEvent overlaps). Either cast defensively or use `isToolCallEventType`.
- ❌ Don't call `rt.store.notifyBashUsed()` without the `as CasBackend` cast — `notifyBashUsed` is not on the `SnapshotStore` interface; it's a compile error.
- ❌ Don't replicate `notifyBashUsed`'s once-per-turn/nonGitMode guards in the handler — CasBackend owns them; the handler just delegates.
- ❌ Don't add a runtime (value) import of `CasBackend` into capture.ts — use `import type` (the cast is type-only; a value import would pull snapshot/cas.ts into the capture module's runtime dependency graph).
- ❌ Don't initialize `pendingExplicitPaths` with a module-level shared array — use a literal `[]` inside `freshRuntime()` (per-session isolation, GOTCHA #5).
- ❌ Don't drop the fail-open try/catch — a capture-hook failure must NEVER block a tool_call (E27).
- ❌ Don't reorder the gates — sessionId-first (so the catch can log) is a hard contract.

---

## Confidence Score: 9/10

**Rationale**: This is a tightly-scoped, additive change to two well-understood files, following an
EXACT existing template (`turnStartCaptureHandler`). Every type detail (ToolCallEvent shape, narrowing
caveat, cast requirement, notifyBashUsed signature, config field names) was verified directly against
source, not inferred. The only residual risk is the implementer over-building into S2's territory
(mitigated by the explicit Scope Discipline checklist + Level-4 dormancy grep). The -1 accounts for the
narrowing-caveat subtlety, which is fully documented with two alternative patterns.

**Downstream contract for S2** (so the handoff is explicit): S2 will (1) add `registerToolCallCapture(pi);`
to index.ts step 5; (2) change `rt.store.capture("turn")` → `rt.store.capture("turn", rt.pendingExplicitPaths)`
and `capture("turn-after")` likewise (requires a cast `as CasBackend` or widening the SnapshotStore interface,
since the 2nd param is CasBackend-specific — S2's design decision); (3) clear `rt.pendingExplicitPaths = []`
at turn_start (inside or after `gcTurnSnapshots`). S1 delivers the accumulator + the hook that populates it.