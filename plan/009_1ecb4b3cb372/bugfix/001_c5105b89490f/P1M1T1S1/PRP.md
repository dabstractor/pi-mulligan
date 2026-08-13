---
name: "P1.M1.T1.S1 — GitBackend: add `stat` DI seam + maxFileBytes size guard in restore() delete step (closes the BUG-001 R1 note-write-failure data-loss window)"
description: >
  Add a defense-in-depth restore-time size guard to GitBackend.restore()'s delete-created-files step
  that spares any delete-candidate whose CURRENT byte size exceeds `cfg.revert.maxFileBytes`,
  INDEPENDENT of the best-effort oversize git note. The already-landed spare-Set fix (git.ts:869/887)
  only spares files the note recorded; if the note WRITE failed at capture (silently swallowed by the
  try/catch), restore reads no note → result.skipped empty → spare Set empty → `git ls-files --others`
  lists the pre-existing oversize file → `unlink` → irreversible data loss (R1). This guard closes
  that window: a leftover span-created large file is recoverable (manual rm); a deleted pre-existing
  file is not — so uncertainty is encoded as a conservative spare. Purely additive; no existing test
  should need modification.
---

## Goal

**Feature Goal**: `GitBackend.restore(beforeRef, {deleteCreatedFiles:true})` NEVER unlinks a
delete-candidate whose current size exceeds `cfg.revert.maxFileBytes`, even when the oversize git
note is absent (write-failed at capture). The spared path is surfaced (deduped) in
`RestoreResult.skipped` so the rewind success text reports the incomplete revert.

**Deliverable** (all in `src/snapshot/git.ts` + one regression test in `test/git.test.ts`):
1. `GitBackendDeps.stat?: (path: string) => Promise<{ size: number }>` — optional DI seam.
2. `import { ..., stat as fsStat } from "node:fs/promises";` (added to the existing import block).
3. `private readonly stat: (path: string) => Promise<{ size: number }>;` field + constructor
   assignment `this.stat = deps?.stat ?? fsStat;` (mirroring the existing `this.unlink` line).
4. A best-effort size guard in restore() step (c) delete loop, nested inside the existing try,
   immediately after `const abs = resolveSafeWorkspacePath(this.repoRoot, rel);` and before
   `await this.unlink(abs);` (see GOTCHA #1 for why the guard sits AFTER `abs`, not literally
   after `spare.has`).
5. One KEY regression test in `test/git.test.ts` (the linchpin): note-show fails + injected stat
   fake → big.bin spared, new.ts deleted, big.bin in `skipped`, not in `unlinked`.

**Success Definition**:
- The regression test FAILS without the guard (big.bin unlinked because the empty note → empty
  spare Set) and PASSES with it (big.bin spared + surfaced).
- Every existing test in `test/git.test.ts` (and the full `npm test` suite) stays green with
  ZERO modifications — the guard is transparent to existing fakes (stat ENOENT on `/fake/cwd/...`
  paths is swallowed → falls through to the existing unlink path).
- `npm run typecheck` (tsc --noEmit) clean.
- `GitBackendDeps.stat` is optional → production construction (which omits it) uses real
  `node:fs/promises.stat`; backward-compatible.

## Why

- **Closes R1 (HIGH-severity, irreversible data loss).** The spare-Set fix (commit `ec5ad32`,
  git.ts:869/887) treats "did the oversize note arrive?" as the trust signal — but the note is
  best-effort (try/catch-swallowed at capture ~418-432). If its write fails (notes machinery
  unavailable, disk error, ref-lock contention, shadow-repo corruption), the transport is broken
  and the spare Set is empty by construction; a pre-existing `pnpm-lock.yaml` / large
  `package-lock.json` / vendored binary / big `.env` (all routinely > 256 KB) is `unlink`-ed.
- **Deletion safety must NOT depend on a best-effort side channel.** The deterministic, local,
  independent size check makes "spare oversize" the default regardless of note health.
- **Encodes uncertainty conservatively.** When the note is absent we cannot distinguish
  "pre-existing oversize" from "span-created large file" — the only safe action in that state is
  to NOT delete (a leftover large file is recoverable; a deleted one is not).
- **Additive + non-disruptive.** The DI seam is optional; existing tests inject no `stat` →
  production `fsStat` → ENOENT on fake paths → swallowed → existing unlink behavior. The feature
  ships behind the existing `allowDeleteCreatedFiles` + per-call `deleteCreatedFiles` two-flag gate;
  no new config, CLI flag, env var, or public API.

## What

