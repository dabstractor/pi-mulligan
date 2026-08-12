---
name: "P1.M5.T1.S1 — Track skipped/oversize paths during capture and surface on restore in both backends (BUG-005)"
description: |
  Populate the `RestoreResult.skipped: string[]` bucket (E29 — files uncaptured because a cap was hit)
  in BOTH snapshot backends. Today both backends init `result.skipped = []` in `restore()` and NEVER
  push to it (src/snapshot/git.ts restore ~L708; src/snapshot/cas.ts restore ~L976), so the rewind
  success-text clause "N skipped/failed" only ever counts failures and the rewind marker's
  `revert.skipped` boolean is always false — the agent receives NO signal that a requested file-revert
  was incomplete due to caps.

  THE KEY INSIGHT (verified in research): `src/tools/rewind.ts` is ALREADY fully wired to consume
  `RestoreResult.skipped` — success text at rewind.ts:905, marker boolean at rewind.ts:889, count at
  rewind.ts:899. So `rewind.ts` needs ZERO changes. The ONLY defect is the backends never POPULATE the
  bucket. Once both `restore()` methods push the uncaptured paths, the agent sees
  "N skipped/failed" > 0 and `marker.revert.skipped === true` automatically.

  CAS BACKEND (file-by-file capture — simpler): add an OPTIONAL `skipped?: string[]` field to
  `CasManifest` (backward-compatible — `parseManifest` only checks `version === 1`), track the rel in
  `captureExplicitPaths` (maxFileBytes skip L479, maxTotalBytes skip L486) + `capture` whole-tree
  (maxFileBytes L579, maxTotalBytes L598) + `appendExplicitPath` (oversize L718), write it into the
  manifest JSON, and in `restore()` push `(manifest.skipped ?? [])` into `result.skipped`.

  GIT BACKEND (atomic capture): git ABORTS on `maxTotalBytes` overrun → returns null → no snapshot →
  restore never runs (so budget-skip is moot for git). Oversize files are skipped individually via
  `:!` pathspec negation (L352) but the snapshot STILL succeeds → these are git's skipped set. Persist
  `oversizePaths` as a git NOTE on the commit (`git notes --ref=refs/mulligan/oversize add -f -m
  <JSON> <commitSha>`) during capture, and in restore best-effort `git notes --ref=refs/mulligan/oversize
  show <beforeRef>` → parse JSON → push to `result.skipped`. Notes go through the EXISTING `this.exec`
  DI seam (fully unit-testable, no new fs imports, wiped by `destroy()`'s `fsRm(shadowDir)`).

  DEPENDS ON (in the tree at implementation time): the EXISTING, already-Complete snapshot subsystem
  (P2.M2/P2.M3 — git.ts/cas.ts/store.ts). Does NOT touch rewind.ts (it already consumes skipped) NOR
  the parallel P1.M4.T2.S2 item (test-only, different files). BUG-006 (lastCommit reset) and BUG-007
  (has() mutex) are SEPARATE sibling items (P1.M5.T2/T3) — do NOT touch gc()/has() here. Docs: [Mode A]
  — CasManifest JSDoc (new skipped field) + JSDoc on restore() skipped-bucket population in both
  backends. No user-facing/config/API surface change.

  CONTRACT scope: src/snapshot/cas.ts + src/snapshot/git.ts (production) + test/cas.test.ts +
  test/git.test.ts (unit tests). NOTHING else.
---

## Goal

**Feature Goal**: Make E29 caps-degradation observable to the agent. When capture skips files due to
`maxFileBytes`/`maxTotalBytes` caps, record those paths at capture time and surface them in
`RestoreResult.skipped` at restore time — so the rewind success text reports "N skipped/failed" > 0
and the rewind marker's `revert.skipped` boolean flips to true, signaling that the file-revert was
incomplete (bounded, best-effort).

**Deliverable**:
1. **CAS**: an optional `skipped?: string[]` field on `CasManifest` (src/snapshot/cas.ts) populated by
   `captureExplicitPaths` + `capture` (whole-tree) + `appendExplicitPath`, and surfaced by `restore()`.
2. **Git**: oversize-paths persistence as a git note during `capture()` + best-effort note-read in
   `restore()` (src/snapshot/git.ts) — both via the existing `this.exec` shadow-env seam.
3. **Unit tests**: capture→manifest-contains-skipped + restore→result.skipped-populated cases added to
   `test/cas.test.ts` and `test/git.test.ts` using their existing DI-seam fakes.
4. **JSDoc** (Mode A): CasManifest `skipped` field + restore() skipped-bucket population notes.

**Success Definition**:
- A capture that hits a cap records the skipped paths; a subsequent `restore()` returns them in
  `result.skipped` (both backends, exercised by unit tests).
- `npm run typecheck`: 0 errors.
- `npx vitest run test/cas.test.ts test/git.test.ts`: green (new tests + all existing).
- `npm test`: full suite green (no regression).
- `git diff --name-only` shows ONLY `src/snapshot/cas.ts`, `src/snapshot/git.ts`,
  `test/cas.test.ts`, `test/git.test.ts`.

## Why

- **Closes the E29 observability gap.** PRD §h2.3/BUG-005: "the agent thus receives no signal that a
  requested revert was incomplete due to caps — it believes the revert fully succeeded." The
  `RestoreResult.skipped` bucket (store.ts JSDoc: "E29 — file uncaptured because a cap was hit") and
  the rewind marker's `revert.skipped: boolean` (spec/04 §3) exist SPECIFICALLY for this signal; both
  are dead letters because the backends never populate the bucket.
- **The fix is surgical + the consumer layer is ready.** rewind.ts already folds `result.skipped` into
  the success text (`${skipped.length + failed.length} skipped/failed`), the marker
  (`skipped.length > 0`), and `RewindDetails` (the count). Zero rewiring upstream — just make the two
  `restore()` methods do what their JSDoc + the bucket's existence already promise.
- **Bounded + best-effort by contract (Minor severity).** Revert is already spec'd as best-effort
  (E27/E29: degradation never blocks the context rewind). This item does not change WHAT files get
  reverted; it only REPORTS which requested files could not be reverted because they were uncaptured.

## What

**User-visible behavior**: When a rewind's file-revert touches a snapshot that was partial (some files
skipped at capture due to caps), the rewind success text now reports "N skipped/failed" where N > 0,
and the persisted rewind marker records `revert.skipped: true`. The agent can then see the revert was
incomplete and re-request affected work. No change to the files actually reverted; no change to the
dirty-guard refuse (E30) path.

