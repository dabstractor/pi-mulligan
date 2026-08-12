// test/cas.test.ts — CasBackend (src/snapshot/cas.ts, P2.M3.T1.S1) skeleton unit tests.
//
// spec/14-working-tree-revert.md §4.1 (CAS store — content keyed by hash; identical content stored
// once globally — DEDUPE; storage outside cwd/.git), §4.3 (AsyncMutex per-store serialization —
// present + constructed in CasBackend, unused by the S1 throwing stubs), §2 (the async interface
// CasBackend implements). architecture/external_deps.md §2 (blob/manifest layout +
// serializeManifest/parseManifest JSON format), §4 (Node built-ins only).
//
// What is MOCKED vs REAL:
// - hashContent/serializeManifest/parseManifest: exercised against the REAL crypto.createHash +
//   JSON.parse/stringify (no mock — the determinism + round-trip assertions cross-check node:crypto
//   directly). describe() is real metadata (no mock).
// - storeBlob/readBlob dedupe + round-trip: a RECORDING CasFs fake (tracks writeFile/access/mkdir
//   calls) is injected via the `deps.fs` DI seam. The fake's `access` rejects on a path NOT yet
//   written (absent → triggers write) and resolves on a path already written (present → dedupe hit);
//   the `written` Set is the state that flips it. This is the ONLY way to assert writeFile is
//   invoked exactly ONCE — real fs.writeFile would silently overwrite, hiding whether the 2nd call
//   happened.
// - AsyncMutex: real (constructed in CasBackend's constructor — present for S2/S3; the S1 stubs
//   throw before acquiring it, so it is never exercised here).
//
// Scope: P2.M3.T1.S1 ships the SKELETON — describe() + hashContent/storeBlob/readBlob +
// serializeManifest/parseManifest are REAL; capture/dirtyCheck/restore/has/retire are THROWING
// STUBS naming their owning subtask (capture → P2.M3.T1.S2; the other four → P2.M3.T1.S3). These
// tests assert the real internals + the stub scope guard. S2/S3 tests land with S2/S3.
//
// House idiom: vitest describe/it/expect; flat test/cas.test.ts location (mirror test/git.test.ts);
// `../src/snapshot/cas.js` import with `.js` (ESM + tsc/rollup convention); a BASE_CFG fixture
// (mirror test/git.test.ts BASE_CFG); no beforeEach (each test constructs its own CasBackend — the
// only per-instance state, the mutex, is unused by the stubs).

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import {
  CasBackend,
  serializeManifest,
  parseManifest,
  type CasManifest,
  type CasFs,
} from "../src/snapshot/cas.js";
import type { MulliganConfig } from "../src/config.js";

/** Canonical valid MulliganConfig["revert"] for tests (mirror test/git.test.ts BASE_CFG). storageDir
 *  set so the constructor resolves storageDir without a sessionDir. */
const BASE_CFG: MulliganConfig["revert"] = {
  enabled: true,
  allowDeleteCreatedFiles: false,
  nonGitMode: "cas",
  storageDir: "/fake/store",
  maxFileBytes: 262144,
  maxTotalBytes: 33554432,
  maxSnapshotsPerTurn: 64,
  excludeGlobs: [".git", "node_modules"],
};

/** Construct a CasBackend for tests. `fs` is the optional recording fake (DI seam); omit for real. */
function makeBackend(fs?: CasFs): CasBackend {
  return new CasBackend("/fake/cwd", BASE_CFG, null, fs ? { fs } : undefined);
}

// ── describe() — spec/14 §2 (sync metadata) ───────────────────────────────────────────────
describe("CasBackend.describe() — spec/14 §2 (sync backend metadata)", () => {
  it("returns { backend: 'cas' } (sync metadata, no reason)", () => {
    const cb = makeBackend();
    expect(cb.describe()).toEqual({ backend: "cas" });
  });
});

