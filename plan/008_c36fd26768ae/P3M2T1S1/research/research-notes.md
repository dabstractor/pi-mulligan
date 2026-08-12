# Research Notes — P3.M2.T1.S1: /mulligan_checkpoint step 4b (checkpoint snapshot capture)

## The one edit point (commands.ts makeCheckpointCommand)

`makeCheckpointCommand(pi)` (src/commands.ts ~line 180) returns `{ description, handler }`. The handler body:
```
parse name → getConfig().enabled gate → validCheckpointName(name) gate → setCheckpoint(pi, ctx, name) →
  if ("entryId" in res) { notify(fair-warning) ; reconcileBanner(ctx) }
  else { notify("could not set checkpoint: …") }
```
whole body wrapped in try/catch → "unexpected error" notify; NEVER throws.

Step 4b goes INSIDE `if ("entryId" in res) {`, BEFORE `reconcileBanner(ctx)` (the contract's placement:
"after setCheckpoint success, before reconcileBanner"). It is BEST-EFFORT with its OWN try/catch — a
capture failure MUST NEVER block the notify or the banner refresh (the label was already set).

## Critical control-flow constraint: NO early `return` inside step 4b

Because step 4b lives INSIDE `if ("entryId" in res) { … notify … ; reconcileBanner(ctx) }`, a bare
`return` anywhere in step 4b would SKIP the fair-warning notify + the banner refresh — a regression.
So the backend==="none" guard must be an inline `if (backend !== "none") { … }`, NOT `if (backend === "none") return;`.
(The turnStartCaptureHandler in capture.ts uses `return` because it is a TOP-LEVEL event handler with nothing
after it — that pattern does NOT carry over here.)

## Backend narrowing (mirror capture.ts turnStartCaptureHandler)

