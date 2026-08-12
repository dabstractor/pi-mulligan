# P1.M2.T1.S1 — Path-safety research notes

Source: external research brief (`.pi/subagents/artifacts/outputs/ea48d717/research.md`)
+ codebase analysis (spec/14 §4.3, spec/14 line 73/221, P1.M1.T1.S1 PRP, tokens.ts pattern).

## 1. The canonical "is path B inside directory A" idiom (cross-platform)

```ts
import { resolve, relative, isAbsolute } from "node:path";

// PURE — no fs, lexical only.
function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
```

`path.relative(base, target)` encodes the escape signal in its return value:
- `""` → target === base (at the root).
- `subdir/x` → inside (no leading `..`).
- `../other` → escapes (starts with `..`).
- `D:\other` → **cross-drive on Windows** (absolute — cannot be expressed relatively).

The `!isAbsolute(rel)` guard is CRITICAL: on Windows, `relative("C:\\a", "D:\\b")` returns
the absolute `"D:\\b"`, which `startsWith('..')` would MISS. This exact idiom is ALREADY used
in `src/config.ts` (P1.M1.T1.S1, the `storageDir` inside-cwd check) — so paths.ts mirrors an
in-repo precedent, not a novel pattern.

## 2. path.resolve semantics (spec-relevant)
- Processes segments right-to-left; the rightmost ABSOLUTE segment discards everything to its left.
- `resolve(root, "/etc/passwd")` → `"/etc/passwd"` (absolute relPath wins — the escape vector).
- `resolve(root, "../../etc")` → lexically collapsed to `/etc`.
- Always returns absolute (falls back to process.cwd() if no absolute base) → always pass
  `workspaceRoot` as the first arg.

## 3. POSIX coercion for normalizeRelPath
`relative(resolve(root), resolve(abs)).split(sep).join("/")` — platform-native `relative`
(correct on Windows drives) then coerce `\\` → `/`. Do NOT use `path.posix.relative` for the
INPUT resolution (it mishandles Windows drive letters); use it only conceptually for output.

## 4. NUL-byte rationale (CWE-158)
A `\0` in a path truncates the string at the C/libuv layer (NUL-terminated `char*`): the JS-level
check sees the full string but the OS acts on the prefix → semantic gap. Node.js fs throws
`ERR_INVALID_ARG_VALUE` ("without null bytes"). The pure module rejects NUL BEFORE any resolution
so it never reaches fs. Reject in `isDangerousWorkspaceRel` via `relPath.includes("\0")`.

## 5. Symlinks — explicitly OUT OF SCOPE (pure module)
All `path.*` ops are lexical (string math), no symlink resolution. A symlink under the workspace
pointing outside is undetectable here. The fs-layer complement (`fs.realpathSync(root)` +
`fs.realpathSync(resolved)` then re-check containment) runs in the BACKENDS (git.ts/cas.ts, P2),
NOT in paths.ts. Documented as a HIGH-severity residual risk that the caller must mitigate.

## 6. isDangerousWorkspaceRel — why it needs NO workspaceRoot
All danger conditions are syntactically detectable in the relative string:
- NUL byte, absolute-looking string, trailing separator, `..` segment, segment ∈ dangerous dirs.
The "absolute path that resolves outside workspace" case is caught TWO ways: (a) directly — a
workspace-rel string that is still absolute (`isAbsolute(relPath)`) is rejected; (b) transitively —
the backends call `normalizeRelPath(root, absPath)` FIRST, which turns an outside-absolute path into
`"../etc/passwd"`, and the `..` segment check then fires. So one-arg signature is sufficient and the
function stays pure/self-contained.

## 7. Design decisions (synthesized)
- **`..` check = "any `..` segment → dangerous"** (NOT depth-tracking). Fail-closed per project
  philosophy; avoids weird snapshot keys containing `..`; agrees with depth-tracking on all
  realistic post-normalization inputs. (Depth-tracking is the "precise" alternative; reject it for
  simplicity + safety.)
- **Dangerous dirs = segment match, case-insensitive.** Catches both `.git/x` and nested
  `src/node_modules/x`; case-insensitive matches macOS/Windows default FS (`.Git` ≡ `.git`).
  Distinguishes `.git` (dir, reject) from `.gitignore` (file, safe) — segment, not prefix.
- **DANGEROUS_DIRS is HARDCODED `[".git",".pi","node_modules"]`**, NOT read from config — paths.ts
  imports NOTHING (zero project deps). Note `.pi` is the safety floor even though it is NOT in the
  default `config.revert.excludeGlobs` (which is the backend's walk-level size/perf exclude, a
  separate layer). DANGEROUS_DIRS ≮ excludeGlobs; they overlap but are independent.
- **resolveSafeWorkspacePath throws ONLY on escape** (`rel.startsWith("..") || isAbsolute(rel)`).
  `rel === ""` (resolved to the workspace root, e.g. relPath `.`) is at-root, NOT an escape → returns
  the root path (contract-faithful: "throws on escape attempt"). The is-this-a-capturable-FILE
  concern is isDangerousWorkspaceRel + the backend fs layer.
- **Error = plain `Error`** with a descriptive message (no custom subclass needed; backends catch
  generically; tests use `expect(...).toThrow()`).
- **Import style**: `import { resolve, relative, isAbsolute, sep } from "node:path";` — mirrors the
  existing `src/config.ts` import (P1.M1.T1.S1) + adds `sep`.

## 8. Independence from P1.M1.T1.S1 (parallel execution)
paths.ts has ZERO imports from config (or any project module). It does NOT consume
`config.revert.*`. The two work items are fully independent and non-conflicting — they can be
implemented in parallel. The config block is consumed by the BACKENDS (git.ts/cas.ts, P2), not by
paths.ts.

## 9. Authoritative URLs (for the PRP references)
- path.resolve — https://nodejs.org/api/path.html#pathresolvepaths
- path.relative — https://nodejs.org/api/path.html#pathrelativefrom-to
- path.isAbsolute — https://nodejs.org/api/path.html#pathisabsolutepath
- path.sep — https://nodejs.org/api/path.html#pathsep
- path module index — https://nodejs.org/api/path.html
- fs.realpathSync (the fs-layer complement) — https://nodejs.org/api/fs.html#fsrealpathsyncpath-options
- ERR_INVALID_ARG_VALUE (NUL-byte rejection) — https://nodejs.org/api/errors.html#err_invalid_arg_value
- CWE-22 Path Traversal — https://cwe.mitre.org/data/definitions/22.html
- CWE-158 Null Byte Injection — https://cwe.mitre.org/data/definitions/158.html
- OWASP Path Traversal — https://owasp.org/www-community/attacks/Path_Traversal