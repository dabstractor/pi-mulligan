# PRP — P2.M3.T1.S2: CAS `'cas'` mode whole-tree capture with mtime short-circuit

**Spec refs**: spec/14-working-tree-revert.md §4.1 (`"cas"` whole-tree), §4.3 (AsyncMutex + path safety + caps), §5 (capture lifecycle + retention + caps→partial), spec/08 E29 (caps exceeded). architecture/external_deps.md §2 (CAS fs APIs + manifest + mtime short-circuit). JSDoc cites `@14 §4.1` on `capture()`.

---

## Goal

**Feature Goal**: Implement `CasBackend.capture(label)` — the `'cas'` non-git mode's comprehensive
whole-tree snapshot: walk `cwd`, stat every non-excluded file, dedupe content into the content-addressed
blob store, write a manifest to `<storageDir>/manifests/<label>.json`, and return `label` as the ref.
Steady-state I/O is **O(changed-files)** via a `(mtime,size)` short-circuit against the previous manifest.

**Deliverable**: A working `capture()` method in `src/snapshot/cas.ts` (replacing the S1 throwing stub)
plus two private helpers (`walkTree`, `loadPrevEntries`), three small additive edits (CasFs gains
`readdir`; `realFs` binds it; the class gains `capturesThisTurn`), and a suite of capture tests added
to `test/cas.test.ts`. dirtyCheck/restore/has/retire remain S3 throwing stubs — untouched.

**Success Definition**: `capture("turn")` on a non-git workspace produces a manifest whose `files` map
keys every allowed file to `{hash,size,mtime,existed:true}`; identical content stored once (dedupe);
a second `capture("turn")` with no file changes re-reads/hashes **zero** files (mtime short-circuit);
oversize files and `excludeGlobs`/dangerous dirs are skipped+warned; `maxTotalBytes` yields a PARTIAL
manifest (not an abort) while `maxSnapshotsPerTurn` aborts to `null`; any thrown error → `null`
(best-effort, never rejects). Backend parity with `GitBackend` (spec §4.3) is preserved (same mutex
idiom, same caps semantics, same `capturesThisTurn` field).

## User Persona

