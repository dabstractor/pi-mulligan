---
name: "P1.M2.T1.S1 — Implement pure path-safety helpers (src/snapshot/paths.ts)"
description: >
  Create `src/snapshot/paths.ts` — a BRAND-NEW, Pi-free, project-module-free PURE module exporting
  three path-safety functions consumed by the snapshot backends (`git.ts` P2.M2.T1, `cas.ts`
  P2.M3.T1): `resolveSafeWorkspacePath`, `normalizeRelPath`, `isDangerousWorkspaceRel`. Per spec/14
  §4.3. Zero fs calls, zero side effects, fully unit-testable in isolation. Includes JSDoc (Mode A)
  on each export citing @14 §4.3, and a full vitest unit suite (`test/paths.test.ts`) covering every
  reject condition listed in spec/14 line 221 (`..`/NUL/`.git`/`node_modules`/directory/abs-outside).
---

## Goal

**Feature Goal**: A new pure module `src/snapshot/paths.ts` exists and exports three deterministic,
side-effect-free path-safety functions that enforce workspace containment + a capture/restore
reject-list, exactly per spec/14 §4.3. These are the safety floor for both the git and CAS snapshot
backends — they prevent the backends from writing outside the workspace or touching sensitive
directories.

**Deliverable**:
1. `src/snapshot/paths.ts` (NEW) — three exported pure functions + one exported const
   (`DANGEROUS_DIRS`), a single `import { resolve, relative, isAbsolute, sep } from "node:path"`,
   NO other imports (zero Pi imports, zero project-module imports), rich JSDoc (Mode A) on every
   export citing `@14 §4.3`.
2. `test/paths.test.ts` (NEW) — a vitest unit suite covering every function + every spec/14 line-221
   reject condition, using the project's `.js`-import + describe/it + expectTypeOf conventions.

**Success Definition**:
- `resolveSafeWorkspacePath(root, "src/foo.ts")` → `"<root>/src/foo.ts"`; throws on `../escape`,
  `foo/../../x`, and `/etc/passwd` (absolute-override escape).
