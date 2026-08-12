---
name: "P2.M3.T1.S1 — CasBackend skeleton: CAS hash + blob store + manifest format (src/snapshot/cas.ts)"
description: "CREATE `src/snapshot/cas.ts` (NEW file) EXPORTING `class CasBackend implements SnapshotStore` as a SKELETON: a real sync `describe()` + the content-addressed **blob/manifest internals** (private/`@internal` `hashContent`/`storeBlob`/`readBlob`, the `blobPath`/`manifestPath` path helpers, and the exported `CasManifest`/`CasManifestEntry` types + pure `serializeManifest`/`parseManifest`) + per-instance `AsyncMutex`; the five IO-bearing interface methods (`capture`/`dirtyCheck`/`restore`/`has`/`retire`) are ASYNC THROWING STUBS implemented by S2 (capture) + S3 (dirtyCheck/restore/has/retire) — exactly the GitBackend S1→S2 split. Blob store layout `<storageDir>/blobs/<2-hex-prefix>/<sha256>` with content dedupe; manifests at `<storageDir>/manifests/<label>.json`. CREATE `test/cas.test.ts` (NEW) — vitest — asserting `hashContent` determinism, `storeBlob` dedupe (identical content writes the blob ONCE via a recording `fs` fake), and manifest JSON round-trip. [Mode A] JSDoc on `CasBackend` + every internal helper citing `@14-working-tree-revert.md §4` (§4.1 CAS, §4.3 path-safety/mutex/caps). cas.ts uses ONLY Node built-ins (`node:crypto`, `node:fs/promises`, `node:path`) + the existing `AsyncMutex`/`SnapshotStore` from `./store.js` + the `MulliganConfig` type — mirroring the sibling `git.ts` discipline."
---

## Goal

**Feature Goal**: Stand up the **content-addressed-store skeleton** for the v1.2 non-git snapshot backend in a single NEW module (`src/snapshot/cas.ts`): the `CasBackend implements SnapshotStore` class whose **blob store + manifest internals are real and unit-tested**, and whose five IO-bearing interface methods are throwing stubs that S2 (capture) and S3 (dirtyCheck/restore/has/retire) will fill in. This is the CAS twin of the GitBackend S1 task (P2.M2.T1.S1) — same split shape (internals + describe() real; capture/restore/... stubbed), different storage substrate (content-addressed files instead of a shadow git repo).

**Deliverable**: Two NEW files.
1. `src/snapshot/cas.ts` — exports `CasBackend implements SnapshotStore` (real `describe()` + the `@internal` blob/manifest helpers + the exported `CasManifest`/`CasManifestEntry` types + pure `serializeManifest`/`parseManifest`), a `CasBackendDeps`/`CasFs` DI-seam (default = real `node:fs/promises`), plus async throwing stubs for `capture`/`dirtyCheck`/`restore`/`has`/`retire` naming S2/S3. Constructs its own `AsyncMutex` (for S2/S3 to wrap their bodies). Uses only Node built-ins + `./store.js` + the `MulliganConfig` type.
2. `test/cas.test.ts` — vitest. `hashContent` determinism (same Buffer → same sha256 hex; distinct content → distinct hash), `storeBlob` dedupe (identical content → `writeFile` invoked exactly ONCE across two calls; the 2nd call short-circuits on `access()` success), manifest JSON round-trip (`serializeManifest`/`parseManifest` are inverse; `version:1` enforced; a non-1 version throws), and `describe()` returns `{ backend: "cas" }`.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`, strict + noImplicitAny) passes — proves `CasBackend implements SnapshotStore` (the **async** interface — the 5 IO methods return `Promise`), the DI-seam types resolve, and there are no unjustified `any`.
- `npm test` (`vitest run`) passes — the new `test/cas.test.ts` is green and EVERY existing suite stays green (zero cross-file impact: a brand-new module + test; `store.ts`'s `detectAndCreate` already dynamic-imports `./cas.js` and catches its absence → `NoOpStore`, so shipping `cas.ts` is purely additive).
- `cas.ts` exports exactly `{ CasBackend, CasManifest, CasManifestEntry, CasBackendDeps, CasFs, serializeManifest, parseManifest }` and the throwing-stub methods each name their owning subtask (`P2.M3.T1.S2` for capture; `P2.M3.T1.S3` for the other four).
- The blob store layout is exactly `<storageDir>/blobs/<2-hex-prefix>/<sha256>`; `storeBlob` is deduped (an existing blob path is never re-written); `readBlob(hash)` returns the stored bytes; `hashContent` is sha256 hex.
- The manifest type matches the work-item contract verbatim: `{ version:1, label, turnIndex, ts, files: Record<path,{hash,size,mtime,existed}> }`.
- `describe()` returns `{ backend: "cas" }` (SYNC — pure metadata, like GitBackend's `describe()`).
- [Mode A] JSDoc rides with the work: the `CasBackend` class + every internal helper + each exported type carries a JSDoc block citing `@14-working-tree-revert.md §4` (§4.1 CAS store, §4.3 path-safety + mutex + fail-closed caps) — matching the JSDoc density of the sibling `git.ts` / `paths.ts`.

## User Persona

**Target User**: Downstream implementation tasks that EXTEND this skeleton — S2 (`P2.M3.T1.S2`: `'cas'` mode whole-tree `capture()` with the mtime/size short-circuit) and S3 (`P2.M3.T1.S3`: `'explicit-paths'` capture + `dirtyCheck`/`restore`/`retire`/`has`). Also `detectAndCreate` (`store.ts`, P2.M1.T1.S2 — shipped), which dynamic-imports `./cas.js` and constructs `new mod.CasBackend(cwd, revertConfig, sessionDir)` for any non-git workspace.

**Use Case**: `detectAndCreate` (called once at `session_start` by `index.ts`, P3.M1.T2) runs `git rev-parse` → fails (no git) → resolves `storageDir`, `mkdir -p`, writability check → constructs `new CasBackend(cwd, revertConfig, sessionDir)`. Today that dynamic import rejects (module absent) → fail-open `NoOpStore` (`backend:"none"`). Landing `cas.ts` flips real **non-git** workspaces from `backend:"none"` to `backend:"cas"` — though capture/restore remain inert until S2/S3 land (the stubs throw; `detectAndCreate` is not wired into `index.ts` until P3.M1.T2, so no live code hits the stubs).

**Pain Points Addressed**: There is currently NO content-addressed snapshot backend — the universal non-git fallback promised by spec/14 §4 ("CAS is the universal fallback when there is no git") does not exist. This task provides its load-bearing foundation (hashing + blob store + dedupe + manifest format) so S2/S3 can build the two capture strategies and the restore/dirty-check semantics on top of a tested substrate.

## Why

- **Unblocks the CAS backend pipeline (S2 + S3).** S2's `capture()` walks the tree and, per file, calls `hashContent` → `storeBlob` (dedupe) and accumulates a `CasManifest`; S3's `dirtyCheck`/`restore` call `readBlob` + `serializeManifest`/`parseManifest`. Getting the blob-store + manifest format correct + tested HERE means S2/S3 are pure orchestration over a trusted substrate, not a re-implementation of the storage layer.
- **Follows the spec's placement tree verbatim.** spec/14 §2 line 73 + `architecture/system_context.md` both place `cas.ts` at `src/snapshot/cas.ts` ("CasBackend (content-addressed store) + the explicit-paths mode"). This task owns the skeleton + internals; S2 owns `capture`; S3 owns the rest. Splitting them keeps each PRP tightly scoped (capture is a whole-tree walk with the mtime short-circuit — substantial; restore is dirty-guard + per-file write-back — substantial).
- **Mirrors the proven GitBackend S1→S2 split.** `src/snapshot/git.ts` (P2.M2.T1.S1, shipped) shipped `init()` + `capture()` internals + throwing stubs, then S2 filled in dirtyCheck/restore/has/retire. The CAS split follows the identical discipline (internals + stubs first), so the pattern is already validated in this codebase.
- **Zero runtime risk / purely additive.** `cas.ts` is a brand-new module; `store.ts`'s `detectAndCreate` already dynamic-imports `./cas.js` with a non-literal specifier and catches its absence as `NoOpStore`. Shipping `cas.ts` cannot regress any existing file — and because the stubs throw (and `detectAndCreate` is unwired until P3.M1.T2), no live code path exercises them yet.

## What

A new module `src/snapshot/cas.ts` plus its unit test. Developer-invisible plumbing (no user-facing surface; no config/marker/runtime changes; no new tool/event).

1. `src/snapshot/cas.ts` — file-level header JSDoc (mirroring `git.ts`'s header: cites spec/14 §4 placement, §4.1 CAS store, §4.3 path-safety + mutex + caps, external_deps.md §2; the snapshot-subsystem DESIGN notes: Node-built-ins-only, the dedupe invariant, the manifest format, the S1/S2/S3 split, the consumer list).
2. `export interface CasManifestEntry { hash: string; size: number; mtime: number; existed: boolean; }` — the per-file record (verbatim from the work-item contract).
3. `export interface CasManifest { version: 1; label: string; turnIndex: number; ts: number; files: Record<string, CasManifestEntry>; }` — the manifest shape (verbatim).
4. `export function serializeManifest(m: CasManifest): string` + `export function parseManifest(json: string): CasManifest` — PURE JSON round-trip; `parseManifest` enforces `version === 1` (throws otherwise).
5. `export interface CasFs { readFile; writeFile; mkdir; access; stat }` + `export interface CasBackendDeps { fs?: CasFs }` — the DI test seam (default = real `node:fs/promises`).
6. `export class CasBackend implements SnapshotStore`:
   - **constructor** `(cwd, revertConfig, sessionDir?, deps?)`: stores inputs, resolves `storageDir` (mirror GitBackend's resolution — `revertConfig.storageDir ?? resolve(sessionDir, "mulligan")`, throw if neither), builds an `AsyncMutex`, binds the injected/default `fs`.
   - **`describe()` (SYNC)** → `{ backend: "cas" }`.
   - **`@internal` `async hashContent(content: Buffer): Promise<string>`** — `crypto.createHash("sha256").update(content).digest("hex")`.
   - **`@internal` `async storeBlob(content: Buffer): Promise<string>`** — hash → `blobPath(hash)` → `fs.access` exists? return hash (dedupe) : `mkdir -p` prefix dir + `writeFile` → return hash.
   - **`@internal` `async readBlob(hash: string): Promise<Buffer>`** — `fs.readFile(blobPath(hash))`.
   - **private `blobPath(hash)`** → `join(storageDir, "blobs", hash.slice(0,2), hash)`.
   - **private `manifestPath(label)`** → `join(storageDir, "manifests", `${label}.json`)`.
   - **async throwing stubs** `capture` (→ S2), `dirtyCheck`/`restore`/`has`/`retire` (→ S3).
7. `test/cas.test.ts` — vitest. `import { CasBackend, serializeManifest, parseManifest, type CasManifest } from "../src/snapshot/cas.js";`. `hashContent` determinism + distinctness, `storeBlob` dedupe via a recording `fs` fake, manifest round-trip + version guard, `describe()`, and a regression assertion that the 5 stubs throw naming their subtask.

### Success Criteria

- [ ] `src/snapshot/cas.ts` exists and exports `{ CasBackend, CasManifest, CasManifestEntry, CasBackendDeps, CasFs, serializeManifest, parseManifest }`.
- [ ] `CasBackend implements SnapshotStore` type-checks (the 5 IO methods are ASYNC `Promise`-returning; `describe()` is SYNC).
- [ ] `describe()` returns `{ backend: "cas" }` (no `reason` — healthy backend).
- [ ] `hashContent(Buffer.from("abc"))` is deterministic (identical across calls) AND distinct for distinct content; equals the known sha256 hex of the input.
- [ ] `storeBlob` writes to `join(storageDir, "blobs", hash.slice(0,2), hash)` and is **deduped**: a 2nd call with identical content does NOT call `writeFile` (the recording fake asserts `writeFile` was invoked exactly once; `access` short-circuits).
- [ ] `readBlob(hash)` returns the bytes that `storeBlob` wrote (round-trip via the fake, or a real temp dir).
- [ ] `serializeManifest`/`parseManifest` are exact inverses; `parseManifest` throws on `version !== 1`.
- [ ] The 5 IO stubs throw with a message containing their owning subtask id (`capture` → `P2.M3.T1.S2`; the other four → `P2.M3.T1.S3`).
- [ ] `cas.ts` imports ONLY: `node:crypto`, `node:fs/promises`, `node:path`, `./store.js` (AsyncMutex + types), and `type MulliganConfig` from `../config.js` — NO Pi, NO other project modules.
- [ ] [Mode A] JSDoc present on the class, every `@internal`/private helper, and every exported type — each citing `@14-working-tree-revert.md §4` (§4.1 for the blob/manifest store; §4.3 for path-safety/mutex/caps where relevant).
- [ ] `npm run typecheck` passes; `npm test` passes (new `test/cas.test.ts` green; all existing suites green).

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge": the implementing agent needs only `spec/14-working-tree-revert.md §4` (§4.1 CAS store + dedupe + storage-outside-cwd; §4.3 path-safety + AsyncMutex + fail-closed caps), `architecture/external_deps.md §2` (the exact blob/manifest path layout + the manifest JSON example), the sibling `src/snapshot/git.ts` (the EXACT class shape to mirror — header JSDoc density, `implements SnapshotStore`, async throwing stubs naming the subtask, per-instance `AsyncMutex`, `resolve(storageDir)` logic, exported DI `Deps` interface, `.js` imports, `node:` prefixes, `import type` for MulliganConfig), `src/snapshot/store.ts` (the async interface + the `detectAndCreate` 3-arg construction contract + `AsyncMutex.acquire()`), `test/git.test.ts` (the vitest idiom — recording fakes, flat `test/<x>.test.ts`, `.js` src import, `import type` config), and the verbatim manifest type from the work-item contract. Every helper signature, the path scheme, the dedupe algorithm, and the DI-seam shape are specified exactly below. No external/library research is needed — cas.ts uses only Node built-ins (`crypto`/`fs`/`path`) already proven in `git.ts`.

### Documentation & References

```yaml
# MUST READ — the normative spec for the CAS backend (this task's substrate)
- docfile: spec/14-working-tree-revert.md
  section: "### 4.1 \"cas\" (default — comprehensive, whole-tree)"
  why: "Source of truth for the CAS storage model: content keyed by hash, identical content stored once globally (dedupe), `{path → hash, existed}`, `capture()` returns the manifest ref. Storage strictly OUTSIDE cwd/.git. Steady-state O(changed-files) I/O (the mtime short-circuit is S2; S1 provides the hash+blob substrate it runs over)."
  critical: "Store content keyed by hash — identical content stored once globally (dedupe). This is the load-bearing invariant S1's storeBlob must enforce: an existing blob path is NEVER re-written. The 'Fast non-crypto hash (blake3/xxhash)' line is a FUTURE option — S1 uses sha256 (crypto, sync, already imported by git.ts) which is the safe, collision-resistant default; do NOT add a blake3/xxhash dependency (external_deps.md §4: 'No new npm deps')."