### Behavior
In `GitBackend.restore()` step (c) (the `git ls-files --others` → unlink loop), for each
delete-candidate `rel` that survives the existing `isDangerousWorkspaceRel` + `spare.has(rel)`
guards, AFTER resolving `abs`, `stat(abs)` is consulted (best-effort). If `st.size >
cfg.revert.maxFileBytes`, `rel` is appended to `result.skipped` (deduped) and the candidate is
SPARED (`continue`). If `stat` throws (ENOENT / inaccessible), size is unknown → fall through to
the normal unlink attempt (whose own try/catch handles ENOENT as a silent skip).

### Success Criteria
- [ ] `GitBackendDeps` has an optional `stat?: (path: string) => Promise<{ size: number }>` field.
- [ ] `stat as fsStat` is imported from `node:fs/promises` and wired as the production default.
- [ ] restore() step (c) spares any delete-candidate whose `stat(abs).size > cfg.revert.maxFileBytes`,
      appending it (deduped) to `result.skipped`, independent of the note.
- [ ] A thrown `stat` (ENOENT/inaccessible) is swallowed and falls through to unlink (no behavior
      change for missing files).
- [ ] The regression test (note-show fails + stat fake) PASSES; it FAILS on the pre-fix code.
- [ ] `npm run typecheck` + `npm test` green; zero existing tests modified.
- [ ] `GitBackendDeps.stat` is optional (production omits it) — backward-compatible.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
current code of restore() step (c) (lines 861–905), the GitBackendDeps interface (104–122), the
constructor field/assignment pattern (231–272), the test-helper signatures (`makeExec`, `makeBackend`,
`makeBackendWithUnlink`), and the precise regression-test scenario (with a hand-walked trace showing
it fails-without/passes-with the guard) are all below.

### Documentation & References

```yaml
# MUST READ — the authority for the residual gap + the exact fix direction
- file: plan/009_1ecb4b3cb372/bugfix/001_c5105b89490f/architecture/residual_risk_analysis.md
  why: "§ R1 (the note-write-failure window) + 'Fix Direction — GitBackend' (the exact 3-step
        implementation: DI seam field, fsStat import/assignment, the size-guard snippet). Also
        § 'Regression Test Spec' (the exact test setup + assertions). This task implements that
        spec line-for-line."
  critical: "§ R1 'Why the existing spare-Set fix does NOT close this' — the note is the SOLE
             transport for oversize paths in the git backend; if its write fails the spare Set is
             empty by construction. The size guard is independent of the note. Also § 'CAS contrast'
             explains why this task targets GitBackend only (CAS's manifest IS the ref; CAS gets a
             separate belt-and-suspenders guard in P1.M1.T1.S2, NOT this task)."

# MUST READ — the file being modified (read restore() step (c) + GitBackendDeps + constructor first)
- file: src/snapshot/git.ts
  why: "The ONLY source file modified. restore() step (c) is at ~lines 861-905 (the `git ls-files
        --others` loop). GitBackendDeps is at 104-122. The private fields are at 231-237. The
        constructor assignment `this.unlink = deps?.unlink ?? fsUnlink;` is at 272 (the template
        for `this.stat`). The node:fs/promises import block is at lines 6-10."
  pattern: "DI-seam pattern to copy VERBATIM: `unlink` is declared as `unlink?: (path: string) =>
            Promise<void>` in GitBackendDeps (119), `private readonly unlink: ...` field (237),
            `this.unlink = deps?.unlink ?? fsUnlink` (272). `stat` follows the identical 3-point
            pattern (interface field → private field → constructor assignment)."
  gotcha: "#1 (abs scope) + #2 (throwOn typing) + #3 (stat ENOENT transparency) below — these are
           the non-obvious failure points."

# MUST READ — the test file (read makeExec / makeBackendWithUnlink / ExecCanned first)
- file: test/git.test.ts
  why: "Add the regression test here + extend makeBackendWithUnlink with an OPTIONAL stat param
        (backward-compat). makeExec (~66) documents the ExecCanned shape (throwOn REQUIRES a `call`
        number — GOTCHA #2). makeBackendWithUnlink (~100) is the helper to extend."
  pattern: "Existing delete tests use makeBackendWithUnlink(calls, unlinked, cfg, canned) and assert
            on the `unlinked` array. The new test adds a 5th `stat` arg + asserts on result.deleted /
            result.skipped / unlinked."
  critical: "ExecCanned.throwOn is `{ cmd: string; call: number }` (NOT `{ cmd }`). The work-item's
             shorthand `throwOn:{cmd:'notes'}` is imprecise — it will NOT type-check. Use
             `throwOn: { cmd: 'notes', call: 1 }`. See GOTCHA #2."

# CONTEXT — confirms the BUG-001 primary fix already landed (DO NOT re-implement it)
- file: src/snapshot/git.ts
  why: "Lines 869 (`const spare = new Set(result.skipped)`) and 887 (`if (spare.has(rel)) continue`)
        are the ALREADY-LANDED spare-Set fix. This task's guard is ADDITIVE and runs in the same
        loop, AFTER spare.has. Do NOT touch the spare Set — it is the note-dependent first defense;
        the size guard is the note-independent second defense."

# CONTEXT — the bug-hunt finding (the original BUG-001 description + repro)
- file: plan/009_1ecb4b3cb372/bugfix/001_c5105b89490f/prd_snapshot.md
  why: "Issue 1 (BUG-001) documents the original data-loss mechanism + the real-filesystem repro.
        The primary fix (spare Set) closed the happy-path note-present case; this task closes the
        residual note-ABSENT case (R1). Read only if you need the full original rationale."
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
└── git.ts            # ← THE source file: +stat to GitBackendDeps, +fsStat import, +field/+ctor assignment,
                      #   +size guard in restore() step (c) delete loop (after spare.has, nested in the try)
test/
└── git.test.ts       # ← extend makeBackendWithUnlink (optional stat) + add the R1 regression test
```
No new files. CasBackend's parallel guard is a SEPARATE task (P1.M1.T1.S2).