`rt.store.describe().backend` is typed `"git" | "cas" | "none"`. `RevertCheckpoint.backend` is `"git" | "cas"`
ONLY. NoOpStore.capture returns `null`, so a real (non-null) ref is only ever produced by a git/cas backend.
The clean, type-safe pattern (verbatim from turnStartCaptureHandler, capture.ts ~line 99-108):
```ts
const backend = rt.store.describe().backend;
if (backend === "none") return;        // capture.ts — top-level handler, OK to return
const beforeRef = await rt.store.capture("turn");
if (beforeRef) { rt.snapshots?.set("turn", { label:"turn", backend, … }); }  // backend narrowed
```
ADAPTED for step 4b (no return — nest under `!== "none"`):
```ts
const backend = rt.store.describe().backend;
if (backend !== "none") {
  const ckptRef = await rt.store.capture("ckpt:" + name);
  if (ckptRef) { rt.snapshots?.set("ckpt:" + name, { label:"ckpt:"+name, backend, beforeRef:ckptRef, turnIndex:-1, ts:Date.now() });
                 pi.appendEntry("mulligan:revert-checkpoint", { label:"ckpt:"+name, ref:ckptRef, backend }); }
}
```
`backend` is a `const` narrowed by the `!== "none"` check; TS keeps the narrowing across the `await`
(const can't be reassigned). This is the SAME narrowing turnStartCaptureHandler relies on.

## Namespace decision: `"ckpt:" + name` — VERIFIED consistent across all 4 surfaces

The label is used in 4 places that MUST agree. All four use `ckpt:`:
1. **capture() arg** (this task + the rewind read side): `"ckpt:" + name`.
2. **git.ts refForLabel** (src/snapshot/git.ts:124): `if (label.startsWith("ckpt:")) return refs/mulligan/snapshots/checkpoint/${label.slice(5)}` → protected ref under `checkpoint/<name>`.
3. **CAS mark-sweep GC** (src/snapshot/cas.ts:950): `if (f.startsWith("ckpt"))` → checkpoint manifests EXEMPT from turn reclamation.
4. **in-memory GC** (capture.ts gcTurnSnapshots:68): `if (key.startsWith("turn")) rt.snapshots?.delete(key)` → keys starting with `ckpt` are NEVER cleared (only `turn`/`turn-after` are).
(Note: runtime.ts's JSDoc mentions `"checkpoint:<name>"` as a key — that is a stale doc string; the
IMPLEMENTED contract + git.ts + cas.ts + capture.ts + the work-item pseudocode all use `ckpt:`. Follow `ckpt:`.)
So a checkpoint snapshot set with key `"ckpt:" + name` survives prompt-boundary GC AND reload (its ref is
under `checkpoint/<name>` on disk). The rewind tool (P4.M2.T1.S1) MUST look up rt.snapshots with the SAME
key `"ckpt:" + name` to resolve it — this PRP documents that as the agreed contract.

## sessionId extraction (follow the file's own pattern)

makeAuditCommand (src/commands.ts) ALREADY reads `const sessionId = ctx.sessionManager.getSessionId();`
then `const rt = getRuntime(sessionId);`. getRuntime is ALREADY imported in commands.ts
(`import { getRuntime } from "./runtime.js";`). So step 4b reuses the SAME one-liner. getConfig is also
already imported. `pi` is the factory-closure arg → `pi.appendEntry` available. **NO NEW IMPORTS NEEDED.**

## The persisted control entry shape

Contract-literal: `pi.appendEntry("mulligan:revert-checkpoint", { label:"ckpt:"+name, ref:ckptRef, backend })`.
This is a lightweight Pi CustomEntry (NOT a MulliganEnvelope marker — it is read back ONLY by the reload
path, never by the filter). { label, ref, backend } is the minimal set the reload re-read needs to rebuild
rt.snapshots. appendEntry returns void (spec/02 C7). The reload reader (NOT this task — see gap below)
re-scans getEntries() for customType==="mulligan:revert-checkpoint" entries, validates the ref via
`store.has(ref)`, and rebuilds `rt.snapshots.set(label, {label, backend, beforeRef:ref, turnIndex:-1, ts})`.

## turnIndex: -1 (sentinel for "checkpoint, not turn-bound")

RevertCheckpoint.turnIndex is a number. Checkpoints are set by a human command mid-conversation — there is
no single turn index to attribute (setCheckpoint anchors on the last REAL message, not a turn boundary).
The contract uses `-1` as the "this is a checkpoint, not a turn snapshot" sentinel. The rewind resolution
(P4.M2.T1.S1) does NOT use turnIndex for checkpoint granularity (it resolves by label), so -1 is safe.
(Compare turnStartCaptureHandler which sets `turnIndex: event.turnIndex` — checkpoints have no event.)

## SCOPE BOUNDARY — the reload re-read is NOT this task (session_start is owned by the parallel P3.M1.T2.S1)

The contract note: "The session_start handler (P3.M1.T2.S1) re-reads mulligan:revert-checkpoint entries on
reload to restore the snapshots Map (E32 resolved)." The P3.M1.T2.S1 PRP (read in full) does NOT include
this re-read — it only creates the store + runs gcTurnSnapshots. Because session_start is owned by the
IN-FLIGHT parallel task, THIS task MUST NOT edit session_start (would conflict / duplicate). Therefore:
- This task implements the WRITE side only: capture + rt.snapshots.set + appendEntry control entry.
- Within a single session (no reload), the feature is FULLY functional: rt.snapshots is set in-memory and
  the rewind tool (P4.M2.T1.S1) resolves it directly.
- The READ side (session_start re-read of mulligan:revert-checkpoint → restore rt.snapshots) is a CROSS-TASK
  DEPENDENCY not owned by this task. Documented as a residual risk: until it lands, a checkpoint set in
  session A is not restored after a /resume/reload into session B (the on-disk ref survives —
  refs/mulligan/snapshots/checkpoint/<name> persists — but the in-memory Map is empty until session_start
  repopulates it). RECOMMENDATION: add the re-read to P3.M1.T2.S1's session_start or a dedicated follow-up.
This is the honest scoping; the plan's "E32 resolved" status depends on that read-side landing too.

## Test approach (test/commands.test.ts — extend the existing suite)

The file's idiom: hand-rolled `makePi()` (with appendEntry spy already!) + `makeCtx()` (getSessionId→"s1")
+ `vi.mock("../src/banner.js")`; `clearAll()` + `setConfig(undefined)` in beforeEach. To test step 4b:
- Seed `getRuntime("s1").store = <fakeStore>` where fakeStore = `{ describe: () => ({backend:"git"}),
  capture: vi.fn().mockResolvedValue("sha-abc") }` (cast to SnapshotStore).
- `setConfig({ revert: { enabled: true, ...DEFAULTS } })` (revert ON) for the capture tests; revert OFF
  (default) for the gate test.
- runSet(pi, ctx, "before-refactor") then assert: fakeStore.capture called with "ckpt:before-refactor";
  `getRuntime("s1").snapshots.get("ckpt:before-refactor")` deep-equals the expected RevertCheckpoint;
  `pi.appendEntry` (via makePi's `appended` spy) called with ("mulligan:revert-checkpoint", {label,ref,backend});
  AND the checkpoint still set (labels has the setLabel) + notify fired + reconcileBanner called (step 4b
  did not block the rest).
- Gate test: revert.enabled=false → capture NOT called, no appendEntry, but checkpoint still set + notify + banner.
- NoOpStore test: store.describe().backend="none" → capture NOT called, no snapshots.set, no appendEntry,
  but checkpoint still set + notify + banner (graceful skip).
- Throw test: fakeStore.capture rejects → step 4b swallows it → checkpoint still set + notify + banner
  (best-effort: capture failure never blocks).
- hasUI=false: step 4b still runs (capture is hasUI-INDEPENDENT, like the label mutation); no notify but
  snapshots.set + appendEntry happened.

## No new types, no new exports, no new files

This task is a SURGICAL EDIT to makeCheckpointCommand's handler + test additions. No interface changes,
no new modules, no new imports. The RevertCheckpoint type (markers.ts) + SessionRuntime.snapshots (runtime.ts,
already present from P1.M2.T2.S2) + SnapshotStore.capture/describe (store.ts) + getConfig.revert.enabled
(config.ts) all pre-exist. This task ONLY wires them together inside the command.