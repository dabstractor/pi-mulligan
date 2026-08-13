# P1.M2.T1.S1 (plan/009) — Integration verification + subdir-not-promoted assertion: research notes

Source: plan/009 architecture/test_strategy.md (the authoritative change inventory), src/snapshot/store.ts
(detectAndCreate), test/integration/revert-edge.test.ts + revert-git.test.ts (structure/helpers), the
P1.M1.T4.S1 PRP (parallel code contract), spec/14 §2 (SAFETY INVARIANT).

## 1. What this task is (test-only)
P1.M2.T1.S1 is the INTEGRATION VERIFICATION for the detection-safety-hardening plan (plan/009). It runs
AFTER all P1.M1 code is complete (M1.T1–T4; per plan_status M1.T1/T2/T3 are Complete, M1.T4 is Implementing
in parallel — assume done per the parallel_execution_context contract). It does THREE things and ONLY three:
  (1) `npm test` — the FULL suite (unit + integration) must be green (M1's detection rewrite must not
      break the existing revert-git/cas/explicit/edge integration tests, which assert backend type — preserved).
  (2) ADD one assertion to test/integration/revert-edge.test.ts: a subdirectory under a git PARENT (no own
      .git) → detectAndCreate(subdir) → backend === "cas" (NOT "git"). This is the end-to-end proof that
      upward repo discovery is gone (the core §2 SAFETY INVARIANT).
  (3) Confirm no `git rev-parse` is issued during detection (code-review grep + rely on the store.test.ts
      unit assertion landed by M1.T2.S1).

## 2. The detection model (consumed from M1 — do NOT reimplement)
`detectAndCreate(cwd, revertConfig, sessionDir?)` (store.ts:443), fully implemented by M1.T2.S1:
  (1) root = realpathSync(cwd); catch → NoOpStore("workspace root could not be resolved …")
  (2) if isForbiddenRoot(root) → NoOpStore("workspace root is forbidden …")      [§2 SAFETY INVARIANT]
  (3) if existsSync(join(root, ".git")) → GitBackend(root, …)                    [LEXICAL — no rev-parse]
  (4) else → resolveStorageDir + mkdir -p + access(W_OK); fail → NoOpStore; else CasBackend(root, …)
  (5) catch → NoOpStore(summarize(msg))                                           [E28 fail-open, never rethrows]
NO execFile, NO rev-parse, NO upward walk anywhere in detection. (git.ts/cas.ts each add a restore() entry
guard re-checking isForbiddenRoot(this.cwd) — that is the LAST line of defense, independent of detection.)

## 3. detectAndCreate signature (to call it in the test)
```ts
export async function detectAndCreate(
  cwd: string,
  revertConfig: MulliganConfig["revert"],
  sessionDir?: string | null,
): Promise<SnapshotStore>
```
`store.describe()` → `{ backend: "git" | "cas" | "none"; reason?: string }` (sync, pure metadata). My test
passes `(subdir, getConfig().revert)` — NO sessionDir (storageDir is set in config → resolveStorageDir uses
it directly, never the null-sessionDir path).

## 4. revert-edge.test.ts structure (the file being edited)
- Imports: vitest (describe/it/expect); node:fs (mkdtempSync, …); tmpdir (node:os); join (node:path);
  execFile/promisify; makeCheckpointCommand; `detectAndCreate, type SnapshotStore` (line 57);
  getRuntime/resetRuntime/clearAll; setConfig/getConfig; type RevertCheckpoint. (writeFileSync/readFileSync
  are imported — F-revert-reload uses them. existsSync MAY need adding to the node:fs destructure.)
- Helpers (file-scoped, all reusable):
    `git(cwd, args)`              — promisified execFile("git", args, {cwd, maxBuffer})
    `gitAvailable()`              — `git --version` skip-guard (tests needing real `git init` return early if false)
    `makeRepo(prefix)`            — mkdtempSync + `git init -b main` → a REAL git repo dir (.git present)
    `makeStorage()`               — a SEPARATE mkdtempSync dir for snapshot storage (config rejects storage inside cwd)
    `VALID_NOTE`                  — the canonical 3-field note
