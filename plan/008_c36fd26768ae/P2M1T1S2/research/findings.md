# Research Findings — P2.M1.T1.S2 (detectAndCreate factory)

## 1. Sibling contract: P2.M1.T1.S1 (the file S2 APPENDS to)

`src/snapshot/store.ts` ALREADY EXISTS (S1 implemented in parallel). Verified by reading it in full.
S1 exports (S2 must NOT redeclare — APPEND only):

- `export interface SnapshotStore` — 6 SYNCHRONOUS methods:
  - `describe(): { backend: "git" | "cas" | "none"; reason?: string }`
  - `capture(label: string): string | null`
  - `dirtyCheck(afterRef: string, paths: string[]): string[]`
  - `restore(beforeRef: string, opts: RestoreOpts): RestoreResult`
  - `has(ref: string): boolean`
  - `retire(ref: string): void`
- `export interface RestoreOpts { revertFileChanges: boolean; deleteCreatedFiles: boolean }`
- `export interface RestoreResult { reverted: string[]; deleted: string[]; failed: string[]; skipped: string[]; refused: string[] }`
- `export class AsyncMutex { acquire(): Promise<() => void> }`

store.ts header JSDoc VERBATIM declares clean room: *"Leaves clean room for `detectAndCreate()`
(P2.M1.T1.S2 ... the factory does git-detection I/O via `child_process`; it APPENDS to this same
file). store.ts does NOT define it (GOTCHA #3)."* → S2 appends `detectAndCreate` + `NoOpStore` +
the needed imports to the BOTTOM of this file.

store.ts is currently **import-free**. S2 introduces: `node:child_process` (+ `node:util` promisify),
`node:fs`/`node:path`, a TYPE-ONLY `import type { MulliganConfig } from "../config.js"`, and the
forward-compat dynamic backend imports. This breaks the "import-free" purity — that is EXPECTED and
pre-sanctioned by S1's JSDoc.

## 2. The revert config type (no named export exists)

`src/config.ts` defines `revert` as an INLINE block inside `MulliganConfig` (lines 86–121). There is
NO exported `RevertConfig` type. Two faithful options:
- (A) `import type { MulliganConfig } from "../config.js"` and param type `MulliganConfig["revert"]`
      → NON-INVASIVE (no config.ts edit), DRY, type-only (erased at runtime → no coupling/cycle).
- (B) extract `export interface RevertConfig` in config.ts → touches a P1 file; riskier.

**DECISION: Option A.** Type-only import is erased by tsc → no runtime coupling; config.ts does not
import store.ts so no circular-import risk. This is the standard "indexed access on the canonical
type" pattern.

revert block fields (for the implementer): `enabled`, `allowDeleteCreatedFiles`,
`nonGitMode: "cas"|"explicit-paths"`, `storageDir: string|null` (null ⇒ default
`<sessionDir>/mulligan/`), `maxFileBytes`, `maxTotalBytes`, `maxSnapshotsPerTurn`, `excludeGlobs`.

## 3. sessionDir + storageDir resolution

`revertConfig.storageDir === null` ⇒ default `<sessionDir>/mulligan/` (PRD h2.144 §4.3 + config.ts
doc). detectAndCreate needs a CONCRETE path for the mkdir/access writability check. The caller
(index.ts `session_start`, P3.M1.T2) HAS `ctx.sessionDir`. So: **add `sessionDir?: string | null`
3rd param**; used ONLY when storageDir is null. Keeps the literal `detectAndCreate(cwd, revertConfig)`
contract intact for the non-null-storageDir case. Documented as an explicit contract clarification.

config.ts validation already rejects a storageDir resolving inside cwd (→ null + warn), so by
detectAndCreate time storageDir is either a valid outside-cwd path or null. Still: detectAndCreate
should defensively ensure the resolved storage dir is NOT inside `cwd` before writing to it
(paths.ts `isDangerousWorkspaceRel` / a containment check) — cheap belt-and-suspenders.

## 4. Git detection via promisify(execFile)

Pattern (Node.js built-ins only — NO new deps, confirmed by architecture/external_deps.md §4):
```ts
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(execFileCb);
// ...
try {
  await execFile("git", ["rev-parse", "--git-dir"], { cwd });
  // exit code 0 ⇒ cwd IS a git repo ⇒ use GitBackend
} catch {
  // non-zero exit OR git not installed (ENOENT) ⇒ NOT a git repo
}
```
`promisify(execFile)` REJECTS on non-zero exit (perfect: catch = not-git). ENOENT (no git binary)
also rejects → caught → not-git. Refs:
- https://nodejs.org/api/child_process.html#child_processexecfilecommand-args-options-callback
- https://stackoverflow.com/questions/30763496 (promisify child_process)
Contract says `git rev-parse --git-dir` (exit-0 detection only); the deeper `--show-toplevel` /
`--absolute-git-dir` repo-root resolution happens INSIDE GitBackend (P2.M2.T1), NOT here.

## 5. Storage writability check

`fs.mkdir(dir, { recursive: true })` (creates if missing, no-op if exists) then
`fs.access(dir, fs.constants.W_OK)`. Both throw on failure → caught → NoOpStore ("unwritable").
This is the literal "mkdir -p then access check" from the contract.

## 6. CRITICAL — forward-compatible backend construction (git.ts/cas.ts don't exist yet)

P2.M2.T1 (git.ts) and P2.M3.T1 (cas.ts) are "Planned" — they do NOT exist when S2 is implemented.
A STATIC `import { GitBackend } from "./git.js"` makes tsc FAIL ("Cannot find module './git.js'")
and vitest/rollup fail to resolve at test time. Two viable approaches:

**(A) Dynamic `import()` with a NON-LITERAL specifier (RECOMMENDED):**
```ts
const gitSpec = "./git.js";               // non-literal → tsc does NOT statically resolve
const mod = (await import(gitSpec)) as { GitBackend: GitBackendCtor };
return new mod.GitBackend(cwd, revertConfig);
```
TypeScript ONLY statically resolves `import()` whose argument is a STRING LITERAL. A variable
specifier yields `Promise<any>` → we cast to a local ctor interface. Compiles + tests pass NOW;
resolves to the real module once P2.M2/P2.M3 land. vitest/rollup also skip static analysis of
non-literal specifiers (no module-not-found at transform time).

**(B) `// @ts-expect-error` on literal dynamic import** — uglier, fragile (ts-expect-error must
match a real error or tsc complains). Rejected in favor of (A).

Local ctor interface (so the cast is typed, not `any`):
```ts
interface GitBackendCtor { new (cwd: string, revertConfig: MulliganConfig["revert"]): SnapshotStore; }
interface CasBackendCtor { new (cwd: string, revertConfig: MulliganConfig["revert"], sessionDir?: string | null): SnapshotStore; }
```
NOTE on CasBackend signature: PRD §4 says CasBackend is selected by `config.revert.nonGitMode` and
needs the storage path. Since detectAndCreate resolves the storage dir, pass it through. The exact
CasBackend ctor is finalized in P2.M3.T1; the cast interface is the S2-side contract P2.M3 must
satisfy. (If P2.M3 prefers CasBackend resolve storage internally, detectAndCreate can pass only
`(cwd, revertConfig, sessionDir)` — see PRP "Integration contract note".)

## 7. E28 fail-open (the whole point)

PRD h2.109 (E28) + h2.142: "if the CAS cannot initialize (unwritable storage) → 'none' (revert
unavailable; fail-open)." detectAndCreate's ENTIRE body is wrapped in try/catch; ANY thrown error
(git missing, import fails, mkdir fails, backend ctor throws) ⇒ return NoOpStore. The rewind then
proceeds WITHOUT file revert (context rewind still works). describe().backend === "none" is the
signal the rewind tool checks.