**Target User**: Implementer agent (this PRP's consumer). End users never call capture directly — the
P3 lifecycle hooks (`turn_start`/`agent_end`/`/mulligan_checkpoint`) call it on their behalf.

**Use Case**: A workspace with NO git repo (or a non-writable `.git`) needs working-tree file revert
on `mulligan_rewind`. The CAS backend is the universal fallback; `capture()` produces the
before/after/checkpoint snapshots restore reads.

**Pain Points Addressed**: Without CAS capture, non-git workspaces have no file-revert (fail-open to
`NoOpStore`). This task delivers the comprehensive whole-tree mode that makes non-git revert as
complete as git-backed revert (no untracked-file gotcha — §4.1).

---

## Why

- **Completeness parity**: `'cas'` is the DEFAULT `nonGitMode`. It captures the whole working set
  (tracked + untracked + gitignored-minus-excludes) so non-git users get the same revert guarantees as
  git users. §4.1.
- **Efficiency**: The mtime/size short-circuit (git's index-refresh trick) makes steady-state capture
  O(changed-files) I/O + O(working-set) stats — cheap enough to run at every prompt boundary. §4.1.
- **Foundation for P3/P4**: P3.M1.T1 calls `capture("turn")`/`capture("turn-after")`; P3.M2.T1 calls
  `capture("ckpt:<name>")`; P4.M2.T1.S2's restore consumes the manifest. This task unblocks all of them.
- **Scope guard**: S2 implements ONLY `capture()` + its walk. It does NOT implement dirtyCheck/restore/
  has/retire (S3) NOR the lifecycle hooks (P3) NOR the rewind integration (P4). Stay in lane.

---

## What

`async capture(label: string): Promise<string | null>`:

1. Acquire the per-instance `AsyncMutex`. Whole body in `try { … } catch { warn; return null } finally { release() }`.
2. **Cap — count**: `if (this.capturesThisTurn >= this.cfg.maxSnapshotsPerTurn)` → `console.warn` + `return null`.
3. **Load previous manifest** for `label` (`<storageDir>/manifests/<label>.json`) into a `Map<relPath,{hash,size,mtime}>` for the short-circuit. Missing/corrupt → empty map (no short-circuit; silent — first capture).
4. **Walk** `cwd` recursively (`this.fs.readdir(dir,{withFileTypes:true})` + `this.fs.stat`):
   - skip `isDangerousWorkspaceRel(rel)` (`.git`/`.pi`/`node_modules`/`..`/NUL/dir-marker) — PRUNE subtree.
   - skip any `rel` whose `/`-segments case-insensitively hit `excludeGlobs` (perf filter) — PRUNE subtree.
   - dir → recurse; file → stat; symlink/socket → ignore (only `isFile()` captured).
   - **oversize** (`stat.size > cfg.maxFileBytes`) → `console.warn` + skip (fail-closed).
   - **mtime/size short-circuit**: if prev entry exists AND `prev.size === stat.size && prev.mtime === stat.mtimeMs` → reuse `prev.hash`, write entry, **NO** read/hash/store.
   - **byte budget**: `if (totalBytes + stat.size > cfg.maxTotalBytes)` → set `partial=true`, `console.warn`, skip this file (and stop accepting new data). **DO NOT abort** — continue the walk, return the label.
   - else `readFile` → `hashContent` → `storeBlob` (deduped) → entry `{hash, size:stat.size, mtime:stat.mtimeMs, existed:true}`; `totalBytes += stat.size`.
5. Build `CasManifest { version:1, label, turnIndex:0, ts:Date.now(), files }`; `mkdir -p <storageDir>/manifests`; `writeFile(manifestPath(label), Buffer.from(serializeManifest(m),"utf8"))`.
6. `this.capturesThisTurn++`; if `partial`, `console.warn` the partial notice. **Return `label`** (the ref === the manifest label; `<storageDir>/manifests/<label>.json` is resolvable by S3).
7. **Any thrown error → `console.warn` + `return null`** (best-effort; capture NEVER rejects).

### Success Criteria

- [ ] `capture("turn")` walks cwd, stores every allowed file's content (deduped), writes `manifests/turn.json`, returns `"turn"`.
- [ ] A second `capture("turn")` with NO file changes reuses every hash via mtime/size match — `readFile` is NOT called for any unchanged file; manifest hashes identical to the first.
- [ ] A file with changed `mtimeMs` (or size) IS re-read/re-hashed/re-stored.
- [ ] `excludeGlobs` segments and dangerous dirs (`.git`/`.pi`/`node_modules`) are absent from the manifest.
- [ ] Oversize file (`size > maxFileBytes`) is skipped + warned; not in manifest.
- [ ] `maxTotalBytes` exceeded → manifest is PARTIAL (files beyond budget skipped; earlier files present); `capture` STILL returns the label (NOT null).
- [ ] `capturesThisTurn >= maxSnapshotsPerTurn` → `capture` returns `null` (abort; no walk).
- [ ] `readFile`/`readdir`/`stat`/`writeFile` errors → `capture` returns `null`, never rejects.
- [ ] Mutex serializes concurrent `capture()` (max-in-flight 1).
- [ ] `lsp_diagnostics` / `tsc --noEmit` clean; `test/cas.test.ts` green.

---

## All Needed Context

### Documentation & References

```yaml
# MUST READ — the authoritative mode description (this task IS §4.1's capture)
- file: spec/14-working-tree-revert.md
  why: §4.1 (cas whole-tree + mtime short-circuit + dedupe), §4.3 (AsyncMutex + path safety + caps),
       §5 (capture lifecycle + caps→partial semantics + retention), §9 (E27/E29 one-liners)
  critical: §4.1 line 115 "if (mtime,size) matches the previous manifest, reuse its hash and skip
       re-read/re-hash". §5 "when [caps] hit, capture stops accepting new data and the snapshot is
       marked partial; restore degrades to best-effort (skipped[])".

- file: plan/008_c36fd26768ae/architecture/external_deps.md
  why: §2 lists the exact node:fs/promises APIs (readdir/stat/readFile/writeFile) + the manifest JSON
       shape + the mtime/size short-circuit one-liner.
  pattern: manifest = { version:1, label, turnIndex, ts, files: { relPath: {hash,size,mtime,existed} } }

# THE CONTRACT this PRP consumes (S1 shipped it; S2 builds on it)
- file: plan/008_c36fd26768ae/P2M3T1S1/PRP.md
  why: defines CasBackend skeleton + CasManifest/CasManifestEntry/CasFs/serializeManifest/parseManifest/
       storeBlob/hashContent/blobPath/manifestPath. S2 REPLACES the capture stub + adds readdir/capturesThisTurn.
  gotcha: S1's CasFs has NO readdir and the class has NO capturesThisTurn — S2 ADDS both (see Tasks 1-3).

# THE SIBLING to mirror for backend parity (spec §4.3 mandates identical mutex/caps idioms)
- file: src/snapshot/git.ts
  why: the AsyncMutex acquire/finally idiom; the best-effort try/catch→console.warn+null; the
       capturesThisTurn field (line 195, "reset by lifecycle P3 at turn boundary"); the scanForCaps
       walk structure (readdir/normalizeRelPath/isDangerous/excludeGlob-segment/stat) CAS mirrors.
  pattern: see "scanForCaps" in git.ts — CAS's walkTree mirrors its dir/segment/stat logic but adds
       read+hash+store + mtime-check inline (scanForCaps returns sizes only, so CAS cannot REUSE it).
  gotcha: git.ts ABORTS on maxTotalBytes (atomic add/commit). CAS must NOT — it is file-by-file and
       returns a PARTIAL manifest. (work item: "stop accepting new data, mark partial".)

- file: src/snapshot/store.ts
  why: the SnapshotStore interface (async capture(dirtyCheck/restore/has/retire are S3 — UNTOUCHED);
       AsyncMutex class; RestoreOpts/RestoreResult types).
  pattern: capture signature is `Promise<string | null>` (async). AsyncMutex.acquire() returns a release fn.

- file: src/snapshot/paths.ts
  why: PURE helpers S2 consumes unchanged — normalizeRelPath (manifest keys), isDangerousWorkspaceRel
       (safety floor), DANGEROUS_DIRS. NO edits to paths.ts.
  pattern: rel = normalizeRelPath(this.cwd, abs); if (isDangerousWorkspaceRel(rel)) continue;

- file: src/config.ts
  why: the 8-field `MulliganConfig["revert"]` block S2 reads via `this.cfg`.
  critical: maxFileBytes=262144, maxTotalBytes=33554432, maxSnapshotsPerTurn=64,
       excludeGlobs=[".git","node_modules","dist","build",".next",".venv","target"], nonGitMode="cas".

- file: test/git.test.ts
  why: the test idiom to mirror — vitest flat describe/it, BASE_CFG fixture (lines 19-29), the mutex
       max-in-flight-1 test (line 299), the caps tests (lines 250-296).
  pattern: inject a recording fs fake via `new CasBackend(cwd, cfg, null, { fs: fake })`.
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  store.ts      # SnapshotStore interface (async) + AsyncMutex + detectAndCreate + NoOpStore — S2 reads
  paths.ts      # PURE: normalizeRelPath, isDangerousWorkspaceRel, DANGEROUS_DIRS — S2 reads, NO edits
  git.ts        # GitBackend — the SIBLING whose mutex/caps/walk patterns S2 mirrors (parity, §4.3)
  cas.ts        # ← S2 EDITS: replace capture stub; add readdir/CasFs, realFs binding, capturesThisTurn, walkTree, loadPrevEntries
test/
  cas.test.ts   # ← S2 EXTENDS: add the capture() suite (TreeFs fake + walk/short-circuit/caps/mutex tests)
  git.test.ts   # reference test idiom (vitest flat, BASE_CFG, DI fakes, mutex test)
```

### Desired Codebase tree with files to be added/edited

```bash
src/snapshot/cas.ts     # EDIT (S1 file): replace capture stub; add readdir to CasFs + realFs + Dirent type;
                        #   add `capturesThisTurn` field; add private walkTree + loadPrevEntries
test/cas.test.ts        # EXTEND (S1 file): new describe block "CasBackend.capture" + a TreeFs fake helper
```

No NEW files. S2 edits exactly two existing files (both created by S1).

### Known Gotchas of our codebase & Library Quirks

```typescript
// CasFs (S1) has NO readdir — S2 MUST ADD it (signature: readdir(path, {withFileTypes:true}):
//   Promise<import("node:fs").Dirent[]>) AND bind it in realFs (readdir: fsReaddir). The S1 test fake
//   (minimal Set<string>) does NOT model dirs — S2 builds a richer TreeFs fake for walk tests.

// The class (S1) has NO capturesThisTurn — S2 ADDS `private capturesThisTurn = 0;` mirroring git.ts
//   line 195 EXACTLY (same comment: "reset by lifecycle P3 at turn boundary"). Do NOT add a reset
//   method — parity with git.ts (which also resets in P3) is mandatory (§4.3).

// serializeManifest returns a STRING; CasFs.writeFile takes a Buffer → wrap:
//   await this.fs.writeFile(path, Buffer.from(serializeManifest(m), "utf8"));
// readFile returns a Buffer; parseManifest takes a string → unwrap:
//   const m = parseManifest((await this.fs.readFile(path)).toString("utf8"));

// mtime short-circuit compares stat.mtimeMs (a float ms) + stat.size against the PREV entry for the
//   SAME label. Store mtime as stat.mtimeMs (the float). Compare with ===. The prev manifest is
//   <storageDir>/manifests/<label>.json — consecutive capture('turn') overwrites it; reads the prior.

// maxTotalBytes → PARTIAL, not abort (CAS is file-by-file; git.ts aborts because git is atomic).
//   Skip files beyond the budget, set partial=true, STILL return label. (E29; §5.)
// maxSnapshotsPerTurn → null (count cap aborts; mirror git.ts).

// turnIndex: 0 — the backend has NO turn context (only the P3 lifecycle does); it is metadata only
//   (the label namespaces the manifest). Do NOT try to derive a real index.

// existed: true for EVERY walk-captured file (it is on disk). existed:false is the S3 explicit-paths
//   case (a path captured before it is created). S2 always sets true.

// ref === label. capture returns label. manifestPath(label) resolves it. S3's has/retire/dirtyCheck/
//   restore key off the same label/ref. Do NOT hash the manifest as the ref.

// Symlinks: only entry.isFile() is captured; symlinked dirs are NOT recursed (Dirent.isDirectory()
//   is false for symlinks). Lexical safety is paths.ts; fs-containment is a git.ts/P2 concern — S2
//   mirrors git.ts's walk exactly (same limitation).

// Best-effort: capture NEVER rejects. ONE try/catch around the whole body → console.warn + return null.
//   No sessionId/log.ts at capture time (structured logging arrives in P3) — use console.warn with
//   the `[mulligan] snapshot.capture: <one-liner>: <detail>` prefix (mirror git.ts).

// .js imports + node: prefixes are mandatory (tsc/vitest). cas.ts already imports node:fs/promises
//   as fsReadFile/fsWriteFile/fsMkdir/fsAccess/fsStat — ADD fsReaddir to that import. dirname is
//   already imported (storeBlob uses it). join/resolve already imported.
```

---

## Implementation Blueprint

### Data models and structure

S1 already defines all the models S2 uses — S2 does NOT add types:

```typescript
// (from S1 cas.ts — already exist, S2 consumes)
export interface CasManifestEntry { hash: string; size: number; mtime: number; existed: boolean; }
export interface CasManifest { version: 1; label: string; turnIndex: number; ts: number; files: Record<string, CasManifestEntry>; }
export function serializeManifest(m: CasManifest): string;   // string out
export function parseManifest(json: string): CasManifest;    // string in, throws on bad version
```

S2 adds NO new exported types. The only new surface is the private `capturesThisTurn` field, two
private methods, and the additive `readdir` member on `CasFs`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/snapshot/cas.ts — add `readdir` to the CasFs DI seam
  - ADD to `CasFs` interface (after stat):
      /** readdir({withFileTypes:true}) — S2's capture walks the cwd tree. */
      readdir(path: string, opts: { withFileTypes: true }): Promise<import("node:fs").Dirent[]>;
  - ADD `readdir` to the fs/promises import line (where fsReadFile/fsWriteFile/fsMkdir/fsAccess/fsStat are bound): `import { readdir as fsReaddir, ... } from "node:fs/promises";`
  - ADD to the `realFs` object literal: `readdir: fsReaddir,`
  - WHY: the walk needs Dirent[] (isDirectory()/isFile()/name). S1 deliberately omitted readdir (only
    blob ops needed it). This is a purely additive interface widening — S1's recording fake does not
    break (it stays blob-only; the NEW walk tests use a richer fake — Task 7).
  - GOTCHA: type the return as `import("node:fs").Dirent[]` (inline import) to avoid a top-level type import churn.

Task 2: EDIT src/snapshot/cas.ts — add the `capturesThisTurn` field
  - ADD to the CasBackend class fields (right after `private readonly fs: CasFs;`):
      /** maxSnapshotsPerTurn cap; incremented per successful capture. Reset by lifecycle P3 at turn
       *  boundary (parity with GitBackend — spec §4.3). */
      private capturesThisTurn = 0;
  - WHY: the count cap (Task 4 step 2). Mirror git.ts line 195 verbatim (same comment, same default).
  - GOTCHA: do NOT add a reset method / do NOT reset inside capture — parity with git.ts (P3 owns reset).

Task 3: ADD private `loadPrevEntries(label)` to CasBackend
  - IMPLEMENT: read <storageDir>/manifests/<label>.json; on access-reject or parse throw → return empty
    Map. Else build Map<relPath,{hash,size,mtime}> from m.files. NEVER throws.
  - PATTERN:
      private async loadPrevEntries(label: string): Promise<Map<string, { hash: string; size: number; mtime: number }>> {
        const map = new Map<string, { hash: string; size: number; mtime: number }>();
        try {
          await this.fs.access(this.manifestPath(label));      // rejects if absent → empty map
          const buf = await this.fs.readFile(this.manifestPath(label)); // Buffer (CasFs.readFile)
          const m = parseManifest(buf.toString("utf8"));       // parseManifest takes a STRING
          for (const [p, e] of Object.entries(m.files)) map.set(p, { hash: e.hash, size: e.size, mtime: e.mtime });
        } catch { /* missing label OR corrupt JSON → no short-circuit (full capture). Silent. */ }
        return map;
      }
  - NAMING: `loadPrevEntries` (private). JSDoc cites @14 §4.1 (mtime short-circuit source).
  - PLACEMENT: immediately above the capture() method.

Task 4: ADD private `walkTree(absDir, excludeSet, visit)` to CasBackend
  - IMPLEMENT: recursive walk mirroring git.ts scanForCaps closure structure. readdir → per entry:
    normalizeRelPath → isDangerousWorkspaceRel skip → excludeGlob segment skip → dir recurse | file stat→visit.
    Unreadable dir/file → skip (best-effort). NEVER throws (visitor errors propagate — capture's try/catch catches).
  - PATTERN:
      private async walkTree(
        absDir: string,
        excludeSet: Set<string>,
        visit: (rel: string, abs: string, st: { size: number; mtimeMs: number }) => Promise<void>,
      ): Promise<void> {
        let entries: import("node:fs").Dirent[];
        try { entries = await this.fs.readdir(absDir, { withFileTypes: true }); }
        catch { return; } // unreadable dir → skip subtree (mirror git.ts)
        for (const entry of entries) {
          const abs = join(absDir, entry.name);
          const rel = normalizeRelPath(this.cwd, abs);
          if (isDangerousWorkspaceRel(rel)) continue;            // safety floor — PRUNE
          if (rel.split("/").some((s) => excludeSet.has(s.toLowerCase()))) continue; // perf filter — PRUNE
          if (entry.isDirectory()) await this.walkTree(abs, excludeSet, visit);
          else if (entry.isFile()) {
            let st: { size: number; mtimeMs: number };
            try { st = await this.fs.stat(abs); } catch { continue; } // unreadable file → skip
            await visit(rel, abs, st);
          }
          // symlinks/sockets/etc. → ignored (only real files captured)
        }
      }
  - IMPORTS: needs `join` (already imported), normalizeRelPath + isDangerousWorkspaceRel from "./paths.js" (already imported).
  - GOTCHA: `entry.isDirectory()` is FALSE for symlinks → symlinked dirs are NOT recursed (mirrors git.ts).
  - PLACEMENT: immediately above capture() (after loadPrevEntries).

Task 5: REPLACE the capture() stub with the real implementation
  - FIND: `async capture(_label: string): Promise<string | null> { throw new Error("CasBackend.capture not implemented — see P2.M3.T1.S2"); }`
  - REPLACE WITH the full implementation per "Implementation Patterns" below. JSDoc on capture cites
    `@14 §4.1` (whole-tree + mtime short-circuit) + E29 (caps→partial) + §4.3 (mutex). Parameter name
    changes from `_label` to `label`.
  - STRUCTURE: mutex acquire → try { count-cap gate; load prev; walk with inline visitor (oversize skip,
    short-circuit, byte-budget→partial, else read+hash+store); build manifest; mkdir manifests dir;
    writeFile manifest; capturesThisTurn++; return label } catch { warn; return null } finally { release() }
  - DEPENDENCIES: Tasks 1-4 (readdir, capturesThisTurn, loadPrevEntries, walkTree) all land first.

Task 6: VERIFY — build + type + lint
  - RUN: `npx tsc --noEmit` (or the project's typecheck command — see Validation); `lsp_diagnostics src/snapshot/cas.ts`.
  - EXPECT: zero errors. The `import("node:fs").Dirent` inline type + `.js` imports must resolve.

Task 7: EXTEND test/cas.test.ts — add the capture suite + a TreeFs fake
  - ADD a TreeFs fake helper (module-level in test/cas.test.ts) that models a directory tree + blob store:
      type TreeNode = { type: "dir" } | { type: "file"; content: Buffer; mtimeMs: number };
      function makeTreeFs(files: Record<string, Buffer|{content:Buffer;mtimeMs:number}>, dirs: string[]): CasFs
    The fake's readdir returns Dirent[] synthesized from tracked children (use `new Dirent(name, kind)`
    from node:fs, OR a structural `{ name, isDirectory:()=>…, isFile:()=>… } as unknown as Dirent[]`).
    stat → { size: content.length, mtimeMs }; readFile → content; access/writeFile/mkdir implement blob
    storage in a separate Map (mirror S1's recording fake for the blob ops) AND record reads into a
    Set<absPath> so the short-circuit test can assert readFile was NOT called for unchanged files.
  - ADD a `describe("CasBackend.capture — whole-tree (spec/14 §4.1)", () => { … })` block with the
    it() cases listed under "Level 2" below.
  - FOLLOW pattern: test/git.test.ts (vitest flat, BASE_CFG fixture, `new CasBackend(cwd, cfg, null, {fs})`).
  - COVERAGE: walk+manifest+dedupe, mtime short-circuit (skip read), size-change re-read, excludeGlobs
    skip, dangerous-dirs skip, oversize skip+warn, maxTotalBytes PARTIAL (returns label), maxSnapshotsPerTurn
    null, error→null, capturesThisTurn increment, mutex max-in-flight-1, missing/corrupt prev→full capture.
  - GOTCHA: to test the mtime short-circuit, build a TreeFs where the FIRST capture writes a manifest to
    manifests/turn.json (real blob store via the fake's access/writeFile), then call capture('turn') AGAIN
    with NO mtime change and assert the fake's readFile-was-called Set contains ZERO working-tree paths
    (only the manifest read for loadPrevEntries). Change one file's mtimeMs → assert exactly that path re-read.
```

### Implementation Patterns & Key Details

```typescript
// ── Task 5: the capture() body (replaces the S1 stub). JSDoc cites @14 §4.1 / §4.3 / E29. ──

/**
 * Snapshot the whole working set NOW (the 'cas' default non-git mode) and return `label` as the ref.
 * Walks cwd (minus excludeGlobs + dangerous dirs), stats every file, and:
 *  - reuses the previous manifest's hash when (mtimeMs,size) is unchanged (git's index-refresh trick —
 *    O(changed-files) steady-state I/O, spec/14 §4.1);
 *  - else reads + hashes + stores (deduped) the content into the blob store.
 * Caps (spec §5, E29): maxFileBytes → skip+warn (fail-closed); maxTotalBytes → skip files beyond the
 * budget + mark the manifest PARTIAL (capture STILL returns the label — CAS is file-by-file, not atomic);
 * maxSnapshotsPerTurn → return null (abort). Serialized by the per-instance AsyncMutex (§4.3).
 * BEST-EFFORT: any thrown error → console.warn + return null (never rejects). @14 §4.1.
 * @returns the manifest label (ref === label; <storageDir>/manifests/<label>.json is resolvable by S3).
 */
async capture(label: string): Promise<string | null> {
  const release = await this.mutex.acquire();
  try {
    // Cap 1 — per-turn snapshot count (parity with GitBackend; reset by lifecycle P3).
    if (this.capturesThisTurn >= this.cfg.maxSnapshotsPerTurn) {
      console.warn(`[mulligan] snapshot.capture: maxSnapshotsPerTurn (${this.cfg.maxSnapshotsPerTurn}) reached; skipping ${label}`);
      return null;
    }
    const prev = await this.loadPrevEntries(label); // short-circuit source; empty on miss/corrupt
    const files: Record<string, CasManifestEntry> = {};
    let totalBytes = 0;
    let partial = false;
    const excludeSet = new Set(this.cfg.excludeGlobs.map((g) => g.toLowerCase()));

    await this.walkTree(this.cwd, excludeSet, async (rel, abs, st) => {
      // oversize → fail-closed skip+warn (never silently claimed restorable)
      if (st.size > this.cfg.maxFileBytes) {
        console.warn(`[mulligan] snapshot.capture: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${rel}`);
        return;
      }
      // mtime/size short-circuit — reuse stored hash, NO read/re-hash/store
      const pe = prev.get(rel);
      if (pe && pe.size === st.size && pe.mtime === st.mtimeMs) {
        files[rel] = { hash: pe.hash, size: st.size, mtime: st.mtimeMs, existed: true };
        return;
      }
      // byte budget → stop accepting NEW data, mark PARTIAL (E29). NOT abort.
      if (totalBytes + st.size > this.cfg.maxTotalBytes) {
        partial = true;
        console.warn(`[mulligan] snapshot.capture: maxTotalBytes (${this.cfg.maxTotalBytes}) reached; partial snapshot, skipping: ${rel}`);
        return;
      }
      const content = await this.fs.readFile(abs);
      const hash = await this.hashContent(content);
      await this.storeBlob(content); // deduped via access (S1)
      files[rel] = { hash, size: st.size, mtime: st.mtimeMs, existed: true };
      totalBytes += st.size;
    });

    const manifest: CasManifest = { version: 1, label, turnIndex: 0, ts: Date.now(), files };
    await this.fs.mkdir(join(this.storageDir, "manifests"), { recursive: true });
    await this.fs.writeFile(this.manifestPath(label), Buffer.from(serializeManifest(manifest), "utf8"));
    this.capturesThisTurn++;
    if (partial) {
      console.warn(`[mulligan] snapshot.capture: wrote PARTIAL manifest for ${label} (maxTotalBytes cap)`);
    }
    return label; // ref === label
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mulligan] snapshot.capture failed: ${msg}`);
    return null;
  } finally {
    release();
  }
}

// ── CRITICAL ordering note ──
// The mutex is acquired FIRST (before any read), so capture/dirtyCheck/restore/retire (S3) + the P3
// prompt-boundary GC pass never overlap (§4.3). The count-cap check is INSIDE the lock (a capture that
// would exceed the cap still serializes — it just no-ops). The whole body is one try/catch → null.
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO CONFIG EDITS. S2 is pure in-process code on top of S1's substrate.
IMPORTS (cas.ts): add `readdir as fsReaddir` to the existing `node:fs/promises` import; the inline
  `import("node:fs").Dirent` type needs no top-level import (node:fs Dirent is globally typed).
  join/resolve/dirname already imported (S1 storeBlob uses dirname). normalizeRelPath/
  isDangerousWorkspaceRel already imported from "./paths.js". serializeManifest/parseManifest/
  CasManifest/CasManifestEntry already in-file (S1).
BACKEND PARITY (spec §4.3): the mutex idiom, best-effort null-return, capturesThisTurn field, and the
  caps gate order (count first) MUST match git.ts. DIVERGENCE is allowed ONLY on maxTotalBytes (partial
  vs abort — CAS is file-by-file). Document the divergence in the capture JSDoc.
DOWNSTREAM CONSUMERS (NOT S2's job): P3.M1.T1 calls capture("turn")/capture("turn-after");
  P3.M2.T1 calls capture("ckpt:<name>"); S3 implements has/retire/dirtyCheck/restore reading the same
  <storageDir>/manifests/<label>.json. S2 must NOT touch those stubs.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the edited file (run after Task 5; fix before tests)
npx tsc --noEmit                      # project-wide typecheck; expect ZERO errors
npx tsc --noEmit -p . 2>&1 | grep cas.ts   # isolate cas.ts errors if any

# LSP diagnostics on the edited file (fast, in-editor)
# (call lsp_diagnostics on src/snapshot/cas.ts — expect no diagnostics)

# Lint/format (match the repo's tooling — check package.json scripts first)
npx eslint src/snapshot/cas.ts        # if eslint is configured
npx prettier --check src/snapshot/cas.ts test/cas.test.ts

# Expected: Zero errors. The inline import("node:fs").Dirent type + .js imports must resolve.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the CAS suite (fast feedback loop while implementing)
npx vitest run test/cas.test.ts

# Expected: ALL green — both S1's substrate tests (hashContent/storeBlob/manifest/describe/stubs) AND
# S2's new capture tests must pass (S2 must not break S1's tests).
```

S2's new `describe("CasBackend.capture — whole-tree (spec/14 §4.1)")` block must include these `it()`
cases (each driven by a TreeFs fake):

```yaml
- it("walks cwd, hashes+stores content, writes manifests/<label>.json, returns label")
- it("dedupes identical content (one blob path per distinct hash)")
- it("mtime short-circuit: 2nd capture('turn') with no changes reuses every hash — readFile NOT called for working-tree files")
- it("changed mtimeMs triggers re-read/re-hash/re-store for that file only")
- it("changed size triggers re-read (size differs even if mtimeMs same)")
- it("new file (no prev entry) is read/hashed/stored")
- it("excludeGlobs segment is skipped (e.g. 'dist' subdir absent from manifest)")
- it("dangerous dirs (.git/.pi/node_modules) are absent from the manifest")
- it("oversize file (size > maxFileBytes) is skipped + warned — absent from manifest")
- it("maxTotalBytes exceeded → PARTIAL manifest (early files present, later skipped); STILL returns label (NOT null)")
- it("maxSnapshotsPerTurn exceeded (capturesThisTurn >= cap) → returns null, no walk, no manifest write")
- it("writeFile rejects → capture returns null, never rejects (best-effort)")
- it("readdir on an unreadable subdir → subtree skipped (no throw)")
- it("capturesThisTurn increments after each successful capture")
- it("mutex serializes concurrent capture() (max-in-flight 1)")   # mirror git.test.ts line 299
- it("missing previous manifest → full capture (no short-circuit)")
- it("corrupt previous manifest JSON → full capture (parseManifest throw swallowed, no reject)")
```

### Level 3: Integration Testing (System Validation)

```bash
# S2 is a UNIT-tier task (spec/10 §1 Tier 1 — pure-ish helper, fakes, no Pi). There is NO service to
# start. The end-to-end non-git revert flow is validated by the F-revert-cas / F-revert-explicit
# integration scenarios in P5.M1.T1.S2 (Tier 2 — real temp dirs, real fs). S2 does NOT add those.

# Smoke (optional, manual): exercise realFs against a temp non-git dir to confirm the real fs binding works:
tmp=$(mktemp -d) && mkdir -p "$tmp/src" && echo "hi" > "$tmp/src/a.ts"
node --input-type=module -e "
import { CasBackend } from './src/snapshot/cas.js';
const cfg = { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:'cas', storageDir:null,
  maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
  excludeGlobs:['.git','node_modules','dist','build','.next','.venv','target'] };
const store = new CasBackend('$tmp', cfg, '$tmp/.mulligan');
const ref = await store.capture('turn');
console.log('ref=', ref);
const fs = await import('node:fs/promises');
const man = JSON.parse(await fs.readFile('$tmp/.mulligan/mulligan/manifests/turn.json','utf8'));
console.log('files=', Object.keys(man.files));
"
# Expected: ref=turn ; files includes src/a.ts ; a blob exists under .../blobs/<2hex>/<sha256>.
rm -rf "$tmp"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Parity spot-check (spec §4.3 mandates backend parity): diff the AsyncMutex idiom + best-effort
# try/catch + capturesThisTurn field between cas.ts and git.ts — they must be structurally identical
# (only the body of capture differs; CAS does the walk + mtime-short-circuit, git runs git commands).
diff <(grep -A2 'mutex.acquire' src/snapshot/git.ts) <(grep -A2 'mutex.acquire' src/snapshot/cas.ts)

# Expected: the acquire/finally scaffolding matches. (The cap-check + return differ by design — CAS is partial-not-abort.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean (zero errors) — cas.ts compiles with the new readdir/Dirent/capturesThisTurn.
- [ ] `npx vitest run test/cas.test.ts` — ALL green (S1 substrate + S2 capture suite).
- [ ] `lsp_diagnostics src/snapshot/cas.ts` — no diagnostics.
- [ ] No new npm dependencies (only node:fs built-ins — §4 of external_deps.md).
- [ ] `.js` import specifiers + `node:` prefixes preserved (vitest/tsc).

### Feature Validation

- [ ] Every "Success Criteria" checkbox above is demonstrated by a passing `it()`.
- [ ] mtime short-circuit proven by a readFile-was-NOT-called assertion on a 2nd unchanged capture.
- [ ] maxTotalBytes yields PARTIAL (returns label) — NOT null (the deliberate CAS-vs-git divergence).
- [ ] maxSnapshotsPerTurn yields null — NOT partial.
- [ ] capture NEVER rejects on any error path (writeFile/readdir/stat/hashContent throws → null).

### Code Quality Validation

- [ ] Mutex idiom + best-effort + capturesThisTurn mirror git.ts (backend parity, §4.3).
- [ ] capture JSDoc cites `@14 §4.1` (+ §4.3/E29) — the docs ride WITH the work (work item DOCS clause).
- [ ] No edits to dirtyCheck/restore/has/retire stubs (S3 scope), store.ts, paths.ts, or git.ts.
- [ ] No edits to PRD.md, tasks.json, prd_snapshot.md, .gitignore.

### Documentation & Deployment

- [ ] `capture()` JSDoc explains: whole-tree walk, mtime short-circuit, caps→partial, best-effort null.
- [ ] The deliberate maxTotalBytes partial-vs-abort divergence from git.ts is documented inline.

---

## Anti-Patterns to Avoid

- ❌ Don't ABORT on maxTotalBytes (git does, because git is atomic) — CAS is file-by-file; mark PARTIAL and return the label.
- ❌ Don't re-read/re-hash/re-store on a mtime+size match — that defeats the O(changed-files) point of §4.1.
- ❌ Don't add a reset for capturesThisTurn inside capture (parity with git.ts; P3 owns the reset).
- ❌ Don't touch the S3 stubs (dirtyCheck/restore/has/retire) — out of scope; they stay throwing.
- ❌ Don't reuse git.ts's `scanForCaps` — it returns sizes only; CAS needs read+hash+store + mtime-check inline.
- ❌ Don't catch inside the visitor and swallow — let errors propagate to capture's single try/catch (best-effort null).
- ❌ Don't hardcode blob/manifest paths — use S1's `blobPath`/`manifestPath`/`storeBlob`/`hashContent`.
- ❌ Don't use sync fs (`statSync`/`readdirSync`) — the interface is async and capture is mutex-serialized; blocking freezes the Pi event loop.
- ❌ Don't descend into symlinks (mirror git.ts — only `isFile()` captured, symlinked dirs not recursed).

---

## Confidence Score: 9/10

**Why high**: S1 already shipped the entire substrate (manifest types, serialize/parse, blob store,
DI seam, mutex, manifestPath). git.ts is a complete, validated reference for every shared idiom (mutex,
best-effort, capturesThisTurn, the walk structure, caps gate order, test patterns). The only genuinely
new logic is the inline visitor (oversize/short-circuit/byte-budget/read-hash-store) — each branch is
a few lines, fully specified above. The mtime short-circuit is the one subtlety and it is pinned by
external_deps.md §2 + §4.1 line 115 + a dedicated test that asserts readFile was NOT called.

**Residual risk (the 1 point)**: the TreeFs test fake is the most novel piece — synthesizing Dirent[]
entries and modeling the manifest round-trip (first capture writes manifests/turn.json into the fake's
blob store, second capture reads it via loadPrevEntries) must be wired carefully or the
short-circuit test is vacuous. Mitigated by spelling out the fake's responsibilities (separate blob
Map + a readFile-called Set for assertions) in Task 7.

---

## Output Location (confirmed)

- PRP: `plan/008_c36fd26768ae/P2M3T1S2/PRP.md` ✓
- Research: `plan/008_c36fd26768ae/P2M3T1S2/research/notes.md` ✓