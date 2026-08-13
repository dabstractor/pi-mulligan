---
name: "P1.M1.T1.S1 — Implement isForbiddenRoot in paths.ts + unit tests in paths.test.ts"
description: >
  Add a PURE boolean predicate `isForbiddenRoot(root: string): boolean` to `src/snapshot/paths.ts`
  that returns true for any workspace root that is too dangerous to snapshot/restore into: the user's
  home, `/`, any depth-1 system dir (dirname === "/"), or the degenerate `""`/`.`. This is the lexical
  floor of the spec/14 §2 SAFETY INVARIANT ("workspace root is realpath(cwd), full stop — a subdirectory
  launch can never be silently promoted to a parent; restore() must re-check this and refuse"). It is the
  first brick of the P1 detection-safety-hardening milestone; later subtasks (P1.M1.T2/T3/T4) consume it
  in `detectAndCreate`, `GitBackend.restore`, and `CasBackend.restore`. No fs calls, no Pi, no side effects.
---

## Goal

**Feature Goal**: A pure, exported, fully unit-tested `isForbiddenRoot(root)` predicate that lets the
snapshot subsystem refuse to operate when the resolved workspace root is a path where a wholesale
working-tree restore would be catastrophic (the user's `$HOME`, `/`, `/home`/`/etc`/`/usr`/…, or a
degenerate empty/dot value). This closes the historical regression vector documented in spec/14 §2
(upward repo discovery once resolved the workspace to `$HOME`; `restore()` then wiped the home tree).

**Deliverable** (two file edits, both in scope of THIS subtask only):
1. `src/snapshot/paths.ts`:
   - Add `import { homedir } from "node:os";` and add `dirname` to the existing `node:path` import.
   - Add `export function isForbiddenRoot(root: string): boolean` with full JSDoc citing
     `@spec/14 §2 SAFETY INVARIANT` + `§10` (testing safety clause), stating the exact predicate.
   - Update the module header docstring (the line that says "The ONLY import is `node:path`") so it is
     no longer stale now that `node:os` is also imported.
2. `test/paths.test.ts`:
   - Append a new `describe("isForbiddenRoot — spec/14 §2 SAFETY INVARIANT + §10", ...)` block covering
     the canonical matrix from the plan's `test_strategy.md`, plus a few boundary cases + a type-level
     `expectTypeOf` assertion.

**Success Definition**:
- `isForbiddenRoot(os.homedir())` → `true`; `isForbiddenRoot("/")` → `true`;
  `isForbiddenRoot("/home")`, `"/etc"`, `"/usr"`, `"/var"` → `true` (depth-1);
  `isForbiddenRoot("")`, `"."` → `true` (degenerate); `isForbiddenRoot("/home/user/projects/foo")`,
  `"/home/dustin/myproject"` → `false` (depth ≥ 2, not home).
- The function is PURE: no `fs.*`, no network, no module-scoped mutable state, deterministic.
- `npm run typecheck` (tsc --noEmit) and `npx vitest run test/paths.test.ts` (and the full `npm test`)
  all pass. The existing `paths.ts` exports + `paths.test.ts` blocks are UNCHANGED.

## Why

- **It is the safety floor of the v1.2 working-tree-revert feature.** spec/14 §2 makes the workspace
  root "`realpath(cwd)`, full stop" and lists the forbidden cases by name (home, `/`, `/home`, `/etc`,
  `/usr`, `/var`, "or any path too shallow to be a real project"). This predicate encodes that rule as a
  single reusable boolean so three downstream sites (detection + both `restore()` guards) enforce the
  SAME definition with no drift.
- **It is the last line of defense.** spec/14 §2 mandates that `restore()` "MUST additionally re-check
  this invariant at its entry and refuse … if the resolved root is forbidden — a last line of defense
  independent of detection." That re-check is exactly `if (isForbiddenRoot(root)) return refused`. So
  this tiny pure function is load-bearing for the "non-negotiable" safety invariant.
- **It is the prerequisite for the rest of P1.M1.** `detectAndCreate` (P1.M1.T2.S1),
  `GitBackend.restore` (P1.M1.T3.S2), and `CasBackend.restore` (P1.M1.T4.S1) all import it; landing it
  first (with tests) unblocks them with a stable contract.

## What

A pure predicate with this exact contract (verbatim from the plan's `test_strategy.md`):

```ts
/**
 * True iff `root` is a workspace root the snapshot subsystem must NEVER operate on.
 * @spec/14 §2 SAFETY INVARIANT + §10 (testing safety clause).
 */
export function isForbiddenRoot(root: string): boolean {
  return (
    root === "" ||            // (d) defensive — degenerate input
    root === "." ||           // (d) defensive — degenerate input
    root === "/" ||           // (b) filesystem root
    dirname(root) === "/" ||  // (c) depth-1 system dir: /home /etc /usr /var /bin /sbin /opt /tmp /root …
    root === homedir()        // (a) the user's home (typically depth-2, e.g. /home/<user>) — caught explicitly
  );
}
```

`true` ⟹ forbidden (refuse/skip). `false` ⟹ a depth-≥-2, non-home path that is plausibly a real
project (allowed). The order of the `||` operands is irrelevant to correctness (any-true short-circuits)
and is chosen only for readability.

### Success Criteria

- [ ] `isForbiddenRoot` is exported from `src/snapshot/paths.ts` with the signature `(root: string) => boolean`.
- [ ] It imports `homedir` from `node:os` and adds `dirname` to the `node:path` import — NOTHING else new.
- [ ] It is pure (no `fs`, no network, no mutable state) and deterministic (same input → same output).
- [ ] The canonical matrix (homedir/`/`/depth-1/empty/dot → true; depth-≥-2 non-home → false) passes.
- [ ] The existing exports (`resolveSafeWorkspacePath`, `normalizeRelPath`, `isDangerousWorkspaceRel`,
      `DANGEROUS_DIRS`) and their tests are UNCHANGED.
- [ ] The module header docstring no longer falsely claims "The ONLY import is `node:path`".
- [ ] `npm run typecheck` + `npx vitest run test/paths.test.ts` + `npm test` all green.
- [ ] No other source file is touched (the downstream consumers are SEPARATE subtasks — see Scope).

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
target file, the exact existing import line to extend, the exact function body, the exact test matrix
(from the plan's own `test_strategy.md`), and the spec citations are all below. This is one pure
function + one test block.

### Documentation & References

```yaml
# MUST READ — the spec authority for the predicate
- file: spec/14-working-tree-revert.md
  why: "§2 is the SAFETY INVARIANT this predicate encodes: workspace root = realpath(cwd); forbidden
        cases named as home / `/` / `/home` / `/etc` / `/usr` / `/var` / 'any path too shallow to be
        a real project'; restore() must re-check and refuse independently of detection. §10 is the
        testing safety clause: detectAndCreate($HOME) and detectAndCreate('/') must each return a none
        /NoOp backend; restore() against a forbidden root returns refused with ZERO fs mutation."
  section: "§2 Architecture — the SnapshotStore (the 'SAFETY INVARIANT — non-negotiable' block +
            the Detection paragraph), §10 Testing (the 'Safety (non-negotiable)' bullet)"
  critical: "§2 frames the depth rule as 'too shallow to be a real project'. The depth-≤-1 reading
             (= `/` itself OR any path whose parent is `/`) is what `dirname(root) === '/'` encodes.
             The named dirs (/home /etc /usr /var) are ILLUSTRATIVE — the dirname check is comprehensive
             and forbids ANY depth-1 path, not just the named ones. Encode it that way."

# MUST READ — the file being modified (read it FULLY first)
- file: src/snapshot/paths.ts
  why: "The ONLY source file modified. It is pure (only imports node:path today). Existing exports:
        DANGEROUS_DIRS, resolveSafeWorkspacePath, normalizeRelPath, isDangerousWorkspaceRel. The new
        function is the 5th export. Its header docstring (line 9: 'The ONLY import is `node:path`')
        becomes stale once node:os is added — update it (Task 2)."
  pattern: "Mirror the existing JSDoc discipline: every export has a thorough JSDoc citing spec/14 §x,
            stating purity, and listing consumers. The module header comment block (lines 1-23)
            establishes the 'Pi-FREE / PURE / LEXICAL' design contract the new function inherits."
  gotcha: "The module DELIBERATELY keeps config out (DANGEROUS_DIRS is hardcoded; 'paths.ts does NOT
           read config.revert.*'). isForbiddenRoot inherits this — do NOT read any config; the forbidden
           set is the hardcoded predicate above. os.homedir() is allowed (it reads an env var, NOT the
           filesystem) — this keeps the module pure (the research note confirms this explicitly)."

# MUST READ — the test file being modified (append, do not rewrite)
- file: test/paths.test.ts
  why: "Append the new isForbiddenRoot describe block here. The existing file tests the other three
        functions + DANGEROUS_DIRS; mirror its conventions exactly."
  pattern: "vitest `describe`/`it` with lettered (a)/(b)/(c)... cases; import from
            '../src/snapshot/paths.js' (ESM .js convention); `expectTypeOf<...>()` for the type-level
            contract; a header comment citing spec + task id. No beforeEach (no module state)."

# MUST READ — the plan's canonical change inventory + test matrix (authoritative for THIS plan)
- file: plan/009_1ecb4b3cb372/architecture/test_strategy.md
  why: "§'src/snapshot/paths.ts — ADD isForbiddenRoot' is the exact spec for this task (new export,
        new import, logic, purity, JSDoc citation, 'existing code UNCHANGED'). §'test/paths.test.ts —
        ADD isForbiddenRoot cases' is the canonical test matrix to copy verbatim."
  section: "the two paths.ts / test/paths.test.ts tables (lines ~12-21 and ~53-59)"
  critical: "It also documents the DOWNSTREAM consumers (store.ts detectAndCreate, git.ts restore,
             cas.ts restore) — those are SEPARATE subtasks (P1.M1.T2/T3/T4). Do NOT implement them here."

# READ — sibling architecture context (confirms the purity framing)
- file: plan/009_1ecb4b3cb372/architecture/system_context.md
  why: "Frames why detection-safety hardening is milestone P1 (the historical $HOME-wipe regression)."
  section: "the motivation / safety-invariant framing"
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
└── paths.ts        # ← THE file modified: +isForbiddenRoot export, +node:os import, +dirname in node:path, header doc update
test/
└── paths.test.ts   # ← append the isForbiddenRoot describe block
```

### Desired Codebase tree

```bash
src/snapshot/
└── paths.ts        # MODIFIED (+1 export, +2 import changes, +header doc fix)
test/
└── paths.test.ts   # MODIFIED (+1 describe block, +1 type-level assertion; existing blocks unchanged)
```
No new files.

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — os.homedir() is pure-ish (reads an env var, NOT the fs), so the module stays PURE.
// The module header explicitly promises "No fs.*, no network, no module-scoped mutable state" and
// "Pi-FREE". Adding `import { homedir } from "node:os"` does NOT violate this — homedir() reads
// process.env.HOME / USERPROFILE, never touches disk. This is confirmed in the work-item research note
// and the plan's test_strategy.md ("Purity: Pure string predicate, no fs, no Pi"). Do NOT add any
// node:fs import here (realpath lives in the BACKENDS, out of scope — see paths.ts line 17/45).

// GOTCHA #2 — the module header (paths.ts line 9) currently says: "The ONLY import is `node:path`".
// After this change that sentence is FALSE (node:os is also imported). UPDATE it (Task 2) to e.g.:
//   "Pi-FREE + project-module-FREE. The ONLY imports are `node:path` + `node:os` (`homedir`, for the
//    forbidden-root predicate — pure: reads an env var, not the fs)."
// Leaving it stale is a doc/code contradiction a reviewer will flag.

// GOTCHA #3 — dirname("/") === "/" on POSIX (path.posix), so condition (c) would also catch "/", but
// condition (b) (`root === "/"`) catches it first. Order is irrelevant (any-true `||`). And
// dirname(".") === "." (NOT "/"), so "." is NOT caught by (c) — that is exactly why the defensive
// condition (d) (`root === "."`) exists. Do NOT rely on dirname to catch "." or "".

// GOTCHA #4 — the input is assumed CANONICALIZED (the realpath of the workspace root — a resolved,
// no-trailing-slash, no-`..` absolute path). Do NOT normalize inside isForbiddenRoot (no resolve/trim).
// Callers (detectAndCreate, restore) pass `realpathSafe(cwd)` (P1.M1.T2/T3/T4). If you normalize here
// you'd diverge from the contract and hide caller bugs. The predicate is pure string comparison only.

// GOTCHA #5 — POSIX orientation is BY DESIGN (the contract is `dirname(root) === "/"`).
// On Windows: os.homedir() → `C:\Users\<user>` so (a) still catches the home; but `C:\` / `C:\Windows`
// are NOT caught by (b)/(c) (`root === "/"` is false; `dirname("C:\\") === "C:\\"` ≠ "/"). This is a
// DOCUMENTED limitation, not a defect — the spec's named examples are all POSIX and the contract is
// explicit. Do NOT "improve" it to cross-platform drive-letter handling without a spec change (that
// would silently broaden what this safety gate refuses). Note it in the JSDoc and move on.

// GOTCHA #6 — depth-2 NON-home paths are ALLOWED by design, even system-y ones.
// `"/etc/foo"` → dirname === "/etc" ≠ "/" → (c) false; not home; not "/"; not empty/dot → FALSE.
// `"/opt/foo"`, `"/usr/local/x"` → also false. This matches spec §2's "too shallow = depth ≤ 1":
// only `/` (depth 0) and depth-1 dirs are auto-forbidden; a depth-≥-2 path is plausibly a real project.
// (A real project literally inside /etc is vanishingly rare; the predicate errs toward the documented
// depth rule rather than a maintainer-curated allow/deny list.) Encode exactly this; do NOT add an
// ad-hoc denylist of system subtrees.

// GOTCHA #7 — the existing exports and their tests are SACROSANCT.
// Adding isForbiddenRoot must not change resolveSafeWorkspacePath / normalizeRelPath /
// isDangerousWorkspaceRel / DANGEROUS_DIRS. The new describe block in paths.test.ts is APPENDED; the
// existing describe blocks are untouched. If `npm test` shows a pre-existing-paths-test failure, it is
// NOT caused by this change (this change only ADDS) — investigate separately.

// GOTCHA #8 — import ORDER / ESM convention.
// paths.ts currently has exactly one import line. After the change there are two. Keep `node:*` imports
// grouped; the codebase convention (see settings.ts) is `node:fs`/`node:path` grouped together. Place
// `import { homedir } from "node:os";` immediately after the `node:path` line. Add `dirname` to the
// EXISTING destructure (do not add a second `from "node:path"` line): 
//   `import { resolve, relative, isAbsolute, sep, dirname } from "node:path";`
```

## Implementation Blueprint

### Data models and structure

No data model — a pure boolean predicate. No interface/class/type additions (the type is the inline
`boolean` return; no exported `ForbiddenReason` enum or similar — the contract is a bare boolean, and
downstream callers branch on the boolean).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/paths.ts — imports
  - EDIT the existing `node:path` import to add `dirname`:
      BEFORE: import { resolve, relative, isAbsolute, sep } from "node:path";
      AFTER:  import { resolve, relative, isAbsolute, sep, dirname } from "node:path";
  - ADD immediately below it:
      import { homedir } from "node:os";
  - WHY: homedir() for condition (a); dirname() for condition (c). Both Node built-ins; module stays
    Pi-free + pure (GOTCHA #1).
  - GOTCHA #8 (single node:path destructure, no second from-line).

Task 2: MODIFY src/snapshot/paths.ts — fix the now-stale module header docstring
  - LOCATE line 9: ` * - Pi-FREE + project-module-FREE. The ONLY import is \`node:path\` (GOTCHA #1). ...`
  - UPDATE to reflect node:os, e.g.:
      ` * - Pi-FREE + project-module-FREE. The ONLY imports are \`node:path\` + \`node:os\` (\`homedir\`,`
      ` *   for the forbidden-root predicate — pure: reads an env var, not the fs; GOTCHA #1). This`
      ` *   module does NOT read \`config.revert.*\` ...` (keep the rest of that bullet intact).
  - OPTIONAL (low-risk): in the "Consumers:" bullet (~line 20), append one sentence noting
    isForbiddenRoot is ALSO consumed by detectAndCreate + both restore() guards (P1.M1.T2/T3/T4) at the
    ROOT level (a one-shot gate, distinct from the per-path normalizeRelPath→isDangerous→resolve flow).
    If the existing bullet is already accurate about the per-path flow, a brief addition suffices.
  - WHY: a stale "ONLY import is node:path" claim directly contradicts the new import (GOTCHA #2).

Task 3: MODIFY src/snapshot/paths.ts — add the isForbiddenRoot export
  - PLACEMENT: as the 5th export, AFTER isDangerousWorkspaceRel (the file's last function). Add a clear
    section break comment is OPTIONAL (the existing file has none — each export is just JSDoc+func);
    match that style (no `// ──` separators) to stay consistent.
  - IMPLEMENT (this exact body; JSDoc below it):

      /**
       * Forbidden workspace-root predicate — the lexical floor of the spec/14 §2 SAFETY INVARIANT.
       * Returns true for a resolved (canonicalized) workspace root that the snapshot subsystem must
       * NEVER capture into or restore files into, because a wholesale working-tree restore there would
       * be catastrophic. spec/14 §2 SAFETY INVARIANT + §10 (testing safety clause).
       *
       * TRUE iff ANY of (any-true; order is cosmetic):
       *   (a) root === os.homedir()       — the user's home (typically depth-2, e.g. /home/<user>);
       *                                     caught explicitly because the depth-1 check below does not.
       *   (b) root === "/"                — the filesystem root (depth 0).
       *   (c) dirname(root) === "/"       — ANY depth-1 system dir: /home /etc /usr /var /bin /sbin
       *                                     /opt /tmp /root … (spec §2's "too shallow to be a real
       *                                     project" = depth ≤ 1; the named dirs are illustrative —
       *                                     this check is comprehensive and forbids ALL depth-1 paths).
       *   (d) root === "" || root === "." — defensive: degenerate / non-canonical input.
       * FALSE for any depth-≥-2, non-home path (a plausibly-real project root). Note: a depth-2
       * non-home path under a system dir (e.g. "/etc/foo") is ALLOWED by this depth rule by design.
       *
       * PURE — no fs, no network, no module state, no config. os.homedir() reads an env var, not the
       * filesystem, so this module's purity promise (header GOTCHA #1) holds. POSIX-oriented by design:
       * `dirname(root) === "/"` is the POSIX depth-1 test; on Windows the home is still caught by (a)
       * but drive-roots (C:\\, C:\\Windows) are not — a documented limitation of this lexical gate (the
       * authoritative containment is the backends' fs.realpathSync complement; see paths.ts GOTCHA #11).
       *
       * Consumers (P1.M1 detection-safety hardening): `detectAndCreate` (store.ts, P1.M1.T2.S1) refuses
       * → NoOp when the root is forbidden; `GitBackend.restore` (git.ts, P1.M1.T3.S2) and
       * `CasBackend.restore` (cas.ts, P1.M1.T4.S1) each re-check at entry and return a refused result
       * with ZERO filesystem mutation — the last line of defense independent of detection (spec/14 §2).
       *
       * @param root an absolute, CANONICALIZED path string — the realpath of the workspace root
       *             (the result of fs.realpathSync(cwd)). Do NOT pass un-resolved cwd.
       * @returns true iff the root is forbidden (home / `/` / depth-1 / degenerate).
       */
      export function isForbiddenRoot(root: string): boolean {
        return (
          root === "" ||            // (d) defensive — degenerate input
          root === "." ||           // (d) defensive — degenerate input
          root === "/" ||           // (b) filesystem root (depth 0)
          dirname(root) === "/" ||  // (c) depth-1 system dir (/home /etc /usr /var …)
          root === homedir()        // (a) the user's home (typically depth-2)
        );
      }

  - NAMING: `isForbiddenRoot` (exact — the downstream tasks import it by this name). snake/camel: the
    module uses camelCase for functions; this matches.
  - GOTCHA #1 (homedir pure), #3 (dirname("/")==="/", dirname(".")==="."), #4 (no normalization),
    #5 (POSIX by design), #6 (depth-2 allowed).
  - DEPENDENCIES: Task 1 (imports) must land first (dirname/homidir must be in scope).

Task 4: MODIFY test/paths.test.ts — append the isForbiddenRoot describe block
  - PLACEMENT: append AFTER the existing "composition" and "types — export contract" describe blocks
    (or just before the final "types" block — either is fine; keep the type test together with the
    function it covers by ADDING an isForbiddenRoot row to the existing "types — export contract" block
    AND a dedicated behavioral describe block). Simplest: one new describe block + extend the type test.
  - HEADER comment: cite spec/14 §2 SAFETY INVARIANT + §10, task P1.M1.T1.S1, and the canonical matrix
    from plan/009 test_strategy.md (mirrors the file's existing header-comment style).
  - IMPLEMENT (verbatim matrix from test_strategy.md lines 53-59 + boundary cases + type assertion):

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
          expect(isForbiddenRoot(".")).toBe(true);  // dirname(".") === "." ≠ "/"
        });

        it("(e) depth-≥-2 NON-home paths → false (plausibly a real project)", () => {
          expect(isForbiddenRoot("/home/user/projects/foo")).toBe(false);
          expect(isForbiddenRoot("/home/dustin/myproject")).toBe(false);
          expect(isForbiddenRoot("/home/dustin")).toBe(false); // depth-2, NOT the home (unless homedir)
          expect(isForbiddenRoot("/opt/foo")).toBe(false);     // depth-2 under a system dir — allowed by design
        });

        it("(f) is pure + deterministic (same input → same output across calls)", () => {
          expect(isForbiddenRoot("/etc")).toBe(isForbiddenRoot("/etc"));
          expect(isForbiddenRoot("/home/dustin/myproject")).toBe(isForbiddenRoot("/home/dustin/myproject"));
        });
      });

  - ADD to the existing "types — export contract" describe block (extend, do not duplicate the import):
      expectTypeOf<Parameters<typeof isForbiddenRoot>>().toEqualTypeOf<[string]>();
      expectTypeOf<ReturnType<typeof isForbiddenRoot>>().toEqualTypeOf<boolean>();
  - IMPORT UPDATE: add `isForbiddenRoot` to the existing destructure from "../src/snapshot/paths.js",
    and add `import { homedir } from "node:os";` at the top of the test file (for the dynamic home case).
    Match the existing import-grouping style.
  - GOTCHA: the (a)/(e) home cases are DYNAMIC — use homedir(), never a hardcoded "/home/dustin"
    (the CI/home path varies). The "/home/dustin" literal in (e) is fine ONLY as a non-home depth-2
    example on a machine whose homedir is NOT /home/dustin; if you want it robust on every machine,
    assert it against `homedir()` (e.g. skip or use a path provably ≠ homedir). Simplest robust form:
    pick an absolute depth-2 path that cannot be anyone's home, e.g. "/var/lib/foo" (false). Use the
    literal "/home/dustin/myproject" as the test_strategy.md prescribes, but ALSO add one homedir-proof
    false case ("/var/lib/foo") so the suite is green on any dev box.
  - NAMING: lettered (a)-(f) to match the file's convention.

Task 5: VALIDATE (no code)
  - RUN: `npm run typecheck` (tsc --noEmit). MUST be clean (confirms the import additions + the boolean
    return type + the test's expectTypeOf rows). PRIMARY gate.
  - RUN: `npx vitest run test/paths.test.ts`. The new describe block + the existing blocks all green.
  - RUN: `npm test` (full suite). Confirms the ADDITIVE change broke nothing elsewhere.
```

### Implementation Patterns & Key Details

```typescript
// THE WHOLE CHANGE in one glance (paths.ts, after the existing isDangerousWorkspaceRel):
//
//   import { resolve, relative, isAbsolute, sep, dirname } from "node:path"; // + dirname
//   import { homedir } from "node:os";                                      // NEW
//
//   export function isForbiddenRoot(root: string): boolean {
//     return (
//       root === "" || root === "." ||          // (d) degenerate
//       root === "/" ||                         // (b) fs root
//       dirname(root) === "/" ||                // (c) depth-1 system dir
//       root === homedir()                      // (a) user home
//     );
//   }
//
// WHY each condition exists (memorize before touching it):
//   (b)+(c) together = "depth ≤ 1" = spec §2's "too shallow to be a real project". `/` is depth 0;
//                      any path with parent `/` is depth 1. Together they forbid EVERY depth-0/1 path.
//   (a)       = home is USUALLY depth-2 (/home/<user>), so (c) does NOT catch it → explicit check.
//   (d)       = "" and "." are degenerate; dirname(".") === "." (not "/"), so (c) misses "." → explicit.
//
// NON-GOAL (do NOT do these in S1):
//   - Do NOT touch store.ts detectAndCreate, git.ts, cas.ts, or their tests — those are
//     P1.M1.T2.S1 / P1.M1.T3.S1-2 / P1.M1.T4.S1 (separate subtasks that IMPORT this function).
//   - Do NOT add a realpath/fs import to paths.ts — realpath lives in the BACKENDS (paths.ts line 17/45).
//   - Do NOT read config.revert.* — the forbidden set is the hardcoded predicate (DANGEROUS_DIRS-style).
//   - Do NOT add a ForbiddenReason enum / object return — the contract is a bare boolean.
//   - Do NOT "improve" cross-platform drive-root handling — the contract is `dirname==="/"` (POSIX);
//     broadening it silently changes what this safety gate refuses (GOTCHA #5).
```

### Integration Points

```yaml
CODE (src/snapshot/paths.ts — the ONLY source file changed):
  - imports:  + `dirname` in the node:path destructure; + `import { homedir } from "node:os"`
  - exports:  + `isForbiddenRoot(root: string): boolean` (5th export, after isDangerousWorkspaceRel)
  - docs:     module header line ~9 ("ONLY import is node:path") updated to mention node:os
              (optional: Consumers bullet gains a one-line isForbiddenRoot note)

TESTS (test/paths.test.ts — appended):
  - +1 describe("isForbiddenRoot …") block (lettered a–f, canonical matrix + boundary cases)
  - existing "types — export contract" block extended with 2 expectTypeOf rows for isForbiddenRoot
  - import line extended (+isForbiddenRoot from paths.js; +homedir from node:os)

NO CHANGES TO: src/snapshot/{store,git,cas}.ts, any src/*.ts outside snapshot/paths.ts, any other test.
  The 3 downstream consumers (detectAndCreate / GitBackend.restore / CasBackend.restore) are
  P1.M1.T2.S1 / P1.M1.T3.S2 / P1.M1.T4.S1 — they will import isForbiddenRoot from "./paths.js".
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The single source gate (TS + vitest project; NO ruff/mypy/eslint configured):
npm run typecheck        # = tsc --noEmit (strict, ESNext)
# Expected: zero errors. Confirms: the `dirname`/`homedir` imports resolve; isForbiddenRoot's boolean
# return type-checks; the test's expectTypeOf<Parameters<typeof isForbiddenRoot>>() rows are valid.
# If tsc errors "Cannot find name 'dirname'/'homedir'" → the import edits (Task 1) didn't land.
```

> NOTE: this is a TypeScript + vitest project. `package.json` scripts are `test`, `typecheck`, `smoke`,
> `prepublishOnly`. There is no ruff/mypy/eslint/biome — do not invent lint commands. Use
> `npm run typecheck` for the type gate and `npm test` for the behavioral gate.

### Level 2: Unit Tests (Component Validation)

```bash
# The focused suite (this task's deliverable):
npx vitest run test/paths.test.ts
# Expected: the new isForbiddenRoot describe block is fully green AND the pre-existing
# resolveSafeWorkspacePath / normalizeRelPath / isDangerousWorkspaceRel / composition / types blocks
# remain green (this change is purely ADDITIVE — GOTCHA #7).

# Full suite (catches any accidental cross-file regression from the import/header edits):
npm test                 # = vitest run (all test files)
# Expected: all green. paths.ts has no other consumer that a pure additive export could break.
```

### Level 3: Integration Testing (System Validation)

```bash
# S1 has NO integration test (the integration scenarios F-revert-* that exercise forbidden roots live
# in the DOWNSTREAM subtasks: store.test.ts detectAndCreate($HOME)→none, git.test.ts
# restore()-with-cwd=home→refused, etc. — P1.M1.T2/T3/T4). For a self-contained sanity check that the
# predicate behaves at runtime exactly as the unit tests assert, run it directly:
node --input-type=module -e "
  const { isForbiddenRoot } = await import('./src/snapshot/paths.js');
  const { homedir } = await import('node:os');
  console.log('home   :', isForbiddenRoot(homedir()), '(expect true)');
  console.log('/      :', isForbiddenRoot('/'), '(expect true)');
  console.log('/etc   :', isForbiddenRoot('/etc'), '(expect true)');
  console.log('/opt/foo:', isForbiddenRoot('/opt/foo'), '(expect false)');
  console.log(\"''     :\", isForbiddenRoot(''), '(expect true)');
"
# Expected: true / true / true / false / true. (This is OPTIONAL — the vitest block is authoritative.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the additive change did not alter the OTHER exports (diff hygiene):
git diff src/snapshot/paths.ts
# Expected: the diff shows ONLY (1) the two import-line edits, (2) the header-docstring line edit,
# (3) the new isForbiddenRoot function + its JSDoc. It must NOT touch resolveSafeWorkspacePath,
# normalizeRelPath, isDangerousWorkspaceRel, or DANGEROUS_DIRS. If it does, revert that hunk (GOTCHA #7).

# Adversarial: confirm purity holds — no fs touched even for weird input (the function must not throw
# or stat for a non-existent path, because it never touches the fs):
node --input-type=module -e "
  const { isForbiddenRoot } = await import('./src/snapshot/paths.js');
  console.log(isForbiddenRoot('/this/does/not/exist'));   // false (depth-2, not home) — no throw, no stat
  console.log(isForbiddenRoot(undefined));                 // type-error at compile; at runtime: false-ish?
"
# NOTE: isForbiddenRoot(undefined) is a TYPE error (param is `string`), not a runtime case the contract
# covers. Do not add runtime guards for it; tsc enforces the `string` param. (If a caller could pass
# undefined, THAT caller has a bug — the contract says pass realpath(cwd), always a string.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (imports resolve; boolean return; expectTypeOf rows valid).
- [ ] `npx vitest run test/paths.test.ts` green (new block + all pre-existing blocks).
- [ ] `npm test` (full suite) green — zero regressions from the additive change.

### Feature Validation

- [ ] `isForbiddenRoot(os.homedir())` → true; `"/"` → true; `"/home"`/`"/etc"`/`"/usr"`/`"/var"` → true.
- [ ] `""` → true; `"."` → true (defensive, NOT caught by dirname — GOTCHA #3).
- [ ] `"/home/user/projects/foo"` → false; `"/home/dustin/myproject"` → false; a homedir-proof depth-2
      path (e.g. `"/var/lib/foo"`) → false (so the suite is green on any machine).
- [ ] The predicate is pure (no fs/network/state) and deterministic.
- [ ] Depth-1 catch-all works for NON-named dirs too (e.g. `"/srv"` → true) — confirms (c) is comprehensive.
- [ ] Depth-2 non-home allowed by design (`"/opt/foo"` → false — GOTCHA #6).

### Code Quality Validation

- [ ] Function placed as the 5th export after isDangerousWorkspaceRel; matches the file's JSDoc style.
- [ ] JSDoc cites `@spec/14 §2 SAFETY INVARIANT` + `§10` and states the exact (a)/(b)/(c)/(d) predicate.
- [ ] JSDoc names the 3 downstream consumers (detectAndCreate / GitBackend.restore / CasBackend.restore).
- [ ] Module header line ~9 no longer claims "ONLY import is node:path" (GOTCHA #2).
- [ ] Existing exports + their tests are byte-identical (GOTCHA #7); change is purely additive.

### Documentation & Deployment

- [ ] No user-facing/config/API surface change (no new config knob; no new tool param).
- [ ] No README change in S1 (P1.M2.T2 owns the changeset-level safety paragraph — Mode B docs).

---

## Anti-Patterns to Avoid

- ❌ Don't touch `store.ts`/`git.ts`/`cas.ts` or their tests — those downstream consumers are
  P1.M1.T2.S1 / P1.M1.T3.S2 / P1.M1.T4.S1. S1 lands the predicate + its unit tests ONLY.
- ❌ Don't add `node:fs` / `realpathSync` to paths.ts — realpath is the BACKENDS' job (paths.ts lines
  17/45 explicitly defer it). isForbiddenRoot is pure string math + homedir() (an env-var read).
- ❌ Don't read `config.revert.*` — the forbidden set is hardcoded (mirrors DANGEROUS_DIRS; paths.ts is
  config-free by design).
- ❌ Don't return an object/enum/reason — the contract is a bare `boolean`. Downstream callers branch
  on the boolean; a richer return would force all three consumers to change shape.
- ❌ Don't "fix" Windows drive-roots (C:\\, C:\\Windows) — the contract is `dirname==="/"` (POSIX); the
  spec's examples are all POSIX and broadening the gate silently changes safety semantics (GOTCHA #5).
- ❌ Don't normalize the input (no `resolve`/trim) — the contract is canonicalized realpath in, boolean
  out. Normalizing would hide caller bugs (GOTCHA #4).
- ❌ Don't add a system-subtree denylist (/usr/*, /etc/*) — depth-2 non-home is ALLOWED by the spec's
  "too shallow = depth ≤ 1" rule (GOTCHA #6). An ad-hoc list would drift from the documented invariant.
- ❌ Don't forget the header-docstring fix (Task 2) — "ONLY import is node:path" becomes a lie otherwise.
- ❌ Don't hardcode a home path in the test — use `homedir()` dynamically (varies per machine/CI).

---

## Confidence Score: 10/10

**Why 10**: This is a ~6-line pure function whose exact logic, exact imports, exact JSDoc citations,
and exact unit-test matrix are all prescribed verbatim by (a) the work-item contract, (b) the plan's own
`test_strategy.md` (lines 12-21 + 53-59), and (c) spec/14 §2/§10. The target file is read, the test
patterns are read, the consumers are documented, and every gotcha (POSIX scoping, dirname edge cases,
purity of homedir, additive-only change) is enumerated. There is no design decision left to the
implementer's discretion — only transcription + the two mechanical edits + the appended test block.

**Residual risk**: effectively nil for S1 in isolation. The one thing that could trip a careless
implementer is the stale header-docstring (GOTCHA #2) or a hardcoded-home test case (Task 4 GOTCHA) —
both are called out explicitly. Behavioral correctness is fully pinned by the unit tests; downstream
correctness (that the consumers actually CALL it) is the separate subtasks' concern.