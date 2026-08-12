# Research Findings — P1.M4.T1.S3 (CasBackend.changedPaths, BUG-004 cas slice)

## Item
Add `async changedPaths(beforeRef: string): Promise<string[]>` to `CasBackend` (`src/snapshot/cas.ts`).
Returns workspace-rel POSIX paths differing between the `beforeRef` manifest and the CURRENT tree —
the spec-mandated affected set for the dirty guard (spec/14 §6 step 2, BUG-004). Mode-aware: `'cas'`
walks the tree; `'explicit-paths'` checks manifest entries only. Mutex-serialized, best-effort.

## Chain / contract dependencies (CONFIRMED via PRP reads)
- **S1 (DONE)**: `SnapshotStore.changedPaths(beforeRef): Promise<string[]>` declared on the interface
  (store.ts:112) + NoOpStore stub (store.ts:373). JSDoc footer "IMPLEMENTED BY: git/cas.". Also hardened
  4 `as CasBackend` casts → `as unknown as CasBackend` (capture.ts ×3, revert-explicit.test.ts ×1).
- **S2 (IN-FLIGHT, parallel)**: `GitBackend.changedPaths` via `git diff --name-only <beforeRef>`.
  Treat as a CONTRACT — assume it lands. After S2: 1 typecheck error remains (cas.ts).
- **THIS ITEM (S3)**: resolves the cas.ts TS2420 → typecheck = 0 errors (assuming S2 landed git.ts).
- **P1.M4.T2.S1 (future)**: wires `await store.changedPaths(checkpoint.beforeRef)` into rewind.ts:849,
  replacing `ledger.modifiedFiles`. NOT this item.

## Key files examined
- `src/snapshot/cas.ts` — CasBackend (1110 lines). Methods: capture, appendExplicitPath, dirtyCheck,
  restore, has, retire, gc, destroy. Helpers: hashContent, storeBlob, readBlob, blobPath, manifestPath,
  loadPrevEntries, walkTree, captureExplicitPaths, notifyBashUsed.
- `src/snapshot/store.ts` — interface (changedPaths at :112) + NoOpStore stub (:373). Read-only here.
- `test/cas.test.ts` — 2679 lines. Two test-helper families (see below).

## EXACT sibling pattern to clone: CasBackend.dirtyCheck (the structural template)
```
async dirtyCheck(afterRef, paths): Promise<string[]> {
  const release = await this.mutex.acquire();        // spec §4.3
  try {
    if (!afterRef || paths.length === 0) return [];  // empty-input guard
    let manifest: CasManifest;
    try {
      const buf = await this.fs.readFile(this.manifestPath(afterRef));
      manifest = parseManifest(buf.toString("utf8")); // throws on bad version
    } catch {
      return [];                                      // missing/corrupt ⇒ []
    }
    const dirty: string[] = [];
    for (const rel of paths) {
      if (isDangerousWorkspaceRel(rel)) continue;
      const entry = manifest.files[rel];
      let currentHash: string | null = null; let existsNow = false;
      try {
        const abs = resolveSafeWorkspacePath(this.cwd, rel);
        currentHash = await this.hashContent(await this.fs.readFile(abs));
        existsNow = true;
      } catch { existsNow = false; }
      if (existsNow) { /* dirty if !entry || !entry.existed || hash≠ */ }
      else if (entry && entry.existed) { dirty.push(rel); } // deleted since
    }
    return dirty;
  } catch (err) {
    console.warn(`[mulligan] snapshot.dirtyCheck failed: ${...}`);
    return [];
  } finally { release(); }
}
```
changedPaths clones this EXACTLY. Differences: (a) no `paths` param (it discovers the set itself);
(b) guard is `if (!beforeRef) return [];`; (c) 'cas' mode walks the tree; (d) explicit-paths iterates
`manifest.files` directly.

## 'cas'-mode tree-walk pattern (from restore() cas-mode block, ~line 760)
```
const excludeSet = new Set(this.cfg.excludeGlobs.map((g) => g.toLowerCase()));
await this.walkTree(this.cwd, excludeSet, async (rel, abs, _st) => {
  if (manifest.files[rel]) return; // ... restore uses this for deleteCreatedFiles
  ...
});
```
walkTree signature: `(absDir, excludeSet, visit)` where `visit(rel, abs, st: {size, mtimeMs})`.
walkTree ALREADY prunes dangerous dirs (.git/.pi/node_modules) + excludeGlobs + symlinks.