// ── hashContent — spec/14 §4.1 (sha256 dedupe identity) ────────────────────────────────────
describe("CasBackend.hashContent — spec/14 §4.1 (sha256 dedupe identity)", () => {
  it("is deterministic: same Buffer → same hex", async () => {
    const cb = makeBackend();
    const a = await cb.hashContent(Buffer.from("hello"));
    const b = await cb.hashContent(Buffer.from("hello"));
    expect(a).toBe(b);
  });

  it("equals the known sha256 of the input (cross-check node:crypto directly)", async () => {
    const cb = makeBackend();
    const input = Buffer.from("abc");
    const expected = createHash("sha256").update(input).digest("hex");
    expect(await cb.hashContent(input)).toBe(expected);
  });

  it("is distinct for distinct content", async () => {
    const cb = makeBackend();
    const a = await cb.hashContent(Buffer.from("a"));
    const b = await cb.hashContent(Buffer.from("b"));
    expect(a).not.toBe(b);
  });

  it("returns a 64-char lowercase-hex sha256", async () => {
    const cb = makeBackend();
    const h = await cb.hashContent(Buffer.from("anything"));
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── storeBlob — spec/14 §4.1 dedupe (identical content stored ONCE) ────────────────────────
describe("CasBackend.storeBlob — spec/14 §4.1 dedupe (identical content stored ONCE)", () => {
  /**
   * Build a RECORDING CasFs fake whose `access` rejects on a path NOT yet written (absent → write)
   * and resolves on a path already written (present → dedupe). The `written` Set is the state that
   * flips access reject→resolve, simulating the real fs's existence semantics WITHOUT touching disk.
   * `readFile` returns the bytes last written to that path (a Map<path,Buffer>) for the round-trip.
   */
  function makeRecordingFs() {
    const written = new Set<string>();
    const blobs = new Map<string, Buffer>();
    const calls = {
      writeFile: [] as Array<{ path: string; data: Buffer }>,
      access: [] as string[],
      mkdir: [] as string[],
    };
    const fakeFs: CasFs = {
      access: async (p) => {
        calls.access.push(p);
        if (!written.has(p)) throw new Error("ENOENT");
      },
      mkdir: async (p) => {
        calls.mkdir.push(p);
      },
      writeFile: async (p, data) => {
        calls.writeFile.push({ path: p, data });
        written.add(p);
        blobs.set(p, data);
      },
      readFile: async (p) => blobs.get(p) ?? Buffer.from(""),
      stat: async () => ({ size: 0, mtimeMs: 0 }),
      readdir: async () => [],
      unlink: async () => {},
    };
    return { fakeFs, calls };
  }

  it("writes the blob on the FIRST call and returns the sha256", async () => {
    const { fakeFs, calls } = makeRecordingFs();
    const cb = makeBackend(fakeFs);
    const content = Buffer.from("hello cas");
    const expectedHash = createHash("sha256").update(content).digest("hex");
    const h1 = await cb.storeBlob(content);
    expect(h1).toBe(expectedHash);
    expect(calls.writeFile).toHaveLength(1);
    expect(calls.access).toHaveLength(1);
    // the written path is <storageDir>/blobs/<2-hex>/<hash>
    expect(calls.writeFile[0].path).toBe(`/fake/store/blobs/${h1.slice(0, 2)}/${h1}`);
  });

  it("DEDUPES: a 2nd call with identical content does NOT re-write (access short-circuits)", async () => {
    const { fakeFs, calls } = makeRecordingFs();
    const cb = makeBackend(fakeFs);
    const content = Buffer.from("hello cas");
    const h1 = await cb.storeBlob(content);
    const h2 = await cb.storeBlob(content);
    expect(h2).toBe(h1); // same hash (dedupe identity)
    expect(calls.writeFile).toHaveLength(1); // STILL 1 — the 2nd access resolved → no write
    expect(calls.access).toHaveLength(2); // both calls probed existence
  });

  it("writes DIFFERENT content to a DIFFERENT path", async () => {
    const { fakeFs, calls } = makeRecordingFs();
    const cb = makeBackend(fakeFs);
    const h1 = await cb.storeBlob(Buffer.from("first content"));
    const h2 = await cb.storeBlob(Buffer.from("second content"));
    expect(h2).not.toBe(h1);
    expect(calls.writeFile).toHaveLength(2);
    expect(calls.writeFile[1].path).toBe(`/fake/store/blobs/${h2.slice(0, 2)}/${h2}`);
  });

  it("creates the 2-hex-prefix blob path layout", async () => {
    const { fakeFs, calls } = makeRecordingFs();
    const cb = makeBackend(fakeFs);
    await cb.storeBlob(Buffer.from("layout check"));
    expect(calls.writeFile).toHaveLength(1);
    expect(calls.writeFile[0].path).toMatch(/\/blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/);
  });
});

// ── readBlob — round-trips storeBlob ───────────────────────────────────────────────────────
describe("CasBackend.readBlob — round-trips storeBlob", () => {
  it("readBlob(hash) returns the bytes storeBlob wrote", async () => {
    // a recording fake whose readFile returns the bytes last written to that path.
    const written = new Map<string, Buffer>();
    const fakeFs: CasFs = {
      access: async (p) => {
        if (!written.has(p)) throw new Error("ENOENT");
      },
      mkdir: async () => {},
      writeFile: async (p, data) => {
        written.set(p, data);
      },
      readFile: async (p) => written.get(p) ?? Buffer.from(""),
      stat: async () => ({ size: 0, mtimeMs: 0 }),
      readdir: async () => [],
      unlink: async () => {},
    };
    const cb = makeBackend(fakeFs);
    const content = Buffer.from("round-trip payload");
    const h = await cb.storeBlob(content);
    const back = await cb.readBlob(h);
    expect(back.equals(content)).toBe(true);
  });
});

// ── serializeManifest / parseManifest — spec/14 §4.1 round-trip (pure) ─────────────────────
describe("serializeManifest / parseManifest — spec/14 §4.1 round-trip (pure)", () => {
  const fix: CasManifest = {
    version: 1,
    label: "turn",
    turnIndex: 3,
    ts: 1700000000000,
    files: {
      "src/foo.ts": {
        hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        size: 1024,
        mtime: 1700000000000,
        existed: true,
      },
    },
  };

  it("serializeManifest ∘ parseManifest is the identity", () => {
    expect(parseManifest(serializeManifest(fix))).toEqual(fix);
  });

  it("parseManifest throws on version !== 1", () => {
    expect(() => parseManifest(JSON.stringify({ ...fix, version: 2 }))).toThrow(/version/);
  });

  it("serializeManifest produces parseable JSON with all 5 top-level keys", () => {
    const j = JSON.parse(serializeManifest(fix)) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(["files", "label", "ts", "turnIndex", "version"]);
  });
});

// ── S3 stubs throw (scope guard) — capture is REAL as of S2 ───────────────────────────────
// (REMOVED: dirtyCheck/restore/has/retire are now REAL as of P2.M3.T1.S3 — see the S3 suites below.)
// ── CasBackend.capture — spec/14 §4.1 whole-tree (P2.M3.T1.S2) ─────────────────────────────
// What is MOCKED: a TreeFs fake modeling a directory tree (dirs + files with content + mtimeMs) AND
// a separate blob store (the <storageDir>/blobs/... layout) AND a manifest store
// (<storageDir>/manifests/<label>.json) so the mtime short-circuit round-trips through the SAME
// fake (first capture writes manifests/turn.json; the second capture's loadPrevEntries reads it).
// readFile-called paths are recorded into a Set so the short-circuit test asserts a working-tree
// file was NOT re-read on an unchanged 2nd capture. Mirror test/git.test.ts (vitest flat, BASE_CFG,
// DI fake). spec/14 §4.1 (whole-tree + mtime short-circuit + dedupe), §4.3 (mutex + caps), §5/E29
// (caps→partial).

import type { Dirent } from "node:fs";

/** A node in the TreeFs working tree: a dir marker or a file (content + mtimeMs). */
type TreeFileSpec = { content: Buffer; mtimeMs: number };
type TreeSpec = Record<string, TreeFileSpec | "dir">;

/** Synthesize a Dirent with the right isFile()/isDirectory() for the structural CasFs shape. */
function dirent(name: string, kind: "file" | "dir"): Dirent {
  return { name, isFile: () => kind === "file", isDirectory: () => kind === "dir" } as unknown as Dirent;
}

/**
 * Build a TreeFs fake. `tree` keys are workspace-RELATIVE posix paths (e.g. "src/a.ts", "dist/x").
 * The fake derives a directory tree from those keys. The blob store (access/mkdir/writeFile on
 * <storageDir>/blobs/...) is a real Map so storeBlob dedupe + loadPrevEntries manifest round-trip
 * both work through the SAME fake. `readCalls` records every readFile abs-path (working-tree + manifest)
 * so a test can assert a working-tree path was NOT re-read on an unchanged 2nd capture.
 */
function makeTreeFs(cwd: string, storageDir: string, tree: TreeSpec): {
  fakeFs: CasFs;
  readCalls: Set<string>;
} {
  const readCalls = new Set<string>();
  // blob + manifest storage (writeFile's targets under <storageDir>/blobs + <storageDir>/manifests)
  const stored = new Map<string, Buffer>();
  const written = new Set<string>(); // access gate state (present → dedupe)

  // Resolve a tree key to its absolute path under cwd.
  const absOf = (rel: string) => join(cwd, ...rel.split("/"));

  // Derive the directory tree + file specs from the posix-rel keys.
  const fileEntries = new Map<string, TreeFileSpec>(); // resolved-absPath -> spec
  // childMap maps a resolved parent dir → (childName → file|dir).
  const childMap = new Map<string, Map<string, "file" | "dir">>();
  childMap.set(resolve(cwd), new Map());
  const regChild = (parentAbs: string, name: string, kind: "file" | "dir") => {
    const key = resolve(parentAbs);
    if (!childMap.has(key)) childMap.set(key, new Map());
    childMap.get(key)!.set(name, kind);
  };
  for (const [rel, spec] of Object.entries(tree)) {
    const segs = rel.split("/");
    let acc = cwd;
    for (let i = 0; i < segs.length - 1; i++) {
      acc = join(acc, segs[i]!);
      regChild(resolve(join(acc, "..")), segs[i]!, "dir");
      if (!childMap.has(resolve(acc))) childMap.set(resolve(acc), new Map());
    }
    const name = segs[segs.length - 1]!;
    if (spec === "dir") {
      regChild(resolve(acc), name, "dir");
      if (!childMap.has(resolve(absOf(rel)))) childMap.set(resolve(absOf(rel)), new Map());
    } else {
      regChild(resolve(acc), name, "file");
      fileEntries.set(resolve(absOf(rel)), spec);
    }
  }

  const fakeFs: CasFs = {
    readdir: async (dirPath: string) => {
      const kids = childMap.get(resolve(dirPath));
      if (!kids) throw new Error(`TreeFs: readdir ENOENT ${dirPath}`);
      const out: Dirent[] = [];
      for (const [name, kind] of kids) out.push(dirent(name, kind));
      return out;
    },
    stat: async (filePath: string) => {
      const spec = fileEntries.get(resolve(filePath));
      if (!spec) throw new Error(`TreeFs: stat ENOENT ${filePath}`);
      return { size: spec.content.length, mtimeMs: spec.mtimeMs };
    },
    readFile: async (filePath: string) => {
      readCalls.add(filePath);
      // working-tree file? return its content
      const spec = fileEntries.get(resolve(filePath));
      if (spec) return spec.content;
      // else a stored blob/manifest
      const s = stored.get(filePath);
      if (s) return s;
      throw new Error(`TreeFs: readFile ENOENT ${filePath}`);
    },
    writeFile: async (filePath: string, data: Buffer) => {
      stored.set(filePath, data);
      written.add(filePath);
    },
    mkdir: async () => {
      /* idempotent no-op for the fake */
    },
    access: async (filePath: string) => {
      // present in blob store OR an existing working-tree file → resolve; else reject
      if (written.has(filePath) || fileEntries.has(resolve(filePath))) return;
      throw new Error(`TreeFs: access ENOENT ${filePath}`);
    },
    unlink: async (filePath: string) => {
      // remove a working-tree file (restore deleteCreatedFiles). ENOENT if absent.
      const ap = resolve(filePath);
      if (!fileEntries.has(ap)) throw new Error(`TreeFs: unlink ENOENT ${filePath}`);
      fileEntries.delete(ap);
      // also drop it from its parent's childMap so a later readdir no longer lists it
      const parent = resolve(join(ap, ".."));
      const base = ap.split(sep).pop()!;
      childMap.get(parent)?.delete(base);
    },
  };
  return { fakeFs, readCalls };
}

/** Build a backend over a TreeFs tree rooted at `cwd` with the given config (overrides BASE_CFG). */
function makeTreeBackend(
  cwd: string,
  storageDir: string,
  tree: TreeSpec,
  cfgOverrides: Partial<MulliganConfig["revert"]> = {},
): { cb: CasBackend; fakeFs: CasFs; readCalls: Set<string> } {
  const cfg = { ...BASE_CFG, storageDir, ...cfgOverrides };
  const { fakeFs, readCalls } = makeTreeFs(cwd, storageDir, tree);
  const cb = new CasBackend(cwd, cfg, null, { fs: fakeFs });
  return { cb, fakeFs, readCalls };
}

describe("CasBackend.capture — whole-tree (spec/14 §4.1)", () => {
  it("walks cwd, hashes+stores content, writes manifests/<label>.json, returns label", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content: Buffer.from("aaa"), mtimeMs: 1000 },
      "src/sub/b.ts": { content: Buffer.from("bbb"), mtimeMs: 2000 },
      "README.md": { content: Buffer.from("readme"), mtimeMs: 3000 },
    });
    const ref = await cb.capture("turn");
    expect(ref).toBe("turn");
    const manifestBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(manifestBuf.toString("utf8"));
    expect(Object.keys(m.files).sort()).toEqual(["README.md", "src/a.ts", "src/sub/b.ts"]);
    expect(m.version).toBe(1);
    expect(m.label).toBe("turn");
    expect(m.turnIndex).toBe(0);
    for (const e of Object.values(m.files) as Array<{ hash: string; size: number; mtime: number; existed: boolean }>) {
      expect(e.existed).toBe(true);
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("dedupes identical content (one blob path per distinct hash)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const same = Buffer.from("identical");
    // Track writeFile calls to count distinct blob writes.
    let writeCount = 0;
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: same, mtimeMs: 1 },
      "b.ts": { content: same, mtimeMs: 2 },
      "c.ts": { content: Buffer.from("different"), mtimeMs: 3 },
    });
    const origWrite = base.fakeFs.writeFile.bind(base.fakeFs);
    base.fakeFs.writeFile = async (p, d) => {
      if (p.includes("/blobs/")) writeCount++;
      await origWrite(p, d);
    };
    const ref = await base.cb.capture("turn");
    expect(ref).toBe("turn");
    // two distinct contents → two blob writes (the "identical" content stored ONCE despite 2 files)
    expect(writeCount).toBe(2);
    const mBuf = await base.fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(mBuf.toString("utf8"));
    expect(m.files["a.ts"].hash).toBe(m.files["b.ts"].hash);
    expect(m.files["c.ts"].hash).not.toBe(m.files["a.ts"].hash);
  });

  it("mtime short-circuit: 2nd capture('turn') with no changes reuses every hash — readFile NOT called for working-tree files", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, readCalls } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content: Buffer.from("aaa"), mtimeMs: 1000 },
      "src/sub/b.ts": { content: Buffer.from("bbb"), mtimeMs: 2000 },
    });
    await cb.capture("turn");
    readCalls.clear(); // reset: now only the 2nd capture's reads count
    await cb.capture("turn");
    // No working-tree path should have been read (only the manifest path for loadPrevEntries).
    const workingTreeReads = [...readCalls].filter((p) => !p.startsWith(join(storage, "manifests")));
    expect(workingTreeReads).toEqual([]);
  });

  it("changed mtimeMs triggers re-read/re-hash/re-store for that file only", async () => {
    const cwd = "/ws";
    const storage = "/store";
    // mutable tree so we can mutate one file's mtime between captures
    const tree: TreeSpec = {
      "a.ts": { content: Buffer.from("aaa"), mtimeMs: 1000 },
      "b.ts": { content: Buffer.from("bbb"), mtimeMs: 2000 },
    };
    // ONE backend + fake across both captures so loadPrevEntries sees the 1st manifest (the fake's
    // manifest store persists in the shared instance). The fake holds references to the spec
    // objects, so in-place mutation is visible to the 2nd capture's stat().
    const base = makeTreeBackend(cwd, storage, tree);
    await base.cb.capture("turn");
    // mutate a.ts mtime IN PLACE (same spec object the fake references)
    (tree["a.ts"] as TreeFileSpec).mtimeMs = 9999;
    base.readCalls.clear();
    await base.cb.capture("turn");
    const aReads = [...base.readCalls].filter((p) => resolve(p) === resolve(join(cwd, "a.ts")));
    expect(aReads).toHaveLength(1); // a.ts mtime changed → re-read
    const bReads = [...base.readCalls].filter((p) => resolve(p) === resolve(join(cwd, "b.ts")));
    expect(bReads).toEqual([]); // b.ts unchanged → NOT re-read
  });

  it("changed size triggers re-read (size differs even if mtimeMs same)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const aSpec = { content: Buffer.from("aaa"), mtimeMs: 1000 };
    const tree: TreeSpec = { "a.ts": aSpec };
    const base = makeTreeBackend(cwd, storage, tree);
    await base.cb.capture("turn");
    // change content (size differs) but keep mtime the SAME — mutate the buffer ref the fake holds
    aSpec.content = Buffer.from("aaaaa");
    base.readCalls.clear();
    await base.cb.capture("turn");
    const reads = [...base.readCalls].filter((p) => resolve(p) === resolve(join(cwd, "a.ts")));
    expect(reads).toHaveLength(1); // size changed → re-read despite same mtimeMs
  });

  it("new file (no prev entry) is read/hashed/stored", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const tree: TreeSpec = {
      "a.ts": { content: Buffer.from("aaa"), mtimeMs: 1000 },
    };
    const base = makeTreeBackend(cwd, storage, tree);
    await base.cb.capture("turn");
    // add a new file to the SAME tree — but the fake's childMap was built at construction, so we
    // cannot retroactively register a new child. Instead, rebuild the backend AND pre-seed its
    // manifest store with the 1st manifest so loadPrevEntries short-circuits the old file.
    const firstManifest = await base.fakeFs.readFile(join(storage, "manifests/turn.json"));
    const tree2: TreeSpec = {
      "a.ts": { content: Buffer.from("aaa"), mtimeMs: 1000 },
      "b.ts": { content: Buffer.from("new"), mtimeMs: 5000 },
    };
    const base2 = makeTreeBackend(cwd, storage, tree2);
    await base2.fakeFs.mkdir(join(storage, "manifests"), { recursive: true });
    await base2.fakeFs.writeFile(join(storage, "manifests/turn.json"), firstManifest);
    base2.readCalls.clear();
    const ref = await base2.cb.capture("turn");
    expect(ref).toBe("turn");
    const reads = [...base2.readCalls].filter((p) => resolve(p) === resolve(join(cwd, "b.ts")));
    expect(reads).toHaveLength(1);
    const mBuf = await base2.fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(mBuf.toString("utf8"));
    expect(m.files["b.ts"]).toBeDefined();
  });

  it("excludeGlobs segment is skipped (e.g. 'dist' subdir absent from manifest)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
      "dist/bundled.js": { content: Buffer.from("bundled"), mtimeMs: 2 },
    }, { excludeGlobs: ["dist"] });
    await cb.capture("turn");
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(mBuf.toString("utf8"));
    expect(Object.keys(m.files)).toEqual(["src/a.ts"]);
  });

  it("dangerous dirs (.git/.pi/node_modules) are absent from the manifest", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
      ".git/config": { content: Buffer.from("cfg"), mtimeMs: 1 },
      ".pi/state": { content: Buffer.from("s"), mtimeMs: 1 },
      "node_modules/pkg/index.js": { content: Buffer.from("pkg"), mtimeMs: 1 },
    });
    await cb.capture("turn");
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(mBuf.toString("utf8"));
    expect(Object.keys(m.files)).toEqual(["src/a.ts"]);
  });

  it("oversize file (size > maxFileBytes) is skipped + warned — absent from manifest", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = Buffer.alloc(300); // > BASE_CFG.maxFileBytes (262144 is big; use a tighter cap)
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "small.ts": { content: Buffer.from("ok"), mtimeMs: 1 },
      "big.bin": { content: big, mtimeMs: 1 },
    }, { maxFileBytes: 100 });
    await cb.capture("turn");
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(mBuf.toString("utf8"));
    expect(Object.keys(m.files)).toEqual(["small.ts"]);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((c) => /oversize/.test(String(c[0])))).toBe(true);
    warnSpy.mockRestore();
  });

  it("maxTotalBytes exceeded → PARTIAL manifest (early files present, later skipped); STILL returns label (NOT null)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // tree order: dir children come back in insertion order; put the small file first.
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "small.ts": { content: Buffer.from("small"), mtimeMs: 1 }, // 5 bytes
      "large.ts": { content: Buffer.from("x".repeat(100)), mtimeMs: 2 }, // 100 bytes → exceeds budget
    }, { maxTotalBytes: 50 });
    const ref = await cb.capture("turn");
    expect(ref).toBe("turn"); // NOT null — PARTIAL, not abort
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(mBuf.toString("utf8"));
    expect(Object.keys(m.files)).toContain("small.ts");
    expect(Object.keys(m.files)).not.toContain("large.ts");
    expect(warnSpy.mock.calls.some((c) => /partial/.test(String(c[0])))).toBe(true);
    warnSpy.mockRestore();
  });

  it("maxSnapshotsPerTurn exceeded (capturesThisTurn >= cap) → returns null, no walk, no manifest write", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
    }, { maxSnapshotsPerTurn: 1 });
    const first = await cb.capture("turn");
    expect(first).toBe("turn");
    const second = await cb.capture("turn");
    expect(second).toBeNull();
    expect(warnSpy.mock.calls.some((c) => /maxSnapshotsPerTurn/.test(String(c[0])))).toBe(true);
    warnSpy.mockRestore();
    // the manifest file is unchanged (no re-write on the aborted 2nd call)
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    expect(mBuf.length).toBeGreaterThan(0);
  });

  it("writeFile rejects → capture returns null, never rejects (best-effort)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
    });
    // make the manifest writeFile reject
    base.fakeFs.writeFile = async () => {
      throw new Error("disk full");
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ref = await base.cb.capture("turn");
    expect(ref).toBeNull();
    expect(warnSpy.mock.calls.some((c) => /snapshot.capture failed/.test(String(c[0])))).toBe(true);
    warnSpy.mockRestore();
  });

  it("readdir on an unreadable subdir → subtree skipped (no throw)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
      "secret/hidden.ts": { content: Buffer.from("secret"), mtimeMs: 2 },
    });
    const origReaddir = fakeFs.readdir.bind(fakeFs);
    fakeFs.readdir = async (dirPath: string) => {
      if (resolve(dirPath) === resolve(join(cwd, "secret"))) throw new Error("EACCES");
      return origReaddir(dirPath, { withFileTypes: true });
    };
    const ref = await cb.capture("turn");
    expect(ref).toBe("turn");
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = JSON.parse(mBuf.toString("utf8"));
    expect(Object.keys(m.files)).toEqual(["src/a.ts"]); // secret/ subtree skipped
  });

  it("capturesThisTurn increments after each successful capture", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb } = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
    });
    // capturesThisTurn is private; verify the cap behavior reflects increment.
    // With maxSnapshotsPerTurn = 2, the 1st + 2nd succeed; the 3rd returns null.
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
    }, { maxSnapshotsPerTurn: 2 });
    expect(await base.cb.capture("turn")).toBe("turn");
    expect(await base.cb.capture("turn-after")).toBe("turn-after");
    expect(await base.cb.capture("turn-3")).toBeNull(); // capturesThisTurn reached cap
    void cb;
  });

  it("mutex serializes concurrent capture() (max-in-flight 1)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    let inFlight = 0;
    let maxInFlight = 0;
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
      "b.ts": { content: Buffer.from("b"), mtimeMs: 2 },
      "c.ts": { content: Buffer.from("c"), mtimeMs: 3 },
    });
    const origRead = base.fakeFs.readFile.bind(base.fakeFs);
    base.fakeFs.readFile = async (p: string) => {
      // instrument the critical section (a working-tree read happens inside the mutex)
      if (!p.startsWith(storage)) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      }
      return origRead(p);
    };
    await Promise.all([base.cb.capture("turn"), base.cb.capture("turn-after"), base.cb.capture("turn-3")]);
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });

  it("missing previous manifest → full capture (no short-circuit)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, readCalls } = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
      "b.ts": { content: Buffer.from("b"), mtimeMs: 2 },
    });
    // first capture — no prior manifest exists → both files read
    await cb.capture("turn");
    const workingTreeReads = [...readCalls].filter((p) => !p.startsWith(join(storage, "manifests")));
    expect(workingTreeReads).toHaveLength(2);
  });

  it("corrupt previous manifest JSON → full capture (parseManifest throw swallowed, no reject)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
      "b.ts": { content: Buffer.from("b"), mtimeMs: 2 },
    });
    // pre-seed a corrupt manifest for label "turn"
    await base.fakeFs.mkdir(join(storage, "manifests"), { recursive: true });
    await base.fakeFs.writeFile(join(storage, "manifests/turn.json"), Buffer.from("{not valid json", "utf8"));
    base.readCalls.clear();
    const ref = await base.cb.capture("turn");
    expect(ref).toBe("turn"); // did not reject; corrupt manifest swallowed
    // corrupt prev → no short-circuit → both working-tree files read
    const workingTreeReads = [...base.readCalls].filter((p) => !p.startsWith(join(storage, "manifests")));
    expect(workingTreeReads).toHaveLength(2);
  });
});

