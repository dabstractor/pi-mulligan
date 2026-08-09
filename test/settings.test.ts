/**
 * settings.test.ts — unit tests for the leaf settings-loading helpers (src/settings.ts).
 *
 * Mirrors two test idioms from the suite:
 *   - REAL temp files (mkdtempSync/rmSync/writeFileSync) for readSettingsFile — same pattern as
 *     test/nudges.test.ts (exercises the genuine readFileSync path; NO vi.mock of node:fs).
 *   - pure-data assertions (toEqual deep comparisons) for deepMergeSettings — same pattern as
 *     test/config.test.ts.
 *
 * Imports use the project's `.js` ESM/Bundler extension convention (../src/settings.js).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettingsFile, deepMergeSettings, loadMulliganConfig } from "../src/settings.js";

// getAgentDir is the ONLY symbol settings.ts imports from the Pi package. Mock it so the
// loadMulliganConfig tests run against temp dirs (not the real ~/.pi/agent) AND so case (g) can make it
// throw. vi.mock is hoisted above module-scope `let`/`const`, so the factory closes over vi.hoisted()
// mutable state (a plain `let` would be undefined at call time). File-scoped: does not leak to other
// test files and does not perturb S1's readSettingsFile/deepMergeSettings tests above (they never call
// getAgentDir). The minimal factory `{ getAgentDir }` is sufficient (settings.ts imports nothing else).
const mockAgent = vi.hoisted(() => ({
  agentDir: "/nonexistent-mulligan-agent",
  impl: null as null | (() => string),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => {
    if (mockAgent.impl) return mockAgent.impl();
    return mockAgent.agentDir;
  },
}));

// ── readSettingsFile — real temp-file setup (mirror test/nudges.test.ts) ─────

describe("readSettingsFile — fail-open JSON parsing", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mulligan-settings-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing file → {}", () => {
    expect(readSettingsFile(join(dir, "nope.json"))).toEqual({});
  });

  it("invalid JSON → {}", () => {
    writeFileSync(join(dir, "bad.json"), "{not json");
    expect(readSettingsFile(join(dir, "bad.json"))).toEqual({});
  });

  it("valid JSON object → parsed", () => {
    writeFileSync(join(dir, "ok.json"), '{"mulligan":{"enabled":false}}');
    expect(readSettingsFile(join(dir, "ok.json"))).toEqual({ mulligan: { enabled: false } });
  });

  it("JSON array → {}", () => {
    writeFileSync(join(dir, "arr.json"), "[1,2,3]");
    expect(readSettingsFile(join(dir, "arr.json"))).toEqual({});
  });

  it("JSON primitive (number) → {}", () => {
    writeFileSync(join(dir, "num.json"), "42");
    expect(readSettingsFile(join(dir, "num.json"))).toEqual({});
  });

  it("JSON null → {}", () => {
    writeFileSync(join(dir, "null.json"), "null");
    expect(readSettingsFile(join(dir, "null.json"))).toEqual({});
  });

  it("nested object is preserved round-trip", () => {
    writeFileSync(join(dir, "nested.json"), '{"a":{"b":{"c":1}}}');
    expect(readSettingsFile(join(dir, "nested.json"))).toEqual({ a: { b: { c: 1 } } });
  });
});

// ── deepMergeSettings — pure-data merge semantics (Pi deepMergeObjects parity) ─

describe("deepMergeSettings — project wins, Pi deepMergeObjects semantics", () => {
  it("empty + empty → {}", () => {
    expect(deepMergeSettings({}, {})).toEqual({});
  });

  it("non-overlapping keys preserved from both", () => {
    expect(deepMergeSettings({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("project primitive replaces global primitive", () => {
    expect(deepMergeSettings({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it("nested objects RECURSE (not replace)", () => {
    // THE key recursion test: global's x preserved, project's y replaces, project's z added.
    expect(deepMergeSettings({ n: { x: 1, y: 2 } }, { n: { y: 3, z: 4 } })).toEqual({
      n: { x: 1, y: 3, z: 4 },
    });
  });

  it("arrays REPLACE (not concatenated)", () => {
    expect(deepMergeSettings({ r: [1, 2] }, { r: [3] })).toEqual({ r: [3] });
  });

  it("project null replaces global object", () => {
    // null is not isRecord (typeof 'object' but null excluded) → replace branch → null wins.
    expect(deepMergeSettings({ a: { x: 1 } }, { a: null })).toEqual({ a: null });
  });

  it("global-only nested key preserved when project adds a sibling", () => {
    expect(deepMergeSettings({ n: { a: 1 } }, { n: { b: 2 } })).toEqual({ n: { a: 1, b: 2 } });
  });

  it("deeply nested 3-level recurse", () => {
    expect(
      deepMergeSettings({ l1: { l2: { a: 1 } } }, { l1: { l2: { b: 2 } } }),
    ).toEqual({ l1: { l2: { a: 1, b: 2 } } });
  });

  it("does not mutate inputs", () => {
    const global = { n: { x: 1 } };
    const project = { n: { y: 2 } };
    deepMergeSettings(global, project);
    expect(global).toEqual({ n: { x: 1 } });
    expect(project).toEqual({ n: { y: 2 } });
  });
});

// ── loadMulliganConfig — global+project merge, fail-open (owns its own temp dirs) ──

describe("loadMulliganConfig — global+project merge, fail-open", () => {
  let agentDir: string;
  let projectDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "mulligan-agent-"));
    projectDir = mkdtempSync(join(tmpdir(), "mulligan-project-"));
    mockAgent.impl = null; // default: getAgentDir() returns mockAgent.agentDir
    mockAgent.agentDir = agentDir;
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  // helpers: write the (mocked) global + project-local settings files
  function writeGlobal(json: string) {
    writeFileSync(join(agentDir, "settings.json"), json);
  }
  function writeProject(json: string) {
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(join(projectDir, ".pi", "settings.json"), json);
  }

  it("no mulligan key → undefined", () => {
    writeGlobal('{"foo":1}');
    writeProject('{"bar":2}');
    expect(loadMulliganConfig(projectDir)).toBeUndefined();
  });

  it("global-only mulligan → returns global mulligan", () => {
    writeGlobal('{"mulligan":{"enabled":false}}'); // no project file
    expect(loadMulliganConfig(projectDir)).toEqual({ enabled: false });
  });

  it("project-only mulligan → returns project mulligan", () => {
    writeProject('{"mulligan":{"enabled":true}}'); // no global file
    expect(loadMulliganConfig(projectDir)).toEqual({ enabled: true });
  });

  it("both → merged (project wins on nested)", () => {
    // THE key deep-merge-of-mulligan test: global enabled:true preserved; nested nudges merged with
    // project bloatReminder:true winning and global perTurnDrift:true preserved. Proves deepMergeSettings
    // recursed INTO the mulligan block (loadMulliganConfig did NOT re-merge).
    writeGlobal('{"mulligan":{"enabled":true,"nudges":{"bloatReminder":false,"perTurnDrift":true}}}');
    writeProject('{"mulligan":{"nudges":{"bloatReminder":true}}}');
    expect(loadMulliganConfig(projectDir)).toEqual({
      enabled: true,
      nudges: { bloatReminder: true, perTurnDrift: true },
    });
  });

  it("missing files → undefined", () => {
    // neither file written → both readSettingsFile fail-open to {} → merged {} → no mulligan key
    expect(loadMulliganConfig(projectDir)).toBeUndefined();
  });

  it("invalid JSON → undefined", () => {
    writeGlobal("{not json"); // readSettingsFile fail-opens to {}; project absent → merged {} → no mulligan
    expect(loadMulliganConfig(projectDir)).toBeUndefined();
  });

  it("getAgentDir throws → undefined (fail-open)", () => {
    mockAgent.impl = () => {
      throw new Error("boom");
    };
    expect(loadMulliganConfig(projectDir)).toBeUndefined();
  });
});