- `normalizeRelPath(root, "<root>/src/foo.ts")` → `"src/foo.ts"` (POSIX forward slashes; coerces `\`
  → `/`).
- `isDangerousWorkspaceRel(rel)` returns `true` for: NUL bytes, any `..` segment, trailing-separator
  (directory), absolute strings, and any segment in `[".git",".pi","node_modules"]` (case-insensitive);
  `false` for clean relative file paths (incl. `.gitignore` — a FILE, not the dir).
- All three are PURE: no `fs.*`, no network, no module-scoped mutable state, deterministic.
- `npm run typecheck` (tsc --noEmit) and `npm test` (vitest run) both pass, including the new suite.

## User Persona

**Target User**: The snapshot backends (`GitBackend` / `CasBackend`, built in P2) — NOT an end user.
This module is an internal safety primitive.

**Use Case**: Before the backends capture or restore a file, they normalize the candidate path
(`normalizeRelPath`), gate it through the reject-list (`isDangerousWorkspaceRel`), then resolve to a
verified absolute path (`resolveSafeWorkspacePath`). The composition is defense-in-depth: cheap
syntactic gate first, authoritative containment check (throws) second.

**Pain Points Addressed**: Path-traversal escapes (`../`), absolute-path overrides (`/etc/passwd`),
NUL-byte truncation attacks (CWE-158), accidental capture of `.git`/`.pi`/`node_modules`, and
cross-platform path-key instability (Windows `\` vs POSIX `/`).

## Why

- **The safety floor for the entire v1.2 working-tree-revert feature.** Every file path the git and
  CAS backends capture or restore flows through these helpers (spec/14 §4.3, line 73 placement tree,
  line 221 test list). Getting the path math wrong = the backends write outside the workspace or
  clobber sensitive dirs = data loss / VCS corruption.
- **Fully decoupled and parallelizable.** Per the work-item contract, this module imports NOTHING from
  Pi or other project modules — it is 100% standalone. It has NO dependency on P1.M1.T1.S1's
  `config.revert.*` block (the backends consume config; paths.ts does not). It can be (and is being)
  implemented in parallel with the config block with zero conflict surface.
- **Pure = trivially testable.** No fs, no Pi, no async → fast deterministic unit tests with no
  harness. This is where ~all the path-correctness lives (spec/10 Tier 1 philosophy).

## What

A new `src/snapshot/paths.ts` exporting three pure functions + one const (spec/14 §4.3, line 73):

| Export                      | Signature                                         | Behavior (spec/14 §4.3)                                                                                                                                            |
|-----------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `resolveSafeWorkspacePath`  | `(workspaceRoot: string, relPath: string): string`| Resolve `relPath` against `workspaceRoot` via `path.resolve`; verify the result is at-or-inside the workspace (no `..` escape, no cross-drive absolute override); return the absolute path; **THROW** on escape. |
| `normalizeRelPath`          | `(workspaceRoot: string, absPath: string): string`| Convert `absPath` to a workspace-relative **POSIX** (forward-slash) string. Windows backslash separators normalize to `/`.                                          |
| `isDangerousWorkspaceRel`   | `(relPath: string): boolean`                       | `true` for paths that must NEVER be captured/restored: NUL bytes, `..` segments, trailing-separator (directory), absolute strings, any segment under `.git`/`.pi`/`node_modules` (case-insensitive). |
| `DANGEROUS_DIRS` (const)    | `readonly string[]`                                | `[".git", ".pi", "node_modules"]` — the hardcoded safety reject-list (NOT from config). Exported for documentation/testing.                                         |

All three functions are PURE: only `node:path` string math; no `fs.*`, no network, no side effects,
no module-scoped mutable state. Symlink resolution is explicitly OUT OF SCOPE (lexical checks only;
the `fs.realpathSync` complement runs in the backends, P2).

### Success Criteria

- [ ] `src/snapshot/paths.ts` exists, exports the 3 functions + `DANGEROUS_DIRS`, and imports ONLY
      `{ resolve, relative, isAbsolute, sep } from "node:path"` (grep the file: no other `import`).
- [ ] `resolveSafeWorkspacePath` returns the resolved absolute path for inside paths and THROWS for
      `..` escapes and absolute-override escapes.
- [ ] `normalizeRelPath` returns POSIX forward-slash relative paths (backslash → forward slash).
- [ ] `isDangerousWorkspaceRel` returns `true` for every spec/14 line-221 reject class
      (`..`/NUL/`.git`/`.pi`/`node_modules`/trailing-slash/absolute) and `false` for clean files.
- [ ] `.gitignore` (a FILE) is NOT flagged dangerous; `.git` (the DIR) IS (segment match, not prefix).
- [ ] `DANGEROUS_DIRS` is hardcoded (not read from config); `.pi` is protected even though it is NOT
      in the default `config.revert.excludeGlobs`.
- [ ] `npm run typecheck` clean; `npm test` green (incl. the new `test/paths.test.ts`).

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?"
YES. This is a brand-new standalone file with a single Node built-in import. The spec section
(spec/14 §4.3), the exact function contracts, the canonical cross-platform idiom, the test
conventions (mirrored from `test/tokens.test.ts`), and the exact code are all specified below. The
implementer needs NO other codebase file to build it — only `node:path` (a Node built-in).

### Documentation & References

```yaml
# MUST READ — the authoritative spec for the three functions + their reject-list
- file: spec/14-working-tree-revert.md
  why: "§4.3 (line 125) is the verbatim contract: what paths to accept/reject, POSIX normalization,
        the dangerous dirs. Line 73 = the placement tree (src/snapshot/paths.ts, PURE). Line 221 =
        the exact unit-test reject list this task must cover (../NUL/.git/node_modules/directory/
        abs-outside-workspace). §2 (lines ~60-75) shows the backend consumers that will call these
        helpers (GitBackend, CasBackend)."
  section: "§4.3 Cross-cutting implementation requirements (path handling), §2 Architecture placement"
  critical: "§4.3 enumerates the reject set authoritatively: 'Reject paths containing NUL, escaping
             via .., directory paths (refuse to snapshot a directory), and dangerous workspace dirs
             (.git, .pi, node_modules). Windows-style paths normalize to /-separated relative paths.'
             Implement EXACTLY this set — no more, no less."

# Reference — external research brief (canonical idiom + cross-platform gotchas + URLs)
- file: plan/008_c36fd26768ae/P1M2T1S1/research/path-safety-research.md
  why: "The canonical 'is path B inside dir A' idiom (resolve+relative+startsWith('..')+isAbsolute),
        the path.resolve escape semantics, POSIX coercion, NUL-byte rationale (CWE-158), the symlink
        out-of-scope confirmation, and all authoritative URLs (Node path docs, CWE-22/158, OWASP)."
  critical: "The isAbsolute(rel) guard is MANDATORY — without it Windows cross-drive escapes
             (relative('C:\\a','D:\\b') → 'D:\\b') slip through. See 'Known Gotchas' #3."

# Pattern to mirror — an existing Pi-free pure helper module (JSDoc + structure + export style)
- file: src/tokens.ts
  why: "tokens.ts is the closest analog: a foundation-tier Pi-FREE pure helper (spec/03 §2.3). Mirror
        its docstring header (spec citations, DESIGN bullets, GOTCHA pointers), its 'imports NOTHING'
        discipline, and its export style (functions + auxiliary consts + optional type exports)."
  pattern: "Rich top-of-file JSDoc block citing the spec sections + design rationale + a 'NEVER
            throws / deterministic / side-effect-free' invariant note. See 'Implementation Patterns'."
  gotcha: "tokens.ts exports BOTH functions AND structural types. paths.ts exports functions + the
           DANGEROUS_DIRS const only (no input types beyond string). Do NOT invent extra exports."

# Pattern to mirror — the unit-test conventions for a pure helper
- file: test/tokens.test.ts
  why: "The template for this module's test file: vitest import shape, `.js` extension on the source
        import, describe/it grouping, inline-snapshot where a value is stable, expectTypeOf for the
        type contract, and 'No beforeEach needed — no module-scoped mutable state'."
  pattern: "import { describe, it, expect, expectTypeOf } from 'vitest';
            import { ... } from '../src/snapshot/paths.js';
            describe('<fn> — spec/14 §4.3 contract (...)', () => { it('...', () => {...}) })"
  gotcha: "Import path is '../src/snapshot/paths.js' (note the .js extension — Node ESM + tsc output
           convention used across the whole test suite). The source lives at src/snapshot/paths.ts."

# In-repo precedent — the SAME canonical idiom is already used in config.ts (P1.M1.T1.S1)
- file: src/config.ts
  why: "The storageDir inside-cwd check (added by P1.M1.T1.S1) uses resolve+relative+isAbsolute in
        the IDENTICAL shape paths.ts needs. This proves the idiom is idiomatic in THIS repo (not a
        novel pattern) and that the implementer can cross-reference an in-tree example."
  pattern: "const rel = relative(cwd, resolved); const inside = rel==='' || (!rel.startsWith('..') && !isAbsolute(rel));"
  critical: "config.ts imports { resolve, relative, isAbsolute } from 'node:path' — the exact subset
             paths.ts needs (paths.ts adds `sep` for POSIX coercion). Same import style."

