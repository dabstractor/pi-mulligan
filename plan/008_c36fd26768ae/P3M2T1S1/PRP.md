# PRP — P3.M2.T1.S1: /mulligan_checkpoint step 4b (checkpoint working-tree snapshot capture)

**Spec refs**: spec/13-human-commands.md §2 (the `/mulligan_checkpoint` set command — step 4b "Working-tree
snapshot (v1.2 — `@14` §5): if `config.revert.enabled`, capture a whole-working-tree snapshot tagged with
the checkpoint name, so a later `mulligan_rewind(granularity:"checkpoint", revert_file_changes:true)` can
restore files to this point. Best-effort; a capture failure is logged and never blocks checkpoint creation."),
spec/14-working-tree-revert.md §5 (capture lifecycle — "/mulligan_checkpoint → capture('ckpt:<name>') → a
before ref persisted in a `mulligan:revert-checkpoint` control entry alongside the label, so it survives
reload"; "Checkpoints are exempt (separate namespace)"). architecture/codebase_patterns.md §5 (command
factory pattern: step 4b goes AFTER `setCheckpoint` success, BEFORE `reconcileBanner` — best-effort capture,
failures logged only). DOCS (Mode A): JSDoc on the new step cites `@spec/13 §2` + `@14 §5` — rides WITH the work.

---

## Goal

**Feature Goal**: When the user runs `/mulligan_checkpoint <name>` AND `config.revert.enabled` is on, capture a
whole-working-tree snapshot tagged with the checkpoint name and (a) store it in `SessionRuntime.snapshots`
keyed by `"ckpt:" + name` so a same-session `mulligan_rewind(granularity:"checkpoint", revert_file_changes:true)`
can resolve it, and (b) persist a `mulligan:revert-checkpoint` control entry so a RELOADED session can rebuild
the snapshots Map. The capture is STRICTLY best-effort — it lives inside its own try/catch and a capture
failure / no-store / `none` backend NEVER blocks checkpoint creation (the label was already set by `setCheckpoint`),
NEVER skips the fair-warning notify, and NEVER skips the banner refresh. This is the CHECKPOINT-CAPTURE half of
the v1.2 working-tree-revert feature; the turn-capture hooks (P3.M1.T1) and the rewind restore (P4.M2.T1) are
sibling tasks.

**Deliverable**:
1. EDIT `src/commands.ts` — inside `makeCheckpointCommand`'s handler, within the `if ("entryId" in res) {` body
   and BEFORE `reconcileBanner(ctx)`, INSERT the step-4b capture block (gated on `getConfig().revert.enabled`,
   self try/catch, sets `rt.snapshots` + appends the `mulligan:revert-checkpoint` control entry). Read `sessionId`
   via `ctx.sessionManager.getSessionId()` (the file's own `makeAuditCommand` pattern). NO new imports needed.
2. EDIT `test/commands.test.ts` — ADD a describe block exercising step 4b: capture + snapshots.set +
   appendEntry on the happy path; gated-skip when `revert.enabled === false`; graceful skip on `none` backend
   (NoOpStore, capture→null); best-effort swallow when `store.capture` rejects; checkpoint + notify + banner
   ALWAYS still fire (step 4b never blocks); `hasUI=false` still captures.

**Success Definition**: After a successful `/mulligan_checkpoint <name>` with `revert.enabled` on and a real
(git/cas) store: `getRuntime(sid).snapshots.get("ckpt:" + name)` is a `RevertCheckpoint` whose `beforeRef`
is the store's capture return, `backend` is the store's describe().backend, `turnIndex === -1`, and a
`mulligan:revert-checkpoint` control entry was appended. The fair-warning notify + `reconcileBanner` STILL
fire (step 4b did not block them). When `revert.enabled` is off (the default), OR the store is absent/`none`,
OR `capture` returns null, OR `capture` throws: NO snapshots.set, NO appendEntry, but the checkpoint label +
notify + banner ALL proceed exactly as before. `npx tsc --noEmit` clean; `npx vitest run test/commands.test.ts`
green; full `npx vitest run` green.

## User Persona

**Target User**: Implementer agent (this PRP's consumer). The end user invokes `/mulligan_checkpoint`; this
task is the capture machinery behind step 4b of that command.

**Use Case**: A user opts into `config.revert.enabled` (with `revert.storageDir` set). They run
`/mulligan_checkpoint before-refactor` to tag the current working-tree state. Behind the label mutation, the
extension captures a whole-working-tree snapshot (git shadow repo commit / CAS manifest) tagged `ckpt:before-refactor`
and remembers it in `rt.snapshots`. Later, when the agent (or user) rewinds with
`mulligan_rewind(granularity:"checkpoint", checkpoint:"before-refactor", revert_file_changes:true)`, the rewind
tool resolves that snapshot from `rt.snapshots` and restores files to this point — even after the agent has
written/edited files across several prompts since the checkpoint was set.

**Pain Points Addressed**: (1) Without step 4b, a `granularity:"checkpoint"` rewind has NO working-tree state
to restore to — the label points at a conversation position but the files have drifted, so `revert_file_changes`
would be a no-op (degrade to skipped). (2) The user has no way to tag a file-revert anchor that survives across
their subsequent prompts (only checkpoints can be the target of a cross-prompt file revert — turn snapshots are
GC'd at each prompt boundary). (3) Capture must be invisible to the user — a snapshot failure must never turn
`/mulligan_checkpoint` into a broken experience.

## Why

- **The checkpoint snapshot is the cross-prompt revert anchor (PRD §5)**: "checkpoint snapshots live under
  `refs/mulligan/snapshots/checkpoint/<name>` and are NOT touched by prompt-boundary GC … held until the
  checkpoint is revoked or consumed." A `granularity:"checkpoint"` rewind (P4.M2.T1.S1) can ONLY restore files
  if this task captured a before-ref tagged with the name. The label mutation (`setCheckpoint`) anchors the
  CONVERSATION position; step 4b anchors the WORKING-TREE position — both are required for a complete
  cross-prompt file revert.
- **Best-effort is load-bearing (PRD §2 step 4b + E27)**: "a capture failure is logged and never blocks
  checkpoint creation." The label was already set by `setCheckpoint` BEFORE step 4b runs; a capture failure
  must never undo that, never skip the fair-warning notify, never skip the banner refresh. This task wraps step
  4b in its own try/catch so the rest of the handler is structurally untouched.
- **Cross-reload persistence (PRD §5, E32)**: "checkpoint refs are persisted (`mulligan:revert-checkpoint`
  control entries … so reload re-reads the refs)." This task APPENDS that control entry — the write side of E32.
  (See SCOPE BOUNDARY below for the read side.)
- **Scope guard**: this task implements the CHECKPOINT CAPTURE only — it does NOT implement the turn_start /
  agent_end hooks (P3.M1.T1 — Complete), the store lifecycle (P3.M1.T2.S1 — in flight, parallel), the rewind
  restore step 6b (P4.M2.T1 — Planned), nor the session_start reload re-read of `mulligan:revert-checkpoint`
  (a cross-task dependency — see Known Gotchas). It touches ONLY `src/commands.ts` + `test/commands.test.ts`.

## What

### `makeCheckpointCommand` handler — step 4b (EDIT src/commands.ts)
Inside the existing `if ("entryId" in res) {` body, BEFORE `reconcileBanner(ctx)` (and the surrounding notify),
APPEND a gated best-effort block. The block:
- reads `sessionId` via `ctx.sessionManager.getSessionId()` (mirrors `makeAuditCommand` in the same file);
- gates on `getConfig().revert.enabled` FIRST (layer-1 opt-in — default `false` → the whole block is skipped);
- gets `rt = getRuntime(sessionId)` and guards `if (rt.store)` (store is `undefined` until P3.M1.T2.S1 wires
  `detectAndCreate` at session_start — graceful skip when absent);
- reads `const backend = rt.store.describe().backend` and skips the capture when `backend === "none"` (NoOpStore
  — `capture` returns `null` anyway, but the early guard keeps it clean + type-narrows `backend`);
- `const ckptRef = await rt.store.capture("ckpt:" + name)`;
- on a non-null ref: `rt.snapshots?.set("ckpt:" + name, { label:"ckpt:"+name, backend, beforeRef:ckptRef, turnIndex:-1, ts:Date.now() })`
  AND `pi.appendEntry("mulligan:revert-checkpoint", { label:"ckpt:"+name, ref:ckptRef, backend })`;
- the WHOLE block is wrapped in `try { … } catch { /* best-effort — never blocks checkpoint creation */ }`.

**CRITICAL control-flow rule**: NO `return` / `throw` inside step 4b. The block lives inside
`if ("entryId" in res) { … notify … ; reconcileBanner(ctx) }`; a bare `return` would skip the notify and the
banner refresh. Use nested `if` guards (`if (rt.store)`, `if (backend !== "none")`, `if (ckptRef)`) instead of
early returns. The block's own `catch` swallows everything, so control always falls through to the notify +
`reconcileBanner`.

### Success Criteria
- [ ] A successful `/mulligan_checkpoint <name>` with `revert.enabled === true` and a git/cas store captures
      `store.capture("ckpt:" + name)`, sets `getRuntime(sid).snapshots.get("ckpt:" + name)` to a `RevertCheckpoint`
      `{ label:"ckpt:"+name, backend:<git|cas>, beforeRef:<ref>, turnIndex:-1, ts:<now> }`, and appends a
      `mulligan:revert-checkpoint` control entry `{ label, ref, backend }`.
- [ ] The fair-warning notify + `reconcileBanner(ctx)` STILL fire on the happy path (step 4b does not block them).
- [ ] When `revert.enabled === false` (the default): step 4b is skipped entirely (NO `store.capture`, NO
      `snapshots.set`, NO `appendEntry`) — the command behaves EXACTLY as before (label set + notify + banner).
- [ ] When `rt.store` is `undefined` (store not wired / config off at session_start): step 4b is a clean no-op
      (graceful skip); checkpoint + notify + banner still fire.
- [ ] When `store.describe().backend === "none"` (NoOpStore): step 4b skips the capture (no `snapshots.set`,
      no `appendEntry`); checkpoint + notify + banner still fire.
- [ ] When `store.capture` returns `null` (caps exceeded / IO error): step 4b skips `snapshots.set` + `appendEntry`;
      checkpoint + notify + banner still fire.
- [ ] When `store.capture` REJECTS (or any line in step 4b throws): the step-4b `catch` swallows it; checkpoint +
      notify + banner still fire (the checkpoint is NOT broken — best-effort, E27).
- [ ] `turnIndex` is `-1` (the sentinel for "checkpoint, not turn-bound").
- [ ] The capture label + Map key are BOTH `"ckpt:" + name` (the namespace verified across git.ts `refForLabel`,
      cas.ts mark-sweep exemption, and capture.ts `gcTurnSnapshots` — see Known Gotchas).
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/commands.test.ts` green; full `npx vitest run` green.
- [ ] NO edits to `src/index.ts` (session_start is owned by the parallel P3.M1.T2.S1), NO edits to capture.ts /
      runtime.ts / markers.ts / store.ts / config.ts / snapshot/*.ts.

## All Needed Context

### Context Completeness Check
✅ "If someone knew nothing about this codebase, would they have everything needed?" — YES. The exact edit point
(`makeCheckpointCommand` handler, inside `if ("entryId" in res)`, before `reconcileBanner`), the sessionId
extraction pattern (same file's `makeAuditCommand`), the backend-narrowing pattern (capture.ts
`turnStartCaptureHandler`), the namespace decision (`"ckpt:" + name`, verified across git/cas/capture), the
RevertCheckpoint type (markers.ts), the test idiom (test/commands.test.ts `makePi` with `appendEntry` spy +
`makeCtx` with `getSessionId`→"s1"), and the control-flow rule (no return inside the if-body) are all cited
below with exact paths + line anchors.

### Documentation & References

```yaml
# MUST READ — the authoritative spec for this task
- file: spec/13-human-commands.md
  why: §2 (`/mulligan_checkpoint <name>` set — step 4b is THIS task: "Working-tree snapshot (v1.2 — @14 §5): if
       config.revert.enabled, capture a whole-working-tree snapshot tagged with the checkpoint name, so a later
       mulligan_rewind(granularity:"checkpoint", revert_file_changes:true) can restore files to this point.
       Best-effort; a capture failure is logged and never blocks checkpoint creation."). Step 4b goes AFTER
       setCheckpoint success (step 4), BEFORE the fair-warning notify (step 5) + banner (step 6).
  critical: "a capture failure is logged and never blocks checkpoint creation" → the block needs its OWN
       try/catch and must NOT return early inside the if-body (the notify + reconcileBanner must still run).

- file: spec/14-working-tree-revert.md
  why: §5 (capture lifecycle — "/mulligan_checkpoint → capture('ckpt:<name>') → a before ref persisted in a
       mulligan:revert-checkpoint control entry alongside the label, so it survives reload"; "Checkpoints are
       exempt (separate namespace) — held until the checkpoint is revoked or consumed"), §2 (the SnapshotStore
       capture/describe contract).
  critical: the capture label namespace is "ckpt:<name>" (NOT "checkpoint:<name>"). §5 "control entry … so it
       survives reload" → this task appends it (the write side); the read side is a cross-task dependency.

# THE FILE TO EDIT — commands.ts (makeCheckpointCommand is the edit point)
- file: src/commands.ts
  why: `makeCheckpointCommand(pi)` (~line 180) returns `{ description, handler }`. The handler: parse name →
       getConfig().enabled gate → validCheckpointName gate → setCheckpoint(pi,ctx,name) → `if ("entryId" in res)
       { notify(fair-warning) ; reconcileBanner(ctx) } else { notify("could not set checkpoint: …") }`, whole
       body in try/catch. STEP 4b goes INSIDE `if ("entryId" in res) {`, BEFORE `reconcileBanner(ctx)`.
  pattern: sessionId extraction — `makeAuditCommand` (~line 290) ALREADY does `const sessionId =
       ctx.sessionManager.getSessionId();` + `const rt = getRuntime(sessionId);`. Copy that one-liner. getRuntime
       + getConfig are ALREADY imported in commands.ts (no new imports). `pi` is the factory-closure arg →
       `pi.appendEntry` is available.
  gotcha: NO `return` inside step 4b (it would skip notify + reconcileBanner). NO `throw` (the step-4b catch
       swallows). Use nested `if` guards. The OUTER handler try/catch is a backstop, but step 4b has its OWN
       try/catch so a capture failure never reaches the "unexpected error" notify.

# THE BACKEND-NARROWING PATTERN — capture.ts turnStartCaptureHandler (MIRROR, do not copy the return)
- file: src/capture.ts
  why: turnStartCaptureHandler (~line 80) shows the EXACT pattern for capture + snapshots.set with a type-safe
       backend: `const backend = rt.store.describe().backend; if (backend === "none") return; const beforeRef =
       await rt.store.capture("turn"); if (beforeRef) { rt.snapshots?.set("turn", {label:"turn", backend,
       beforeRef, turnIndex:event.turnIndex, ts:Date.now()}); }`. The `backend` const is narrowed to "git"|"cas"
       by the !=="none" check and STAYS narrowed across the await (const can't be reassigned).
  pattern: ADAPT for step 4b — replace the `if (backend === "none") return;` with `if (backend !== "none") { … }`
       (NO return — we are mid-if-body). Use `"ckpt:" + name` as label + key + capture arg. turnIndex is `-1`
       (no event.turnIndex for a command). Add the `pi.appendEntry("mulligan:revert-checkpoint", …)` AFTER the
       snapshots.set (inside the `if (ckptRef)` block).
  gotcha: capture.ts uses `return` for the none-guard because it is a TOP-LEVEL event handler; step 4b CANNOT
       (it is nested inside the entryId-if). The nested-if adaptation is mandatory.

# THE TYPE — RevertCheckpoint (markers.ts)
- file: src/markers.ts
  why: `RevertCheckpoint` (~the revert-checkpoint type block) is `{ label: string; backend: "git"|"cas";
       beforeRef: string; afterRef?: string; turnIndex: number; ts: number }`. step 4b builds this object literal.
       `backend` MUST be narrowed to "git"|"cas" (the `!== "none"` guard). `afterRef` is NOT set for checkpoints
       (a checkpoint only has a before-ref; the rewind resolves it by label, not by an after-ref pair).
       `turnIndex: -1` is a valid number (the "checkpoint, not turn-bound" sentinel).
  gotcha: do NOT set `afterRef` — checkpoints are single-snapshot (before-only). The turn pair (before+after)
       is a turn_start/agent_end concern (P3.M1.T1), not a checkpoint concern.

# THE NAMESPACE CONTRACT — verified across 3 files (READ to confirm, do NOT edit)
- file: src/snapshot/git.ts
  why: `refForLabel` (~line 123): `if (label.startsWith("ckpt:")) return refs/mulligan/snapshots/checkpoint/
       ${label.slice(5)}`; non-ckpt labels → `refs/mulligan/snapshots/turn/<label>`. CONFIRMS "ckpt:" is the
       checkpoint prefix. The ref lives under checkpoint/<name> → EXEMPT from the turn/* GC (git gc only
       reclaims unreachable objects; the protected ref pins it).
  critical: capture's label MUST start with "ckpt:" or the snapshot lands under turn/* and gets GC'd at the next
       prompt (defeating the checkpoint). "ckpt:" + name is correct.
- file: src/snapshot/cas.ts
  why: the CAS mark-sweep (~line 950): `if (f.startsWith("ckpt"))` → checkpoint manifests are EXEMPT from the
       turn reclamation sweep. CONFIRMS "ckpt" is the CAS exemption prefix too.
- file: src/capture.ts
  why: gcTurnSnapshots (~line 67): `for (const key of [...(rt.snapshots?.keys() ?? [])]) if (key.startsWith("turn"))
       rt.snapshots?.delete(key)`. CONFIRMS in-memory keys starting with "ckpt" are NEVER cleared (only "turn"/
       "turn-after" are). So rt.snapshots.get("ckpt:"+name) survives prompt-boundary GC.

# THE CONFIG GATE — config.ts (READ only)
- file: src/config.ts
  why: `getConfig().revert.enabled` (boolean, default false) is the layer-1 gate. step 4b checks it FIRST.
       This task does NOT edit config.ts. `getConfig` is ALREADY imported in commands.ts.
  critical: default false → zero capture. When the user has NOT opted in, step 4b is a complete no-op (the
       command behaves exactly as v1.1).

# THE STORE HANDLE — runtime.ts SessionRuntime.store + snapshots (already present from P1.M2.T2.S2)
- file: src/runtime.ts
  why: `SessionRuntime.store?: SnapshotStore` (assigned by P3.M1.T2.S1's session_start). `SessionRuntime.snapshots?:
       Map<string, RevertCheckpoint>` (freshRuntime always `new Map()`s it). `getRuntime(sessionId: string)`
       returns the live mutable runtime. step 4b reads `rt.store` (guard on undefined) + mutates `rt.snapshots`
       (guard on undefined via `?.`). Both fields ALREADY EXIST — this task does NOT add them.
  gotcha: getRuntime takes a STRING sessionId (NOT ctx — nudges.ts GOTCHA #5). Use
       `ctx.sessionManager.getSessionId()` then `getRuntime(sid)`. snapshots is `.?.set` because the interface
       marks it optional (freshRuntime always creates it, but the type is optional).

# THE TEST IDIOM — test/commands.test.ts (extend the existing suite)
- file: test/commands.test.ts
  why: the file's `makePi()` ALREADY has an `appendEntry` spy (the audit section added it: `appended: boolean[]`
       + `pi.appendEntry() { appended.push(true) }`) AND `makeCtx()` ALREADY returns a fake whose
       `sessionManager.getSessionId()` → "s1" by default. `vi.mock("../src/banner.js")` is file-scoped. beforeEach
       does `clearAll()` + `setConfig(undefined)` (→ DEFAULT_CONFIG, revert.enabled=false). `runSet(pi,ctx,name)`
       is the testable seam. So testing step 4b needs ONLY: seed `getRuntime("s1").store = fakeStore`,
       `setConfig({revert:{enabled:true, ...defaults}})`, run, assert.
  pattern: fakeStore = `{ describe: () => ({ backend: "git" }), capture: vi.fn().mockResolvedValue("sha-abc") }`
       cast `as unknown as SnapshotStore`. To assert appendEntry's payload, UPGRADE makePi's appendEntry to
       record args (see Implementation Tasks Task 2) OR capture via a local spy — minimal change. To exercise
       the none-throw gate + reject path, set `describe: () => ({ backend: "none" })` /
       `capture: vi.fn().mockResolvedValue(null)` / `capture: vi.fn().mockRejectedValue(new Error("boom"))`.
  gotcha: the existing beforeEach sets DEFAULT_CONFIG (revert OFF) — capture tests MUST `setConfig({revert:
       {enabled:true, allowDeleteCreatedFiles:false, nonGitMode:"cas", storageDir:null, maxFileBytes:262144,
       maxTotalBytes:33554432, maxSnapshotsPerTurn:64, excludeGlobs:[".git","node_modules"]}})` INSIDE the
       capture it()s and reset in a finally (mirror the audit disabled-test pattern). `setConfig` deep-merges
       over DEFAULT_CONFIG so partial objects work, but be explicit for clarity.

# THE PARALLEL SIBLING — P3.M1.T2.S1 owns session_start (DO NOT EDIT index.ts)
- file: plan/008_c36fd26768ae/P3M1T2S1/PRP.md
  why: P3.M1.T2.S1 (in flight, parallel) makes `session_start` create the store via `detectAndCreate` and cache
       it on `rt.store`, then run `gcTurnSnapshots`. It does NOT re-read `mulligan:revert-checkpoint` entries.
       Because session_start is owned by that task, THIS task MUST NOT edit index.ts (would conflict). step 4b
       reads `rt.store` which P3.M1.T2.S1 populates — if it isn't wired yet, the `if (rt.store)` guard skips
       gracefully (the checkpoint still sets; file-revert just isn't available until the store exists).
  critical: the RELOAD re-read of `mulligan:revert-checkpoint` (restoring rt.snapshots after /resume) is NOT in
       P3.M1.T2.S1's PRP and NOT in this task's scope. See "SCOPE BOUNDARY / Residual Risk" in Known Gotchas.

# THE FUTURE CONSUMER — P4.M2.T1.S1 rewind step 6b resolves checkpoints by label
- file: plan/008_c36fd26768ae/  (P4.M2.T1.S1 PRP, Planned — not yet written)
  why: the rewind tool's step 6b (P4.M2.T1.S1) resolves a `granularity:"checkpoint"` file-revert by looking up
       `rt.snapshots.get("ckpt:" + name)` (the SAME key this task sets) → reads `.beforeRef` → `store.restore`.
       THIS task + P4.M2.T1.S1 MUST agree on the key `"ckpt:" + name`. The contract pseudocode for both uses it.
       (checkpointExists in src/tools/rewind.ts confirms the LABEL prefix is `mulligan:checkpoint:<name>` — that
       is the CONVERSATION label, distinct from the SNAPSHOT key `ckpt:<name>`. Do not conflate them.)
```

### Current Codebase tree (relevant slice)

```bash
src/
  commands.ts          # makeCheckpointCommand handler — EDIT (insert step 4b inside the entryId-if)
  runtime.ts           # SessionRuntime.store + snapshots — READ ONLY (both fields already present)
  markers.ts           # RevertCheckpoint type — READ ONLY
  capture.ts           # turnStartCaptureHandler pattern + gcTurnSnapshots namespace — READ ONLY (MIRROR pattern)
  config.ts            # getConfig().revert.enabled gate — READ ONLY
  snapshot/store.ts    # SnapshotStore.capture/describe interface — READ ONLY
  snapshot/git.ts      # refForLabel("ckpt:" → checkpoint/<name>) — READ ONLY (namespace confirmation)
  snapshot/cas.ts      # mark-sweep exempts "ckpt" manifests — READ ONLY (namespace confirmation)
  index.ts             # session_start (P3.M1.T2.S1 owns) — DO NOT EDIT
test/
  commands.test.ts     # makePi (has appendEntry spy) + makeCtx (getSessionId→"s1") — EDIT (add step-4b block)
```

### Desired Codebase tree with files to be added/edited

```bash
src/commands.ts        # EDIT — insert step 4b capture block in makeCheckpointCommand handler (+ JSDoc)
test/commands.test.ts  # EDIT — ADD "step 4b checkpoint snapshot capture" describe block (8 it()s)
# (no new files, no new types, no new exports, no new imports)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// NO `return` / `throw` INSIDE STEP 4b: the block lives inside `if ("entryId" in res) { … notify … ;
//   reconcileBanner(ctx) }`. A bare `return` would skip the fair-warning notify AND the banner refresh — a
//   regression of the v1.1 command. Use nested `if` guards (if (rt.store) / if (backend !== "none") / if (ckptRef))
//   and let control fall through. The capture.ts turnStartCaptureHandler's `if (backend === "none") return;` is
//   a TOP-LEVEL handler pattern that does NOT carry over here — adapt to `if (backend !== "none") { … }`.

// BACKEND NARROWING (mirror capture.ts): `rt.store.describe().backend` is "git"|"cas"|"none"; RevertCheckpoint.
//   backend is "git"|"cas" ONLY. Read it into `const backend` + guard `if (backend !== "none")` so TS narrows
//   `backend` to "git"|"cas" for the snapshots.set + appendEntry payloads. NoOpStore.capture returns null anyway,
//   so a non-null ref only ever comes from a git/cas backend — the guard just makes it type-clean + skips a
//   pointless capture call. `const` keeps the narrowing live across the `await store.capture(…)`.

// NAMESPACE IS "ckpt:" + name (NOT "checkpoint:<name>"): verified across git.ts refForLabel (ckpt: → checkpoint/
//   <name> protected ref), cas.ts mark-sweep (exempts manifests starting with "ckpt"), and capture.ts
//   gcTurnSnapshots (only deletes keys starting with "turn"). runtime.ts's JSDoc string "checkpoint:<name>" is a
//   STALE DOC — the IMPLEMENTED contract is "ckpt:". Use "ckpt:" + name for the capture arg, the snapshots Map
//   key, the RevertCheckpoint.label, AND the control entry's label — all four identical.

// turnIndex === -1: RevertCheckpoint.turnIndex is a number; checkpoints are set by a human command mid-
//   conversation with no single turn index. -1 is the "checkpoint, not turn-bound" sentinel. The rewind tool
//   resolves checkpoints by LABEL (not turnIndex), so -1 is safe + distinct from real turn indices (>=0).

// DO NOT SET afterRef: a checkpoint is a SINGLE before-snapshot (the working-tree state at checkpoint-set time).
//   The before/after PAIR is a turn_start/agent_end concern (P3.M1.T1). Checkpoints never get an afterRef. The
//   rewind's dirty-guard for a checkpoint rewind uses a just-in-time after-ref path (PRD §6 step 3) — not a
//   stored afterRef. Leave afterRef unset (it's optional on RevertCheckpoint).

// sessionId EXTRACTION: use `ctx.sessionManager.getSessionId()` (makeAuditCommand in the SAME file does this).
//   getRuntime takes a STRING (nudges.ts GOTCHA #5: NOT ctx, NOT ctx.sessionId — that property doesn't exist).
//   Read it ONCE into a local `const sessionId`. getRuntime + getConfig are ALREADY imported in commands.ts.

// pi IS THE FACTORY-CLOSURE ARG: `makeCheckpointCommand(pi)` captures `pi`; the handler closes over it. So
//   `pi.appendEntry("mulligan:revert-checkpoint", …)` is available with NO new plumbing. appendEntry returns
//   void (spec/02 C7) — do not await a return value.

// BEST-EFFORT TRY/CATCH: step 4b has its OWN `try { … } catch { /* best-effort */ }` so a capture/store/
//   appendEntry failure is swallowed and NEVER reaches the outer handler try/catch's "unexpected error" notify.
//   The contract: "a capture failure is logged and never blocks checkpoint creation." (Logging is OPTIONAL — a
//   swallowed catch with a comment is sufficient; the capture.ts hooks DO log via log(), but the command path
//   can stay comment-only to match the file's existing best-effort style. If you log, import `log` from "./log.js".)

// rt.snapshots?.set (optional-chained): SessionRuntime.snapshots is `Map<string, RevertCheckpoint> | undefined`
//   in the INTERFACE (optional) but freshRuntime ALWAYS creates a `new Map()`. Use `rt.snapshots?.set(…)` to
//   satisfy the optional type (mirrors capture.ts's `rt.snapshots?.set("turn", …)`). The Map is always present
//   at runtime for a real session.

// rt.store GUARD FIRST: SessionRuntime.store is `undefined` until P3.M1.T2.S1's session_start assigns it. When
//   undefined (config off at session_start, or P3.M1.T2.S1 not yet wired), `if (rt.store)` skips the whole
//   capture gracefully — the checkpoint still sets, file-revert just isn't available. Never assume rt.store.

// .js IMPORT SPECIFIERS: this task adds NO new imports (getRuntime + getConfig already in commands.ts). If you
//   choose to log in the catch, `import { log } from "./log.js";` — but a comment-only catch is fine too.

// SCOPE BOUNDARY / RESIDUAL RISK (the reload re-read): the contract note "session_start (P3.M1.T2.S1) re-reads
//   mulligan:revert-checkpoint entries on reload to restore rt.snapshots (E32 resolved)" describes a SIBLING
//   concern. P3.M1.T2.S1's PRP (read in full) does NOT include that re-read — it only creates the store + runs
//   gcTurnSnapshots. Because session_start is owned by the in-flight parallel task, THIS task does NOT edit
//   index.ts. WITHIN a single session the feature is fully functional (rt.snapshots is set in-memory; the rewind
//   tool resolves it directly). ACROSS a /resume/reload: the on-disk ref survives (refs/mulligan/snapshots/
//   checkpoint/<name>) BUT rt.snapshots is empty until a session_start re-read repopulates it — so a checkpoint
//   set in session A is not file-revertable in a reloaded session B until that re-read lands. RECOMMENDATION:
//   add the re-read to P3.M1.T2.S1's session_start (scan getEntries() for customType==="mulligan:revert-
//   checkpoint", validate via store.has(ref), rebuild rt.snapshots.set(label, {label, backend, beforeRef:ref,
//   turnIndex:-1, ts})) OR a dedicated follow-up. This task APPENDS the control entry (the write side); it does
//   not consume it. Flagged as a cross-task dependency, not a defect of this task.

// DO NOT EDIT index.ts / capture.ts / runtime.ts / markers.ts / store.ts / config.ts / snapshot/*.ts: this task
//   is a SURGICAL edit to makeCheckpointCommand's handler + tests. The store field, snapshots field,
//   RevertCheckpoint type, SnapshotStore interface, getConfig().revert.enabled, and the gc namespace all pre-exist.
```

---

## Implementation Blueprint

### Data models and structure

This task adds **NO new types, NO new exports, NO new files, NO new imports**. It builds an object literal
conforming to the pre-existing `RevertCheckpoint` (markers.ts) and appends a lightweight control entry via the
pre-existing `pi.appendEntry`. It consumes: `getConfig` + `getConfig().revert.enabled` (config.ts, already
imported in commands.ts), `getRuntime` (runtime.ts, already imported), `SessionRuntime.store` + `.snapshots`
(runtime.ts, present from P1.M2.T2.S2), `SnapshotStore.capture` + `.describe` (store.ts), and `pi` (the factory
closure arg).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM PREREQUISITES (read commands.ts + capture.ts + markers.ts + runtime.ts + the namespace files)
  - READ src/commands.ts: CONFIRM makeCheckpointCommand's handler shape (parse → enabled-gate → validCheckpointName-gate
    → setCheckpoint → `if ("entryId" in res) { notify(fair-warning) ; reconcileBanner(ctx) } else { notify(could-not-set) }`,
    whole body in try/catch). CONFIRM `import { getRuntime } from "./runtime.js";` + `import { getConfig } from
    "./config.js";` are PRESENT (makeAuditCommand uses both). CONFIRM `makePi()`'s fake has an `appendEntry` spy
    (it does — the audit section added `appended: boolean[]`).
  - READ src/capture.ts turnStartCaptureHandler: NOTE the backend-narrowing pattern (`const backend =
    rt.store.describe().backend; if (backend === "none") return; … if (beforeRef) { rt.snapshots?.set("turn",
    {label:"turn", backend, beforeRef, turnIndex:event.turnIndex, ts:Date.now()}); }`). ADAPT: replace the
    `=== "none" return` with `!== "none" { … }` (no return mid-if-body).
  - READ src/markers.ts RevertCheckpoint: CONFIRM `{ label: string; backend: "git"|"cas"; beforeRef: string;
    afterRef?: string; turnIndex: number; ts: number }`.
  - READ src/runtime.ts: CONFIRM `store?: SnapshotStore` + `snapshots?: Map<string, RevertCheckpoint>` BOTH
    present (P1.M2.T2.S2). CONFIRM `getRuntime(sessionId: string)` signature.
  - READ src/snapshot/git.ts refForLabel (~line 123) + cas.ts mark-sweep (~line 950) + capture.ts gcTurnSnapshots
    (~line 67): CONFIRM the "ckpt:" namespace is the checkpoint prefix across all three.
  - WHY: this task is a SURGICAL edit to ONE handler + tests. Confirming the exact current shape avoids guesswork.

Task 1: EDIT src/commands.ts — INSERT step 4b in makeCheckpointCommand's handler
  - LOCATE the `if ("entryId" in res) {` block inside makeCheckpointCommand's handler (it currently contains the
    fair-warning notify + `reconcileBanner(ctx)`).
  - IMMEDIATELY AFTER the `if ("entryId" in res) {` opening brace (BEFORE the fair-warning notify), INSERT the
    step-4b block (see Implementation Patterns for the exact code). The block:
      * a JSDoc/inline comment citing `@spec/13 §2 step 4b` + `@14 §5` (Mode A — docs ride with the work);
      * `if (getConfig().revert.enabled) {` (layer-1 gate FIRST);
      *   `try {`;
      *     `const sessionId = ctx.sessionManager.getSessionId();` (the file's own makeAuditCommand pattern);
      *     `const rt = getRuntime(sessionId);`
      *     `if (rt.store) {` (guard — store undefined until P3.M1.T2.S1);
      *       `const backend = rt.store.describe().backend;`
      *       `if (backend !== "none") {` (narrow + skip NoOpStore; NO return);
      *         `const ckptRef = await rt.store.capture("ckpt:" + name);`
      *         `if (ckptRef) {`
      *           `rt.snapshots?.set("ckpt:" + name, { label: "ckpt:" + name, backend, beforeRef: ckptRef,
                turnIndex: -1, ts: Date.now() });`
      *           `pi.appendEntry("mulligan:revert-checkpoint", { label: "ckpt:" + name, ref: ckptRef, backend });`
      *         `}`
      *       `}`
      *     `}`
      *   `} catch { /* best-effort — never blocks checkpoint creation (@14 §5) */ }`;
      * `}`;
  - PRESERVE the fair-warning notify + reconcileBanner(ctx) AFTER the block (they still run — control falls through).
  - WHY: the deliverable — the checkpoint snapshot capture wired into the command.
  - GOTCHA: NO return/throw inside the block (would skip notify + banner). backend is a const narrowed by
    !=="none" → stays "git"|"cas" across the await. Use "ckpt:" + name everywhere (capture arg, Map key,
    RevertCheckpoint.label, control-entry label). turnIndex === -1. Do NOT set afterRef. NO new imports.

Task 2: EDIT test/commands.test.ts — ADD the step-4b describe block
  - (Optional) UPGRADE makePi's appendEntry spy to record args so assertions can check the payload:
      change `appendEntry() { appended.push(true); }` → `appendEntry(ct: string, data: unknown) { appended.push(
      { customType: ct, data }); }` (and widen the `appended` array type). This is NON-BREAKING for the existing
      audit tests (they assert `appended.toHaveLength(0)` — still holds; the array shape change is internal).
      If you prefer zero churn, instead capture the appendEntry call via a separate local spy in the step-4b tests.
  - ADD a helper `fakeStore(opts)` returning `{ describe: () => ({ backend: opts.backend ?? "git" }), capture:
    vi.fn().mockResolvedValue(opts.ref ?? "sha-abc") } as unknown as SnapshotStore` (+ import `type { SnapshotStore }`
    from "../src/snapshot/store.js" — type-only, erased).
  - ADD `setRevertOn()` / inline `setConfig({ revert: { enabled: true, allowDeleteCreatedFiles: false,
    nonGitMode: "cas", storageDir: null, maxFileBytes: 262144, maxTotalBytes: 33554432, maxSnapshotsPerTurn: 64,
    excludeGlobs: [".git","node_modules"] } })` for the capture tests; reset in `finally` (mirror the audit
    disabled-test try/finally pattern).
  - ADD describe block "step 4b checkpoint snapshot capture (P3.M2.T1.S1)":
      - it("captures ckpt:<name> + sets rt.snapshots + appends mulligan:revert-checkpoint when revert ON + git store"):
          setRevertOn; getRuntime("s1").store = fakeStore({backend:"git", ref:"sha-abc"}); await runSet(pi,ctx,
          "before-refactor"); assert fakeStore.capture called with "ckpt:before-refactor"; assert
          getRuntime("s1").snapshots.get("ckpt:before-refactor") deepEquals {label:"ckpt:before-refactor",
          backend:"git", beforeRef:"sha-abc", turnIndex:-1, ts:<number>}; assert appendEntry called with
          ("mulligan:revert-checkpoint", {label:"ckpt:before-refactor", ref:"sha-abc", backend:"git"}); AND
          the checkpoint still set (labels has mulligan:checkpoint:before-refactor) + fair-warning notify fired
          (notifies length 1, type warning) + reconcileBanner called.
      - it("revert.enabled === false (DEFAULT) → NO capture, NO snapshots.set, NO appendEntry; checkpoint still
          sets + notify + banner"): (DEFAULT_CONFIG — no setRevertOn); getRuntime("s1").store = fakeStore();
          await runSet(pi,ctx,"x"); assert fakeStore.capture NOT called; assert
          getRuntime("s1").snapshots.has("ckpt:x") === false; assert appended length 0; assert labels has the
          checkpoint + notify + reconcileBanner (behaves EXACTLY as v1.1).
      - it("store undefined (not wired) → graceful skip; checkpoint still sets + notify + banner"):
          setRevertOn; (do NOT seed rt.store → undefined); await runSet(pi,ctx,"x"); assert
          getRuntime("s1").snapshots.has("ckpt:x") === false; assert appended length 0; assert checkpoint set +
          notify + banner.
      - it("backend === 'none' (NoOpStore) → NO capture, NO snapshots.set, NO appendEntry; checkpoint still sets"):
          setRevertOn; getRuntime("s1").store = fakeStore({backend:"none"}); await runSet(pi,ctx,"x"); assert
          fakeStore.capture NOT called; assert snapshots.has("ckpt:x") === false; assert appended length 0;
          assert checkpoint set + notify + banner.
      - it("capture returns null (caps exceeded) → NO snapshots.set, NO appendEntry; checkpoint still sets"):
          setRevertOn; getRuntime("s1").store = fakeStore({ref: null}); await runSet(pi,ctx,"x"); assert
          snapshots.has("ckpt:x") === false; assert appended length 0; assert checkpoint set + notify + banner.
      - it("capture REJECTS → step-4b swallows; checkpoint STILL sets + notify + banner (best-effort, E27)"):
          setRevertOn; const s = fakeStore(); (s.capture as Mock).mockRejectedValue(new Error("boom"));
          getRuntime("s1").store = s; await expect(runSet(pi,ctx,"x")).resolves.toBeUndefined(); assert
          snapshots.has("ckpt:x") === false; assert appended length 0; assert checkpoint set (labels) +
          fair-warning notify fired + reconcileBanner called (the catch did NOT block the rest).
      - it("cas backend → snapshots.backend === 'cas' + control entry backend 'cas'"): setRevertOn;
          getRuntime("s1").store = fakeStore({backend:"cas", ref:"manifest-xyz"}); await runSet(pi,ctx,"exp1");
          assert getRuntime("s1").snapshots.get("ckpt:exp1").backend === "cas"; assert appendEntry payload
          backend === "cas".
      - it("hasUI=false → capture STILL runs (hasUI-independent); no notify but snapshots.set + appendEntry happen"):
          setRevertOn; getRuntime("s1").store = fakeStore(); await runSet(pi, makeCtx({hasUI:false}).ctx, "x");
          assert fakeStore.capture called; assert snapshots.has("ckpt:x") === true; assert appended length 1;
          assert notifies length 0 (notify is hasUI-guarded; the capture is not).
  - WHY: validate the gate ordering, the namespace, the best-effort swallow, the always-still-fires invariant,
    and the hasUI-independence of the capture.
  - GOTCHA: beforeEach sets DEFAULT_CONFIG (revert OFF) — capture tests MUST setRevertOn inside the it() and
    reset in finally. getRuntime("s1") is the SAME runtime the handler resolves (makeCtx's getSessionId → "s1").
    Seeding getRuntime("s1").store BEFORE runSet is required (the handler reads it). Use `?.`-free direct set
    (getRuntime returns the live mutable runtime; .store is assignable).
```

### Implementation Patterns & Key Details

```typescript
// src/commands.ts — makeCheckpointCommand handler, the EDITED if-body. The imports are UNCHANGED (getRuntime +
// getConfig already imported; pi is the closure arg). The new block is inserted right after `if ("entryId" in res) {`.

        const res = setCheckpoint(pi, ctx, name);
        if ("entryId" in res) {
          // [P3.M2.T1.S1 / @spec/13 §2 step 4b + @14 §5] v1.2 working-tree revert: capture a checkpoint snapshot
          // so a later mulligan_rewind(granularity:"checkpoint", revert_file_changes:true) can restore files to
          // this point. BEST-EFFORT: a capture failure is swallowed and NEVER blocks the checkpoint (the label
          // was already set by setCheckpoint above) — the fair-warning notify + reconcileBanner below ALWAYS run.
          // The mulligan:revert-checkpoint control entry lets a reloaded session restore rt.snapshots (E32). The
          // "ckpt:" namespace is exempt from prompt-boundary GC (git refForLabel → checkpoint/<name>; CAS mark-sweep
          // exempts "ckpt" manifests; gcTurnSnapshots only clears keys starting with "turn").
          if (getConfig().revert.enabled) {
            try {
              const sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); same pattern as makeAuditCommand
              const rt = getRuntime(sessionId);
              if (rt.store) {
                const backend = rt.store.describe().backend;
                if (backend !== "none") {
                  // narrowed to "git"|"cas" (const stays narrowed across the await) — NoOpStore skipped
                  const ckptRef = await rt.store.capture("ckpt:" + name);
                  if (ckptRef) {
                    rt.snapshots?.set("ckpt:" + name, {
                      label: "ckpt:" + name,
                      backend,
                      beforeRef: ckptRef,
                      turnIndex: -1, // sentinel: checkpoint, not turn-bound (rewind resolves by label)
                      ts: Date.now(),
                    });
                    // persist for cross-reload (E32): session_start re-reads mulligan:revert-checkpoint entries
                    // to rebuild rt.snapshots. { label, ref, backend } is the minimal reload-restore set.
                    pi.appendEntry("mulligan:revert-checkpoint", {
                      label: "ckpt:" + name,
                      ref: ckptRef,
                      backend,
                    });
                  }
                }
              }
            } catch {
              /* best-effort — never blocks checkpoint creation (@14 §5 / E27) */
            }
          }
          notify(
            ctx,
            `Mulligan: checkpoint '${name}' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with /mulligan_checkpoint_revoke ${name}.`,
            "warning",
          ); // spec/13 §2 step 5 verbatim (UNCHANGED)
          reconcileBanner(ctx); // spec/13 §2 step 6 (UNCHANGED — step 4b fell through to here)
        } else {
          notify(ctx, `Mulligan: could not set checkpoint: ${res.error}`, "warning");
        }
```

```typescript
// test/commands.test.ts — the step-4b fake store + a representative happy-path test (see Task 2 for all 8).

import type { SnapshotStore } from "../src/snapshot/store.js"; // type-only (erased)

/** A recording fake store for step-4b tests. describe().backend + capture()'s resolved ref are configurable. */
function fakeStore(opts: { backend?: "git" | "cas" | "none"; ref?: string | null } = {}): SnapshotStore {
  return {
    describe: () => ({ backend: opts.backend ?? "git" }),
    capture: vi.fn().mockResolvedValue(opts.ref === undefined ? "sha-abc" : opts.ref),
    // the other SnapshotStore methods are unused by step 4b — omit (cast satisfies the structural need via `as unknown as`)
  } as unknown as SnapshotStore;
}

/** Turn revert ON for a capture test (DEFAULT_CONFIG has it off). Reset with setConfig(undefined) in finally. */
function setRevertOn() {
  setConfig({
    revert: {
      enabled: true,
      allowDeleteCreatedFiles: false,
      nonGitMode: "cas",
      storageDir: null,
      maxFileBytes: 262144,
      maxTotalBytes: 33554432,
      maxSnapshotsPerTurn: 64,
      excludeGlobs: [".git", "node_modules"],
    },
  });
}

describe("step 4b checkpoint snapshot capture (P3.M2.T1.S1)", () => {
  it("captures ckpt:<name> + sets rt.snapshots + appends mulligan:revert-checkpoint (revert ON + git store)", async () => {
    setRevertOn();
    try {
      const store = fakeStore({ backend: "git", ref: "sha-abc" });
      getRuntime("s1").store = store;
      const { appended, pi } = makePi();
      const { notifies, ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
      await runSet(pi, ctx, "before-refactor");
      expect((store.capture as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toBe("ckpt:before-refactor");
      expect(getRuntime("s1").snapshots.get("ckpt:before-refactor")).toMatchObject({
        label: "ckpt:before-refactor",
        backend: "git",
        beforeRef: "sha-abc",
        turnIndex: -1,
      });
      // (assert appendEntry payload — depends on whether you upgraded makePi's spy to record args; see Task 2)
      // checkpoint + notify + banner STILL fired (step 4b did not block them):
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);
    } finally {
      setConfig(undefined); // reset to DEFAULT_CONFIG (revert OFF) so it doesn't leak
    }
  });
  // … + the 7 other it()s from Task 2 (gate-off, store-undefined, none-backend, capture-null, capture-reject,
  //   cas-backend, hasUI=false) …
});
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES. This task is a surgical in-process TS edit (one handler block + tests). NO new imports.
COMMAND: /mulligan_checkpoint <name> — step 4b is a NEW sub-step inside the existing handler (after setCheckpoint
  success, before the notify + reconcileBanner). The command's signature, description, registration (index.ts),
  and v1.1 behavior (label + notify + banner) are ALL UNCHANGED when revert is OFF (the default).
STORE: reads rt.store (SessionRuntime.store, assigned by P3.M1.T2.S1's session_start). When undefined → graceful
  skip. capture("ckpt:" + name) → before-ref; describe().backend → "git"|"cas" (narrowed past "none").
RUNTIME: mutates rt.snapshots (SessionRuntime.snapshots, a Map<string, RevertCheckpoint> — present from
  P1.M2.T2.S2). Sets key "ckpt:" + name. NEVER reads/writes seq, tokenBaseline, or any other runtime field.
CONTROL ENTRY: appends a Pi CustomEntry via pi.appendEntry("mulligan:revert-checkpoint", {label, ref, backend}).
  Returns void (C7). NOT a MulliganEnvelope marker — a lightweight reload-restore record (read back by the
  session_start re-read, a cross-task dependency — see Known Gotchas).
CONFIG: getConfig().revert.enabled (default false) is the layer-1 gate. Checked FIRST inside step 4b.
  This task does NOT edit config.ts.
NAMESPACE (load-bearing): "ckpt:" + name for the capture arg, the snapshots Map key, the RevertCheckpoint.label,
  AND the control-entry label — all identical. Verified across git.ts refForLabel, cas.ts mark-sweep, capture.ts
  gcTurnSnapshots (see Documentation references).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project after Task 1. The backend narrowing (`const backend = …; if (backend !== "none")`)
# keeps backend as "git"|"cas" inside the if → RevertCheckpoint.backend + the control-entry payload type-check.
# The optional-chained rt.snapshots?.set satisfies the optional Map type. No new imports to resolve.
npx tsc --noEmit
npx tsc --noEmit 2>&1 | grep -E 'commands.ts'   # isolate this task's file (expect: no output)

# LSP diagnostics on the edited file (fast, in-editor)
# (call lsp_diagnostics on src/commands.ts + test/commands.test.ts — expect no diagnostics)

# Format check
npx prettier --check src/commands.ts test/commands.test.ts

# Expected: Zero errors. If tsc flags "Type '"none"' is not assignable to type '"git" | "cas"'", the backend
# narrowing is missing — add the `if (backend !== "none")` guard (or `if (backend === "none") { /* skip */ } else {…}`).
# If tsc flags "Property 'store' does not exist" or "Property 'snapshots' does not exist", runtime.ts's fields
# are somehow absent — they should be present (P1.M2.T2.S2); re-confirm in Task 0.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the commands suite (fast feedback while implementing).
npx vitest run test/commands.test.ts

# Full suite — confirm no regressions (the edit is additive to one handler; the existing checkpoint/revoke/
# audit/clearCheckpointByName/never-throws/hasUI/types tests must ALL still pass).
npx vitest run

# Expected: ALL green. The existing v1.1 command tests (revert OFF → step 4b is a complete no-op) pass
# UNCHANGED — the gate skips before any capture/store access. The 8 NEW step-4b tests pass. No other suite is
# affected (commands.ts is only tested by commands.test.ts).
```

`test/commands.test.ts` describe/it blocks ADDED by this task:

```yaml
describe("step 4b checkpoint snapshot capture (P3.M2.T1.S1)"):
  - it("captures ckpt:<name> + sets rt.snapshots + appends mulligan:revert-checkpoint (revert ON + git store)")
  - it("revert.enabled === false (DEFAULT) → NO capture / snapshots.set / appendEntry; checkpoint+notify+banner fire (v1.1 parity)")
  - it("store undefined (not wired) → graceful skip; checkpoint+notify+banner fire")
  - it("backend === 'none' (NoOpStore) → NO capture / snapshots.set / appendEntry; checkpoint+notify+banner fire")
  - it("capture returns null (caps exceeded) → NO snapshots.set / appendEntry; checkpoint+notify+banner fire")
  - it("capture REJECTS → step-4b swallows; checkpoint STILL sets + notify + banner fire (best-effort, E27)")
  - it("cas backend → snapshots.backend === 'cas' + control-entry backend 'cas'")
  - it("hasUI=false → capture STILL runs (hasUI-independent); no notify but snapshots.set + appendEntry happen")
```

### Level 3: Integration Testing (System Validation)

```bash
# This task is UNIT-tier (test/commands.test.ts). The end-to-end checkpoint-capture → checkpoint-rewind-restore
# flow is validated by the F-revert-* integration scenarios in P5.M1.T1 (Tier 2 — real temp git/non-git dirs,
# real backends; specifically F-revert-granularity exercises a /mulligan_checkpoint-then-rewind across prompts,
# and F-revert-reload exercises the cross-reload path once the session_start re-read lands). This task does NOT
# add those.

# Smoke (optional, manual): confirm a checkpoint captures a real snapshot against a real temp git repo +
# configured storageDir. (Requires P3.M1.T2.S1's session_start to have wired rt.store first.)
tmp=$(mktemp -d) && storeDir=$(mktemp -d) && cd "$tmp" && git init -q && printf 'a\n' > f.txt
# (in a real Pi session with settings.json mulligan.revert.enabled=true + storageDir set)
# /mulligan_checkpoint before-refactor
# → expect: "Mulligan: checkpoint 'before-refactor' set. …" + (behind the scenes) a refs/mulligan/snapshots/
#   checkpoint/before-refactor commit in the shadow repo + a mulligan:revert-checkpoint control entry in the
#   session JSONL.
cd - && rm -rf "$tmp" "$storeDir"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm NO edits to files outside this task's scope (the ONLY files touched: src/commands.ts, test/commands.test.ts):
git status --porcelain | grep -E 'index.ts|capture.ts|runtime.ts|markers.ts|store.ts|config.ts|snapshot/|tools/|nudges.ts|tasks.json|prd_snapshot|PRD.md' \
  && echo "ERROR: touched an out-of-scope/locked file" || echo "OK: scope respected"

# Parity check: step 4b must be INSIDE the entryId-if, BEFORE reconcileBanner, gated on revert.enabled, with its
# OWN try/catch, and must NOT return early. Confirm the structure:
rg -n "revert.enabled|capture\(\"ckpt:|appendEntry\(\"mulligan:revert-checkpoint\"|reconcileBanner\(ctx\)|catch \{" src/commands.ts | head -40
# Expected: inside makeCheckpointCommand, the sequence is: getConfig().revert.enabled gate → try → getRuntime →
#   if (rt.store) → backend !== "none" → capture("ckpt:" + name) → snapshots.set → appendEntry → } catch {} →
#   (FALLS THROUGH to) notify(fair-warning) → reconcileBanner(ctx). The notify + reconcileBanner appear AFTER
#   the catch (not inside the try).

# Confirm the namespace is "ckpt:" (NOT "checkpoint:") everywhere in step 4b:
rg -n '"ckpt:" \+ name' src/commands.ts
# Expected: 4 matches (capture arg, snapshots key, RevertCheckpoint.label, control-entry label) — all identical.

# Confirm NO early return inside the entryId-if block (would skip notify + banner — a regression):
rg -n 'if \("entryId" in res\)' src/commands.ts
# then inspect the block — the only flow-control keywords between the if-opening and reconcileBanner should be
# nested `if`s + the inner `try/catch`, NO `return`.

# Confirm NO new imports were added (getRuntime + getConfig pre-existed):
rg -n '^import' src/commands.ts | grep -E 'runtime|config'
# Expected: the existing `import { getRuntime } from "./runtime.js";` + `import { getConfig } from "./config.js";`
# lines (unchanged). If a NEW import appears, it should only be `log` (optional, only if you chose to log in the
# catch — a comment-only catch needs none).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean — backend narrowing resolves ("git"|"cas" assigned to RevertCheckpoint.backend +
      the control-entry payload); optional-chained `rt.snapshots?.set` satisfies the optional Map; no new imports.
- [ ] `npx vitest run test/commands.test.ts` — ALL green (8 NEW step-4b tests + the existing v1.1 command tests
      unchanged — the revert-OFF gate makes step 4b a no-op for them).
- [ ] `npx vitest run` — full suite green (no regressions; commands.ts is only tested by commands.test.ts).
- [ ] `lsp_diagnostics` on src/commands.ts + test/commands.test.ts — no diagnostics.
- [ ] `.js` import specifiers preserved (this task adds NONE — getRuntime + getConfig already imported).

### Feature Validation
- [ ] `/mulligan_checkpoint <name>` with revert ON + git/cas store: `getRuntime(sid).snapshots.get("ckpt:" + name)`
      is the RevertCheckpoint; `mulligan:revert-checkpoint` control entry appended; fair-warning notify + banner fire.
- [ ] revert OFF (default): step 4b is a complete no-op — command behaves EXACTLY as v1.1.
- [ ] store undefined / backend "none" / capture null / capture reject: step 4b skips gracefully + checkpoint +
      notify + banner ALWAYS fire (best-effort, never blocks — E27).
- [ ] capture label + Map key + RevertCheckpoint.label + control-entry label are ALL `"ckpt:" + name`.
- [ ] turnIndex is `-1` (checkpoint sentinel); afterRef is NOT set.

### Code Quality Validation
- [ ] The step-4b block follows the command-factory pattern (codebase_patterns.md §5: AFTER setCheckpoint success,
      BEFORE reconcileBanner; best-effort; failures swallowed).
- [ ] File placement matches the desired tree (EDIT src/commands.ts + test/commands.test.ts ONLY).
- [ ] Anti-patterns avoided (no return/throw inside the entryId-if; no "checkpoint:" namespace; no afterRef;
      no new types/exports/imports; no out-of-scope edits; no edit to index.ts/capture.ts/runtime.ts).
- [ ] JSDoc on the step-4b block cites `@spec/13 §2 step 4b` + `@14 §5` (Mode A — rides with the work).
- [ ] Dependencies respected: store field + snapshots field present (P1.M2.T2.T2.S2); store POPULATED by
      P3.M1.T2.S1 (parallel — guarded via `if (rt.store)`); turn hooks (P3.M1.T1) + rewind step 6b (P4.M2.T1)
      are siblings; the reload re-read is a cross-task dependency (documented, not implemented here).

### Documentation & Deployment
- [ ] Code is self-documenting (the gate ordering, the namespace rationale, the best-effort contract, and the
      control-entry purpose are commented inline).
- [ ] No new environment variables (config.revert.* shipped in P1.M1.T1.S1; this task reads getConfig().revert.enabled).

---

## Anti-Patterns to Avoid

- ❌ Don't `return` or `throw` inside step 4b — it lives inside `if ("entryId" in res) { … notify … ; reconcileBanner(ctx) }`;
  a bare return skips the fair-warning notify + the banner refresh (a v1.1 regression). Use nested `if` guards.
- ❌ Don't use the `"checkpoint:"` namespace — the IMPLEMENTED contract is `"ckpt:"` (git.ts refForLabel + cas.ts
  mark-sweep + capture.ts gcTurnSnapshots all key on "ckpt"). runtime.ts's "checkpoint:<name>" JSDoc is stale.
- ❌ Don't set `afterRef` on a checkpoint — checkpoints are single before-snapshots; the before/after pair is a
  turn_start/agent_end concern (P3.M1.T1). The rewind's checkpoint dirty-guard uses a just-in-time after-ref.
- ❌ Don't skip the `if (backend !== "none")` guard — `describe().backend` is `"git"|"cas"|"none"` and
  RevertCheckpoint.backend is `"git"|"cas"` ONLY. Without the guard, `backend` won't narrow and tsc fails. (The
  guard also skips a pointless NoOpStore.capture call.)
- ❌ Don't use `ctx.sessionId` (doesn't exist) — use `ctx.sessionManager.getSessionId()`. getRuntime takes a STRING.
- ❌ Don't omit step 4b's OWN try/catch — without it, a capture/store/appendEntry throw bubbles to the outer
  handler try/catch's "unexpected error" notify, which (a) replaces the fair-warning notify and (b) signals a
  broken checkpoint. The contract: "a capture failure is logged and never blocks checkpoint creation."
- ❌ Don't edit index.ts (session_start is owned by the parallel P3.M1.T2.S1) — this task reads `rt.store` which
  that task populates; if it isn't wired yet, the `if (rt.store)` guard skips gracefully.
- ❌ Don't implement the reload re-read here — it belongs in session_start (cross-task dependency; see Known
  Gotchas SCOPE BOUNDARY). This task appends the control entry (write side) only.
- ❌ Don't add new types/exports/imports — getRuntime + getConfig are already imported in commands.ts; `pi` is
  the closure arg; RevertCheckpoint is structural (object literal). The edit is additive to ONE handler.
- ❌ Don't gate on anything OTHER than `getConfig().revert.enabled` FIRST inside step 4b — it is the layer-1
  opt-in (default false → zero capture). The `if (rt.store)` + `if (backend !== "none")` guards come AFTER it.
- ❌ Don't conflate the CONVERSATION label (`mulligan:checkpoint:<name>`, set by setCheckpoint) with the SNAPSHOT
  key (`ckpt:<name>`, set by step 4b) — they are distinct namespaces (one anchors the conversation position, the
  other anchors the working-tree position). Both use the same `<name>` but different prefixes.

---

## Confidence Score

**9/10** — one-pass success highly likely. This is a SURGICAL edit (one handler block + 8 tests) with NO new
types, exports, imports, or files. Every decision is FORCED by the codebase, not arbitrary: (1) the `"ckpt:"`
namespace is verified across git.ts refForLabel (line 124), cas.ts mark-sweep (line 950), and capture.ts
gcTurnSnapshots (line 67) — it is the single consistent checkpoint prefix; (2) the backend-narrowing pattern is
copied verbatim from capture.ts turnStartCaptureHandler (adapted to no-return); (3) the sessionId extraction +
getRuntime + getConfig are already imported and used by makeAuditCommand in the SAME file; (4) the test fakes
(makePi with appendEntry spy, makeCtx with getSessionId→"s1") already exist — only a `fakeStore` helper + a
describe block are added. The one non-trivial control-flow rule (no return inside the entryId-if) is called out
in three places (Goal, Known Gotchas, Anti-Patterns) so it cannot be missed. Residual risks: (a) the reload
re-read of `mulligan:revert-checkpoint` is NOT in this task's scope (session_start is owned by the parallel
P3.M1.T2.S1) — within a session the feature is fully functional; across a /resume/reload the on-disk ref
survives but rt.snapshots is empty until that re-read lands (documented as a cross-task dependency); (b)
coordination with P4.M2.T1.S1 (rewind step 6b) on the `"ckpt:" + name` key — both the contract pseudocode and
this PRP use it, so agreement holds. The success criteria are independently testable with a fake store + the
existing makePi/makeCtx fakes.