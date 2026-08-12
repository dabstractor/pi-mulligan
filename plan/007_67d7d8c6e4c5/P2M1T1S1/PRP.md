# PRP — P2.M1.T1.S1: `commands.ts` — checkpoint SET + REVOKE command factories

## Goal

**Feature Goal**: Create `src/commands.ts` exporting two **slash-command factories** + one **shared helper** that back the
v1.1 *human-facing* checkpoint surface (spec/13 §2 `/mulligan_checkpoint <name>` set, §3 `/mulligan_checkpoint_revoke
<name>` revoke). These are thin `pi.registerCommand` handlers — human-invoked, write-only w\.r.t. the model's context
(nothing is injected into `event.messages`) — that reuse the existing pure helpers (`setCheckpoint`, `validCheckpointName`,
`getConfig`) and a tiny two-phase label-discovery loop (mirroring `checkpointExists` in rewind.ts). This **replaces** the
removed v1 `mulligan_checkpoint` agent tool (E23 RESOLVED): the *user* — the actor with foresight — now sets checkpoints
via a slash command; the agent retains only `mulligan_rewind(granularity:"checkpoint")` to rewind *to* them.

**Deliverable**: **Two new files**:
1. `src/commands.ts` — exports `makeCheckpointCommand(pi)`, `makeCheckpointRevokeCommand(pi)`, and `clearCheckpointByName(pi, ctx, name)`.
   Each factory returns the `{ description, handler }` shape for `pi.registerCommand` (consumed by P2.M1.T1.S2).
2. `src/banner.ts` — a **minimal typed no-op stub** `reconcileBanner(ctx)` so `commands.ts`'s `import { reconcileBanner }`
   resolves today; P2.M3.T1.S2 replaces the stub body with the real active-checkpoint banner (spec/13 §5).

**Success Definition**: (a) `npm run typecheck` (`tsc --noEmit`, strict) exits 0 on the two new files (imports resolve;
handler signatures exactly match the Pi `registerCommand` contract; discriminated-union narrowing is correct); (b) the
full `npm test` suite stays GREEN (new files import nothing that existing tests depend on; nothing imports commands.ts
yet — S2 will); (c) `git status --short` shows **only** `src/commands.ts` + `src/banner.ts` added (NO edits to index.ts,
checkpoint.ts, markers.ts, config.ts, or any test — those belong to S2/S3/other siblings); (d) the factory outputs are
structurally assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]` (the S2 registration will typecheck).

> ⚠️ **SCOPE:** This is S1 of a 3-subtask chain (S1 factories → S2 index.ts registration → S3 tests). S1 creates the
> factories + the banner stub ONLY. **Do NOT register the commands in index.ts** (that is P2.M1.T1.S2). **Do NOT write
> the tests** (that is P2.M1.T1.S3). Running in parallel with P1.M3.T1.S2 (which edits `test/index.test.ts` only) —
> **zero file overlap**.

## User Persona

**Target User**: A Pi user working in the TUI who wants to proactively mark a transcript position before a risky/speculative
sub-task, so a later `mulligan_rewind(granularity:"checkpoint")` (agent) can jump straight back to it in one shot.

**Use Case**: The user types `/mulligan_checkpoint before-refactor` before asking the agent to refactor; later, if the
refactor goes sideways, the agent rewinds to that anchor. The user can `/mulligan_checkpoint_revoke before-refactor` to
withdraw the cross-prompt rewind consent once the risky stretch is past.

**User Journey**: (1) user types `/mulligan_checkpoint <name>` → the last real message is labeled `mulligan:checkpoint:<name>`
via `setCheckpoint`; a **persistent fair-warning** notifies the user that the agent may now rewind across their subsequent
prompts back to here, plus how to revoke. (2) the active-checkpoint banner (spec/13 §5, P2.M3.T1.S2) arms/refreshes. (3)
later, `/mulligan_checkpoint_revoke <name>` clears the label (latest-wins → the agent's next checkpoint rewind by that name
refuses "not found") and refreshes the banner.

**Pain Points Addressed**: E23 — checkpoints exposed to the agent (hindsight-only, near-zero adoption) are moved to the user
(the actor with foresight). E26 — a long-lived checkpoint's destructive power is surfaced (fair-warning notify + banner).

## Why

- **E23 RESOLVED (spec/13 §6, E23 h2.104):** the checkpoint tool was an *agent* tool, but a checkpoint only pays off when set
  *before* a mistake — agents anticipate poorly, users don't. v1.1 moves it to a human slash command; the agent tool is
  removed (P1.M3). This subtask builds the human replacement.
- **Thin handlers, zero new logic:** the factories reuse `setCheckpoint` (markers.ts:435), `validCheckpointName`
  (checkpoint.ts:74), and `getConfig` (config.ts). The only new logic is `clearCheckpointByName` — a two-phase label
  discovery+clear loop that **mirrors the existing** `checkpointExists` (rewind.ts:329) exactly (discover candidates via
  raw `getEntries()`, confirm via latest-wins `getLabel(id)===needle`).
- **Safe by construction:** commands are write-only w\.r.t. the model's context (notify is human-facing via `ctx.ui`; no
  `event.messages` injection). C2 does NOT block `registerCommand` (C2 forbids extension-injected *messages* dispatching
  as commands; this is direct registration, human-typed — external_deps.md §1).
- **Enables the v1.1 chain:** S2 registers these in index.ts; S3 tests them; P2.M3.T1.S2 fills in the banner stub; P2.M3.T1.S3
  hooks `reconcileBanner` into the context/session_start refresh points.

## What

Two new files, no edits to existing files.

### `src/commands.ts` exports

1. **`makeCheckpointCommand(pi: ExtensionAPI)`** → returns `{ description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }`.
   - `description`: `"Set a Mulligan checkpoint — the agent may rewind across your subsequent prompts back to this point"` (verbatim contract).
   - `handler`: see Implementation Blueprint → makeCheckpointCommand handler. All `ctx.ui.notify` calls guarded by `ctx.hasUI`; whole body in try/catch → `notify(ctx, "Mulligan: unexpected error: " + msg, "warning")`; **never throws**.

2. **`makeCheckpointRevokeCommand(pi: ExtensionAPI)`** → same return shape.
   - `description`: `"Revoke a Mulligan checkpoint"` (verbatim contract).
   - `handler`: see Implementation Blueprint → makeCheckpointRevokeCommand handler.

3. **`clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean`** — the shared helper. Two-phase
   (mirrors `checkpointExists` in rewind.ts:329): discover candidate `targetId`s from raw `label` entries where
   `type==="label" && label==="mulligan:checkpoint:"+name && typeof targetId==="string" && targetId.length>0`; for each,
   confirm `ctx.sessionManager.getLabel(id)===needle`; on each confirmed candidate call `pi.setLabel(id, undefined)`; return
   `true` if any cleared, `false` if none found. **Never throws** (defensive try/catch on `getEntries`/`getLabel`/entry access).

### `src/banner.ts` (stub)

- **`reconcileBanner(ctx: ExtensionContext): void`** — typed no-op. Body is a comment: "STUB — implemented in P2.M3.T1.S2."

### Success Criteria

- [ ] `src/commands.ts` exports `makeCheckpointCommand`, `makeCheckpointRevokeCommand`, `clearCheckpointByName` (all three).
- [ ] `src/banner.ts` exports `reconcileBanner` (no-op stub, typed `(ctx: ExtensionContext) => void`).
- [ ] Each factory returns `{ description, handler }` where handler is `(args: string, ctx: ExtensionCommandContext) => Promise<void>`.
- [ ] Handler bodies: parse name via `(args ?? "").trim()`; disabled-gate (`getConfig().enabled`); name-validation gate
      (`validCheckpointName`); delegate (`setCheckpoint` / `clearCheckpointByName`); spec/13 §2/§3 verbatim notify messages;
      `reconcileBanner(ctx)` called after each successful mutation; all notify calls guarded by `ctx.hasUI`; whole body in
      try/catch → unexpected-error notify; never throws.
- [ ] `npm run typecheck` → exit 0. `npm test` → full suite GREEN. `git status --short` → only `src/commands.ts` + `src/banner.ts`.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the verbatim import statements with the **correct `./` paths** (the contract's `../` is wrong —
see GOTCHA #1); the exact `setCheckpoint` / `validCheckpointName` / `getConfig` signatures + behaviors (with line numbers);
the **exact two-phase discovery loop to mirror** (rewind.ts:329 `checkpointExists`, reproduced as the template); the
**authoritative notify messages** (spec/13 §2/§3 verbatim — with the 3 contract-shorthand deviations flagged and resolved);
the `registerCommand` + `ExtensionCommandContext` Pi contract (verified in external_deps.md); the banner-stub decision;
the scope boundary (S1 = factories + stub; S2 = registration; S3 = tests); and deterministic typecheck + vitest gates.

### Documentation & References

```yaml
# MUST READ — the spec authority for behavior + notify messages (the contract cites these as "exact behavior + notify messages")
- docfile: spec/13-human-facing-surface.md
  why: "§2 = /mulligan_checkpoint set (6 steps: validate→label→fair-warning notify→arm banner); §3 = /mulligan_checkpoint_revoke
        (5 steps: find label→not-found notify→clear→refresh banner→revoked notify); §0 = registerCommand mechanism (C2 safe);
        §5 = the active-checkpoint banner (reconcileBanner — stubbed here, real impl in P2.M3.T1.S2); §6 = interaction w/ the
        rest of the spec (agent-tool inventory now 4; E23 RESOLVED)."
  critical: "spec/13 §2/§3 are the WORDING AUTHORITY for the notify messages. The contract's inline notify strings deviate in
             3 places (invalid-name, set fair-warning, not-found) — SPEC §2/§3 WINS. See GOTCHA #4 for the exact resolution."

