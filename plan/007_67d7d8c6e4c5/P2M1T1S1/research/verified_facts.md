# Research Notes — P2.M1.T1.S1: commands.ts (checkpoint set + revoke factories)

All facts verified by reading the live codebase this session. Line numbers are current.

## 1. The reused inputs (NO modification needed)

### `setCheckpoint` — `src/markers.ts:435-480`
- **Signature:** `export function setCheckpoint(pi: ExtensionAPI, ctx: ExtensionContext, name: string): SetCheckpointResult`
- **`SetCheckpointResult`** (markers.ts:401): `export type SetCheckpointResult = { entryId: string } | { error: string };`
- **Behavior:** walks `ctx.sessionManager.getBranch()` (ROOT→LEAF) BACKWARDS to the last `message` entry with a non-empty `message.role` (BUG-003 fix — does NOT label raw `getLeafId()`). Then `pi.setLabel(stableId, "mulligan:checkpoint:" + name)`.
- **Returns:** `{entryId: stableId}` on success; `{error: "no conversation message to checkpoint (emit a message first, then retry)"}` when no real message on branch; `{error: <msg>}` on any thrown failure.
- **NEVER throws** (whole body in try/catch). **Trusts the name** (does NOT validate — that's the caller's job, markers.ts GOTCHA #7).
- Narrow with `"entryId" in res` / `"error" in res` (discriminated union).

### `validCheckpointName` — `src/tools/checkpoint.ts:74`
- **Signature:** `export function validCheckpointName(name: string): boolean`
- Body: `return typeof name === "string" && NAME_RE.test(name);`
- **`NAME_RE`** (checkpoint.ts:66) is **module-private** (`const NAME_RE = /^[a-z0-9_-]{1,40}$/;`) — NOT exported.
- **DECISION:** import `validCheckpointName` ONLY. Do NOT edit checkpoint.ts (no need to export NAME_RE). The invalid-name notify hardcodes the regex string `/^[a-z0-9_-]{1,40}$/` as a literal in the message text (see §4).

### `getConfig` — `src/config.ts`
- `export function getConfig(): MulliganConfig` — returns a defensive structuredClone every call.
- `getConfig().enabled` (boolean) — the master switch (spec/08 E14).
- **NOTE:** `MulliganConfig.ui.activeCheckpointBanner` does NOT exist yet (P2.M3.T1.S1 adds it). commands.ts must NOT reference it — just calls `reconcileBanner(ctx)` unconditionally.

## 2. The two-phase discovery pattern to MIRROR — `checkpointExists`, `src/tools/rewind.ts:329-365`

This is the EXACT pattern `clearCheckpointByName` must mirror (discover candidates via raw entries, confirm via latest-wins `getLabel`, then CLEAR instead of just returning true):

```ts
// (from rewind.ts:329 — DO NOT copy verbatim; adapt to CLEAR + return boolean cleared)
function checkpointExists(ctx, name) {
  const needle = `mulligan:checkpoint:${name}`;            // ← prefix
  const candidates = new Set<string>();
  let entries;
  try { entries = ctx.sessionManager.getEntries(); } catch { return false; }   // never throw
  if (!Array.isArray(entries)) return false;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
      if (ee.type === "label" && ee.label === needle && typeof ee.targetId === "string" && ee.targetId.length > 0) {
        candidates.add(ee.targetId);                        // ← discovery phase
      }
    } catch { /* skip throwing-Proxy entry */ }
  }
  if (candidates.size === 0) return false;
  for (const id of candidates) {
    try { if (ctx.sessionManager.getLabel(id) === needle) return true; }   // ← confirm via latest-wins
    catch { /* treat as inactive */ }
  }
  return false;
}
```

**Why two-phase** (rewind.ts:316-323 JSDoc): Pi's label map is append-only; a `setLabel(id, undefined)` appends a clear entry, so scanning raw `getEntries()` for a string match finds the HISTORICAL label even after revocation. `getLabel(id)` applies latest-wins → returns `undefined` once cleared. So: discover candidate `targetId`s from raw `label` entries, then CONFIRM each via `getLabel(id) === needle` before acting. For `clearCheckpointByName`: on each confirmed candidate call `pi.setLabel(id, undefined)`; return true if ANY cleared, false if none confirmed.

## 3. Pi surfaces (verified — `plan/.../architecture/external_deps.md` §1/§3/§4)

- **`pi.registerCommand(name, options)`** — types.d.ts:903. `options: Omit<RegisteredCommand, "name"|"sourceInfo">` = `{ description?, getArgumentCompletions?, handler }`.
- **handler:** `(args: string, ctx: ExtensionCommandContext) => Promise<void>`.
- **`ExtensionCommandContext extends ExtensionContext`** (types.d.ts:254) → has `ui`, `hasUI`, `sessionManager`, `cwd`, `mode`, `getContextUsage()`, PLUS command-only methods (navigateTree, newSession, …).
- **`ExtensionContext`** (types.d.ts:390+) → `ui: ExtensionUIContext`, `hasUI: boolean` (true in TUI/RPC, false in print/JSON), `sessionManager: ReadonlySessionManager`, `cwd: string`.
- **`ctx.ui.notify(message, type?)`** — `type: "info" | "warning" | "error"`. Already used in shrink.ts + nudges.ts.
- **`ctx.ui.setWidget(key, content, options?)`** — types.d.ts:97. `content: string[] | undefined` (undefined clears). `{ placement?: "aboveEditor"|"belowEditor" }`. (Used by banner.ts, NOT by commands.ts.)
- **C2 does NOT block registerCommand** — C2 forbids extension-injected *messages* dispatching as commands; registerCommand is direct registration, human-typed. (external_deps.md §1.)

### `ReadonlySessionManager` methods used (external_deps.md §6)
- `getEntries()` — raw session entry array (includes `label` entries).
- `getLabel(id)` — latest-wins label resolution → `string | undefined`.
- `getBranch()` — ROOT→LEAF branch array (used by setCheckpoint).
- `getLeafId()`, `getSessionId()`.

## 4. spec/13 §2/§3 — the AUTHORITATIVE notify messages

The contract (item_description) cites "spec/13 §2/§3 define the exact behavior + notify messages." The spec IS the message-wording authority. THREE of the contract's inline notify strings deviate from the spec (contract shorthand). **SPEC §2/§3 WINS** for wording; use these verbatim:

| # | Case | spec/13 message (USE THIS) | type |
|---|------|----------------------------|------|
| 1 | invalid name (§2 step 1) | `Mulligan: invalid checkpoint name '<name>' (lowercase, digits, hyphen, underscore; max 40)` | warning |
| 2 | set fair-warning (§2 step 5) | `Mulligan: checkpoint '<name>' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with /mulligan_checkpoint_revoke <name>.` | warning |
| 3 | not-found (§3 step 2) | `Mulligan: no active checkpoint named '<name>'.` | info |
| 4 | revoked (§3 step 5) | `Mulligan: checkpoint '<name>' revoked. The agent can no longer rewind across your prompts to it.` | info |
| 5 | set wrapper-error (contract 3b) | `Mulligan: could not set checkpoint: <res.error>` | warning |
| 6 | disabled (contract 3b) | `Mulligan is disabled` (contract literal — deviates from "Mulligan: " prefix by design; keep as-is) | warning |
| 7 | unexpected error (contract try/catch) | `Mulligan: unexpected error: <msg>` | warning |

**Contract deviations flagged (spec wins for #1/#2/#3):**
- **#1 invalid-name:** contract wrote `"...name '<name>' — must match /^[a-z0-9_-]{1,40}$/"`; spec §2 step 1 wrote `"...name '<name>' (lowercase, digits, hyphen, underscore; max 40)"`. Use spec (designed UX). Both convey format; spec is human-readable.
- **#2 set fair-warning:** contract OMITTED the parenthetical `"(your prompts after here can be hidden)"`; spec §2 step 5 INCLUDES it. Use spec (it reinforces the consent/forgetting risk — the whole point of E26). **The parenthetical is load-bearing.**
- **#3 not-found:** contract wrote `"...named '<name>`."` (MISSING closing apostrophe on `<name>`); spec §3 step 2 wrote `"...named '<name>'."` (closing apostrophe present). Use spec (grammatical consistency with set/revoked which both quote the name).
- **#6 disabled:** contract wrote `"Mulligan is disabled"` (no "Mulligan: " prefix). Keep contract literal (it's explicit + a reasonable human message); note it breaks the "Mulligan: " prefix convention used by #1-5,#7.

## 5. Import-path GOTCHA (contract `../` is WRONG for src/commands.ts)

The contract says `setCheckpoint from ../markers.js; getConfig from ../config.js; validCheckpointName from ../tools/checkpoint.js; reconcileBanner from ../banner.js`. The `../` prefix is **WRONG** for a file at `src/commands.ts`. Confirmed: `src/index.ts` (also in `src/`) imports `"./tools/rewind.js"`, `"./config.js"` — `./` prefix. So `src/commands.ts` uses:
```ts
import { setCheckpoint } from "./markers.js";
import { getConfig } from "./config.js";
import { validCheckpointName } from "./tools/checkpoint.js";
import { reconcileBanner } from "./banner.js";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
```
(House convention: `.js` extensions + Bundler `moduleResolution` — confirmed checkpoint.ts GOTCHA #2 + tsconfig `moduleResolution: "Bundler"`.)

## 6. The banner.ts stub decision (contract NOTE)

`src/banner.ts` does NOT exist yet (P2.M3.T1.S2 creates the real impl). Per the contract NOTE: "Create src/banner.ts with a minimal reconcileBanner stub that P2.M3.T1.S2 will flesh out." So **S1 creates `src/banner.ts` with a typed no-op stub** so `commands.ts`'s `import { reconcileBanner } from "./banner.js"` resolves today. P2.M3.T1.S2 replaces the stub body. reconcileBanner must be typed `(ctx: ExtensionContext) => void` (external_deps.md §5: called from contextHandler/session_start which get ExtensionContext, not just ExtensionCommandContext).

## 7. Scope discipline — S1 vs S2 vs S3

- **S1 (THIS TASK):** create `src/commands.ts` (3 exports: `makeCheckpointCommand`, `makeCheckpointRevokeCommand`, `clearCheckpointByName`) + `src/banner.ts` (stub). DO NOT touch index.ts (S2 registers), DO NOT write tests (S3 tests).
- **S2 (P2.M1.T1.S2):** index.ts does `pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi))` + `pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi))`.
- **S3 (P2.M1.T1.S3):** tests (model on test/tools/checkpoint.test.ts idioms: hand-rolled makePi capturing setLabel + makeCtx scripting getEntries/getLabel; vitest; clearAll()+setConfig(undefined) in beforeEach).
- **tsconfig has NO noUnusedLocals / noUnusedParameters** → exported-but-unregistered factories typecheck clean even though nothing imports them yet (S2 will). Confirmed (same reason P1.M3 retained checkpoint.ts).

## 8. Validation gates for S1

- **Primary:** `npm run typecheck` (= `tsc --noEmit`, strict + noImplicitAny) → exit 0. Proves imports resolve, handler signature `(args: string, ctx: ExtensionCommandContext) => Promise<void>` matches the Pi contract, discriminated-union narrowing is correct.
- **No test gate in S1** (S3 owns tests). But the implementer can sanity-check the exported shapes by a type-level assertion that the factory output is assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]` (optional bridge; S2 registration is the real proof).
- `npm test` (full vitest suite) must stay GREEN — S1 adds new files that nothing imports, so existing tests are unaffected. If a test breaks, you accidentally edited an existing file (revert).