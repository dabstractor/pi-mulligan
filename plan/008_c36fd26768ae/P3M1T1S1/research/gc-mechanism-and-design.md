# Research — GC mechanism & the gc() gap (P3.M1.T1.S1)

## The core finding: the locked interface has NO `gc()` method

`src/snapshot/store.ts` (P2.M1.T1.S1, "LOCKED") exports the `SnapshotStore` interface with exactly
6 methods: `describe`, `capture`, `dirtyCheck`, `restore`, `has`, `retire`. There is **no `gc()`**.

BUT PRD §5 (h2.145) mandates a prompt-boundary GC pass that is the PRIMARY reclamation strategy:
- "at each new prompt (turn_start), BEFORE capturing the new turn's snapshot, the store deletes every
  `refs/mulligan/snapshots/turn/*` ref ... and gc's the shadow repo."
- "git gc --auto --prune=now — self-throttling ... The CAS mark-sweep runs in the same pass."
- "a git gc or CAS mark-sweep failure is logged and NEVER blocks the turn" (fail-open, E27-ish).

And the `AsyncMutex` JSDoc (store.ts) explicitly says: *"the prompt-boundary GC pass ALSO acquires the
mutex, so a git gc / CAS mark-sweep can never overlap an in-flight capture/restore/retire straddling a
turn boundary."* — i.e. the GC pass is a MUTEX-ACQUIRING STORE OPERATION. The mutex lives INSIDE each
backend. Therefore the GC pass MUST be a store method.

CONCLUSION: this task (the GC owner) must ADD `gc(): Promise<void>` to the interface + implement it in
every backend (git.ts, cas.ts, NoOpStore). store.ts is appendable (P2.M1.T1.S2 already appended
detectAndCreate + NoOpStore to it — same precedent).

## Design decision: design (b) — `gc()` does the whole namespace pass

Two designs were considered:
- (a) handler iterates `rt.snapshots` turn/* entries, calls `retire(ref)` per ref, then triggers gc.
- (b) `store.gc()` does the WHOLE pass: namespace-delete all `turn/*` refs (git) / manifests (CAS) +
  physical reclaim (`git gc --auto --prune=now` / CAS blob mark-sweep). checkpoint/* exempt.

CHOSEN (b). Reasons:
- The in-memory `rt.snapshots` map only holds the CURRENT turn's entries; it does NOT enumerate prior
  turns' on-disk refs. Only a namespace scan (for-each-ref / readdir) can drop "all prior turns'" refs
  as the PRD requires. So the namespace delete MUST live in the backend (gc()).
- "one pass" (PRD) — cleaner to do namespace-delete + physical-reclaim in ONE mutex-held gc() than to
  scatter per-ref retire() calls + a separate gc().
- The handler becomes trivially backend-agnostic: `await rt.store.gc()` then clear in-memory turn/* keys.
- retire(ref) still exists for checkpoint revoke/consume (single-ref, SHA-resolved) — gc() is the bulk
  turn-namespace path. They are complementary, not redundant.

## git.ts ref structure (from grep of git.ts)

`refForLabel(label)`:
- `ckpt:<name>` → `refs/mulligan/snapshots/checkpoint/<name>` (GC-exempt namespace)
- else → `refs/mulligan/snapshots/turn/<label>`   (so "turn" → turn/turn, "turn-after" → turn/turn-after)

git.ts `capture(label)` returns a commit SHA, pins via `update-ref refForLabel(label) <sha>`.
git.ts `retire(ref=SHA)`: `for-each-ref --points-at <sha> --format=%(refname) refs/mulligan/snapshots/`
→ `update-ref -d <each refname>`. (SHA→refname two-step; robust to multi-label pinning.)

git.ts helpers reused by gc(): `this.exec(git, args, this.shadowEnv())`, `this.mutex.acquire()`,
`this.ensureInit()`. gc() = acquire → ensureInit → for-each-ref `refs/mulligan/snapshots/turn/`
--format=%(refname) → update-ref -d each → `git gc --auto --prune=now` → catch warn → finally release.

## cas.ts gc() (mark-sweep) — APPEND (P2.M3.T1.S3 is in flight, do NOT edit its 6 methods)

cas.ts (after P2.M3.T1.S3) has: `manifestPath(ref)`, `blobPath(hash)`, `this.fs` (readFile/writeFile/
mkdir/access/stat/readdir/unlink), `this.storageDir`, `this.mutex`. gc() =
- readdir `<storageDir>/manifests/` → for each manifest filename starting with a turn-namespace label
  (NOT `ckpt:`), unlink it. (Turn manifests = labels "turn" / "turn-after"; checkpoint manifests =
  "ckpt:<name>". The label IS the manifest filename / ref.)
- mark-sweep: collect the union of blob hashes referenced by ALL SURVIVING manifests (turn manifest to
  be captured next is not yet on disk, so surviving = active checkpoint manifests). readdir
  `<storageDir>/blobs/` → unlink any blob whose hash is in NO surviving manifest.
All under mutex, best-effort (warn + continue), never rejects. FAIL-OPEN per PRD (disk usage only).
COORDINATION: this is ADDITIVE (new method appended to the CasBackend class). P2.M3.T1.S3 edits the 6
existing methods in place, so an append does not conflict once P2.M3.T1.S3 is committed. PRP sequences
this task AFTER P2.M3.T1.S3 completes.

## The `rt.store` field dependency

`SessionRuntime` (runtime.ts) has `snapshots?: Map<string,RevertCheckpoint>` (P1.M2.T2.S2) but NO
`store?` field. The contract references `rt.store`. codebase_patterns.md §8 recommends storing the
handle on SessionRuntime; §6/§8 say the store is created in `session_start` (P3.M1.T2.S1's job).

DECISION: THIS task adds the minimal `store?: SnapshotStore` field to SessionRuntime (type-only import
from `./snapshot/store.js`, erased by tsc — keeps runtime.ts Pi-free). freshRuntime leaves it
`undefined` (optional). P3.M1.T2.S1 then ASSIGNS it (`rt.store = await detectAndCreate(...)` in the
session_start handler). The turn_start handler guards `if (!rt.store) return` so it no-ops cleanly
until T2.S1 wires the store. Clean split: S1/S2 read; T2.S1 creates+assigns.

## Module placement: NEW `src/capture.ts`

nudges.ts already holds bloatReminder + turnEndMetric hooks, but the snapshot-capture concern is
distinct (two hooks: turn_start S1, agent_end S2) + a shared GC helper consumed by T2.S1's
session_start. A NEW module `src/capture.ts` is cleaner than appending to the 38KB nudges.ts. It holds:
`gcTurnSnapshots(rt)` (shared), `turnStartCaptureHandler(event, ctx)`, `registerTurnStartCapture(pi)`.