# MUST READ — the reused input: setCheckpoint (do NOT reimplement)
- file: src/markers.ts
  why: "setCheckpoint (line 435) is the SOLE writer of mulligan:checkpoint: labels for the SET command. Signature:
        (pi: ExtensionAPI, ctx: ExtensionContext, name: string): SetCheckpointResult where SetCheckpointResult = {entryId}
        | {error} (line 401). It walks getBranch() BACKWARDS to the last real message (BUG-003 fix — does NOT label
        getLeafId()), then pi.setLabel(stableId, 'mulligan:checkpoint:'+name). NEVER throws (try/catch). TRUSTS the name
        (does NOT validate — GOTCHA #7 — that's the command handler's job). Narrow with 'entryId' in res / 'error' in res."
  section: "setCheckpoint (lines 394-480); SetCheckpointResult (line 401)."
  pattern: "Discriminated-union return: success carries entryId; failure carries error string. The SET handler: on entryId →
            fair-warning notify + reconcileBanner; on error → 'could not set checkpoint: <error>' notify."
  gotcha: "setCheckpoint returns {error:'no conversation message to checkpoint (emit a message first, then retry)'} when the
           branch has no real message — the SET handler surfaces this verbatim via the 'could not set checkpoint: <error>' path."

# MUST READ — the EXACT two-phase pattern to MIRROR for clearCheckpointByName (the REVOKE discovery)
- file: src/tools/rewind.ts
  why: "checkpointExists (line 329-365) is the two-phase label-discovery loop clearCheckpointByName must mirror. DISCOVER:
        scan ctx.sessionManager.getEntries() for entries where type==='label' && label==='mulligan:checkpoint:'+name &&
        typeof targetId==='string' && targetId.length>0 → collect into a Set<string>. CONFIRM: for each candidate id, check
        ctx.sessionManager.getLabel(id)===needle (latest-wins — a cleared label returns undefined). For clearCheckpointByName:
        on each CONFIRMED candidate call pi.setLabel(id, undefined); return true if any cleared, false if none."
  section: "checkpointExists (lines 316-365)."
  pattern: "Two-phase: raw-entry DISCOVERY (find candidate targetIds) + latest-wins CONFIRM (getLabel===needle). Defensive
            throughout: throwing getEntries/getLabel/Proxy-trap entry → skip/return-false, NEVER throw."
  critical: "WHY two-phase (JSDoc 316-323): Pi's label map is APPEND-ONLY — a setLabel(id, undefined) appends a CLEAR entry,
             so scanning raw getEntries() for a string match finds the HISTORICAL label even after revocation. getLabel(id)
             applies latest-wins → undefined once cleared. So you MUST confirm via getLabel before clearing, else you'd
             'clear' an already-cleared label (harmless) or miss the consumed state. clearCheckpointByName only calls
             setLabel(id, undefined) on CONFIRMED-active candidates."

# MUST READ — the reused input: validCheckpointName (do NOT edit this file)
- file: src/tools/checkpoint.ts
  why: "validCheckpointName (line 74, EXPORTED) is the name-format guard: typeof name==='string' && NAME_RE.test(name).
        NAME_RE (line 66) is module-private /^[a-z0-9_-]{1,40}$/. IMPORT validCheckpointName ONLY (no edit to checkpoint.ts).
        The invalid-name notify hardcodes the regex as a literal string in the message (per spec §2 step 1 wording)."
  section: "validCheckpointName (line 74); NAME_RE (line 66)."
  gotcha: "Do NOT export NAME_RE or otherwise edit checkpoint.ts. The factory makeCheckpointTool (line 182) is RETAINED
           (Phase 2 reuse) — leave it. tsconfig has no noUnusedLocals so its unregistered state typechecks."

# MUST READ — the reused input: getConfig (the master-switch gate; spec/08 E14)
- file: src/config.ts
  why: "getConfig() returns a fresh MulliganConfig clone each call; getConfig().enabled (boolean) is the master switch. Both
        command handlers gate on !getConfig().enabled BEFORE name validation (mirrors all 4 agent tools' step-1 disabled gate)."
  gotcha: "MulliganConfig.ui.activeCheckpointBanner does NOT exist yet (P2.M3.T1.S1 adds it). commands.ts must NOT reference
           it — just call reconcileBanner(ctx) unconditionally."

# MUST READ — the Pi surfaces (verified)
- docfile: plan/007_67d7d8c6e4c5/architecture/external_deps.md
  why: "§1 registerCommand(name, {description?, handler}) — handler (args:string, ctx:ExtensionCommandContext)=>Promise<void>;
        Omit<RegisteredCommand,'name'|'sourceInfo'> = {description?,getArgumentCompletions?,handler}. §3 ExtensionCommandContext
        extends ExtensionContext (ui, hasUI, sessionManager, cwd, mode) + command-only methods. §4 ctx.ui.notify(msg, 'info'|
        'warning'|'error'). §5 reconcileBanner must accept ExtensionContext (not just ExtensionCommandContext) because it's
        also called from contextHandler/session_start. §6 ReadonlySessionManager: getEntries(), getLabel(id), getBranch(),
        getLeafId(), getSessionId()."
  critical: "C2 does NOT block registerCommand (§1) — registerCommand is direct registration, human-typed; C2 forbids
             extension-injected MESSAGES dispatching as commands. ctx.hasUI is true in TUI/RPC, false in print/JSON — guard
             every notify with it."

# MUST READ — the index.ts registration seam (S2's job — confirms the factory output shape this task must produce)
- file: src/index.ts
  why: "S2 (P2.M1.T1.S2) will add: pi.registerCommand('mulligan_checkpoint', makeCheckpointCommand(pi)) and
        pi.registerCommand('mulligan_checkpoint_revoke', makeCheckpointRevokeCommand(pi)), mirroring the existing
        pi.registerTool(makeRewindTool(pi)) closure pattern (line ~40). S1 does NOT touch index.ts."
  critical: "This is why the factory output MUST be structurally assignable to Parameters<ExtensionAPI['registerCommand']>[1]:
            {description?:string, handler:(args:string,ctx:ExtensionCommandContext)=>Promise<void>}. Verify with a type-level
            assertion or trust the inferred shape (the handler signature matches the Pi contract exactly)."

# REFERENCE — the sibling test idioms (S3's job, but informs how the factories must be testable)
- file: test/tools/checkpoint.test.ts
  why: "S3 will model command tests on this file's idioms: hand-rolled makePi() capturing setLabel via a `labels` array (no
        vi.fn()); makeCtx() scripting getEntries()/getLabel()/getBranch(); vitest; clearAll()+setConfig(undefined) in
        beforeEach/afterEach. S1's factories must be callable as makeCheckpointCommand(fakePi) returning {description,handler}
        with handler(args, ctx) — i.e. pi captured via closure, ctx passed at handler-call time (NOT factory time)."
  critical: "The handler receives ctx as its 2ND ARGUMENT (not via the closure). The closure captures pi ONLY. This is the
             testable seam — do not pass ctx into the factory."

# REFERENCE — the change-surface map (confirms the banner.ts-stub decision + scope boundaries)
- docfile: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "§Change 5/§Change 6 + 'src/tools/checkpoint.ts lifecycle': Phase 2 extracts validCheckpointName (re-export, avoid churn)
        — so S1 imports it from checkpoint.ts, does NOT delete checkpoint.ts. §Change 6: src/banner.ts (NEW) reconcileBanner;
        hook points include 'src/commands.ts checkpoint set/revoke → call reconcileBanner(ctx) after mutation'."
  critical: "index.ts is touched by S1(P1.M3), S2(P2.M1), S2(P2.M2), S3(P2.M3) — S1(P2.M1) does NOT touch index.ts."
```

### Current Codebase tree (the relevant slice)

```bash
src/
├── commands.ts            # ← CREATE (3 exports: makeCheckpointCommand, makeCheckpointRevokeCommand, clearCheckpointByName)
├── banner.ts              # ← CREATE (stub: reconcileBanner no-op, typed (ctx: ExtensionContext) => void)
├── markers.ts             # READ-ONLY — setCheckpoint (line 435), SetCheckpointResult (line 401) — REUSED by SET
├── config.ts              # READ-ONLY — getConfig().enabled master switch — REUSED by both handlers
├── tools/
│   ├── checkpoint.ts      # READ-ONLY — validCheckpointName (line 74, EXPORTED), NAME_RE (line 66, private) — REUSED
│   └── rewind.ts          # READ-ONLY — checkpointExists (line 329) — the two-phase pattern to MIRROR for clearCheckpointByName
├── index.ts               # READ-ONLY (S2's scope — registers the commands; S1 does NOT touch)
└── ...                    # (filter.ts, nudges.ts, transforms.ts, tokens.ts, ledger.ts, notes.ts, log.ts, runtime.ts, settings.ts)
spec/13-human-facing-surface.md  # READ-ONLY — §2/§3 behavior + notify messages (WORDING AUTHORITY)
plan/.../architecture/external_deps.md  # READ-ONLY — Pi surfaces (registerCommand, ExtensionCommandContext, notify, sessionManager)
plan/.../architecture/change_surface.md # READ-ONLY — scope map + banner.ts-stub decision
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/
├── commands.ts   # NEW — the 3 exports. makeCheckpointCommand/makeCheckpointRevokeCommand are thin pi.registerCommand
│                  #        handler factories (closure-capture pi; handler receives (args, ctx)). clearCheckpointByName is the
│                  #        shared two-phase label discovery+clear helper (mirrors rewind.ts:329 checkpointExists). No index.ts
│                  #        wiring (S2), no tests (S3).
└── banner.ts     # NEW — STUB: export function reconcileBanner(_ctx: ExtensionContext): void {} (no-op). P2.M3.T1.S2 fills
                   #        in the real active-checkpoint banner (spec/13 §5): scan active checkpoints, ctx.ui.setWidget(
                   #        'mulligan:active-checkpoint', lines, { placement:'aboveEditor' }) or undefined to clear.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (import paths — the contract's `../` is WRONG for src/commands.ts): the contract wrote
//   `setCheckpoint from ../markers.js; getConfig from ../config.js; validCheckpointName from ../tools/checkpoint.js;
//   reconcileBanner from ../banner.js`. The `../` prefix is WRONG — commands.ts lives in src/, so it imports with `./`.
//   CONFIRMED: src/index.ts (also in src/) imports "./tools/rewind.js", "./config.js" (./ prefix). Use:
//     import { setCheckpoint } from "./markers.js";
//     import { getConfig } from "./config.js";
//     import { validCheckpointName } from "./tools/checkpoint.js";
//     import { reconcileBanner } from "./banner.js";
//     import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
//   (.js extensions + Bundler moduleResolution — house convention, checkpoint.ts GOTCHA #2, tsconfig moduleResolution:"Bundler".)

// CRITICAL GOTCHA #2 (clearCheckpointByName MUST mirror the two-phase discovery in rewind.ts:329 — NOT a naive string scan):
//   Pi's label map is APPEND-ONLY. A revoke (setLabel(id, undefined)) appends a CLEAR entry; the HISTORICAL set entry stays
//   in raw getEntries(). So scanning getEntries() for label==='mulligan:checkpoint:'+name finds STALE labels even after
//   revocation. You MUST (a) DISCOVER candidate targetIds from raw label entries, then (b) CONFIRM each via
//   ctx.sessionManager.getLabel(id)===needle (latest-wins → undefined once cleared), and ONLY clear confirmed-active
//   candidates. A naive single-phase scan would "clear" already-cleared labels (harmless but wrong) or report a revoked
//   checkpoint as still active. Copy the checkpointExists loop (rewind.ts:329-365) and swap the return: on each confirmed
//   candidate call pi.setLabel(id, undefined) + set a `cleared` flag; return cleared.

// CRITICAL GOTCHA #3 (ctx typing — use the MINIMAL interface for reusability): clearCheckpointByName and reconcileBanner
//   only need ctx.sessionManager methods (getEntries/getLabel) — type their ctx as ExtensionContext (NOT
//   ExtensionCommandContext). This matches the sibling checkpointExists(ctx: ExtensionContext, name) in rewind.ts:329 AND
//   lets P2.M3.T1.S2 reuse clearCheckpointByName's concept from contextHandler/session_start (which receive
//   ExtensionContext). The command handlers receive ctx: ExtensionCommandContext (a SUBTYPE) — passing it where
//   ExtensionContext is expected is fine (structural subtyping). The FACTORIES' handler signature MUST be
//   (args: string, ctx: ExtensionCommandContext) => Promise<void> (the exact Pi registerCommand handler type).

// CRITICAL GOTCHA #4 (3 notify-message deviations — SPEC §2/§3 WINS over the contract's inline shorthand): the contract
//   cites "spec/13 §2/§3 define the exact behavior + notify messages" — the SPEC is the wording authority. Three of the
//   contract's inline strings deviate; USE THE SPEC VERBATIM:
//   (a) INVALID NAME: spec §2 step 1 = "Mulligan: invalid checkpoint name '<name>' (lowercase, digits, hyphen, underscore;
//       max 40)" [warning]. Contract wrote a regex-based variant "... — must match /^[a-z0-9_-]{1,40}$/". Use spec (designed UX).
//   (b) SET FAIR-WARNING: spec §2 step 5 = "Mulligan: checkpoint '<name>' set. Until you revoke it, the agent may rewind
//       across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with
//       /mulligan_checkpoint_revoke <name>." [warning]. Contract OMITTED the parenthetical "(your prompts after here can be
//       hidden)". USE THE SPEC — the parenthetical is load-bearing (reinforces the consent/forgetting risk, the point of E26).
//   (c) NOT-FOUND: spec §3 step 2 = "Mulligan: no active checkpoint named '<name>'." [info] (CLOSING apostrophe on <name>).
//       Contract wrote "...named '<name>." (MISSING closing apostrophe). Use spec (grammatical consistency w/ set/revoked).
//   (d) DISABLED: contract = "Mulligan is disabled" [warning] (no "Mulligan: " prefix). Keep contract literal (explicit +
//       reasonable human message); note it breaks the "Mulligan: " prefix convention used by the other notifies. Do NOT
//       "fix" it to "Mulligan: disabled" unless the user says so — the contract is explicit.
//   The remaining messages (revoked §3 step 5, set-wrapper-error, unexpected-error) match between contract and spec.

// CRITICAL GOTCHA #5 (guard EVERY notify with ctx.hasUI; never throw): ctx.hasUI is true in TUI/RPC, false in print/JSON.
//   Wrap each ctx.ui.notify(...) in `if (ctx.hasUI)`. (A small private notify(ctx, msg, type) helper that does the guard
//   reduces repetition — recommended.) The ENTIRE handler body is wrapped in try/catch →
//   notify(ctx, "Mulligan: unexpected error: " + (e instanceof Error ? e.message : String(e)), "warning"). Handlers NEVER
//   throw (spec/13 §2/§3 + the shared command convention — a throwing command handler would break the TUI command dispatch).
//   setCheckpoint and clearCheckpointByName themselves never throw, but the wrap is defense-in-depth (e.g. a regex surprise
//   or a throwing getConfig). NOTE: the label mutation (setCheckpoint / clearCheckpointByName) happens REGARDLESS of hasUI —
//   only the notify is guarded. (In practice hasUI is true whenever a human types a slash command, but guard per spec §2 step 5.)

// GOTCHA #6 (parse the name via (args ?? "").trim()): the handler's `args` is the raw string after the command name (e.g.
//   for `/mulligan_checkpoint before-refactor`, args === "before-refactor"). Trim whitespace; guard against null/undefined
//   with (args ?? ""). The trimmed value is the checkpoint name passed to validCheckpointName / setCheckpoint /
//   clearCheckpointByName. An empty/whitespace-only name fails validCheckpointName (NAME_RE requires >=1 char) → invalid-name
//   notify (not a separate "missing name" case — the spec has no distinct empty-name message; the format guard covers it).

// GOTCHA #7 (reconcileBanner(ctx) is called AFTER each SUCCESSFUL mutation, not on every path): SET calls reconcileBanner
//   only on the `{entryId}` success branch (NOT on the `{error}` branch — nothing changed). REVOKE calls reconcileBanner
//   only when cleared===true (NOT on the not-found branch — nothing changed). This matches spec §2 step 6 / §3 step 4
//   ("refresh the banner after mutating state"). The stub is a no-op, so the call is harmless today; P2.M3.T1.S2 makes it
//   meaningful. reconcileBanner takes ExtensionContext (the handler's ExtensionCommandContext is assignable).

// GOTCHA #8 (tsconfig: strict + noImplicitAny, NO noUnusedLocals/Parameters): exported-but-unregistered factories
//   typecheck clean even though nothing imports commands.ts yet (S2 will). The banner stub's unused `_ctx` param is fine
//   (no noUnusedParameters; leading-underscore convention documents intent anyway). DO NOT add `noUnusedLocals` workarounds.

// GOTCHA #9 (discriminated-union narrowing for setCheckpoint's result): setCheckpoint returns {entryId}|{error}. Narrow with
//   `"entryId" in res` (success) / `"error" in res` (failure) — the SAME idiom checkpoint.ts uses. Do NOT use `res.entryId`
//   without narrowing (TS error under strict). On the error branch, res.error is the string to interpolate into
//   "Mulligan: could not set checkpoint: " + res.error.

// OUT OF SCOPE (do NOT touch in this subtask):
//   - src/index.ts → S2 (P2.M1.T1.S2) registers the commands. S1 does NOT.
//   - test/* → S3 (P2.M1.T1.S3) writes the command tests. S1 does NOT.
//   - src/tools/checkpoint.ts, src/markers.ts, src/config.ts, src/tools/rewind.ts → READ-ONLY (reused inputs).
//   - src/banner.ts REAL impl → P2.M3.T1.S2. S1 creates only the STUB.
//   - config.ts ui.activeCheckpointBanner knob → P2.M3.T1.S1. commands.ts must NOT reference it.
// This PRP ADDS src/commands.ts + src/banner.ts ONLY. `git status --short` must show exactly those two (untracked).
```

---

## Implementation Blueprint

### Data models and structure

No new data models. The command factories reuse existing types:
- `ExtensionAPI`, `ExtensionCommandContext`, `ExtensionContext` — imported as TYPES from `"@earendil-works/pi-coding-agent"`.
- `SetCheckpointResult` (`{entryId}|{error}`) — from `setCheckpoint`'s return; narrowed in the SET handler.
- The factory return shape is the inferred `{ description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }` — structurally assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]` (`Omit<RegisteredCommand, "name"|"sourceInfo">`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/banner.ts (the STUB — do this FIRST so commands.ts's import resolves)
  - IMPLEMENT: export function reconcileBanner(_ctx: ExtensionContext): void { /* STUB — P2.M3.T1.S2 */ }
  - IMPORT: `import type { ExtensionContext } from "@earendil-works/pi-coding-agent";`
  - JSDOC: cite spec/13 §5; state this is a stub; P2.M3.T1.S2 fleshes out (scan active checkpoints, ctx.ui.setWidget(
            "mulligan:active-checkpoint", lines, { placement:"aboveEditor" }) or undefined to clear; guard with ctx.hasUI).
  - NAMING: reconcileBanner (camelCase, exported). Param _ctx (leading underscore = intentionally unused; tsconfig has
            no noUnusedParameters so even `ctx` works, but _ctx documents intent).
  - PLACEMENT: src/banner.ts (new file).
  - DO NOT: implement the real banner logic (P2.M3.T1.S2). The stub MUST be a no-op (empty body) so it's a true placeholder.

Task 2: CREATE src/commands.ts — the shared helper clearCheckpointByName (MIRROR rewind.ts:329 checkpointExists)
  - IMPORT (see GOTCHA #1 — `./` paths, NOT `../`):
      import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
      import { setCheckpoint } from "./markers.js";
      import { getConfig } from "./config.js";
      import { validCheckpointName } from "./tools/checkpoint.js";
      import { reconcileBanner } from "./banner.js";
  - IMPLEMENT: export function clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean
      Body (MIRROR checkpointExists in rewind.ts:329-365, adapted to CLEAR + return boolean):
        const needle = `mulligan:checkpoint:${name}`;
        const candidates = new Set<string>();
        let entries: unknown;
        try { entries = ctx.sessionManager.getEntries(); } catch { return false; }   // never throw
        if (!Array.isArray(entries)) return false;
        for (const e of entries) {
          if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
          try {
            const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
            if (ee.type === "label" && ee.label === needle && typeof ee.targetId === "string" && ee.targetId.length > 0) {
              candidates.add(ee.targetId);          // DISCOVERY phase
            }
          } catch { /* skip throwing-Proxy entry */ }
        }
        if (candidates.size === 0) return false;
        let cleared = false;
        for (const id of candidates) {
          try {
            if (ctx.sessionManager.getLabel(id) === needle) {     // CONFIRM phase (latest-wins)
              pi.setLabel(id, undefined);                          // CLEAR
              cleared = true;
            }
          } catch { /* treat as inactive — never throw */ }
        }
        return cleared;
  - FOLLOW pattern: src/tools/rewind.ts checkpointExists (line 329) — same defensive two-phase shape.
  - GOTCHA #2 (two-phase is mandatory), GOTCHA #3 (ctx: ExtensionContext — the minimal interface).
  - NAMING: clearCheckpointByName (camelCase, exported). Exported so P2.M3.T1.S2 banner/tests can reuse conceptually.

Task 3: CREATE src/commands.ts — the private notify helper (reduces hasUI-guard repetition)
  - IMPLEMENT: function notify(ctx: ExtensionCommandContext, msg: string, type: "info" | "warning" | "error"): void {
                  if (ctx.hasUI) ctx.ui.notify(msg, type);
                }
  - WHY: every handler notify is guarded by ctx.hasUI (GOTCHA #5). The helper centralizes the guard.
  - NAMING: notify (module-private, NOT exported). type param matches ctx.ui.notify's signature.

Task 4: CREATE src/commands.ts — makeCheckpointCommand(pi) (the SET factory)
  - IMPLEMENT: export function makeCheckpointCommand(pi: ExtensionAPI): { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
      return {
        description: "Set a Mulligan checkpoint — the agent may rewind across your subsequent prompts back to this point",
        handler: async (args, ctx) => { ... }
      };
  - HANDLER BODY (whole thing in try/catch → notify(ctx, "Mulligan: unexpected error: " + msg, "warning"); never throws):
      const name = (args ?? "").trim();
      if (!getConfig().enabled) { notify(ctx, "Mulligan is disabled", "warning"); return; }   // GOTCHA #4(d)
      if (!validCheckpointName(name)) {
        notify(ctx, `Mulligan: invalid checkpoint name '${name}' (lowercase, digits, hyphen, underscore; max 40)`, "warning");
        return;                                                                              // GOTCHA #4(a) — SPEC §2 step 1 verbatim
      }
      const res = setCheckpoint(pi, ctx, name);
      if ("entryId" in res) {                                                                 // GOTCHA #9 — discriminated union
        notify(ctx,
          `Mulligan: checkpoint '${name}' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with /mulligan_checkpoint_revoke ${name}.`,
          "warning");                                                                          // GOTCHA #4(b) — SPEC §2 step 5 verbatim (parenthetical INCLUDED)
        reconcileBanner(ctx);                                                                  // GOTCHA #7 — only on success
      } else { // "error" in res
        notify(ctx, `Mulligan: could not set checkpoint: ${res.error}`, "warning");
      }
  - JSDOC: [Mode A] cite spec/13 §2; note pi captured via closure (the testable seam — handler receives ctx as 2nd arg).
  - NAMING: makeCheckpointCommand (camelCase, exported). Matches the makeRewindTool/makeCheckpointTool factory idiom.

Task 5: CREATE src/commands.ts — makeCheckpointRevokeCommand(pi) (the REVOKE factory)
  - IMPLEMENT: export function makeCheckpointRevokeCommand(pi: ExtensionAPI): { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
      return {
        description: "Revoke a Mulligan checkpoint",
        handler: async (args, ctx) => { ... }
      };
  - HANDLER BODY (try/catch → unexpected-error notify; never throws):
      const name = (args ?? "").trim();
      if (!getConfig().enabled) { notify(ctx, "Mulligan is disabled", "warning"); return; }
      const cleared = clearCheckpointByName(pi, ctx, name);
      if (!cleared) {
        notify(ctx, `Mulligan: no active checkpoint named '${name}'.`, "info");   // GOTCHA #4(c) — SPEC §3 step 2 (closing apostrophe)
      } else {
        reconcileBanner(ctx);                                                       // GOTCHA #7 — only when something changed
        notify(ctx, `Mulligan: checkpoint '${name}' revoked. The agent can no longer rewind across your prompts to it.`, "info");
      }                                                                             // (revoked message matches contract + spec §3 step 5)
  - JSDOC: [Mode A] cite spec/13 §3.
  - NAMING: makeCheckpointRevokeCommand (camelCase, exported).
  - DEPENDENCIES: clearCheckpointByName (Task 2), reconcileBanner (Task 1), getConfig, notify (Task 3).

Task 6: VALIDATE — typecheck + full suite + scope guard
  - RUN: `npm run typecheck` → exit 0 (the primary gate; proves imports resolve + handler signatures + narrowing).
  - RUN: `npm test` → full suite GREEN (new files import nothing existing tests depend on; nothing imports commands.ts yet).
  - RUN: `git status --short` → only `?? src/commands.ts` + `?? src/banner.ts` (no edits to existing files).
  - OPTIONAL bridge (proves S2 registration will typecheck): in a scratch line (DO NOT commit) or mentally confirm the
        factory output is assignable to Parameters<ExtensionAPI["registerCommand"]>[1]. S2's pi.registerCommand(name,
        makeCheckpointCommand(pi)) is the real proof.
```

### Implementation Patterns & Key Details

```ts
// PATTERN (factory closure — the testable seam, mirrors makeCheckpointTool in checkpoint.ts:182):
//   pi is captured by the factory closure; ctx is passed to the handler at CALL time (2nd arg). This lets tests do
//   `const cmd = makeCheckpointCommand(fakePi); await cmd.handler("name", fakeCtx);` WITHOUT a real Pi.
export function makeCheckpointCommand(pi: ExtensionAPI) {
  return {
    description: "Set a Mulligan checkpoint — the agent may rewind across your subsequent prompts back to this point",
    handler: async (args: string, ctx: ExtensionCommandContext) => { /* uses pi (closure) + args + ctx */ },
  };
}

// PATTERN (two-phase label discovery+clear — MIRROR rewind.ts:329 checkpointExists; GOTCHA #2):
export function clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean {
  const needle = `mulligan:checkpoint:${name}`;
  const candidates = new Set<string>();
  let entries: unknown;
  try { entries = ctx.sessionManager.getEntries(); } catch { return false; }   // never throw
  if (!Array.isArray(entries)) return false;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
      if (ee.type === "label" && ee.label === needle && typeof ee.targetId === "string" && ee.targetId.length > 0) {
        candidates.add(ee.targetId);          // DISCOVER
      }
    } catch { /* skip */ }
  }
  if (candidates.size === 0) return false;
  let cleared = false;
  for (const id of candidates) {
    try {
      if (ctx.sessionManager.getLabel(id) === needle) {     // CONFIRM (latest-wins)
        pi.setLabel(id, undefined);                          // CLEAR
        cleared = true;
      }
    } catch { /* inactive */ }
  }
  return cleared;
}

// PATTERN (notify helper — centralizes the ctx.hasUI guard; GOTCHA #5):
function notify(ctx: ExtensionCommandContext, msg: string, type: "info" | "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(msg, type);
}

// CRITICAL (discriminated-union narrowing — GOTCHA #9): setCheckpoint returns {entryId}|{error}.
//   Narrow with `"entryId" in res` / `"error" in res` (the idiom checkpoint.ts uses). On the error branch res.error is a string.

// CRITICAL (reconcileBanner after SUCCESSFUL mutation only — GOTCHA #7): SET calls it on the {entryId} branch;
//   REVOKE calls it when cleared===true. NOT on the no-op paths ({error} / not-found).

// CRITICAL (notify messages — GOTCHA #4): SPEC §2/§3 verbatim. The set fair-warning INCLUDES the parenthetical
//   "(your prompts after here can be hidden)". The not-found message has a CLOSING apostrophe on <name>.
```

### Integration Points

```yaml
CODE (src/commands.ts — NEW, 3 exports + 1 private helper):
  - makeCheckpointCommand(pi)           → { description, handler } consumed by P2.M1.T1.S2 index.ts registration
  - makeCheckpointRevokeCommand(pi)     → { description, handler } consumed by P2.M1.T1.S2 index.ts registration
  - clearCheckpointByName(pi, ctx, name)→ boolean; reused conceptually by P2.M3.T1.S2 banner + S3 tests
  - notify(ctx, msg, type) [private]    → hasUI-guarded ctx.ui.notify wrapper

CODE (src/banner.ts — NEW STUB):
  - reconcileBanner(ctx)                → no-op; P2.M3.T1.S2 replaces with real impl (spec/13 §5)
                                           (P2.M3.T1.S3 hooks reconcileBanner into contextHandler tail + session_start)

DATABASE: none
CONFIG: none in S1 (commands.ts reads getConfig().enabled — already exists; the ui.activeCheckpointBanner knob is P2.M3.T1.S1)
ROUTES: none (S2 registers the commands in index.ts: pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi)) +
        pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi)))