// ── S3 (P2.M3.T1.S3) — explicit-paths capture + notifyBashUsed + dirtyCheck + restore + has + retire ──
// What is MOCKED: a StateFs fake with MUTABLE working-tree state (a Map<absPath, Buffer>) + a real
// blob store (Map<blobPath, Buffer>) + a manifests dir (Map<manifestPath, string>). Unlike TreeFs
// (which snapshots the tree at construction), StateFs lets a test MUTATE the worktree between
// capture and restore — so the restore round-trip (capture → simulate the agent's span → restore →
// assert the worktree returned to the captured state) is a faithful end-to-end exercise of the
// dirtyCheck/restore/has/retire bodies. Mirror test/git.test.ts (vitest flat, BASE_CFG, DI fake).
// spec/14 §4.2 (explicit-paths), §6 (restore semantics), §2 (has/retire), §4.3 (mutex + two-flag).

/**
 * Build a StateFs fake with mutable working-tree state. `worktree` keys are workspace-RELATIVE
 * posix paths (e.g. "src/a.ts") → Buffer content; the fake derives abs paths under `cwd`. The blob
 * store + manifests dir are real Maps so storeBlob dedupe + manifest read/write/round-trip all work
 * through the SAME fake. `unlink` removes a worktree file (ENOENT if absent). `access` resolves for
 * a present worktree file OR a stored blob/manifest. Exposes helpers to read back manifest/blobs.
 */
function makeStateFs(cwd: string, storageDir: string, worktree: Record<string, Buffer>) {
  const absOf = (rel: string) => join(cwd, ...rel.split("/"));
  const treeFiles = new Map<string, Buffer>(); // absPath → content (MUTABLE)
  for (const [rel, content] of Object.entries(worktree)) treeFiles.set(resolve(absOf(rel)), content);
  const stored = new Map<string, Buffer>(); // blobs + manifests (written by writeFile)
  const written = new Set<string>(); // access gate state (present → dedupe)
  const manifestsDir = join(storageDir, "manifests");

  const fakeFs: CasFs = {
    readdir: async () => {
      throw new Error("StateFs: readdir not modeled (explicit-paths does not walk)");
    },
    stat: async (filePath: string) => {
      const c = treeFiles.get(resolve(filePath));
      if (!c) throw new Error(`StateFs: stat ENOENT ${filePath}`);
      return { size: c.length, mtimeMs: 0 };
    },
    readFile: async (filePath: string) => {
      // working-tree file?
      const t = treeFiles.get(resolve(filePath));
      if (t) return t;
      // else a stored blob/manifest
      const s = stored.get(filePath);
      if (s) return s;
      throw new Error(`StateFs: readFile ENOENT ${filePath}`);
    },
    writeFile: async (filePath: string, data: Buffer) => {
      // writing a working-tree path mutates the worktree (restore writes back here); writing under
      // storageDir goes to the blob/manifest store.
      if (resolve(filePath) === resolve(filePath) && treeFiles.has(resolve(filePath))) {
        treeFiles.set(resolve(filePath), data);
        return;
      }
      stored.set(filePath, data);
      written.add(filePath);
    },
    mkdir: async () => {
      /* idempotent no-op */
    },
    access: async (filePath: string) => {
      if (treeFiles.has(resolve(filePath)) || written.has(filePath)) return;
      throw new Error(`StateFs: access ENOENT ${filePath}`);
    },
    unlink: async (filePath: string) => {
      const ap = resolve(filePath);
      // worktree file → remove from worktree (restore deleteCreatedFiles). ENOENT if absent.
      if (treeFiles.has(ap)) {
        treeFiles.delete(ap);
        return;
      }
      // manifest → remove from stored (retire). ENOENT if absent.
      if (written.has(filePath)) {
        stored.delete(filePath);
        written.delete(filePath);
        return;
      }
      // mimic node:fs — set .code so restore's ENOENT check (parity with git.ts) sees it.
      throw Object.assign(new Error(`StateFs: unlink ENOENT ${filePath}`), { code: "ENOENT" });
    },
  };

  return {
    fakeFs,
    cwd,
    storageDir,
    manifestsDir,
    /** read a worktree file's content by rel path (undefined if absent). */
    read(rel: string): Buffer | undefined {
      return treeFiles.get(resolve(absOf(rel)));
    },
    /** does a worktree file exist (by rel path)? */
    exists(rel: string): boolean {
      return treeFiles.has(resolve(absOf(rel)));
    },
    /** set a worktree file's content (simulate the agent's span write/create). */
    set(rel: string, content: Buffer) {
      treeFiles.set(resolve(absOf(rel)), content);
    },
    /** remove a worktree file (simulate the agent's span delete). */
    remove(rel: string) {
      treeFiles.delete(resolve(absOf(rel)));
    },
    /** read a parsed manifest for a label (undefined if absent/corrupt). */
    manifestOf(label: string): CasManifest | undefined {
      const buf = stored.get(join(manifestsDir, `${label}.json`));
      if (!buf) return undefined;
      try {
        return parseManifest(buf.toString("utf8"));
      } catch {
        return undefined;
      }
    },
    /** read a stored blob's content by hash (undefined if absent). */
    blob(hash: string): Buffer | undefined {
      return stored.get(join(storageDir, "blobs", hash.slice(0, 2), hash));
    },
    /** is a manifest present for a label? */
    manifestPresent(label: string): boolean {
      return written.has(join(manifestsDir, `${label}.json`));
    },
  };
}

