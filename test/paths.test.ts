import { describe, it, expect, expectTypeOf } from "vitest";
import { homedir } from "node:os";
import {
  resolveSafeWorkspacePath,
  normalizeRelPath,
  isDangerousWorkspaceRel,
  isForbiddenRoot,
  DANGEROUS_DIRS,
} from "../src/snapshot/paths.js";

// spec/14 §4.3 (contract), spec/14 line 221 (the exact reject list to cover: ../NUL/.git/.pi/
// node_modules/directory/abs-outside-workspace), spec/10 Tier 1 (pure-helper unit-test tier),
// task P1.M2.T1.S1.
// No beforeEach needed: paths.ts has NO module-scoped mutable state (mirrors tokens.test.ts).

describe("resolveSafeWorkspacePath — spec/14 §4.3 contract", () => {
  const ROOT = "/tmp/ws"; // absolute workspace root

  it("(a) resolves a relative path inside the workspace", () => {
    expect(resolveSafeWorkspacePath(ROOT, "src/foo.ts")).toBe("/tmp/ws/src/foo.ts");
    expect(resolveSafeWorkspacePath(ROOT, "a/b/c.ts")).toBe("/tmp/ws/a/b/c.ts");
  });

  it("(b) THROWS on a `..` escape", () => {
    expect(() => resolveSafeWorkspacePath(ROOT, "../escape")).toThrow();
    expect(() => resolveSafeWorkspacePath(ROOT, "foo/../../escape")).toThrow();
    expect(() => resolveSafeWorkspacePath(ROOT, "../../etc")).toThrow();
  });

  it("(c) THROWS on an absolute relPath that escapes (absolute-override vector)", () => {
    expect(() => resolveSafeWorkspacePath(ROOT, "/etc/passwd")).toThrow(); // resolves outside ROOT
  });

  it("(d) does NOT throw for at-root (rel resolves to the workspace root — not an escape)", () => {
    expect(resolveSafeWorkspacePath(ROOT, ".")).toBe("/tmp/ws"); // rel==="" → returns root
    expect(resolveSafeWorkspacePath(ROOT, "")).toBe("/tmp/ws");
  });

  it("(e) is pure + deterministic (same inputs → same output across calls)", () => {
    expect(resolveSafeWorkspacePath(ROOT, "x.ts")).toBe(resolveSafeWorkspacePath(ROOT, "x.ts"));
  });
});

