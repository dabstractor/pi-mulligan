# PRP — P1.M1.T3.S1: Structured JSONL logger (`src/log.ts` + `test/log.test.ts`)

**Work item:** P1.M1.T3.S1 · **Points:** 1 · **Stage:** Foundation & Infrastructure → Structured JSONL Logger
**Scope:** **CREATE** two new files only — `src/log.ts` (the logger) and `test/log.test.ts` (its unit suite).
**Do NOT modify** `src/config.ts`, `src/index.ts`, or anything else (see *Scope decision* below).

---

## Goal

**Feature Goal**: Ship Mulligan's structured, append-only JSONL logger as a **self-contained, Pi-free,
config-free** module (`src/log.ts`) that writes one `LogLine`-shaped JSON object per event to a configurable
file, is a silent **no-op when no file is configured**, and is **fail-open** — a bad path, an unwritable
destination, or a circular/BigInt `data` payload can **never** crash the extension (it writes a short note to
`process.stderr` and swallows instead).

**Deliverable** (two new files):
1. `src/log.ts` exporting:
   - `type Level = "debug" | "info" | "warn" | "error"`
   - `interface LogLine { ts: string; level: Level; event: string; sessionId: string; data?: unknown }`  *(spec/04 §9, verbatim)*
   - `function log(level, event, sessionId, data?): void` — the core writer.
   - `function logInfo/logDebug/logWarn/logError(event, sessionId, data?): void` — level-curried helpers.
   - `function setLogFile(path: string | null): void` — configure the destination (`null` = off).
2. `test/log.test.ts` — a vitest suite that writes to a temp file, reads it back, and asserts the **LogLine
   shape**, **append-only** behavior, the **no-op-when-null** default, the **four levels**, the **fail-open**
   paths (ENOENT / EISDIR / circular data / BigInt data), and **convenience-helper currying**.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (proves the new module + test are type-sound under `strict`).
- `npx vitest run` is **all-green** — the new `log` suite **and** the pre-existing `config` suite (this is a
  pure, dependency-free module; it cannot regress config).
- `src/log.ts` imports **nothing** from Pi and **nothing** from `config.ts` (breaks the config↔log cycle):
  `grep -c '@earendil-works/pi-coding-agent' src/log.ts` → **0**; `grep -c 'from ".*config' src/log.ts` → **0**.
- A bad path / circular `data` / BigInt `data` **never throws** (adversarial suite green) — spec/03 principle
  #4 ("Fail open") and spec/09 §4 ("a bad path must not crash the extension") honored.

---

## User Persona

**Target User**: (a) The implementing AI agents for **every downstream runtime module** (`filter.ts`,
`tools/*`, `nudges.ts`, `markers.ts`, `index.ts` — all later subtasks), and (b) the human operator debugging
Mulligan in a non-TUI / headless `pi -p` run, who sets `"mulligan": { "log": { "file": "/abs/path.jsonl" } }`
to get an audit trail of `filter.fire`, `rewind.applied`, `nudge.inject`, … events.

