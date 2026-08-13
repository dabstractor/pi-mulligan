# Residual Risk Analysis & Fix Direction — BUG-001

## Scope

This document analyzes the residual data-loss risk remaining AFTER the already-landed
BUG-001 spare-Set fix (commit `ec5ad32`), and prescribes the hardening. See
`system_context.md` for the premise-mismatch detail (primary fix already present + tested).

## Risk Register

| # | Risk | Severity | Backend | Status |
|---|------|----------|---------|--------|
| R1 | Note-write failure at capture → empty spare Set → oversize pre-existing file unlinked at restore | **HIGH** (irreversible data loss) | GitBackend | **OPEN — target of this plan** |
| R2 | Path-casing mismatch between scan's POSIX rel and `git ls-files` output on case-insensitive/Windows FS defeats the case-sensitive `Set.has` | MEDIUM | GitBackend | Out of scope (orthogonal; no case-insensitive FS in CI) |
| R3 | No real-git integration test for the note round-trip (git.test.ts:728 uses fake exec) | LOW | GitBackend | Partially mitigated by revert-git.test.ts:850 (real git, but note succeeds) |

## R1 — Detailed Mechanism

### Trigger conditions (ALL must hold for data loss)
1. A pre-existing file in the workspace exceeds `revert.maxFileBytes` (default 256 KB) —
   e.g. `pnpm-lock.yaml`, large `package-lock.json`, vendored binaries, datasets, big `.env`.
2. The agent opts into the destructive path: `allowDeleteCreatedFiles: true` AND the rewind
   uses `deleteCreatedFiles: true`.
3. The oversize note write at capture **fails** (notes machinery unavailable, disk error, ref
   lock contention, shadow repo corruption) and is silently swallowed by the best-effort
   try/catch at `git.ts` ~418-432.

When (3) holds, restore's `result.skipped` is empty, the spare Set is empty, and
`git ls-files --others` lists the oversize file → it is unlinked. Irreversible.

### Why the existing spare-Set fix does NOT close this
The spare Set is populated from `result.skipped`, which is populated from the note. The note
is the SOLE transport for oversize paths from capture to restore in the git backend. If the
note write fails, the transport is broken and the spare Set is empty by construction. The fix
treats "did the note arrive?" as the trust signal — but the note is best-effort, so trusting
its ABSENCE to mean "no oversize files existed" is unsafe.

### CAS contrast (why CAS is immune to this failure mode)
CAS stores oversize paths in `manifest.skipped`, persisted atomically as part of the manifest
JSON write (`cas.ts` ~546-560). If that write fails, capture returns `null` — there is no ref
to restore from, so the delete step never runs. The manifest IS the ref; it cannot be half-
written (writeFile is the last step before `return label`). Therefore CAS has no orphan-ref-
without-oversize-record failure mode. The CAS guard added here is pure belt-and-suspenders
for uniformity (one line, the `st` is already computed by walkTree).

## Fix Direction — Restore-Time maxFileBytes Size Guard (defense-in-depth)

**Principle:** deletion safety must NOT depend on a best-effort side channel (the note).
Add a deterministic, local, independent check in the restore delete step: spare any delete-
candidate whose current byte size exceeds `cfg.revert.maxFileBytes`.

**Safety argument:** when the note is absent we cannot distinguish "pre-existing oversize"
from "span-created large file." In that state of uncertainty the only safe action is to NOT
delete — a leftover span-created large file is recoverable (manual rm); a deleted pre-existing
file is not. This encodes uncertainty as a conservative spare. In the happy path (note
present), the size guard is redundant and harmless.

### GitBackend implementation (`src/snapshot/git.ts`)
1. Add `stat?: (path: string) => Promise<{ size: number }>` to `GitBackendDeps`
   (alongside `exec`, `scan`, `unlink` at lines 104-122). Import `stat as fsStat` from
   `node:fs/promises` at the top (alongside the existing fsUnlink/fsRm imports at ~line 8-9).
   Store `this.stat = deps?.stat ?? fsStat` in the constructor (~272).
2. In restore delete step (after `if (spare.has(rel)) continue;` at line 887), insert a
   best-effort size guard:
   ```
   try {
     const st = await this.stat(abs);
     if (st.size > this.cfg.maxFileBytes) {
       if (!result.skipped.includes(rel)) result.skipped.push(rel);  // dedup visibility
       continue;  // SPARE — defense-in-depth, independent of the note
     }
   } catch { /* ENOENT / inaccessible → size unknown → proceed to normal unlink attempt */ }
   ```
3. Backward-compat for existing unit tests: they use fake paths (`/fake/cwd/...`) with the
   production-default `stat` → ENOENT → swallowed → existing unlink behavior unchanged. **No
   existing test modification required.** The note-write-failure regression test injects a
   `stat` fake returning a size > maxFileBytes.

### CasBackend implementation (`src/snapshot/cas.ts`)
`walkTree`'s `visit` callback type is `(rel, abs, st: {size, mtimeMs})` and walkTree already
calls `this.fs.stat(abs)` to compute `st` (lines 411-440). The restore delete-step callback at
line 1123 currently declares `async (rel, abs) =>` (drops `st`). Change it to
`async (rel, abs, st) =>` and add, immediately after the existing `if (spare.has(rel)) return;`
(line 1125):
```
if (st.size > this.cfg.maxFileBytes) return;  // SPARE — defense-in-depth, independent of manifest
```
**No new DI seam needed** — `st` is already passed positionally by walkTree.

## Regression Test Spec — Note-Write-Failure + Delete (GitBackend)

This is the KEY new test (the exact scenario R1 describes). It belongs in the git unit test
layer (`test/git.test.ts`) because it needs a fake exec that sabotages the note while still
returning canned `ls-files` output.

**Setup:**
- `cfg.allowDeleteCreatedFiles = true`, `cfg.maxFileBytes = 256` (tight).
- Fake exec: `throwOn: { cmd: "notes" }` (BOTH the capture note-add AND the restore note-show
  fail — simulating the note never written). `ls-files` returns `"big.bin\nnew.ts\n"`.
- Inject a `stat` fake: returns `{ size: 1000 }` for `big.bin` (> 256), `{ size: 10 }` for
  `new.ts`.

**Assert:**
- `result.deleted === ["new.ts"]` (span-created small file deleted).
- `result.deleted` does NOT contain `"big.bin"`.
- `result.skipped` contains `"big.bin"` (visibility — agent sees the spared file).
- `unlinked` array: `new.ts` present, `big.bin` ABSENT.

Without the size guard this test FAILS (big.bin is unlinked because the note-failure emptied
the spare Set). With the guard it PASSES.

## Out of Scope
- R2 (case-insensitive path matching): orthogonal to BUG-001; no case-insensitive FS in CI.
- Making the note write non-best-effort: would violate the E29 contract (capture must not fail
  after the ref is pinned); the size guard is the correct layer.
- `maxTotalBytes` / `maxSnapshotsPerTurn` cap variants: same code path; low risk, not targeted.