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

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
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

// ── S2/S3 stubs throw (scope guard) ────────────────────────────────────────────────────────
describe("CasBackend — S2/S3 stubs throw (spec/14 §4 — skeleton scope)", () => {
  it("capture throws 'see P2.M3.T1.S2'", async () => {
    const cb = makeBackend();
    await expect(cb.capture("turn")).rejects.toThrow(/P2\.M3\.T1\.S2/);
  });

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