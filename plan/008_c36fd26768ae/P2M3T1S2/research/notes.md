# Research Notes — P2.M3.T1.S2 (CAS 'cas' mode whole-tree capture + mtime short-circuit)

## 1. The S1 contract (what already exists in src/snapshot/cas.ts)

S1 ships the CasBackend skeleton. S2 CONSUMES it and adds `capture()` + 2 private helpers + 3 small
edits. Verified by reading cas.ts lines 78–326:

- `CasManifestEntry { hash: string; size: number; mtime: number; existed: boolean }` (line 78)
- `CasManifest { version: 1; label: string; turnIndex: number; ts: number; files: Record<relPath, CasManifestEntry> }` (line 105)
- `serializeManifest(m: CasManifest): string` (line 125)  ← returns STRING
- `parseManifest(json: string): CasManifest` (line 138)   ← takes STRING (enforces version === 1)
- `CasFs { readFile(Buffer); writeFile(Buffer); mkdir; access; stat->{size,mtimeMs} }` (line 153) ← **NO readdir**
- `CasBackendDeps { fs?: CasFs }` (line 175)
- `realFs` binding (line 184): readFile/writeFile/mkdir/access/stat bound 1:1 to node:fs/promises
- `class CasBackend` fields (line 201): `cwd, cfg, storageDir, sessionDir, mutex, fs` ← **NO capturesThisTurn**
- `blobPath(hash) -> <storageDir>/blobs/<2hex>/<sha256>` (line 264); `manifestPath(label) -> <storageDir>/manifests/<label>.json` (line 272)
- `storeBlob(content)`: hash→access(exists?return hash : mkdir dirname + writeFile). **DEDUPED.** dirname already imported.
- `hashContent(content)`: sha256 hex, async.
- `capture()` STUB throws "see P2.M3.T1.S2" (line 313) ← **S2 REPLACES THIS**
- constructor resolves storageDir inline: storageDir ?? sessionDir? join(sessionDir,"mulligan") : throw

## 2. The git.ts sibling patterns to MIRROR (backend parity, spec §4.3)

Read git.ts (shrunk to summary). The reusable patterns:

- **AsyncMutex idiom** (every serialized method):
  `const release = await this.mutex.acquire(); try { ...op... } catch(err){ console.warn(...); return null; } finally { release(); }`
- **Best-effort**: capture NEVER rejects — whole body in one try/catch → `console.warn` + `return null`.
- **capturesThisTurn**: git.ts line 195 `private capturesThisTurn = 0; // reset by lifecycle P3 at turn boundary`.
  S2 ADDS the identical field (parity). The per-turn RESET is P3's concern (shared with git.ts) — NOT S2.
- **CAPS gate order** in git.ts capture():
  1. `capturesThisTurn >= maxSnapshotsPerTurn` → warn + `return null`
  2. scan → `totalBytes > maxTotalBytes` → warn + `return null`  ← git ABORTS (atomic add/commit)
  3. per oversize: warn skip
  ⚠️ CAS DIFFERS on #2: CAS is file-by-file → does NOT abort; skips files beyond budget, marks PARTIAL,
     STILL returns the label. (work item: "stop accepting new data, mark partial"; E29; spec §5.)
- **scanForCaps walk structure** (the structure CAS mirrors — but CAS can't REUSE scanForCaps, it only
  returns sizes; CAS must read+hash+store + mtime-check inline):
  `readdir(dir,{withFileTypes:true})` → per entry: `normalizeRelPath(root, join(dir,name))` →
  `if isDangerousWorkspaceRel(rel) continue` → `segments.some(s => excludeSet.has(s.toLowerCase())) continue` →
  dir? recurse : file? stat(size) ...
- **excludeGlob test**: case-insensitive SEGMENT match (split rel on "/", lowercase each, Set has).
- **Warning idiom**: `console.warn(\`[mulligan] snapshot.capture: <one-liner>: <detail>\`)` — NO
  sessionId/log.ts at capture time (structured logging added in P3 when sessionId is threaded).

## 3. paths.ts (pure helpers S2 consumes — NO edits)