**Technical change**:
- **CAS**: `CasManifest` gains an optional `skipped?: string[]`; the three capture entry points
  (`captureExplicitPaths`, `capture` whole-tree, `appendExplicitPath`) collect skipped rels and write
  them into the manifest; `restore()` copies `manifest.skipped` into `result.skipped`.
- **Git**: `capture()` writes `JSON.stringify(oversizePaths)` as a note on the commit under
  `refs/mulligan/oversize` (only when `oversizePaths.length > 0`); `restore()` best-effort reads that
  note and parses it into `result.skipped`.

### Success Criteria

- [ ] `CasManifest` (src/snapshot/cas.ts) has an OPTIONAL `skipped?: string[]` field with JSDoc.
- [ ] `captureExplicitPaths` pushes the rel to a `skipped` array on BOTH the maxFileBytes skip (L479)
      and the maxTotalBytes skip (L486), and writes `skipped` into the serialized manifest.
- [ ] `capture` (whole-tree 'cas' mode) pushes the rel on BOTH the maxFileBytes skip (L579) and the
      maxTotalBytes skip (L598), and writes `skipped` into the serialized manifest.
- [ ] `appendExplicitPath` pushes the oversize `path` to `manifest.skipped` and rewrites the manifest
      (instead of silently `return`-ing on oversize at L718).
- [ ] `restore` (cas) pushes every entry of `(manifest.skipped ?? [])` into `result.skipped`.
- [ ] `capture` (git) writes `JSON.stringify(oversizePaths)` as a git note under
      `refs/mulligan/oversize` on the commit when `oversizePaths.length > 0` (best-effort; a note
      write failure must NOT fail capture).
- [ ] `restore` (git) best-effort reads `git notes --ref=refs/mulligan/oversize show <beforeRef>`;
      on success parses the JSON `string[]` and pushes each into `result.skipped`; on non-zero exit
      (no note) swallows silently.
- [ ] JSDoc updated: CasManifest `skipped` field; both `restore()` methods' skipped-bucket population.
- [ ] New unit tests in test/cas.test.ts AND test/git.test.ts prove capture-records-skipped and
      restore-surfaces-skipped for the respective backend.
- [ ] `npm run typecheck` 0 errors; `npm test` green; diff limited to the 4 files above.

## All Needed Context

### Context Completeness Check

_Passed._ An engineer with zero prior knowledge of this repo can implement this from: (a) the exact
type to extend (`CasManifest`) and the exact lines where each skip occurs in each method; (b) the
verified fact that `rewind.ts` ALREADY consumes `result.skipped` (3 cited lines) so no upstream
change is needed; (c) the chosen git-notes design (commands + namespace + why-not-sidecar) and the
exact `this.exec`/`shadowEnv()` seam to use; (d) the exact DI-seam test fakes to drive (recording
`exec` with `canned.stdoutByCmd` for git; recording `CasFs` for cas); (e) the backward-compat proof
(`parseManifest` checks only `version === 1`). No inference or guessing required.

### Documentation & References