# Architecture notes
- file: plan/008_c36fd26768ae/architecture/external_deps.md
  why: "§2 confirms the CAS backend (cas.ts) is the primary consumer of these helpers (whole-tree
        walk + explicit-paths capture both normalize + gate every path). §4 confirms NO new npm deps
        — only Node built-ins. paths.ts must stay dep-free."
- file: plan/008_c36fd26768ae/architecture/codebase_patterns.md
  why: "Confirms the pure-helper test tier (vitest, .js imports) and that snapshot/ is a NEW subsystem
        (paths.ts is its first file)."

# External authorities (cited in JSDoc + the research notes)
- url: https://nodejs.org/api/path.html#pathrelativefrom-to
  why: "path.relative return-value semantics — the escape signal ('../…') and the cross-drive
        absolute return on Windows that makes the isAbsolute(rel) guard mandatory."
- url: https://nodejs.org/api/path.html#pathresolvepaths
  why: "path.resolve right-to-left resolution + absolute-segment-override (the /etc/passwd escape
        vector) + cwd fallback."
- url: https://cwe.mitre.org/data/definitions/22.html
  why: "CWE-22 Path Traversal — the mitigation (canonicalize/resolve THEN boundary-check) is exactly
        resolveSafeWorkspacePath."
- url: https://cwe.mitre.org/data/definitions/158.html
  why: "CWE-158 NUL-byte injection — why isDangerousWorkspaceRel rejects \\0 before any resolution."
- url: https://nodejs.org/api/fs.html#fsrealpathsyncpath-options
  why: "fs.realpathSync — the fs-layer symlink complement the BACKENDS (not paths.ts) must call."
```

### Current Codebase tree (relevant slice)

```bash
src/
├── config.ts        # (P1.M1.T1.S1, in parallel) — already uses the same resolve/relative/isAbsolute idiom
├── tokens.ts        # pure-helper PATTERN to mirror (Pi-free, rich JSDoc, exports functions + consts)
└── ... (snapshot/ does NOT exist yet — this task creates it)
test/
├── tokens.test.ts   # pure-helper TEST PATTERN to mirror (vitest, .js import, describe/it, expectTypeOf)
└── ... (no paths test yet — this task adds test/paths.test.ts)
```

### Desired Codebase tree (files this task adds)

```bash
src/snapshot/
└── paths.ts         # NEW — resolveSafeWorkspacePath, normalizeRelPath, isDangerousWorkspaceRel (+ DANGEROUS_DIRS)
test/
└── paths.test.ts    # NEW — vitest unit suite for all three functions + every reject condition
```
No other files are created or modified by this task. (`src/snapshot/` is created implicitly by writing
`src/snapshot/paths.ts`.)

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — paths.ts imports ONLY node:path. ZERO Pi imports, ZERO project-module imports.
// The work-item contract is explicit: "a brand-new file with ZERO imports from Pi or other project
// modules." It does NOT read config.revert.* — DANGEROUS_DIRS is HARDCODED. (The backends consume
// config; paths.ts does not.) Do not add `import ... from "../config.js"` or any Pi import. The one
// and only import line is:  import { resolve, relative, isAbsolute, sep } from "node:path";

// GOTCHA #2 — the "is B inside A" check needs BOTH startsWith('..') AND isAbsolute(rel).
// path.relative(base, target) returns:
//   ""            → target === base (at the root)
//   "sub/x"       → inside
//   "../other"    → escaped (POSIX, or same-drive Windows)
//   "D:\\other"   → CROSS-DRIVE on Windows (absolute — cannot be expressed relatively!)
// A bare `!rel.startsWith('..')` check MISSES the cross-drive case. The isAbsolute(rel) guard catches
// it. This idiom is already used in src/config.ts (P1.M1.T1.S1 storageDir check) — cross-reference it.

// GOTCHA #3 — resolveSafeWorkspacePath throws ONLY on genuine escape; at-root is allowed.
// rel === "" (relPath resolved to the workspace root, e.g. relPath="." or "") is NOT an escape — it
// returns the root path. The contract says "throws on escape attempt"; at-root is not an escape.
// Throw exactly when: rel.startsWith("..") || isAbsolute(rel). The is-this-a-capturable-FILE concern
// (dir vs file) is isDangerousWorkspaceRel's job + the backend fs layer — NOT this function's.

// GOTCHA #4 — the escape vector is absolute-override in relPath.
// path.resolve(root, "/etc/passwd") === "/etc/passwd" (an absolute relPath DISCARDS root). Then
// relative(root, "/etc/passwd") === "../../etc/passwd" (starts with "..) → throws. So passing an
// absolute-outside path as relPath correctly throws. Do NOT special-case it — the idiom handles it.

// GOTCHA #5 — normalizeRelPath must use platform-native relative, NOT path.posix.relative, for input.
// path.posix.relative("C:\\a","C:\\a\\x") mishandles Windows drive letters. Use the platform-native
// relative() (which IS win32 on Windows), then coerce separators: rel.split(sep).join("/"). On POSIX
// sep==="/" so the split/join is a no-op; on Windows it converts "\\" → "/".

// GOTCHA #6 — isDangerousWorkspaceRel takes ONE arg (relPath), no workspaceRoot. The "absolute path
// that resolves outside workspace" criterion is satisfied TWO ways: (a) directly — a workspace-rel
// string that is still absolute (path.isAbsolute(relPath)) is rejected; (b) transitively — the
// backends call normalizeRelPath(root, absPath) FIRST, which turns an outside-absolute path into
// "../etc/passwd", and the ".. segment → dangerous" check then fires. Do NOT add a workspaceRoot arg.

// GOTCHA #7 — ".. escape" = ANY ".." segment → dangerous (fail-closed), NOT depth-tracking.
// Split the rel on BOTH separators (/[\\/]/) and flag if any segment === "..". This deliberately
// over-rejects harmless "a/../b.ts" (fail-closed per project philosophy) and avoids weird snapshot
// keys containing "..". Depth-tracking (the "precise" alternative) is NOT used — simplicity + safety.

// GOTCHA #8 — dangerous dirs = SEGMENT match, CASE-INSENSITIVE (not prefix, not case-sensitive).
//   ".git"            → segments [".git"]         → DANGEROUS (the dir)
//   ".git/config"     → segments [".git","config"]→ DANGEROUS (under the dir)
//   ".gitignore"      → segments [".gitignore"]   → SAFE (a FILE, segment ≠ ".git")
//   "src/node_modules/pkg" → DANGEROUS (nested — segment match catches it; prefix match would too)
//   ".Git", "Node_Modules" → DANGEROUS (case-insensitive: macOS/Windows default FS treat .Git≡.git)
// Use DANGEROUS_DIRS.includes(seg.toLowerCase()). Case-insensitive is deliberately fail-closed.

// GOTCHA #9 — DANGEROUS_DIRS ≇ config.revert.excludeGlobs. They are DIFFERENT layers.
//   DANGEROUS_DIRS = [".git",".pi","node_modules"]  — the SAFETY floor (hardcoded in paths.ts; ALWAYS
//     enforced; ".pi" is protected here even though it is NOT in the default excludeGlobs).
//   excludeGlobs   = [".git","node_modules","dist","build",".next",".venv","target"] — the backends'
//     walk-level SIZE/PERF exclude (git pathspec ':!node_modules'; CAS walk skip). Applied by git.ts/
//     cas.ts (P2), NOT by paths.ts. They overlap but are independent. Do NOT merge them into paths.ts.

// GOTCHA #10 — trailing-separator check covers BOTH "/" and the platform sep.
// isDangerousWorkspaceRel must flag a directory marker: relPath.endsWith("/") || relPath.endsWith(sep).
// (sep==="/" on POSIX, "\\" on Windows.) A relPath ending in either separator = directory = reject.

// GOTCHA #11 — symlinks are OUT OF SCOPE (pure module, no fs). All path.* ops are LEXICAL.
// A symlink under the workspace pointing outside is undetectable here. Document this in the JSDoc.
// The fs-layer complement (fs.realpathSync(root)+realpathSync(resolved) then re-check containment)
// runs in the BACKENDS (git.ts/cas.ts, P2), NOT in paths.ts. This is a HIGH-severity residual risk
// the caller must mitigate; paths.ts is the lexical floor, not the only defense.

// GOTCHA #12 — error type is a plain Error (no custom subclass). The contract says "throws on escape
// attempt" with no error class specified. Throw `new Error("resolveSafeWorkspacePath: ...")`. The
// backends catch generically; tests assert via expect(() => ...).toThrow(). Do not invent a class.

// GOTCHA #13 — test file uses the .js import extension (Node ESM + tsc output convention).
//   import { resolveSafeWorkspacePath, normalizeRelPath, isDangerousWorkspaceRel, DANGEROUS_DIRS }
//     from "../src/snapshot/paths.js";   // <-- .js, not .ts. Every test file in this repo does this.
```

