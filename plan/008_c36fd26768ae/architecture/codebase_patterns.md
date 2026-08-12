# Codebase Patterns to Follow — v1.2 Working-Tree Revert

## 1. Config Pattern (`src/config.ts`)
```
MulliganConfig interface → add `revert` block with 8 fields
DEFAULT_CONFIG object → add revert defaults (all inert until enabled)
validateConfig(raw) → add `revertRaw = safeGet(raw, "revert")` block with per-field coercers
```
- Use existing helpers: `safeGet(obj, key)`, `coerceBoolean(v, fallback)`, `coerceNumber(field, v, fallback, mustBePositive)`, `warnConfig(field, value)`, `isRecord(value)`
- NEVER throw — outer try/catch → defaults
- Booleans coerce via `!!`; strings validate domain; arrays coerce element-type
- `storageDir` special validation: MUST NOT resolve inside `cwd` (use `path.resolve` comparison)

## 2. Marker Pattern (`src/markers.ts`)
```
RewindMarker extends MulliganEnvelope → add optional `revert?` field
RevertCheckpoint → NEW exported type (referenced by runtime.ts + store.ts)
RewindMarkerInput → automatically picks up `revert?` via Omit
```
- Optional field → old markers type-check unchanged (backward-compat)
- `appendRewindMarker(pi, ctx, data)` → the `data` param spreads into the marker; the new `revert` field rides the spread like `checkpoint` does today
- Never throws

## 3. Runtime Pattern (`src/runtime.ts`)
```
SessionRuntime → add `snapshots?: Map<string, RevertCheckpoint>`
freshRuntime(sessionId) → initialize `snapshots: new Map()`
```
- Module-scoped `runtimes = new Map<string, SessionRuntime>()` — single source of truth
- `resetRuntime` (session_start) deletes the entry → snapshots map is cleared automatically
- `clearAll` (session_shutdown) wipes everything

## 4. Tool Factory Pattern (`src/tools/rewind.ts`)
```
RewindParams = Type.Object({...}) → add 2 new optional boolean fields
REWIND_DESC → append revert_file_changes advertisement sentence
rewindExecute(pi, toolCallId, params, signal, onUpdate, ctx) → add step 6b
makeRewindTool(pi): ToolDefinition → captures pi via closure
```
- RewindParams schema is VERBATIM from spec/05 §1 — copy the exact descriptions
- step 6b goes AFTER marker persist (step 7 in current numbering), BEFORE mutation warning
- The factory pattern: `makeRewindTool(pi)` returns `{ name, description, inputSchema, execute }` with `pi` captured
- `successText()` is extended to include revert results
- The payload to `appendRewindMarker` includes `revert` field via spread

## 5. Command Factory Pattern (`src/commands.ts`)
```
makeCheckpointCommand(pi): { description, handler } → add step 4b
```
- `pi` captured by closure; `(args, ctx)` at CALL time
- Handler body wrapped in try/catch → unexpected-error notify; NEVER throws
- Step 4b goes AFTER `setCheckpoint` success, BEFORE `reconcileBanner` — best-effort capture, failures logged only
- `notify(ctx, ...)` guarded by `ctx.hasUI`

## 6. Event Handler Registration Pattern (`src/index.ts`)
```
pi.on("turn_start", (event, ctx) => {...})  → only active when config.revert.enabled
pi.on("agent_end", (event, ctx) => {...})   → only active when config.revert.enabled
```
- Factory must call `detectAndCreate(ctx.cwd, getConfig())` to create the store
- Store handle must be threadable to: (a) capture hooks, (b) rewind tool, (c) checkpoint command
- Options: pass store to `makeRewindTool(pi, store)` / `makeCheckpointCommand(pi, store)` OR store on `SessionRuntime`
- `session_shutdown` handler must wipe the store (both git shadow repo + CAS dir)

## 7. Test Pattern (`test/`)
- Unit tests: pure modules tested without Pi (vitest)
- Integration tests: in `test/integration/` with temp git repos
- Tool tests: `makeRewindTool(fakePi).execute(params, fakeCtx)` — factory seam
- Command tests: `makeCheckpointCommand(fakePi).handler("name", fakeCtx)` — factory seam
- Convention: every test file imports `.js` extensions (Node ESM + tsc output convention)

## 8. Store Threading Decision
The store handle needs to be accessible from:
- `turn_start` / `agent_end` hooks (capture)
- `rewindExecute` (restore)
- `makeCheckpointCommand` (checkpoint capture)
- `session_shutdown` (teardown)

**Recommended approach:** store the handle on `SessionRuntime` (add `store?: SnapshotStore` field). This follows the existing pattern where all per-session mutable state lives on `SessionRuntime`. The store is created in `session_start` (when `config.revert.enabled`) and destroyed in `session_shutdown`.

## 9. driftThresholdTokens Discrepancy
Spec (§04 §7) says default `6000`; code has `4000` (BUG-003 fix). The BUG-003 fix is correct (at 6000 with `>`, criterion (b) never fired). This is NOT a v1.2 task — leave the code at 4000. The spec value is aspirational; the bug fix takes precedence.