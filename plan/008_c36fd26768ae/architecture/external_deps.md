# External Dependencies & APIs — v1.2 Working-Tree Revert

## 1. Git CLI (the shadow-repo backend)
The `GitBackend` (src/snapshot/git.ts) uses `child_process.execFile("git", ...)` with environment overrides:

### Shadow repo setup
```
GIT_DIR=<storageDir>/<key> GIT_WORK_TREE=<repoRoot> git init --bare
```
- One shadow repo per source worktree, keyed by repo root
- `<storageDir>` defaults to `<sessionDir>/mulligan/` (MUST NOT be inside `cwd`)
- `<key>` is derived from the repo root path (safe-hash)

### Capture
```
GIT_DIR=<shadow> GIT_WORK_TREE=<repoRoot> git add --all -f -- ':!excludeGlob1' ':!excludeGlob2'
GIT_DIR=<shadow> GIT_WORK_TREE=<repoRoot> git write-tree     → <tree-sha>
GIT_DIR=<shadow> git commit-tree <tree-sha> -p <parent> -m "snapshot:<label>" → <commit-sha>
GIT_DIR=<shadow> git update-ref refs/mulligan/snapshots/<label> <commit-sha>
```
- `--all -f` forces gitignored files INTO the snapshot (`.gitignore` deliberately NOT consulted)
- Pathspec negations from `excludeGlobs` (e.g. `:!node_modules`)
- Protected refs under `refs/mulligan/snapshots/` namespace

### Source repo reads (ONLY read-only command against source .git)
```
git rev-parse --git-dir    → <sourceGitDir> (ONLY for detection, never written to)
```

### Dirty check
```
GIT_DIR=<shadow> git diff --name-only <afterRef> -- <paths>   → drifted paths
```

### Restore (working-tree ONLY)
```
GIT_DIR=<shadow> GIT_WORK_TREE=<repoRoot> git read-tree <beforeRef>
GIT_DIR=<shadow> GIT_WORK_TREE=<repoRoot> git checkout -- <paths>
```
- NEVER touches source index/refs — the five git-safety guarantees

### Five git-safety guarantees (spec/14 §3)
1. The ONLY command against `sourceGitDir` is read-only `rev-parse`
2. All writes target the shadow repo (`GIT_DIR=<shadow>`)
3. User's `.git` is byte-identical after every op
4. Restore writes only the working tree (no source index/refs)
5. Refuse-on-dirty pre-flight before any restore

### GC / cleanup
```
GIT_DIR=<shadow> git update-ref -d refs/mulligan/snapshots/turn/*  (prompt-boundary GC)
GIT_DIR=<shadow> git gc --auto --prune=now
```
- Checkpoint refs (`refs/mulligan/snapshots/checkpoint/<name>`) are exempt from prompt-boundary GC
- `session_shutdown`: delete the entire shadow repo directory

## 2. Node.js fs APIs (the CAS backend)
The `CasBackend` (src/snapshot/cas.ts) uses:
- `fs.promises.readdir` / `fs.statSync` — whole-tree walk (cas mode)
- `fs.promises.readFile` / `fs.promises.writeFile` — content capture + blob storage
- `crypto.createHash("sha256")` — content-addressed hashing
- `fs.promises.unlink` — file deletion (restore deleteCreatedFiles)
- `fs.promises.rm(dir, {recursive:true})` — CAS teardown

### CAS manifest format
```json
{
  "version": 1,
  "label": "turn",
  "turnIndex": 5,
  "ts": 1700000000000,
  "files": {
    "src/foo.ts": { "hash": "abc123...", "size": 1024, "mtime": 1700000000, "existed": true },
    "src/bar.ts": { "hash": "def456...", "size": 512, "mtime": 1700000001, "existed": true }
  }
}
```

### mtime/size short-circuit (cas mode steady-state)
Compare `stat.mtimeMs` + `stat.size` against the previous manifest entry. If unchanged, reuse the stored hash (O(changed-files) instead of O(all-files)).

## 3. Pi Event Surface (verified in dist/core/extensions/types.d.ts)
| Event | Handler signature | v1.2 use |
|-------|------------------|----------|
| `turn_start` | `(event: TurnStartEvent, ctx: ExtensionContext) => void` | GC + before-snapshot capture |
| `agent_end` | `(event: AgentEndEvent, ctx: ExtensionContext) => void` | after-snapshot capture (drift detection) |
| `session_start` | `(event, ctx) => void` | GC pass to clear stale turn/* refs |
| `session_shutdown` | `() => void` | wipe shadow repo / CAS dir |

## 4. TypeScript / Build Dependencies
- **typebox** (peer dep) — `Type.Object`, `Type.Optional`, `Type.Boolean` for the new RewindParams fields
- **Node.js >=22.19.0** — `child_process.execFile`, `fs.promises`, `crypto`, `structuredClone`
- **vitest** — test runner (already used for the existing suite)
- **No new npm dependencies** — the snapshot subsystem uses only Node.js built-ins

## 5. No Pi API surface changes
The extension does NOT add new agent tools. It adds:
- 2 optional params on `mulligan_rewind` (`revert_file_changes`, `delete_created_files`)
- 2 new event handlers (`turn_start`, `agent_end`) — only active when `config.revert.enabled`
- 1 new internal subsystem (`src/snapshot/`)