## Implementation Blueprint

### Data models and structure

There are no data models beyond the three function signatures + one const. This is a pure
path-math module — no Pydantic/ORM/schema. The only types are `string` (inputs/outputs) and the
`readonly string[]` const. TypeScript strict mode (`tsconfig.json`: `strict:true`,
`noImplicitAny:true`) applies — every param/return is annotated `string` / `boolean`.

```typescript
// The complete public surface (signatures only — full bodies in the Tasks below):
export function resolveSafeWorkspacePath(workspaceRoot: string, relPath: string): string;
export function normalizeRelPath(workspaceRoot: string, absPath: string): string;
export function isDangerousWorkspaceRel(relPath: string): boolean;
export const DANGEROUS_DIRS: readonly string[];   // [".git", ".pi", "node_modules"]
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/snapshot/paths.ts — module header + import + DANGEROUS_DIRS
  - CREATE the file src/snapshot/paths.ts (creates the src/snapshot/ dir implicitly).
  - HEADER: a rich top-of-file JSDoc block mirroring src/tokens.ts. Cite spec/14 §4.3 (the contract),
    spec/14 line 73 (placement), spec/03 §2.3/§7 (pure helper, snapshot/ subtree), spec/10 Tier 1
    (unit-test tier). Include a DESIGN section with bullets: (a) Pi-FREE + project-module-FREE — the
    ONLY import is node:path; (b) PURE — no fs, no side effects, no module-scoped mutable state,
    deterministic; (c) LEXICAL only — no symlink resolution (GOTCHA #11); (d) the consumers are
    GitBackend (git.ts) + CasBackend (cas.ts), built in P2; (e) pointers to GOTCHA #1–#13.
  - IMPORT (the ONLY import line in the file):
      import { resolve, relative, isAbsolute, sep } from "node:path";
  - CONST (right after the import):
      /**
       * Workspace directories that must NEVER be captured into a snapshot or restored into the
       * working tree, regardless of config. Hardcoded (paths.ts imports NOTHING from config) — this
       * is the SAFETY floor, distinct from the backends' walk-level `config.revert.excludeGlobs`
       * (GOTCHA #9). Case-insensitive segment match (GOTCHA #8). spec/14 §4.3.
       */
      export const DANGEROUS_DIRS: readonly string[] = [".git", ".pi", "node_modules"];
  - WHY hardcode: the work-item contract mandates zero project-module imports. `.pi` is protected
    here even though it is NOT in the default excludeGlobs (GOTCHA #9).
  - GOTCHA: #1 (only node:path), #9 (DANGEROUS_DIRS ≇ excludeGlobs).

Task 2: CREATE src/snapshot/paths.ts — resolveSafeWorkspacePath
  - IMPLEMENT (exact body):
      /**
       * Resolve `relPath` against `workspaceRoot` and VERIFY the result is at-or-inside the workspace
       * (no `..` escape, no cross-drive absolute override). Returns the absolute path; THROWS on any
       * escape attempt.
       *
       * PURE — no fs calls, no symlink resolution (lexical containment only; the fs-layer
       * `fs.realpathSync` complement runs in the snapshot backends, out of scope here — GOTCHA #11).
       *
       * Escape vectors caught: (a) `../` segments lexically collapsed outside the root; (b) an
       * absolute `relPath` (e.g. "/etc/passwd") whose absolute-segment OVERRIDE in path.resolve
       * discards `workspaceRoot` (GOTCHA #4); (c) Windows cross-drive where path.relative returns an
       * absolute path (GOTCHA #2). spec/14 §4.3.
       *
       * @throws {Error} when the resolved path is not at-or-inside `workspaceRoot`.
       */
      export function resolveSafeWorkspacePath(workspaceRoot: string, relPath: string): string {
        const root = resolve(workspaceRoot);        // absolute, normalized
        const resolved = resolve(root, relPath);    // absolute relPath overrides root; `..` collapsed
        const rel = relative(root, resolved);       // '' at-root | '../..' escaped | absolute cross-drive
        if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
          return resolved;                          // at-or-inside the workspace — safe
        }
        throw new Error(
          `resolveSafeWorkspacePath: path escapes workspace root: ${JSON.stringify(relPath)} -> ${JSON.stringify(resolved)}`,
        );
      }
  - NAMING: resolveSafeWorkspacePath (exact — matches spec/14 line 73 + the contract).
  - GOTCHA: #2 (the isAbsolute guard), #3 (at-root allowed, not an escape), #4 (absolute override),
    #12 (plain Error).
  - DEPENDENCIES: Task 1 (import + DANGEROUS_DIRS).

Task 3: CREATE src/snapshot/paths.ts — normalizeRelPath
  - IMPLEMENT (exact body):
      /**
       * Convert `absPath` to a workspace-relative POSIX (forward-slash) string. Uses the
       * platform-native `path.relative` (correct on Windows — handles drive letters; do NOT use
       * path.posix.relative for input, GOTCHA #5), then coerces the platform separator to `/` for
       * stable cross-platform snapshot keys. PURE. spec/14 §4.3 ("Windows-style paths normalize to
       * /-separated relative paths").
       *
       * An `absPath` OUTSIDE the workspace yields a `"../…"` string here; the caller should gate it
       * with isDangerousWorkspaceRel (whose `..` check then fires) before use.
       */
      export function normalizeRelPath(workspaceRoot: string, absPath: string): string {
        const rel = relative(resolve(workspaceRoot), resolve(absPath));
        return rel.split(sep).join("/");            // POSIX: no-op; Windows: '\\' -> '/'
      }
  - NAMING: normalizeRelPath (exact).
  - GOTCHA: #5 (platform-native relative, then split(sep).join("/")).
  - DEPENDENCIES: Task 1.

Task 4: CREATE src/snapshot/paths.ts — isDangerousWorkspaceRel
  - IMPLEMENT (exact body):
      /**
       * Return true for a workspace-relative path that must NEVER be captured into a snapshot or
       * restored into the working tree: a NUL byte, an absolute string, a trailing separator
       * (directory), any `..` segment (escape), or any segment under a dangerous dir
       * (`.git`/`.pi`/`node_modules`, case-insensitive). PURE syntactic check — no workspaceRoot,
       * no fs. spec/14 §4.3.
       *
       * The "absolute path that resolves outside the workspace" criterion is met two ways: directly
       * (a workspace-rel string that is still absolute is rejected) and transitively (the backends
       * call normalizeRelPath first, which turns an outside-absolute path into `../…`, caught by the
       * `..` check). GOTCHA #6/#7/#8/#10.
       */
      export function isDangerousWorkspaceRel(relPath: string): boolean {
        if (relPath.includes("\0")) return true;                       // NUL byte — CWE-158 (GOTCHA: #6)
        if (isAbsolute(relPath)) return true;                          // a workspace-rel is never absolute
        if (relPath.endsWith("/") || relPath.endsWith(sep)) return true; // directory marker (#10)
        const segments = relPath.split(/[\\/]/);                       // split on BOTH separators
        for (const seg of segments) {
          const lower = seg.toLowerCase();
          if (lower === "..") return true;                             // any `..` segment — fail-closed (#7)
          if (DANGEROUS_DIRS.includes(lower)) return true;             // under a dangerous dir (#8)
        }
        return false;
      }
  - NAMING: isDangerousWorkspaceRel (exact).
  - GOTCHA: #6 (one arg), #7 (any `..` segment, not depth-tracking), #8 (segment + case-insensitive),
    #10 (trailing "/" + sep).
  - DEPENDENCIES: Task 1 (DANGEROUS_DIRS).

Task 5: CREATE test/paths.test.ts — full vitest unit suite
  - CREATE test/paths.test.ts (flat placement — matches the pure-helper siblings tokens/ledger/notes/
    transforms, which are all flat test/*.test.ts; NOT test/snapshot/ since paths.ts is a pure helper,
    not a Pi-coupled backend).
  - HEADER import block (exact — note the .js extension, GOTCHA #13):
      import { describe, it, expect, expectTypeOf } from "vitest";
      import {
        resolveSafeWorkspacePath,
        normalizeRelPath,
        isDangerousWorkspaceRel,
        DANGEROUS_DIRS,
      } from "../src/snapshot/paths.js";
  - Add a top-of-file comment citing: spec/14 §4.3 (contract), spec/14 line 221 (the exact reject
    list to cover), spec/10 Tier 1 (pure-helper test tier), task id P1.M2.T1.S1. "No beforeEach
    needed — paths.ts has NO module-scoped mutable state" (mirror tokens.test.ts).
  - FOLLOW pattern: test/tokens.test.ts (describe per function with a spec-citation header, lettered
    (a)/(b)/(c)... it cases, inline-snapshot where a value is stable, expectTypeOf for the type
    contract).
  - DESCRIBE BLOCKS + CONCRETE ASSERTIONS (so the implementer does not guess):

      describe("resolveSafeWorkspacePath — spec/14 §4.3 contract", () => {
        const ROOT = "/tmp/ws";                                    // absolute workspace root
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
          expect(() => resolveSafeWorkspacePath(ROOT, "/etc/passwd")).toThrow();  // resolves outside ROOT
        });
        it("(d) does NOT throw for at-root (rel resolves to the workspace root — not an escape)", () => {
          expect(resolveSafeWorkspacePath(ROOT, ".")).toBe("/tmp/ws");   // rel==="" → returns root
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
          expect(normalizeRelPath(ROOT, "/etc/passwd")).toMatch(/^\.\.\//);   // starts with ../
        });
        it("(d) coerces backslash separators to forward slash (Windows-style normalization)", () => {
          // On POSIX, build a path whose relative form would contain separators; assert the output
          // never contains a backslash. (split(sep).join("/") is a no-op on POSIX, so test the contract:
          // the output is forward-slash-only.)
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
          expect(isDangerousWorkspaceRel("a/../b")).toBe(true);   // deliberately over-rejected (#7)
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
          expect(isDangerousWorkspaceRel("src/node_modules/pkg")).toBe(true);   // nested — segment match
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
          expect(isDangerousWorkspaceRel(".gitignore")).toBe(false);   // segment ".gitignore" ≠ ".git"
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
          expect(isDangerousWorkspaceRel(rel)).toBe(true);   // the `..` check fires
        });
        it("(b) a clean inside path passes all three", () => {
          const abs = "/tmp/ws/src/foo.ts";
          const rel = normalizeRelPath(ROOT, abs);           // "src/foo.ts"
          expect(isDangerousWorkspaceRel(rel)).toBe(false);
          expect(resolveSafeWorkspacePath(ROOT, rel)).toBe("/tmp/ws/src/foo.ts");
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
          expectTypeOf<typeof DANGEROUS_DIRS>().toMatchTypeOf<readonly string[]>();
        });
      });
  - GOTCHA: #13 (.js import). The ROOT value ("/tmp/ws") is an absolute POSIX path — the test
    environment is POSIX, so path.isAbsolute("/etc/passwd")===true and resolve behave as asserted.
    (On Windows the same logic holds but separators differ; these tests run on POSIX CI.)
  - COVERAGE: every spec/14 line-221 reject class (.. / NUL / .git / .pi / node_modules / directory /
    abs-outside-workspace) has an explicit assertion. The composition describe proves the transitively-
    caught outside-absolute case (the one-arg isDangerousWorkspaceRel design — GOTCHA #6).

### Implementation Patterns & Key Details

```typescript
// CRITICAL PATTERN — the canonical "is B inside A" idiom (used by resolveSafeWorkspacePath).
// Already proven in-repo by src/config.ts (P1.M1.T1.S1 storageDir check). The isAbsolute(rel) guard
// is MANDATORY for Windows cross-drive safety:
//   const rel = relative(root, resolved);
//   const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
// (resolveSafeWorkspacePath returns resolved when `inside`, else throws.)