```yaml
# MUST READ — the bug definition + fix strategy
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  section: "## BUG-005 (Minor): RestoreResult.skipped bucket never populated"
  why: defines the defect (skipped[] init, never pushed), the per-backend divergence (CAS file-by-
    file partial vs git atomic-abort), and the fix strategy (record oversize/over-budget paths at
    capture, surface at restore).
  critical: BUG-006 (lastCommit GC) and BUG-007 (has() mutex) are SEPARATE sibling items — do NOT
    touch gc()/has() in this item.

# MUST READ — the consumer layer (PROVES rewind.ts needs zero changes)
- file: src/tools/rewind.ts (L889 marker boolean; L899 count; L905 success-text clause)
  why: confirms `result.skipped` is ALREADY consumed. doRestore() closure: success text
    `"${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed"`; marker
    `skipped: restoreResult.skipped.length > 0`; RewindDetails `skipped: restoreResult.skipped.length`.
    READ-ONLY for this item.

# MUST READ — the RestoreResult contract (the bucket already exists)
- file: src/snapshot/store.ts (RestoreResult interface ~L160; skipped JSDoc "E29 — file uncaptured
    because a cap was hit")
  why: the `skipped: string[]` bucket is DECLARED + documented + present in NoOpStore — only the two
    real backends fail to write it. READ-ONLY for this item.

# PRIMARY EDIT TARGETS
- file: src/snapshot/cas.ts
  why: CasManifest type (L118-129); captureExplicitPaths (L457-527; skip L479/L486); capture whole-
    tree (L551-635; skip L579/L598); appendExplicitPath (L693-740; oversize L718); restore (L970-1065;
    manifest read L984). This item edits ALL FIVE regions.
  pattern: the manifest is built as a local object literal then `serializeManifest(manifest)` →
    `this.fs.writeFile(this.manifestPath(label), Buffer.from(...))`. Add `skipped` to that literal.
  gotcha: paths pushed to `skipped` are workspace-relative POSIX rels (the SAME `rel`/`path` already
    used in the warn strings) — NOT abs paths. Keep them consistent with `files` keys.

- file: src/snapshot/git.ts
  why: scanForCaps returns {oversizePaths} (L86-93, L150-192); capture computes oversizePaths at
    L333, builds pathspecs at L352, commitSha at L376, update-ref at L372; restore guard at L714,
    read-tree at L726. This item adds the note-write (capture) + note-read (restore).
  pattern: every write command goes through `this.exec("git", [args], this.shadowEnv())` (the
    shadow-env seam — guarantees #1/#2). Notes use the SAME seam.
  gotcha: git capture ABORTS on maxTotalBytes (L338-342 returns null) → no snapshot → restore never
    runs → ONLY oversize files are a skipped concern for git (budget-overrun is invisible-but-correct
    because nothing exists to restore). Do not try to surface the abort case.

# TEST PATTERNS (mirror these DI-seam fakes)
- file: test/git.test.ts
  why: `makeExec(calls, canned)` recording fake + `canned.stdoutByCmd:{cmd:stdout}`; `makeBackend`;
    `findCmd(calls, cmd)`; canned `scan` returning a `CapScan`. The exec fake returns "COMMIT456" for
    commit-tree, "" for unknown cmds. Drive a note-add assertion via the recorded `calls`; drive a
    note-show response via `canned.stdoutByCmd:{notes:'["big.bin"]'}`.
  pattern: existing "skips oversize files via :! negation + still captures" (L265) is the base test
    to EXTEND — it already injects a scan with oversizePaths.

- file: test/cas.test.ts
  why: `makeBackend(fs?)` + `makeTreeFs(cwd, storageDir, tree)` + recording CasFs fake tracking
    writeFile/readFile/stat. Capture describe at L370.
  pattern: inject a fake fs whose `stat` returns a size > maxFileBytes for one file (or a cfg with a
    tiny maxTotalBytes); capture → parseManifest the written manifest buffer → assert `.skipped`
    contains the rel; restore → assert `result.skipped` contains it.

# DEPENDENCY (parallel item — different files; no conflict)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T2S2/PRP.md
  why: TEST-ONLY item (test/integration/revert-git.test.ts). Does NOT touch src/snapshot/*.ts nor
    rewind.ts. No conflict with this item. (Its S1 dependency, changedPaths on the store, is already
    Complete.) No coordination needed beyond not editing the same files.
```

### Current Codebase tree (relevant slice — run `ls`/`grep -n` to confirm)

```bash
src/snapshot/
  store.ts     # RestoreResult.skipped bucket DECLARED (E29) — READ-ONLY
  cas.ts       # EDIT: CasManifest type + captureExplicitPaths + capture + appendExplicitPath + restore
  git.ts       # EDIT: capture (note-write) + restore (note-read)
  paths.ts     # normalizeRelPath/isDangerousWorkspaceRel — READ-ONLY (helpers already used)
src/tools/
  rewind.ts    # ALREADY consumes result.skipped (L889/899/905) — READ-ONLY
test/
  cas.test.ts  # EDIT: add skipped unit tests (makeTreeFs/makeBackend DI fakes)
  git.test.ts  # EDIT: add skipped unit tests (makeExec/makeBackend + canned.stdoutByCmd)
```

### Desired Codebase tree with files to be changed