### Desired Codebase tree

```bash
src/snapshot/
└── git.ts            # MODIFIED: GitBackendDeps.stat, fsStat import, private stat field + ctor wiring,
                      #   restore() step (c) nested size guard
test/
└── git.test.ts       # MODIFIED: makeBackendWithUnlink gains optional `stat` (5th arg, default undefined),
                      #   + one new `it(...)` regression case in the restore/delete describe block
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 — the size guard needs `abs`, which is declared INSIDE the existing try.
// The work-item says "insert IMMEDIATELY AFTER `if (spare.has(rel)) continue;` (git.ts:887)". But
// `abs` (the absolute path the guard must stat) is NOT in scope at line 887 — it is the FIRST line
// of the try block just below (`const abs = resolveSafeWorkspacePath(this.repoRoot, rel);`).
// The work-item's snippet `try { const st = await this.stat(abs); ... }` therefore assumes `abs` is
// already computed. The CLEAN, minimal-diff fix is to NEST the size guard INSIDE the existing try,
// immediately after `const abs = ...` and before `await this.unlink(abs)`:
//
//     try {
//       const abs = resolveSafeWorkspacePath(this.repoRoot, rel);   // existing line (can throw on escape)
//       // [BUG-001 R1] defense-in-depth size guard — independent of the note
//       try {
//         const st = await this.stat(abs);
//         if (st.size > this.cfg.maxFileBytes) {
//           if (!result.skipped.includes(rel)) result.skipped.push(rel);  // dedup
//           continue;   // SPARE — legal inside a nested try within a for-loop (skips to next rel)
//         }
//       } catch { /* ENOENT/inaccessible → size unknown → fall through to unlink (its try/catch handles ENOENT) */ }
//       await this.unlink(abs);                                       // existing line
//       result.deleted.push(rel);                                     // existing line
//     } catch (e) {                                                   // existing catch
//       const code = (e as NodeJS.ErrnoException)?.code;
//       if (code !== "ENOENT") result.failed.push(rel);
//     }
//
// WHY this is correct: `continue` inside the nested try has no `finally`, so it propagates straight
// to the for-loop (skipping `await this.unlink(abs)`); the OUTER catch does NOT run (no exception).
// resolveSafeWorkspacePath's escape-throw is still caught by the outer catch (→ failed[]), unchanged.
// This is the smallest diff that keeps `abs` in scope AND preserves the existing escape handling.
// (Rejected alt: hoisting `abs` above spare.has requires 3 separate try blocks + duplicating the
// escape-catch — more invasive, no benefit.)

// CRITICAL GOTCHA #2 — ExecCanned.throwOn REQUIRES a `call` number; the work-item shorthand won't type-check.
// test/git.test.ts ExecCanned is `throwOn?: { cmd: string; call: number }` and makeExec throws ONLY on
// the Nth matching call (`if (throwCounts[cmd] === canned.throwOn.call) throw`). The work-item's
// `throwOn:{cmd:'notes'}` is missing `call` → TS error. Use `throwOn: { cmd: "notes", call: 1 }`.
// IMPORTANT: the regression test calls `backend.restore("BEFORE1", …)` DIRECTLY — it does NOT call
// capture(). So there is exactly ONE `git notes` call (restore step a.5's `notes … show BEFORE1`),
// and `call: 1` makes THAT call throw → caught by restore's try/catch → result.skipped stays empty
// → spare Set empty → (without the guard) big.bin would be unlinked. That is the empty-spare
// precondition R1 describes. You do NOT need to make capture's note-add fail (capture isn't called).

// GOTCHA #3 — the guard is TRANSPARENT to existing tests (the "no existing test modification" guarantee).
// Existing delete tests call makeBackend / makeBackendWithUnlink with NO stat arg → stat defaults to
// undefined → GitBackend uses real fsStat. They use fake paths ("/fake/cwd/…") that do not exist on
// disk, so `await this.stat(abs)` throws ENOENT → caught by the nested catch → falls through to the
// existing unlink path (the recording fake records the path; or production fsUnlink throws ENOENT →
// caught by the outer catch → silent ENOENT skip). Either way the recorded `unlinked` / result.deleted
// are IDENTICAL to pre-guard behavior. Verify with: `npx vitest run test/git.test.ts` — ZERO failures,
// ZERO modifications to existing tests.

// GOTCHA #4 — stat() on a path vs unlink() on a path: both take `abs` (the resolveSafeWorkspacePath
// result). The injected stat fake in the test matches on `p.endsWith("big.bin")` because `abs` is
// "/fake/cwd/big.bin". Do NOT match on the bare rel "big.bin" (stat receives the ABS path).

// GOTCHA #5 — dedup the skipped push. The spare Set already spares paths present in result.skipped
// (the note path). The size guard can ALSO push to result.skipped. Use
// `if (!result.skipped.includes(rel)) result.skipped.push(rel);` so a path that is BOTH note-skipped
// AND oversize isn't double-counted (the rewind success text counts skipped.length). In the regression
// test the note is absent so there's no duplicate, but the dedup is correct defense-in-depth.

// GOTCHA #6 — production stat is node:fs/promises.stat (async, returns {size,...}). NOT fs.statSync.
// Import as `stat as fsStat` (the `as` alias matches the existing `unlink as fsUnlink` / `rm as fsRm`
// convention so the production-default reads `deps?.stat ?? fsStat`). The DI type is
// `(path: string) => Promise<{ size: number }>` — a structural subset of fsStat's real signature
// (fs.stat returns Stats, which has .size; the narrower type keeps the fake minimal).

// GOTCHA #7 — scope: GitBackend ONLY. Do NOT touch cas.ts (its belt-and-suspenders guard is
// P1.M1.T1.S2 — a DIFFERENT subtask that uses walkTree's already-computed `st`, no DI seam needed).
// Do NOT touch store.ts, paths.ts, config.ts, or the rewind tool. Do NOT change RestoreResult's shape
// (skipped is an existing string[] bucket). Do NOT add config (maxFileBytes already exists at
// config.ts:108/210 default 262144).
```