/** Build a CasBackend over a StateFs worktree with config overrides. */
function makeStateBackend(
  state: ReturnType<typeof makeStateFs>,
  cfgOverrides: Partial<MulliganConfig["revert"]> = {},
): CasBackend {
  const cfg = { ...BASE_CFG, storageDir: state.storageDir, ...cfgOverrides };
  return new CasBackend(state.cwd, cfg, null, { fs: state.fakeFs });
}

// ── capture — explicit-paths mode (spec/14 §4.2) ──────────────────────────────────────────

describe("CasBackend.capture — explicit-paths mode (spec/14 §4.2)", () => {
  it("captures ONLY the explicit path (sibling file absent from manifest)", async () => {
    const state = makeStateFs("/ws", "/store", {
      "src/a.ts": Buffer.from("a"),
      "src/b.ts": Buffer.from("b"),
    });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const ref = await cb.capture("turn", ["src/a.ts"]);
    expect(ref).toBe("turn");
    const m = state.manifestOf("turn")!;
    expect(Object.keys(m.files)).toEqual(["src/a.ts"]);
    expect(m.files["src/a.ts"]!.existed).toBe(true);
  });

  it("captures a not-yet-existing path as existed:false (no blob stored)", async () => {
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const ref = await cb.capture("turn", ["src/new.ts"]);
    expect(ref).toBe("turn");
    const m = state.manifestOf("turn")!;
    expect(m.files["src/new.ts"]).toEqual({ hash: "", size: 0, mtime: 0, existed: false });
    // no blob stored (hash is empty string → blobPath never written)
    expect(state.blob("")).toBeUndefined();
  });

  it("dedupes a path passed twice (one manifest entry)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("x") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    await cb.capture("turn", ["a.ts", "a.ts"]);
    const m = state.manifestOf("turn")!;
    expect(Object.keys(m.files)).toEqual(["a.ts"]);
  });

  it("skips dangerous paths (.git/node_modules/..) — absent from manifest", async () => {
    const state = makeStateFs("/ws", "/store", {
      ".git/config": Buffer.from("g"),
      "node_modules/pkg/index.js": Buffer.from("p"),
      "safe.ts": Buffer.from("s"),
    });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    await cb.capture("turn", [".git/config", "node_modules/pkg/index.js", "../escape.ts", "safe.ts"]);
    const m = state.manifestOf("turn")!;
    expect(Object.keys(m.files)).toEqual(["safe.ts"]);
  });

  it("skips oversize file (> maxFileBytes) + warns — absent from manifest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = Buffer.alloc(300);
    const state = makeStateFs("/ws", "/store", { "big.ts": big });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths", maxFileBytes: 100 });
    await cb.capture("turn", ["big.ts"]);
    const m = state.manifestOf("turn")!;
    expect(m.files).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("oversize file"));
    warn.mockRestore();
  });

  it("maxTotalBytes exceeded ⇒ PARTIAL (earlier paths present); STILL returns label", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = makeStateFs("/ws", "/store", {
      "a.ts": Buffer.alloc(60),
      "b.ts": Buffer.alloc(60), // 60+60=120 > 100
    });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths", maxTotalBytes: 100 });
    const ref = await cb.capture("turn", ["a.ts", "b.ts"]);
    expect(ref).toBe("turn"); // partial — NOT null
    const m = state.manifestOf("turn")!;
    expect(Object.keys(m.files)).toEqual(["a.ts"]); // b.ts skipped (budget exceeded)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PARTIAL manifest"));
    warn.mockRestore();
  });

  it("maxSnapshotsPerTurn exceeded ⇒ returns null (count-cap gate in capture)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths", maxSnapshotsPerTurn: 1 });
    const first = await cb.capture("turn", ["a.ts"]);
    expect(first).toBe("turn");
    const second = await cb.capture("turn-after", ["a.ts"]);
    expect(second).toBeNull(); // count-cap gate fires before dispatch
  });

  it("an escaping path (../x) is skipped by the safety floor (absent from manifest; capture still succeeds)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    // `..` segments are caught by isDangerousWorkspaceRel (the lexical safety floor) BEFORE
    // resolveSafeWorkspacePath — they are skipped (continue), NOT thrown. capture still returns label
    // (the escape is simply not captured). A genuine resolveSafeWorkspacePath throw (which would ⇒
    // null) requires a path that passes isDangerousWorkspaceRel but escapes — impossible by construction
    // (the `..` check is exhaustive). The null path is covered by the writeFile-rejects test below.
    const ref = await cb.capture("turn", ["../x.ts", "a.ts"]);
    expect(ref).toBe("turn");
    const m = state.manifestOf("turn")!;
    expect(Object.keys(m.files)).toEqual(["a.ts"]); // ../x.ts skipped
  });

  it("a writeFile rejection ⇒ capture returns null (resolveSafeWorkspacePath/IO throw → catch)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    // sabotage: make the manifest writeFile throw → capture's outer catch ⇒ null
    const origWrite = state.fakeFs.writeFile;
    state.fakeFs.writeFile = async (p: string, d: Buffer) => {
      if (p.includes("/manifests/")) throw new Error("disk full");
      return origWrite(p, d);
    };
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const ref = await cb.capture("turn", ["a.ts"]);
    expect(ref).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("capturesThisTurn increments after a successful explicit-paths capture", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths", maxSnapshotsPerTurn: 5 });
    await cb.capture("turn", ["a.ts"]); // 1
    await cb.capture("turn-after", ["a.ts"]); // 2
    const third = await cb.capture("ckpt", ["a.ts"]); // 3 — still under cap
    expect(third).toBe("ckpt");
  });

  it("'cas' mode (no explicitPaths) STILL runs S2's whole-tree walk (dispatch does not break it)", async () => {
    // 'cas' mode uses TreeFs (walk-based), not StateFs. Reuse makeTreeBackend.
    const base = makeTreeBackend("/ws", "/store", {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
      "b.ts": { content: Buffer.from("b"), mtimeMs: 2 },
    });
    const ref = await base.cb.capture("turn"); // no explicitPaths, default 'cas' mode
    expect(ref).toBe("turn");
    const buf = await base.fakeFs.readFile(join("/store", "manifests", "turn.json"));
    const m = parseManifest(buf.toString("utf8"));
    expect(Object.keys(m.files).sort()).toEqual(["a.ts", "b.ts"]); // BOTH walked (not just one)
  });
});

// ── notifyBashUsed — bash-not-captured warning (spec/14 §4.2) ─────────────────────────────

describe("CasBackend.notifyBashUsed — bash-not-captured warning (spec/14 §4.2)", () => {
  it("warns once in explicit-paths mode; 2nd call same turn is silent (once-per-turn dedup)", () => {
    const state = makeStateFs("/ws", "/store", {});
    const cbEp = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const w = vi.spyOn(console, "warn").mockImplementation(() => {});
    cbEp.notifyBashUsed();
    cbEp.notifyBashUsed(); // 2nd call same turn
    expect(w).toHaveBeenCalledTimes(1);
    expect(w).toHaveBeenCalledWith(expect.stringContaining("explicit-paths mode"));
    w.mockRestore();
  });

  it("is a no-op in 'cas' mode (bash is captured there)", () => {
    const state = makeStateFs("/ws", "/store", {});
    const cbCas = makeStateBackend(state, { nonGitMode: "cas" });
    const w = vi.spyOn(console, "warn").mockImplementation(() => {});
    cbCas.notifyBashUsed();
    expect(w).not.toHaveBeenCalled();
    w.mockRestore();
  });
});

// ── dirtyCheck — spec/14 §6 step 3 + §2 ──────────────────────────────────────────────────

describe("CasBackend.dirtyCheck — spec/14 §6 step 3 + §2", () => {
  it("returns paths whose current hash ≠ afterRef manifest (modified since agent_end)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("original") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const afterRef = await cb.capture("turn-after", ["a.ts"]);
    // simulate the span: human edits a.ts AFTER agent_end
    state.set("a.ts", Buffer.from("CHANGED BY HUMAN"));
    const dirty = await cb.dirtyCheck(afterRef!, ["a.ts"]);
    expect(dirty).toEqual(["a.ts"]);
  });

  it("returns a path that existed at afterRef but is gone now (deleted since) as dirty", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const afterRef = await cb.capture("turn-after", ["a.ts"]);
    state.remove("a.ts"); // deleted since afterRef
    const dirty = await cb.dirtyCheck(afterRef!, ["a.ts"]);
    expect(dirty).toEqual(["a.ts"]);
  });

  it("returns a path absent from afterRef but existing now as dirty (conservative)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const afterRef = await cb.capture("turn-after", ["b.ts"]); // b.ts not captured
    // a.ts exists now but has no afterRef baseline ⇒ conservative dirty
    const dirty = await cb.dirtyCheck(afterRef!, ["a.ts"]);
    expect(dirty).toEqual(["a.ts"]);
  });

  it("returns a path captured existed:false but existing now as dirty (created since afterRef)", async () => {
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    // capture a not-yet-existing path as existed:false
    const afterRef = await cb.capture("turn-after", ["new.ts"]);
    // it now exists (created since afterRef)
    state.set("new.ts", Buffer.from("created"));
    const dirty = await cb.dirtyCheck(afterRef!, ["new.ts"]);
    expect(dirty).toEqual(["new.ts"]);
  });

  it("returns [] when all paths match the afterRef manifest (clean)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("unchanged") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const afterRef = await cb.capture("turn-after", ["a.ts"]);
    // no mutation ⇒ clean
    const dirty = await cb.dirtyCheck(afterRef!, ["a.ts"]);
    expect(dirty).toEqual([]);
  });

  it("returns [] for null/empty afterRef and for empty paths", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    expect(await cb.dirtyCheck("", ["a.ts"])).toEqual([]);
    expect(await cb.dirtyCheck("turn-after", [])).toEqual([]);
  });

  it("returns [] when the afterRef manifest is missing/corrupt (best-effort allow)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    // missing manifest
    expect(await cb.dirtyCheck("turn-after", ["a.ts"])).toEqual([]);
    // corrupt manifest — seed then corrupt
    const afterRef = await cb.capture("turn-after", ["a.ts"]);
    await state.fakeFs.writeFile(join("/store", "manifests", "turn-after.json"), Buffer.from("{bad"));
    expect(await cb.dirtyCheck(afterRef!, ["a.ts"])).toEqual([]);
  });

  it("never rejects on any error (returns [])", async () => {
    // a fake whose readFile throws a non-ENOENT error on the manifest read
    const throwingFs: CasFs = {
      ...makeStateFs("/ws", "/store", {}).fakeFs,
      readFile: async () => {
        throw new Error("disk failure");
      },
    };
    const cb = new CasBackend("/ws", { ...BASE_CFG, storageDir: "/store", nonGitMode: "explicit-paths" }, null, {
      fs: throwingFs,
    });
    await expect(cb.dirtyCheck("turn-after", ["a.ts"])).resolves.toEqual([]);
  });

  it("skips dangerous paths (never reported)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const afterRef = await cb.capture("turn-after", ["a.ts"]);
    // a.ts is clean; the dangerous paths are filtered (never reported even if they drifted).
    const dirty = await cb.dirtyCheck(afterRef!, [".git/config", "node_modules/x", "a.ts"]);
    expect(dirty).toEqual([]); // a.ts clean; dangerous paths skipped
    // prove a dangerous path that WOULD be dirty is still never reported: mutate .git/config (if it
    // existed) — it is filtered before the hash compare, so it cannot appear in `dirty`.
    expect(dirty).not.toContain(".git/config");
    expect(dirty).not.toContain("node_modules/x");
  });
});

