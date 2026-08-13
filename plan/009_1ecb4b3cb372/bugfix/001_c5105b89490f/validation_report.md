# Validation Report — pi-mulligan (v1.2 working-tree revert)

**Date:** 2025-08-13
**Validator:** automated + manual analysis (real-filesystem reproduction)
**Scope:** Full codebase, with **special focus on PRD BUG-001** — the alleged critical defect where `delete_created_files` was claimed to irreversibly delete pre-existing files exceeding `revert.maxFileBytes` (violating spec/14 §2 guarantee #4: *"delete_created_files only deletes files the span created"*).

---

## TL;DR — VERDICT: PASS (0 issues)

**The PRD's BUG-001 is already fixed in this codebase.** Independent verification — including a fresh real-filesystem reproduction that drives the **actual** `GitBackend` and `CasBackend` through `detectAndCreate → capture → restore` (no test fakes, no `run()` pipeline) — confirms a pre-existing file larger than `maxFileBytes` **survives** a `delete_created_files` restore in **both** backends. The fix implements **two independent layers** exactly as spec/14 §3 guarantee #4 requires, and the full test suite is green.

This repository is the **post-fix "state-reset"** state: the fix code, the amended spec, and the `F-revert-delete-oversize` regression tests are all present and passing.

---

## Verification Methodology

### Phase 1 — Linting
No linter is configured (no `.eslintrc*`, no `.prettierrc*`, no `lint` script in `package.json`). Only `.editorconfig` exists (no automated checker). **Skipped — N/A.**

### Phase 2 — Type Checking
`npx tsc --noEmit` → **exit 0 (clean)**. No type errors.

### Phase 3 — Style Checking
Only `.editorconfig`; no automated style checker. **Skipped — N/A.**

### Phase 4 — Unit + Integration Testing
`npx vitest run` → **31 files, 1411/1411 tests pass** (exit 0). This count is *higher* than the 1394 baseline cited in the PRD — the BUG-001 fix added the `F-revert-delete-oversize` regression tests in both `test/integration/revert-git.test.ts` and `test/integration/revert-cas.test.ts`.

### Phase 5 — End-to-End BUG-001 safety regression (real backends)
A standalone reproduction (`validate.sh` Phase 5) drives the **real** backends on the **real** filesystem via `detectAndCreate → capture → restore`, exactly mirroring the PRD's reproduction steps. **All 5 scenarios pass:**

| # | Scenario | Result |
|---|----------|--------|
| 1 | CAS: pre-existing oversize file (1000 B, cap 256 B) survives `delete_created_files`; genuine span-created file IS deleted | ✅ survives; `span-created.txt` deleted |
| 2 | GIT: same, in a `git init` workspace | ✅ survives; span-created file deleted |
| 3 | CAS **defense-in-depth**: large file *absent from the skip-record* (appeared after capture) is spared by the current-size guard | ✅ survives |
| 4 | GIT **defense-in-depth**: same, oversize note absent | ✅ survives |
| 5 | No over-protection: a *small* span-created file IS still deleted | ✅ deleted |

---

## Detailed Findings — BUG-001 status

**PRD allegation (BUG-001):** `src/snapshot/git.ts` restore step (c) deleted via `git ls-files --others …; unlink(abs)` without consulting the oversize note, and `src/snapshot/cas.ts` restore step (c) deleted via `walkTree(… if (manifest.files[rel]) return; … unlink(abs))` checking only `manifest.files` — so a pre-existing file skipped at capture for exceeding `maxFileBytes` was conflated with a genuine span-created file and `unlink`-ed (irreversible data loss).

**Current state — FIXED.** Both cited locations now contain the complete fix:

**`src/snapshot/cas.ts` (≈ lines 1108–1129)** — the `'cas'`-mode delete walk:
```ts
const spare = new Set(manifest.skipped ?? []);          // (i) skip-record spare
await this.walkTree(this.cwd, excludeSet, async (rel, abs, st) => {
  if (manifest.files[rel]) return;
  if (spare.has(rel)) return;                            // spare pre-existing oversize file
  if (st.size > this.cfg.maxFileBytes) return;           // (ii) BUG-001 defense-in-depth — current size guard
  if (isDangerousWorkspaceRel(rel)) return;
  await this.fs.unlink(abs);
});
```

**`src/snapshot/git.ts` (≈ lines 871–918)** — the `git ls-files --others` delete loop:
```ts
const spare = new Set(result.skipped);                   // (i) oversize-note spare (read at step a.5)
…
if (spare.has(rel)) continue;                            // spare pre-existing oversize file
const st = await this.stat(abs);
if (st.size > this.cfg.maxFileBytes) {                   // (ii) [BUG-001 R1] defense-in-depth
  if (!result.skipped.includes(rel)) result.skipped.push(rel);
  continue;                                              // SPARE
}
await this.unlink(abs);
```

**Two independent layers** satisfy spec/14 §3 guarantee #4:
1. **Skip-record spare** — `manifest.skipped` (CAS) / the `refs/mulligan/oversize` git note read into `result.skipped` (Git). Files recorded oversize at capture are explicitly spared.
2. **Defense-in-depth current-size guard** — any delete-candidate whose *current* size exceeds `maxFileBytes` is spared **independent of the capture record**. This closes the data-loss window the spec calls out: *"deletion safety never depends solely on a best-effort note/manifest that may not have been written (fail-safe: a leftover large file is recoverable, a deleted pre-existing one is not)."* Verified by scenarios 3 & 4 above (skip-record absent → still spared).

The CAS `explicit-paths` mode was never affected (it does not tree-walk; it only deletes `existed:false` manifest entries) and remains correct.

**Regression coverage:** `F-revert-delete-oversize` exists in both `test/integration/revert-git.test.ts` and `test/integration/revert-cas.test.ts` and asserts the pre-existing oversize file survives, the span-created file is deleted, the file is surfaced in `result.skipped`, and (git) the user's `.git` is byte-identical.

### Other safety properties spot-checked (all hold)
- **Git-safety guarantee #1:** every git command in `git.ts` routes through `this.shadowEnv()` (29 call sites). The only `rev-parse` (line 602) is `git rev-parse --verify <ref>` **against the shadow repo**. No `rev-parse --show-toplevel` / `--absolute-git-dir` / upward discovery against the user's repo. `repoRoot = realpath(cwd)`.
- **Forbidden-root guard:** `restore()` re-checks `isForbiddenRoot(this.cwd)` at entry and returns `refused` with zero filesystem mutation before any I/O.
- **Dangerous-dir gating:** both delete paths apply `isDangerousWorkspaceRel` + `:!` pathspecs so `.git`/`.pi`/`node_modules` are never enumerated/unlinked.
- **Two-flag AND:** deletion runs only when `opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles` (verified — config gate OFF refuses deletion in `F-revert-delete (off)`).

---

## Issues Found

**None.**

- Critical: **0**
- Major: **0**
- Minor: **0**

The single defect described in the PRD (BUG-001) is **already resolved** in this codebase. There is nothing for a fixer to change.

## Testing Summary
- Total bugs found: **0**
- Critical: 0
- Major: 0
- Minor: 0

## Recommendations
None required. The fix is complete and well-tested. (Optional, non-blocking: the project ships no automated linter/formatter — adding one would harden CI, but it is outside the scope of this validation and not a defect.)