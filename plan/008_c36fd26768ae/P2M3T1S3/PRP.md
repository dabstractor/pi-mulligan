# PRP — P2.M3.T1.S3: CAS `explicit-paths` mode + `dirtyCheck` + `restore` + `retire` + `has`

**Spec refs**: spec/14-working-tree-revert.md §4.2 (`"explicit-paths"` conservative mode — the
pi-undo-redo model), §4.3 (AsyncMutex + path safety + caps + backend parity), §2 (the
`SnapshotStore` interface), §6 (restore semantics — refuse-on-dirty then restore), §5 (retention —
retire/GC). architecture/external_deps.md §2 (CAS `unlink` for deleteCreatedFiles + manifest format).
JSDoc cites `@14 §4.2/§4.3/§6` on the new methods (work-item DOCS clause).

---

## Goal

**Feature Goal**: Complete `CasBackend` (src/snapshot/cas.ts) by implementing the remaining 4
`SnapshotStore` methods (`dirtyCheck`/`restore`/`has`/`retire`) AND adding the conservative
`"explicit-paths"` capture mode. After this task, `CasBackend` fully implements `SnapshotStore` for
**both** non-git modes (`"cas"` comprehensive whole-tree from S2 + `"explicit-paths"` from S3) and is
ready to be consumed by the P3 capture hooks, `detectAndCreate`, and P4 rewind step 6b.

**Deliverable**: 
1. `src/snapshot/cas.ts` edits: (a) `unlink` added to `CasFs` + `realFs` + the fs import; (b)
   `capture()` widened to `capture(label, explicitPaths?)` with a mode-dispatch + a new private
   `captureExplicitPaths()`; (c) `notifyBashUsed()` + `bashWarnedThisTurn` field (the bash-warning
   seam); (d) the 4 throwing stubs (`dirtyCheck`/`restore`/`has`/`retire`) replaced with real
   implementations.
2. `test/cas.test.ts` extended with the S3 suite (explicit-paths capture, dirtyCheck, restore incl.
   deleteCreatedFiles gating + mode-awareness, has, retire, bash-warning once-per-turn).
3. JSDoc on every new/edited public+private method citing `@14 §4.2`/`§4.3`/`§6`.

**Success Definition**: `CasBackend` `implements SnapshotStore` with zero throwing stubs;
`capture("turn")` in `"cas"` mode still works (S2 untouched below the dispatch); `capture("turn",
["src/a.ts"])` in `"explicit-paths"` mode captures ONLY that path (bash-not-captured warning once per
turn via `notifyBashUsed`); `dirtyCheck(afterRef, paths)` returns drifted paths (hash compare);
`restore(beforeRef, opts)` writes pre-span content from blobs, deletes span-created files under the
two-flag AND, and never rejects; `has(ref)` is a fast `fs.access`; `retire(ref)` unlinks the manifest.
All `npx vitest run test/cas.test.ts` green (S1 substrate + S2 capture suite + S3 suite); `npx tsc
--noEmit` clean; no edits to store.ts/paths.ts/git.ts/config.ts.

## User Persona