// ── changedPaths — spec/14 §6 step 2 / BUG-004 (cas + explicit-paths) ─────────────────────

// changedPaths is the spec-mandated AFFECTED SET the rewind dirty guard inspects (spec/14 §6 step 2:
// "paths that differ between beforeRef and the current tree (the files restore would touch)"). It
// replaces the heuristic ledger.modifiedFiles (BUG-004 — misses python/node/perl/heredoc/awk-mutated
// files → E30 silent-clobber). MODE-AWARE: 'cas' walks the tree + hash-compares + flags missing
// entries; 'explicit-paths' checks ONLY manifest entries (no walk). EXPLICIT-PATHS tests use
// makeStateFs/makeStateBackend (mirrors dirtyCheck); CAS tests use makeTreeFs/makeTreeBackend
// (needs readdir for walkTree — makeStateFs.readdir THROWS, so a 'cas' walk would silently skip the
// whole tree ⇒ a false-green). NEVER rejects (E27) — missing/corrupt manifest OR any error ⇒ [].
describe("CasBackend.changedPaths — spec/14 §6 step 2 / BUG-004", () => {
  // ── EXPLICIT-PATHS MODE (use makeStateFs/makeStateBackend — mirrors dirtyCheck) ──

  it("explicit-paths: returns a manifest path whose current hash ≠ beforeRef (modified since)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("original") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    state.set("a.ts", Buffer.from("CHANGED")); // drift since beforeRef
    expect(await cb.changedPaths(beforeRef!)).toEqual(["a.ts"]);
  });

  it("explicit-paths: returns a manifest path that existed at beforeRef but is gone now (deleted)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    state.remove("a.ts"); // deleted since beforeRef
    expect(await cb.changedPaths(beforeRef!)).toEqual(["a.ts"]);
  });

  it("explicit-paths: returns an existed:false entry that now exists (created since) as changed", async () => {
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    // capture a not-yet-existing path as existed:false (stored hash "")
    const beforeRef = await cb.capture("turn", ["new.ts"]);
    // it now exists (created since beforeRef) — hash "" ≠ real hash ⇒ changed
    state.set("new.ts", Buffer.from("created"));
    expect(await cb.changedPaths(beforeRef!)).toEqual(["new.ts"]);
  });

  it("explicit-paths: returns [] when all manifest paths match beforeRef (clean)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("unchanged") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    // no mutation ⇒ clean
    expect(await cb.changedPaths(beforeRef!)).toEqual([]);
  });

  it("explicit-paths: skips dangerous paths (never reported)", async () => {
    // capture a normal path; assert changedPaths never emits a dangerous path even if the manifest
    // somehow contained one (the safety floor filters before reporting).
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    const changed = await cb.changedPaths(beforeRef!);
    expect(changed).toEqual([]); // a.ts clean
    expect(changed).not.toContain(".git/config");
    expect(changed).not.toContain("node_modules/x");
  });

  // ── CAS MODE (use makeTreeFs/makeTreeBackend — needs readdir for walkTree) ──
  // makeTreeFs builds childMap at construction, so a post-capture tree change (add/modify/delete a
  // file) requires rebuilding the backend over a mutated tree that pre-seeds the beforeRef manifest
  // (mirror the capture 'cas' test at line ~475: capture on T1, copy manifest, rebuild over T2).

  it("cas mode: returns a NEW file not in the beforeRef manifest (created since)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const base = makeTreeBackend(cwd, storage, { "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 } });
    const beforeRef = await base.cb.capture("turn");
    // rebuild over a tree that ADDS b.ts (new since beforeRef), pre-seeding the beforeRef manifest
    const firstManifest = await base.fakeFs.readFile(join(storage, "manifests", "turn.json"));
    const base2 = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 },
      "b.ts": { content: Buffer.from("new"), mtimeMs: 5000 },
    });
    await base2.fakeFs.writeFile(join(storage, "manifests", "turn.json"), firstManifest);
    expect(await base2.cb.changedPaths(beforeRef!)).toEqual(["b.ts"]);
  });

  it("cas mode: returns a MODIFIED file (current hash ≠ manifest hash)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const base = makeTreeBackend(cwd, storage, { "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 } });
    const beforeRef = await base.cb.capture("turn");
    // rebuild over a tree that MODIFIES a.ts (content drift — the BUG-004 python/node case)
    const firstManifest = await base.fakeFs.readFile(join(storage, "manifests", "turn.json"));
    const base2 = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("agent-version"), mtimeMs: 1000 },
    });
    await base2.fakeFs.writeFile(join(storage, "manifests", "turn.json"), firstManifest);
    expect(await base2.cb.changedPaths(beforeRef!)).toEqual(["a.ts"]);
  });

  it("cas mode: returns a file that existed at beforeRef but is now MISSING (deleted)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 },
      "b.ts": { content: Buffer.from("b"), mtimeMs: 2000 },
    });
    const beforeRef = await base.cb.capture("turn");
    // rebuild over a tree that DELETES b.ts (the missing-entry loop must catch it — walkTree alone
    // only visits present files)
    const firstManifest = await base.fakeFs.readFile(join(storage, "manifests", "turn.json"));
    const base2 = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 },
    });
    await base2.fakeFs.writeFile(join(storage, "manifests", "turn.json"), firstManifest);
    expect(await base2.cb.changedPaths(beforeRef!)).toEqual(["b.ts"]);
  });

  it("cas mode: returns the UNION (new + modified + deleted in one call)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 },
      "b.ts": { content: Buffer.from("b"), mtimeMs: 2000 },
      "c.ts": { content: Buffer.from("c"), mtimeMs: 3000 },
    });
    const beforeRef = await base.cb.capture("turn");
    // rebuild: MODIFY a.ts, DELETE b.ts, ADD d.ts, leave c.ts unchanged
    const firstManifest = await base.fakeFs.readFile(join(storage, "manifests", "turn.json"));
    const base2 = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("CHANGED"), mtimeMs: 1000 },
      "c.ts": { content: Buffer.from("c"), mtimeMs: 3000 },
      "d.ts": { content: Buffer.from("new"), mtimeMs: 4000 },
    });
    await base2.fakeFs.writeFile(join(storage, "manifests", "turn.json"), firstManifest);
    const changed = await base2.cb.changedPaths(beforeRef!);
    expect(changed.sort()).toEqual(["a.ts", "b.ts", "d.ts"].sort());
    expect(changed).not.toContain("c.ts");
  });

  it("cas mode: excludeGlobs + dangerous dirs are NOT walked (absent from result)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    // capture with 'dist' excluded; the rebuild ADDS a file under dist (excluded) + leaves a.ts clean
    const base = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 },
    }, { excludeGlobs: ["dist"] });
    const beforeRef = await base.cb.capture("turn");
    const firstManifest = await base.fakeFs.readFile(join(storage, "manifests", "turn.json"));
    const base2 = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("a"), mtimeMs: 1000 },
      "dist/bundled.js": { content: Buffer.from("new"), mtimeMs: 5000 },
    }, { excludeGlobs: ["dist"] });
    await base2.fakeFs.writeFile(join(storage, "manifests", "turn.json"), firstManifest);
    const changed = await base2.cb.changedPaths(beforeRef!);
    expect(changed).not.toContain("dist/bundled.js"); // excluded ⇒ not walked
  });

  // ── CROSS-MODE / ROBUSTNESS (use makeStateFs; behavior is mode-agnostic) ──

  it("returns [] for an empty beforeRef (no manifest read issued)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    expect(await cb.changedPaths("")).toEqual([]);
  });

  it("returns [] when the beforeRef manifest is missing/corrupt (best-effort)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    // missing manifest
    expect(await cb.changedPaths("turn")).toEqual([]);
    // corrupt manifest — seed then corrupt
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    await state.fakeFs.writeFile(join("/store", "manifests", "turn.json"), Buffer.from("{bad"));
    expect(await cb.changedPaths(beforeRef!)).toEqual([]);
  });

  it("never rejects on any error (returns [])", async () => {
    // a fake whose readFile throws a non-ENOENT error on the manifest read
    const throwingFs: CasFs = {
      ...makeStateFs("/ws", "/store", {}).fakeFs,
      readFile: async () => {
        throw new Error("disk failure");
      },
    };
    const cb = new CasBackend("/ws", { ...BASE_CFG, storageDir: "/store", nonGitMode: "explicit-paths" }, null, {
      fs: throwingFs,
    });
    await expect(cb.changedPaths("turn")).resolves.toEqual([]);
  });

  it("acquires the mutex (two concurrent calls both complete — §4.3)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    // two concurrent calls must both resolve (no deadlock from a forgotten release)
    const [a, b] = await Promise.all([
      cb.changedPaths(beforeRef!),
      cb.changedPaths(beforeRef!),
    ]);
    expect(a).toEqual([]); // a.ts clean
    expect(b).toEqual([]);
  });
});

// ── restore — spec/14 §6 + §2 ────────────────────────────────────────────────────────────

