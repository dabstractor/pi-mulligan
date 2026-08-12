# Research Findings — P1.M3.T1.S1 (BUG-003 explicit-paths capture, Part 1)

## Scope confirmation (from plan_status + item_description)
**THIS TASK (S1)** is strictly the *producer half* of the BUG-003 fix:
1. Add `pendingExplicitPaths?: string[]` field to `SessionRuntime` interface + init `[]` in `freshRuntime()`.
2. Create `toolCallCaptureHandler(event, ctx)` in `src/capture.ts` (accumulates write/edit paths, warns on bash).
3. Create `registerToolCallCapture(pi)` export (`pi.on("tool_call", …)`).

**Explicitly OUT OF SCOPE (sibling tasks S2/S3):**
- S2: register the hook in `src/index.ts` step 5; thread `rt.pendingExplicitPaths` into the `capture("turn")`/`capture("turn-after")` calls; clear the accumulator at `turn_start` (in `gcTurnSnapshots` or the turn_start hook).
- S3: end-to-end integration test (non-git dir + explicit-paths → write → rewind → file reverted).

> KEY SCOPING NOTE: S1's handler ACCUMULATES into `rt.pendingExplicitPaths` and WARNs on bash. It does NOT clear, thread, or self-register. The accumulator would be a dead write until S2 threads it into `capture()`. This is intentional decomposition — the PRP must make this contract crisp so the implementer does not over-build (e.g. must NOT add the `index.ts` registration — that's S2).

## Source verification (read directly, not inferred)