DOCS: [Mode A] JSDoc on makeCheckpointCommand cites spec/13 §2; on makeCheckpointRevokeCommand cites spec/13 §3; on
      clearCheckpointByName cites the two-phase discovery (rewind.ts:329); on reconcileBanner (stub) cites spec/13 §5 +
      P2.M3.T1.S2. Docs RIDE WITH the code (Mode A — no separate doc file).

PARALLEL-SIBLING COORDINATION: P1.M3.T1.S2 (running in parallel) edits test/index.test.ts ONLY — ZERO overlap with S1's
        src/commands.ts + src/banner.ts. P1.M3.T1.S1 (landed by contract) already removed makeCheckpointTool registration
        from index.ts (5→4 agent tools) but RETAINED src/tools/checkpoint.ts (so validCheckpointName is importable).
        S1 does NOT depend on any parallel sibling's output landing — it only needs the RETAINED checkpoint.ts (already
        present) + markers.ts/config.ts (unchanged). typecheck passes standalone.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# This project has NO ruff/mypy (it's TypeScript). The style gate IS tsc --noEmit (strict + noImplicitAny).
# The house style: 2-space indent, double quotes, `.js` import extensions, JSDoc on exports. Match checkpoint.ts/index.ts.
npm run typecheck        # = tsc --noEmit (strict; tsconfig includes src + test)
echo "typecheck exit: $?"
# EXPECT: exit 0, NO output. Proves: imports resolve (./ paths, .js extensions); handler signatures match the Pi
#   registerCommand contract ((args, ctx: ExtensionCommandContext) => Promise<void>); discriminated-union narrowing is
#   correct ("entryId" in res / "error" in res); clearCheckpointByName's defensive casts typecheck; the banner stub's
#   unused _ctx param doesn't error (no noUnusedParameters).
# If tsc errors, READ the output: a wrong import path (../  vs ./), a missing .js extension, a ctx-type mismatch
#   (ExtensionCommandContext vs ExtensionContext), or a bad narrowing are the likely causes. Fix before proceeding.
```
Expected: exit 0, no output.

### Level 2: Unit Tests (the full suite must stay GREEN — S1 adds no test of its own)

```bash
# S1 creates new files that NOTHING imports yet (S2 will register them; S3 will test them). So the existing suite is
# unaffected — it must stay GREEN. If a test breaks, you accidentally edited an existing file (revert it).
npm test                  # = vitest run (full suite)
echo "test exit: $?"
# EXPECT: full suite GREEN. No new test in S1 (that's P2.M1.T1.S3). The new src/commands.ts + src/banner.ts are not
#   imported by any test, so vitest doesn't even load them — they're verified only by typecheck (Level 1).
# If you WANT a quick runtime sanity check before S3, you may (optionally, DO NOT commit) write a throwaway script that
# imports makeCheckpointCommand, calls it with a fake pi/ctx, and asserts setLabel was called — then delete it. The
# authoritative behavioral tests are P2.M1.T1.S3.
```
Expected: full suite green (unchanged from before S1).

### Level 3: Integration Testing (deferred to S2/S3 — NOT in S1's scope)

```bash
# S1 produces NO runtime wiring (the commands aren't registered until S2) and NO tests (S3). So there is no Level-3
# integration to run in S1. The chain is:
#   S1 (this) → S2 (index.ts: pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi)) + revoke) →
#   S3 (tests: makeCheckpointCommand(fakePi) → handler(args, fakeCtx) → assert setLabel/notify/clearCheckpointByName).
# The S2 registration IS the integration proof that the factory output typechecks against registerCommand's param type.
# Do NOT attempt to register the commands yourself in S1 — that's S2's scope (scope-discipline gate below catches it).
```
Expected: N/A in S1 (S2/S3 own integration).

### Level 4: Creative & Domain-Specific Validation

```bash
# (a) Scope-discipline gate — ONLY src/commands.ts + src/banner.ts were added:
git status --short
# EXPECT: exactly two untracked entries:
#   ?? src/banner.ts
#   ?? src/commands.ts
# If ANY tracked file appears modified (src/index.ts, src/tools/checkpoint.ts, src/markers.ts, src/config.ts,
#   src/tools/rewind.ts, any test/*), you went out of scope — revert it (`git checkout -- <file>`).