**Use Case**: At runtime, handlers call `logInfo("filter.fire", sessionId, { before, after })` (or the
debug/warn/error variants). Each call appends one JSON line to the configured file. With no file configured
(the default), every call is an instantaneous no-op — zero disk chatter, zero overhead. The integration smoke
harness (P1.M7.T2) reads this same JSONL to assert the F-* scenarios (spec/10 §2.1: "Log every
`context.fire`").

**User Journey**:
1. Pi loads the extension; `index.ts` (P1.M7.T1) reads `getConfig().log.file` and calls `setLogFile(path)`.
2. Any handler calls `logInfo(event, sessionId, data?)` → one line appended (or a no-op if `null`).
3. If the path is bad / disk full / `data` is circular, the call **still returns normally**; a short note
   goes to `process.stderr`. The agent turn is never broken by logging.

**Pain Points Addressed**: Without a fail-open logger, the first malformed `data` payload (a circular object)
or the first misconfigured path would throw inside a `context`/`tool_result`/`turn_end` handler and break the
agent turn — directly violating spec/03 principle #4. The logger must absorb all such failures silently.

---

## Why

- **Closes the observability surface.** spec/04 §9 names the logger "the primary observability surface in
  non-TUI modes and … what the test suite asserts against (spec/10)". This module is the contract every later
  module's `logX(...)` call targets; shipping it unblocks filter/tools/nudges/markers.
- **Makes "fail open" a test-verifiable guarantee for I/O.** Unlike the pure transforms, the logger touches
  the filesystem (`appendFileSync`) and serializes untrusted `data`. The adversarial suite feeds it a missing
  parent dir (ENOENT), a directory path (EISDIR), a circular reference, and a BigInt — proving no input and no
  path can escape as a thrown exception (spec/03 #4, spec/09 §4).
- **Breaks the config↔log dependency cycle cleanly.** The work-item contract prescribes: the logger keeps its
  OWN destination (`setLogFile`) rather than importing `getConfig()`, so `log.ts` depends on neither `config.ts`
  nor Pi. `index.ts` is the sole orchestrator. This keeps `log.ts` a pure, fast, isolated unit-test target —
  identical in spirit to `config.ts` being "Pi-free, settings handed in via setConfig()" (S2 PRP *Why*).
- **One JSONL line per event = cheap + composable.** JSON Lines are append-only and line-delimited
  (jsonlines.org), so writes never parse/rewrite prior bytes and the file stays parseable line-by-line even
  after a crash — ideal for a debug log that may also be tailed/grepped by the smoke harness.

---

## What

Create `src/log.ts` (exact content in *Implementation Blueprint → Task 1*) and `test/log.test.ts` (exact
content in *Task 2*). The module:

- Holds module-level `let logFile: string | null = null;` (the destination).
- `setLogFile(path)` assigns it (`null` ⇒ off).
- `log(level, event, sessionId, data?)`: if `logFile === null` → return; build `LogLine`; in a single
  `try { appendFileSync(dest, JSON.stringify(line) + "\n", "utf8") } catch { stderr-fallback }` (the stringify
  and the append share one try because `JSON.stringify` throws on circular/BigInt — MDN).
- `logInfo/logDebug/logWarn/logError` are thin curried wrappers.
- Exports `Level` and `LogLine` types for downstream consumers.

This subtask does **NOT**: touch `config.ts` (parallel S2 owns it — see *Scope decision*), wire `setLogFile`
into `index.ts` (that's P1.M7.T1), build `runtime.ts`/`filter.ts`/tools/nudges/markers (later subtasks), or
re-point `config.ts`'s `warnConfig` helper to the logger (architecturally wrong — see *Scope decision*).

### Success Criteria

- [ ] `src/log.ts` is **created** and exports exactly `Level`, `LogLine`, `log`, `logInfo`, `logDebug`,
      `logWarn`, `logError`, `setLogFile`.
- [ ] `test/log.test.ts` is **created** and is all-green.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (with the new files; `include:["src","test"]` already covers them).
- [ ] `npx vitest run` is all-green (new `log` suite **and** pre-existing `config` suite).
- [ ] `log(...)` is a **no-op** (no throw, no file touched) when `logFile` is `null`.
- [ ] `log(...)` **never throws** on: missing-parent-dir path (ENOENT), directory path (EISDIR), circular
      `data`, BigInt `data` — each verified to route to the `process.stderr` fallback.
- [ ] Written lines match the **LogLine** shape exactly (spec/04 §9); `data` is **omitted** from the JSON when
      `undefined`, and present as JSON `null` when explicitly `null`.
- [ ] `logFile` is append-only (multiple calls accumulate; a pre-existing file's contents are preserved).
- [ ] `src/log.ts` imports nothing from Pi and nothing from `config.ts` (grep gates = 0).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `src/log.ts` and `test/log.test.ts` content is given verbatim below
> (Task 1 / Task 2). The authoritative LogLine shape is reproduced from spec/04 §9. The required public API is
> reproduced from the work-item contract. The test convention (vitest, `../src/log.js` import path, `describe`
> /`it`/`vi.spyOn`) is reproduced from the live `test/config.test.ts`. All Node facts (`appendFileSync` flags
> & error codes, `JSON.stringify` throws on circular/BigInt, `new Date().toISOString()` format, `node:fs` ESM
> import) are **verified first-hand** on this machine (Node v26.7.0) in the research notes. No prior knowledge
> beyond "the S1 scaffold + `src/config.ts` exist and pass `tsc`/`vitest`" is required.

### Scope decision (READ BEFORE CODING)

- **Do NOT modify `src/config.ts`.** P1.M1.T2.S2 is being implemented **in parallel right now** (its PRP
  GOTCHA #11 is actively replacing an older `UNSET`-sentinel `validateConfig`). Editing `config.ts` here would
  collide with that work. The logger is fully functional without touching it.
- **Do NOT re-point `config.ts`'s `warnConfig` to the structured logger** (S2 PRP GOTCHA #8 mooted this as a
  future touch). It is **architecturally unsound**: `warnConfig` runs *inside* `validateConfig` — i.e. while
  `settings.json` is being parsed — which is necessarily **before** `setLogFile` has been called (the log path
  comes *from* the config under validation → chicken-and-egg). A log call there would be a silent no-op.
  Config-validation warns correctly stay on `console.warn`; the structured logger serves runtime events only.
  If a future task still wants the hookup, it belongs in the P1.M7.T1 wiring pass, **not** here.
- **Do NOT wire `setLogFile` into `index.ts`.** `index.ts` is currently the S2-era no-op stub
  (`pi.on("session_start", () => {})`). The `setLogFile(getConfig().log.file)` call is **P1.M7.T1**'s job.

### Documentation & References

```yaml
# MUST READ — authoritative sources for this module
- file: spec/04-data-model.md
  section: "§9 Logging shape (for log.file)"
  why: "THE source of the LogLine interface. Reproduced verbatim below."
  critical: "Fields are EXACTLY: ts (ISO string), level ('debug'|'info'|'warn'|'error'), event (string),
        sessionId (string), data? (unknown, OPTIONAL). All persisted shapes are JSON-serializable."

- file: spec/09-configuration.md
  section: "§4 Validation rules"
  why: "§4 mandates: 'log.file: … opening is deferred to first write (and wrapped — a bad path must not
        crash the extension). On any per-field validation failure … Never throw.' The logger must honor the
        same fail-open discipline for its own writes."
  critical: "A bad path MUST NEVER crash the extension. ⇒ every appendFileSync wrapped in try/catch."

- file: spec/03-architecture.md   # (referenced via the merged PRD heading h2.3 "Design principles")
  section: "§3 principle #4 — Fail open"
  why: "'Every handler is wrapped so that an exception becomes a logged no-op, never a broken agent turn.'
        The logger is used inside those handlers, so it must itself be exception-proof."

- file: spec/11-build-order.md
  section: "§1 Repository layout → 'log.ts // structured JSONL logger'"
  why: "Confirms log.ts is a standalone file in src/ and pairs with config.ts in build Step 1."

- file: spec/10-testing.md
  section: "§1 / §2.2"
  why: "The logger's JSONL is what Tier-2 integration assertions read ('Log every context.fire', 'assert on
        a structured log'). Confirms the line shape must be stable & machine-parseable."

- file: src/config.ts            # READ-ONLY consumer contract — DO NOT MODIFY
  why: "Defines MulliganConfig.log.file: string | null (default null) and getConfig(). The value index.ts will
        pass to setLogFile(getConfig().log.file) in P1.M7.T1. NOTE: this file is mid-reimplementation by the
        parallel S2 task — leave it alone."
  gotcha: "log.ts must NOT import config.ts (would create a cycle AND a chicken-and-egg timing bug). It takes
        the path via setLogFile() instead."

- file: test/config.test.ts       # the test convention to mirror
  why: "Establishes: vitest; `import { … } from '../src/<file>.js'` (note .js for ESM+Bundler); top-level
        describe/it; vi.spyOn for stderr/console; beforeEach to reset module state."
  pattern: "Mirror its import style and describe/it structure for test/log.test.ts."

- file: plan/001_2e5baf25fe9f/P1M1T2S2/PRP.md   # the parallel config PRP — read-only contract
  why: "Defines getConfig()/setConfig()/validateConfig() and MulliganConfig.log.file. Treat as the source of
        the config the logger will (eventually, via index.ts) consume."

- file: plan/001_2e5baf25fe9f/P1M1T3S1/research/external_best_practices.md
  why: "First-hand-verified external facts: JSONL/NDJSON format (jsonlines.org, ndjson.org);
        appendFileSync flags + ENOENT/EISDIR/EACCES/ENOSPC (nodejs.org/api/fs.html#fsappendfilesync);
        JSON.stringify throws TypeError on circular/BigInt (MDN); new Date().toISOString() format (MDN);
        vitest vi.spyOn(process.stderr,'write') + mkdtempSync/rmSync (vitest.dev, nodejs.org/api/fs.html);
        ESM node: imports (nodejs.org/api/esm.html). All verified on Node v26.7.0."
- file: plan/001_2e5baf25fe9f/P1M1T3S1/research/codebase_recon.md
  why: "First-hand recon: live config.ts/index.ts contents, test convention, exact LogLine shape + API,
        circular-dep/timing analysis, baseline + final gates."

# AUTHORITATIVE LogLine (spec/04-data-model.md §9, verbatim) — implement EXACTLY this:
#   interface LogLine {
#     ts: string;                        // ISO (new Date().toISOString())
#     level: "debug" | "info" | "warn" | "error";
#     event: string;                     // e.g. "rewind.applied", "filter.fire", "nudge.inject"
#     sessionId: string;
#     data?: unknown;                    // OPTIONAL — omitted from the JSON line when undefined
#   }
# One JSON line per event, append-only.
```

### Current Codebase tree (state at this subtask's start — verified live)

```bash
pi-mulligan/
├── package.json            # type:'module'; main:'src/index.ts'; pi.extensions:['./src/index.ts'];
│                           # devDeps: typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
├── node_modules/           # @earendil-works/pi-coding-agent, typebox, @types/node 22.20.1, vitest 1.6.1, tsc 5.9.3 resolve
├── src/
│   ├── index.ts            # S2-era no-op stub (imports type ExtensionAPI); NOT wired to config/log
│   ├── config.ts           # S1+S2 present (MulliganConfig.log.file, getConfig/setConfig/validateConfig). PARALLEL-OWNED — do not touch.
│   └── tools/              # empty
├── test/
│   ├── config.test.ts      # the test convention to mirror (vitest, '../src/config.js' import, describe/it/vi)
│   └── integration/        # empty
└── spec/                   # 12-doc spec (read-only); 04 §9 + 09 §4 are authoritative here
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0;
#                                            `npx vitest run` → all green.
# No vitest config file exists → vitest uses defaults + tsconfig.include.
```

### Desired Codebase tree with files to be added (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── log.ts              # NEW — the structured JSONL logger (Level, LogLine, log, logInfo/Debug/Warn/Error, setLogFile)
└── test/
    └── log.test.ts         # NEW — vitest suite (shape, append-only, no-op-when-null, fail-open, currying)
# No other files are created or modified.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — NEVER throw. spec/03 #4 + spec/09 §4: a bad path must not crash the extension.
# JSON.stringify(line) AND appendFileSync(dest, …) must share ONE try/catch, because BOTH can throw:
#   - JSON.stringify throws TypeError on circular references and on BigInt values (MDN). Verified live.
#   - appendFileSync throws ENOENT (missing parent dir), EISDIR (path is a directory), EACCES (perms),
#     ENOSPC (disk full). Verified live (ENOENT + EISDIR reproduced).
# The catch writes a short note to process.stderr (itself wrapped in try/catch — stderr can fail too)
# and SWALLOWS. The agent turn must never break because of logging.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 — No-op when logFile is null (the DEFAULT / "off"). spec/09 §3: log.file default null = off.
# The VERY FIRST thing log() does is `if (logFile === null) return;`. Zero disk chatter, zero overhead,
# zero throws in the default config. (DEFAULT_CONFIG.log.file is null, so until index.ts calls setLogFile
# with a real path, every log call is a no-op. This is correct, not a bug.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — log.ts must NOT import config.ts (and must NOT import Pi).
# (a) It avoids a config↔log import cycle. (b) It avoids a chicken-and-egg timing bug: config validation
# (where warnConfig runs) happens BEFORE setLogFile is called, because the log path COMES FROM the config
# being validated. So the logger holds its OWN module-level `logFile`, set only via setLogFile(), and index.ts
# (P1.M7.T1) is the sole orchestrator: setLogFile(getConfig().log.file). Grep gates enforce this (0 config/Pi imports).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — `data?: unknown` is OPTIONAL: omit it from the JSON line when undefined.
# Build `const line: LogLine = { ts, level, event, sessionId, data };` where `data` is the (possibly undefined)
# param. JSON.stringify DROPS keys whose value is `undefined`, so the wire line for a data-less call is
# `{"ts":…,"level":…,"event":…,"sessionId":…}` with NO `data` key — exactly the `data?` semantics. An explicit
# `null` data IS a provided value and serializes as `"data":null`. Pin BOTH with tests.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — appendFileSync is synchronous/blocking. Acceptable: this is a low-volume debug log (a handful of
# lines per turn). Do NOT introduce async/streams/queues — the work-item contract explicitly says appendFileSync.
# Synchronous append also guarantees the line is on disk before the handler continues (the smoke harness reads
# the file right after a turn). Verified: each appendFileSync(file, str+"\n", "utf8") is one independent line.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — Module-level mutable `logFile` ⇒ tests MUST reset it.
# vitest does NOT reset module state between tests. Put `setLogFile(null)` in a beforeEach (and afterEach) so a
# test that pointed the logger at a temp file can't leak into the next. (Mirrors config.ts GOTCHA #9.)
# Use mkdtempSync(os.tmpdir() …) per-test for an isolated temp dir and rmSync(…, {recursive:true, force:true})
# in afterEach for cleanup (verified pattern).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — ESM + Bundler resolution ⇒ import node builtins as `node:fs` and import the module under test as
# `../src/log.js` (the `.js` is REQUIRED even though the source is `.ts`). Verified against this repo.
# `import { appendFileSync } from "node:fs";` (node: specifier → always the Node builtin, unambiguous under ESM).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — TS-strict type-safety in the stderr fallback: do NOT read `err.code` directly (base `Error` has no
# `.code`; only NodeJS.ErrnoException does, and unknown payloads may not be Error at all). Use `String(err)` —
# always safe, and for Node fs errors it yields "Error: ENOENT: no such file or directory, open '…'" (code
# included in the message). Keep the fallback's own stderr.write in its own try/catch.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — Timestamp via new Date().toISOString() → UTC ISO 8601 "YYYY-MM-DDTHH:mm:ss.sssZ" (verified).
# It is sortable, timezone-explicit, and matches the spec/04 §9 "ts // ISO" comment. Do NOT use Date.now()
# (a number) or a locale string.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// The ONLY data shape this module defines (spec/04-data-model.md §9 — verbatim):
export type Level = "debug" | "info" | "warn" | "error";

export interface LogLine {
  ts: string;            // ISO 8601 UTC (new Date().toISOString())
  level: Level;
  event: string;         // dotted, e.g. "rewind.applied", "filter.fire", "nudge.inject"
  sessionId: string;
  data?: unknown;        // OPTIONAL — omitted from the JSON line when undefined
}

// The ONLY module-level state:
let logFile: string | null = null;   // default null ⇒ logging OFF. Set via setLogFile().
```

No Pi types, no config types — the module is self-contained and JSON-serializable by construction.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json            # expect exit 0 (S1/S2 green as-is)
  - RUN: npx vitest run                                # expect all green
  - RUN: test ! -f src/log.ts && echo "ok: src/log.ts absent"   # confirm we are CREATING, not clobbering

Task 1: CREATE src/log.ts   (exact content below — copy verbatim)
  - IMPLEMENT: Level, LogLine, module-level logFile, setLogFile, log, logInfo/logDebug/logWarn/logError,
    and a private writeStderrFallback.
  - FOLLOW pattern: the Pi-free / fail-open / module-level-state style of src/config.ts (S2).
  - CONSTRAINTS:
      * import ONLY `appendFileSync` from "node:fs" (GOTCHA #7). NO Pi import, NO config import (GOTCHA #3).
      * log(): `if (logFile === null) return;` FIRST (GOTCHA #2); then ONE try { JSON.stringify + appendFileSync }
        / catch { stderr fallback } (GOTCHA #1). Both calls in the SAME try.
      * data?: build the LogLine with the `data` field (may be undefined; JSON.stringify drops it — GOTCHA #4).
      * fallback uses String(err), never err.code directly (GOTCHA #8); its own stderr.write is try/catch-wrapped.
      * ts = new Date().toISOString() (GOTCHA #9).
  - NAMING/PLACEMENT: file at repo-root src/log.ts; exports are the 8 names in Success Criteria.

Task 2: CREATE test/log.test.ts   (exact content below — copy verbatim)
  - IMPLEMENT: vitest suite mirroring test/config.test.ts conventions (GOTCHA #6/#7).
  - COVERAGE (each a separate `it`): LogLine shape (with/without data, null data); four levels written verbatim;
    append-only (accumulate + preserve pre-existing content); no-op-when-null (default off + mid-session off +
    destination switch); fail-open ENOENT / EISDIR / circular-data / BigInt-data (each: not.toThrow +
    stderr spy called; circular/bigint also prove NO partial line was appended); convenience helpers curry level;
    bare log() routing + Level type-level guard.
  - RESET: beforeEach sets a fresh mkdtempSync temp dir AND setLogFile(null); afterEach rmSync + setLogFile(null).
  - STDERR SPY: vi.spyOn(process.stderr, "write").mockImplementation(() => true) to capture + suppress.

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + grep gates) and Level 2 (vitest). Levels 3/4 are N/A for this pure module (no Pi runtime).
```

#### Exact content to CREATE — `src/log.ts` (Task 1 — copy verbatim)

```ts
/**
 * Structured JSONL logger — Mulligan's primary observability surface in non-TUI modes.
 * spec/04-data-model.md §9 (LogLine), spec/09-configuration.md §4 (fail-open), spec/03 principle #4,
 * spec/11-build-order.md §1 ("log.ts // structured JSONL logger").
 *
 * DESIGN (read GOTCHA #1–#9 in the PRP):
 * - Pi-free AND config-free: holds its OWN destination (`logFile`), configured via setLogFile().
 *   index.ts (P1.M7.T1) calls setLogFile(getConfig().log.file) after config load. This breaks the
 *   config↔log cycle (log.ts imports neither config.ts nor Pi) and avoids the chicken-and-egg timing bug
 *   (the log path comes FROM the config under validation).
 * - No-op when `logFile` is null (the default; "off").
 * - Fail-open: a bad path / circular data / BigInt data can NEVER crash the extension — the failing write is
 *   caught, a short note goes to process.stderr, and the error is swallowed (spec/03 #4, spec/09 §4).
 */
import { appendFileSync } from "node:fs";

/** The four severity levels a LogLine may carry (spec/04 §9). */
export type Level = "debug" | "info" | "warn" | "error";

/**
 * LogLine — one JSON object per line, append-only (spec/04-data-model.md §9).
 * `data` is OPTIONAL; when `undefined` it is omitted from the serialized line (JSON.stringify drops
 * undefined-valued keys), matching the `data?` schema.
 */
export interface LogLine {
  /** ISO 8601 UTC timestamp (new Date().toISOString()). */
  ts: string;
  /** Severity. */
  level: Level;
  /** Dotted event name, e.g. "rewind.applied", "filter.fire", "nudge.inject". */
  event: string;
  /** Pi session id this event belongs to. */
  sessionId: string;
  /** Optional structured payload. Omitted from the line when undefined; JSON null stays a real null. */
  data?: unknown;
}

/**
 * Current log destination. `null` ⇒ logging is OFF (no-op). Set by setLogFile() (called from index.ts once
 * config is loaded, P1.M7.T1). Module-level mutable state: tests MUST reset via setLogFile(null) in beforeEach.
 */
let logFile: string | null = null;

/**
 * setLogFile — set/replace the log destination, or pass null to disable logging.
 * Called from index.ts (P1.M7.T1): setLogFile(getConfig().log.file). Assigning a string cannot throw.
 */
export function setLogFile(path: string | null): void {
  logFile = path;
}

/**
 * log — append one structured JSONL line for `event`.
 *
 * (a) If no log file is configured (null), return immediately (no-op).
 * (b) Build the LogLine { ts, level, event, sessionId, data }.
 * (c) Append `JSON.stringify(line) + "\n"` via appendFileSync, wrapped in try/catch.
 * (d) On ANY error (bad path → ENOENT/EISDIR/EACCES/ENOSPC; circular/BigInt data → TypeError): write a short
 *     note to process.stderr and swallow. NEVER throw — logging must not crash the extension (spec/03 #4).
 */
export function log(level: Level, event: string, sessionId: string, data?: unknown): void {
  const dest = logFile;
  if (dest === null) {
    return; // logging disabled — no-op (spec/09 §3: log.file default null = off)
  }

  const line: LogLine = {
    ts: new Date().toISOString(),
    level,
    event,
    sessionId,
    data,
  };

  try {
    // JSON.stringify AND appendFileSync share this try: stringify throws TypeError on circular refs / BigInt
    // (MDN); appendFileSync throws ENOENT/EISDIR/EACCES on a bad path (Node fs). Both → catch → stderr fallback.
    // (data: undefined is dropped by JSON.stringify, so data-less lines have no `data` key — GOTCHA #4.)
    appendFileSync(dest, JSON.stringify(line) + "\n", "utf8");
  } catch (err) {
    writeStderrFallback(dest, level, event, err);
  }
}

/** logInfo / logDebug / logWarn / logError — convenience helpers that curry the level. */
export function logInfo(event: string, sessionId: string, data?: unknown): void {
  log("info", event, sessionId, data);
}
export function logDebug(event: string, sessionId: string, data?: unknown): void {
  log("debug", event, sessionId, data);
}
export function logWarn(event: string, sessionId: string, data?: unknown): void {
  log("warn", event, sessionId, data);
}
export function logError(event: string, sessionId: string, data?: unknown): void {
  log("error", event, sessionId, data);
}

/**
 * writeStderrFallback — last-resort visibility when a log write fails. Wrapped in its own try/catch so even a
 * failing stderr write can never throw. Uses String(err) (always safe; includes the Node error code in the
 * message for fs errors) rather than err.code (base Error has no .code; the payload may not be an Error).
 */
function writeStderrFallback(dest: string, level: Level, event: string, err: unknown): void {
  try {
    process.stderr.write(
      `[mulligan] log: write failed (event=${event} level=${level} dest=${dest}): ${String(err)}\n`,
    );
  } catch {
    /* swallow — logging must never crash the extension */
  }
}
```

#### Exact content to CREATE — `test/log.test.ts` (Task 2 — copy verbatim)

```ts
import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  log,
  logInfo,
  logDebug,
  logWarn,
  logError,
  setLogFile,
  type Level,
  type LogLine,
} from "../src/log.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mulligan-log-"));
  file = join(dir, "log.jsonl");
  setLogFile(null); // reset module-level state (GOTCHA #6)
});

afterEach(() => {
  setLogFile(null);
  rmSync(dir, { recursive: true, force: true });
});

/** Read back the log file, split on newlines, drop empties, JSON.parse each line. */
function readLines(): LogLine[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as LogLine);
}

describe("LogLine shape (spec/04 §9)", () => {
  it("writes one valid JSON line matching LogLine, with structured data", () => {
    setLogFile(file);
    logInfo("test.event", "session-1", { foo: 1, nested: [1, 2] });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.level).toBe("info");
    expect(line.event).toBe("test.event");
    expect(line.sessionId).toBe("session-1");
    expect(line.data).toEqual({ foo: 1, nested: [1, 2] });
    expect(typeof line.ts).toBe("string");
    expect(Number.isNaN(Date.parse(line.ts))).toBe(false); // valid ISO
    expect(line.ts.endsWith("Z")).toBe(true); // UTC
  });

  it("omits the `data` key entirely when data is not provided (data? is optional)", () => {
    setLogFile(file);
    logWarn("no.data", "s");
    const raw = readFileSync(file, "utf8");
    expect(raw).toContain('"event":"no.data"');
    expect(raw).not.toContain('"data"'); // undefined is dropped by JSON.stringify
    const line = JSON.parse(raw.trim()) as LogLine;
    expect(line).not.toHaveProperty("data");
  });

  it("preserves an explicit null data as a real JSON null (null is a provided value)", () => {
    setLogFile(file);
    logInfo("null.data", "s", null);
    const line = JSON.parse(readFileSync(file, "utf8").trim()) as LogLine;
    expect(line).toHaveProperty("data");
    expect(line.data).toBeNull();
  });

  it("writes each of the four levels verbatim", () => {
    setLogFile(file);
    logDebug("d", "s");
    logInfo("i", "s");
    logWarn("w", "s");
    logError("e", "s");
    expect(readLines().map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("append-only behavior", () => {
  it("appends one line per call; lines accumulate (never truncate)", () => {
    setLogFile(file);
    logInfo("a", "s");
    logInfo("b", "s");
    logWarn("c", "s");
    const lines = readLines();
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.event)).toEqual(["a", "b", "c"]);
  });

  it("does not overwrite a pre-existing file's contents (true append)", () => {
    writeFileSync(file, JSON.stringify({ preexisting: true }) + "\n", "utf8");
    setLogFile(file);
    logInfo("after", "s");
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ preexisting: true });
    expect(lines[1].event).toBe("after");
  });
});

describe("no-op when logFile is null (default = off)", () => {
  it("does nothing and throws nothing when logging is disabled (file never created)", () => {
    setLogFile(null);
    expect(() => logInfo("x", "s", { a: 1 })).not.toThrow();
    expect(() => readFileSync(file, "utf8")).toThrow(); // never created → ENOENT
  });

  it("setLogFile(null) turns logging off mid-session", () => {
    setLogFile(file);
    logInfo("one", "s");
    setLogFile(null);
    logInfo("two", "s"); // dropped (no-op)
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].event).toBe("one");
  });

  it("switching destinations writes to the new file only", () => {
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    setLogFile(a);
    logInfo("to-a", "s");
    setLogFile(b);
    logInfo("to-b", "s");
    expect((JSON.parse(readFileSync(a, "utf8").trim()) as LogLine).event).toBe("to-a");
    expect((JSON.parse(readFileSync(b, "utf8").trim()) as LogLine).event).toBe("to-b");
  });
});

describe("fail-open: a bad path / bad data NEVER throws (spec/03 #4, spec/09 §4)", () => {
  it("swallows ENOENT (missing parent dir) and writes to stderr instead", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      setLogFile(join(dir, "no-such-dir", "log.jsonl")); // parent dir absent → ENOENT
      expect(() => logInfo("boom", "s", { x: 1 })).not.toThrow();
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0] ?? "")).toContain("boom"); // event surfaced in the fallback
    } finally {
      spy.mockRestore();
    }
  });

  it("swallows EISDIR (path is a directory)", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      setLogFile(dir); // the temp dir itself → EISDIR
      expect(() => logError("isdir", "s")).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("swallows a circular `data` payload (JSON.stringify throws TypeError) WITHOUT appending a partial line", () => {
    setLogFile(file);
    logInfo("seed", "s"); // create the file + one good line first
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(() => logInfo("circular", "s", circular)).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    // only the seed survived — no corrupt/partial line (readLines would throw on a bad line):
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].event).toBe("seed");
  });

  it("swallows a BigInt `data` payload (JSON.stringify throws TypeError)", () => {
    setLogFile(file);
    logInfo("seed", "s");
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(() => logInfo("bigint", "s", { n: BigInt(123) })).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(readLines()).toHaveLength(1); // only the seed
  });
});

describe("convenience helpers curry the level", () => {
  it("logInfo/logDebug/logWarn/logError each emit the right level", () => {
    setLogFile(file);
    const cases: Array<{ fn: (e: string, s: string) => void; level: Level; event: string }> = [
      { fn: logDebug, level: "debug", event: "dbg" },
      { fn: logInfo, level: "info", event: "inf" },
      { fn: logWarn, level: "warn", event: "wrn" },
      { fn: logError, level: "error", event: "err" },
    ];
    for (const c of cases) c.fn(c.event, "sid");
    expect(readLines().map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("bare log(level, event, sessionId, data?) routes through the same path; Level is the 4-value union", () => {
    setLogFile(file);
    log("error", "manual", "sid", { k: "v" });
    const line = JSON.parse(readFileSync(file, "utf8").trim()) as LogLine;
    expect(line).toMatchObject({ level: "error", event: "manual", sessionId: "sid" });
    expect(line.data).toEqual({ k: "v" });
    expectTypeOf<Level>().toEqualTypeOf<"debug" | "info" | "warn" | "error">();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the fail-open write — stringify + append share ONE try (GOTCHA #1).
export function log(level: Level, event: string, sessionId: string, data?: unknown): void {
  const dest = logFile;
  if (dest === null) return;                                    // GOTCHA #2: no-op default
  const line: LogLine = { ts: new Date().toISOString(), level, event, sessionId, data }; // GOTCHA #4/#9
  try {
    appendFileSync(dest, JSON.stringify(line) + "\n", "utf8");  // both can throw → catch
  } catch (err) {
    writeStderrFallback(dest, level, event, err);               // swallow, never rethrow
  }
}

// PATTERN: level-curried helpers are trivial pass-throughs (match the work-item contract).
export function logInfo(event: string, sessionId: string, data?: unknown): void {
  log("info", event, sessionId, data);
}
// … logDebug / logWarn / logError identical, swapping the level literal.

// GOTCHA: the stderr fallback uses String(err) (safe; includes Node fs error codes) and is itself try/catch'd.
function writeStderrFallback(dest: string, level: Level, event: string, err: unknown): void {
  try {
    process.stderr.write(`[mulligan] log: write failed (event=${event} level=${level} dest=${dest}): ${String(err)}\n`);
  } catch {
    /* swallow */
  }
}
```

### Integration Points

```yaml
CONFIG (future — NOT this subtask):
  - consumed value: getConfig().log.file   # string | null, default null (src/config.ts, parallel S2)
  - wiring (P1.M7.T1, index.ts session_start): setLogFile(getConfig().log.file)
  - NOTE: log.ts does NOT import getConfig itself (GOTCHA #3). index.ts is the sole bridge.

DOWNSTREAM CONSUMERS (all later subtasks — none import the logger yet):
  - filter.ts:   logInfo("filter.fire", sessionId, { before, after }); logDebug("filter.cache", …)
  - tools/*:     logInfo("rewind.applied", sessionId, { granularity, id }); logWarn("shrink.nomatch", …)
  - nudges.ts:   logInfo("nudge.inject", sessionId, { kind: "drift" })
  - markers.ts:  logDebug("marker.append", sessionId, { kind, seq })
  - index.ts:    logInfo("session.start", sessionId) on session_start (P1.M7.T1)

NO DATABASE / NO ROUTES / NO NEW DEPS — appendFileSync is a Node builtin (node:fs); nothing is added to package.json.
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Task 1)

```bash
# Type-check the new module + test (include:["src","test"] already covers them):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# Scope gates — log.ts is Pi-free and config-free (GOTCHA #3):
test "$(grep -c '@earendil-works/pi-coding-agent' src/log.ts)" = "0"   # 0 Pi imports
test "$(grep -cE 'from \"(\.\./)*config' src/log.ts)" = "0"            # 0 config imports (no cycle)
# Confirm the 8 exports exist exactly once each:
grep -cE 'export (function|type|interface) (Level|LogLine|log|logInfo|logDebug|logWarn|logError|setLogFile)\b' src/log.ts  # expect 8

# Expected: tsc exit 0; all three grep gates pass. If tsc errors, READ the output and fix before proceeding.
```

### Level 2: Unit tests (run after Task 2)

```bash
# The new logger suite in isolation:
npx vitest run test/log.test.ts            # MUST be all-green

# Full suite — must NOT regress config (this is a pure, independent module):
npx vitest run                              # MUST be all-green (log + config)

# Expected: every test green. If any fail, debug the ROOT CAUSE and fix the implementation — do not weaken asserts.
# Particular attention: the 4 fail-open tests (ENOENT/EISDIR/circular/BigInt) must each show not.toThrow AND a
# stderr spy call; the circular/BigInt tests must prove exactly 1 line survives (the seed) — no partial line.
```

### Level 3: Integration / runtime (N/A for this pure module)

`log.ts` has **no Pi dependency and no process lifecycle wiring** — it is a synchronous, side-effect-bounded
module fully covered by the Level 2 unit suite. Real Pi integration (setLogFile wired from config in
`session_start`) arrives in **P1.M7.T1**; the F-* integration scenarios that read this JSONL arrive in
**P1.M7.T2**. Nothing to run here.

### Level 4: Creative / domain-specific validation (optional sanity check)

```bash
# Optional hand-proof that one line == one parseable JSON value (JSONL contract):
TMPF="$(mktemp /tmp/mulligan-logproof.XXXXXX.jsonl)"
node --input-type=module -e "
import { setLogFile, logInfo, logWarn } from './src/log.ts';
setLogFile('$TMPF');
logInfo('filter.fire', 'sess-1', { before: 12, after: 9 });
logWarn('shrink.nomatch', 'sess-1', { target: 'by_tool_call_id' });
setLogFile(null);
logInfo('dropped', 'sess-1'); // no-op
const { readFileSync } = await import('node:fs');
const lines = readFileSync('$TMPF','utf8').split('\n').filter(Boolean).map(JSON.parse);
console.log('lines:', lines.length, '| last:', JSON.stringify(lines.at(-1)));
"
rm -f "$TMPF"
# Expected: lines: 2 | last: {"ts":"…Z","level":"warn","event":"shrink.nomatch","sessionId":"sess-1","data":{"target":"by_tool_call_id"}}
# (the 'dropped' call after setLogFile(null) must NOT appear — proves the no-op.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Level 1 passed: the 3 grep scope gates (0 Pi imports, 0 config imports, 8 exports present).
- [ ] Level 2 passed: `npx vitest run` is all-green (log suite + config suite).
- [ ] No test was weakened to go green — every assert in `test/log.test.ts` is meaningful.

### Feature Validation

- [ ] `log(...)` is a **no-op** (no throw, no file created) when `logFile` is `null` (the default).
- [ ] Written lines match the **LogLine** shape exactly (ts ISO / level / event / sessionId / optional data).
- [ ] `data` is **omitted** from the JSON when `undefined`; present as JSON `null` when explicitly `null`.
- [ ] Writes are **append-only** (accumulate; pre-existing content preserved).
- [ ] `log(...)` **never throws** on ENOENT / EISDIR / circular data / BigInt data → routes to `process.stderr`.
- [ ] `logInfo/logDebug/logWarn/logError` each emit the correct level (curried).
- [ ] `setLogFile(null)` disables logging; `setLogFile(path)` (re)enables it; destination switches cleanly.

### Code Quality Validation

- [ ] Follows the existing codebase style (Pi-free, fail-open, module-level state) — mirrors `src/config.ts`.
- [ ] File placement matches the desired tree (`src/log.ts`, `test/log.test.ts`); **no other file touched**.
- [ ] Anti-patterns avoided (see below): no try/catch swallowing at the wrong granularity, no async, no config import.
- [ ] No new dependencies added to `package.json` (`node:fs` is a builtin).
- [ ] JSDoc on every export; the fail-open reasoning is documented inline for downstream readers.

### Documentation & Deployment

- [ ] Exports are self-documenting (clear names + JSDoc); the `event` dotted-name convention is noted.
- [ ] The stderr fallback message names `event`/`level`/`dest` so an operator can diagnose a bad path.
- [ ] No new env vars (env overrides are reserved v1.1 per spec/09 §5 — not introduced here).

---

## Anti-Patterns to Avoid

- ❌ **Don't put `JSON.stringify` and `appendFileSync` in separate try/catch blocks.** They must share ONE —
  `stringify` throws on circular/BigInt *before* the append, and you want the same stderr-fallback path for both.
- ❌ **Don't read `err.code` directly in the fallback.** Base `Error` has no `.code` and the payload may not be an
  `Error`; use `String(err)` (safe, and includes the Node fs code in the message).
- ❌ **Don't make `log` async, don't buffer, don't open a persistent file handle / stream.** The contract is
  `appendFileSync` — one independent append per call, on-disk before the handler continues.
- ❌ **Don't import `getConfig()` (or `config.ts`) into `log.ts`.** It creates a cycle AND a chicken-and-egg
  timing bug. The path comes in via `setLogFile()` from `index.ts`.
- ❌ **Don't touch `config.ts`** (parallel S2 owns it) and **don't re-point `warnConfig`** to this logger
  (architecturally wrong — config validation runs before the logger is configured).
- ❌ **Don't omit the `logFile === null` guard**, and don't replace it with `if (!logFile)` (an empty-string `""`
  is a valid configured path per spec/09 §4 — only `null` means "off").
- ❌ **Don't catch and rethrow.** The whole point of fail-open is to swallow after the stderr note.
- ❌ **Don't add a `flush`/`close`/`dispose`** — `appendFileSync` has no handle to close.

---

## Confidence Score

**9/10** — one-pass success is highly likely. The module is small (≈60 LOC) and fully specified: the LogLine
shape is verbatim from spec/04 §9, the public API is verbatim from the work-item contract, and the exact
`src/log.ts` + `test/log.test.ts` content is given above. Every Node behavior the code relies on
(`appendFileSync` flags + ENOENT/EISDIR codes, `JSON.stringify` throws on circular/BigInt, `toISOString` format,
`node:fs` ESM import) was **verified first-hand** on this machine (Node v26.7.0). The only residual risk is the
shared, parallel-in-flight `config.ts` — explicitly fenced off by the *Scope decision* and the grep gates so this
subtask cannot collide with it.