- `normalizeRelPath(workspaceRoot, absPath): string` → POSIX rel path (manifest KEY).
- `isDangerousWorkspaceRel(relPath): boolean` → true for NUL / absolute / trailing-sep (dir) / any `..`
  segment / any segment under `.git`/`.pi`/`node_modules` (case-insensitive).
- `DANGEROUS_DIRS = [".git", ".pi", "node_modules"]` — always-enforced safety floor, DISTINCT from
  the backends' walk-level `excludeGlobs` perf filter.

## 4. config revert fields S2 reads (cfg)

enabled, allowDeleteCreatedFiles (S2 ignores — delete is S3), nonGitMode ("cas" — S2 branch only),
storageDir (resolved in ctor), maxFileBytes (262144), maxTotalBytes (33554432),
maxSnapshotsPerTurn (64), excludeGlobs ([".git","node_modules","dist","build",".next",".venv","target"]).

## 5. External deps / spec (architecture/external_deps.md §2 + spec/14 §4.1/§4.3/§5)

- mtime/size short-circuit: compare `stat.mtimeMs` + `stat.size` vs previous manifest entry; if
  unchanged reuse the stored hash (O(changed-files), not O(all-files)). external_deps.md §2.
- Manifest ref === label; manifest at manifests/<label>.json; store returns the label. (§5, store.ts JSDoc)
- E29 caps: capture stops accepting new data, snapshot partial; restore degrades (skipped[]). (§5, §9)
- AsyncMutex serializes ALL store ops; prompt-boundary GC also acquires it. (§4.3)
- backend parity: both backends expose the same SnapshotStore interface; rewind is mode-agnostic. (§4.3)
- Symlinks: only isFile() captured; symlinked dirs NOT recursed (Dirent.isDirectory() false for symlinks).
  Lexical safety in paths.ts + fs containment are git.ts/P2.M2 concerns; S2 mirrors git.ts walk.

## 6. Test idiom (test/git.test.ts + S1's test/cas.test.ts)

- vitest: `import {describe,it,expect} from "vitest"`, flat `test/cas.test.ts`, import `../src/snapshot/cas.js`.
- `BASE_CFG: MulliganConfig["revert"]` fixture (all 8 fields). git.test.ts lines 19-29.
- S1's recording CasFs fake: minimal (Set<string> written; access rejects unless written) — DOES NOT
  model directories. S2 MUST build a richer TreeFs fake: `Map<absPath, {type:'dir'}|{type:'file',
  content,mtimeMs,size}>` → readdir synthesizes Dirent[]; stat/readFile/access/writeFile/mkdir off it;
  blob storage in a separate Map. This is the crux of walk + mtime-short-circuit testability.
- Dirent: `import("node:fs").Dirent` for the CasFs readdir return type. Fake builds structural entries.
- mutex test: concurrent capture() max-in-flight 1 (mirror git.test.ts line 299).

## 7. Design decisions / gotchas for S2

- **ref === label** (capture returns label; manifest keyed by label). has/retire/dirtyCheck/restore
  (S3) all resolve via manifestPath(label).
- **mtime short-circuit** keys off the SAME label's previous manifest (manifests/<label>.json).
  Consecutive capture('turn') overwrites manifests/turn.json; reads the prior for the short-circuit.
- **maxTotalBytes → PARTIAL not abort** (CAS file-by-file; unlike git.ts atomic abort). Returns label.
- **maxSnapshotsPerTurn → null** (count cap aborts; mirror git.ts).
- **turnIndex: 0** — backend has no turn context; metadata only (label namespaces). P3 may thread later.
- **existed: true** for all walk-captured files (on disk). existed:false is the S3 explicit-paths case.
- **serializeManifest→string, writeFile takes Buffer**: `Buffer.from(serializeManifest(m),"utf8")`.
  **readFile→Buffer, parseManifest takes string**: `buf.toString("utf8")`.
- **CasFs readdir ADDED by S2** (+ realFs binding + Dirent type). NOT in S1.
- **capturesThisTurn ADDED by S2** (field), mirroring git.ts line 195; reset = P3.