# (b) Export-shape gate — the 3 commands.ts exports + the banner export exist:
grep -nE '^export (function|const) (makeCheckpointCommand|makeCheckpointRevokeCommand|clearCheckpointByName)' src/commands.ts
# EXPECT: 3 hits (makeCheckpointCommand, makeCheckpointRevokeCommand, clearCheckpointByName).
grep -nE '^export function reconcileBanner' src/banner.ts
# EXPECT: 1 hit (reconcileBanner).

# (c) notify-message verbatim gate (spec §2/§3 — GOTCHA #4). Confirm the load-bearing wording is present:
grep -c "your prompts after here can be hidden" src/commands.ts   # EXPECT: 1 (the set fair-warning parenthetical — GOTCHA #4b)
grep -c "no active checkpoint named '" src/commands.ts            # EXPECT: 1 (not-found — the closing apostrophe is on <name>)
grep -c "invalid checkpoint name '" src/commands.ts               # EXPECT: 1 (invalid-name — spec §2 step 1 wording)

# (d) Import-path gate (GOTCHA #1 — `./` not `../`):
grep -nE 'from "\.\./' src/commands.ts src/banner.ts   # EXPECT: 0 hits (no `../` imports — commands.ts is in src/).
grep -nE 'from "\./(markers|config|tools/checkpoint|banner)\.js"' src/commands.ts   # EXPECT: 4 hits.