**Target User**: Implementer agent (this PRP's consumer). End users never call these methods directly
— the P3 lifecycle hooks (`turn_start`/`agent_end`/tool_call) and `/mulligan_checkpoint` call
`capture`; `rewindExecute` (P4.M2.T1) calls `dirtyCheck` + `restore`; cross-reload (E32) + the
prompt-boundary GC (§5) call `has`/`retire`.

**Use Case**: A workspace with NO git repo needs working-tree file revert on `mulligan_rewind`. In the
default `"cas"` mode the backend comprehensively reverts any file; a user who opts into
`"explicit-paths"` (bounded scope / lower per-turn cost) gets revert ONLY for the `write`/`edit`
tool paths (bash changes deliberately NOT promised restorable, with a once-per-turn warning).

**Pain Points Addressed**: Without the S3 methods, `CasBackend` is a skeleton — restore/dirtyCheck/has/
retire throw, so non-git revert is non-functional. S3 delivers the read-back half of the CAS store
(restore content from blobs), the dirty guard (refuse clobbering human edits — E30), the
explicit-paths conservative mode (§4.2), and ref lifecycle (`has`/`retire`) needed for cross-reload +
GC.

---

## Why

- **Functional completion**: S1 (blob/manifest substrate) + S2 (`"cas"` capture) wrote data INTO the
  store; S3 is the read/restore/retire half that makes the data USABLE. Without it, `CasBackend`
  cannot satisfy any `SnapshotStore` consumer.
- **Backend parity (§4.3)**: GitBackend (P2.M2.T1.S2) already ships `dirtyCheck`/`restore`/`has`/
  `retire`. S3 brings CasBackend to behavioral parity so the rewind tool is mode-agnostic (same
  mutex idiom, same best-effort-never-rejects contract, same two-flag delete gating, same dirty-guard
  semantics).
- **Conservative mode (§4.2)**: `"explicit-paths"` is the pi-undo-redo model — bounded scope / lower
  per-turn cost for workspaces where whole-tree scanning is too costly or too broad. S3 makes it a
  first-class opt-in (`config.revert.nonGitMode === "explicit-paths"`).
- **Foundation for P3/P4**: P3.M1.T1 capture hooks call `capture` (incl. explicit-paths with the tool
  path); P4.M2.T1.S2 rewind step 6b calls `dirtyCheck` + `restore`; cross-reload + GC call
  `has`/`retire`. S3 unblocks all of them.
- **Scope guard**: S3 implements ONLY the 4 methods + explicit-paths capture + the bash-warning seam.
  It does NOT implement the lifecycle hooks (P3), the rewind integration (P4), the prompt-boundary GC
  (P3), nor the integration test scenarios (P5). Stay in lane.

---

## What

### `capture(label, explicitPaths?)` — widened (mode-dispatch)
`capture(label: string, explicitPaths?: string[]): Promise<string | null>` — the signature GAINS an
optional `explicitPaths` (TS-legal extra optional param; satisfies the locked interface). Inside, after
the shared mutex acquire + count-cap gate: `if (this.cfg.nonGitMode === "explicit-paths") return
this.captureExplicitPaths(label, explicitPaths);` — else S2's whole-tree walk runs unchanged. The
return is `label` (ref === label) or `null` (caps/IO error — best-effort, never rejects).

### `captureExplicitPaths(label, explicitPaths)` — NEW private (§4.2)
For each workspace-rel POSIX path in `explicitPaths` (deduped): `isDangerousWorkspaceRel` skip;
`resolveSafeWorkspacePath` (escape → throws → caught by `capture`'s try → `null`); `stat` —
ENOENT ⇒ record `{hash:"", size:0, mtime:0, existed:false}` (the file is about to be CREATED by the
upcoming write — no blob, no content); else oversize (`> maxFileBytes`) skip+warn, byte-budget
(`> maxTotalBytes`) partial-skip, otherwise `readFile` → `hashContent` → `storeBlob` (deduped) →
`{hash, size, mtime, existed:true}`. Build + write the manifest (`manifestPath(label)`); increment
`capturesThisTurn`; return `label`. Bash paths are NEVER in `explicitPaths` (the P3 hook only passes
write/edit tool paths).

### `notifyBashUsed()` — NEW (the bash-warning seam, §4.2)
`notifyBashUsed(): void` — if `this.cfg.nonGitMode === "explicit-paths"` AND `!this.bashWarnedThisTurn`:
`console.warn("[mulligan] snapshot: a bash tool ran in explicit-paths mode — its file changes are NOT
captured and will NOT be restored on undo; use a git repo or 'cas' mode for full coverage")` and set
`bashWarnedThisTurn = true`. Idempotent within a turn (once-per-turn dedup). The P3 tool_call hook
calls this when it observes a bash tool_call in explicit-paths mode. (Reset by P3 at the turn
boundary, like `capturesThisTurn`.)

### `dirtyCheck(afterRef, paths)` — §6 step 3 + §2 (replaces stub)
`dirtyCheck(afterRef: string, paths: string[]): Promise<string[]>`. Mutex-serialized. If `!afterRef`
or `paths.length === 0` → `[]`. Read the `afterRef` manifest (best-effort: missing/corrupt → `[]`,
allow restore). For each `path` in `paths`: re-hash the CURRENT file; an entry with `existed:true`
whose current hash ≠ `entry.hash` → dirty; current file gone but `entry.existed` → dirty (deleted
since `afterRef`); entry missing but file exists now → dirty (conservative, mirrors `git diff`); entry
`existed:false` but file exists now → dirty (created since `afterRef`). Collect + return dirty paths.
Best-effort: ANY error → `console.warn` + `[]` (never rejects).

### `restore(beforeRef, opts)` — §6 + §2 (replaces stub)
`restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult>`. Mutex-serialized. Init the
5-bucket `RestoreResult`. If neither flag set → return it (no-op). Read the `beforeRef` manifest
(best-effort; missing/corrupt → return whatever was collected). **Manifest loop** (both modes): for
each `{path, entry}`:
- `entry.existed && opts.revertFileChanges` → `readBlob(entry.hash)` + `writeFile(absPath, content)`
  → `reverted` (or `failed` on per-path IO error).
- `!entry.existed && opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles` → `unlink(absPath)`
  → `deleted` (ENOENT ⇒ silent skip; other error ⇒ `failed`).
**Tree-walk deleteCreatedFiles — `"cas"` MODE ONLY** (when `opts.deleteCreatedFiles &&
this.cfg.allowDeleteCreatedFiles && this.cfg.nonGitMode === "cas"`): reuse S2's `walkTree`; for each
present file whose `rel` is NOT in the beforeRef manifest (and not dangerous): `unlink` →
`deleted`/`failed`. (explicit-paths does NOT walk — its created files are already the `existed:false`
manifest entries.) Per-path failures → `failed`; the op NEVER rejects. Returns the `RestoreResult`.

### `has(ref)` — §2 (replaces stub)
`has(ref: string): Promise<boolean>`. **NOT mutex-serialized** (parity with git.ts — fast read-only
existence check; §4.3 omits `has` from the serialized list). `fs.access(manifestPath(ref))` → `true`;
any error (missing/corrupt path) → `false`. Best-effort, never rejects.

### `retire(ref)` — §2 + §5 (replaces stub)
`retire(ref: string): Promise<void>`. Mutex-serialized. `unlink(manifestPath(ref))`; ENOENT ⇒ silent
(already retired); other error ⇒ `console.warn`. **Blob mark-sweep is DEFERRED** to the
prompt-boundary GC pass (P3, §5) — `retire` only drops the manifest ref so its blobs become
reclaimable later (mirrors git.ts `retire` which only does `update-ref -d`, letting `git gc` reclaim).
Best-effort → void, never rejects.

### Success Criteria
- [ ] `capture("turn", ["src/a.ts"])` in `nonGitMode:"explicit-paths"` captures ONLY `src/a.ts`
  (manifest `files` has exactly that key); a sibling file is absent from the manifest.
- [ ] Explicit-paths capture of a NOT-YET-EXISTING path records `existed:false` (no blob stored).
- [ ] Explicit-paths capture skips dangerous paths (`.git`/`node_modules`/`..`) + oversize files.
- [ ] `notifyBashUsed()` warns exactly once per turn in explicit-paths mode; is a no-op in `"cas"`
  mode; idempotent (2nd call same turn is silent).
- [ ] `capture("turn")` in `nonGitMode:"cas"` (no explicitPaths) STILL works as S2 shipped it (the
  mode-dispatch does not break S2).
- [ ] `dirtyCheck(afterRef, paths)` returns paths whose current hash ≠ afterRef manifest (modified),
  plus gone-since-afterRef (deleted) — and `[]` when clean / null afterRef / empty paths / corrupt manifest.
- [ ] `restore(beforeRef, {revertFileChanges:true})` writes pre-span blob content back for each
  `existed:true` file (`reverted[]`); a read/write failure lands in `failed[]`; restore never rejects.
- [ ] `restore` deleteCreatedFiles honors the TWO-FLAG AND (`opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles`); missing either ⇒ zero deletions.
- [ ] `restore` explicit-paths deletes `existed:false` manifest entries (created-during-span); `"cas"`
  mode tree-walk-deletes present-not-in-manifest files. Neither deletes dangerous paths.
- [ ] `has(ref)` → `true` for an existing manifest, `false` for a missing one; never rejects.
- [ ] `retire(ref)` unlinks the manifest; a 2nd `retire` (ENOENT) is a silent no-op; never rejects.
- [ ] `dirtyCheck`/`restore`/`has`/`retire` are mutex-serialized EXCEPT `has` (parity with git.ts).
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/cas.test.ts` ALL green (S1 + S2 + S3).

---

## All Needed Context

### Context Completeness Check
✅ "If someone knew nothing about this codebase, would they have everything needed?" — YES. S1/S2
substrate (manifest types, blob store, `hashContent`/`storeBlob`/`readBlob`/`manifestPath`, `walkTree`,
`loadPrevEntries`, `capturesThisTurn`, `readdir`), the locked `SnapshotStore` interface + types, the
PURE path helpers, the git.ts parity reference (full `dirtyCheck`/`restore`/`has`/`retire` bodies), the
config block, and the test idiom are all cited below with exact paths + the patterns to follow.

### Documentation & References

```yaml
# MUST READ — the authoritative spec for this task
- file: spec/14-working-tree-revert.md
  why: §4.2 (explicit-paths — captures ONLY write/edit paths, bash NOT captured + warns), §4.3
       (AsyncMutex serializes capture/dirtyCheck/restore/retire/gc — NOT has; path safety; backend
       parity; fail-closed caps), §6 (restore semantics — refuse-on-dirty then restore; step 4
       revert + delete-created two-flag AND + allowDeleteCreatedFiles; never deletes a file not
       provably created during the span), §2 (the interface), §5 (retire/GC retention).
  critical: §4.2 "Bash file commands are NOT captured and NOT promised restorable (the tool warns
       once per turn when bash runs in this mode)". §6 step 6 "Never delete a file not provably
       created during the span." §4.3 "a single mutex per store serializes ALL store operations
       (capture/dirtyCheck/restore/retire/gc)".

- file: plan/008_c36fd26768ae/architecture/external_deps.md
  why: §2 lists the CAS fs APIs incl. `fs.promises.unlink` (restore deleteCreatedFiles) + the manifest
       JSON shape (`files[rel]={hash,size,mtime,existed}`).
  pattern: restore uses readFile (blob) + writeFile (worktree) + unlink (deleteCreatedFiles).

# THE CONTRACTS this PRP consumes — S1 (shipped) + S2 (in-flight, treat as contract)
- file: plan/008_c36fd26768ae/P2M3T1S1/PRP.md
  why: defines CasManifest/CasManifestEntry (existed:false ⇒ restore DELETES), CasFs DI seam,
       serializeManifest/parseManifest, storeBlob/readBlob/hashContent/blobPath/manifestPath, the
       mutex field, the throwing stubs S3 replaces.
  gotcha: S1's CasFs has NO unlink (and NO readdir) — S3 ADDS unlink (S2 adds readdir).

- file: plan/008_c36fd26768ae/P2M3T1S2/PRP.md
  why: defines the 'cas' capture body S3 must NOT break + the shared helpers S3 reuses:
       `capturesThisTurn` field, private `loadPrevEntries(label)`, private `walkTree(absDir,
       excludeSet, visit)`, the readdir/CasFs widening. S3's restore 'cas'-mode deleteCreatedFiles
       REUSES walkTree; S3's capture widening inserts the explicit-paths dispatch ABOVE S2's walk.
  gotcha: S2's capture signature is `capture(label: string)` (NO explicitPaths). S3 WIDENS it to
       `capture(label, explicitPaths?)` — TS-legal (extra optional param satisfies the interface).

# THE LOCKED interface — DO NOT EDIT
- file: src/snapshot/store.ts
  why: the SnapshotStore interface (S1 LOCKED — `capture(label): Promise<string|null>`,
       `dirtyCheck(afterRef,paths): Promise<string[]>`, `restore(beforeRef,opts): Promise<RestoreResult>`,
       `has(ref): Promise<boolean>`, `retire(ref): Promise<void>`, `describe()`), RestoreOpts
       {revertFileChanges, deleteCreatedFiles}, RestoreResult {reverted, deleted, failed, skipped,
       refused}, AsyncMutex.
  gotcha: restore has NO afterRef param — see "D2 mode-aware deleteCreatedFiles" in research notes.

# THE PARITY SIBLING — mirror its dirtyCheck/restore/has/retire structure exactly
- file: src/snapshot/git.ts
  why: the full dirtyCheck/restore/has/retire bodies (lines ~360-590). Mirror: the mutex
       acquire/finally idiom, the best-effort try/catch→warn+[]/void/false/5-buckets contract, the
       has-is-NOT-mutex-serialized decision (git.ts JSDoc: "§4.3 omits has"), the restore two-flag-AND
       delete gating + per-path failed[] + resolveSafeWorkspacePath/isDangerousWorkspaceRel safety.
  pattern: dirtyCheck `mutex.acquire → try{ if(!afterRef||!paths.length)return[]; ...; return result
       }catch{ warn; return[] }finally{ release }`. has `try{ ...;return true }catch{ return false }`
       (NO mutex). restore `mutex.acquire; result=5-empty; try{ if(!rev&&!del)return result; ...;
       per-path try/catch→failed }catch{ warn; return result }finally{ release }`.
  gotcha: git.ts uses `git diff`/`ls-files`; CAS uses hash compare + (for 'cas' delete) walkTree.

# PURE path helpers — consume unchanged
- file: src/snapshot/paths.ts
  why: normalizeRelPath (manifest keys), isDangerousWorkspaceRel (safety floor — skip/never-delete),
       resolveSafeWorkspacePath (throws on `..`/absolute escape — restore/capture wrap in try/catch),
       DANGEROUS_DIRS ([".git",".pi","node_modules"]).
  pattern: in captureExplicitPaths + restore delete-loop: `if(isDangerousWorkspaceRel(rel)) continue;`
       and `const abs = resolveSafeWorkspacePath(this.cwd, rel);` (escape throws ⇒ caught).

- file: src/config.ts
  why: the 8-field `MulliganConfig["revert"]` block read via `this.cfg`.
  critical: nonGitMode:"cas"|"explicit-paths"; allowDeleteCreatedFiles:false (default); maxFileBytes:
       262144; maxTotalBytes:33554432; excludeGlobs:[".git","node_modules","dist","build",".next",
       ".venv","target"].

# THE TEST idioms to mirror
- file: test/cas.test.ts
  why: S1's test file S3 EXTENDS. Reuse: `BASE_CFG` fixture (line 46), `makeBackend(fs?)` helper
       (line 58), the recording CasFs fake pattern (`makeRecordingFs`, line 109), vitest flat
       describe/it/expect, `.js` imports. S3 ADDS `unlink` to every fake it builds.
  gotcha: S2 will have ADDED a `TreeFs` fake + a capture suite — S3 must not break those; S3 adds its
       OWN describe blocks + fakes (a manifest-aware fake for dirtyCheck/restore).

- file: test/git.test.ts
  why: the dirtyCheck/restore/has/retire TEST patterns to mirror (lines 332-580): the mutex
       max-in-flight-1 test (line 298), the two-flag-AND delete tests (lines 491-506), per-path-failure
       → failed[] (line 554), read-tree-failure → 5-bucket result never rejects (line 565), neither-flag
       → empty result (line 575).
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  store.ts      # LOCKED interface + AsyncMutex + RestoreOpts/RestoreResult + detectAndCreate + NoOpStore — READ ONLY
  paths.ts      # PURE: normalizeRelPath, isDangerousWorkspaceRel, resolveSafeWorkspacePath, DANGEROUS_DIRS — READ ONLY
  git.ts        # GitBackend (DONE) — the PARITY reference for dirtyCheck/restore/has/retire — READ ONLY
  cas.ts        # ← S1 skeleton (DONE) + S2 capture (in-flight). S3 EDITS: unlink to CasFs; capture widening +
                #   captureExplicitPaths; notifyBashUsed+bashWarnedThisTurn; replace 4 stubs
test/
  cas.test.ts   # ← S1 tests (DONE) + S2 capture suite (in-flight). S3 EXTENDS with the S3 suite
  git.test.ts   # reference test idiom (mutex, two-flag-AND, per-path-failure tests) — READ ONLY
```

### Desired Codebase tree with files to be added/edited

```bash
src/snapshot/cas.ts     # EDIT: (1) unlink → CasFs + realFs + import; (2) capture widened + mode-dispatch;
                        #   (3) captureExplicitPaths (private); (4) notifyBashUsed + bashWarnedThisTurn;
                        #   (5) dirtyCheck/restore/has/retire stubs → real impls. NO new exported types.
test/cas.test.ts        # EXTEND: new describe blocks (explicit-paths capture, dirtyCheck, restore, has,
                        #   retire, bash-warning) + a manifest-aware CasFs fake that supports unlink.
```

No NEW files. S3 edits exactly two existing files.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CasFs (S1+S2) has NO `unlink` — S3 MUST ADD it (signature: unlink(path: string): Promise<void>) AND
//   bind it in realFs (`unlink: fsUnlink`) AND add `unlink as fsUnlink` to the node:fs/promises import.
//   EVERY test fake S3 builds must also implement unlink (or dirtyCheck/restore tests break).

// capture signature: S2 ships `capture(label: string)`. S3 WIDENS to `capture(label: string,
//   explicitPaths?: string[])`. TypeScript permits this — a method with an EXTRA OPTIONAL param is
//   assignable to the interface's `capture(label: string)`. Do NOT edit store.ts.

// restore has NO afterRef param (interface LOCKED). The work-item's "after-manifest but not before"
//   is resolved MODE-AWARE (research D2): explicit-paths → delete the manifest's existed:false entries
//   (the P3 hook captured not-yet-existing paths as existed:false); 'cas' → walkTree + delete
//   present-not-in-beforeRef. Do NOT try to thread afterRef into restore.

// existed:false is REAL (S1 contract: "restore DELETES it"). 'cas' capture (S2) NEVER produces
//   existed:false (it walks existing files only). existed:false arises ONLY in explicit-paths (a path
//   captured just before its creating write). restore uses existed:false to drive deletion.

// has is NOT mutex-serialized — parity with git.ts (§4.3 omits has). dirtyCheck/restore/retire ARE
//   mutex-serialized (§4.3 lists them). Do NOT acquire the mutex in has.

// ref === label === the manifest filename. manifestPath(ref) = <storageDir>/manifests/<ref>.json.
//   has = fs.access(that); retire = unlink(that); dirtyCheck/restore = parseManifest(readFile(that)).
//   capture returns label. Do NOT hash the manifest as the ref.

// serializeManifest returns a STRING; writeFile takes a Buffer → wrap (S2 already does this for the
//   manifest write). readFile returns a Buffer; parseManifest takes a STRING → `.toString("utf8")`.
//   readBlob returns a Buffer; writeFile(worktree) takes a Buffer → pass it through directly.

// Best-effort everywhere: dirtyCheck → [] on error; restore → returns the (partial) 5-bucket result,
//   NEVER rejects; has → false on error; retire → void on error. Per-path failures in restore →
//   failed[] (the op still resolves). Mirror git.ts's catch shapes EXACTLY (one outer try/catch per op;
//   per-path try/catch inside the loops).

// console.warn prefix convention: `[mulligan] snapshot.<op>: <one-liner>` (mirror git.ts). No
//   structured logger at this tier (arrives in P3). Use console.warn, not log.ts.

// resolveSafeWorkspacePath THROWS on `..`/absolute escape — call it INSIDE capture's outer try (so an
//   escape → null) and INSIDE restore's per-path try (so an escape → failed[], not a reject). Mirror
//   git.ts restore's resolveSafeWorkspacePath usage (it wraps each in try/catch → failed[]).

// walkTree is S2's PRIVATE method — S3 reuses it for 'cas'-mode restore deleteCreatedFiles. Its
//   visitor is `(rel, abs, st) => Promise<void>`; it already skips dangerous dirs + excludeGlob
//   segments + non-files. S3 adds a visitor that checks `!manifest.files[rel]` then unlinks.

// .js imports + node: prefixes are mandatory (tsc/vitest). cas.ts already imports node:fs/promises
//   (readFile/writeFile/mkdir/access/stat + S2's readdir) — ADD unlink to that same import. join/
//   resolve/dirname already imported. normalizeRelPath/isDangerousWorkspaceRel/resolveSafeWorkspacePath
//   already imported from "./paths.js" (S2 added them).
```

---

## Implementation Blueprint

### Data models and structure

S3 adds **NO new exported types**. It consumes S1's `CasManifest`/`CasManifestEntry`/`CasFs`/
`serializeManifest`/`parseManifest`, S2's `walkTree`/`loadPrevEntries`/`capturesThisTurn`/`readdir`,
and store.ts's `RestoreOpts`/`RestoreResult` — all already in-file or imported. The only new surface
is: the `unlink` member on `CasFs`, the optional `explicitPaths` param on `capture`, the private
`captureExplicitPaths` method, the `notifyBashUsed` method + `bashWarnedThisTurn` field, and the 4
real method bodies.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/snapshot/cas.ts — add `unlink` to the CasFs DI seam + realFs + import
  - ADD `unlink as fsUnlink` to the existing `node:fs/promises` import line (where fsReadFile/
    fsWriteFile/fsMkdir/fsAccess/fsStat [+ S2's fsReaddir] are bound).
  - ADD to the `CasFs` interface (after stat, or after S2's readdir):
      /** unlink — S3's restore deleteCreatedFiles removes span-created worktree files (external_deps §2). */
      unlink(path: string): Promise<void>;
  - ADD to the `realFs` object literal: `unlink: fsUnlink,`
  - WHY: restore's deleteCreatedFiles (both the existed:false entries + the 'cas' tree-walk) call
    `this.fs.unlink(abs)`. external_deps.md §2 sanctions `fs.promises.unlink`.
  - GOTCHA: S2 will have added `readdir` to CasFs/realFs already — do NOT duplicate it; ADD `unlink`
    alongside. S1's recording fakes in test/cas.test.ts do NOT model unlink — S3's new fakes must.

Task 2: EDIT src/snapshot/cas.ts — add the `bashWarnedThisTurn` field + `notifyBashUsed()`
  - ADD a class field (right after S2's `capturesThisTurn`):
      /** Once-per-turn bash-not-captured warning latch (explicit-paths mode, §4.2). Reset by lifecycle
       *  P3 at the turn boundary (parity with capturesThisTurn). */
      private bashWarnedThisTurn = false;
  - ADD a public method (place near describe() or just above capture):
      /** Seam for the P3 tool_call hook: call when a bash tool_call runs in explicit-paths mode. Emits
       *  the once-per-turn "bash changes NOT captured" warning (§4.2) + latches so the 2nd call is
       *  silent. No-op in 'cas' mode (bash is captured there). Idempotent within a turn. */
      notifyBashUsed(): void {
        if (this.cfg.nonGitMode !== "explicit-paths") return;       // only the conservative mode warns
        if (this.bashWarnedThisTurn) return;                         // once-per-turn dedup
        this.bashWarnedThisTurn = true;
        console.warn(
          "[mulligan] snapshot: a bash tool ran in explicit-paths mode — its file changes are NOT captured and will NOT be restored on undo; use a git repo or 'cas' mode for full coverage",
        );
      }
  - WHY: work-item note #1/#3 "Log a once-per-turn warning when bash is detected but not captured."
    Bash DETECTION is a P3 event-level concern; S3 provides the dedup + emission seam.
  - GOTCHA: do NOT reset bashWarnedThisTurn anywhere in S3 (parity with capturesThisTurn — P3 owns
    the turn-boundary reset). notifyBashUsed is PUBLIC (the P3 hook calls it on a CasBackend-typed ref).

Task 3: EDIT src/snapshot/cas.ts — widen capture() + add the explicit-paths dispatch + captureExplicitPaths
  - FIND S2's capture signature `async capture(label: string): Promise<string | null> {` and the
    count-cap gate just inside its try. WIDEN the signature to:
      async capture(label: string, explicitPaths?: string[]): Promise<string | null> {
  - INSERT the mode-dispatch immediately AFTER the count-cap gate (BEFORE S2's `loadPrevEntries`
    call / walk), still inside the shared try:
      if (this.cfg.nonGitMode === "explicit-paths") {
        return await this.captureExplicitPaths(label, explicitPaths);
      }
    // …S2's whole-tree walk body continues unchanged below for 'cas' mode…
  - ADD the private method (immediately above capture, after S2's walkTree/loadPrevEntries):
      private async captureExplicitPaths(label: string, explicitPaths?: string[]): Promise<string | null> {
        // see "Implementation Patterns" below for the full body. JSDoc cites @14 §4.2.
      }
  - WHY: §4.2 explicit-paths captures ONLY the write/edit tool paths. The dispatch keeps S2's 'cas'
    walk intact (the else-branch) while routing explicit-paths to the new bounded-scope capture.
  - GOTCHA: captureExplicitPaths shares the mutex + count-cap with capture (it runs INSIDE capture's
    try, so capture's outer catch → null covers its errors + the release is in capture's finally). Do
    NOT re-acquire the mutex or re-check capturesThisTurn inside captureExplicitPaths. It DOES
    increment capturesThisTurn + write the manifest itself (it is the whole explicit-paths path).
  - GOTCHA: the widened signature must still satisfy `implements SnapshotStore` — verify with tsc.

Task 4: REPLACE the dirtyCheck stub with the real implementation
  - FIND: `async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> { throw new Error("CasBackend.dirtyCheck not implemented — see P2.M3.T1.S3"); }`
  - REPLACE WITH the body in "Implementation Patterns" (mutex + best-effort + hash compare). JSDoc cites
    `@14 §6 step 3` (the dirty guard) + `§4.3` (mutex). Parameter names: afterRef, paths (drop the `_`).
  - DEPENDENCIES: Task 1 (unlink is NOT needed by dirtyCheck, but the file is consistent); parseManifest
    + hashContent + manifestPath (S1) + resolveSafeWorkspacePath (paths.ts).

Task 5: REPLACE the restore stub with the real implementation
  - FIND: `async restore(_beforeRef: string, _opts: RestoreOpts): Promise<RestoreResult> { throw … }`
  - REPLACE WITH the body in "Implementation Patterns" (mutex + 5 buckets + manifest loop + mode-aware
    'cas' tree-walk delete + best-effort). JSDoc cites `@14 §6` (restore semantics) + `§4.3` (mutex).
    Parameter names: beforeRef, opts.
  - DEPENDENCIES: Task 1 (unlink), S2's walkTree (for 'cas' deleteCreatedFiles), S1's readBlob/
    manifestPath/parseManifest, paths.ts resolveSafeWorkspacePath + isDangerousWorkspaceRel.

Task 6: REPLACE the has stub
  - FIND: `async has(_ref: string): Promise<boolean> { throw … }`
  - REPLACE WITH: `try { await this.fs.access(this.manifestPath(ref)); return true; } catch { return false; }`
    (NO mutex — parity with git.ts). JSDoc cites `@14 §2` + notes "NOT mutex-serialized (fast
    read-only existence check; §4.3 omits has)". Parameter name: ref.

Task 7: REPLACE the retire stub
  - FIND: `async retire(_ref: string): Promise<void> { throw … }`
  - REPLACE WITH: mutex acquire → try { await this.fs.unlink(this.manifestPath(ref)); } catch ENOENT
    silent / other → console.warn → finally release. JSDoc cites `@14 §2/§5` + notes blob mark-sweep
    is deferred to the prompt-boundary GC (P3). Parameter name: ref.

Task 8: VERIFY — build + type
  - RUN: `npx tsc --noEmit` (zero errors); `lsp_diagnostics` on src/snapshot/cas.ts (no diagnostics).
  - EXPECT: the widened capture signature still satisfies `implements SnapshotStore`; the inline
    `import("node:fs").Dirent` (S2) + unlink all resolve.

Task 9: EXTEND test/cas.test.ts — the S3 suite + a manifest-aware CasFs fake
  - ADD a manifest-aware fake helper (module-level) extending S1's recording pattern: it models a
    worktree (Map<absPath, Buffer|absent>) + the blob store (Map<blobPath, Buffer>) + the manifests
    dir (Map<manifestPath, string>), implementing readFile/writeFile/mkdir/access/stat/readdir(S2)/
    unlink. access rejects if absent; unlink removes from the worktree Map (ENOENT if absent).
  - ADD describe blocks + it() cases (see "Level 2" below). FOLLOW the vitest flat pattern +
    BASE_CFG/makeBackend idiom; build per-test cfg variants via `{ ...BASE_CFG, nonGitMode:
    "explicit-paths" }` / `{ ...BASE_CFG, allowDeleteCreatedFiles: true }`.
  - GOTCHA: to test restore, FIRST run a capture to WRITE a manifest into the fake's manifests Map,
    THEN mutate the worktree Map (simulate the agent's span), THEN call restore(beforeRef) and assert
    the worktree Map returned to the captured state + the RestoreResult buckets.
```

### Implementation Patterns & Key Details

```typescript
// ── Task 3: captureExplicitPaths (runs INSIDE capture's mutex + try; JSDoc cites @14 §4.2). ──
/**
 * Capture ONLY the explicit write/edit tool paths (the conservative pi-undo-redo model — spec/14 §4.2).
 * Does NOT scan the workspace. For each path: stat → (ENOENT ⇒ existed:false, no blob — the file is
 * about to be created) | (oversize ⇒ skip+warn) | (else read+hash+storeBlob, existed:true). Dangerous
 * paths + `..`/absolute escapes are skipped (paths.ts safety floor). Bash paths are NEVER passed here
 * (the P3 hook passes only write/edit tool paths); the once-per-turn bash warning is notifyBashUsed().
 * Caps (§4.3/E29): maxFileBytes ⇒ skip+warn; maxTotalBytes ⇒ partial-skip (still returns label);
 * maxSnapshotsPerTurn ⇒ null (the count-cap gate in capture() aborts before dispatch). BEST-EFFORT: any
 * thrown error propagates to capture()'s outer catch ⇒ null (never rejects from capture).
 * @returns the manifest label (ref === label). Runs inside capture()'s mutex + try — do NOT re-acquire.
 */
private async captureExplicitPaths(label: string, explicitPaths?: string[]): Promise<string | null> {
  const files: Record<string, CasManifestEntry> = {};
  const seen = new Set<string>();
  let totalBytes = 0;
  let partial = false;
  for (const rel of explicitPaths ?? []) {
    if (seen.has(rel)) continue;                       // dedupe (a path written twice captured once)
    seen.add(rel);
    if (isDangerousWorkspaceRel(rel)) continue;        // safety floor — .git/.pi/node_modules/../NUL/dir
    const abs = resolveSafeWorkspacePath(this.cwd, rel); // THROWS on `..`/absolute escape ⇒ capture's catch ⇒ null
    let st: { size: number; mtimeMs: number };
    try {
      st = await this.fs.stat(abs);
    } catch {
      // file does not exist yet (the upcoming write will CREATE it) ⇒ record absence, no blob (S1 existed contract)
      files[rel] = { hash: "", size: 0, mtime: 0, existed: false };
      continue;
    }
    if (st.size > this.cfg.maxFileBytes) {             // fail-closed (§4.3) — never silently claimed restorable
      console.warn(`[mulligan] snapshot.capture: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${rel}`);
      continue;
    }
    if (totalBytes + st.size > this.cfg.maxTotalBytes) { // partial — stop accepting new data (E29)
      partial = true;
      console.warn(`[mulligan] snapshot.capture: maxTotalBytes (${this.cfg.maxTotalBytes}) reached; partial snapshot, skipping: ${rel}`);
      continue;
    }
    const content = await this.fs.readFile(abs);
    const hash = await this.hashContent(content);
    await this.storeBlob(content);                     // deduped (S1)
    files[rel] = { hash, size: st.size, mtime: st.mtimeMs, existed: true };
    totalBytes += st.size;
  }
  const manifest: CasManifest = { version: 1, label, turnIndex: 0, ts: Date.now(), files };
  await this.fs.mkdir(join(this.storageDir, "manifests"), { recursive: true });
  await this.fs.writeFile(this.manifestPath(label), Buffer.from(serializeManifest(manifest), "utf8"));
  this.capturesThisTurn++;
  if (partial) console.warn(`[mulligan] snapshot.capture: wrote PARTIAL manifest for ${label} (maxTotalBytes cap)`);
  return label; // ref === label
}

// ── Task 4: dirtyCheck (JSDoc cites @14 §6 step 3 + §4.3). Mirrors git.ts dirtyCheck. ──
async dirtyCheck(afterRef: string, paths: string[]): Promise<string[]> {
  const release = await this.mutex.acquire();          // §4.3 — serialize ALL store ops
  try {
    if (!afterRef || paths.length === 0) return [];    // no drift baseline / nothing to check ⇒ allow
    let manifest: CasManifest;
    try {
      const buf = await this.fs.readFile(this.manifestPath(afterRef));
      manifest = parseManifest(buf.toString("utf8"));  // throws on bad version — caught below ⇒ []
    } catch {
      return [];                                        // missing/corrupt afterRef ⇒ allow (best-effort)
    }
    const dirty: string[] = [];
    for (const rel of paths) {
      if (isDangerousWorkspaceRel(rel)) continue;       // never report/operate on a dangerous path
      const entry = manifest.files[rel];
      let currentHash: string | null = null;
      let existsNow = false;
      try {
        const abs = resolveSafeWorkspacePath(this.cwd, rel);
        currentHash = await this.hashContent(await this.fs.readFile(abs));
        existsNow = true;
      } catch {
        existsNow = false;                              // ENOENT or escape ⇒ file not (safely) readable now
      }
      if (existsNow) {
        if (!entry) { dirty.push(rel); continue; }              // exists now, no afterRef baseline ⇒ dirty (conservative)
        if (!entry.existed) { dirty.push(rel); continue; }      // afterRef said absent, exists now ⇒ created since ⇒ dirty
        if (currentHash !== entry.hash) { dirty.push(rel); continue; } // content drifted ⇒ dirty
        // else: clean
      } else {
        if (entry && entry.existed) { dirty.push(rel); continue; } // was at afterRef, now gone ⇒ deleted since ⇒ dirty
        // entry absent or existed:false + gone now ⇒ correctly absent ⇒ not dirty
      }
    }
    return dirty;
  } catch (err) {                                       // E27 best-effort — never rejects
    console.warn(`[mulligan] snapshot.dirtyCheck failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    release();
  }
}

// ── Task 5: restore (JSDoc cites @14 §6 + §4.3). Mirrors git.ts restore structure. ──
async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
  const release = await this.mutex.acquire();          // §4.3
  const result: RestoreResult = { reverted: [], deleted: [], failed: [], skipped: [], refused: [] };
  try {
    if (!opts.revertFileChanges && !opts.deleteCreatedFiles) return result; // neither flag ⇒ no-op
    let manifest: CasManifest;
    try {
      const buf = await this.fs.readFile(this.manifestPath(beforeRef));
      manifest = parseManifest(buf.toString("utf8"));
    } catch (err) {
      // missing/corrupt beforeRef ⇒ nothing restorable; return the (all-empty) result. Never rejects.
      console.warn(`[mulligan] snapshot.restore: cannot read beforeRef manifest: ${err instanceof Error ? err.message : String(err)}`);
      return result;
    }
    // (b) REVERT pre-existing files + DELETE span-created files from the manifest (mode-agnostic loop).
    for (const [rel, entry] of Object.entries(manifest.files)) {
      if (isDangerousWorkspaceRel(rel)) continue;       // safety floor — never touch .git/.pi/node_modules
      let abs: string;
      try { abs = resolveSafeWorkspacePath(this.cwd, rel); }       // escape ⇒ failed[]
      catch { result.failed.push(rel); continue; }
      if (entry.existed && opts.revertFileChanges) {
        try {
          const content = await this.readBlob(entry.hash);          // pre-span bytes (S1)
          await this.fs.writeFile(abs, content);                    // write working-tree FILE (never git index)
          result.reverted.push(rel);
        } catch { result.failed.push(rel); }                        // per-path best-effort (E27)
      } else if (!entry.existed && opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles) {
        // TWO-FLAG AND: existed:false = created during span (captured by the P3 hook just before the
        // creating write). Delete to recreate the pre-span absence. explicit-paths path (no tree walk).
        try {
          await this.fs.unlink(abs);
          result.deleted.push(rel);
        } catch (e) {
          const code = (e as NodeJS.ErrnoException)?.code;
          if (code !== "ENOENT") result.failed.push(rel);           // already gone (deleted twice) ⇒ silent
        }
      }
    }
    // (c) 'cas'-MODE-ONLY comprehensive deleteCreatedFiles: walk + delete present-not-in-beforeRef.
    //     explicit-paths does NOT walk (its created files are the existed:false entries above; bash-
    //     created files are deliberately NOT promised restorable — §4.2). Mirrors git.ts ls-files --others.
    if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles && this.cfg.nonGitMode === "cas") {
      const excludeSet = new Set(this.cfg.excludeGlobs.map((g) => g.toLowerCase()));
      await this.walkTree(this.cwd, excludeSet, async (rel, abs) => {
        if (manifest.files[rel]) return;                // in beforeRef ⇒ not created during span
        if (isDangerousWorkspaceRel(rel)) return;        // belt-and-suspenders (walkTree already prunes)
        try {
          await this.fs.unlink(abs);
          result.deleted.push(rel);
        } catch (e) {
          const code = (e as NodeJS.ErrnoException)?.code;
          if (code !== "ENOENT") result.failed.push(rel);
        }
      });
    }
    return result;
  } catch (err) {                                       // E27 — never rejects; return whatever was collected
    console.warn(`[mulligan] snapshot.restore partial: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  } finally {
    release();
  }
}

// ── Task 6: has (JSDoc cites @14 §2; NOT mutex-serialized — parity with git.ts). ──
async has(ref: string): Promise<boolean> {
  try {
    await this.fs.access(this.manifestPath(ref));       // rejects if absent
    return true;
  } catch {
    return false;                                       // missing/corrupt ⇒ false. Never rejects.
  }
}

// ── Task 7: retire (JSDoc cites @14 §2/§5; mutex-serialized; best-effort void). ──
async retire(ref: string): Promise<void> {
  const release = await this.mutex.acquire();          // §4.3
  try {
    await this.fs.unlink(this.manifestPath(ref));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {                            // already retired (2nd call) ⇒ silent
      console.warn(`[mulligan] snapshot.retire failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    // NOTE: blob mark-sweep is the prompt-boundary GC pass (P3, §5) — retire only drops the manifest
    // ref so its blobs become reclaimable later (mirrors git.ts retire's update-ref -d + git gc).
  } finally {
    release();
  }
}
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO CONFIG EDITS. S3 is pure in-process code on the S1+S2 substrate.
IMPORTS (cas.ts): add `unlink as fsUnlink` to the existing node:fs/promises import (alongside S2's
  readdir). join/resolve/dirname already imported. normalizeRelPath/isDangerousWorkspaceRel/
  resolveSafeWorkspacePath already imported from "./paths.js" (S2). CasManifest/CasManifestEntry/
  serializeManifest/parseManifest/storeBlob/readBlob/hashContent/manifestPath already in-file (S1).
  RestoreOpts/RestoreResult/AsyncMutex already imported from "./store.js" (S1).