## Implementation Blueprint

### Data models and structure

No new data model. `RestoreResult.skipped: string[]` already exists (the 5-bucket outcome). The only
type addition is the `stat` field on the existing `GitBackendDeps` interface (an optional DI seam).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/git.ts — add the `stat` DI seam (import + interface + field + constructor)
  - IMPORT (lines 6-10, the node:fs/promises block): add `stat as fsStat,` alongside the existing
    `unlink as fsUnlink,` / `rm as fsRm,`. Result is one named-import block:
        import {
          rm as fsRm,
          stat as fsStat,
          unlink as fsUnlink,
        } from "node:fs/promises";
    (Preserve whatever other members the block currently has; the only ADDITION is `stat as fsStat,`.)
  - INTERFACE (GitBackendDeps, ~line 122, immediately AFTER the `unlink?` field + its JSDoc): add
        /**
         * Default: node:fs/promises.stat. The delete-created-files step in restore() calls this to
         * enforce a defense-in-depth maxFileBytes size guard (BUG-001 R1): a delete-candidate whose
         * CURRENT size exceeds cfg.revert.maxFileBytes is SPARED (surfaced in result.skipped) even
         * when the oversize git note is absent (note-write failure at capture). Optional + backward-
         * compatible — production construction omits it → real fsStat. Tests inject a fake to assert
         * the spare path without a real filesystem.
         */
        stat?: (path: string) => Promise<{ size: number }>;
  - PRIVATE FIELD (~line 237, immediately after `private readonly unlink: ...`): add
        private readonly stat: (path: string) => Promise<{ size: number }>;
  - CONSTRUCTOR (~line 272, immediately after `this.unlink = deps?.unlink ?? fsUnlink;`): add
        this.stat = deps?.stat ?? fsStat;
  - FOLLOW pattern: the existing `unlink` DI seam EXACTLY (3 points: interface field → private field
    → ctor `deps?.x ?? fsX`). NAMING: `stat`/`fsStat` (matches unlink/fsUnlink convention).