# (e) Two-phase discovery gate (GOTCHA #2 — clearCheckpointByName confirms via getLabel before clearing):
grep -c "getLabel(id) === needle" src/commands.ts   # EXPECT: 1 (the CONFIRM phase — NOT a naive single-phase scan).
```
Expected: (a) two untracked files only; (b) 3 + 1 export hits; (c) 1/1/1; (d) 0 `../` + 4 `./`; (e) 1 confirm hit.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck` → exit 0 (strict + noImplicitAny; the primary gate).
- [ ] Level 2: `npm test` → full suite GREEN (S1 adds no test; existing suite unaffected).
- [ ] Level 4a: `git status --short` → ONLY `?? src/banner.ts` + `?? src/commands.ts` (no tracked-file edits).
- [ ] Level 4b: 3 commands.ts exports + 1 banner export present (grep gate).
- [ ] Level 4c: spec §2/§3 verbatim notify messages present (the parenthetical + closing apostrophe).
- [ ] Level 4d: zero `../` imports; 4 `./` imports in commands.ts.
- [ ] Level 4e: clearCheckpointByName has the `getLabel(id) === needle` confirm phase.

### Feature Validation
- [ ] `makeCheckpointCommand(pi)` returns `{ description, handler }`; description is the verbatim contract string; handler
      is `(args, ctx) => Promise<void>`.