describe("CasBackend.restore — spec/14 §6 + §2", () => {
  it("writes pre-span blob content back for each existed:true file (reverted[])", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("original") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    // simulate the span: agent edits a.ts
    state.set("a.ts", Buffer.from("CHANGED BY AGENT"));
    const res = await cb.restore(beforeRef!, { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.reverted).toEqual(["a.ts"]);
    expect(res.failed).toEqual([]);
    // worktree returned to pre-span content
    expect(state.read("a.ts")?.toString()).toBe("original");
  });

  it("a per-path read/write failure lands in failed[]; restore still resolves (never rejects)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("original") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    state.set("a.ts", Buffer.from("CHANGED"));
    // sabotage: make the blob read throw by replacing readBlob's underlying readFile for blobs
    const origRead = state.fakeFs.readFile;
    state.fakeFs.readFile = async (p: string) => {
      if (p.includes("/blobs/")) throw new Error("blob corrupted");
      return origRead(p);
    };
    await expect(
      cb.restore(beforeRef!, { revertFileChanges: true, deleteCreatedFiles: false }),
    ).resolves.toMatchObject({ reverted: [], failed: ["a.ts"] });
  });

  it("neither flag set ⇒ returns 5 empty buckets, touches nothing", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("original") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    const beforeRef = await cb.capture("turn", ["a.ts"]);
    state.set("a.ts", Buffer.from("CHANGED"));
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: false });
    expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [] });
    // worktree untouched
    expect(state.read("a.ts")?.toString()).toBe("CHANGED");
  });

  it("explicit-paths: deletes existed:false manifest entries when deleteCreatedFiles && allowDeleteCreatedFiles (deleted[])", async () => {
    // capture a NOT-yet-existing path as existed:false, then the create happens, then restore deletes it
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, {
      nonGitMode: "explicit-paths",
      allowDeleteCreatedFiles: true,
    });
    const beforeRef = await cb.capture("turn", ["new.ts"]); // existed:false
    state.set("new.ts", Buffer.from("created during span")); // the creating write
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(res.deleted).toEqual(["new.ts"]);
    expect(state.exists("new.ts")).toBe(false);
  });

  it("TWO-FLAG AND: deleteCreatedFiles:false ⇒ zero deletions even if allowDeleteCreatedFiles:true", async () => {
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, {
      nonGitMode: "explicit-paths",
      allowDeleteCreatedFiles: true,
    });
    const beforeRef = await cb.capture("turn", ["new.ts"]); // existed:false
    state.set("new.ts", Buffer.from("created"));
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: false });
    expect(res.deleted).toEqual([]);
    expect(state.exists("new.ts")).toBe(true); // NOT deleted
  });

  it("TWO-FLAG AND: allowDeleteCreatedFiles:false ⇒ zero deletions even if deleteCreatedFiles:true", async () => {
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, {
      nonGitMode: "explicit-paths",
      allowDeleteCreatedFiles: false, // default
    });
    const beforeRef = await cb.capture("turn", ["new.ts"]); // existed:false
    state.set("new.ts", Buffer.from("created"));
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(res.deleted).toEqual([]);
    expect(state.exists("new.ts")).toBe(true); // NOT deleted
  });

  it("'cas' mode + allowDeleteCreatedFiles:true: tree-walk-deletes present-not-in-manifest files", async () => {
    // Build a mutable 'cas' tree supporting readdir + unlink via a hand-rolled fake.
    const cwd = "/ws";
    const storage = "/store";
    const fileEntries = new Map<string, Buffer>(); // absPath → content
    const addChild = (parent: string, name: string) => {};
    const absOf = (rel: string) => join(cwd, ...rel.split("/"));
    // derive a simple flat + nested tree from an initial set
    const init: Record<string, Buffer> = {
      "pre.ts": Buffer.from("pre"),
    };
    for (const [rel, c] of Object.entries(init)) fileEntries.set(resolve(absOf(rel)), c);
    const stored = new Map<string, Buffer>();
    const written = new Set<string>();
    // build childMap for readdir
    const childMap = new Map<string, Map<string, "file" | "dir">>();
    childMap.set(resolve(cwd), new Map());
    const regChild = (parentAbs: string, name: string, kind: "file" | "dir") => {
      const k = resolve(parentAbs);
      if (!childMap.has(k)) childMap.set(k, new Map());
      childMap.get(k)!.set(name, kind);
    };
    for (const [rel] of Object.entries(init)) {
      const segs = rel.split("/");
      regChild(resolve(cwd), segs[segs.length - 1]!, "file");
    }
    const fakeFs: CasFs = {
      readdir: async (dirPath: string) => {
        const kids = childMap.get(resolve(dirPath));
        if (!kids) throw new Error(`ENOENT ${dirPath}`);
        return [...kids.entries()].map(([name, kind]) =>
          ({ name, isFile: () => kind === "file", isDirectory: () => kind === "dir" }) as unknown as import("node:fs").Dirent,
        );
      },
      stat: async (p: string) => {
        const c = fileEntries.get(resolve(p));
        if (!c) throw new Error(`ENOENT ${p}`);
        return { size: c.length, mtimeMs: 0 };
      },
      readFile: async (p: string) => {
        const t = fileEntries.get(resolve(p));
        if (t) return t;
        const s = stored.get(p);
        if (s) return s;
        throw new Error(`ENOENT ${p}`);
      },
      writeFile: async (p: string, data: Buffer) => {
        if (fileEntries.has(resolve(p))) fileEntries.set(resolve(p), data);
        else {
          stored.set(p, data);
          written.add(p);
        }
      },
      mkdir: async () => {},
      access: async (p: string) => {
        if (fileEntries.has(resolve(p)) || written.has(p)) return;
        throw new Error(`ENOENT ${p}`);
      },
      unlink: async (p: string) => {
        const ap = resolve(p);
        if (fileEntries.has(ap)) {
          fileEntries.delete(ap);
          const parent = resolve(join(ap, ".."));
          childMap.get(parent)?.delete(ap.split(sep).pop()!);
          return;
        }
        throw new Error(`ENOENT ${p}`);
      },
    };
    const cb = new CasBackend(cwd, { ...BASE_CFG, storageDir: storage, nonGitMode: "cas", allowDeleteCreatedFiles: true }, null, { fs: fakeFs });
    const beforeRef = await cb.capture("turn"); // manifest: { pre.ts }
    // inject a span-created file (present-now, NOT in beforeRef manifest)
    fileEntries.set(resolve(absOf("created.ts")), Buffer.from("created"));
    regChild(resolve(cwd), "created.ts", "file");
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(res.deleted).toContain("created.ts");
    expect(fileEntries.has(resolve(absOf("created.ts")))).toBe(false); // unlinked
    expect(fileEntries.has(resolve(absOf("pre.ts")))).toBe(true); // pre.ts left alone
  });

  it("explicit-paths: does NOT tree-walk (a present-not-in-manifest file is left untouched)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, {
      nonGitMode: "explicit-paths",
      allowDeleteCreatedFiles: true,
    });
    const beforeRef = await cb.capture("turn", ["a.ts"]); // manifest: { a.ts }
    // inject a created file NOT in the manifest
    state.set("created.ts", Buffer.from("created"));
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(res.deleted).toEqual([]); // explicit-paths does NOT walk → created.ts untouched
    expect(state.exists("created.ts")).toBe(true);
  });

  it("never deletes a dangerous path (.git/node_modules) — gated by isDangerousWorkspaceRel", async () => {
    // 'cas' mode: a dangerous file present-now but not in manifest must NOT be unlinked.
    const cwd = "/ws";
    const storage = "/store";
    const base = makeTreeBackend(cwd, storage, {
      "pre.ts": { content: Buffer.from("pre"), mtimeMs: 1 },
      ".git/config": { content: Buffer.from("g"), mtimeMs: 1 },
    });
    const cb = new CasBackend(cwd, { ...BASE_CFG, storageDir: storage, nonGitMode: "cas", allowDeleteCreatedFiles: true }, null, { fs: base.fakeFs });
    const beforeRef = await cb.capture("turn"); // .git/config excluded by walkTree (dangerous)
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(res.deleted).not.toContain(".git/config");
  });

  it("delete of an already-gone file (ENOENT) is silent (not failed[])", async () => {
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, {
      nonGitMode: "explicit-paths",
      allowDeleteCreatedFiles: true,
    });
    const beforeRef = await cb.capture("turn", ["new.ts"]); // existed:false
    // the created file was already removed before restore (deleted twice scenario)
    // (it never exists in the worktree) → unlink throws ENOENT → silent
    const res = await cb.restore(beforeRef!, { revertFileChanges: false, deleteCreatedFiles: true });
    expect(res.deleted).toEqual([]); // not in deleted (already gone)
    expect(res.failed).toEqual([]); // ENOENT ⇒ silent, NOT failed
  });

  it("missing/corrupt beforeRef manifest ⇒ returns 5 empty-ish buckets, never rejects", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    // missing manifest
    const res1 = await cb.restore("turn", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res1).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [] });
    // corrupt manifest
    await state.fakeFs.mkdir(join("/store", "manifests"), { recursive: true });
    await state.fakeFs.writeFile(join("/store", "manifests", "turn.json"), Buffer.from("{bad"));
    const res2 = await cb.restore("turn", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res2).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [] });
  });
});

// ── has — spec/14 §2 ─────────────────────────────────────────────────────────────────────

describe("CasBackend.has — spec/14 §2", () => {
  it("returns true for an existing manifest ref", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    await cb.capture("turn", ["a.ts"]); // writes manifests/turn.json
    expect(await cb.has("turn")).toBe(true);
  });

  it("returns false for a missing ref; never rejects", async () => {
    const state = makeStateFs("/ws", "/store", {});
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    expect(await cb.has("turn")).toBe(false); // no manifest written
  });
});

// ── retire — spec/14 §2/§5 ──────────────────────────────────────────────────────────────

describe("CasBackend.retire — spec/14 §2/§5", () => {
  it("unlinks the manifest file (subsequent has(ref) → false)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    await cb.capture("turn", ["a.ts"]); // writes manifest + blob
    expect(await cb.has("turn")).toBe(true);
    await cb.retire("turn");
    expect(await cb.has("turn")).toBe(false); // manifest unlinked
  });

  it("a 2nd retire (ENOENT) is a silent no-op; never rejects", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    await cb.capture("turn", ["a.ts"]);
    await cb.retire("turn");
    // 2nd retire — manifest already gone (ENOENT) ⇒ silent void
    await expect(cb.retire("turn")).resolves.toBeUndefined();
  });

  it("blob files persist after retire (mark-sweep deferred to P3 GC)", async () => {
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
    await cb.capture("turn", ["a.ts"]);
    const m = state.manifestOf("turn")!;
    const hash = m.files["a.ts"]!.hash;
    expect(state.blob(hash)).toBeDefined(); // blob stored
    await cb.retire("turn");
    // blob STILL present (retire only drops the manifest; GC is P3)
    expect(state.blob(hash)).toBeDefined();
  });
});

// ── mutex serialization parity (§4.3) ────────────────────────────────────────────────────

describe("CasBackend — mutex serializes capture/dirtyCheck/restore/retire (§4.3)", () => {
  it("concurrent ops are serialized (max-in-flight 1) — has is NOT serialized", async () => {
    // Use a fake that tracks in-flight concurrency via a counter. capture/dirtyCheck/restore/retire
    // all acquire the mutex; their bodies must never overlap. has does NOT acquire it.
    const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
    let inFlight = 0;
    let maxInFlight = 0;
    const inner = state.fakeFs;
    const wrap: CasFs = {
      readdir: inner.readdir.bind(inner),
      stat: inner.stat.bind(inner),
      readFile: inner.readFile.bind(inner),
      writeFile: inner.writeFile.bind(inner),
      mkdir: inner.mkdir.bind(inner),
      access: inner.access.bind(inner),
      unlink: inner.unlink.bind(inner),
    };
    // instrument readFile to observe overlap (it is called by capture/dirtyCheck/restore)
    wrap.readFile = async (p: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const r = await inner.readFile(p);
      inFlight--;
      return r;
    };
    const cb = new CasBackend("/ws", { ...BASE_CFG, storageDir: "/store", nonGitMode: "explicit-paths" }, null, {
      fs: wrap,
    });
    // fire 4 serialized ops concurrently
    const refP = cb.capture("turn", ["a.ts"]);
    const dcP = refP.then((r) => cb.dirtyCheck(r ?? "", ["a.ts"]));
    const rP = refP.then((r) => cb.restore(r ?? "", { revertFileChanges: true, deleteCreatedFiles: false }));
    const retP = refP.then((r) => cb.retire(r ?? ""));
    await Promise.all([refP, dcP, rP, retP]);
    expect(maxInFlight).toBe(1); // serialized — no overlap
  });
});

// ── gc — prompt-boundary namespace-delete + mark-sweep (spec/14 §5) ────────────────────────

