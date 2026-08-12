# P1.M4.T1.S2 Research Notes — changedPaths in GitBackend

## Contract source (what S1 produces — treated as ground truth)

`plan/.../P1M4T1S1/PRP.md` adds to `src/snapshot/store.ts`:

- `SnapshotStore` interface: `changedPaths(beforeRef: string): Promise<string[]>;` (placed after
  `dirtyCheck`, before `restore`), with JSDoc citing spec/14 §6 step 2 + BUG-004, git algo
  (`git diff --name-only`), cas algo (hash-compare manifest), best-effort never-rejects, consumer =
  rewindExecute step 6b.
- `NoOpStore`: `async changedPaths(_beforeRef: string): Promise<string[]> { return []; }`.

S1's success signal is that `tsc --noEmit` fails on **exactly two** files — `git.ts` and `cas.ts` —
with "Property 'changedPaths' is missing". **S2 resolves the git.ts error** (S3 resolves cas.ts). So
on S2's success, `npm run typecheck` should show **exactly ONE** remaining error (cas.ts only).

## The pattern to mirror: `GitBackend.dirtyCheck` (src/snapshot/git.ts)

dirtyCheck is the closest analog — same try/catch/finally/mutex, same shadowEnv, same
split/trim/filter. changedPaths differs in exactly THREE ways:

| aspect              | dirtyCheck                                  | changedPaths (S2)                          |
|---------------------|---------------------------------------------|--------------------------------------------|
| git argv            | `diff --name-only <afterRef> -- <paths>`    | `diff --name-only <beforeRef>`             |
| path scope          | caller-supplied `paths` (after `--`)        | NONE (no `--`, no paths — ALL files)       |
| diff-filter         | none                                        | none (do NOT add `--diff-filter=MD`)       |
| early-return guard  | `if (!afterRef || paths.length === 0) []`   | `if (!beforeRef) []`                       |
| ref compared        | `afterRef`                                  | `beforeRef`                                |

Verbatim dirtyCheck structure to copy (src/snapshot/git.ts):

```ts
async dirtyCheck(afterRef: string, paths: string[]): Promise<string[]> {
  const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
  try {
    await this.ensureInit();
    if (!afterRef || paths.length === 0) return []; // no drift baseline / nothing to check ⇒ allow
    const out = await this.exec("git", ["diff", "--name-only", afterRef, "--", ...paths.filter(...)], this.shadowEnv());
    return out.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  } catch (err) {
    console.warn(`[mulligan] snapshot.dirtyCheck failed: ${...}`);
    return [];
  } finally {
    release();
  }
}
```

`this.shadowEnv()` returns `{ env: {...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot}, maxBuffer: 16*1024*1024 }`.

## Why `git diff --name-only <beforeRef>` is correct (and why NOT `--diff-filter=MD`)

- Authoritative semantics (https://git-scm.com/docs/git-diff): *"This form is to view the changes
  you have in your working tree relative to the named `<commit>`."* i.e. `git diff <commit>` compares
  the **commit's tree** against the **working tree**. It does **not** consult the index, so it is
  robust to index state (e.g. a prior `restore()` that ran `read-tree` and polluted the shadow index).
- With GIT_DIR=shadowDir + GIT_WORK_TREE=repoRoot (shadowEnv), the "commit" is the shadow-repo capture
  SHA and the "working tree" is the user's repoRoot. This is the SAME proven mechanism dirtyCheck uses;
  changedPaths just drops the path scope.
- `--name-only` → list of changed paths, one per line. Default `--diff-filter` includes **A**dded,
  **D**eleted, **M**odified (+ R/C) — exactly the full set restore touches (modified+deleted reverted;
  created optionally deleted). Spec/14 §6 step 2 = "paths that differ between beforeRef and the current
  tree (the files restore would touch)".
- **Do NOT use `--diff-filter=MD`**: that is restore()'s index-vs-worktree step AFTER `read-tree`
  (src/snapshot/git.ts restore step b), where the index === beforeRef so MD = modified/deleted vs
  beforeRef. For a standalone beforeRef-vs-worktree query it would **MISS span-created (Added) files**,
  re-introducing the exact BUG-004 under-coverage gap (created files would be reverted/deleted by
  restore but never inspected by the dirty guard). No filter = full coverage.
- **No `--` separator**: `--` is only needed to disambiguate pathspecs from revisions. changedPaths
  passes NO paths, so `git diff --name-only <beforeRef>` (no `--`) is the minimal correct form.

## Placement in git.ts

Current order: capture → shadowEnv(private) → dirtyCheck → has → retire → destroy → gc → restore.
Insert changedPaths **immediately after dirtyCheck() and before has()** — mirrors the interface order
(S1 placed it "after dirtyCheck, before restore") and groups the two diff-based query methods
(dirtyCheck = drift vs afterRef scoped to paths; changedPaths = diff vs beforeRef over all paths).

## Test pattern (test/git.test.ts) — DI exec fake

The suite uses `makeBackend(calls, cfg, scan, canned)` where `canned.stdoutByCmd` keys canned stdout by
`args[0]`. dirtyCheck/changedPaths both emit `args[0]==="diff"`, so `stdoutByCmd: { diff: "a.ts\nb.ts\n" }`
works for both. `findCmd(calls, "diff")` returns the recorded diff call; assert `args`, `opts.env.GIT_DIR`,
and (critical for changedPaths) `not.toContain("--diff-filter")` + `not.toContain("--")`. `throwOn:
{cmd:"diff", call:1}` simulates a failing diff → asserts best-effort `[]`. `expectedShadow(storageDir)`
= `<storageDir>/<sha256("/fake/repo").slice(0,16)>`.

## Scope boundaries (what S2 does NOT touch)

- `src/snapshot/cas.ts` (CasBackend.changedPaths) → S3 (P1.M4.T1.S3). Its typecheck error is EXPECTED
  to remain after S2.
- `src/tools/rewind.ts` (wiring changedPaths into step 6b) → P1.M4.T2.S1.
- `src/snapshot/store.ts` (interface + NoOpStore) → already done by S1; do NOT re-edit.
- No exported types, no config, no API surface change (Mode A — method + JSDoc only).