Task 2: MODIFY src/snapshot/git.ts — add the size guard in restore() step (c) delete loop
  - LOCATE: restore() step (c), the `for (const rel of others ...) { ... }` loop (~lines 880-905).
    The body currently is:
        if (isDangerousWorkspaceRel(rel)) continue;
        if (spare.has(rel)) continue;
        try {
          const abs = resolveSafeWorkspacePath(this.repoRoot, rel);
          await this.unlink(abs);
          result.deleted.push(rel);
        } catch (e) {
          const code = (e as NodeJS.ErrnoException)?.code;
          if (code !== "ENOENT") result.failed.push(rel);
        }
  - EDIT: keep `if (isDangerousWorkspaceRel(rel)) continue;` and `if (spare.has(rel)) continue;`
    UNCHANGED. Inside the try, INSERT the size guard between `const abs = ...` and `await this.unlink`:
        try {
          const abs = resolveSafeWorkspacePath(this.repoRoot, rel);
          // [BUG-001 R1] defense-in-depth size guard — INDEPENDENT of the note (closes the note-write-
          //   failure data-loss window). A delete-candidate whose CURRENT size exceeds maxFileBytes is
          //   SPARED + surfaced (deduped) in result.skipped. When the note is absent we cannot tell
          //   "pre-existing oversize" from "span-created large file"; the only safe action is to NOT
          //   delete (a leftover large file is recoverable; a deleted pre-existing file is not).
          try {
            const st = await this.stat(abs);
            if (st.size > this.cfg.maxFileBytes) {
              if (!result.skipped.includes(rel)) result.skipped.push(rel); // dedup visibility
              continue; // SPARE — legal in a nested try within a for-loop (skips await this.unlink)
            }
          } catch {
            /* ENOENT / inaccessible → size unknown → fall through to the normal unlink attempt
               below; its own try/catch handles ENOENT as a silent skip. */
          }
          await this.unlink(abs);
          result.deleted.push(rel);
        } catch (e) {
          const code = (e as NodeJS.ErrnoException)?.code;
          if (code !== "ENOENT") result.failed.push(rel);
        }
  - GOTCHA #1 (why nested, not after spare.has), #5 (dedup), #6 (fsStat alias).
  - PRESERVE: the spare Set (869) + `spare.has(rel)` (887) UNCHANGED — they are the note-dependent
    first defense; this guard is the note-independent second defense.

Task 3: MODIFY test/git.test.ts — extend makeBackendWithUnlink with an optional `stat` param
  - LOCATE: makeBackendWithUnlink (~line 100). Current signature:
        function makeBackendWithUnlink(calls, unlinked, cfg = BASE_CFG, canned = {}): GitBackend
  - EDIT: add an OPTIONAL 5th param `stat` (default undefined) and pass it into the deps object:
        function makeBackendWithUnlink(
          calls: Call[],
          unlinked: string[],
          cfg: MulliganConfig["revert"] = BASE_CFG,
          canned: ExecCanned = {},
          stat?: (path: string) => Promise<{ size: number }>,   // NEW (BUG-001 R1); undefined → production fsStat
        ): GitBackend {
          const unlink = async (p: string): Promise<void> => { unlinked.push(p); };
          return new GitBackend("/fake/cwd", cfg, null, {
            exec: makeExec(calls, canned),
            scan: emptyScan,
            unlink,
            stat,
          });
        }
  - BACKWARD-COMPAT: existing 4-arg callers pass no stat → undefined → GitBackend uses real fsStat
    (→ ENOENT on fake paths → swallowed → existing unlink behavior). NO existing call site changes.
    (If you instead prefer constructing GitBackend directly in the new test, that is also acceptable —
    but extending the helper is the lower-friction path and keeps the fake-wiring uniform.)

