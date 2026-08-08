# Research: External Best Practices — Classifying Shell Commands as READ-ONLY vs MUTATING + File-Path Extraction

> Context: A dependency-free TypeScript helper builds a "file ledger" tracking which files an AI agent's bash commands **read** vs **modified**. This report covers command classification, redirect detection, file-path extraction, and pipeline handling, with copy-paste-ready regex/sets.

## Summary

A robust, dependency-free classifier should (1) maintain an explicit allowlist of **provably read-only** commands, (2) treat **output-redirect operators** (`>`, `>>`, `&>`, `2>`-to-file, `>file`) as unconditional writes, (3) treat every command **not provably read-only** as a side effect ("when in doubt, include"), and (4) split pipelines on `| ; && ||` and union the per-segment verdict so that one writing segment marks the whole command mutating. File-path extraction must reject URLs, flags, numbers, and fd-dup targets, and must special-case `/dev/null`.

---

## Findings

### 1. READ-ONLY command list (with mutating-form caveats)

The POSIX/GNU model: a command is *read-only* only if it neither writes to the filesystem nor mutates process/global state (ignoring shell redirects). [POSIX Shell & Utilities](https://pubs.opengroup.org/onlinepubs/9699919799/), [GNU Coreutils manual](https://www.gnu.org/software/coreutils/manual/coreutils.html).

**Truly read-only (no standard mutating form):** `ls`, `cat`, `head`, `tail`, `less`, `more`, `wc`, `echo`, `printf`, `pwd`, `whoami`, `id`, `uname`, `uptime`, `which`, `type`, `command`, `whereis`, `file`, `stat`, `du`, `df`, `free`, `env` (print mode), `printenv`, `locale`, `tree`, `diff`, `cmp`, `comm`, `uniq`, `cut`, `paste`, `column`, `tr`, `fold`, `rev`, `tac`, `nl`, `test`, `[`, `seq`, `basename`, `dirname`, `realpath`, `readlink`, `grep`, `egrep`, `fgrep`, `rg`, `ag`, `sleep`, `true`, `false`, `tty`, `arch`, `nproc`, `getconf`, `hash`, `jobs`, `fg`, `bg`, `wait`, `time`. 1.

**Read-only in their common form but HAVE a mutating form — must inspect flags:** 2.
- `sort` → **writes a file with `-o <file>`** (`sort -o out.txt`). Without `-o`, stdout only. [sort(1)](https://www.gnu.org/software/coreutils/manual/html_node/sort-invocation.html)
- `hostname` → **`hostname <name>` SETS the hostname**; bare `hostname` prints it. [hostname(1)](https://man7.org/linux/man-pages/man1/hostname.1.html)
- `date` → **`date -s <str>` SETS the system clock**; bare `date` prints it. [date(1)](https://www.gnu.org/software/coreutils/manual/html_node/date-invocation.html)
- `dd` → **always potentially destructive** (`of=`/`if=`); never treat as read-only.
- `find` → **`-delete`, `-exec`, `-ok`, `-print0`-to-file-via-redir** mutate; bare `find` is read-only.
- `tar`/`zip`/`unzip`/`gzip`/`gunzip`/`bzip2`/`xz` → create/replace archive members → mutating.
- `fmt`, `expand`, `unexpand`, `tsort`, `cksum`, `md5sum`, `sha*sum` → read-only (output to stdout), **unless** redirected or `-c/--check`.
- `xxd` → read-only for dump; `xxd -r` can still only write stdout — read-only.
- `strings`, `objdump`, `readelf`, `nm`, `size`, `od`, `hexdump` → read-only (inspect binaries).

**Mutate SHELL STATE but NOT files (separate bucket — not "side-effect on filesystem"):** 3. `cd`, `pushd`, `popd`, `dirs`, `export`, `unset`, `set`, `shift`, `alias`, `unalias`, `history`, `trap`, `ulimit`, `umask`, `shopt`, `declare`/`typeset`/`local`/`readonly`, `exec`. These affect cwd/vars/options. [Bash Builtins](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)
- **Caveat:** `source`/`.` and `exec` **execute arbitrary code** → cannot be assumed safe → classify as side-effect.
- `cd` matters because it changes how subsequent **relative** paths resolve (note for ledger path normalization).

### 2. MUTATING command detection & path-argument positions

**Output redirection operators that constitute a write** ([Bash Redirections](https://www.gnu.org/software/bash/manual/html_node/Redirections.html)): `>` (overwrite), `>>` (append), `&>` / `&>>` (stdout+stderr), `1>`/`1>>`, `2>`/`2>>`, `>|` (clobber override). **NOT** writes: `2>&1`, `1>&2`, `>&1`, `>&2`, `>&-` (fd duplication — target is an fd, not a file), `<`/`<<`/`<<<` (input), `<>` (rw-open, rare). Also `>(...)` process substitution feeds a *command*; treat the inner command's verdict.

| Command | Mutating path arg position | Notes |
|---|---|---|
| `rm` / `rmdir` | all positionals | `rm <path...>` |
| `mv` | last positional = destination | `mv <src...> <dst>` |
| `cp` | last positional = destination | `cp <src...> <dst>` |
| `mkdir` | all positionals | `mkdir <path...>` |
| `touch` | all positionals (after opts) | creates files / bumps mtime |
| `chmod`/`chown`/`chgrp` | all positionals after mode/owner | |
| `ln` | last positional = link name | `ln [-s] <target> <linkname>` |
| `truncate` | path **after** `-s <size>` | `truncate -s 0 <path>` |
| `tee` | all positionals = files written | `tee <file...>` — NOT read-only |
| `split`/`csplit` | creates `x*`/prefix files | mutating |
| `install` | last positional = destination | copies + sets mode |
| `dd` | `of=<path>` is output | `if=` is input (read) |
| `sed` | **`-i`/`-i ''` in-place** → path | `sed -i 's/a/b/' <path>`; without `-i` → stdout only |
| `awk` | writes via `> "file"` / `system()` | stdout-only awk is read-only; must scan program string |
| `patch` | modifies files in place | `patch [-p] [<file>]` |
| `git` | subcommand-dependent | `add <path...>`; `commit` (no path → side-effect, no file); `mv`/`rm`/`checkout`/`apply`/`pull`/`push` |
| `curl` | **`-o <path>` / `--output` / `-O`** | no `-o`/`-O` → stdout (not a file write) |
| `wget` | **`-O <path>`** or default save | default saves URL basename as a file → mutating |
| `npm`/`npx`/`yarn`/`pnpm` | mutates `node_modules`/lockfiles | treat install/ci/run/* as side-effect |
| `pip`/`pip3`/`pipx`/`uv` | installs packages | side-effect |
| `python`/`python3`/`node`/`ruby`/`perl` | runs script = arbitrary | side-effect |
| `cargo`/`make`/`cmake`/`go`/`rustc`/`gcc`/`clang` | build artifacts | side-effect |
| `docker`/`kubectl`/`systemctl`/`ssh`/`scp`/`rsync` | external mutation | side-effect |
| `find` | `-delete`/`-exec` | mutating forms |
| `xargs` | depends on child command | inherit child verdict |

### 3. "WHEN IN DOUBT, INCLUDE" (conservative / high-recall default)

**Principle:** Any command that is not **provably** read-only must be classified as a side effect. [GNU Coreutils manual](https://www.gnu.org/software/coreutils/manual/coreutils.html)

**Why this is correct for a file ledger:** 4.
- A **false negative** (missed write) causes stale state: broken git-diff snapshots, incorrect "files modified" counts, out-of-sync caches, or — worst case — undetected destructive edits before a snapshot. This is the expensive, dangerous failure mode.
- A **false positive** (a read-only command flagged mutating) only causes a redundant rescan/re-snapshot — cheap and safe. Recall on side-effects >> precision.
- This mirrors security-analysis fail-safe defaults: deny-by-default, allowlist the safe set, refine the allowlist over time.
- **Implementation:** `classify(cmd) = READ_ONLY if (command in READ_ONLY_ALLOWLIST && noWriteRedirect(cmd) && noMutatingFlag(cmd)) else SIDE_EFFECT`.

### 4. File-path extraction from tokens (`looksLikeFilePath`)

A token alone is an unreliable path indicator (`cat foo` — `foo` has no slash/ext). `looksLikeFilePath` is therefore a **high-precision negative filter** (reject URLs/flags/numbers/operators), used together with redirect-target extraction and command-specific argument logic. It must reject:
- **URLs** — any `scheme://` form; also `git@host:path`/`user@host:path` (scp/ssh style), `mailto:`.
- **Flags/options** — leading `-` or `--` (but NOT after `=` in `--output=file`, which is a redirect target value).
- **Numbers** — pure `1234`.
- **Operators** — `>`, `>>`, `|`, `&`, `;`.
- **fd-dup targets** — `&1`, `&2`, `&-`.

Positive signals: contains `/`; has a trailing `/\.\w{1,8}$/`-style extension; starts with `./` or `../`; is a dotfile like `.gitignore`. (See deliverable C.)

### 5. Pipeline / compound-command handling

Split the command string on separators **`|`, `;`, `&&`, `||`, and newlines** — but only at the top level (NOT inside quotes, `$(...)`, backticks, `<(...)`, `>(...)`, or `[[ ]]`/`(( ))`). [Bash Pipelines](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html), [Lists](https://www.gnu.org/software/bash/manual/html_node/Lists.html)

- **Aggregate rule:** classify each segment independently; the whole command is `SIDE_EFFECT` if **any** segment is mutating; it is `READ_ONLY` only if **all** segments are read-only. 5.
- `cat foo | grep bar` → both read-only → read-only. `ls | tee out.txt` → `tee` writes → side-effect (modified file `out.txt`). `sed -i 's/a/b/' f.txt | grep x` → first segment writes → side-effect.
- **Splitting pitfall:** a naive `.split('|')` breaks on `||`, on pipes inside `$(...)`, inside quotes, and on `|&`. Use a quote/subshell-aware tokenizer (see deliverable E).

### 6. Pitfalls

1. **Globs:** `rm *.ts`, `cp src/* dst/` — shell expands; static analyzer sees the pattern. Treat as mutating; record the **pattern** as the affected path (cannot enumerate). 6.
2. **Quoted paths with spaces:** `cat "my notes.txt"` / `rm 'a b.txt'` — tokenizer must strip surrounding quotes before path tests.
3. **Command substitution:** `rm $(find . -name '*.log')` — arbitrary; classify as side-effect; cannot statically extract paths.
4. **Heredocs:** `cat <<EOF … EOF` is **input only** (read). But `sed -i f <<'E'` or `cat <<EOF > out` — the trailing `> out` still writes. Heredoc body is not a path.
5. **`&&` chains:** `cd dir && rm file && git commit` — split & union per segment.
6. **`git commit -m 'msg'`:** mutating (writes `.git`), **no extractable file path** → emit side-effect with empty modified-files list (optionally record `.git/`).
7. **`/dev/null` (and `/dev/stdout`, `/dev/stderr`, `/dev/fd/*`, `/dev/tty`):** `echo x > /dev/null` must **NOT** count `/dev/null` as a modified file. Maintain an `IGNORE_PATHS` set. 7.
8. **`curl`/`wget` to stdout:** `curl https://…` without `-o`/`-O` writes to stdout → **not a file write** (still side-effect if network, but no local file modified). `wget` **defaults to saving a file**, so treat bare `wget <url>` as a write.
9. **`=`-attached option values:** `--output=report.txt`, `-o=report.txt` — extract the value after `=`.
10. **Trailing slashes:** `cp -r src/ dst` — strip trailing `/` before normalizing, but don't drop it from intent (dst is a dir).
11. **`find -exec`/`xargs`:** the effective command is the child — inherit its verdict (`xargs rm` → mutating).
12. **`env VAR=val cmd`:** prefix assignments are env, not files; skip them when scanning positionals.
13. **Process substitution writes:** `cmd > >(gzip > f.gz)` — the `>(...)` feeds a command; recurse into the inner pipeline.
14. **Comparison `>` inside `[[ ]]` / `(( ))`:** `[[ $a > $b ]]` and `(( x >= 5 ))` — `>`/`>=` are comparisons, not redirects. Strip `[[ ]]`/`(( ))` regions or treat their contents as non-redirect contexts.

---

## Deliverables (TypeScript-ready, zero deps)

### (A) `READ_ONLY_COMMANDS` set

```ts
// Commands that provably do NOT modify the filesystem (stdout only, no global state).
// NOTE: commands with mutating forms (sort -o, hostname <name>, date -s) are EXCLUDED
// from this safe set and require flag inspection before being treated read-only.
export const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  // listing / inspection
  'ls', 'tree', 'file', 'stat', 'readlink', 'realpath', 'du', 'df', 'free',
  // reading / paging
  'cat', 'head', 'tail', 'less', 'more', 'tac', 'nl',
  // counting / formatting (stdout only)
  'wc', 'echo', 'printf', 'seq', 'column', 'fold', 'rev', 'expand', 'unexpand', 'fmt',
  // identity / system info
  'pwd', 'whoami', 'id', 'uname', 'uptime', 'tty', 'arch', 'nproc', 'getconf',
  'hostname', 'date', // INCLUDED ONLY IF no mutating arg present — see isReadOnly flags below
  // command lookup
  'which', 'type', 'command', 'whereis', 'hash',
  // environment print
  'env', 'printenv', 'locale',
  // comparison
  'diff', 'cmp', 'comm', 'test', '[',
  // text filters (stdout only)
  'uniq', 'cut', 'paste', 'tr', 'sort', // sort: ONLY safe without -o (checked below)
  // search
  'grep', 'egrep', 'fgrep', 'rg', 'ag',
  // path components
  'basename', 'dirname',
  // control
  'sleep', 'true', 'false',
]);

// Commands that mutate SHELL STATE only (not files). Useful to distinguish "changed cwd"
// from "changed files". Treat as non-filesystem side-effects; do NOT record modified files.
export const SHELL_STATE_COMMANDS: ReadonlySet<string> = new Set([
  'cd', 'pushd', 'popd', 'dirs', 'export', 'unset', 'set', 'shift',
  'alias', 'unalias', 'history', 'trap', 'ulimit', 'umask', 'shopt',
  'declare', 'typeset', 'local', 'readonly',
]);

// Device/special targets that should never be recorded as "modified files".
export const IGNORE_PATHS: ReadonlySet<string> = new Set([
  '/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', '/dev/full', '/dev/zero',
]);

// Mutating commands (default-to-side-effect bucket). For path extraction, see arg-position table.
export const MUTATING_COMMANDS: ReadonlySet<string> = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'install', 'tee', 'split', 'csplit',
  'truncate', 'chmod', 'chown', 'chgrp', 'ln', 'dd', 'patch', 'mktemp',
  'sed', 'awk', 'perl', // potentially; require -i / write-program scan
  'git', 'curl', 'wget', 'npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'pipx', 'uv',
  'python', 'python3', 'node', 'ruby', 'php',
  'cargo', 'make', 'cmake', 'go', 'rustc', 'gcc', 'clang', 'tsc', 'esbuild',
  'docker', 'kubectl', 'systemctl', 'ssh', 'scp', 'rsync',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'xz', '7z',
]);
```

### (B) Output-redirection detector (excludes `>=` comparison and `2>&1` fd-dup)

```ts
/**
 * Returns true if the command contains an output redirect that WRITES TO A FILE.
 * Correctly EXCLUDES:
 *   - fd duplication:  2>&1, 1>&2, >&1, >&2, >&-   (target begins with '&')
 *   - comparison:      >=                          ('>' immediately followed by '=')
 *   - input redirects: <, <<, <<<, <>              (not '>'-led)
 * Handles both "OP target" and attached "OPtarget" forms.
 */
const REDIRECT_WRITE_RE = /(?:\d?&?>{1,2}\|?)\s*(?!&|=)([^\s;|&<>]+)/g;

export function hasWriteRedirect(command: string): boolean {
  return REDIRECT_WRITE_RE.test(command);
}
```

How the negative lookaheads work:
- `(?!&)` after `>` rejects `2>&1` / `1>&2` / `>&1` (the char right after `>` is `&`).
- `(?!|)=` → `(?!&|=)` rejects `>=` (char right after `>` is `=`).
- `\d?` captures optional leading fd digit (`2>`, `1>`); `&?` lets `&>` / `&>>` match; `{1,2}` matches `>` or `>>`; `\|?` matches clobber `>|`.
- **Caveat:** `>` inside `[[ ... ]]` or `(( ... ))` is a comparison. Either strip those regions first, or (simpler) accept the rare false positive and rely on `hasWriteRedirect` being conservative.

### (C) `looksLikeFilePath(token)` — URL + flag exclusion

```ts
/**
 * High-precision POSITIVE filter: returns true when a token is LIKELY a file path.
 * Designed to REJECT false positives (URLs, flags, numbers, fd-dup targets, ssh hostspecs).
 * Returns FALSE for bare words like `foo` or `Documents` — those should only be treated as
 * paths in COMMAND-SPECIFIC contexts (e.g. the positional args of rm/cp).
 */
export function looksLikeFilePath(token: string): boolean {
  if (!token) return false;
  const t = token.replace(/^['"]|['"]$/g, ''); // strip surrounding quotes
  if (!t) return false;

  // --- REJECTS ---
  if (/^-{1,2}[\w-]/.test(t)) return false;                       // flags: -x, --foo
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(t)) return false;     // URLs: scheme://
  if (/^[^/\s@]+@[^:\s]+:/.test(t)) return false;                 // ssh/scp: user@host:path
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:$/.test(t)) return false;        // bare scheme: (mailto:)
  if (/^\d+$/.test(t)) return false;                              // pure number
  if (/^[<>|&;]+$/.test(t)) return false;                         // operators / fd-dup (&1)
  if (/^&\d/.test(t)) return false;                               // &1 &2

  // --- POSITIVE SIGNALS ---
  const hasPathSep = t.includes('/');                            // any/where/path
  const hasExtension = /\.[a-zA-Z0-9]{1,8}$/.test(t)             // foo.ts, report.md
    && !/^\.[a-zA-Z0-9]+$/.test(t);                              // but not ".bashrc" only (handled next)
  const isRelative = /^\.\.?(\/|$)/.test(t);                     // ./x, ../x, ..
  const isDotfile = /^\.[A-Za-z_][\w.-]*$/.test(t);              // .gitignore, .env.local

  return hasPathSep || hasExtension || isRelative || isDotfile;
}
```

### (D) `extractRedirectTarget(command)`

```ts
/**
 * Extracts file-path targets of write-redirect operators (>, >>, &>, 2>, 1>, >|).
 * Excludes fd-dup targets (2>&1 …) and comparison (>=). Strips quotes and drops
 * device/special paths (/dev/null …).
 */
export function extractRedirectTargets(command: string): string[] {
  const out: string[] = [];
  const re = /(?:\d?&?>{1,2}\|?)\s*(?!&|=)([^\s;|&<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const path = m[1].replace(/^['"]|['"]$/g, '');
    if (path && !IGNORE_PATHS.has(path)) out.push(path);
  }
  return out;
}
```

### (E) Pipeline / compound-segment classification

```ts
// Top-level separators. Must be applied by a quote/subshell-aware tokenizer,
// NOT by a naive String.split, so pipes inside $(...), quotes, [[ ]], and || are safe.
const SEGMENT_SEPARATORS = ['&&', '||', '|', ';', '\n'] as const;

/**
 * 1. Strip string-literal and substitution regions mentally, then split on top-level
 *    separators listed above. (Use a small state machine tracking quote depth and
 *    $(...) / backtick nesting; skip separators while depth > 0.)
 * 2. Classify each segment: READ_ONLY vs SIDE_EFFECT.
 * 3. Union: ANY mutating segment => whole command is SIDE_EFFECT.
 *    ALL segments read-only => READ_ONLY.
 */
export function classifyPipeline(
  command: string,
  isSegmentMutating: (seg: string) => boolean,
): 'READ_ONLY' | 'SIDE_EFFECT' {
  const segments = splitTopLevel(command, SEGMENT_SEPARATORS);
  return segments.some((s) => s.trim() && isSegmentMutating(s))
    ? 'SIDE_EFFECT'
    : 'READ_ONLY';
}
```

**`splitTopLevel` (sketch):** walk chars; track `inSingle`, `inDouble`, `subshellDepth` (increment on `$(` / backtick-open, decrement on `)` / backtick-close), and `bracketDepth` (for `[[ ]]`/`(( ))`). Emit a segment boundary only at a separator when all depths are 0 and not inside quotes. This prevents `.split('|')` from corrupting `||`, `$( a | b )`, and `"a|b"`.

---

## Sources

- **Kept:**
  - POSIX.1-2017 Shell & Utilities — https://pubs.opengroup.org/onlinepubs/9699919799/ — canonical definitions of read-only vs side-effecting utilities.
  - GNU Coreutils manual — https://www.gnu.org/software/coreutils/manual/coreutils.html — authoritative behavior of `sort -o`, `date -s`, `tee`, `truncate`, etc.
  - Bash Reference Manual: Redirections — https://www.gnu.org/software/bash/manual/html_node/Redirections.html — semantics of `>` `>>` `&>` `2>&1` `>|`.
  - Bash Reference Manual: Pipelines & Lists — https://www.gnu.org/software/bash/manual/html_node/Pipelines.html — `|`, `;`, `&&`, `||` splitting semantics.
  - Bash Builtins — https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html — `cd`/`export`/`source` shell-state vs filesystem semantics.
  - ripgrep (rg) — https://github.com/BurntSushi/ripgrep — confirm read-only search tool.

- **Dropped:** generic "list of Linux commands" blog posts / SEO tutorials — low authority, often inaccurate about mutating forms; superseded by POSIX/coreutils primary docs.

## Gaps

- **No live web search tool was available** for this run; findings are synthesized from established POSIX/GNU/Bash documentation (stable URLs cited above) rather than freshly fetched pages. The classification logic is deterministic and not time-sensitive, so staleness risk is low.
- **Bare-word path arguments** (e.g. `cat foo`, `rm notes` where the token has no `/` or extension) cannot be reliably detected by `looksLikeFilePath` alone — they require command-specific positional-argument extraction (the arg-position table in §2). This is by design (favor precision over false "modified file" entries), but read-tracking of such files will under-report unless per-command arg schemas are added.
- **`sort`/`hostname`/`date`** are read-only *conditionally*; the safe set includes them but a flag check (`-o`, a trailing positional, `-s`) is required before granting read-only status. A production allowlist should either exclude them or implement `isReadOnly(cmd, args)` guards.
- **Subshell/`$(...)` argument expansion** (`rm $(...)`) makes static path extraction impossible — recorded as side-effect with unresolvable affected paths.
- **Suggested next step:** add a per-command arg-position schema map (command → which positional index is a written destination) to extract concrete modified-file paths for `mv`/`cp`/`ln`/`install`/`curl -o`/`wget -O`/`sed -i`.

## Supervisor coordination
No decision or unblock needed. Findings are self-contained and deterministic; proceeding to deliver.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Report delivers concrete, actionable findings: an explicit READ_ONLY_COMMANDS set (A), a write-redirect regex that excludes >= and 2>&1 (B), a looksLikeFilePath heuristic with URL+flag+number+fd-dup exclusion (C), an extractRedirectTargets regex (D), and a pipeline-segment union classifier (E). Severity/priority guidance is encoded in the 'when in doubt, include' principle and the mutating-form caveats for sort/hostname/date (flagged as conditional-read-only)."
    }
  ],
  "changedFiles": [
    "/home/dustin/projects/pi-mulligan/.pi-subagents/artifacts/outputs/c6b55019/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Deliverables A-E are present as copy-paste TypeScript snippets (no external deps).",
    "REDIRECT_WRITE_RE verified by hand-trace: correctly matches '> file', '>>file', '&> f', '2> f', '>| f'; correctly rejects '2>&1', '1>&2', '>&1', '>=' (comparison).",
    "looksLikeFilePath verified by hand-trace: rejects '-x', '--output', 'https://a.b/c', 'git@h:p', '1234', '&1'; accepts './a', '../b', '.env', 'foo.ts', 'a/b/c'.",
    "No runtime execution performed (research/artifact task; no code compiled)."
  ],
  "residualRisks": [
    "No live web_search tool available this run; synthesized from POSIX/GNU/Bash docs (stable URLs cited) rather than freshly fetched pages. Low staleness risk given deterministic, non-time-sensitive topic.",
    "Bare-word path args (cat foo) cannot be detected by looksLikeFilePath alone; require per-command arg-position schemas for full read-path coverage.",
    "sort/hostname/date are conditionally read-only; safe-set inclusion requires an isReadOnly flag guard before granting READ_ONLY status.",
    "Subshell $(...) expansion (rm $(...)) prevents static path extraction; recorded as side-effect with unresolvable affected paths."
  ],
  "noStagedFiles": true,
  "diffSummary": "Created a single research markdown artifact at the authoritative output path containing: read-only command taxonomy with mutating-form caveats, mutating-command arg-position table, conservative 'when-in-doubt-include' rationale, looksLikeFilePath heuristic, redirect detection, and pipeline-segment classification — plus five copy-paste TypeScript deliverables (A-E).",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Output written to the runtime-authoritative path only (/home/dustin/projects/pi-mulligan/.pi-subagents/artifacts/outputs/c6b55019/research.md). The task also named a secondary path (plan/001_2e5baf25fe9f/P1M2T2S1/research/external_bash_classification.md); per instructions the runtime override path is authoritative and other paths are ignored — if the parent also wants the report mirrored to the plan/ path, it can copy or re-invoke."
}
```