CAPTURE SIGNATURE (D1): the widened `capture(label, explicitPaths?)` satisfies the LOCKED interface
  (extra optional param). The P3 tool_call hook (P3.M1.T1) calls it on a CasBackend-typed ref (or
  casts `store as CasBackend`) — SnapshotStore-typed refs cannot see explicitPaths (interface-level).
  This is BY DESIGN (the param is CasBackend-specific).
BACKEND PARITY (§4.3): dirtyCheck/restore/retire mirror git.ts's mutex + best-effort shapes EXACTLY;
  has mirrors git.ts's NON-mutex fast-read. The restore two-flag-AND delete gating +
  resolveSafeWorkspacePath/isDangerousWorkspaceRel safety mirror git.ts restore. DIVERGENCE: CAS
  restore is content-hash-based (git uses `git diff`); CAS 'cas'-mode delete uses walkTree (git uses
  `ls-files --others`); explicit-paths delete uses manifest existed:false entries (git has no analog —
  git is always comprehensive). Document these inline.
DOWNSTREAM CONSUMERS (NOT S3's job): P3.M1.T1 hooks call capture (incl. explicit-paths) +
  notifyBashUsed; P4.M2.T1.S2 rewindExecute calls dirtyCheck(afterRef, affected) then
  restore(beforeRef, opts); cross-reload (E32) + prompt-boundary GC (§5) call has/retire. S3 must NOT
  implement any of those callers.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the edited file (run after Task 8; fix before tests)
npx tsc --noEmit                              # project-wide typecheck; expect ZERO errors
npx tsc --noEmit -p . 2>&1 | grep cas.ts      # isolate cas.ts errors if any

# LSP diagnostics on the edited file (fast, in-editor)
# (call lsp_diagnostics on src/snapshot/cas.ts — expect no diagnostics)

# Format check (match the repo's tooling)
npx prettier --check src/snapshot/cas.ts test/cas.test.ts

# Expected: Zero errors. The widened capture(label, explicitPaths?) signature must satisfy
# `implements SnapshotStore`; the inline Dirent type (S2) + unlink all resolve.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the CAS suite (fast feedback loop while implementing)
npx vitest run test/cas.test.ts

# Expected: ALL green — S1 substrate (hashContent/storeBlob/manifest/describe) + S2 capture suite +
# S3 suite must pass. S3 must NOT break S1/S2 tests (the explicit-paths dispatch must leave the
# 'cas' capture path intact; the unlink addition must not break S1/S2 fakes that omit it — those
# fakes are in SEPARATE describe blocks; S3 builds its OWN unlink-aware fakes).
```

S3's new `describe` blocks (each driven by a manifest-aware CasFs fake that supports `unlink`):

```yaml
describe("CasBackend.capture — explicit-paths mode (spec/14 §4.2)"):
  - it("captures ONLY the explicit path (sibling file absent from manifest)")
  - it("captures a not-yet-existing path as existed:false (no blob stored)")
  - it("dedupes a path passed twice (one manifest entry)")
  - it("skips dangerous paths (.git/node_modules/..) — absent from manifest")
  - it("skips oversize file (> maxFileBytes) + warns — absent from manifest")
  - it("maxTotalBytes exceeded ⇒ PARTIAL (earlier paths present); STILL returns label")
  - it("maxSnapshotsPerTurn exceeded ⇒ returns null (count-cap gate in capture)")
  - it("an escaping path (../x) ⇒ capture returns null (resolveSafeWorkspacePath throws → catch)")
  - it("capturesThisTurn increments after a successful explicit-paths capture")
  - it("'cas' mode (no explicitPaths) STILL runs S2's whole-tree walk (dispatch does not break it)")

describe("CasBackend.notifyBashUsed — bash-not-captured warning (spec/14 §4.2)"):
  - it("warns once in explicit-paths mode; 2nd call same turn is silent (once-per-turn dedup)")
  - it("is a no-op in 'cas' mode (bash is captured there)")

describe("CasBackend.dirtyCheck — spec/14 §6 step 3 + §2"):
  - it("returns paths whose current hash ≠ afterRef manifest (modified since agent_end)")
  - it("returns a path that existed at afterRef but is gone now (deleted since) as dirty")
  - it("returns a path absent from afterRef but existing now as dirty (conservative)")
  - it("returns [] when all paths match the afterRef manifest (clean)")
  - it("returns [] for null/empty afterRef and for empty paths")
  - it("returns [] when the afterRef manifest is missing/corrupt (best-effort allow)")
  - it("never rejects on any error (returns [])")
  - it("skips dangerous paths (never reported)")

describe("CasBackend.restore — spec/14 §6 + §2"):
  - it("writes pre-span blob content back for each existed:true file (reverted[])")
  - it("a per-path read/write failure lands in failed[]; restore still resolves (never rejects)")
  - it("neither flag set ⇒ returns 5 empty buckets, touches nothing")
  - it("explicit-paths: deletes existed:false manifest entries when deleteCreatedFiles && allowDeleteCreatedFiles (deleted[])")
  - it("TWO-FLAG AND: deleteCreatedFiles:false ⇒ zero deletions even if allowDeleteCreatedFiles:true")
  - it("TWO-FLAG AND: allowDeleteCreatedFiles:false ⇒ zero deletions even if deleteCreatedFiles:true")
  - it("'cas' mode: tree-walk-deletes files present-now but NOT in beforeRef manifest (deleted[])")
  - it("explicit-paths: does NOT tree-walk (a present-not-in-manifest file is left untouched)")
  - it("never deletes a dangerous path (.git/node_modules) — gated by isDangerousWorkspaceRel")
  - it("delete of an already-gone file (ENOENT) is silent (not failed[])")
  - it("missing/corrupt beforeRef manifest ⇒ returns 5 empty-ish buckets, never rejects")

describe("CasBackend.has — spec/14 §2"):
  - it("returns true for an existing manifest ref")
  - it("returns false for a missing ref; never rejects")

describe("CasBackend.retire — spec/14 §2/§5"):
  - it("unlinks the manifest file (subsequent has(ref) → false)")
  - it("a 2nd retire (ENOENT) is a silent no-op; never rejects")
  - it("blob files persist after retire (mark-sweep deferred to P3 GC)")
```

### Level 3: Integration Testing (System Validation)

```bash
# S3 is a UNIT-tier task (spec/10 §1 Tier 1 — fakes, no Pi). There is NO service to start. The
# end-to-end non-git revert flow is validated by the F-revert-cas / F-revert-explicit /
# F-revert-dirtyguard integration scenarios in P5.M1.T1.S2 (Tier 2 — real temp dirs, real fs).
# S3 does NOT add those.

# Smoke (optional, manual): exercise realFs against a temp non-git dir to confirm the real bindings:
tmp=$(mktemp -d) && mkdir -p "$tmp/src" && printf 'original\n' > "$tmp/src/a.ts"
node --input-type=module -e "
import { CasBackend } from './src/snapshot/cas.js';
const ep = { enabled:true, allowDeleteCreatedFiles:true, nonGitMode:'explicit-paths', storageDir:null,
  maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
  excludeGlobs:['.git','node_modules','dist','build','.next','.venv','target'] };
const store = new CasBackend('$tmp', ep, '$tmp/.mulligan');
const before = await store.capture('turn', ['src/a.ts']);          // explicit-paths capture
const fs = await import('node:fs/promises');
await fs.writeFile('$tmp/src/a.ts', 'CHANGED BY AGENT\n');          // simulate the span
const res = await store.restore(before, { revertFileChanges:true, deleteCreatedFiles:false });
console.log('restore=', JSON.stringify(res));
console.log('content=', await fs.readFile('$tmp/src/a.ts','utf8')); // expect 'original\n'
console.log('has=', await store.has('turn'));                       // expect true
await store.retire('turn');
console.log('has-after-retire=', await store.has('turn'));          // expect false
"
# Expected: restore.reverted=['src/a.ts'] ; content='original\n' ; has=true ; has-after-retire=false.
rm -rf "$tmp"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Parity spot-check (§4.3 mandates backend parity): diff the dirtyCheck/restore/retire mutex idiom +
# best-effort catch shapes between cas.ts and git.ts — they must be structurally identical (only the
# op body differs: CAS uses hash compare + walkTree/unlink; git uses diff/read-tree/checkout/ls-files).
diff <(grep -A3 'mutex.acquire' src/snapshot/git.ts | head -20) \
     <(grep -A3 'mutex.acquire' src/snapshot/cas.ts | head -20)
# Expected: the acquire/finally scaffolding matches. (has is intentionally NOT mutexed in either.)

# Confirm NO edits to locked/owned files (S3 must touch ONLY cas.ts + test/cas.test.ts):
git status --porcelain | grep -E 'store.ts|paths.ts|git.ts|config.ts|markers.ts|runtime.ts|tasks.json|prd_snapshot|PRD.md' \
  && echo "ERROR: S3 touched a locked file" || echo "OK: only cas.ts + test/cas.test.ts changed"
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean (zero errors) — the widened `capture(label, explicitPaths?)` satisfies `implements SnapshotStore`.
- [ ] `npx vitest run test/cas.test.ts` — ALL green (S1 substrate + S2 capture + S3 suite).
- [ ] `lsp_diagnostics src/snapshot/cas.ts` — no diagnostics.
- [ ] No new npm dependencies (only node:fs `unlink` — external_deps.md §2).
- [ ] `.js` import specifiers + `node:` prefixes preserved (vitest/tsc).

### Feature Validation
- [ ] Every "Success Criteria" checkbox is demonstrated by a passing `it()`.
- [ ] explicit-paths capture captures ONLY the explicit path; a not-yet-existing path → existed:false.
- [ ] notifyBashUsed warns once per turn (explicit-paths); no-op in 'cas'.
- [ ] dirtyCheck detects modified/deleted-since-afterRef (and conservative no-baseline-exists) → dirty; clean → [].
- [ ] restore writes pre-span content (reverted[]); deleteCreatedFiles honors TWO-FLAG AND + is mode-aware (explicit-paths: existed:false entries; 'cas': walkTree); never rejects.
- [ ] has/retire are correct + best-effort; has is NOT mutex-serialized; retire's 2nd call is silent.

### Code Quality Validation
- [ ] dirtyCheck/restore/retire mutex idiom + best-effort shapes mirror git.ts (backend parity, §4.3).
- [ ] JSDoc on captureExplicitPaths/dirtyCheck/restore/has/retire/notifyBashUsed cites `@14 §4.2`/`§4.3`/`§6` (docs ride WITH the work — work-item DOCS clause).
- [ ] No edits to store.ts, paths.ts, git.ts, config.ts (and NO edits to PRD.md/tasks.json/prd_snapshot.md/.gitignore).
- [ ] No edits to S2's 'cas' capture walk body (only the widened signature + the inserted dispatch above it).

### Documentation & Deployment
- [ ] captureExplicitPaths JSDoc explains: bounded scope, existed:false for not-yet-existing paths, bash-not-captured (cross-ref notifyBashUsed), caps→partial.
- [ ] restore JSDoc explains the mode-aware deleteCreatedFiles (explicit-paths existed:false vs 'cas' walkTree) + the "present-now ≈ afterRef" reconciliation (no afterRef param).
- [ ] retire JSDoc notes blob mark-sweep is deferred to the prompt-boundary GC (P3, §5).

---

## Anti-Patterns to Avoid
- ❌ Don't edit store.ts — the interface (incl. `restore(beforeRef, opts)` with NO afterRef) is LOCKED. Resolve "after-manifest but not before" MODE-AWARE inside restore (research D2).
- ❌ Don't acquire the mutex in `has` — §4.3 omits it; git.ts deliberately does not serialize it. Parity.
- ❌ Don't tree-walk in explicit-paths restore's deleteCreatedFiles — explicit-paths is conservative (only touches captured paths); its created files are the `existed:false` manifest entries. Walking would over-delete.
- ❌ Don't break S2's 'cas' capture walk — insert the explicit-paths dispatch ABOVE it (after the count-cap gate), leave the walk body untouched.
- ❌ Don't re-acquire the mutex / re-check capturesThisTurn inside captureExplicitPaths — it runs inside capture's mutex + try.
- ❌ Don't reject from any method — dirtyCheck→[], restore→5-bucket result, has→false, retire→void, capture→null. Per-path failures → failed[] (restore still resolves).
- ❌ Don't delete a file not provably created during the span (§6 step 6) — the isDangerousWorkspaceRel gate + the existed:false / not-in-beforeRef checks enforce this.
- ❌ Don't store a blob for an existed:false path — there is no content (the file doesn't exist yet); hash:"" + no storeBlob call.
- ❌ Don't implement blob mark-sweep in retire — it is the prompt-boundary GC pass (P3); retire only drops the manifest ref.
- ❌ Don't use sync fs (`accessSync`/`unlinkSync`) — the interface is async + mutex-serialized; blocking freezes the Pi event loop.
- ❌ Don't forget to add `unlink` to EVERY test fake you build — S3's restore tests call `this.fs.unlink`; a fake without it throws TypeError.