- [ ] SET handler: disabled-gate → name-validation gate → setCheckpoint → on `{entryId}` (fair-warning notify + reconcileBanner)
      / on `{error}` (could-not-set notify). All notify guarded by ctx.hasUI; whole body try/catch → unexpected-error notify.
- [ ] `makeCheckpointRevokeCommand(pi)` returns `{ description:"Revoke a Mulligan checkpoint", handler }`.
- [ ] REVOKE handler: disabled-gate → clearCheckpointByName → on !cleared (not-found notify) / on cleared (reconcileBanner +
      revoked notify). All notify guarded; whole body try/catch.
- [ ] `clearCheckpointByName(pi, ctx, name)` two-phase: discover candidates from raw label entries, confirm via
      `getLabel(id)===needle`, clear confirmed via `pi.setLabel(id, undefined)`, return boolean. Never throws.
- [ ] `reconcileBanner(ctx)` is a typed no-op stub (P2.M3.T1.S2 fills it in).

### Code Quality / Scope Discipline
- [ ] Added ONLY `src/commands.ts` + `src/banner.ts` (`git status --short` shows nothing else).
- [ ] Did NOT edit `src/index.ts` (S2's scope — registers the commands).
- [ ] Did NOT edit `src/tools/checkpoint.ts` (RETAINED — validCheckpointName imported, not modified).
- [ ] Did NOT edit `src/markers.ts`, `src/config.ts`, `src/tools/rewind.ts` (READ-ONLY reused inputs).
- [ ] Did NOT write any test (S3's scope).
- [ ] Did NOT implement the real banner (P2.M3.T1.S2 — S1 creates only the stub).
- [ ] Did NOT reference `config.ui.activeCheckpointBanner` (P2.M3.T1.S1's knob — doesn't exist yet).
- [ ] Import paths use `./` (not the contract's `../`) + `.js` extensions (house convention).
- [ ] Followed existing conventions: factory closure idiom (mirrors makeCheckpointTool), hand-rolled defensive code
      (mirrors checkpointExists), JSDoc [Mode A] on every export, 2-space indent / double quotes.

### Documentation
- [ ] JSDoc on `makeCheckpointCommand` cites spec/13 §2 (set behavior).
- [ ] JSDoc on `makeCheckpointRevokeCommand` cites spec/13 §3 (revoke behavior).
- [ ] JSDoc on `clearCheckpointByName` cites the two-phase discovery (mirrors rewind.ts:329 checkpointExists).
- [ ] JSDoc on `reconcileBanner` (stub) cites spec/13 §5 + P2.M3.T1.S2 (the stub contract).
- [ ] No separate doc file (Mode A — docs ride with the code).

---

## Anti-Patterns to Avoid

- ❌ Don't use the contract's `../` import paths — they're WRONG for `src/commands.ts`. Use `./` (confirmed via index.ts).
  (GOTCHA #1.)
- ❌ Don't write `clearCheckpointByName` as a naive single-phase string scan of `getEntries()`. Pi's label map is
  append-only; a revoked checkpoint's HISTORICAL set entry persists in the raw stream. You MUST confirm each candidate
  via `getLabel(id)===needle` (latest-wins) before clearing. Mirror `checkpointExists` (rewind.ts:329). (GOTCHA #2.)
- ❌ Don't type `clearCheckpointByName`'s ctx as `ExtensionCommandContext`. Use `ExtensionContext` (the minimal interface)
  for reusability + to match the sibling `checkpointExists`. (GOTCHA #3.) The FACTORIES' handler ctx MUST be
  `ExtensionCommandContext` (the exact Pi contract).
- ❌ Don't use the contract's inline notify strings where they deviate from spec §2/§3. SPEC WINS: (a) invalid-name uses
  the spec's "(lowercase, digits, hyphen, underscore; max 40)" wording; (b) set fair-warning INCLUDES "(your prompts
  after here can be hidden)"; (c) not-found has a CLOSING apostrophe on `<name>`. (GOTCHA #4.) The disabled message
  ("Mulligan is disabled", no prefix) IS kept verbatim per the contract.
- ❌ Don't call `ctx.ui.notify` without an `if (ctx.hasUI)` guard, and don't let the handler throw. Wrap the whole body
  in try/catch → unexpected-error notify. (GOTCHA #5.) A private `notify(ctx, msg, type)` helper centralizes the guard.
- ❌ Don't call `reconcileBanner(ctx)` on every path. SET calls it only on `{entryId}` success; REVOKE calls it only when
  `cleared===true`. NOT on the no-op paths (`{error}` / not-found). (GOTCHA #7.)
- ❌ Don't register the commands in `index.ts` — that's P2.M1.T1.S2. S1 = factories + stub ONLY. (Scope gate.)
- ❌ Don't write tests — that's P2.M1.T1.S3. S1's validation is typecheck + full-suite-stays-green + scope-discipline.
- ❌ Don't implement the real banner in `src/banner.ts` — that's P2.M3.T1.S2. S1 creates a typed no-op stub so the import
  resolves. (GOTCHA + scope gate.)
- ❌ Don't edit `src/tools/checkpoint.ts` to export `NAME_RE`. Import `validCheckpointName` only (it's already exported at
  line 74). checkpoint.ts is RETAINED (Phase 2 reuse). (Reference: change_surface.md §checkpoint.ts lifecycle.)
- ❌ Don't reference `config.ui.activeCheckpointBanner` — that knob doesn't exist yet (P2.M3.T1.S1 adds it). commands.ts
  calls `reconcileBanner(ctx)` unconditionally.
- ❌ Don't narrow `setCheckpoint`'s result with `res.entryId`/`res.error` without a discriminant. Use `"entryId" in res` /
  `"error" in res` (strict mode rejects property access on the union without narrowing). (GOTCHA #9.)

---

## Confidence Score

**9/10** for one-pass implementation success. This is a two-file add (one ~80-line commands.ts with 3 exports + 1 private
helper, one ~10-line banner stub) that reuses 3 existing, line-pinned, never-throwing helpers (`setCheckpoint`,
`validCheckpointName`, `getConfig`) and mirrors one existing line-pinned two-phase loop (`checkpointExists` in rewind.ts:329).
The PRP provides: the verbatim import statements with the CORRECTED `./` paths (the contract's `../` is a flagged error);
the exact `clearCheckpointByName` body (the mirrored two-phase loop, fully written out); the exact handler bodies with the
spec-§2/§3-verbatim notify messages (all 3 contract deviations resolved — spec wins, with the load-bearing parenthetical
preserved and the missing closing apostrophe restored); the `registerCommand`/`ExtensionCommandContext` Pi contract
(verified in external_deps.md); the ctx-typing decision (`ExtensionContext` for the helper, `ExtensionCommandContext` for
the handler — both justified); the banner-stub decision; the strict scope boundary (S1 factories+stub; S2 registers; S3
tests); and deterministic grep + typecheck + scope-discipline gates. The residual risks — all flagged — are (1) the
notify-message deviations: mitigated by GOTCHA #4's exact resolution table (spec §2/§3 verbatim, with the specific strings
to use); (2) the import-path error in the contract: mitigated by GOTCHA #1 (corrected to `./`, confirmed via index.ts);
(3) the two-phase discovery being done wrong (naive single-phase scan): mitigated by GOTCHA #2 + the fully-written-out
`clearCheckpointByName` body that copies the rewind.ts:329 shape; and (4) over-scoping into index.ts/tests: mitigated by
the repeated scope gates + `git status --short` check. The factories are internally type-safe (strict mode), depend on no
parallel sibling's output landing (only the RETAINED checkpoint.ts + unchanged markers.ts/config.ts), and the full test
suite provably stays green (nothing imports the new files yet). No dependency on P1.M3.T1.S2's parallel work — S1
typechecks standalone.