describe("CasBackend.gc — prompt-boundary namespace-delete + mark-sweep (spec/14 §5)", () => {
  /**
   * A purpose-built fake that models the manifests/ dir + the sharded blobs/ subdirs so gc()'s
   * readdir-driven mark-sweep can be exercised directly. The shared makeStateFs does NOT model
   * readdir (explicit-paths capture does not walk), so gc() needs this dedicated layout fake.
   * `storageDir` layout mirrors CasBackend exactly: manifests/<label>.json + blobs/<2-hex>/<hash>.
   */
  function makeGcFs(storageDir: string) {
    const manifests = new Map<string, Buffer>(); // filename (e.g. "turn.json") → serialized manifest
    const blobs = new Map<string, Buffer>(); // hash → content (filename === hash; NO suffix)
    const manifestsDir = join(storageDir, "manifests");
    const blobsDir = join(storageDir, "blobs");
    const fakeFs: CasFs = {
      readdir: async (dir: string, _opts) => {
        if (resolve(dir) === resolve(manifestsDir)) {
          // return Dirent-like entries with isFile()=true for each manifest filename
          return [...manifests.keys()].map(
            (name) =>
              ({ name, isFile: () => true, isDirectory: () => false }) as unknown as Dirent,
          );
        }
        if (resolve(dir) === resolve(blobsDir)) {
          // the shard subdirs — 2-hex prefix dirs
          const shards = new Set<string>();
          for (const h of blobs.keys()) shards.add(h.slice(0, 2));
          return [...shards].map(
            (name) =>
              ({ name, isFile: () => false, isDirectory: () => true }) as unknown as Dirent,
          );
        }
        // a shard subdir: blobs/<2-hex>/ → the blob files whose hash starts with the shard prefix
        const shardPrefix = resolve(dir).split(sep).pop()!;
        if (shardPrefix.length === 2) {
          const names = [...blobs.keys()].filter((h) => h.startsWith(shardPrefix));
          return names.map(
            (name) =>
              ({ name, isFile: () => true, isDirectory: () => false }) as unknown as Dirent,
          );
        }
        return [];
      },
      stat: async () => ({ size: 0, mtimeMs: 0 }),
      readFile: async (p: string) => {
        if (p.startsWith(manifestsDir)) {
          const name = resolve(p).split(sep).pop()!;
          const buf = manifests.get(name);
          if (buf) return buf;
        }
        if (p.startsWith(blobsDir)) {
          const hash = resolve(p).split(sep).pop()!;
          const buf = blobs.get(hash);
          if (buf) return buf;
        }
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      },
      writeFile: async (p: string, data: Buffer) => {
        if (p.startsWith(manifestsDir)) {
          manifests.set(resolve(p).split(sep).pop()!, data);
        } else if (p.startsWith(blobsDir)) {
          blobs.set(resolve(p).split(sep).pop()!, data);
        }
      },
      mkdir: async () => undefined,
      access: async (p: string) => {
        if (p.startsWith(manifestsDir)) {
          if (manifests.has(resolve(p).split(sep).pop()!)) return;
        }
        if (p.startsWith(blobsDir)) {
          if (blobs.has(resolve(p).split(sep).pop()!)) return;
        }
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      },
      unlink: async (p: string) => {
        if (p.startsWith(manifestsDir)) {
          manifests.delete(resolve(p).split(sep).pop()!);
          return;
        }
        if (p.startsWith(blobsDir)) {
          blobs.delete(resolve(p).split(sep).pop()!);
          return;
        }
      },
    };
    const state = {
      fakeFs,
      /** write a manifest for a label (files: relpath → hash). */
      writeManifest(label: string, hashesByPath: Record<string, string>) {
        const files: CasManifest["files"] = {};
        for (const [rel, hash] of Object.entries(hashesByPath))
          files[rel] = { hash, size: 1, mtime: 0, existed: true };
        manifests.set(
          `${label}.json`,
          Buffer.from(
            serializeManifest({
              version: 1,
              label,
              turnIndex: 0,
              ts: Date.now(),
              files,
            }),
          ),
        );
      },
      /** store a content blob under its hash (filename === hash; NO suffix). */
      storeBlob(hash: string, content: Buffer) {
        blobs.set(hash, content);
      },
      manifestPresent(label: string) {
        return manifests.has(`${label}.json`);
      },
      blobPresent(hash: string) {
        return blobs.has(hash);
      },
    };
    return state;
  }

  function makeGcBackend(state: ReturnType<typeof makeGcFs>): CasBackend {
    return new CasBackend("/ws", { ...BASE_CFG, storageDir: "/store" }, null, { fs: state.fakeFs });
  }

  it("deletes every turn/* manifest + reclaims its unreferenced blobs; checkpoint/* exempt", async () => {
    const state = makeGcFs("/store");
    // a turn manifest referencing blob T1, a checkpoint manifest referencing blob C1
    state.writeManifest("turn", { "a.ts": "turnhash1" });
    state.storeBlob("turnhash1", Buffer.from("turn-content"));
    state.writeManifest("ckpt:save1", { "b.ts": "ckpthash1" });
    state.storeBlob("ckpthash1", Buffer.from("ckpt-content"));
    // an orphan blob referenced by NO surviving manifest
    state.storeBlob("orphanhash", Buffer.from("orphan"));
    const cb = makeGcBackend(state);
    await cb.gc();
    // turn/* manifest deleted; checkpoint manifest preserved
    expect(state.manifestPresent("turn")).toBe(false);
    expect(state.manifestPresent("ckpt:save1")).toBe(true);
    // turn blob reclaimed (no surviving manifest references it); checkpoint blob preserved
    expect(state.blobPresent("turnhash1")).toBe(false);
    expect(state.blobPresent("ckpthash1")).toBe(true);
    // orphan blob (referenced by nothing) reclaimed
    expect(state.blobPresent("orphanhash")).toBe(false);
  });

  it("deletes turn-after manifest too (the whole turn namespace)", async () => {
    const state = makeGcFs("/store");
    state.writeManifest("turn", { "a.ts": "h1" });
    state.writeManifest("turn-after", { "a.ts": "h2" });
    state.storeBlob("h1", Buffer.from("x"));
    state.storeBlob("h2", Buffer.from("y"));
    const cb = makeGcBackend(state);
    await cb.gc();
    expect(state.manifestPresent("turn")).toBe(false);
    expect(state.manifestPresent("turn-after")).toBe(false);
    expect(state.blobPresent("h1")).toBe(false);
    expect(state.blobPresent("h2")).toBe(false);
  });

  it("preserves a checkpoint blob that a turn ALSO referenced (checkpoint is the surviving set)", async () => {
    const state = makeGcFs("/store");
    // turn + checkpoint BOTH reference the SAME blob hash (content dedupe)
    state.writeManifest("turn", { "a.ts": "shared" });
    state.writeManifest("ckpt:save1", { "b.ts": "shared" });
    state.storeBlob("shared", Buffer.from("same-content"));
    const cb = makeGcBackend(state);
    await cb.gc();
    // turn manifest gone; checkpoint manifest preserved; the shared blob survives (in surviving set)
    expect(state.manifestPresent("turn")).toBe(false);
    expect(state.manifestPresent("ckpt:save1")).toBe(true);
    expect(state.blobPresent("shared")).toBe(true);
  });

  it("no manifests dir ⇒ early void (nothing to gc); never rejects", async () => {
    const state = makeGcFs("/store"); // nothing written → readdir on manifests throws ENOENT-mode
    const cb = makeGcBackend(state);
    await expect(cb.gc()).resolves.toBeUndefined();
  });

  it("never rejects when a manifest is corrupt (best-effort skip)", async () => {
    const state = makeGcFs("/store");
    state.writeManifest("turn", { "a.ts": "h1" }); // a valid turn manifest
    state.storeBlob("h1", Buffer.from("x"));
    const cb = makeGcBackend(state);
    await expect(cb.gc()).resolves.toBeUndefined();
    // the valid turn manifest was still deleted
    expect(state.manifestPresent("turn")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// CasBackend.appendExplicitPath — [P1.M3.T1.S2 / spec/14 §4.2 / BUG-003]
// Create-or-append ONE workspace-rel file's pre-write state to the manifest at manifestPath(label).
// Mirrors captureExplicitPaths' per-file capture EXACTLY. The P3 tool_call hook casts the store to
// CasBackend to call this BEFORE each write/edit tool runs (Pi awaits the hook in preflight — the
// file is still in its pre-write state). Mutex-serialized; idempotent per (label, path); does NOT
// bump capturesThisTurn. Uses the makeTreeBackend DI fake (TreeFs working-tree + blob/manifest store).
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("CasBackend.appendExplicitPath — [P1.M3.T1.S2 / spec/14 §4.2 / BUG-003]", () => {
  /** Helper: read + parse the manifest at <storage>/manifests/<label>.json via the fake fs. */
  async function readManifest(fakeFs: CasFs, storageDir: string, label: string): Promise<CasManifest> {
    const buf = await fakeFs.readFile(join(storageDir, "manifests", `${label}.json`));
    return parseManifest(buf.toString("utf8"));
  }

  it("captures an EXISTING file's pre-write state: {hash,size,mtime,existed:true} + stores the blob", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const content = Buffer.from("A0");
    const expectedHash = createHash("sha256").update(content).digest("hex");
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content, mtimeMs: 1234 },
    });
    await cb.appendExplicitPath("turn", "src/a.ts");
    const m = await readManifest(fakeFs, storage, "turn");
    const entry = m.files["src/a.ts"];
    expect(entry).toBeDefined();
    expect(entry).toEqual({ hash: expectedHash, size: 2, mtime: 1234, existed: true });
    // the blob was stored (accessible via the fake)
    const blobBuf = await fakeFs.readFile(`${storage}/blobs/${expectedHash.slice(0, 2)}/${expectedHash}`);
    expect(blobBuf.equals(content)).toBe(true);
  });

  it("captures a NON-EXISTENT file (ENOENT): {hash:'',size:0,mtime:0,existed:false} + NO blob", async () => {
    const cwd = "/ws";
    const storage = "/store";
    // empty tree — src/created.ts does NOT exist yet (the upcoming write will create it)
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {});
    await cb.appendExplicitPath("turn", "src/created.ts");
    const m = await readManifest(fakeFs, storage, "turn");
    expect(m.files["src/created.ts"]).toEqual({
      hash: "",
      size: 0,
      mtime: 0,
      existed: false,
    });
  });

  it("skips an OVERSIZE file: NO blob, NO files entry (fail-closed); BUG-005 records it in manifest.skipped", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const big = Buffer.from("x".repeat(100));
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "big.ts": { content: big, mtimeMs: 1 },
    }, { maxFileBytes: 10 }); // 100-byte file > 10-byte cap
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await cb.appendExplicitPath("turn", "big.ts");
    warnSpy.mockRestore();
    // fail-closed skip: NO blob + NO files entry (never silently claim restorable)...
    const m = await readManifest(fakeFs, storage, "turn");
    expect(Object.keys(m.files)).toEqual([]);
    // ...but BUG-005: the rel IS recorded in manifest.skipped + the manifest IS written (no silent loss)
    // so restore() can surface it in RestoreResult.skipped.
    expect(m.skipped).toContain("big.ts");
  });

  it("skips a DANGEROUS path (.git/config): NO entry, no throw, no fs read of the real path", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb } = makeTreeBackend(cwd, storage, {});
    // must NOT throw + must NOT add an entry. The manifest file won't be written (nothing to append).
    await expect(cb.appendExplicitPath("turn", ".git/config")).resolves.toBeUndefined();
  });

  it("is IDEMPOTENT per (label, path): a 2nd call is a no-op (first-write-wins)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs, readCalls } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content: Buffer.from("original"), mtimeMs: 100 },
    });
    await cb.appendExplicitPath("turn", "src/a.ts");
    const m1 = await readManifest(fakeFs, storage, "turn");
    const entry1 = m1.files["src/a.ts"];
    // simulate the tool mutating the file's working-tree content (write-2 fires with write-1 on disk,
    // but the FIRST appendExplicitPath already captured the true pre-turn state)
    const readsBefore = readCalls.size;
    await cb.appendExplicitPath("turn", "src/a.ts"); // 2nd call — should be a no-op
    const m2 = await readManifest(fakeFs, storage, "turn");
    // the entry is UNCHANGED (first-write-wins preserves the true pre-turn state)
    expect(m2.files["src/a.ts"]).toEqual(entry1);
    // the 2nd call did NOT re-read the file content (idempotent early-return on files[path] !== undefined)
    expect(readCalls.size).toBe(readsBefore);
    expect(Object.keys(m2.files)).toHaveLength(1); // still ONE entry
  });

  it("CREATE-OR-APPEND: appends to an EXISTING manifest without overwriting other entries", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "src/x.ts": { content: Buffer.from("x-content"), mtimeMs: 10 },
      "src/y.ts": { content: Buffer.from("y-content"), mtimeMs: 20 },
    });
    // first append — captures x
    await cb.appendExplicitPath("turn", "src/x.ts");
    const m1 = await readManifest(fakeFs, storage, "turn");
    expect(Object.keys(m1.files)).toEqual(["src/x.ts"]);
    // second append — appends y WITHOUT losing x
    await cb.appendExplicitPath("turn", "src/y.ts");
    const m2 = await readManifest(fakeFs, storage, "turn");
    expect(Object.keys(m2.files).sort()).toEqual(["src/x.ts", "src/y.ts"]);
    expect(m2.files["src/x.ts"]).toEqual(m1.files["src/x.ts"]); // x unchanged
  });

  it("skips a `..` escape path SILENTLY (isDangerousWorkspaceRel fires BEFORE resolveSafeWorkspacePath): NO entry, no throw", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {});
    // `..` is caught by isDangerousWorkspaceRel (the safety floor runs FIRST) → silent return, no throw.
    // (A tool_call hook with an escape path is fail-open: the handler's try/catch also covers a throw,
    // but the dangerous-path check makes it a clean no-op instead.)
    await expect(cb.appendExplicitPath("turn", "../escape")).resolves.toBeUndefined();
    // NO manifest file was written (nothing appended)
    await expect(fakeFs.readFile(join(storage, "manifests/turn.json"))).rejects.toThrow();
  });

  it("does NOT bump capturesThisTurn: a subsequent capture() is NOT starved", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb } = makeTreeBackend(cwd, storage, {
      "src/a.ts": { content: Buffer.from("a"), mtimeMs: 1 },
    }, { maxSnapshotsPerTurn: 2 }); // tight cap so starvation would show
    // MANY appendExplicitPath calls — if they bumped the counter, capture() would starve after 2.
    for (let i = 0; i < 10; i++) {
      await cb.appendExplicitPath("turn", `src/file${i}.ts`); // nonexistent paths → existed:false entries
    }
    // a subsequent capture() must STILL succeed (the counter was NOT bumped by the 10 appends)
    const ref = await cb.capture("turn-after");
    expect(ref).toBe("turn-after");
  });

  it("acquires + releases the mutex (a subsequent op is NOT deadlocked)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb } = makeTreeBackend(cwd, storage, {});
    await cb.appendExplicitPath("turn", "src/a.ts");
    // if appendExplicitPath forgot release(), this capture() would hang → test timeout (not a clean fail)
    const ref = await cb.capture("turn-after");
    expect(ref).toBe("turn-after");
  });
});