- `describe("F-revert-* edge integration (spec/14 §6 + §2 / spec/08 E32)", () => { … })` — line 392.
  Two `it` cases inside: F-revert-granularity (395), F-revert-reload (455). The describe CLOSES at line 662.
- before/afterEach reset `setConfig(undefined)` (349/354). Temp-dir cleanup: match the F-revert-reload case
  (revert-git.test.ts uses a `dirs` array + afterEach rm; revert-edge.test.ts's exact teardown — read + mirror).

## 5. The canonical backend-assertion pattern (mirror it exactly — from revert-git.test.ts:376-380)
```ts
const storageDir = makeStorage();
setConfig({ revert: { enabled: true, storageDir } });
const store = await detectAndCreate(repoDir, getConfig().revert);
expect(store.describe().backend).toBe("git");
```
My test is identical EXCEPT: detect on a SUBDIR of a git parent, assert `"cas"` (NOT `"git"`).

## 6. The new assertion (the deliverable) — exact shape
- PLACEMENT: a new `it` at the END of the existing describe (just before the final `});` at line 662), so it
  shares the in-scope helpers. (A separate top-level describe is also fine since helpers are file-scoped —
  but inside the existing describe is cleanest.)
- The subdir MUST be created INSIDE the parent git repo with NO own .git. `mkdtempSync(join(parentRepo, "sub-"))`
  does exactly this (a fresh temp dir under the parent — no .git) and needs NO new import (mkdtempSync is used).
- The subdir is depth ≥ 2 (under /tmp/...) → NOT forbidden → CAS (not NoOp). Pass an explicit storageDir so
  resolveStorageDir never hits the null path.
- The backend==="cas" assertion IS the proof: if detection used `git rev-parse --show-toplevel`, git would
  walk UP from the subdir, find the parent's .git, return the parent as repoRoot → GitBackend. Lexical
  detection sees no .git in the subdir → CAS. So "cas" ⟹ no upward discovery. Elegant + end-to-end.

## 7. "Confirm no rev-parse" (contract point 3) — how
Three complementary checks (NOT all must be coded; the grep + reliance on store.test.ts suffice):
  (a) CODE-REVIEW GREP: `grep -n "execFile\|rev-parse" src/snapshot/store.ts` → detectAndCreate (443-490)
      contains NONE (it uses realpathSync/isForbiddenRoot/existsSync/mkdir/access/dynamic import only).
      If the grep shows a leftover execFile IMPORT in store.ts, that's an M1.T2.S1 cleanup miss — flag it,
      but it does not affect THIS task (detectAndCreate's BODY doesn't call it).
  (b) UNIT LEVEL (already done — M1.T2.S1 Complete): test/store.test.ts asserts "no rev-parse call recorded
      by the exec fake" + detectAndCreate on a temp .git dir → git, on a non-.git dir → cas, on home/"/" → none.
  (c) INTEGRATION LEVEL (THIS task): the subdir→cas assertion is the end-to-end no-upward-discovery proof.

## 8. Relationship to siblings (do NOT do their work)
- M1.T1–T4 (code): isForbiddenRoot + detectAndCreate rewrite + both backends' realpath+restore guard. DONE
  (T4 Implementing, assume complete). My task VERIFIES, doesn't write code.
- M2.T2.S1/S2 (README docs): the Mode-B safety paragraph + stale-reference sweep. SEPARATE — do not touch README.
- store.test.ts (the "no rev-parse recorded" UNIT assertion + detectAndCreate temp-dir cases): owned by
  M1.T2.S1 (Complete). Do NOT duplicate it in the integration test.
- Scope: ONE test file (test/integration/revert-edge.test.ts) + the `npm test` run. No source changes.

## 9. Validation
- `npm run typecheck` clean.
- `npm test` full suite green (1277+ tests incl. the new revert-git/cas/explicit/edge + the store/cas/git
  unit tests landed by M1).
- `npx vitest run test/integration/revert-edge.test.ts -t "subdir"` → my new case green.
- The new case FAILS if upward discovery were re-introduced (subdir would resolve to the parent → "git").