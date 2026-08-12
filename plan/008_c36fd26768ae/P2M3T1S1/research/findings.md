# P2.M3.T1.S1 Research Findings — CasBackend skeleton (hash + blob store + manifest)

## Scope confirmation (CRITICAL — do not over-build)

This is **S1 of P2.M3.T1** (a 3-way split: S1/S2/S3). The work-item OUTPUT says:
> "CasBackend class skeleton with blob/manifest internals. Extended by S2 (capture) and S3 (dirtyCheck/restore)."

So S1 ships the **internals only**; the 6 `SnapshotStore` IO methods are **throwing stubs** (exactly the
GitBackend S1→S2 split pattern — verified in `src/snapshot/git.ts` whose S1 left
dirtyCheck/restore/has/retire as `throw new Error("…see P2.M2.T1.S2")`).

| Method | S1 (this task) | S2 (P2.M3.T1.S2) | S3 (P2.M3.T1.S3) |
|---|---|---|---|
| `describe()` | **REAL** (sync `{backend:"cas"}`) | — | — |
| `capture(label)` | stub → S2 | **REAL** (whole-tree + mtime short-circuit) | — |
| `dirtyCheck` | stub → S3 | — | **REAL** |
| `restore` | stub → S3 | — | **REAL** |
| `has` | stub → S3 | — | **REAL** |
| `retire` | stub → S3 | — | **REAL** |

Internal helpers (S1 deliverables, NOT on the interface): `hashContent`, `storeBlob`, `readBlob`,
`blobPath`, `manifestPath`, `serializeManifest`/`parseManifest`, the `CasManifest`/`CasManifestEntry` types.

## The interface is ASYNC (verified — not the S1 doc's "sync")

`src/snapshot/store.ts` (read in full) declares the 5 IO methods **`Promise`-returning**
(P2.M2.T1.S1 corrected the earlier sync draft). Every `expectTypeOf<SnapshotStore["capture"]>().returns`
asserts `Promise<string|null>`. Therefore CasBackend stubs MUST be `async …: Promise<…>`. describe() is sync.

## Storage layout (item description + external_deps.md §2)

- **Blobs:** `<storageDir>/blobs/<sha256-prefix>/<sha256>` — prefix = first **2 hex chars** (git-style
  fanout of 256). Content deduped: same content → same hash → **same path** → stored once.
- **Manifests:** `<storageDir>/manifests/<label>.json` (documented target; the per-capture ref scheme +
  manifest write is S2's `capture()` — S1 only provides the path helper + the type + pure serialize/parse).
- `storageDir` resolution mirrors GitBackend EXACTLY (store.ts's `resolveStorageDir` is module-private;
  re-resolve inline): `revertConfig.storageDir ?? resolve(sessionDir, "mulligan")`, throw if neither.

## Manifest type (item description, verbatim)

```ts
interface CasManifestEntry { hash: string; size: number; mtime: number; existed: boolean; }
interface CasManifest {
  version: 1; label: string; turnIndex: number; ts: number;
  files: Record<string /*posix-rel path*/, CasManifestEntry>;
}
```
`turnIndex`/`ts` populated by S2's capture; S1 only defines the type. Round-trip test = pure
`serializeManifest`/`parseManifest` (no fs).

## DI seam (mirrors GitBackend's deps.exec/scan/unlink)

`deps.fs?: CasFs` — default = real `node:fs/promises`. Inject a recording fake to assert **dedupe**
(storeBlob called twice with identical content → `writeFile` invoked exactly ONCE; the 2nd call short-
circuits on `access()` success). `CasFs` shape: `readFile→Buffer`, `writeFile(Buffer)`, `mkdir(recursive)`,
`access` (rejects if absent), `stat→{size,mtimeMs}`.

## storeBlob dedupe algorithm (testable via the fs seam)

```
hash = hashContent(content); p = blobPath(hash)
try { await fs.access(p); return hash; }   // EXISTS → dedupe (no write)
catch { await fs.mkdir(dirname(p),{recursive:true}); await fs.writeFile(p,content); return hash; }
```

## Key references verified
- `src/snapshot/git.ts` — sibling backend; mirror: header JSDoc density, `implements SnapshotStore`,
  async stubs throwing "see P2.M3.T1.S2/S3", per-instance `AsyncMutex`, `resolve(storageDir)` logic,
  DI deps interface exported for tests, `.js` imports, `node:` prefixes, `import type` for MulliganConfig.
- `src/snapshot/store.ts` — `detectAndCreate` dynamic-imports `./cas.js` → `new mod.CasBackend(cwd,
  revertConfig, sessionDir)` (3-arg). `CasBackendCtor` cast already defined there (read-only contract).
- `src/snapshot/paths.ts` — `normalizeRelPath`/`isDangerousWorkspaceRel`/`resolveSafeWorkspacePath`/
  `DANGEROUS_DIRS` (S2/S3 consume on the walk; S1 imports nothing from it — but the manifest path keys
  ARE posix-rel so document that contract).
- `test/git.test.ts` — vitest idiom: `makeExec`-style recording fakes, `findCmd`, flat `test/<x>.test.ts`,
  `.js` import of src, `import type` config, no `beforeEach`.
- `src/config.ts` — `MulliganConfig["revert"]` 8-field block; `storageDir: string|null`.
- spec/14 §4.1/§4.3 + external_deps.md §2 — authoritative CAS design.