Task 4: CREATE the regression test in test/git.test.ts (the linchpin — place in the restore/delete describe block)
  - ADD this `it(...)` case (find the existing describe that covers restore()/deleteCreatedFiles and
    append; mirror its setup style):
        it("BUG-001 R1: spares an oversize delete-candidate when the oversize note is absent (note-write-failure window)", async () => {
          const calls: Call[] = [];
          const unlinked: string[] = [];
          // stat fake: big.bin is oversize (>256); new.ts is small. `abs` is "/fake/cwd/<rel>".
          const stat = async (p: string): Promise<{ size: number }> =>
            p.endsWith("big.bin") ? { size: 1000 } : { size: 10 };
          const cfg: MulliganConfig["revert"] = {
            ...BASE_CFG,
            allowDeleteCreatedFiles: true,
            maxFileBytes: 256,
          };
          const backend = makeBackendWithUnlink(
            calls,
            unlinked,
            cfg,
            {
              // makeExec's throwOn REQUIRES `call` (GOTCHA #2). restore() is called directly (no
              // capture), so the ONLY `git notes` call is restore step (a.5)'s `notes … show` —
              // call 1. Throwing it → result.skipped stays empty → spare Set empty → (without the
              // guard) big.bin would be unlinked. ls-files lists both candidates.
              throwOn: { cmd: "notes", call: 1 },
              stdoutByCmd: { "ls-files": "big.bin\nnew.ts\n" },
            },
            stat,
          );

          const result = await backend.restore("BEFORE1", {
            revertFileChanges: false,
            deleteCreatedFiles: true,
          });

          // The small span-created file IS deleted; the oversize candidate is SPARED.
          expect(result.deleted).toEqual(["new.ts"]);
          expect(result.deleted).not.toContain("big.bin");
          // The spared oversize path is surfaced for agent visibility.
          expect(result.skipped).toContain("big.bin");
          // The recording unlink fake got new.ts but NOT big.bin.
          expect(unlocked.some((p) => p.endsWith("new.ts"))).toBe(true);
          expect(unlinked.some((p) => p.endsWith("big.bin"))).toBe(false);
        });
  - ASSERTIONS rationale (trace, to confirm it fails-without / passes-with the guard):
      restore("BEFORE1", {revertFileChanges:false, deleteCreatedFiles:true}):
        (a)   read-tree BEFORE1 → makeExec returns "" (not in stdoutByCmd) → no throw. ✓
        (a.5) `notes --ref=refs/mulligan/oversize show BEFORE1` → cmd "notes", call 1 → THROWS →
              caught by restore's try/catch → result.skipped stays []. ✓ (the empty-spare precondition)
        (b)   revertFileChanges:false → diff/checkout step SKIPPED. ✓
        (c)   deleteCreatedFiles && allowDeleteCreatedFiles → enters.
              spare = new Set([]) → empty. ✓
              ls-files --others → stdoutByCmd "big.bin\nnew.ts\n" → candidates ["big.bin","new.ts"].
              rel="big.bin": not dangerous, not in spare. abs="/fake/cwd/big.bin".
                [GUARD] stat→{size:1000}; 1000>256 → push "big.bin" to skipped, continue. SPARED. ✓
              rel="new.ts":  not dangerous, not in spare. abs="/fake/cwd/new.ts".
                [GUARD] stat→{size:10}; 10>256 false → fall through. unlink→unlinked.push. deleted.push. ✓
        result: deleted=["new.ts"], skipped=["big.bin"], unlinked=["/fake/cwd/new.ts"]. ✓
      WITHOUT the guard: rel="big.bin" → (no guard) → unlink→unlinked, deleted=["big.bin","new.ts"],
        skipped=[] → the assertions `deleted==["new.ts"]`, `skipped` contains big.bin, and
        `unlinked` lacks big.bin all FAIL. ✓ Valid regression.