- docfile: spec/14-working-tree-revert.md
  section: "### 4.3 Cross-cutting implementation requirements"
  why: "Source of truth for the THREE cross-cutting contracts S1 must honor in JSDoc + structure: (1) path-safety (paths.ts — S1's manifest KEYS are posix-rel workspace paths, the same shape isDangerousWorkspaceRel guards; document it); (2) fail-closed large files (maxFileBytes — S2's capture skips+logs; S1 documents the cap exists); (3) AsyncMutex — 'a single mutex per store serializes ALL store operations (capture/dirtyCheck/restore/retire/gc)' → CasBackend constructs `new AsyncMutex()` in its constructor (S2/S3 wrap their bodies; S1's stubs throw before any work so they need not acquire it, but the FIELD must exist so S2/S3 find it)."
  critical: "The AsyncMutex is PER-STORE-INSTANCE (constructed in CasBackend's constructor), exactly like GitBackend. store.ts EXPORTS AsyncMutex; cas.ts IMPORTS + constructs it. S1 does not acquire it in the stubs (they throw immediately) but MUST construct the field so S2/S3's `await this.mutex.acquire()` resolves."

- docfile: spec/14-working-tree-revert.md
  section: "## 2. Architecture — the SnapshotStore"   # the interface cas.ts implements
  why: "The interface contract: describe() (SYNC) returns `{backend:"git"|"cas"|"none"; reason?}`; the 5 IO methods are ASYNC (Promise-returning). capture returns `Promise<string|null>` (null = caps exceeded / I/O error — the rewind proceeds without revert)."
  critical: "The interface is ASYNC (P2.M2.T1.S1 corrected the earlier sync draft — verified in src/snapshot/store.ts). CasBackend's stubs MUST be `async …: Promise<…>`. describe() is SYNC. `backend:"cas"` is one of the THREE describe() values; RevertCheckpoint.backend (markers.ts) is the TWO-valued `"git"|"cas"` — keep them distinct in JSDoc."

- docfile: spec/14-working-tree-revert.md
  section: "## 5. Capture lifecycle & retention"   # for capture()/retire()/has() stub JSDoc accuracy
  why: "Explains what a ref IS for CAS (a manifest ref), why retire() exists (drop a manifest so its blobs can be GC'd), and the turn/checkpoint namespaces (turn/* GC'd at prompt-boundary; checkpoint/* exempt). Makes the stub JSDoc truthful about what S2/S3 will do."
  critical: "S1 does NOT implement the ref scheme (that is S2's capture). S1 only documents the manifest STORAGE path (`manifests/<label>.json`) + provides the `manifestPath(label)` helper. The exact ref string capture returns (label vs manifest-content-hash) is S2's decision; S1 leaves clean room."

- docfile: plan/008_c36fd26768ae/architecture/external_deps.md
  section: "§2 Node.js fs APIs (the CAS backend) + the CAS manifest format JSON example"
  why: "Pins the EXACT storage layout + the manifest JSON shape. Blobs via `fs.promises.readFile`/`writeFile` + `crypto.createHash("sha256")`; manifests at `<storeDir>/manifests/<label>.json`. The JSON example is the verbatim manifest format the work-item contract reproduces."
  critical: "external_deps.md §2 shows blobs at `<storeDir>/<hash>` in ONE line, but the WORK-ITEM CONTRACT is more specific: `<storageDir>/blobs/<sha256-prefix>/<sha256>` (sharded by prefix, like git's object store). The work-item contract WINS — use `blobs/<2-hex-prefix>/<hash>`. The manifest JSON example (version/label/turnIndex/ts/files.{hash,size,mtime,existed}) is authoritative — reproduce the field names EXACTLY."