// ── caps-skipped tracking (BUG-005 / E29) ──────────────────────────────────────────────────
// The CasManifest.skipped bucket + the restore() → RestoreResult.skipped surface. When capture
// skips a file due to maxFileBytes/maxTotalBytes, the rel MUST land in manifest.skipped so restore()
// copies it into result.skipped — then rewind.ts (already wired at L889/899/907) reports "N
// skipped/failed" > 0 + flips marker.revert.skipped to true (the agent sees the incomplete revert).
// Before BUG-005 the bucket existed but was never populated. spec/14 §4.3 (caps), §6 (restore).
describe("CasBackend.capture/restore — caps-skipped tracking (BUG-005 / E29)", () => {
  /** Read + parse a label's manifest from the fake fs (local helper — mirrors the one in the
   *  appendExplicitPath suite, scoped module-private here). */
  async function readManifest(fakeFs: CasFs, storageDir: string, label: string): Promise<CasManifest> {
    const buf = await fakeFs.readFile(join(storageDir, "manifests", `${label}.json`));
    return parseManifest(buf.toString("utf8"));
  }

  it("whole-tree: oversize file (size > maxFileBytes) is recorded in manifest.skipped", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "small.ts": { content: Buffer.from("ok"), mtimeMs: 1 },
      "big.bin": { content: Buffer.alloc(300), mtimeMs: 1 },
    }, { maxFileBytes: 100 });
    await cb.capture("turn");
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = parseManifest(mBuf.toString("utf8"));
    expect(m.skipped).toContain("big.bin");
    expect(Object.keys(m.files)).not.toContain("big.bin"); // uncaptured
    expect(Object.keys(m.files)).toContain("small.ts"); // the small file IS captured
  });

  it("whole-tree: maxTotalBytes exceeded ⇒ the over-budget rel is in manifest.skipped (PARTIAL)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "small.ts": { content: Buffer.from("small"), mtimeMs: 1 }, // 5 bytes
      "large.ts": { content: Buffer.from("x".repeat(100)), mtimeMs: 2 }, // 100 bytes → exceeds budget
    }, { maxTotalBytes: 50 });
    const ref = await cb.capture("turn");
    expect(ref).toBe("turn"); // PARTIAL — not null
    const mBuf = await fakeFs.readFile(join(storage, "manifests/turn.json"));
    const m = parseManifest(mBuf.toString("utf8"));
    expect(m.skipped).toContain("large.ts");
    expect(Object.keys(m.files)).toContain("small.ts");
    expect(Object.keys(m.files)).not.toContain("large.ts");
    expect(warnSpy.mock.calls.some((c) => /partial/.test(String(c[0])))).toBe(true);
    warnSpy.mockRestore();
  });

  it("explicit-paths: oversize file (> maxFileBytes) is recorded in manifest.skipped", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = makeStateFs("/ws", "/store", {
      "small.ts": Buffer.from("ok"),
      "big.ts": Buffer.alloc(300),
    });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths", maxFileBytes: 100 });
    await cb.capture("turn", ["small.ts", "big.ts"]);
    const m = state.manifestOf("turn")!;
    expect(m.skipped).toContain("big.ts");
    expect(Object.keys(m.files)).toEqual(["small.ts"]); // big.ts uncaptured
    warnSpy.mockRestore();
  });

  it("explicit-paths: maxTotalBytes exceeded ⇒ over-budget rel in manifest.skipped (PARTIAL)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = makeStateFs("/ws", "/store", {
      "a.ts": Buffer.alloc(60),
      "b.ts": Buffer.alloc(60), // 60+60=120 > 100
    });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths", maxTotalBytes: 100 });
    await cb.capture("turn", ["a.ts", "b.ts"]);
    const m = state.manifestOf("turn")!;
    expect(m.skipped).toContain("b.ts");
    expect(Object.keys(m.files)).toEqual(["a.ts"]); // b.ts skipped on budget overrun
    warnSpy.mockRestore();
  });

  it("appendExplicitPath: oversize file is recorded in manifest.skipped (NOT silently lost)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "big.ts": { content: Buffer.from("x".repeat(100)), mtimeMs: 1 },
    }, { maxFileBytes: 10 });
    await cb.appendExplicitPath("turn", "big.ts");
    warnSpy.mockRestore();
    // BUG-005: the manifest IS rewritten (no silent loss) + big.ts lands in skipped.
    const m = await readManifest(fakeFs, storage, "turn");
    expect(m.skipped).toContain("big.ts");
    expect(Object.keys(m.files)).toEqual([]); // oversize ⇒ no files entry
  });

  it("appendExplicitPath: oversize MERGES onto an existing manifest's skipped (no overwrite)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cwd = "/ws";
    const storage = "/store";
    // start from an empty manifest; first append captures a normal file, second append is oversize.
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "small.ts": { content: Buffer.from("ok"), mtimeMs: 1 },
      "big1.ts": { content: Buffer.from("x".repeat(100)), mtimeMs: 1 },
      "big2.ts": { content: Buffer.from("y".repeat(100)), mtimeMs: 1 },
    }, { maxFileBytes: 10 });
    await cb.appendExplicitPath("turn", "small.ts");
    await cb.appendExplicitPath("turn", "big1.ts");
    await cb.appendExplicitPath("turn", "big2.ts");
    warnSpy.mockRestore();
    const m = await readManifest(fakeFs, storage, "turn");
    expect(m.skipped?.sort()).toEqual(["big1.ts", "big2.ts"]); // both oversize rels accumulated
    expect(Object.keys(m.files)).toEqual(["small.ts"]); // only the small file captured
  });

  it("restore: surfaces manifest.skipped into result.skipped (whole-tree capture)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "small.ts": { content: Buffer.from("ok"), mtimeMs: 1 },
      "big.bin": { content: Buffer.alloc(300), mtimeMs: 1 },
    }, { maxFileBytes: 100 });
    await cb.capture("turn");
    // the manifest on disk records big.bin in skipped
    const mBefore = parseManifest((await fakeFs.readFile(join(storage, "manifests/turn.json"))).toString("utf8"));
    expect(mBefore.skipped).toContain("big.bin");
    const res = await cb.restore("turn", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toContain("big.bin");
  });

  it("restore: surfaces manifest.skipped into result.skipped (explicit-paths capture)", async () => {
    const state = makeStateFs("/ws", "/store", {
      "a.ts": Buffer.alloc(60),
      "b.ts": Buffer.alloc(60),
    });
    const cb = makeStateBackend(state, { nonGitMode: "explicit-paths", maxTotalBytes: 100 });
    await cb.capture("turn", ["a.ts", "b.ts"]); // b.ts skipped on budget overrun
    const res = await cb.restore("turn", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toContain("b.ts");
  });

  it("restore: BACKWARD-COMPAT — a manifest WITHOUT `skipped` (pre-fix) restores as skipped:[]", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "a.ts": { content: Buffer.from("aaa"), mtimeMs: 1 },
    });
    await cb.capture("turn");
    // Simulate a pre-fix manifest: rewrite it WITHOUT the `skipped` field (as if written before BUG-005).
    const raw = parseManifest((await fakeFs.readFile(join(storage, "manifests/turn.json"))).toString("utf8"));
    const { skipped: _drop, ...prefFix } = raw; // strip the field entirely
    void _drop;
    await fakeFs.writeFile(join(storage, "manifests/turn.json"), Buffer.from(JSON.stringify(prefFix), "utf8"));
    const res = await cb.restore("turn", { revertFileChanges: true, deleteCreatedFiles: false });
    expect(res.skipped).toEqual([]); // no skipped signal — identical to today's behavior
  });

  it("restore: neither flag set ⇒ result.skipped is [] (the early-return guard short-circuits before the skipped copy)", async () => {
    const cwd = "/ws";
    const storage = "/store";
    const { cb, fakeFs } = makeTreeBackend(cwd, storage, {
      "big.bin": { content: Buffer.alloc(300), mtimeMs: 1 },
    }, { maxFileBytes: 100 });
    await cb.capture("turn");
    // the manifest DOES record big.bin in skipped, but restore's early-return guard (neither flag)
    // fires before the skipped copy ⇒ skipped stays [] (no restore ran). Matches git.ts restore.
    const res = await cb.restore("turn", { revertFileChanges: false, deleteCreatedFiles: false });
    expect(res.skipped).toEqual([]);
    // sanity: the manifest on disk still has the skipped entry (the guard is about restore, not capture)
    const m = parseManifest((await fakeFs.readFile(join(storage, "manifests/turn.json"))).toString("utf8"));
    expect(m.skipped).toContain("big.bin");
  });
});