```bash
src/snapshot/cas.ts    # MODIFIED — CasManifest.skipped + 3 capture methods track it + restore surfaces it
src/snapshot/git.ts    # MODIFIED — capture writes oversize note; restore reads it → result.skipped
test/cas.test.ts       # MODIFIED — add skipped unit tests inside existing describes (or a new describe)
test/git.test.ts       # MODIFIED — add skipped unit tests inside existing describes (or a new describe)
# (no new files; no store.ts/rewind.ts/config/marker changes)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — rewind.ts needs ZERO changes. It already does (doRestore closure):
//   revertClause = `Reverted ${reverted.length} file(s), deleted ${deleted.length}; ` +
//     `${skipped.length + failed.length} skipped/failed, ${refused.length} refused (see log).`;
//   revertBlock.skipped = restoreResult.skipped.length > 0;   // marker boolean
//   revertSummaryDetails.skipped = restoreResult.skipped.length; // count
// Do NOT edit rewind.ts. Populate the bucket in the backends and the signal propagates.

// CRITICAL #2 — CasManifest.skipped MUST be OPTIONAL (`skipped?: string[]`). parseManifest only
//   checks `m.version === 1`; it does NOT require `skipped`. Old manifests (written before this fix)
//   have no `skipped` field → restore must treat it as `[]`: `(manifest.skipped ?? [])`. Making it
//   required would break parsing of pre-fix manifests persisted in running sessions.

// CRITICAL #3 — CAS skipped paths are workspace-relative POSIX rels (the SAME `rel` (captureExplicit
//   Paths/capture) / `path` (appendExplicitPath) used in the existing warn strings). They MUST match
//   the `files` key convention exactly so the agent's "N skipped/failed" names are unambiguous.
//   Do NOT push abs paths.

// CRITICAL #4 — git capture is ATOMIC on budget overrun: `totalBytes > maxTotalBytes` → return null
//   (L338-342) → NO snapshot → restore never runs. So for git the ONLY meaningful skipped set is the
//   OVERSIZE files (excluded via `:!` pathspec at L352 while the snapshot still succeeds). Do NOT
//   attempt to surface the abort case — there is nothing to restore from a null capture.

// CRITICAL #5 — git note write/read MUST be BEST-EFFORT with its OWN try/catch. A note-add failure
//   (e.g. notes machinery unavailable) must NOT fail capture (capture's contract: never rejects,
//   returns the commitSha on success). A note-show failure (non-zero exit = no note) in restore must
//   be swallowed (result.skipped stays []). Never let the note op throw out of capture/restore.

// CRITICAL #6 — use git NOTES (--ref=refs/mulligan/oversize), NOT a sidecar JSON file. Rationale:
//   (a) notes go through `this.exec` (the existing DI seam) → fully unit-testable with the existing
//       `makeExec`/`canned.stdoutByCmd` fake; (b) git.ts imports ONLY readdir/stat/unlink/rm (no
//       writeFile/readFile/mkdir) + has no general-fs DI seam, so a sidecar would need NEW imports
//       AND a new DI surface; (c) notes are keyed by commit SHA = beforeRef → directly addressable in
//       restore; (d) `destroy()` already `fsRm(shadowDir)` → notes wiped at session_shutdown.
//   Notes do NOT pin commits (a note names its target SHA as a tree PATH, not a graph edge), so this
//   does NOT exacerbate BUG-006's GC reclamation.

// GOTCHA #7 — appendExplicitPath (cas) currently `return`s on oversize (L718) WITHOUT rewriting the
//   manifest, so the oversize path is lost. After the fix it must: push `path` into
//   `manifest.skipped` (initialize `(manifest.skipped ?? [])` then append), then run the SAME
//   mkdir+writeFile rewrite as the success path, THEN return. Preserve any `skipped` already on the
//   loaded manifest (merge, don't overwrite).

// GOTCHA #8 — git restore places the note-read AFTER the `if (!revertFileChanges && !deleteCreated
//   Files) return result;` early-return guard, so skipped is only surfaced when a restore actually
//   runs (matching reverted/deleted/failed — all populated past the guard). This is correct: the
//   success text only renders when doRestore ran (at least one flag set).

// GOTCHA #9 — cas restore places the `manifest.skipped` copy AFTER the manifest-parse try/catch
//   (L984-996). A missing/corrupt manifest already returns the empty result (no skipped) — correct.

// CONVENTION — every store method is already mutex-serialized (`const release = await this.mutex.
//   acquire()` ... `finally { release(); }`). The new note-read in git restore runs INSIDE the
//   existing try/finally — do NOT add a second mutex acquire.
```

## Implementation Blueprint

### Data models and structure

Extend ONE type (backward-compatible optional field). No new types, no new exports, no schema migration.

```typescript
// src/snapshot/cas.ts — extend CasManifest (add the optional field + JSDoc):
export interface CasManifest {
  version: 1;
  label: string;
  turnIndex: number;
  ts: number;
  files: Record<string, CasManifestEntry>;
  /**
   * Workspace-relative POSIX paths that were PRESENT at capture but NOT captured because a cap
   * (maxFileBytes / maxTotalBytes) was hit (E29). Surface on restore() into RestoreResult.skipped so
   * the agent sees the file-revert was incomplete. OPTIONAL: absent on manifests written before
   * BUG-005; restore() treats undefined as [] (parseManifest only checks version === 1).
   */
  skipped?: string[];
}
```

No change to `RestoreResult` (store.ts — `skipped: string[]` already declared) or `CasManifestEntry`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/cas.ts — add the optional `skipped?: string[]` field to CasManifest
  - FIND: the `export interface CasManifest { ... }` block (~L118-129).
  - ADD: `skipped?: string[];` as the last field (after `files`) + the JSDoc above.
  - VERIFY: `parseManifest` (L151) is UNCHANGED (it only checks `version === 1` — the new optional
    field is transparent to it). `serializeManifest` (L138) is UNCHANGED (JSON.stringify handles it).
  - NAMING: `skipped` (matches RestoreResult.skipped + the rewind marker field name exactly).

Task 2: MODIFY src/snapshot/cas.ts captureExplicitPaths (~L457-527) — track skipped, write into manifest
  - ADD near the top (alongside `const files = {}` / `let partial = false`): `const skipped: string[] = [];`
  - ON the maxFileBytes skip (~L479): `skipped.push(rel);` (before/after the existing `console.warn`;
    keep the `continue`).
  - ON the maxTotalBytes skip (~L486): `skipped.push(rel);` (keep the `partial = true` + `continue`).
  - NOTE: the `existed:false` branch (file not present yet ~L470) is NOT a skip — leave it (it records
    absence, which restore handles by deletion). Only the two CAP branches push to skipped.
  - IN the manifest literal (~L501): add `skipped,` (always set it — even `[]` is fine; it documents
    "no skips" and matches the type; serializeManifest includes it).
  - PRESERVE: the existing return value (`return label`), `capturesThisTurn++`, partial warn.

Task 3: MODIFY src/snapshot/cas.ts capture (whole-tree, ~L551-635) — track skipped, write into manifest
  - ADD near the top of the 'cas' branch (after `let partial = false`): `const skipped: string[] = [];`
  - INSIDE the walkTree callback: ON the maxFileBytes skip (~L579) push `skipped.push(rel)`; ON the
    maxTotalBytes skip (~L598) push `skipped.push(rel)`. (Both currently `return` out of the callback.)
  - IN the manifest literal (~L612): add `skipped,`.
  - NOTE: the mtime/size short-circuit branch (~L589) is NOT a skip — it reuses a stored hash for an
    UNCHANGED file (captured, just deduped). Leave it.

Task 4: MODIFY src/snapshot/cas.ts appendExplicitPath (~L693-740) — record oversize into manifest.skipped
  - ON the oversize branch (~L718): instead of a bare `return`, do
      `manifest.skipped = [...(manifest.skipped ?? []), path];`
      then the SAME mkdir + writeFile rewrite as the success path (~L733-737), THEN `return;`.
  - PRESERVE the idempotency guard (`if (manifest.files[path] !== undefined) return;` ~L708) — a path
    already captured is never re-skipped.
  - GOTCHA: manifest is loaded fresh each call (~L701-706) or created empty on miss (~L707). Merging
    onto `(manifest.skipped ?? [])` preserves skips accumulated by a prior captureExplicitPaths run.

Task 5: MODIFY src/snapshot/cas.ts restore (~L970-1065) — surface manifest.skipped into result.skipped
  - AFTER the manifest-parse try/catch (~L996) and BEFORE the `for (const [rel, entry] ...)` loop,
    add: `for (const s of manifest.skipped ?? []) result.skipped.push(s);`
    (equivalently: `result.skipped.push(...(manifest.skipped ?? []));`)
  - PLACEMENT: past the `if (!revertFileChanges && !opts.deleteCreatedFiles) return result;` guard
    (L982) and past the manifest read — so skipped is surfaced whenever a real restore runs.
  - PRESERVE: reverted/deleted/failed/failed-bucket logic unchanged; the best-effort catch (L1061)
    still returns whatever was collected (now possibly including skipped).

Task 6: MODIFY src/snapshot/git.ts capture (~L322-388) — write oversizePaths as a git note on the commit
  - AFTER `update-ref` (~L372) AND after `this.lastCommit = commitSha;` (~L377), BEFORE `return
    commitSha` (~L378), add a best-effort note write WHEN oversizePaths is non-empty:
      if (oversizePaths.length > 0) {
        try {
          await this.exec(
            "git",
            ["notes", "--ref=refs/mulligan/oversize", "add", "-f",
             "-m", JSON.stringify(oversizePaths), commitSha],
            this.shadowEnv(),
          );
        } catch {
          // best-effort: a note failure must NOT fail capture (capture already succeeded — commitSha
          // is pinned). Skip silently; restore will simply see no note (no skipped signal for this
          // capture — acceptable per the best-effort E29 contract).
        }
      }
  - NOTE: `commitSha` is the trimmed commit-tree stdout (L376) = the value restore receives as
    `beforeRef`. `this.shadowEnv()` is the SAME env used by update-ref (GIT_DIR=shadowDir).
  - PRESERVE: the `commitArgs`/`lastCommit`/`capturesThisTurn++` logic; the outer catch→null (L380).

Task 7: MODIFY src/snapshot/git.ts restore (~L702-790) — best-effort read the note into result.skipped
  - AFTER the early-return guard (~L714) and AFTER `await this.exec("git", ["read-tree", beforeRef],
    this.shadowEnv())` (~L726) — or just after the guard, before read-tree (the note is keyed by
    beforeRef, independent of read-tree) — add a best-effort note read:
      try {
        const noteOut = (
          await this.exec(
            "git",
            ["notes", "--ref=refs/mulligan/oversize", "show", beforeRef],
            this.shadowEnv(),
          )
        ).stdout.trim();
        if (noteOut) {
          const oversize = JSON.parse(noteOut);
          if (Array.isArray(oversize)) for (const p of oversize) result.skipped.push(String(p));
        }
      } catch {
        // best-effort: no note (non-zero exit) OR unparseable JSON ⇒ no skipped signal for this ref.
        // Swallow; result.skipped stays as-is. Never let this throw out of restore.
      }
  - PLACEMENT: inside the existing try (so it's covered by the outer catch→return result at L784) but
    with its OWN try/catch so a non-zero `notes show` exit (the common "no note" case) does NOT abort
    the restore (read-tree/diff/checkout below must still run).
  - PRESERVE: the reverted/deleted/failed logic; the outer `finally { release(); }`.

Task 8: ADD unit tests to test/cas.test.ts
  - ADD a new `describe("CasBackend.capture — caps-skipped tracking (BUG-005)", ...)` (or extend the
    existing capture describe at L370). Reuse `makeBackend(fs)` / `makeTreeFs(cwd, storageDir, tree)`.
  - CASE A (maxFileBytes): cfg with `maxFileBytes` smaller than one file's size; a fake fs whose stat
    returns the oversize size for that rel. `await cb.capture("turn")` → read back the manifest buffer
    the fake captured (`parseManifest(buf.toString("utf8"))`) → `expect(manifest.skipped).toContain
    ("<the rel>")`. Also assert the file is ABSENT from `manifest.files`.
  - CASE B (maxTotalBytes): cfg with a tiny `maxTotalBytes`; a tree with two files whose combined
    size exceeds it. capture → assert the second rel is in `manifest.skipped` + `partial` warn fired.
  - CASE C (restore surfaces it): write a manifest (via the fake, or by capturing) whose `skipped`
    contains a rel; `await cb.restore("turn", {revertFileChanges:true, deleteCreatedFiles:false})` →
    `expect(result.skipped).toContain("<rel>")`.
  - CASE D (backward-compat): a manifest JSON WITHOUT a `skipped` field (simulating a pre-fix
    manifest) → restore does NOT throw + `result.skipped` is `[]`.
  - COVERAGE: both skip triggers (maxFileBytes, maxTotalBytes) for capture; restore surfacing;
    backward-compat. Follow existing test naming (`it("...")`).

Task 9: ADD unit tests to test/git.test.ts
  - ADD a new `describe("GitBackend — oversize-skipped tracking via git notes (BUG-005)", ...)`.
    Reuse `makeBackend(calls, cfg, scan, canned)` + `findCmd`.
  - CASE A (capture writes the note): inject a `scan` returning `{oversizePaths:["big.bin","huge.
    dat"], totalBytes:100}`. capture("turn") → assert a recorded call `findCmd(calls,"notes")` exists,
    args include `["notes","--ref=refs/mulligan/oversize","add","-f","-m",
    JSON.stringify(["big.bin","huge.dat"]),"COMMIT456"]`. (commit-tree returns "COMMIT456" per makeExec.)
  - CASE B (capture writes NO note when no oversize): `emptyScan` → capture → assert NO "notes" call
    was recorded (`expect(findCmd(calls,"notes")).toBeUndefined()`).
  - CASE C (restore reads the note): build a backend with `canned.stdoutByCmd:{notes:
    JSON.stringify(["big.bin"])}`. restore(beforeRef="COMMIT456" or any string, {revertFileChanges:
    true, deleteCreatedFiles:false}) → `expect(result.skipped).toEqual(["big.bin"])`.
    (read-tree/diff/checkout fall through to "" stdout so the loop is empty — fine.)
  - CASE D (restore with no note → empty skipped): backend WITHOUT a `notes` canned stdout (so notes
    show returns "" — simulating no note). restore → `expect(result.skipped).toEqual([])`. Assert
    restore still completes (reverted/deleted/failed buckets unaffected).
  - COVERAGE: note-write on oversize + no-note-when-clean + note-read surfaces skipped + no-note
    restore is empty. Follow existing test naming + the `findCmd`/`canned` idioms.

Task 10 (OUT OF SCOPE — do NOT do): NO rewind.ts edits (already consumes skipped). NO store.ts edits
  (skipped bucket already declared). NO gc()/has() changes (BUG-006/BUG-007 own those). NO config /
  marker-schema / API change. NO integration-test changes (P1.M6 owns test hardening). NO edits to
  src/snapshot/paths.ts. If `git diff --name-only` shows anything beyond the 4 in-scope files, STOP.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — CAS capture records skipped into the SAME manifest literal it already builds, then
//   serializes unchanged. captureExplicitPaths skeleton (the change is 3 lines + 1 field):
//     const files: Record<string, CasManifestEntry> = {};
//     const skipped: string[] = [];                       // ← ADD
//     let partial = false;
//     for (const rel of explicitPaths ?? []) {
//       ...
//       if (st.size > this.cfg.maxFileBytes) { skipped.push(rel); console.warn(...); continue; }   // ← push
//       if (totalBytes + st.size > this.cfg.maxTotalBytes) { partial = true; skipped.push(rel); console.warn(...); continue; } // ← push
//       ...
//     }
//     const manifest: CasManifest = { version: 1, label, turnIndex: 0, ts: Date.now(), files, skipped }; // ← skipped

// PATTERN — CAS restore surfaces skipped in ONE line after the manifest parse:
//     for (const s of manifest.skipped ?? []) result.skipped.push(s);

// PATTERN — GIT capture writes the note through the SAME shadow-env seam as update-ref:
//     // after update-ref + lastCommit = commitSha, before return commitSha:
//     if (oversizePaths.length > 0) {
//       try {
//         await this.exec("git",
//           ["notes","--ref=refs/mulligan/oversize","add","-f","-m",JSON.stringify(oversizePaths),commitSha],
//           this.shadowEnv());
//       } catch { /* best-effort — capture already succeeded */ }
//     }

// PATTERN — GIT restore reads the note best-effort with its OWN try/catch (so a no-note non-zero
//   exit does NOT abort the read-tree/diff/checkout pipeline):
//     try {
//       const noteOut = (await this.exec("git",
//         ["notes","--ref=refs/mulligan/oversize","show",beforeRef], this.shadowEnv())).stdout.trim();
//       if (noteOut) {
//         const oversize = JSON.parse(noteOut);
//         if (Array.isArray(oversize)) for (const p of oversize) result.skipped.push(String(p));
//       }
//     } catch { /* no note / unparseable — swallow; restore continues */ }

// CRITICAL — why `skipped` must be OPTIONAL on CasManifest: parseManifest (L151) only enforces
//   `version === 1`. Pre-fix manifests on disk (a running session mid-upgrade) have NO skipped field.
//   restore must do `(manifest.skipped ?? [])` so those manifests still restore without surfacing
//   (correctly — they were captured with no skip tracking). A required field would force a version
//   bump, breaking cross-version parse. Optional + `?? []` is the backward-compatible choice.

// CRITICAL — why git uses NOTES not a sidecar file: testability + minimal surface. The existing
//   test/git.test.ts DI fake is `exec` (makeExec) with `canned.stdoutByCmd`; a note add/show round-
//   trips through it with zero new infra. git.ts has NO writeFile/readFile/mkdir import and NO
//   general-fs DI seam — a sidecar would require new imports + a new `GitBackendDeps.fs` field +
//   fake plumbing in EVERY existing test. Notes also key naturally by commitSha (= beforeRef) and
//   are wiped by destroy()'s fsRm(shadowDir).
```

### Integration Points

```yaml
TYPES (src/snapshot/cas.ts):
  - change: "add optional `skipped?: string[]` to CasManifest"
  - backward_compatible: true (parseManifest checks only version===1; serializeManifest passes it through)
CAPTURE (cas): captureExplicitPaths + capture(whole-tree) + appendExplicitPath write manifest.skipped
CAPTURE (git): capture() writes a git note (refs/mulligan/oversize) on the commit when oversize non-empty
RESTORE (cas): restore() copies manifest.skipped into result.skipped
RESTORE (git): restore() best-effort reads the note into result.skipped
CONSUMER (src/tools/rewind.ts): UNCHANGED — already folds result.skipped into success text (L905) +
  marker (L889) + count (L899). Populating the bucket makes the signal live.
STORE CONTRACT (src/snapshot/store.ts): UNCHANGED — RestoreResult.skipped already declared (E29).
NOOPSTORE: UNCHANGED (returns empty skipped — correct: a no-op store captures nothing).
GC / HAS: UNCHANGED — BUG-006 (P1.M5.T2) resets lastCommit; BUG-007 (P1.M5.T3) serializes has().
  Touching them here would conflict with those sibling items.
CONFIG / DATABASE / ROUTES / MARKER-SCHEMA: none.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (the optional field + the note exec calls must type-check).
npm run typecheck          # tsc --noEmit
# EXPECTED: ZERO errors.
# If you see TS2353 "Object literal may only specify known properties" on the manifest literal → you
#   added `skipped` to the literal but NOT to the CasManifest interface (Task 1). Add the field first.
# If you see TS2339 "'skipped' does not exist on type 'CasManifest'" in restore() → same cause.

# Lint the two edited source files (mirror what the repo lints — check package.json scripts).
# The existing cas.ts/git.ts already pass lint, so localized edits inside existing methods will too.

# Confirm scope:
git diff --name-only
# EXPECTED: exactly { src/snapshot/cas.ts, src/snapshot/git.ts, test/cas.test.ts, test/git.test.ts }.
# If src/tools/rewind.ts or src/snapshot/store.ts appears → OUT OF SCOPE; revert those hunks.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the two edited test files (new tests + all existing must pass).
npx vitest run test/cas.test.ts -v
# Expected: green. The new skipped-tracking tests pass; the existing serializeManifest/parseManifest
#   round-trip + capture/restore tests stay green (the optional field is transparent to them).

npx vitest run test/git.test.ts -v
# Expected: green. The new oversize-note tests pass; the existing capture pipeline + caps + guarantees
#   tests stay green (the note add/show calls are additive and best-effort).

# If a cas capture test now FAILS asserting the manifest has NO extra field → that test was asserting
#   the EXACT key set of a serialized manifest; update it to allow `skipped` (it's an intentional new
#   field). Preferably assert on the specific fields you care about rather than the full key set.

# Full snapshot + tool suite (no behavioral regression in the store/rewind consumers):
npx vitest run test/cas.test.ts test/git.test.ts test/integration/revert-*.test.ts
# Expected: green. (rewind.ts is unchanged; integration tests still pass.)
```

### Level 3: Integration Testing (System Validation)

```bash
# The unit tests in Level 2 ARE the system validation (they drive the REAL backend methods through
# the DI-seam fakes for capture→persist→restore round-trips). No separate system test is needed —
# the integration tests (test/integration/revert-*.test.ts) exercise the rewind-tool↔store path which
# is UNCHANGED (rewind.ts already consumes skipped).

# OPTIONAL end-to-end sanity (proves the signal reaches the success text): in a scratch git repo,
# set config.revert.maxFileBytes to a tiny value, create an oversize file, trigger a turn_start→
# agent_end capture, then a last_turn rewind with revert_file_changes:true. The success text should
# include "1 skipped/failed" and the persisted marker should have revert.skipped:true. (This is a
# manual confirmation, not a required gate — the unit tests + the rewind.ts consumer lines are
# sufficient proof.)
```

### Level 4: Creative & Domain-Specific Validation (correctness reasoning)

```bash
# Reasoning check (no command — the invariants this item establishes):
#   CAS: capture skips file F on maxFileBytes/maxTotalBytes → F is NOT in manifest.files (uncaptured)
#     BUT F's rel IS in manifest.skipped. restore reads manifest.skipped → result.skipped = [F].
#     rewind.ts:905 → "1 skipped/failed"; marker.revert.skipped = true. Agent sees the incompleteness. ✓
#   CAS backward-compat: a manifest with no `skipped` field (pre-fix) → restore does `(undefined ?? [])
#     → []` → result.skipped = [] → success text "0 skipped/failed" → identical to today. ✓
#   GIT: capture skips oversize F via :! pathspec → F absent from the tree, commit succeeds →
#     capture writes note `["F"]` on commitSha. restore reads note(beforeRef===commitSha) →
#     result.skipped = ["F"] → success text "1 skipped/failed"; marker.revert.skipped = true. ✓
#   GIT budget-abort: totalBytes > maxTotalBytes → capture returns null → NO snapshot → restore
#     never runs → skipped moot (nothing to restore). Correct + unchanged. ✓
#   GIT no-oversize: oversizePaths = [] → capture writes NO note → restore `notes show` non-zero →
#     swallowed → result.skipped = [] → success text "0 skipped/failed". Identical to today. ✓
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck`: 0 errors.
- [ ] `npx vitest run test/cas.test.ts`: green (new + existing).
- [ ] `npx vitest run test/git.test.ts`: green (new + existing).
- [ ] `npx vitest run test/integration/revert-*.test.ts`: green (no consumer regression).
- [ ] `npm test`: full suite green.
- [ ] `git diff --name-only` shows ONLY the 4 in-scope files.

### Feature Validation

- [ ] `CasManifest.skipped?: string[]` exists with JSDoc (optional; `?? []` in restore).
- [ ] CAS captureExplicitPaths records both cap triggers (maxFileBytes + maxTotalBytes) into skipped.
- [ ] CAS capture (whole-tree) records both cap triggers into skipped.
- [ ] CAS appendExplicitPath records oversize into manifest.skipped and rewrites (no silent loss).
- [ ] CAS restore pushes `(manifest.skipped ?? [])` into `result.skipped`.
- [ ] GIT capture writes `JSON.stringify(oversizePaths)` as a note under `refs/mulligan/oversize`
      when oversizePaths is non-empty (best-effort, own try/catch).
- [ ] GIT restore best-effort reads the note into `result.skipped` (own try/catch; no-note ⇒ []).
- [ ] Unit tests cover: both cap triggers (CAS), oversize-note write (GIT), no-note clean path (GIT),
      restore surfacing (both), backward-compat (CAS pre-fix manifest).

### Code Quality Validation

- [ ] Skipped paths are workspace-relative POSIX rels (consistent with `files` keys + warn strings).
- [ ] Best-effort note/read ops have their OWN try/catch (never throw out of capture/restore).
- [ ] The note commands go through `this.exec(..., this.shadowEnv())` (the existing seam — no raw fs).
- [ ] No new imports in git.ts (notes use `this.exec`); cas.ts uses only the existing `this.fs`.
- [ ] gc()/has() UNCHANGED (BUG-006/BUG-007 own them).

### Documentation & Deployment

- [ ] CasManifest `skipped` field has JSDoc (E29 + optional + backward-compat note).
- [ ] Both `restore()` methods have a JSDoc/inline note on skipped-bucket population.
- [ ] No config / env-var / API-surface / marker-schema change (Mode A docs only).

---

## Anti-Patterns to Avoid

- ❌ **Don't edit `rewind.ts` or `store.ts`.** `result.skipped` is already declared (store.ts) and
  already consumed in three places (rewind.ts:889/899/905). The ONLY defect is the backends never
  populate the bucket. Editing the consumer layer is out of scope and risks regressing the (working)
  dirty-guard/restore wiring. Populate the bucket in cas.ts/git.ts `restore()` and the signal flows.
- ❌ **Don't make `CasManifest.skipped` required.** `parseManifest` only checks `version === 1`; a
  required field would break parsing of manifests written before this fix (mid-session upgrade) and
  would imply a schema-version bump for no benefit. Optional + `?? []` is backward-compatible.
- ❌ **Don't use a sidecar JSON file for git's oversize tracking.** git.ts has no writeFile/readFile/
  mkdir import and no general-fs DI seam — a sidecar needs new imports + a new `GitBackendDeps.fs`
  field + fake plumbing in every existing test. Use `git notes --ref=refs/mulligan/oversize` through
  `this.exec` (the existing seam): fully testable, keyed by commitSha (= beforeRef), wiped by destroy().
- ❌ **Don't let the git note op throw out of capture/restore.** capture's contract is "never rejects,
  returns the commitSha" — a note-add failure must NOT undo a successful capture. restore's contract
  is "never rejects, returns the result" — a no-note non-zero `git notes show` exit (the COMMON case)
  must NOT abort read-tree/diff/checkout. Both note ops get their OWN try/catch.
- ❌ **Don't try to surface git's budget-overrun abort case.** `totalBytes > maxTotalBytes` → capture
  returns `null` → no snapshot is created → restore is never called. There is nothing to restore from
  a null capture, so "skipped" is moot. Only OVERSIZE files (excluded via `:!` while the snapshot still
  succeeds) are git's meaningful skipped set. Track those, not the abort.
- ❌ **Don't push abs paths or manifest-entry objects to skipped.** `skipped` is `string[]` of
  workspace-relative POSIX rels — the SAME `rel`/`path` already used in the warn strings and as
  `files` keys. Keep them consistent so the agent's "N skipped/failed" names are unambiguous.
- ❌ **Don't forget `appendExplicitPath`.** It currently `return`s on oversize WITHOUT rewriting the
  manifest (L718), silently losing the path. After the fix it must push `path` into `manifest.skipped`
  (merging onto `(manifest.skipped ?? [])`) and run the mkdir+writeFile rewrite before returning —
  otherwise the explicit-paths incremental flow has a skip-tracking gap.
- ❌ **Don't touch gc()/has().** BUG-006 (P1.M5.T2.S1) resets lastCommit in gc(); BUG-007 (P1.M5.T3.S1)
  serializes has(). Editing them here conflicts with those sibling items. The orphaned-notes
  accumulation under `refs/mulligan/oversize` is bounded by session lifetime and wiped by destroy() —
  acceptable for a best-effort/minor fix.
- ❌ **Don't add a second mutex acquire.** Both new code sites (capture note-write, restore note-read)
  run INSIDE the existing `try { ... } finally { release(); }` mutex block. The note exec calls are
  serialized by the SAME lock as every other store op (spec §4.3).

---

## Confidence Score

**9/10** — This is a localized, well-bounded change to two files (+ their unit tests) where: (a) the
consumer layer (rewind.ts) is ALREADY fully wired to `RestoreResult.skipped` — verified at three cited
lines — so the only work is making the two `restore()` methods populate a bucket that already exists
and is already documented (E29); (b) the CAS change is a backward-compatible optional field on a type
whose parser checks only `version` (no migration risk), with the skip sites identified to the exact
line in three methods; (c) the git change reuses the existing `this.exec`/`shadowEnv()` seam (no new
imports, no new DI surface) and is best-effort with own try/catch — it cannot regress capture/restore;
(d) both test files have proven DI-seam fakes (`makeExec`/`canned` for git, `makeTreeFs`/`makeBackend`
for cas) that drive capture→persist→restore round-trips without real git/disk; (e) the design (git
notes vs sidecar) is chosen specifically for testability + minimal surface, and justified against the
codebase's actual fs-import + DI-seam constraints. The one residual risk: an existing cas test that
asserts the EXACT serialized-manifest key set (rather than specific fields) could break on the new
`skipped` key — mitigated by Task guidance to assert on specific fields, and trivially fixable if
encountered. No upstream coordination needed (rewind.ts unchanged; the parallel P1.M4.T2.S2 item is
test-only on different files).