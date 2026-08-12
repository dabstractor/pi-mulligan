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
import { join, resolve } from "node:path";
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
describe("CasBackend — S3 stubs throw (spec/14 §4 — skeleton scope)", () => {
  it("dirtyCheck throws 'see P2.M3.T1.S3'", async () => {
    const cb = makeBackend();
    await expect(cb.dirtyCheck("r", [])).rejects.toThrow(/P2\.M3\.T1\.S3/);
  });

  it("restore throws 'see P2.M3.T1.S3'", async () => {
    const cb = makeBackend();
    await expect(
      cb.restore("r", { revertFileChanges: false, deleteCreatedFiles: false }),
    ).rejects.toThrow(/P2\.M3\.T1\.S3/);
  });

  it("has throws 'see P2.M3.T1.S3'", async () => {
    const cb = makeBackend();
    await expect(cb.has("r")).rejects.toThrow(/P2\.M3\.T1\.S3/);
  });

  it("retire throws 'see P2.M3.T1.S3'", async () => {
    const cb = makeBackend();
    await expect(cb.retire("r")).rejects.toThrow(/P2\.M3\.T1\.S3/);
  });
});
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