// CRITICAL PATTERN — fail-closed reject list (isDangerousWorkspaceRel). Every danger signal is a
// short-circuit return-true. Split on BOTH separators (/[\\/]/) so a stray backslash can't smuggle a
// ".." or ".git" segment past the check on POSIX (where "\" is a legal filename char but splitting on
// it is the safe, documented choice — GOTCHA: see research notes §7, low severity).

// NON-GOALS (explicitly out of scope for THIS task — they belong to P2 backends):
//   - NO src/snapshot/store.ts, git.ts, cas.ts (those are P2.M1/P2.M2/P2.M3).
//   - NO fs.realpath symlink containment (the backends add that; paths.ts is lexical only).
//   - NO reading config.revert.* (paths.ts is config-free; DANGEROUS_DIRS is hardcoded).
//   - NO modifications to ANY existing file (config.ts, tokens.ts, index.ts, ...). This task is
//     purely additive: one new src file + one new test file.
```

### Integration Points

```yaml
NEW FILE (src/snapshot/paths.ts — created by this task):
  - exports: resolveSafeWorkspacePath, normalizeRelPath, isDangerousWorkspaceRel, DANGEROUS_DIRS
  - imports: ONLY { resolve, relative, isAbsolute, sep } from "node:path"
  - consumers (FUTURE, do not build them here): src/snapshot/git.ts (P2.M2.T1),
    src/snapshot/cas.ts (P2.M3.T1) — both call normalizeRelPath → isDangerousWorkspaceRel →
    resolveSafeWorkspacePath on every candidate path.