Task 5: VALIDATE (no code)
  - RUN: `npm run typecheck` (tsc --noEmit). MUST be clean (the `stat` field/assignment/optional-param
    all type-check; throwOn `{cmd,call}` is well-typed).
  - RUN: `npx vitest run test/git.test.ts`. MUST be fully green — the new regression case PASSES and
    EVERY existing case still passes with zero modifications (GOTCHA #3).
  - RUN: `npm test` (full suite). MUST be green (no cross-cutting regression).
  - OPTIONAL confidence check (then delete): temporarily comment out the size guard, re-run the new
    test case → it must FAIL (big.bin in deleted/unlinked). Restore the guard. (This proves the test
    is a real regression guard, not a tautology.)
```

### Implementation Patterns & Key Details

```typescript
// THE DI-SEAM PATTERN (copy from `unlink` — 3 points):
//   GitBackendDeps:    stat?: (path: string) => Promise<{ size: number }>;
//   private field:     private readonly stat: (path: string) => Promise<{ size: number }>;
//   constructor:       this.stat = deps?.stat ?? fsStat;
// fsStat is `stat as fsStat` imported from node:fs/promises (same alias style as unlink/fsUnlink).
// The structural type `(path:string) => Promise<{size:number}>` is a NARROW view of fs.stat's real
// Stats return — keeps the test fake minimal ({ size: 1000 }) while the production default is the
// full fs.stat.

// THE GUARD (nested in the existing try, after `const abs`, before `await this.unlink`):
//   try {
//     const st = await this.stat(abs);
//     if (st.size > this.cfg.maxFileBytes) {
//       if (!result.skipped.includes(rel)) result.skipped.push(rel);
//       continue;
//     }
//   } catch { /* fall through to unlink */ }
// KEY: `continue` inside this nested try (no finally) jumps to the next `rel`, skipping unlink. The
// outer catch does not run (no exception). A thrown stat (ENOENT/inaccessible) is swallowed and
// execution falls through to `await this.unlink(abs)` — identical to pre-guard behavior for a
// missing file (the outer catch then handles the unlink ENOENT as a silent skip).

// NON-GOALS (do NOT do these in S1):
//   - Do NOT touch cas.ts (its guard is P1.M1.T1.S2 — uses walkTree's `st`, no DI seam).
//   - Do NOT modify the spare Set / spare.has (the note-dependent first defense — unchanged).
//   - Do NOT change RestoreResult's shape (skipped is an existing bucket).
//   - Do NOT add config / CLI / env / public API (maxFileBytes already exists; stat is an internal
//     DI seam, not a public config — per the work-item DOCS clause: "none").
//   - Do NOT modify any existing test (GOTCHA #3 — the guard is transparent to fake-path fakes).
//   - Do NOT re-implement the spare-Set fix (it already exists at git.ts:869/887).
```

### Integration Points

```yaml
CODE (src/snapshot/git.ts — the ONLY source file changed):
  - imports (6-10):           + `stat as fsStat,` in the node:fs/promises block
  - GitBackendDeps (104-122): + `stat?: (path: string) => Promise<{ size: number }>` (after unlink?)
  - private fields (231-237): + `private readonly stat: (path: string) => Promise<{ size: number }>;`
  - constructor (~272):       + `this.stat = deps?.stat ?? fsStat;` (after this.unlink line)
  - restore() step (c) (~887-905): + nested size-guard try between `const abs = …` and `await this.unlink`

TESTS (test/git.test.ts):
  - makeBackendWithUnlink (~100): + optional 5th param `stat` (default undefined) threaded into deps
  - restore/delete describe:     + one new `it(...)` regression case (note-show fails + stat fake)

NO CHANGES TO: src/snapshot/{cas,store,paths}.ts, src/config.ts, src/tools/*, any other test file,
  RestoreResult/RestoreOpts, the rewind tool, README/spec (P1.M1.T2.S1 owns the Mode-B doc sync).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The single source gate (TS + vitest project; no ruff/mypy/eslint):
npm run typecheck        # = tsc --noEmit (strict, ESNext)
# Expected: zero errors. Watch points: the `stat` field/assignment; the optional 5th param on
# makeBackendWithUnlink; ExecCanned.throwOn `{cmd, call}` (GOTCHA #2 — `{cmd}` alone is a TS error);
# the nested try/`continue` (legal — but if tsc complains, re-check you nested inside the for-loop's
# existing try, not outside it).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The git suite — the new regression case + every existing case (zero modifications expected):
npx vitest run test/git.test.ts
# Expected: ALL green. The new "BUG-001 R1" case PASSES. Existing delete cases UNCHANGED (GOTCHA #3:
# their fake "/fake/cwd/…" paths → real fsStat → ENOENT → swallowed → existing unlink behavior).

# OPTIONAL regression-guard proof (then restore the guard):
#   1. Comment out the size-guard try block in git.ts restore() step (c).
#   2. `npx vitest run test/git.test.ts -t "BUG-001 R1"` → MUST FAIL (big.bin in deleted/unlinked).
#   3. Uncomment the guard. Re-run → PASSES.
# This proves the test is a genuine regression guard, not a tautology.

# Full suite (catches any cross-cutting regression from the restore() change):
npm test                 # = vitest run (all files)
# Expected: all green.
```

### Level 3: Integration Testing (System Validation)

```bash
# S1 has NO new integration test (the unit test with the injected stat fake IS the R1 proof — the
# real-filesystem note-write-failure path is inherently hard to trigger deterministically, which is
# exactly why the unit-level DI seam exists). The existing integration suite must stay green:
npx vitest run test/integration/revert-git.test.ts
# Expected: green. These use real git + small files (note succeeds → spare Set populated → the guard
# is redundant/harmless in the happy path; verify no behavior change).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the additive diff is minimal + the spare Set is untouched:
git diff src/snapshot/git.ts
# Expected hunks: (1) +`stat as fsStat,` import; (2) +`stat?` field in GitBackendDeps; (3) +private
# stat field; (4) +`this.stat = deps?.stat ?? fsStat;`; (5) the nested size-guard try in restore()
# step (c). NO hunk should touch the spare Set (869) or spare.has (887) or the capture note-write.

# Confirm backward-compat: grep production construction sites for GitBackend — they must NOT pass stat:
grep -rn "new GitBackend(" src/
# Expected: every production site omits `stat` (only tests inject it). `deps?.stat ?? fsStat` → real
# fsStat in production.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npx vitest run test/git.test.ts` green — new R1 case passes, all existing cases unmodified.
- [ ] `npm test` (full suite) green.
- [ ] Regression-guard proof: commenting the guard makes the R1 test fail (Level 2 optional step).

### Feature Validation
- [ ] `GitBackendDeps.stat` is optional; production omits it → real fsStat (backward-compatible).
- [ ] restore() step (c) spares any delete-candidate whose `stat(abs).size > cfg.revert.maxFileBytes`,
      appending it (deduped) to `result.skipped`, independent of the note.
- [ ] A thrown `stat` (ENOENT/inaccessible) is swallowed → falls through to unlink (no behavior change).
- [ ] The regression test asserts: deleted===["new.ts"]; big.bin not in deleted; big.bin in skipped;
      new.ts in unlinked; big.bin not in unlinked.

### Code Quality Validation
- [ ] The `stat` DI seam follows the `unlink` 3-point pattern verbatim (interface → field → ctor).
- [ ] The size guard is nested inside the existing try (after `const abs`), using `continue` to spare.
- [ ] The spare Set + `spare.has` are UNCHANGED (the note-dependent first defense).
- [ ] `result.skipped.push(rel)` is deduped (`if (!result.skipped.includes(rel))`).
- [ ] No existing test modified; makeBackendWithUnlink's new `stat` param defaults to undefined.

### Documentation & Deployment
- [ ] No user-facing/config/CLI/env/public-API change (per the work-item DOCS clause: "none").
- [ ] JSDoc on `GitBackendDeps.stat` explains the BUG-001 R1 defense-in-depth purpose + the production
      default (the README/spec safety-guarantee sync is P1.M1.T2.S1, Mode B — NOT this task).

---

## Anti-Patterns to Avoid

- ❌ Don't place the guard BEFORE `const abs` (it needs `abs` to stat) — nest it inside the existing
  try, right after `abs` is computed (GOTCHA #1). Placing it "literally after spare.has" as the
  work-item shorthand implies would reference `abs` out of scope.
- ❌ Don't use `throwOn: { cmd: "notes" }` — ExecCanned.throwOn REQUIRES `{ cmd, call }` (GOTCHA #2).
  Use `{ cmd: "notes", call: 1 }`.
- ❌ Don't call `capture()` in the regression test — `restore("BEFORE1", …)` direct + `throwOn` the
  single notes call is the empty-spare precondition (GOTCHA #2). Calling capture adds nothing.
- ❌ Don't modify the spare Set / `spare.has` / the capture note-write — those are the existing
  first defense; this guard is additive and note-INDEPENDENT.
- ❌ Don't touch cas.ts — its guard is a separate task (P1.M1.T1.S2) using walkTree's `st`.
- ❌ Don't make `stat` a required dep field or add it to production construction sites — it's an
  optional DI seam (backward-compat; production uses real fsStat).
- ❌ Don't skip the dedup on `result.skipped.push` (GOTCHA #5) — a path both note-skipped and oversize
  must not be double-counted (the success text counts skipped.length).
- ❌ Don't add a real-filesystem integration test for the note-write-failure path — it's inherently
  non-deterministic; the DI-seam unit test is the correct layer (that's WHY the seam exists).
- ❌ Don't catch the stat throw broadly and `continue` (spare) on it — the contract is: stat failure
  → size UNKNOWN → FALL THROUGH to the normal unlink attempt (whose try/catch handles ENOENT).
  Sparing on stat-failure would spare genuinely-deletable missing files (wrong).

---

## Confidence Score: 9/10

**Why high**: The fix is a small, additive, well-specified change to ONE file with a verbatim DI-seam
pattern to copy (`unlink`). The residual_risk_analysis.md prescribes the exact 3-step implementation +
the exact regression-test spec. I hand-walked the restore() trace for the test and confirmed it
fails-without / passes-with the guard. The "no existing test modification" guarantee holds because
existing fakes use non-existent `/fake/cwd/…` paths → real fsStat → ENOENT → swallowed → existing
unlink behavior (GOTCHA #3).

**Residual risk (the 1 point)**: the exact loop restructure (nesting the guard inside the existing try
after `const abs`) is the one place the work-item's "immediately after spare.has" shorthand diverges
from the code's real `abs`-scope — GOTCHA #1 gives the exact corrected placement + the `continue`-in-
nested-try reasoning, and the `npm run typecheck` + optional regression-guard-proof (Level 2) confirm
it. The ExecCanned.throwOn `{cmd,call}` typing (GOTCHA #2) is the other sharp edge; both are flagged
with the exact fix.