- docfile: plan/008_c36fd26768ae/architecture/external_deps.md
  section: "§4 TypeScript / Build Dependencies — No new npm dependencies, Node built-ins only"
  why: "Confirms cas.ts uses ONLY `crypto` + `fs.promises` + `path` (already used by git.ts). Do NOT add blake3/xxhash/fast-glob/etc."

# ── THE IMPLEMENTED CONTRACT this task consumes (read-only context; verify, don't assume) ──
- file: src/snapshot/store.ts
  why: "(a) the ASYNC SnapshotStore interface to `implements` (5 Promise methods + sync describe()); (b) `AsyncMutex` (constructed per-backend; `acquire(): Promise<() => void>`); (c) `detectAndCreate` (P2.M1.T1.S2) dynamic-imports `./cas.js` and does `new mod.CasBackend(cwd, revertConfig, sessionDir)` (3-arg) — so the constructor signature is `(cwd, revertConfig, sessionDir?, deps?)`; (d) `CasBackendCtor` (local cast, ~line 233) pins the 3-arg ctor shape; (e) `RestoreOpts`/`RestoreResult` (referenced by the restore/dirtyCheck stub signatures)."
  pattern: "`import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "./store.js";`. header JSDoc citing spec/14 §X + 'DESIGN' bullets + 'EXPORTED so …' footer (mirror this tone on CasBackend)."
  gotcha: "store.ts's `resolveStorageDir` is MODULE-PRIVATE — cas.ts CANNOT import it. Re-resolve storageDir inline (mirror git.ts's constructor block: `revertConfig.storageDir ? resolve(it) : sessionDir ? resolve(sessionDir,'mulligan') : throw`). detectAndCreate ALREADY ran resolveStorageDir + mkdir + W_OK before constructing CasBackend, so cas.ts's resolution is a re-validation (belt-and-suspenders) + gives the instance its `this.storageDir`."

- file: src/snapshot/git.ts   # THE SIBLING — the exact pattern to mirror (header JSDoc density, class shape, stubs)
  why: "The twin backend. Mirror: (1) the file-level header JSDoc structure (cite spec/14 §4 + external_deps §2 + 'DESIGN' bullets + 'EXPORTED so detectAndCreate …' footer); (2) `export class GitBackend implements SnapshotStore` → `export class CasBackend implements SnapshotStore`; (3) per-instance `private readonly mutex = new AsyncMutex();`; (4) the constructor's storageDir resolution block; (5) the exported DI `Deps` interface (git.ts: GitBackendDeps {exec?,scan?,unlink?}; cas.ts: CasBackendDeps {fs?}); (6) the ASYNC THROWING STUBS that name the owning subtask (`throw new Error("CasBackend.<m> not implemented — see P2.M3.T1.S2/S3")`); (7) `.js` import paths; `node:` prefixes; `import type { MulliganConfig }`."
  pattern: "git.ts's `async dirtyCheck(...) { throw new Error(\"GitBackend.dirtyCheck not implemented — see P2.M2.T1.S2\"); }` — cas.ts's capture stub says `see P2.M3.T1.S2`; the other four say `see P2.M3.T1.S3`. describe() is real + sync: `describe(): { backend: \"git\" } { return { backend: \"git\" }; }`."
  gotcha: "git.ts's `ensureInit()` does git rev-parse (repo-root keying). CasBackend has NO init I/O at construction — there is no 'shadow repo' to create; blob/manifest subdirs are created lazily by storeBlob (`mkdir -p` the prefix dir). So CasBackend has NO `init()` method and NO `ensureInit()`. Do not copy that machinery."

- file: src/snapshot/paths.ts
  why: "PURE path-safety helpers S2/S3 will consume on the walk (normalizeRelPath, isDangerousWorkspaceRel, resolveSafeWorkspacePath, DANGEROUS_DIRS). S1 does NOT import paths.ts (S1 does no walking + no path validation — it only hashes buffers + writes blobs). But S1 MUST document in the CasManifest JSDoc that manifest KEYS are workspace-relative POSIX paths (the same shape isDangerousWorkspaceRel guards) so S2/S3 know the contract."
  pattern: "manifest `files` keys = `normalizeRelPath(cwd, absPath)` outputs (forward-slash relative). Document this; do not import paths.ts in S1."

- file: src/config.ts
  why: "source of the `revertConfig` TYPE. `MulliganConfig["revert"]` is the 8-field block. Fields S1 reads: `storageDir: string | null` (drives storageDir resolution). Fields S2/S3 read (S1 only documents): `excludeGlobs`, `maxFileBytes`, `maxTotalBytes`, `maxSnapshotsPerTurn`, `nonGitMode`, `allowDeleteCreatedFiles`."
  pattern: "`import type { MulliganConfig } from "../config.js";` (type-only → erased, no cycle). There is NO exported `RevertConfig` name — index into `MulliganConfig["revert"]` (exactly as git.ts does)."

- file: test/git.test.ts   # THE TEST SIBLING — mirror the vitest idiom
  why: "The vitest pattern to mirror: `import { describe, it, expect } from "vitest";`, flat `test/cas.test.ts` location (NOT test/snapshot/), `../src/snapshot/cas.js` import with `.js`, a `BASE_CFG: MulliganConfig["revert"]` fixture, recording fakes (git.ts's `makeExec(calls)` → cas.ts's recording `CasFs` fake tracking `writeFile`/`access`/`mkdir` calls), a `findCmd`-style helper to assert on recorded calls, `import type` for config."
  pattern: "`describe(\"CasBackend.<area> — spec/14 §4.X\", () => { it(\"<behavior>\", async () => { … }); });`. No `beforeEach` (each test constructs its own CasBackend; the only state — mutex — is per-instance + unused by stubs). Header comment cites spec/14 §4.1/§4.3 + what's mocked (fs fake) vs real (crypto, AsyncMutex)."
  gotcha: "the dedupe test MUST use a RECORDING fs fake (track writeFile invocations) — it cannot assert dedupe against real fs (real writeFile would silently overwrite, hiding whether the 2nd call happened). The fake's `access` rejects on the 1st storeBlob (absent → write) and resolves on the 2nd (exists → dedupe)."

# CONTRACT from the parallel sibling (treat as shipped) — the OTHER backend whose parity S1 matches
- docfile: plan/008_c36fd26768ae/P2M2T1S1/PRP.md
  section: "Implementation Blueprint > the throwing-stub pattern + DI seam"
  why: "The GitBackend S1 established the split discipline this task mirrors: real describe() + real internals + throwing stubs naming the next subtask + a constructor DI seam with real defaults. Reading it confirms the shape; do NOT copy git-specific machinery (rev-parse, shadowEnv, ensureInit, refForLabel, scanForCaps) — cas.ts has none of those."
```

### Current Codebase tree (relevant slice — verified)

```
src/snapshot/
  store.ts        # P2.M1.T1.S1+S2 — DONE. ASYNC SnapshotStore interface + RestoreOpts + RestoreResult + AsyncMutex + NoOpStore + detectAndCreate (dynamic-imports ./cas.js → new CasBackend(cwd,revertConfig,sessionDir)).
  git.ts          # P2.M2.T1.S1 (+S2 in flight) — DONE/sibling. GitBackend: the twin backend — MIRROR its class shape, header JSDoc, DI seam, async stubs.
  paths.ts        # P1.M2.T1.S1 — DONE. Pure path helpers (S2/S3 consume; S1 does NOT import — documents the manifest-key contract only).
  cas.ts          # P2.M3.T1.S1 — ← THIS TASK CREATES (CasBackend skeleton: blob/manifest internals + describe() + throwing stubs).
src/config.ts     # P1.M1.T1.S1 — DONE. MulliganConfig["revert"] (8 fields; storageDir: string|null).
src/markers.ts    # P1.M2.T2.S1 — DONE. RevertCheckpoint { backend:"git"|"cas"; beforeRef; afterRef?; … } — the ref capture() returns becomes beforeRef/afterRef. Read-only context.
test/
  git.test.ts     # S1/S2 sibling test — MIRROR the vitest idiom (recording fakes, BASE_CFG, .js imports).
  store.test.ts   # DONE (S1+S2). DO NOT TOUCH (the async-interface type assertions + detectAndCreate NoOpStore tests).
  cas.test.ts     # ← THIS TASK CREATES.
spec/
  14-working-tree-revert.md   # §4.1 (CAS store), §4.3 (path-safety/mutex/caps), §2 (interface), §5 (capture lifecycle)
plan/008_c36fd26768ae/architecture/
  external_deps.md            # §2 (blob/manifest layout + JSON example), §4 (Node built-ins only — no new deps)
  system_context.md           # confirms placement: src/snapshot/cas.ts = "CasBackend (content-addressed store)"
```

### Desired Codebase tree (what changes)

```
src/snapshot/cas.ts   # NEW — CasBackend skeleton: describe() + hashContent/storeBlob/readBlob + blobPath/manifestPath
                      #        + CasManifest/CasManifestEntry + serializeManifest/parseManifest + CasBackendDeps/CasFs
                      #        + async throwing stubs (capture→S2, dirtyCheck/restore/has/retire→S3) + per-instance AsyncMutex.