NEW TEST (test/paths.test.ts — created by this task):
  - imports the four exports from "../src/snapshot/paths.js" (.js extension — GOTCHA #13)
  - covers every spec/14 line-221 reject class + the composition flow + the type contract

NO CHANGES TO: src/config.ts (P1.M1.T1.S1, parallel), src/tokens.ts, src/index.ts, any src/tools/*,
  any existing test file, package.json, tsconfig.json. This task is strictly additive.
```

## Validation Loop

> NOTE: this is a TypeScript + vitest project. The gates are `npm run typecheck` (tsc --noEmit) and
> `npm test` (vitest run). There is NO ruff/mypy/eslint — those are Python/template tools and DO NOT
> APPLY. (package.json scripts: `test`, `typecheck`, `smoke`, `prepublishOnly`.)

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After writing src/snapshot/paths.ts (before tests):
npm run typecheck        # = tsc --noEmit (strict). MUST be clean.
# Expected: zero errors. If tsc complains about the DANGEROUS_DIRS.includes(lower) call, ensure
# DANGEROUS_DIRS is typed `readonly string[]` (NOT `as const` — `as const` narrows .includes' arg
# type to the literal union and rejects a plain string). See Task 1.

# Confirm the import discipline (GOTCHA #1) — only node:path, nothing else:
grep -nE '^import ' src/snapshot/paths.ts
# Expected: exactly ONE line:  import { resolve, relative, isAbsolute, sep } from "node:path";
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the new suite specifically:
npx vitest run test/paths.test.ts
# Expected: ALL green — every lettered (a)..(h) case in every describe block.

# Full suite (catches accidental regressions — there should be NONE since this task adds files only):
npm test                 # = vitest run
# Expected: all green. Since paths.ts is imported by NOTHING yet (the backends are P2), no other
# test can regress from this change. If any pre-existing test fails, it is unrelated — investigate.
```

### Level 3: Integration Testing (System Validation)

```bash
# This is a PURE module with no Pi/fs surface — there is no server or harness to start. Level 3 here
# = a live sanity check that the functions behave as specified from a real Node process:
node --input-type=module -e "
  import('./src/snapshot/paths.js').then((m) => {
    const ROOT = '/tmp/ws';
    console.log('resolve inside :', m.resolveSafeWorkspacePath(ROOT, 'src/foo.ts'));   // /tmp/ws/src/foo.ts
    console.log('normalize      :', m.normalizeRelPath(ROOT, '/tmp/ws/src/foo.ts'));    // src/foo.ts
    console.log('dangerous .git :', m.isDangerousWorkspaceRel('.git/config'));          // true
    console.log('safe .gitignore:', m.isDangerousWorkspaceRel('.gitignore'));           // false
    console.log('NUL            :', m.isDangerousWorkspaceRel('a\0b'));                 // true
    try { m.resolveSafeWorkspacePath(ROOT, '../escape'); console.log('escape: NO THROW (BUG)'); }
    catch (e) { console.log('escape throws OK:', e.message.slice(0, 40)); }
    console.log('DANGEROUS_DIRS :', JSON.stringify(m.DANGEROUS_DIRS));                  // [\".git\",\".pi\",\"node_modules\"]
  });
"
# Expected: resolve inside → /tmp/ws/src/foo.ts; normalize → src/foo.ts; dangerous .git → true;
# safe .gitignore → false; NUL → true; escape throws OK: ...; DANGEROUS_DIRS → the 3-element list.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Adversarial / escape-vector sweep — every known traversal trick must be refused or normalized safely:
node --input-type=module -e "
  import('./src/snapshot/paths.js').then((m) => {
    const ROOT = '/tmp/ws';
    // Each must THROW (escape) or be flagged dangerous:
    const escapes = ['../x', 'foo/../../y', '/etc/passwd', './../../z', 'a/b/../../../c'];
    for (const p of escapes) {
      let threw = false; try { m.resolveSafeWorkspacePath(ROOT, p); } catch { threw = true; }
      console.log('escape', JSON.stringify(p), '→', threw ? 'THROWS OK' : 'NO THROW (BUG)');
    }
    // Each must be dangerous:
    const danger = ['.git/x', '.pi/y', 'node_modules/z', 'src/node_modules/w', '.Git/v',
                    'src/', 'a/..', 'safe\0evil', '/abs'];
    for (const p of danger) console.log('danger', JSON.stringify(p), '→', m.isDangerousWorkspaceRel(p));
    // Each must be SAFE (not dangerous):
    const safe = ['src/foo.ts', '.gitignore', '.env', 'README.md', 'a/b/c.ts'];
    for (const p of safe) console.log('safe  ', JSON.stringify(p), '→', m.isDangerousWorkspaceRel(p));
  });
"
# Expected: every `escape` → THROWS OK; every `danger` → true; every `safe` → false. Any deviation is a bug.

# Purity check — no module-scoped mutable state (call twice, results identical + no fs touched):
node --input-type=module -e "
  import('./src/snapshot/paths.js').then((m) => {
    const a = m.resolveSafeWorkspacePath('/tmp/ws', 'x.ts');
    const b = m.resolveSafeWorkspacePath('/tmp/ws', 'x.ts');
    console.log('deterministic:', a === b);   // true
  });
"
# Expected: deterministic: true.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` is clean (no TS errors; `DANGEROUS_DIRS.includes(lower)` type-checks).
- [ ] `grep -nE '^import ' src/snapshot/paths.ts` shows EXACTLY ONE line: the node:path import.
- [ ] `npm test` passes (full suite) — including the new `test/paths.test.ts`.
- [ ] `npx vitest run test/paths.test.ts` — every lettered case in every describe block is green.

### Feature Validation

- [ ] `resolveSafeWorkspacePath` returns the resolved absolute path for inside paths; THROWS for
      `../escape`, `foo/../../x`, and `/etc/passwd` (absolute override); returns root for at-root.
- [ ] `normalizeRelPath` returns POSIX forward-slash relative strings (no backslash in output).
- [ ] `isDangerousWorkspaceRel` returns `true` for every spec/14 line-221 reject class: NUL, `..`,
      trailing-separator (directory), `.git`/`.pi`/`node_modules` (segment, case-insensitive, nested),
      and absolute strings; `false` for clean files incl. `.gitignore`.
- [ ] `.gitignore` is SAFE; `.git` (the dir) is DANGEROUS (segment match, not prefix).
- [ ] `DANGEROUS_DIRS === [".git",".pi","node_modules"]` (hardcoded; `.pi` protected despite not
      being in the default `config.revert.excludeGlobs`).
- [ ] The composition flow (normalize → isDangerous → resolve) catches an outside-absolute path
      transitively (the one-arg isDangerousWorkspaceRel design).

### Code Quality Validation

- [ ] paths.ts mirrors the tokens.ts pure-helper structure (rich spec-citing JSDoc header + DESIGN
      bullets + GOTCHA pointers + per-export JSDoc).
- [ ] Every export has Mode-A JSDoc citing `@14 §4.3`.
- [ ] Only ONE import line (node:path); zero Pi imports; zero project-module imports.
- [ ] test/paths.test.ts mirrors test/tokens.test.ts conventions (.js import, describe/it, expectTypeOf).
- [ ] No existing file modified; no new files beyond `src/snapshot/paths.ts` + `test/paths.test.ts`.

### Documentation & Deployment

- [ ] JSDoc is self-documenting (spec citations + defaults + the lexical-only/symlink-out-of-scope note).
- [ ] No new environment variables; no new npm dependencies (only the Node built-in `node:path`).

---

## Anti-Patterns to Avoid

- ❌ Don't import ANYTHING other than `node:path` — the contract mandates zero Pi + zero
  project-module imports. Do NOT read `config.revert.*`; DANGEROUS_DIRS is hardcoded (GOTCHA #1/#9).
- ❌ Don't drop the `!isAbsolute(rel)` guard in the containment check — Windows cross-drive escapes
  slip through without it (GOTCHA #2).
- ❌ Don't make `isDangerousWorkspaceRel` take `workspaceRoot` — it's a one-arg syntactic predicate by
  design (GOTCHA #6). The outside-absolute case is caught transitively via normalize→`../…`.
- ❌ Don't use depth-tracking for the `..` check — use "any `..` segment → dangerous" (fail-closed,
  simpler, matches the contract wording on normalized inputs). GOTCHA #7.
- ❌ Don't match dangerous dirs by PREFIX (`.startsWith('.git/')`) — it misses nested
  `src/node_modules/x` AND mis-flags `.gitignore`. Use SEGMENT match (case-insensitive). GOTCHA #8.
- ❌ Don't use `path.posix.relative` for input resolution — it mishandles Windows drive letters. Use
  platform-native `relative`, then `split(sep).join("/")`. GOTCHA #5.
- ❌ Don't resolve symlinks here — paths.ts is pure/lexical. The `fs.realpathSync` complement is the
  backends' job (P2). Document the limitation; don't try to fix it with fs calls. GOTCHA #11.
- ❌ Don't type `DANGEROUS_DIRS` as `as const` — it narrows `.includes`'s arg to the literal union and
  rejects a plain `string`. Type it `readonly string[]`. (Task 1.)
- ❌ Don't expand scope: no store.ts/git.ts/cas.ts (P2), no config/markers/runtime changes, no rewind
  tool changes. This task is ONE new src file + ONE new test file, strictly additive.
- ❌ Don't invent a custom Error subclass — throw a plain `Error` with a descriptive message (GOTCHA #12).
- ❌ Don't forget the `.js` extension on the test's source import — every test file in this repo uses it
  (GOTCHA #13).

---

## Confidence Score: 9/10

**Why high**: This is a small, fully-specified pure module. The contract (spec/14 §4.3 + the work-item
description) pins every function's signature and behavior; the reject list is enumerated line-for-line
in spec/14 line 221; the canonical cross-platform idiom (`resolve`+`relative`+`startsWith('..')`+
`isAbsolute`) is already proven in-repo by `src/config.ts` (P1.M1.T1.S1) and confirmed by external
research (Node path docs, CWE-22/158, OWASP). The module has zero dependencies, so there is no
integration risk — it is trivially unit-testable. Every line of the implementation is given verbatim in
the Tasks, and every test assertion is concretely specified.

**Residual risk (the 1 point)**: cross-platform separator edge cases that the POSIX CI cannot exercise
at runtime — (a) the Windows cross-drive `relative` returning an absolute path (mitigated by the
mandatory `isAbsolute(rel)` guard, but only testable on Windows); (b) POSIX filenames containing `\`
being over-split by the `/[\\/]/` segment split (fail-closed, low severity, documented). The symlink
escape (HIGH severity) is explicitly out of scope and documented as the backends' (P2) responsibility.
Mitigated by Level 4's adversarial escape-vector sweep, which exercises every reject class from a real
Node process.