# Bug Fix Requirements

## Overview
Performed a creative end-to-end bug hunt of the pi-mulligan implementation against the v1.2 PRD, starting from a green baseline (tsc --noEmit clean; 1394/1394 vitest tests pass — matching the prior validation). I reviewed the core transform pipeline (pairing/resolve/apply), the four agent tools (rewind/shrink/audit/cancel) with their E22 retry/context-fraction backstops, the v1.1 human slash-command + banner surface, the two preventive nudges (windowed drift + edge-triggered high-water), config validation, and — most importantly — the safety-critical v1.2 SnapshotStore (GitBackend external shadow repo + CasBackend) including the SAFETY INVARIANT/forbidden-root/dirty-guard defenses. One critical defect was found and CONFIRMED with a real-filesystem reproduction: `delete_created_files` irreversibly deletes pre-existing user files that exceed `revert.maxFileBytes` (default 256 KB) because such files are skipped at capture time (never recorded in beforeRef) and are thus indistinguishable from genuine span-created files at restore time — violating spec/14 §2 safety guarantee #4 ("only deletes files the span created"). Both the Git backend and the CAS default whole-tree mode are affected; the CAS explicit-paths mode is not. The validation's test suite missed this because every F-revert-delete test uses small files that fit in the manifest. The rest of the implementation (soft-delete view model, marker retraction, drift/user-exempt nudges, git-safety: zero commands against the user's .git, byte-identical .git assertion, forbidden-root guards) is correct and matches the PRD.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

### Issue 1: delete_created_files silently deletes pre-existing files that exceed revert.maxFileBytes (irreversible data loss)
**Severity**: Critical
**ID**: BUG-001
**Location**: src/snapshot/git.ts:846-868 (restore step (c): `if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles) { git ls-files --others ...; unlink(abs); }` — does not consult result.skipped/oversize note); src/snapshot/cas.ts:1115-1120 (restore step (c): `walkTree(... if (manifest.files[rel]) return; ... unlink(abs))` — checks only manifest.files, not manifest.skipped). Capture sites that create the gap: src/snapshot/git.ts:404-426 (oversize -> :! pathspec, git NOTE only) and src/snapshot/cas.ts:614-621 (oversize -> skipped[], no files entry).

**Description**:
The v1.2 working-tree revert's delete path deletes any working-tree file that is 'absent from the beforeRef snapshot', but a file can be absent from the snapshot for two DIFFERENT reasons: (a) it was created during the rewound span (the intended target), or (b) it PRE-EXISTED the span but was too large to be captured (skipped at capture time because its size exceeded config.revert.maxFileBytes, default 256 KB). The implementation conflates these two cases, so a pre-existing file the agent never touched gets `unlink`-ed when `delete_created_files: true` is used. This directly violates spec/14 §2 guarantee #4 — one of the feature's headline FIVE git-safety guarantees: "`delete_created_files` only deletes files the span created" — and §6 step 4 "delete work-tree files present now but absent from beforeRef (span creations)". The whole feature is sold on safety (spec/14 §0 "best-effort, fail-open, never touches git history"; the extensive SAFETY INVARIANT apparatus). A user who opts into the destructive path (`allowDeleteCreatedFiles: true`) consents to deletion of AGENT-CREATED files — not to deletion of their own pre-existing large files (pnpm-lock.yaml and large package-lock.json routinely exceed 256 KB; so do vendored binaries, datasets, large assets, big .env files). The deletion is irreversible (unlink). Note: the CAS `explicit-paths` mode is NOT affected (it does not tree-walk and only deletes manifest entries flagged existed:false); only the Git backend and the CAS `cas` (default whole-tree) mode are affected. The validation's 1394-test suite missed this because every F-revert-delete test uses small files that ARE captured in the manifest (test/integration/revert-cas.test.ts:653 explicitly notes 'a file present at turn_start IS in the manifest and would NOT be deleted') and never exercises a pre-existing file exceeding maxFileBytes.

**Steps to Reproduce**:
Confirmed with a real-filesystem vitest reproduction (run against both backends, both FAILED as expected): (1) Create a temp working dir (git init for the git-backend variant). (2) Write a PRE-EXISTING file larger than maxFileBytes, e.g. writeFileSync(join(dir,'preexisting-big.bin'),'X'.repeat(1000)) with cfg.maxFileBytes=256. (3) backend.capture('turn') -> the oversize file is skipped at capture (console warns 'skipping oversize file') and is NOT in beforeRef's tree/manifest (it lands in manifest.skipped / an oversize git note). (4) Simulate a span-created file: writeFileSync(join(dir,'span-created.txt'),'agent made this'). (5) backend.restore(beforeRef, { revertFileChanges:false, deleteCreatedFiles:true }) under allowDeleteCreatedFiles:true. (6) Assert: the pre-existing big file is GONE (statSync throws ENOENT) in BOTH the git and cas backends, while it should have survived. ROOT CAUSE — git.ts restore() step (c): `git ls-files --others` lists every untracked file (oversize files were never `git add`-ed at capture, so they are untracked vs the read-tree'd beforeRef index) and each is `unlink`-ed; the oversize note read into result.skipped at step (a.5) is NEVER consulted to spare those paths. cas.ts restore() step (c): `walkTree` deletes every present file whose rel is not in `manifest.files` — an oversize file is recorded only in `manifest.skipped`, not `manifest.files`, so it is unlinked. FIX DIRECTION: restore()'s delete step must treat manifest.skipped / the oversize note as 'known pre-existing files to spare' (skip them), OR capture must record oversize files with existed:true (hash absent) so they are distinguishable from genuine span creations — as the CAS explicit-paths mode already does via the existed flag.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

None.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

None.

## Testing Summary
- Total bugs found: 1
- Critical: 1
- Major: 0
- Minor: 0

## Recommendations
- Fix restore()'s delete step in both backends to spare files recorded as oversize/skipped at capture (consult result.skipped / manifest.skipped / the oversize git note), OR change capture to record oversize files with an existed:true marker (hash absent) so they are distinguishable from genuine span creations — mirroring the CAS explicit-paths existed-flag design that already handles this correctly.
- Add an integration test (F-revert-delete-oversize): a pre-existing file larger than revert.maxFileBytes must survive a delete_created_files rewind (the current F-revert-delete tests only use small in-manifest files, which is why this slipped through).