## 8. Test conventions (verified from test/paths.test.ts, banner.test.ts, commands.test.ts)

- vitest; imports use `.js` extension (`from "../src/snapshot/store.js"`) despite
  `moduleResolution:"Bundler"` — house style, ESM-correct.
- `import type` for type-only imports.
- House idiom PREFERS hand-rolled fakes over `vi.fn` for Pi objects; for Node built-ins (child_process,
  fs) real temp dirs (`os.mkdtemp(os.tmpdir()...)`) + real `git init` are fine and used freely
  (test/integration/smoke.ts uses real node:fs).
- Reset idiom: `clearAll()` (runtime) + `setConfig(undefined)` (config). detectAndCreate tests don't
  need runtime reset (no SessionRuntime involvement), but MAY need `setConfig(undefined)` if they
  construct a revert config from DEFAULT_CONFIG.
- No `beforeEach` needed when the module-under-test has no module-scoped mutable state shared across
  tests (store.ts's detectAndCreate is a pure factory — state lives in the returned store instance).

Testable NOW (before P2.M2/P2.M3):
1. NoOpStore: describe()==={backend:"none",...}; capture()===null; dirtyCheck()===[]; restore()===empty
   RestoreResult; has()===false; retire() no-op.
2. detectAndCreate none-path: non-git cwd + unwritable storage ⇒ NoOpStore, reason mentions unwritable.
3. detectAndCreate git DETECTION: in a real temp `git init` repo ⇒ git detected (rev-parse exit 0);
   because git.js doesn't exist yet, the dynamic import rejects ⇒ caught ⇒ NoOpStore (fail-open). This
   ASSERTS current behavior and will FLIP to returning a real GitBackend once P2.M2 lands (document).
4. detectAndCreate fail-open: a forced error (e.g. non-existent cwd) ⇒ NoOpStore, never throws.
5. detectAndCreate non-git + writable storage ⇒ CasBackend path; cas.js not yet present ⇒ import
   rejects ⇒ NoOpStore (fail-open); flips to real CasBackend once P2.M3 lands (document).
6. sessionDir default-resolution: storageDir===null + sessionDir provided ⇒ default dir used for the
   writability check.

## 9. Placement / consumers

- detectAndCreate + NoOpStore live in store.ts (appended).
- Caller: index.ts `session_start` handler (P3.M1.T2.S1) — `const store = await detectAndCreate(ctx.cwd, getConfig().revert, ctx.sessionDir)`; cached on SessionRuntime (P1.M2.T2.S2 added
  `snapshots?: Map` but the STORE itself is cached on a NEW runtime field — see P3.M1.T2, NOT S2's
  concern; S2 only delivers the factory + NoOpStore).
- GitBackend (git.ts, P2.M2.T1) + CasBackend (cas.ts, P2.M3.T1) are the dynamic-import targets.

## 10. Validation commands (verified from package.json)

- `npm test` → `vitest run` (whole suite). Targeted: `npx vitest run test/store.test.ts`.
- `npm run typecheck` → `tsc --noEmit` (strict + noImplicitAny).
- No ruff/mypy (Python tooling) — this is TS. Lint = `tsc --noEmit`.