---

## Confidence Score: 9/10

**Why high**: S1 shipped the entire substrate (manifest types, blob store, hashContent/storeBlob/
readBlob/manifestPath, mutex, DI seam). S2 ships capture + walkTree + loadPrevEntries + capturesThisTurn
+ readdir — all directly reused by S3. git.ts is a complete, validated reference for EVERY shared idiom
(mutex acquire/finally, best-effort catch shapes, has-not-mutexed, restore two-flag-AND + per-path
failed[] + resolveSafeWorkspacePath safety). The genuinely new logic is: (a) the explicit-paths
capture loop (a few branches, fully specified above), (b) the dirtyCheck hash-compare, (c) the
mode-aware restore delete. Each is pinned by the work-item contract + §4.2/§6 + the git.ts precedent.
The one design tension (restore has no afterRef yet the work-item references the after-manifest) is
resolved coherently by the mode-aware deleteCreatedFiles (research D2) — explicit-paths uses the
manifest's existed:false entries (an S1 contract), 'cas' uses walkTree-present-not-in-beforeRef (the
git.ts ls-files--others analog).

**Residual risk (the 1 point)**: the manifest-aware test fake is the most involved piece — it must
model a worktree Map + a blob-store Map + a manifests Map + support unlink/readdir(S2), AND the
restore tests must drive capture→mutate-worktree→restore round-trips. If the fake's readFile/writeFile
blob-vs-worktree routing is wired wrong, the restore round-trip test is vacuous. Mitigated by spelling
out the fake's three-Map responsibilities + the capture-then-mutate-then-restore test shape in Task 9.

---

## Output Location (confirmed)
- PRP: `plan/008_c36fd26768ae/P2M3T1S3/PRP.md` ✓
- Research: `plan/008_c36fd26768ae/P2M3T1S3/research/notes.md` ✓