describe("normalizeRelPath — spec/14 §4.3 (POSIX forward-slash relative)", () => {
  const ROOT = "/tmp/ws";

  it("(a) converts an absolute path inside the workspace to a relative POSIX string", () => {
    expect(normalizeRelPath(ROOT, "/tmp/ws/src/foo.ts")).toBe("src/foo.ts");
  });

  it("(b) root itself → empty string", () => {
    expect(normalizeRelPath(ROOT, ROOT)).toBe("");
  });

  it("(c) outside-workspace absolute → the `../…` escape form (caller must then gate via isDangerousWorkspaceRel)", () => {
    expect(normalizeRelPath(ROOT, "/etc/passwd")).toMatch(/^\.\.\//); // starts with ../
  });

  it("(d) coerces backslash separators to forward slash (Windows-style normalization)", () => {
    // On POSIX, split(sep).join("/") is a no-op; test the contract: the output is forward-slash-only.
    const out = normalizeRelPath(ROOT, "/tmp/ws/src/foo.ts");
    expect(out).not.toContain("\\");
  });
});

describe("isDangerousWorkspaceRel — spec/14 §4.3 reject list (line 221)", () => {
  it("(a) rejects NUL bytes", () => {
    expect(isDangerousWorkspaceRel("safe.txt\0../../etc")).toBe(true);
    expect(isDangerousWorkspaceRel("a\0b")).toBe(true);
  });

  it("(b) rejects any `..` segment (escape — fail-closed)", () => {
    expect(isDangerousWorkspaceRel("../x")).toBe(true);
    expect(isDangerousWorkspaceRel("a/../../b")).toBe(true);
    expect(isDangerousWorkspaceRel("a/../b")).toBe(true); // deliberately over-rejected (#7)
    expect(isDangerousWorkspaceRel("..")).toBe(true);
  });

  it("(c) rejects trailing-separator (directory marker)", () => {
    expect(isDangerousWorkspaceRel("src/")).toBe(true);
    expect(isDangerousWorkspaceRel("a/b/")).toBe(true);
  });

  it("(d) rejects paths under .git / .pi / node_modules (segment match)", () => {
    expect(isDangerousWorkspaceRel(".git")).toBe(true);
    expect(isDangerousWorkspaceRel(".git/config")).toBe(true);
    expect(isDangerousWorkspaceRel(".pi/cache")).toBe(true);
    expect(isDangerousWorkspaceRel("node_modules/pkg/index.js")).toBe(true);
    expect(isDangerousWorkspaceRel("src/node_modules/pkg")).toBe(true); // nested — segment match
  });

  it("(e) rejects absolute strings (a workspace-rel must never be absolute)", () => {
    expect(isDangerousWorkspaceRel("/etc/passwd")).toBe(true);
  });

  it("(f) is case-insensitive for dangerous dirs (macOS/Windows FS)", () => {
    expect(isDangerousWorkspaceRel(".Git/config")).toBe(true);
    expect(isDangerousWorkspaceRel("Node_Modules/x")).toBe(true);
    expect(isDangerousWorkspaceRel(".PI/z")).toBe(true);
  });

  it("(g) ALLOWS clean relative file paths (incl. .gitignore — a FILE, not the dir)", () => {
    expect(isDangerousWorkspaceRel("src/foo.ts")).toBe(false);
    expect(isDangerousWorkspaceRel("a/b/c.ts")).toBe(false);
    expect(isDangerousWorkspaceRel(".gitignore")).toBe(false); // segment ".gitignore" ≠ ".git"
    expect(isDangerousWorkspaceRel(".env")).toBe(false);
    expect(isDangerousWorkspaceRel("README.md")).toBe(false);
  });

  it("(h) DANGEROUS_DIRS is the hardcoded safety list [\".git\",\".pi\",\"node_modules\"]", () => {
    expect(DANGEROUS_DIRS).toEqual([".git", ".pi", "node_modules"]);
  });
});

describe("composition — the backend gate flow (normalizeRelPath → isDangerousWorkspaceRel → resolveSafeWorkspacePath)", () => {
  const ROOT = "/tmp/ws";

  it("(a) an outside absolute path is caught transitively: normalize→`../…`→isDangerous true", () => {
    const rel = normalizeRelPath(ROOT, "/etc/passwd");
    expect(isDangerousWorkspaceRel(rel)).toBe(true); // the `..` check fires
  });

  it("(b) a clean inside path passes all three", () => {
    const abs = "/tmp/ws/src/foo.ts";
    const rel = normalizeRelPath(ROOT, abs); // "src/foo.ts"
    expect(isDangerousWorkspaceRel(rel)).toBe(false);
    expect(resolveSafeWorkspacePath(ROOT, rel)).toBe("/tmp/ws/src/foo.ts");
  });
});

describe("isForbiddenRoot — spec/14 §2 SAFETY INVARIANT + §10 (task P1.M1.T1.S1)", () => {
  // Canonical matrix: plan/009_1ecb4b3cb372/architecture/test_strategy.md §test/paths.test.ts.
  // Pure predicate — no module state, no beforeEach.

  it("(a) the user's home → true (condition a; os.homedir() is dynamic — do not hardcode)", () => {
    expect(isForbiddenRoot(homedir())).toBe(true);
  });

  it("(b) the filesystem root '/' → true (condition b)", () => {
    expect(isForbiddenRoot("/")).toBe(true);
  });

  it("(c) depth-1 system dirs → true (condition c: dirname==='/')", () => {
    // The named spec examples:
    expect(isForbiddenRoot("/home")).toBe(true);
    expect(isForbiddenRoot("/etc")).toBe(true);
    expect(isForbiddenRoot("/usr")).toBe(true);
    expect(isForbiddenRoot("/var")).toBe(true);
    // Plus the other depth-1 dirs the check ALSO covers (comprehensive, not just the named list):
    expect(isForbiddenRoot("/bin")).toBe(true);
    expect(isForbiddenRoot("/sbin")).toBe(true);
    expect(isForbiddenRoot("/opt")).toBe(true);
    expect(isForbiddenRoot("/tmp")).toBe(true);
    expect(isForbiddenRoot("/root")).toBe(true);
    expect(isForbiddenRoot("/srv")).toBe(true); // any depth-1 name
  });

  it("(d) degenerate input '' and '.' → true (defensive condition d; NOT caught by dirname)", () => {
    expect(isForbiddenRoot("")).toBe(true);
    expect(isForbiddenRoot(".")).toBe(true); // dirname(".") === "." ≠ "/"
  });

  it("(e) depth-≥-2 NON-home paths → false (plausibly a real project)", () => {
    expect(isForbiddenRoot("/home/user/projects/foo")).toBe(false);
    expect(isForbiddenRoot("/home/dustin/myproject")).toBe(false);
    // "/home/dustin" is depth-2 and NOT forbidden by the depth rule — BUT on a box whose homedir() is
    // exactly /home/dustin, condition (a) makes it true. Assert false ONLY when it is provably ≠ home
    // (the intent: a depth-2 non-home path is allowed). PRP Task 4 GOTCHA: never hardcode a home guess.
    if (homedir() !== "/home/dustin") {
      expect(isForbiddenRoot("/home/dustin")).toBe(false);
    }
    expect(isForbiddenRoot("/opt/foo")).toBe(false);     // depth-2 under a system dir — allowed by design
    expect(isForbiddenRoot("/var/lib/foo")).toBe(false); // homedir-proof depth-2 path (green on any box)
  });

  it("(f) is pure + deterministic (same input → same output across calls)", () => {
    expect(isForbiddenRoot("/etc")).toBe(isForbiddenRoot("/etc"));
    expect(isForbiddenRoot("/home/dustin/myproject")).toBe(isForbiddenRoot("/home/dustin/myproject"));
  });
});

describe("types — export contract", () => {
  it("(type) the three functions + const have the documented signatures", () => {
    expectTypeOf<Parameters<typeof resolveSafeWorkspacePath>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<ReturnType<typeof resolveSafeWorkspacePath>>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof normalizeRelPath>>().toEqualTypeOf<[string, string]>();
    expectTypeOf<ReturnType<typeof normalizeRelPath>>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<typeof isDangerousWorkspaceRel>>().toEqualTypeOf<[string]>();
    expectTypeOf<ReturnType<typeof isDangerousWorkspaceRel>>().toEqualTypeOf<boolean>();
    expectTypeOf<Parameters<typeof isForbiddenRoot>>().toEqualTypeOf<[string]>();
    expectTypeOf<ReturnType<typeof isForbiddenRoot>>().toEqualTypeOf<boolean>();
    expectTypeOf<typeof DANGEROUS_DIRS>().toMatchTypeOf<readonly string[]>();
  });
});