test/cas.test.ts      # NEW — hashContent determinism, storeBlob dedupe (recording fs fake), manifest round-trip, describe(), stubs throw.
```
No edits to any existing file. No new dependencies. No config/marker/runtime changes.

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA #1 (CRITICAL) — the interface is ASYNC. store.ts (read in full) declares the 5 IO methods
// Promise-returning (P2.M2.T1.S1 corrected the earlier sync draft; test/store.test.ts asserts
// expectTypeOf<SnapshotStore["capture"]>().returns.toEqualTypeOf<Promise<string|null>>()). CasBackend's
// capture/dirtyCheck/restore/has/retire MUST be `async …: Promise<…>` (even the throwing stubs — a stub that
// returns `string` instead of `Promise<string>` fails `implements SnapshotStore`). describe() is SYNC. Do NOT
// "fix" anything to sync — the async interface is the settled contract.

// GOTCHA #2 (CRITICAL) — storeBlob DEDUPE is the load-bearing invariant (spec §4.1: "identical content stored
// once globally"). The algorithm: hash → blobPath(hash) → fs.access(EXISTS? return hash, NO write : mkdir+write).
// The test asserts writeFile is invoked exactly ONCE for two identical-content calls. A naive implementation that
// always writeFile's (no access short-circuit) would pass a content-equality test but FAIL the dedupe test. The
// recording fs fake's `access` MUST reject on the 1st call (blob absent) and resolve on the 2nd (blob present).

// GOTCHA #3 — `resolveStorageDir` is MODULE-PRIVATE in store.ts; cas.ts CANNOT import it. Re-resolve storageDir
// inline in the constructor, mirroring git.ts EXACTLY:
//   if (revertConfig.storageDir) this.storageDir = resolve(revertConfig.storageDir);
//   else if (sessionDir) this.storageDir = resolve(sessionDir, "mulligan");
//   else throw new Error("CasBackend: storageDir is null and no sessionDir provided");
// detectAndCreate ALREADY ran resolveStorageDir + mkdir + W_OK before constructing CasBackend (so storageDir is
// guaranteed writable when the ctor runs in production). The ctor's resolution is belt-and-suspenders + gives the
// instance its `this.storageDir` for blobPath/manifestPath. Do NOT re-validate containment here (store.ts did it).

// GOTCHA #4 — CasBackend has NO init()/ensureInit() (unlike GitBackend). There is no shadow repo to create; the
// storageDir root already exists (detectAndCreate mkdir'd it). blob/manifest SUBDIRECTORIES are created lazily by
// storeBlob (`mkdir -p <storageDir>/blobs/<prefix>`). Do NOT copy git.ts's ensureInit/initPromise/rev-parse machinery.

// GOTCHA #5 — the blob PREFIX is the first 2 HEX chars of the sha256 (git-style fanout of 256 dirs). The work-item
// contract says "<sha256-prefix>"; 2 chars is the standard (matches git's .git/objects/ab/cdef… layout). Use
// `hash.slice(0, 2)`. Do NOT use a longer prefix (over-sharding) or no prefix (flat dir — slow on large stores).

// GOTCHA #6 — hashContent returns Promise<string> even though crypto.createHash is SYNC. The work-item contract
// says "async hashContent(content: Buffer): string" and spec §4.1 flags "Fast non-crypto hash (blake3/xxhash)" as a
// FUTURE option (a native blake3 would be async/binding-based). Making it async NOW (trivially: `async … { return
// createHash("sha256").update(content).digest("hex"); }`) keeps the signature stable for that swap. Do NOT add a
// blake3/xxhash dependency (external_deps.md §4: no new npm deps).

// GOTCHA #7 — the manifest KEYS are workspace-relative POSIX paths (forward-slash), the output of paths.ts's
// normalizeRelPath (S2 will produce them on the walk). S1 does NOT import paths.ts (no walking, no validation), but
// the CasManifest JSDoc MUST state the key contract so S2/S3 know what to put in `files`. Document it; don't enforce it here.

// GOTCHA #8 — storeBlob/readBlob are NOT on the SnapshotStore interface. They are "@internal" instance helpers.
// TypeScript has no `internal` keyword, so to make them UNIT-TESTABLE (the work-item contract requires
// "hashContent determinism, storeBlob dedupe" unit tests that CALL them) they are declared as PUBLIC methods with a
// `@internal` JSDoc tag. This matches the work-item's "Internal: async storeBlob…" framing (internal = not part of
// the SnapshotStore contract, not access-restricted). Do NOT make them `private` (vitest cannot call private methods).
// serializeManifest/parseManifest are module-EXPORTED functions (pure) for the round-trip test.

// GOTCHA #9 — the DI `fs` seam default must bind the REAL node:fs/promises with the right signatures:
//   readFile(path): Promise<Buffer>  — NO encoding arg (returns Buffer)
//   writeFile(path, data: Buffer)    — Buffer in, void out
//   mkdir(path, {recursive:true})    — Promise<unknown> (fs.mkdir returns string|undefined; we ignore it)
//   access(path): Promise<void>      — rejects if absent (the dedupe gate)
//   stat(path): Promise<{size:number; mtimeMs:number}> — fs.Stats has both fields
// Define `CasFs` with EXACTLY these signatures; bind `realFs` at module load:
//   import { readFile, writeFile, mkdir, access, stat } from "node:fs/promises";
//   const realFs: CasFs = { readFile: (p)=>readFile(p), writeFile, mkdir, access, stat };
// (readFile wrapped to drop the default encoding so it returns Buffer; the others bind 1:1.)

// GOTCHA #10 — `import type { MulliganConfig }` (type-only — erased at runtime, no cycle with config.ts). Access the
// revert block as `MulliganConfig["revert"]` (there is NO exported `RevertConfig` name — exactly as git.ts does).
// Constructor param type: `revertConfig: MulliganConfig["revert"]`.

// GOTCHA #11 — ESM + tsc/rollup convention: source/test imports use the `.js` extension
// (`import { CasBackend } from "../src/snapshot/cas.js"` in the test). cas.ts itself imports `./store.js`,
// `../config.js` (type-only), and `node:` built-ins. tsconfig is `module:ESNext, moduleResolution:Bundler, strict,
// noImplicitAny` → no `any` without a justifying comment.

// GOTCHA #12 — describe() returns `{ backend: "cas" }` with NO `reason` (healthy backend — reason is populated only
// for "none"/degraded, e.g. NoOpStore). The 3-valued describe() union ("git"|"cas"|"none") is DISTINCT from
// RevertCheckpoint.backend (markers.ts: "git"|"cas" — 2-valued; a checkpoint exists ONLY when a real backend captured).
// Keep the two unions distinct in JSDoc (a CasBackend never reports "none"; NoOpStore never creates a checkpoint).

// GOTCHA #13 — the AsyncMutex FIELD must exist on CasBackend even though S1's stubs throw before acquiring it.
// S2's capture + S3's restore/dirtyCheck/retire will do `const release = await this.mutex.acquire(); try{…}finally{release();}`.
// Omitting the field would force S2/S3 to edit the constructor (breaking the "purely additive skeleton" contract).
// Construct it: `private readonly mutex = new AsyncMutex();` (exactly as git.ts).
```

## Implementation Blueprint

### Data models and structure

cas.ts defines TWO interfaces (the manifest), TWO pure functions (serialize/parse), TWO DI-seam interfaces, and ONE class. The manifest shape + the CasFs signatures are NORMATIVE (spec/14 §4.1 + external_deps.md §2 + the work-item contract) — reproduce EXACTLY (field names, types).

```ts
import { createHash } from "node:crypto";
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir as fsMkdir, access as fsAccess, stat as fsStat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "./store.js";
import type { MulliganConfig } from "../config.js";

// ── Manifest (spec/14 §4.1 + external_deps.md §2 + work-item contract; verbatim) ──
/** Per-file record in a CAS manifest. `existed` = the file was present in the working tree at capture
 *  (false ⇒ restore DELETES it to recreate the pre-span absence). spec/14 §4.1, external_deps.md §2. */
export interface CasManifestEntry {
  hash: string;     // sha256 hex of the file content (the blob key)
  size: number;     // file size in bytes (mtime/size short-circuit backstop — spec §4.1)
  mtime: number;    // stat.mtimeMs (the mtime/size short-circuit compares this — spec §4.1)
  existed: boolean; // was the file present at capture? (false ⇒ restore deletes; S3)
}

/** A CAS snapshot manifest. The `files` keys are workspace-relative POSIX paths (forward-slash) — the
 *  output of paths.ts `normalizeRelPath` (S2 produces them on the walk). Stored at
 *  `<storageDir>/manifests/<label>.json`. capture() (S2) returns a ref resolving to it. spec/14 §4.1. */
export interface CasManifest {
  version: 1;                                   // schema version (parseManifest enforces === 1)
  label: string;                                // the capture-namespace key ("turn"|"turn-after"|"ckpt:<name>")
  turnIndex: number;                            // the turn the snapshot brackets (S2 sets from ctx)
  ts: number;                                   // Date.now() at capture (S2 sets)
  files: Record<string, CasManifestEntry>;      // path → {hash,size,mtime,existed}
}

// ── Pure manifest (de)serialization (the round-trip test substrate; no fs) ──
/** Serialize a manifest to canonical JSON (stable key order via JSON.stringify of a plain object). PURE. */
export function serializeManifest(m: CasManifest): string {
  return JSON.stringify(m);
}
/** Parse + validate a manifest JSON string. Throws if `version !== 1`. PURE. */
export function parseManifest(json: string): CasManifest {
  const m = JSON.parse(json) as CasManifest;
  if (m.version !== 1) throw new Error(`unsupported CAS manifest version: ${m.version}`);
  return m;
}

// ── DI test seam (default = real node:fs/promises) ──
/** The fs surface CasBackend uses. Default binds node:fs/promises; tests inject a recording fake
 *  (notably to assert storeBlob DEDUPE — writeFile invoked once for identical content). */
export interface CasFs {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<void>;
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
  access(path: string): Promise<void>;            // rejects if absent (the dedupe gate)
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

/** Constructor DI seam (all optional; production omits → real impls). */
export interface CasBackendDeps {
  /** Default: real node:fs/promises (bound below). Tests inject a recording fake. */
  fs?: CasFs;
}

// module-private binding of the real fs (readFile wrapped to return Buffer — no encoding arg)
const realFs: CasFs = {
  readFile: (p) => fsReadFile(p),
  writeFile: fsWriteFile,
  mkdir: fsMkdir,
  access: fsAccess,
  stat: fsStat,
};

// ── CasBackend (spec/14 §4.1 + §4.3) ──
/**
 * CasBackend — the CONTENT-ADDRESSED-STORE snapshot backend (the universal non-git fallback).
 * spec/14 §4.1 (the CAS store + dedupe + storage-outside-cwd), §4.3 (path-safety + AsyncMutex + fail-closed
 * caps), architecture/external_deps.md §2 (blob/manifest layout + JSON example), §4 (Node built-ins only).
 *
 * S1 (THIS TASK) ships the BLOB/MANIFEST INTERNALS + describe(); the five IO-bearing SnapshotStore methods are
 * ASYNC THROWING STUBS — capture lands in P2.M3.T1.S2 (whole-tree walk + mtime/size short-circuit),
 * dirtyCheck/restore/has/retire land in P2.M3.T1.S3. Same split shape as GitBackend S1→S2 (src/snapshot/git.ts).
 *
 * EXPORTED so detectAndCreate (store.ts, P2.M1.T1.S2) dynamic-imports `./cas.js` and constructs
 * `new CasBackend(cwd, revertConfig, sessionDir)` for non-git workspaces — flipping them from backend "none"
 * (fail-open today) to backend "cas" once S2/S3 land, with ZERO edits to store.ts.
 */
export class CasBackend implements SnapshotStore {
  private readonly cwd: string;
  private readonly cfg: MulliganConfig["revert"];
  private readonly storageDir: string;
  private readonly sessionDir: string | null;
  private readonly mutex = new AsyncMutex();
  private readonly fs: CasFs;

  constructor(
    cwd: string,
    revertConfig: MulliganConfig["revert"],
    sessionDir?: string | null,
    deps?: CasBackendDeps,
  ) {
    this.cwd = resolve(cwd);
    this.cfg = revertConfig;
    this.sessionDir = sessionDir ?? null;
    // Re-resolve storageDir inline (store.ts's resolveStorageDir is module-private — cannot import).
    // detectAndCreate already mkdir'd + W_OK-checked it; this is belt-and-suspenders + the instance path source.
    if (revertConfig.storageDir) {
      this.storageDir = resolve(revertConfig.storageDir);
    } else if (sessionDir) {
      this.storageDir = resolve(sessionDir, "mulligan");
    } else {
      throw new Error("CasBackend: storageDir is null and no sessionDir provided");
    }
    this.fs = deps?.fs ?? realFs;
  }

  /** Report the active backend (SYNC metadata for logging / the rewind notice). */
  describe(): { backend: "cas" } {
    return { backend: "cas" };
  }

  /** @internal — sha256(content) hex. The blob key + the dedupe identity. spec/14 §4.1. */
  async hashContent(content: Buffer): Promise<string> {
    return createHash("sha256").update(content).digest("hex");
  }

  /** @internal — the blob path: `<storageDir>/blobs/<2-hex-prefix>/<hash>`. spec/14 §4.1 + external_deps §2. */
  private blobPath(hash: string): string {
    return join(this.storageDir, "blobs", hash.slice(0, 2), hash);
  }

  /** @internal — the manifest path: `<storageDir>/manifests/<label>.json`. external_deps §2. (S2 capture writes here.) */
  private manifestPath(label: string): string {
    return join(this.storageDir, "manifests", `${label}.json`);
  }

  /**
   * @internal — Store a content blob, DEDUPED. hash → blobPath → if the blob already exists (fs.access resolves),
   * return the hash WITHOUT re-writing (spec §4.1: "identical content stored once globally"). Else mkdir the prefix
   * dir (recursive) + write the blob. Returns the hash (the blob key). Never throws on the common path; an fs error
   * propagates (S2's capture wraps storeBlob in best-effort try/catch — E27).
   */
  async storeBlob(content: Buffer): Promise<string> {
    const hash = await this.hashContent(content);
    const p = this.blobPath(hash);
    try {
      await this.fs.access(p); // EXISTS → dedupe (no write)
      return hash;
    } catch {
      // absent → create the prefix dir + write the blob
      await this.fs.mkdir(dirname(p), { recursive: true });
      await this.fs.writeFile(p, content);
      return hash;
    }
  }

  /** @internal — Read a content blob by hash. Used by S3's restore (write the beforeRef content back). */
  async readBlob(hash: string): Promise<Buffer> {
    return this.fs.readFile(this.blobPath(hash));
  }

  // ── P2.M3.T1.S2 stub (capture) — NOT implemented here. ──
  // Throwing (not a silent no-op) so a premature caller fails loud. detectAndCreate is not wired into index.ts
  // until P3.M1.T2 (after S2/S3 land), so no live code hits this.
  async capture(_label: string): Promise<string | null> {
    throw new Error("CasBackend.capture not implemented — see P2.M3.T1.S2");
  }

  // ── P2.M3.T1.S3 stubs (dirtyCheck/restore/has/retire) — NOT implemented here. ──
  async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> {
    throw new Error("CasBackend.dirtyCheck not implemented — see P2.M3.T1.S3");
  }
  async restore(_beforeRef: string, _opts: RestoreOpts): Promise<RestoreResult> {
    throw new Error("CasBackend.restore not implemented — see P2.M3.T1.S3");
  }
  async has(_ref: string): Promise<boolean> {
    throw new Error("CasBackend.has not implemented — see P2.M3.T1.S3");
  }
  async retire(_ref: string): Promise<void> {
    throw new Error("CasBackend.retire not implemented — see P2.M3.T1.S3");
  }
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/snapshot/cas.ts — imports + module-private realFs binding
  - IMPORTS (top of file, node: prefixes, .js for project modules, import type for MulliganConfig):
      import { createHash } from "node:crypto";
      import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir as fsMkdir, access as fsAccess, stat as fsStat } from "node:fs/promises";
      import { join, resolve, dirname } from "node:path";
      import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "./store.js";
      import type { MulliganConfig } from "../config.js";
  - MODULE-PRIVATE `realFs: CasFs` binding (GOTCHA #9): readFile wrapped to drop the encoding (returns Buffer);
    writeFile/mkdir/access/stat bind 1:1.
  - FOLLOW pattern: src/snapshot/git.ts top-of-file imports (same node: prefixes, same .js + import type discipline).

Task 2: CREATE src/snapshot/cas.ts — file header JSDoc
  - WRITE a file-level header JSDoc (mirror git.ts's header structure). Cite: spec/14 §4.1 (CAS store + dedupe +
    storage-outside-cwd), §4.3 (path-safety + AsyncMutex + fail-closed caps), §2 (the async interface cas.ts
    implements), §5 (capture lifecycle — for the stub JSDoc); architecture/external_deps.md §2 (blob/manifest
    layout) + §4 (Node built-ins only). DESIGN bullets (mirror git.ts): "NODE-BUILT-INS-ONLY — imports node:crypto
    + node:fs/promises + node:path + the existing AsyncMutex/SnapshotStore from ./store.js + the MulliganConfig
    type (no Pi, no new deps)" / "CONTENT-DEDUPED BLOB STORE (spec §4.1): same content → same sha256 → same path →
    stored ONCE; storeBlob short-circuits on fs.access" / "MANIFEST FORMAT (external_deps §2): versioned JSON
    mapping posix-rel path → {hash,size,mtime,existed}; stored at manifests/<label>.json" / "S1 = SKELETON:
    describe() + blob/manifest internals are REAL; capture (S2) + dirtyCheck/restore/has/retire (S3) are throwing
    stubs — same split as GitBackend S1→S2" / "Consumers: detectAndCreate (store.ts) constructs it; S2/S3 extend it".
  - FOLLOW pattern: src/snapshot/git.ts header JSDoc (the `/** GitBackend — … */` block — same density, swap git→cas).

Task 3: CREATE src/snapshot/cas.ts — CasManifestEntry + CasManifest interfaces
  - WRITE the two interfaces EXACTLY as in "Data models" (verbatim field names/types from the work-item contract +
    external_deps.md §2). version is the LITERAL type `1` (not `number`) so parseManifest's `=== 1` is a type-level
    guarantee too.
  - JSDoc: CasManifestEntry cites spec/14 §4.1 + external_deps §2 + names the `existed` semantics (false ⇒ restore
    deletes). CasManifest cites spec/14 §4.1 + external_deps §2 + GOTCHA #7 (keys = workspace-relative POSIX paths,
    normalizeRelPath output — S2 produces them) + the storage path (manifests/<label>.json).
  - CRITICAL: the `files` value type is `CasManifestEntry` (the named interface), NOT an anonymous inline type — so
    S2/S3 can import + reference it.

Task 4: CREATE src/snapshot/cas.ts — serializeManifest + parseManifest (pure)
  - WRITE `export function serializeManifest(m): string { return JSON.stringify(m); }` and
    `export function parseManifest(json): CasManifest { const m = JSON.parse(json); if (m.version !== 1) throw …;
    return m; }`.
  - JSDoc: cite spec/14 §4.1 + external_deps §2; note PURE (no fs) so the round-trip test is a pure unit test.
    parseManifest's version guard is the forward-compat backstop (a future v2 manifest is rejected loudly, not
    silently mis-parsed).
  - GOTCHA: JSON.parse returns `any` → cast to `CasManifest` AFTER the version check (the check is the runtime
    validation that justifies the cast). strict + noImplicitAny are satisfied (the cast is explicit).

Task 5: CREATE src/snapshot/cas.ts — CasFs + CasBackendDeps DI-seam interfaces
  - WRITE `export interface CasFs { … }` with EXACTLY the 5 method signatures in "Data models" (GOTCHA #9).
  - WRITE `export interface CasBackendDeps { fs?: CasFs; }`.
  - JSDoc: CasFs cites the dedupe test rationale (GOTCHA #2 — the recording fake asserts writeFile-once). Mirror
    git.ts's GitBackendDeps JSDoc tone (default = real impls; tests inject fakes).

Task 6: CREATE src/snapshot/cas.ts — CasBackend class (constructor + describe + internals + stubs)
  - WRITE `export class CasBackend implements SnapshotStore` EXACTLY as in "Data models": private fields
    (cwd, cfg, storageDir, sessionDir, mutex, fs); constructor with the inline storageDir resolution (GOTCHA #3);
    sync `describe()`; `@internal` async hashContent/storeBlob/readBlob; private blobPath/manifestPath; async
    throwing stubs.
  - STOREBLOB (GOTCHA #2 — the load-bearing dedupe): `hash → blobPath → try fs.access(exists? return hash) catch
    { mkdir dirname + writeFile; return hash }`. The access-then-write ordering is what makes dedupe mechanical.
  - STUBS (GOTCHA #1 — async): capture throws "see P2.M3.T1.S2"; dirtyCheck/restore/has/retire throw "see
    P2.M3.T1.S3". Mirror git.ts's stub tone verbatim (swap the subtask id).
  - MUTEX FIELD (GOTCHA #13): `private readonly mutex = new AsyncMutex();` — present even though stubs don't acquire
    it (S2/S3 will). Do NOT acquire the mutex in the stubs (they throw before any work).
  - FOLLOW pattern: src/snapshot/git.ts class (same field order, same constructor DI-seam binding
    `this.fs = deps?.fs ?? realFs`, same JSDoc density on describe/internals/stubs).
  - JSDoc: class cites spec/14 §4.1 + §4.3 + external_deps §2/§4 + the S1/S2/S3 split + the "EXPORTED so detectAndCreate
    dynamic-imports ./cas.js" footer. Each @internal helper cites §4.1. blobPath/manifestPath cite external_deps §2.

Task 7: CREATE test/cas.test.ts — vitest setup + hashContent determinism
  - IMPORTS (house style — mirror test/git.test.ts):
      import { describe, it, expect } from "vitest";
      import { createHash } from "node:crypto";
      import { CasBackend, serializeManifest, parseManifest, type CasManifest, type CasFs } from "../src/snapshot/cas.js";
      import type { MulliganConfig } from "../src/config.js";
  - File header comment (mirror test/git.test.ts): cite spec/14 §4.1 (CAS store + dedupe), §4.3 (mutex — present,
    unused by stubs); what's mocked (fs via DI fake for the dedupe test; crypto is REAL) vs real (AsyncMutex —
    unused by stubs but present); P2.M3.T1.S1 scope (skeleton: describe + internals real; stubs throw → S2/S3).
  - BASE_CFG fixture (mirror test/git.test.ts BASE_CFG): a canonical valid MulliganConfig["revert"] with storageDir
    set (e.g. "/fake/store") so the constructor resolves storageDir without a sessionDir.
  - describe("CasBackend.hashContent — spec/14 §4.1 (sha256 dedupe identity)"):
      (a) it("is deterministic: same Buffer → same hex"): hashContent(Buffer.from("hello")) === hashContent(Buffer.from("hello")).
      (b) it("equals the known sha256 of the input"): hashContent(Buffer.from("abc")) ===
          createHash("sha256").update(Buffer.from("abc")).digest("hex") (cross-check against node:crypto directly).
      (c) it("is distinct for distinct content"): hashContent(Buffer.from("a")) !== hashContent(Buffer.from("b")).
      (d) it("the hex is 64 chars (sha256)")": result.length === 64 && /^[0-9a-f]{64}$/.test(result).
  - HELPER: a `makeBackend(fs?)` that constructs `new CasBackend("/fake/cwd", BASE_CFG, null, fs ? { fs } : undefined)`.

Task 8: CREATE test/cas.test.ts — storeBlob dedupe (the marquee test, via a recording fs fake)
  - ADD describe("CasBackend.storeBlob — spec/14 §4.1 dedupe (identical content stored ONCE)"):
      - BUILD a recording CasFs fake: tracks `writeFile` calls (path+data) + `access` calls + `mkdir` calls. Its
        `access(path)` rejects on a path NOT YET written (simulating absent) and resolves on a path already written
        (simulating present — the dedupe hit). Maintain a `Set<string> written` the fake mutates.
          const written = new Set<string>();
          const calls = { writeFile: [] as string[], access: [] as string[], mkdir: [] as string[] };
          const fakeFs: CasFs = {
            access: async (p) => { calls.access.push(p); if (!written.has(p)) throw new Error("ENOENT"); },
            mkdir: async (p) => { calls.mkdir.push(p); },
            writeFile: async (p, data) => { calls.writeFile.push(p); written.add(p); },
            readFile: async (p) => Buffer.from(""),
            stat: async () => ({ size: 0, mtimeMs: 0 }),
          };
      - (a) it("storeBlob writes the blob on the FIRST call and returns the sha256"): const h1 = await storeBlob(content);
            expect(h1).toBe(knownSha256); expect(calls.writeFile).toHaveLength(1); expect(calls.access).toHaveLength(1);
            the written path === join(storageDir,"blobs",h1.slice(0,2),h1).
      - (b) it("storeBlob DEDUPES: a 2nd call with identical content does NOT re-write (access short-circuits)"):
            const h2 = await storeBlob(content); expect(h2).toBe(h1); expect(calls.writeFile).toHaveLength(1)
            (STILL 1 — the 2nd access resolved → no write); expect(calls.access).toHaveLength(2).
      - (c) it("storeBlob writes DIFFERENT content to a DIFFERENT path"): const h3 = await storeBlob(otherContent);
            expect(h3).not.toBe(h1); expect(calls.writeFile).toHaveLength(2); the 2nd written path uses h3.slice(0,2)/h3.
      - (d) it("storeBlob creates the 2-hex-prefix blob path layout"): the written path matches
            /\/blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/.
  - GOTCHA: the fake's `access` MUST reject on the 1st call (blob absent → triggers write) and resolve on the 2nd
    (blob present → dedupe). A fake that always resolves would make the 1st storeBlob skip the write (test (a) fails);
    one that always rejects would make the 2nd re-write (test (b) fails). The `written` Set is the state that flips it.

Task 9: CREATE test/cas.test.ts — readBlob round-trip + manifest round-trip + version guard
  - ADD describe("CasBackend.readBlob — round-trips storeBlob"):
      - use a recording fake whose `readFile` returns the bytes last written to that path (a Map<path,Buffer>).
      - it("readBlob(hash) returns the bytes storeBlob wrote"): write content → hash; readBlob(hash) deep-equals content.
  - ADD describe("serializeManifest / parseManifest — spec/14 §4.1 round-trip (pure)"):
      - a fixture manifest: { version:1, label:"turn", turnIndex:3, ts:1700000000000,
        files:{ "src/foo.ts": {hash:"abc…",size:1024,mtime:1700000000000,existed:true} } }.
      - (a) it("serializeManifest ∘ parseManifest is the identity"): deepEqual(parseManifest(serializeManifest(fix)), fix).
      - (b) it("parseManifest throws on version !== 1"): expect(() => parseManifest(JSON.stringify({...fix, version:2})))
            .toThrow(/version/).
      - (c) it("serializeManifest produces parseable JSON with all 5 top-level keys"): const j = JSON.parse(serializeManifest(fix));
            expect(Object.keys(j).sort()).toEqual(["files","label","turnIndex","ts","version"]).

Task 10: CREATE test/cas.test.ts — describe() + stubs throw (scope guard)
  - ADD describe("CasBackend.describe()"):
      - it("returns { backend: 'cas' } (sync metadata, no reason)")": const gb = makeBackend();
        expect(gb.describe()).toEqual({ backend: "cas" }).
  - ADD describe("CasBackend — S2/S3 stubs throw"):
      - it("capture throws 'see P2.M3.T1.S2'"): await expect(gb.capture("turn")).rejects.toThrow(/P2\.M3\.T1\.S2/).
      - it("dirtyCheck/restore/has/retire throw 'see P2.M3.T1.S3'"): await expect(gb.dirtyCheck("r",[])).rejects.toThrow(/P2\.M3\.T1\.S3/);
        (+ restore/has/retire — 4 assertions). Mirror test/git.test.ts's "S2 stubs throw" block (swap subtask ids).
  - FOLLOW pattern: test/git.test.ts "S2 stubs throw" + "describe()" blocks.

Task 11: VALIDATE (see Validation Loop) — typecheck, the cas.test.ts run, full suite.
```

### Implementation Patterns & Key Details

```ts
// CRITICAL — the storeBlob DEDUPE algorithm (the load-bearing invariant — GOTCHA #2). The access-then-write
// ordering is what makes "identical content stored once" mechanical: an existing blob path never reaches writeFile.
async storeBlob(content: Buffer): Promise<string> {
  const hash = await this.hashContent(content);     // sha256 hex — the dedupe identity
  const p = this.blobPath(hash);                    // <storageDir>/blobs/<2-hex>/<hash>
  try {
    await this.fs.access(p);                        // EXISTS → dedupe (NO write)
    return hash;
  } catch {
    await this.fs.mkdir(dirname(p), { recursive: true }); // create <storageDir>/blobs/<2-hex>/ (idempotent)
    await this.fs.writeFile(p, content);            // write the blob ONCE
    return hash;
  }
}
// WHY access-then-write (not stat-then-write): fs.access is the minimal "does it exist" probe (no stat payload);
// it rejects on absent, which the catch turns into the write branch. A stat-based check would work too but access
// is the lighter syscall + matches the CasFs seam shape. The dedupe TEST asserts writeFile is called exactly once
// across two identical-content calls — which only holds if the 2nd access resolves (short-circuit).

// CRITICAL — the manifest KEYS contract (GOTCHA #7). The CasManifest.files keys are workspace-relative POSIX paths
// (forward-slash), the output of paths.ts normalizeRelPath (S2 produces them on the walk). S1 does NOT import
// paths.ts (no walking) but the CasManifest JSDoc MUST state this so S2/S3 know the key shape. Example key:
//   "src/foo.ts"  (NOT "src\foo.ts", NOT "/abs/src/foo.ts", NOT "./src/foo.ts")

// PATTERN — the DI fs fake for the dedupe test (the recording surface). The `written` Set is the state that flips
// access reject→resolve, simulating the real fs's existence semantics WITHOUT touching disk:
const written = new Set<string>();
const fakeFs: CasFs = {
  access: async (p) => { if (!written.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
  mkdir: async () => {},
  writeFile: async (p, data) => { written.add(p); },
  readFile: async (p) => Buffer.from(""),
  stat: async () => ({ size: 0, mtimeMs: 0 }),
};

// PATTERN — the async throwing stubs (GOTCHA #1). They MUST be `async …: Promise<…>` (the interface is async).
// capture names S2; the other four name S3. Throwing (not silent) so a premature caller fails loud.
async capture(_label: string): Promise<string | null> {
  throw new Error("CasBackend.capture not implemented — see P2.M3.T1.S2");
}

// NOTE on the mutex field (GOTCHA #13): S1 constructs `new AsyncMutex()` but the stubs throw before acquiring it.
// S2/S3 will wrap their bodies: `const release = await this.mutex.acquire(); try { … } finally { release(); }`.
// The field is present so S2/S3 find it without editing the constructor (purely-additive skeleton contract).
```

### Integration Points

```yaml
CONSUMERS (downstream — satisfy the contract, do NOT implement here):
  - detectAndCreate (store.ts, P2.M1.T1.S2 — shipped): dynamic-imports ./cas.js; constructs
    `new mod.CasBackend(cwd, revertConfig, sessionDir)`. After cas.ts lands, real non-git workspaces return
    backend "cas" instead of fail-open "none" — with ZERO further store.ts edits (the forward-compat dynamic import
    already points here). NOTE: capture/restore remain inert (stubs) until S2/S3; detectAndCreate is unwired until
    P3.M1.T2, so no live caller hits the stubs.
  - S2 (P2.M3.T1.S2 — 'cas' mode capture): walks the tree → per file hashContent → storeBlob (dedupe) → builds a
    CasManifest → serializeManifest → writes manifests/<label>.json (via the fs seam). MUST agree on manifestPath's
    label→path scheme + the manifest type S1 exports.
  - S3 (P2.M3.T1.S3 — explicit-paths capture + dirtyCheck/restore/has/retire): restore reads manifests/<ref>.json →
    parseManifest → per file readBlob(hash) → write working tree. dirtyCheck compares current-content hash to the
    after-manifest hash (hash equality). retire deletes the manifest. has checks manifest existence. MUST agree on
    readBlob + parseManifest + manifestPath.

PRODUCES (upstream deps — ship LATER, this task stubs them):
  - P2.M3.T1.S2: capture() — the 'cas' whole-tree walk + mtime/size short-circuit (reuse stored hash when stat
    (mtime,size) matches the previous manifest). Sets CasManifest.turnIndex/ts. Decides the ref string capture
    returns (label vs manifest-content-hash) — S1 leaves this clean room (manifestPath helper provided).
  - P2.M3.T1.S3: dirtyCheck/restore/has/retire + the 'explicit-paths' capture variant.

CONFIG: no config.ts changes. The constructor READS revertConfig.storageDir (resolution). S2/S3 read the other
  fields (excludeGlobs, maxFileBytes, maxTotalBytes, maxSnapshotsPerTurn, nonGitMode, allowDeleteCreatedFiles).
  storageDir===null + no sessionDir → constructor throws (detectAndCreate guarantees storageDir is resolved +
  writable before constructing in production; the throw is the belt-and-suspenders guard).

NO DATABASE / NO ROUTES / NO NEW DEPS. Node built-ins only (crypto, fs/promises, path) + the existing AsyncMutex +
  types from ./store.js + the MulliganConfig type. (architecture/external_deps.md §4.)
NO MARKERS/RUNTIME CHANGES: RevertCheckpoint (markers.ts, COMPLETE) is an INPUT cas.ts is informed by (the ref
  capture returns becomes beforeRef/afterRef); cas.ts does NOT import or edit it.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# TypeScript (strict + noImplicitAny) is the compiler. (NO ruff/mypy/eslint/uv — this is a TS project.)
npm run typecheck        # = tsc --noEmit
# Expected: zero errors. This is the PRIMARY gate — proves:
#   - "CasBackend" incorrectly implements "SnapshotStore" → a method signature mismatch (async vs sync, or a
#     missing method). If seen, re-check all 6 methods are present + async (GOTCHA #1) + describe() sync.
#   - the DI-seam CasFs signatures match the realFs binding (readFile→Buffer, etc.).
#   - no unjustified `any` (the parseManifest `JSON.parse(json) as CasManifest` cast is the one sanctioned cast).
# If errors: READ tsc output. Likely causes: a sync stub signature, a wrong CasFs field, or a missing import.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the new test file in isolation first (fast feedback on hashContent/storeBlob/manifest):
npx vitest run test/cas.test.ts
# Expected: all green. Pay special attention to:
#   - "storeBlob DEDUPES: a 2nd call with identical content does NOT re-write" (the marquee test — if this FAILS,
#     storeBlob is not short-circuiting on access; re-check the algorithm per "Implementation Patterns").
#   - "storeBlob writes the blob on the FIRST call" (if this FAILS, the fake's access is resolving on the 1st call
#     — re-check the `written` Set flips reject→resolve correctly).
#   - "parseManifest throws on version !== 1" (forward-compat guard).

# Then the full suite (proves zero cross-file regression — cas.ts is brand-new + detectAndCreate already catches
# its absence as NoOpStore, so shipping it is purely additive):
npm test
# Expected: all green (new test/cas.test.ts + every existing suite, incl. test/git.test.ts + test/store.test.ts).
```

### Level 3: Integration Testing (System Validation)

This task's substrate is pure-ish (hash + fs + JSON) with no service/DB/subprocess. The integration proof is that
(a) `detectAndCreate` resolves `./cas.js` to a real CasBackend (no longer NoOpStore) for a non-git workspace, and
(b) the blob/manifest round-trip works against REAL fs. Lightweight manual confirmations:

```bash
# (a) Confirm the exports are present + named exactly:
grep -nE "^export (interface CasManifestEntry|interface CasManifest|interface CasFs|interface CasBackendDeps|function serializeManifest|function parseManifest|class CasBackend)" src/snapshot/cas.ts
# Expected: 7 matches (one per export).

# (b) Confirm cas.ts imports ONLY the sanctioned modules (GOTCHA — Node built-ins + ./store.js + ../config.js type):
grep -nE '^import' src/snapshot/cas.ts
# Expected: 5 lines: node:crypto, node:fs/promises, node:path, ./store.js, ../config.js (type-only). NO Pi, NO other.

# (c) Confirm the stubs are async + name their subtask:
grep -nE "see P2\.M3\.T1\.(S2|S3)" src/snapshot/cas.ts
# Expected: 5 matches (capture→S2; dirtyCheck/restore/has/retire→S3).

# (d) Real-fs blob round-trip smoke (proves storeBlob/readBlob work against the actual node:fs/promises, not just
# the fake — catches a default-binding mismatch the unit tests with an injected fake would miss):
node --input-type=module -e '
  import { mkdtemp, rm } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path";
  import { createHash } from "node:crypto";
  const { CasBackend } = await import("./src/snapshot/cas.ts");
  const dir = await mkdtemp(join(tmpdir(), "cas-"));
  const cfg = { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:"cas", storageDir: dir,
    maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64, excludeGlobs:["node_modules"] };
  const cb = new CasBackend("/fake/cwd", cfg, null);   // NO deps.fs → uses realFs
  const content = Buffer.from("hello cas");
  const h1 = await cb.storeBlob(content);
  const h2 = await cb.storeBlob(content);              // dedupe — should NOT re-write
  console.log("hashes equal (dedupe identity):", h1 === h2, h1);
  const back = await cb.readBlob(h1);
  console.log("readBlob round-trips content:", back.equals(content));
  const { readdir } = await import("node:fs/promises");
  const prefixDir = (await readdir(join(dir, "blobs")))[0];
  const blobsInPrefix = await readdir(join(dir, "blobs", prefixDir));
  console.log("exactly one blob in prefix dir (dedupe on real fs):", blobsInPrefix.length === 1, blobsInPrefix);
  await rm(dir, { recursive: true, force: true });
' 2>&1 | tail -5
# Expected: "hashes equal: true <64-hex>"; "readBlob round-trips content: true";
#           "exactly one blob in prefix dir (dedupe on real fs): true ['<64-hex>']".
# If "exactly one blob" is false, storeBlob is not deduping on real fs (re-check the access short-circuit).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Dedupe invariant stress — store the SAME content N times; assert the blob is written ONCE + readBlob always works.
node --input-type=module -e '
  import { mkdtemp, rm, readdir } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path";
  const { CasBackend } = await import("./src/snapshot/cas.ts");
  const dir = await mkdtemp(join(tmpdir(), "cas-"));
  const cfg = { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:"cas", storageDir: dir,
    maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64, excludeGlobs:["node_modules"] };
  const cb = new CasBackend("/fake/cwd", cfg, null);
  const content = Buffer.from("dedupe-me".repeat(100));
  let prev = null;
  for (let i = 0; i < 25; i++) { const h = await cb.storeBlob(content); if (prev !== null && h !== prev) throw new Error("hash drifted!"); prev = h; }
  const count = (await import("node:fs/promises")).readdir;
  const prefix = (await readdir(join(dir,"blobs")))[0];
  const n = (await readdir(join(dir,"blobs",prefix))).length;
  console.log("25 stores of identical content →", n, "blob(s) on disk (dedupe holds):", n === 1);
  console.log("2 distinct contents → 2 blobs:");
  await cb.storeBlob(Buffer.from("other"));
  const n2 = (await readdir(join(dir,"blobs", (await readdir(join(dir,"blobs")))[0]))).length + (await readdir(join(dir,"blobs", (await readdir(join(dir,"blobs"))).find(p=>p!==prefix)))).length;
  await rm(dir, { recursive:true, force:true });
' 2>&1 | tail -3
# Expected: "25 stores … 1 blob(s) on disk (dedupe holds): true". (This is the spec §4.1 "stored once globally"
# invariant made mechanical + verified end-to-end on real fs — the unit-test fake proves the code path; this
# proves the real-fs default binding agrees.)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` passes (zero errors — incl. `CasBackend implements SnapshotStore`, the async interface).
- [ ] `npm test` passes (new test/cas.test.ts green; all existing suites green — incl. test/git.test.ts, test/store.test.ts).
- [ ] Level 3 (b): `grep -nE '^import' src/snapshot/cas.ts` → exactly 5 sanctioned lines (node:crypto, node:fs/promises, node:path, ./store.js, ../config.js type-only).
- [ ] Level 3 (c): the 5 stubs each name their subtask (capture→S2; the other four→S3).
- [ ] Level 3 (d) + Level 4: real-fs blob round-trip + dedupe hold (25 stores → 1 blob on disk).

### Feature Validation
- [ ] `describe()` returns `{ backend: "cas" }` (SYNC; no `reason`).
- [ ] `hashContent` is deterministic, equals node:crypto's sha256, distinct for distinct content, 64-hex.
- [ ] `storeBlob` writes to `<storageDir>/blobs/<2-hex-prefix>/<hash>` and is **deduped** (identical content → writeFile invoked ONCE; access short-circuits the 2nd call).
- [ ] `readBlob(hash)` returns the bytes `storeBlob` wrote.
- [ ] `serializeManifest`/`parseManifest` are exact inverses; `parseManifest` throws on `version !== 1`.
- [ ] `CasManifest`/`CasManifestEntry` field names match the work-item contract + external_deps.md §2 verbatim.
- [ ] The 5 IO stubs throw with a message containing their owning subtask id.
- [ ] The per-instance `AsyncMutex` field exists (for S2/S3) even though S1's stubs don't acquire it.

### Code Quality Validation
- [ ] Header JSDoc mirrors git.ts density (spec/14 §4.1/§4.3/§2/§5 + external_deps §2/§4; DESIGN bullets; EXPORTED footer).
- [ ] `.js` import paths; `import type` for MulliganConfig; `node:` prefixes on all built-ins; no unjustified `any`.
- [ ] DI seam (`deps.fs`) is OPTIONAL with a real default (`realFs`) — production construction (detectAndCreate) omits it.
- [ ] `@internal` JSDoc tag on hashContent/storeBlob/readBlob (they are public-for-testing, not SnapshotStore surface).
- [ ] Test file mirrors test/git.test.ts (vitest describe/it/expect, flat test/cas.test.ts, ../src/snapshot/cas.js import with `.js`, BASE_CFG fixture, recording fake).
- [ ] No new files beyond `src/snapshot/cas.ts` + `test/cas.test.ts`; no dependency/config/marker/runtime changes.

### Scope Guardrails (did NOT over-reach)
- [ ] Did NOT implement `capture()` (P2.M3.T1.S2 — whole-tree walk + mtime short-circuit).
- [ ] Did NOT implement `dirtyCheck`/`restore`/`has`/`retire` (P2.M3.T1.S3).
- [ ] Did NOT add `init()`/`ensureInit()` (CasBackend has no shadow repo; blob/manifest subdirs created lazily by storeBlob).
- [ ] Did NOT import `paths.ts` (S1 does no walking/path-validation; S2/S3 consume paths.ts — S1 only documents the manifest-key contract).
- [ ] Did NOT add a blake3/xxhash dependency (sha256 is the safe default; blake3 is a future option — external_deps §4: no new deps).
- [ ] Did NOT commit to the capture() ref scheme (label vs manifest-content-hash — S2's decision; S1 leaves clean room + provides manifestPath).
- [ ] Did NOT edit store.ts / git.ts / any existing file (purely additive: one new module + one new test).

### Documentation & Deployment
- [ ] [Mode A] JSDoc on `CasBackend` class + hashContent/storeBlob/readBlob + blobPath/manifestPath + each exported type, citing `@14-working-tree-revert.md §4` (§4.1 for blob/manifest; §4.3 for mutex/path-safety) — rides WITH the work.
- [ ] The throwing-stub messages name P2.M3.T1.S2 (capture) / P2.M3.T1.S3 (the rest) so the next implementer finds this file.

---

## Anti-Patterns to Avoid

- ❌ Don't make the stubs SYNC — the interface is async (store.ts verifies it); a sync stub fails `implements SnapshotStore`.
- ❌ Don't make hashContent/storeBlob/readBlob `private` — the work-item contract requires UNIT TESTS that call them directly (TypeScript has no `internal`; use public + `@internal` JSDoc).
- ❌ Don't skip the `fs.access` short-circuit in storeBlob — that is the dedupe mechanism; without it, identical content re-writes (the marquee test fails).
- ❌ Don't import `resolveStorageDir` from store.ts — it is module-private; re-resolve storageDir inline (mirror git.ts's constructor block).
- ❌ Don't copy git.ts's `ensureInit`/`init`/`shadowEnv`/`refForLabel`/`scanForCaps` — CasBackend has none of that machinery (no git, no shadow repo, no rev-parse).
- ❌ Don't add blake3/xxhash/fast-glob — sha256 + node:fs/promises readdir (in S2) are the sanctioned Node built-ins.
- ❌ Don't touch store.ts / git.ts / paths.ts / config.ts / markers.ts — this task is purely additive (one new module + one new test).
- ❌ Don't acquire the mutex in the S1 stubs — they throw before any work; the FIELD exists for S2/S3.
- ❌ Don't use a blob path without the 2-hex prefix (flat `<storageDir>/blobs/<hash>` is slow on large stores; the prefix shards them like git's object store).

---

**Confidence Score: 9/10** — the sibling GitBackend (git.ts, shipped) is the exact pattern to mirror (class shape, header JSDoc, DI seam, async throwing stubs); the async SnapshotStore interface is verified in store.ts (read in full); the manifest type + blob layout are verbatim from the work-item contract + external_deps.md §2; the storeBlob dedupe algorithm is fully specified + tested via a recording fs fake AND verified on real fs (Level 3/4). The -1 is for the one genuine forward-decision S1 defers (the capture() ref scheme — label vs manifest-content-hash), which is correctly scoped to S2 (S1 provides manifestPath + leaves clean room, so S2 is unblocked either way).