## Helpers confirmed (signatures + semantics)
- `this.manifestPath(ref)` → `join(storageDir, "manifests", `${ref}.json`)` (private; ref===label).
- `parseManifest(json)` → CasManifest; THROWS on `version !== 1` (the corrupt-manifest backstop).
- `this.hashContent(Buffer)` → Promise<string> (sha256 hex). Async (kept stable for future hash swap).
- `this.fs.readFile(abs)` → Promise<Buffer> (CasFs; no encoding arg).
- `resolveSafeWorkspacePath(cwd, rel)` → abs string; THROWS on `..`/absolute escape.
- `isDangerousWorkspaceRel(rel)` → boolean (.git/.pi/node_modules/escape safety floor).
- `this.cfg.nonGitMode` → "cas" | "explicit-paths". `this.cfg.excludeGlobs` → string[].

## CRITICAL DESIGN DECISION — NO mtime/size short-circuit
`CasManifestEntry` has {hash, size, mtime}. capture() uses (size,mtime) to skip re-hash. changedPaths
MUST NOT: a tool that mutates content while preserving (size, mtime) (e.g. `touch -d`-prefixed writes,
some editors) would evade detection → re-open the E30 silent-clobber hole this method exists to close.
Full content-hash compare only. dirtyCheck (the sibling) also does full hashing. Document explicitly.

## existed:false handling (verified against dirtyCheck + captureExplicitPaths)
- explicit-paths manifests CAN contain existed:false entries (a path snapshotted just before its
  creating write — hash:"", size:0, mtime:0).
- existsNow && currentHash≠entry.hash ⇒ changed. For an existed:false entry that now exists, entry.hash
  is "" and currentHash is a real hex ⇒ the hash-compare branch flags it changed NATURALLY (no special case).
- !existsNow && entry.existed ⇒ deleted since beforeRef ⇒ changed.
- !existsNow && !entry.existed ⇒ absent then, absent now ⇒ NOT changed (skip).
- 'cas' mode: capture writes existed:true for every file (whole-tree), but the hash compare is robust
  to existed:false if it ever appears.

## Two test-helper families (CONFIRMED — critical for accurate test tasks)
1. **makeStateFs / makeStateBackend** — FLAT worktree `Record<string, Buffer>`. `readdir` THROWS
   ("not modeled (explicit-paths does not walk)"). Has `.set/.remove/.read/.exists/.manifestOf/.blob`.
   → use for EXPLICIT-PATHS mode tests + best-effort/missing-manifest tests (mirrors dirtyCheck tests).
2. **makeTreeFs / makeTreeBackend** — TREE worktree `TreeSpec = Record<string, {content:Buffer; mtimeMs:number}|"dir">`.
   Supports readdir (derives childMap from keys). Returns `{ cb, fakeFs, readCalls }`.
   → use for 'CAS' MODE tests (requires walkTree ⇒ readdir).
   NOTE: makeTreeFs is built at construction; to simulate a post-capture tree mutation (new/deleted
   file), mutate `fakeFs` via the existing restore 'cas'-mode test's hand-rolled approach (lines ~1175+)
   OR construct two trees. The capture 'cas'-mode tests (lines 419-484) mutate `tree["a.ts"].mtimeMs`
   BEFORE construction; for changedPaths we need post-capture mutation — see the restore cas-mode test
   for the `childMap`-mutation pattern, or use makeStateBackend for explicit-paths where possible.

## BASE_CFG (test fixture, line 46)
`{ enabled:true, allowDeleteCreatedFiles:false, nonGitMode:"cas", storageDir:"/fake/store",
   maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64, excludeGlobs:[".git","node_modules"] }`

## Placement
After `dirtyCheck()`'s closing brace, BEFORE `restore()`'s JSDoc — matches the interface order in
store.ts (dirtyCheck → changedPaths → restore) AND mirrors S2's GitBackend placement ("after dirtyCheck,
before has"; cas has restore between dirtyCheck and has, so "after dirtyCheck, before restore").

## Typecheck gate (the handoff)
- Before S3: 1 error (cas.ts TS2420 "Property 'changedPaths' is missing"), assuming S2 landed git.ts.
- After S3: 0 errors. If a git.ts error remains, that is S2 in-flight — NOT a defect in this item.
- No cast changes needed here (S1 already converted the 4 `as CasBackend` casts to double-cast; the
  CasBackend subtype relationship is RESTORED the instant S3 adds the method).