### src/runtime.ts (SessionRuntime)
- Foundation-tier, **Pi-FREE** (only `import type { RevertCheckpoint }` + `import type { SnapshotStore }` — type-only, erased by tsc). Must stay Pi-free.
- Interface fields are OPTIONAL (`?`) so a hand-built `{}` type-checks, BUT `freshRuntime()` ALWAYS initializes them. Precedent: `snapshots?: Map<string, RevertCheckpoint>` + `snapshots: new Map(...)` in freshRuntime; `store?: SnapshotStore` (left undefined by freshRuntime, assigned by index.ts).
- `freshRuntime()` returns an object literal — add `pendingExplicitPaths: []` as one new property.
- Per-session isolated: each fresh runtime gets its OWN array (GOTCHA #5 — never module-level shared array, would leak paths across sessions). `[]` literal in freshRuntime satisfies this.
- JSDoc density is VERY high (every field has a multi-line `/** */` citing spec sections + GOTCHA refs + WHO WRITES/READS). New field MUST match this density.
- Auto-reset: `resetRuntime(sid)` DELETES the entry (so a fresh `pendingExplicitPaths: []` is created on next `getRuntime`); `clearAll()` wipes all. No explicit clear needed for reset/shutdown.

### src/capture.ts (existing handler pattern — the template to copy)
Imports already present (line ~31):
```ts
import type { TurnStartEvent, AgentEndEvent, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { getRuntime } from "./runtime.js";
import type { SessionRuntime } from "./runtime.js";
import { log } from "./log.js";
```
→ MUST ADD `ToolCallEvent` to the `@earendil-works/pi-coding-agent` type import.

**turnStartCaptureHandler canonical structure (the EXACT pattern S1 must mirror):**
```ts
export async function turnStartCaptureHandler(event, ctx): Promise<void> {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so catch can log
    if (!getConfig().revert.enabled) return;       // layer-1 gate — FIRST check
    const rt = getRuntime(sessionId);              // STRING arg, not ctx (GOTCHA #5)
    if (!rt.store) return;                          // store not created
    const backend = rt.store.describe().backend;
    if (backend === "none") return;                 // NoOpStore
    // ... do work ...
  } catch (e) {
    try { log("error", "capture.turn_start", sessionId, { error: String(e) }); } catch {}
  }
}
```
registerXxx pattern: `export function registerXxx(pi: ExtensionAPI): void { pi.on("event", handler); }`

### src/snapshot/cas.ts (CasBackend specifics)
- `describe(): { backend: "cas" }` — identifies CasBackend (sync, no IO).
- `capture(label: string, explicitPaths?: string[]): Promise<string | null>` — the 2nd param is **CasBackend-specific widening, NOT on the `SnapshotStore` interface** (`store.ts` declares `capture(label: string)` only). Confirmed: `src/snapshot/store.ts:80` → `capture(label: string): Promise<string | null>`.
- `captureExplicitPaths(label, explicitPaths)` is PRIVATE; called from `capture` when `this.cfg.nonGitMode === "explicit-paths"`. Loops `explicitPaths ?? []` (dedupes via internal `seen` Set). **This is the empty-manifest root cause: today every caller passes NO 2nd arg → `undefined ?? [] = []`.**
- `notifyBashUsed(): void` — PUBLIC, CasBackend-specific (NOT on SnapshotStore). Self-guards: no-op unless `cfg.nonGitMode === "explicit-paths"`, once-per-turn via `bashWarnedThisTurn` latch. Emits `console.warn(...)`. → S1's handler calls `(rt.store as CasBackend).notifyBashUsed()` on a bash event. The cast is REQUIRED (SnapshotStore-typed ref cannot reach it).

### config (src/config.ts)
- `getConfig().revert.enabled` — master switch (default false). Layer-1 gate.
- `getConfig().revert.nonGitMode` — `"cas" | "explicit-paths"` (default `"cas"`). Only meaningful when backend is CasBackend (git repos get GitBackend; non-git dirs get CasBackend + nonGitMode picks capture strategy).
- DEFAULT_CONFIG: `revert: { enabled: false, …, nonGitMode: "cas" }`.

### Pi ToolCallEvent (node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts)
```ts
interface ToolCallEventBase { type: "tool_call"; toolCallId: string; }
interface WriteToolCallEvent extends ToolCallEventBase { toolName: "write"; input: WriteToolInput; }  // WriteToolInput = { path: string; content: string }
interface EditToolCallEvent  extends ToolCallEventBase { toolName: "edit";  input: EditToolInput; }   // EditToolInput  = { path: string; edits: {oldText,newText}[] }
interface BashToolCallEvent  extends ToolCallEventBase { toolName: "bash";  input: BashToolInput; }   // BashToolInput  = { command: string; ... }
type ToolCallEvent = BashToolCallEvent | ReadToolCallEvent | EditToolCallEvent | WriteToolCallEvent | GrepToolCallEvent | FindToolCallEvent | LsToolCallEvent | CustomToolCallEvent;
```
**CRITICAL narrowing caveat (types.d.ts:758, from isToolCallEventType JSDoc):**
> "Direct narrowing via `event.toolName === "bash"` **doesn't work** because `CustomToolCallEvent.toolName` is `string` which overlaps with all literals."

→ Two valid extraction strategies:
- **A (contract-specified):** `if (event.toolName === "write" || event.toolName === "edit")` as a VALUE check (runtime-correct), then `const path = (event.input as { path?: string }).path;` with `if (typeof path === "string")` defensive guard. The cast is REQUIRED because `===` does not narrow TS types.
- **B (idiomatic Pi):** `import { isToolCallEventType } from "@earendil-works/pi-coding-agent";` then `if (isToolCallEventType("write", event)) { … event.input.path (typed string) … }`. Narrows cleanly, no cast.

PRP presents A as PRIMARY (matches item_description verbatim) and notes B as the type-safe alternative. Both are correct; the `===` value check + defensive cast is the explicit contract.

### index.ts registration (S2 will do this — S1 must NOT)
Step 5 currently registers: `registerFilterHandler`, `registerBloatReminder`, `registerTurnEndMetric`, `registerTurnStartCapture`, `registerAgentEndCapture`. S2 will add `registerToolCallCapture(pi)` here + thread paths into capture calls + clear accumulator. **S1 only EXPORTS `registerToolCallCapture`; it does not call it.**

### Test pattern (test/capture.test.ts)
- vitest `describe/it/expect`. Module-level reset: `clearAll()` + `setConfig({ revert: { enabled: true } })` in beforeEach; `setConfig(DEFAULT_CONFIG)` + `setLogFile(null)` in afterEach.
- Hand-rolled fakes (NO vi.fn): `makePi()` records `.on(event, handler)` into a `handlers` map; `makeCtx({sessionId, throwOnGetSessionId})`; `RecordingStore implements SnapshotStore` with a `calls: string[]` log.
- For S1 unit tests: need a CasBackend-shaped fake — `describe().backend === "cas"`, a `notifyBashUsed()` method + a `notifyBashUsedCalls` counter (or a `bashWarned` latch). Cast `as unknown as SnapshotStore` where the fake is a superset.
- ToolCallEvent factory: `{ type: "tool_call", toolCallId: "tc1", toolName: "write", input: { path: "src/a.ts", content: "x" } }`.

### Validation gates (verified, project-specific)
- `npm run typecheck` → `tsc --noEmit` (STRICT). The PRIMARY gate — catches the type-narrowing issue + the cast correctness.
- `npm test` → `vitest run` (full suite, currently ~1277 tests pass). Component tests for the new handler go in `test/capture.test.ts`.
- NO ruff/mypy/eslint (those are Python/legacy; this is TS). NO biome for these files per the sibling PRP.

## Gate-order decision (final)
Inside `toolCallCaptureHandler`, the work-item-contract order:
1. `sessionId = ctx.sessionManager.getSessionId();` (FRESH, C12)
2. `if (!getConfig().revert.enabled) return;` (layer 1)
3. `const rt = getRuntime(sessionId);`
4. `if (!rt.store) return;`
5. `const backend = rt.store.describe().backend;`
6. `if (backend !== "cas") return;` (explicit-paths is CasBackend-specific; git has its own capture; none = NoOpStore)
7. `if (getConfig().revert.nonGitMode !== "explicit-paths") return;` (skip accumulation when the mode won't consume the paths)
8. then: write/edit → push `path` to `rt.pendingExplicitPaths`; bash → `(rt.store as CasBackend).notifyBashUsed()`

Backend-check-before-nonGitMode is correct + slightly cheaper (nonGitMode is irrelevant for git/none).

## Dedup decision
Accumulator dedup is OPTIONAL per the contract; `captureExplicitPaths` already dedupes via its internal `seen` Set. PRP recommends a SIMPLE `push` (no dedup) for minimal cost/surface — but notes a cheap `.includes()` guard is harmless. Keep it simple.