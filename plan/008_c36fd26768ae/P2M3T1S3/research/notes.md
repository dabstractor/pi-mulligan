# Research Notes — P2.M3.T1.S3 (CAS explicit-paths + dirtyCheck + restore + retire + has)

## What S3 consumes (contracts already shipped / in-flight)

### S1 (DONE — in src/snapshot/cas.ts today)
- `CasManifest { version:1; label; turnIndex; ts; files: Record<relPath, CasManifestEntry> }`
- `CasManifestEntry { hash; size; mtime; existed }` — **`existed:false ⇒ restore DELETES the file** (S1 JSDoc contract).
- `serializeManifest(m): string` / `parseManifest(json): CasManifest` (throws on version≠1).
- `CasFs` DI seam: readFile→Buffer, writeFile(Buffer), mkdir(recursive), access(rejects if absent), stat→{size,mtimeMs}. **NO readdir (S2 adds), NO unlink (S3 adds).**
- `realFs` binds node:fs/promises. `CasBackendDeps { fs? }`.
- `CasBackend` class: `cwd`, `cfg: MulliganConfig["revert"]`, `storageDir`, `sessionDir`, `mutex = new AsyncMutex()`, `fs`. Helpers `hashContent(buf)→sha256hex`, `blobPath(hash)=<storageDir>/blobs/<2hex>/<hash>`, `manifestPath(label)=<storageDir>/manifests/<label>.json`, `storeBlob(buf)` (deduped via access), `readBlob(hash)`.
- Throwing STUBS for capture/dirtyCheck/restore/has/retire.

### S2 (in-flight — PRP is the contract) — builds on S1
- ADDS `readdir(path,{withFileTypes:true}): Promise<Dirent[]>` to CasFs + realFs + `readdir as fsReaddir` import.
- ADDS `private capturesThisTurn = 0` (reset by P3 at turn boundary; parity w/ git.ts).
- ADDS private `loadPrevEntries(label)→Map<rel,{hash,size,mtime}>` (best-effort, empty on miss/corrupt).
- ADDS private `walkTree(absDir, excludeSet, visit(rel,abs,st))` (readdir→normalizeRelPath→isDangerous→excludeGlob→dir-recurse|file-stat→visit; best-effort, never throws).
- REPLACES capture stub: `async capture(label:string): Promise<string|null>` for **'cas' mode** (whole-tree walk + mtime/size short-circuit + dedupe + caps→partial/maxSnapshots→null + best-effort→null). Signature is `capture(label)` — **NO explicitPaths param**.

## S3 design decisions (resolved tensions)

### D1 — capture signature widening (explicit-paths needs the path list)
- LOCKED interface (store.ts S1): `capture(label: string): Promise<string|null>`. NOT editable.
- S2 implements `capture(label)` for 'cas'. S3 must support `capture(label, explicitPaths?)`.
- **Resolution**: widen CasBackend's concrete method to `capture(label: string, explicitPaths?: string[])`. TS-legal — a method with an EXTRA OPTIONAL param is assignable to the interface method. **NO edit to store.ts.** Insert a mode-dispatch at the top of S2's capture body (after mutex acquire + count-cap): `if (cfg.nonGitMode==="explicit-paths") return this.captureExplicitPaths(label, explicitPaths);`. S2's whole-tree walk becomes the implicit else. The P3 hook calls it on a CasBackend-typed ref (or casts).

### D2 — restore has NO afterRef param, yet work-item references "the after-manifest"
- restore signature LOCKED: `restore(beforeRef, opts)`. git.ts resolved identical tension: "present-now ≈ afterRef at restore time" (dirty guard already refused drift).
- **CAS resolution is MODE-AWARE** (the key design decision):
  - **explicit-paths**: the beforeRef manifest itself carries `existed:false` entries for files created during the span (the P3 tool_call hook captures a not-yet-existing path just before the creating write). So deleteCreatedFiles = unlink every `existed:false` manifest entry. **NO tree walk** (conservative model — only touches captured paths; bash-created files correctly untouched/not-promised).
  - **'cas'**: capture is comprehensive (walks tree, existed:true for all present files; created-during-span files are NOT in beforeRef). So deleteCreatedFiles = **walkTree**, unlink files present-now but NOT in beforeRef manifest (gated by isDangerous + excludeGlobs) — mirrors git.ts `ls-files --others`.
  - revertFileChanges (both modes): for each `existed:true` manifest entry → readBlob(hash)+writeFile(abs) → reverted/failed. `existed:false` entries have no pre-span content → skip under revertFileChanges (deletion is the deleteCreatedFiles concern).

### D3 — dirtyCheck "no manifest entry" path
- Work item: "for each path in `paths`, re-hash current; return paths where hash differs (or file no longer exists)."
- **Resolution** (conservative, mirrors git diff): for each path — hash current; if entry missing AND file exists now → dirty (can't prove clean); if entry.existed && hash differs → dirty; if entry.existed && file gone now → dirty (deleted since afterRef); if entry.existed===false && file exists now → dirty (created since afterRef). Clean otherwise. Best-effort → [] on any error / null afterRef / empty paths / missing-corrupt manifest.

### D4 — has NOT mutex-serialized (parity with git.ts)
- git.ts JSDoc: "spec §4.3 omits has from the serialized list — fast read-only existence check." PRD §4.3 lists "capture/dirtyCheck/restore/retire/gc" (no has). CAS `has` mirrors: `fs.access(manifestPath(ref))→true`, catch→false, **NO mutex**. Best-effort.

### D5 — retire: unlink manifest; blob GC DEFERRED
- Work item: "unlink the manifest. Optionally mark-sweep unreferenced blobs." Mirrors git.ts retire (update-ref -d lets `git gc` reclaim objects later). CAS retire = `unlink(manifestPath(ref))`; ENOENT→silent; blob mark-sweep is the prompt-boundary GC pass (P3, §5) — S3 leaves a documented TODO. Mutex-serialized (retire IS in §4.3's list).

### D6 — bash-not-captured warning mechanism
- Work item: "Log a once-per-turn warning when bash is detected but not captured." Bash DETECTION is an event-level concern (P3 hook sees tool_call events). S3 provides the SEAM: `notifyBashUsed()` method + `bashWarnedThisTurn` field. P3 hook calls it when a bash tool_call runs in explicit-paths mode. The method (if mode==="explicit-paths" && !bashWarnedThisTurn) emits `console.warn([...])` + sets the flag. Reset by P3 at turn boundary (like capturesThisTurn).

### D7 — CasFs gains `unlink` (S3 additive, like S2's readdir)
- external_deps.md §2 lists `fs.promises.unlink` (restore deleteCreatedFiles). S3 ADDS `unlink(path): Promise<void>` to CasFs + realFs + `unlink as fsUnlink` import.

## Parity reference (git.ts dirtyCheck/restore/has/retire) — behavior to mirror
- dirtyCheck: `mutex.acquire → try { ensureInit; if(!afterRef||!paths.length) return []; <op>; return result } catch { warn; return [] } finally { release }`.
- has: `try { ensureInit; <op>; return true } catch { return false }` — NO mutex, best-effort.
- retire: `mutex.acquire → try { <op> } catch { warn } finally { release }` — best-effort void.
- restore: `mutex.acquire; result=5-empty-buckets; try { if(!revertFileChanges&&!deleteCreatedFiles) return result; <read-tree>; <revert MD>; <delete others — TWO-FLAG AND opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles> } catch { warn; return result } finally { release }`. Per-path failures → failed[]; never rejects.

## Key files (exact paths)
- src/snapshot/cas.ts — EDIT (S3): unlink to CasFs/realFs; capture widening + captureExplicitPaths; notifyBashUsed+bashWarnedThisTurn; replace dirtyCheck/restore/has/retire stubs.
- src/snapshot/store.ts — READ ONLY (locked interface; RestoreOpts/RestoreResult/AsyncMutex).
- src/snapshot/paths.ts — READ ONLY (normalizeRelPath, isDangerousWorkspaceRel, resolveSafeWorkspacePath, DANGEROUS_DIRS).
- src/snapshot/git.ts — READ (parity reference; restore/dirtyCheck/has/retire bodies).
- src/config.ts — READ (revert block: nonGitMode, allowDeleteCreatedFiles, maxFileBytes, maxTotalBytes, excludeGlobs).
- test/cas.test.ts — EXTEND: S3 suite (dirtyCheck/restore/has/retire/explicit-paths capture/bash warn). Reuse BASE_CFG + makeBackend + recording-fake idiom from S1; add unlink to fakes.
- test/git.test.ts — READ (test-pattern reference: mutex test, two-flag-AND delete tests, per-path-failure tests).

## Config facts (src/config.ts)
- nonGitMode: "cas" (default) | "explicit-paths".
- allowDeleteCreatedFiles: false (default).
- maxFileBytes: 262144; maxTotalBytes: 33554432; maxSnapshotsPerTurn: 64.
- excludeGlobs: [".git","node_modules","dist","build",".next",".venv","target"].

## Tooling
- test: `npx vitest run` (vitest run). typecheck: `npx tsc --noEmit`. lint via prettier (check repo). No eslint script (only typecheck+test in prepublishOnly).

## Scope guard (what S3 does NOT do)
- NO edits to store.ts (locked interface), paths.ts, git.ts, config.ts.
- NO capture lifecycle hooks (P3.M1.T1), NO rewind integration (P4.M2.T1), NO prompt-boundary GC (P3), NO integration scenarios (P5).
- S3 implements ONLY: explicit-paths capture mode + dirtyCheck + restore + has + retire + the bash-warning seam, in cas.ts, + their unit tests in test/cas.test.ts.