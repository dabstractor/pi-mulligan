# PRP — P1.M1.T1.S2: Minimal `index.ts` stub that loads without error

**Work item:** P1.M1.T1.S2 · **Points:** 0.5 · **Stage:** Foundation & Infrastructure (Project Scaffold & Type Infrastructure)
**Scope:** Create exactly ONE file — `src/index.ts` — a no-op Pi extension factory that loads
cleanly. **No tools, no handlers (beyond one no-op `session_start`), no config, no tests.**

---

## Goal

**Feature Goal**: Prove the Pi extension *load path* end-to-end for the pi-mulligan project by
creating a minimal `src/index.ts` that Pi can transpile (via jiti) and execute as an extension
factory, registering a single no-op `session_start` lifecycle handler, with zero startup errors.

**Deliverable**: One file, `src/index.ts`, containing:
1. `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";`
2. a default-export **synchronous** factory `function (pi: ExtensionAPI) { ... }`
3. inside the factory, exactly one statement: `pi.on("session_start", () => { /* no-op stub */ });`

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits 0 (deterministic type-check; no model needed).
- `pi -e ./src/index.ts -p "hi"` exits 0 with **no load error** and **completes a turn** (a model
  response is produced). This is the exact validation named in the work-item contract, and it has
  been **empirically proven** in this environment (see *Validation Loop* Level 3).

---

## User Persona

**Target User**: The implementing AI agent (this and later subtasks) and the human developer.

**Use Case**: Every later subtask (P1.M1.T2 `config.ts` through P1.M7.T1 final factory wiring)
extends this file. Establishing a known-good, loadable entry point now means later subtasks can
iteratively add real handlers/tools and always re-run the same `-e ... -p` gate to catch a
regression they introduced — rather than debugging load failures compounded on top of new logic.

**User Journey**:
1. Implementer creates `src/index.ts` (the verbatim content in Task 1).
2. Runs `tsc --noEmit` → must be 0.
3. Runs `pi -e ./src/index.ts -p "hi"` → must exit 0 with a model response.
4. Hands off a loadable extension to P1.M1.T2 onward.

**Pain Points Addressed**: Until an entry file exists, (a) `tsc --noEmit` reports TS18003 "No
inputs were found" (see S1 GOTCHA #2 — this is *expected* at strict S1 and is resolved here), and
(b) there is no concrete proof the `pi.extensions`/`-e` discovery chain actually works for this
project. This subtask closes both gaps.

---

## Why

- **Closes the S1→S2 type-check gap.** S1 deliberately created no `.ts` files, so the project's
  full `tsc --noEmit` gate was only validated with a throwaway stub (S1 Level 1e). S2 makes a
  *permanent* entry file, so `tsc --noEmit` becomes a first-class, always-runnable gate from here
  on.
- **Proves the extension load path for pi-mulligan specifically.** The architecture
  (`PRD §4` + `architecture/api_verification.md`) depends entirely on a default-export factory
  receiving `ExtensionAPI`. Verifying that contract loads cleanly *in this repo's scaffold* removes
  the single largest integration risk before any real logic (context filter, tools) is written.
- **Establishes the forward-compatible `session_start` anchor.** `runtime.ts` (P1.M1.T4
  "session_start initialization") will later populate this exact handler. Registering it now (as a
  no-op) proves the lifecycle hook is wired and gives later subtasks a known insertion point — it is
  not dead code.
- **Honors design principle #1 (Minimal surface) and #5 (The agent is the user).** A no-op stub is
  the smallest possible thing that proves the mechanism; it adds no model-facing surface.

---

## What

Create `src/index.ts` with the **exact** content shown in Task 1 below. Nothing else. The file is a
no-op extension: it imports the `ExtensionAPI` type, exports a default factory, and registers one
`session_start` handler whose body is empty.

This subtask does **not** create: any tool registration, the `context` filter handler, the
`tool_result`/`turn_end` nudges, `config.ts`/`log.ts`/`runtime.ts`, any `*.test.ts`, the README, or
the integration harness. Those belong to P1.M1.T2–T4, P1.M3–M6, and P1.M7 respectively.

### Success Criteria

- [ ] `src/index.ts` exists and contains exactly the content in Task 1 (no extra imports/logic).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `pi -e ./src/index.ts -p "hi"` exits 0, prints a model response, prints no load error.
- [ ] No files other than `src/index.ts` are created or modified by this subtask.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement
> this successfully?"_ — **Yes.** The exact file content is given verbatim, the import path and
> factory signature are verified against the installed Pi 0.84.1 `.d.ts`, and the validation
> command (`pi -e ./src/index.ts -p "hi"`) has been **empirically run with this exact stub** and
> returned exit 0 with a clean model turn. No prior codebase knowledge is required beyond "the S1
> scaffold (package.json/tsconfig.json/node_modules/src/) exists" — which is the stated INPUT.

### Documentation & References

```yaml
# MUST READ — authoritative sources for this stub
- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  why: "§1 Extension Factory (ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>),
        default-export, sync or async — the exact contract this stub implements.
        §7.5 SessionStartEvent (type/reason/previousSessionFile) — confirms the no-op handler
        is wired to a real lifecycle event. §9 constraint table (all verified)."
  pattern: "default-export factory receiving ExtensionAPI; pi.on(event, handler)."
  critical: "Factory MAY be sync (returns void) — we use sync. No async needed for a no-op."

- file: plan/001_2e5baf25fe9f/P1M1T1S1/PRP.md
  why: "THE CONTRACT for this subtask's INPUT. S1 produces package.json (main:'src/index.ts',
        pi.extensions:['./src/index.ts'], deps incl. @earendil-works/pi-coding-agent:'*'),
        tsconfig.json (strict, types:['node']), the dir skeleton, and node_modules via npm install.
        S2 consumes these — do NOT recreate or modify them."
  pattern: "S1 GOTCHA #2 (TS18003 expected with no .ts files) is RESOLVED by this subtask creating
            src/index.ts. S1 Level 1e proved a throwaway `export default function(){}` stub passes
            `tsc --noEmit`; S2 makes that permanent and slightly richer (real import + on())."

- file: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts
  why: "Pi's canonical MINIMAL extension. Shows the exact idiom:
        `import { ..., type ExtensionAPI } from '@earendil-works/pi-coding-agent'` +
        `export default function (pi: ExtensionAPI) { pi.registerTool(...) }`."
  pattern: "default-export factory, ExtensionAPI as the sole param type."
  gotcha: "hello.ts imports a VALUE (defineTool) + a TYPE (type ExtensionAPI) together. S2 uses
           ONLY the type, so use the type-only form `import type { ExtensionAPI }` — it is erased
           at transpile (zero runtime import). See examples/extensions/event-bus.ts for this form."

- file: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/event-bus.ts
  why: "Canonical example of `import type { ExtensionAPI, ExtensionContext }` AND
        `pi.on('session_start', async (_event, ctx) => {...})` — the exact pattern S2 simplifies
        to a no-op."
  pattern: "type-only import of ExtensionAPI; pi.on('session_start', handler)."

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  why: "§Quick Start (lines ~58-106) shows the exact stub + `pi -e ./my-extension.ts` test command;
        §Writing an Extension (lines ~156-181) confirms 'Extensions are loaded via jiti, so
        TypeScript works without compilation' and that a default-export factory receives
        ExtensionAPI; §session_start confirms the lifecycle event."
  pattern: "import type { ExtensionAPI }; export default function (pi) {...}; test with -e flag."

- file: spec/11-build-order.md
  why: "§2 Step 0 (scaffold) is S1; the immediately-following step is the entry-file stub = THIS
        subtask. Confirms placement (src/index.ts) and that no build/emit step exists."
  gotcha: "Pi transpiles via jiti at load time; never add a tsc-emit/dist step."
```

### Current Codebase tree (state at S2 start — S1 delivered)

```bash
pi-mulligan/
├── package.json            # S1 — main:'src/index.ts', pi.extensions, deps, devDeps (@types/node incl.)
├── tsconfig.json           # S1 — strict, types:['node'], include:['src','test']
├── package-lock.json       # S1 — generated by npm install (tracked)
├── node_modules/           # S1 — @earendil-works/pi-coding-agent + typebox + @types/node resolve at top level
├── .pi/
│   └── extensions/         # S1 — empty (project-local auto-discovery dir)
├── src/                    # S1 — EMPTY ← src/index.ts is created HERE by this subtask
│   └── tools/              # S1 — empty (tools/* arrive in P1.M5)
├── test/                   # S1 — empty (tests arrive in P1.M2+)
│   └── integration/        # S1 — empty (smoke.ts/scenarios.md arrive in P1.M7)
├── .gitignore              # existing — already ignores node_modules/, dist/, build/
├── plan/                   # orchestration (read-only)
└── spec/                   # 12-doc spec (read-only)
```

### Desired Codebase tree with files to be added (THIS subtask)

```bash
pi-mulligan/
└── src/
    └── index.ts            # NEW (Task 1) — no-op default-export extension factory
# (optional, Task 2): .pi/extensions/index.ts -> ../../src/index.ts  (relative symlink)
```
> ONLY `src/index.ts` is required. The `.pi/extensions/` symlink is OPTIONAL (see Task 2).

### Known Gotchas of our codebase & Library Quirks

```bash
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (RESOLVES S1's TS18003) — this is the whole point of the subtask
# S1 left src/ empty, so `tsc --noEmit` reported error TS18003 ("No inputs were found").
# That was EXPECTED at strict S1 (see S1 PRP GOTCHA #2). Creating src/index.ts here makes
# the full `tsc --noEmit` gate pass permanently. Do NOT create any OTHER .ts file to "help"
# — that is later subtasks' job (config.ts, etc.). One file, this subtask.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 — use `import type`, not a value import
# ExtensionAPI is used ONLY as a type annotation on the factory param. Use:
#     import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
# A type-only import is erased by jiti/tsc at transpile → zero runtime module load, zero risk.
# (hello.ts combines a value+type import because it imports defineTool as a value; S2 does not.)
# Verified: `import type { ExtensionAPI }` is the exact form in examples/extensions/event-bus.ts.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — the factory MUST be the DEFAULT export (not a named export)
# Pi's extension loader looks for `module.default`. A `export function factory(...)` named export
# will silently NOT load (Pi treats it as having no factory). The contract and every Pi example
# use `export default function (pi: ExtensionAPI) {...}`. Do not deviate.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — a zero-arg handler IS assignable to pi.on("session_start", ...)
# The declared handler type is (event, ctx) => ... . TypeScript allows a function with FEWER
# parameters than declared. So `pi.on("session_start", () => {})` type-checks. Do NOT add
# unused `(_event, _ctx)` params just to "match" — the contract specifies the no-op form.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — `pi -e ... -p "hi"` runs a REAL model turn (needs a provider)
# `-p` = non-interactive: process prompt and exit. It loads the extension THEN calls the model.
# This env HAS a provider configured (OPENAI_API_KEY/PI_PROVIDER/PI_MODEL set) — the gate was
# PROVEN to exit 0 with a clean response. If the implementer's run fails:
#   - A STARTUP stack trace mentioning the extension / "Failed to load extension" = a real LOAD
#     defect (the stub is wrong — recheck import/export/handler).
#   - An INFERENCE error (401/403/429/Invalid API key/network) appearing AFTER the prompt is
#     sent = an ENVIRONMENT problem, NOT an extension defect. Cross-check: run `pi -p "hi"`
#     WITHOUT `-e` — if it fails the same way, the extension is blameless.
# Deterministic model-independent signal: `tsc --noEmit` exit 0 (Level 1) — that alone proves the
# stub is type-sound and importable; the -e run additionally proves transpile + factory execution.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — do NOT add a build/emit step or a dist/ dir
# Pi transpiles src/index.ts via jiti at load time. `tsc --noEmit` is a type-CHECK only. Never
# create tsconfig "outDir", never run `tsc -b`, never add dist/ to git. (Consistent with S1.)
# ────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

> N/A — this is a single no-op stub file. No runtime data models, no schemas, no state. The only
> "structure" is the factory function itself, given verbatim below.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/index.ts   (the ONE required deliverable)
  - PRECONDITION: S1 scaffold exists (package.json, tsconfig.json, node_modules/, src/). Verify
    with: `test -f package.json && test -f tsconfig.json && test -d node_modules/@earendil-works/pi-coding-agent && test -d src`
    (all must pass). If node_modules is missing, run `npm install` first (S1's job, but harmless
    to ensure).
  - WRITE the exact file content below. Do NOT add comments explaining future work, do NOT add
    placeholder imports for config/log/runtime, do NOT add a try/catch (a no-op cannot throw —
    fail-open wrappers arrive with real handlers in P1.M4/P1.M6).
  - CONTENT (verbatim):
      import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

      export default function (pi: ExtensionAPI) {
        pi.on("session_start", () => {
          /* no-op stub */
        });
      }
  - FIELD CHECKLIST after writing:
      * line 1:  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
      * line 3:  export default function (pi: ExtensionAPI) {
      * line 4:    pi.on("session_start", () => {
      * line 5:      /* no-op stub */
      * line 6:    });
      * line 7:  }
      * exactly one import; exactly one pi.on(...) call; no other statements.
  - NAMING/PLACEMENT: file at repo-root `src/index.ts` (matches package.json `main` and
    `pi.extensions[0]`). No subdirectory.

Task 2 (OPTIONAL): add project-local auto-discovery symlink
  - RATIONALE: S1 created `.pi/extensions/` empty and noted its entry is "finalized in S2 once
    index.ts exists." The package.json `pi.extensions:["./src/index.ts"]` field ALREADY provides
    project-local discovery, and the contract's validation uses `-e` directly — so this step is
    NOT required to satisfy the success criteria. Include it only if you want the
    `.pi/extensions/` auto-discovery + `/reload` path active now.
  - COMMAND (relative symlink — path is relative to the LINK location, i.e. .pi/extensions/):
      ln -s ../../src/index.ts .pi/extensions/index.ts
  - VERIFY the link resolves and targets a real file (not dangling):
      readlink -f .pi/extensions/index.ts   # should print <repo>/src/index.ts
      test -f .pi/extensions/index.ts && echo "SYMLINK OK"
  - GOTCHA: do NOT copy the file (duplicates drift); a symlink stays in sync with src/index.ts.
  - DO NOT do this if you are unsure — the required gates (tsc, -e) pass without it.

Task 3: VALIDATE  (no file changes — run the gates in the Validation Loop)
  - Level 1 (tsc, deterministic) and Level 3 (`-e ... -p`, the contract gate). Levels 2 & 4 N/A.
```

### Implementation Patterns & Key Details

```ts
// ── The entire stub. This is ALL the code in src/index.ts. ──────────────
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    /* no-op stub */
  });
}
// ────────────────────────────────────────────────────────────────────────

// PATTERN: default-export factory receiving ExtensionAPI.
//   - Pi's loader (dist/core/extensions/loader) looks for module.default; a named export
//     will NOT be treated as the factory. (GOTCHA #3)
//   - Verified signature (api_verification.md §1): ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>.

// PATTERN: type-only import.
//   - `import type` erases at transpile (GOTCHA #2); ExtensionAPI is never a runtime value here.

// PATTERN: register a lifecycle hook (forward-compatible anchor).
//   - `session_start` fires with reason: startup|reload|new|resume|fork (api_verification.md §7.5).
//   - P1.M1.T4 (runtime.ts "session_start initialization") will later populate THIS handler.
//   - A zero-arg arrow is assignable to the (event, ctx) handler type (GOTCHA #4).

// ANTI-PATTERN (do NOT do any of these in S2):
//   - import { ExtensionAPI } from "..."            // value import of a type — unnecessary
//   - export function factory(pi) {...}             // named export — won't load
//   - export default async function (pi) {...}      // async is overkill for a no-op
//   - pi.on("context", ...) / pi.registerTool(...)  // arrives in P1.M4.T2 / P1.M5
//   - try { ... } catch { /* fail-open */ }         // a no-op cannot throw; wrappers come later
//   - importing config.ts / log.ts / runtime.ts     // those modules don't exist yet (P1.M1.T2-T4)
```

### Integration Points

```yaml
Pi EXTENSION ENTRY POINT:
  - package.json (S1):  "main": "src/index.ts"                       # resolved by Pi at load
  - package.json (S1):  "pi": { "extensions": ["./src/index.ts"] }   # project-local discovery
  - CLI override:       pi -e ./src/index.ts ...                      # explicit load (the gate)
  - optional (S2 T2):   .pi/extensions/index.ts -> ../../src/index.ts # auto-discovery + /reload

DOWNSTREAM CONSUMERS (created by LATER subtasks — do NOT create here):
  - P1.M1.T2 config.ts, P1.M1.T3 log.ts, P1.M1.T4 runtime.ts  → imported by the FINAL factory
  - P1.M4.T2 filter.ts (context handler), P1.M5 tools/*, P1.M6 nudges/*
  - P1.M7.T1 finalizes index.ts by wiring all of the above into this factory.
  => S2's job is to make the empty hook LOAD; later subtasks FILL it.

CONFIG / DATABASE / ROUTES:
  - none. No env vars, no migrations, no routes. Zero-config at this stage.
```

---

## Validation Loop

### Level 1: Syntax & Style (deterministic; no model needed — run after Task 1)

```bash
# (a) The file exists at the right path and has no trailing issues.
test -f src/index.ts && echo "FILE OK" || echo "FILE MISSING"

# (b) Content sanity — exactly one import, one default export, one pi.on('session_start').
grep -c '^import type { ExtensionAPI }' src/index.ts            # expect: 1
grep -c "export default function (pi: ExtensionAPI)" src/index.ts  # expect: 1
grep -c "pi.on(\"session_start\"" src/index.ts                  # expect: 1
# (All three must print 1.)

# (c) TYPE-CHECK — the project's full gate now passes (TS18003 from S1 is gone for good).
#     This is deterministic and needs NO model — it proves the import resolves and the
#     factory/handler are type-sound (catches the most likely stub mistakes).
npx tsc --noEmit -p tsconfig.json && echo "TSC OK (exit 0)" || echo "TSC FAILED"

# Expected: "TSC OK (exit 0)". This also confirms S1's @types/node fix is in place
# (without it you'd get TS2688; see S1 GOTCHA #1).
```

### Level 2: Unit Tests

> N/A for S2. There is nothing to unit-test in a no-op stub (no return values, no state, no side
> effects). The `test` script (`vitest run`, defined in S1's package.json) would report "no test
> files" — that is correct; tests arrive in P1.M2+. Do NOT fabricate a token test.

### Level 3: Integration Testing (THE contract gate — empirically proven)

```bash
# THE GATE named in the work-item contract. Proven in this environment to exit 0.
# `-e` loads the extension (jiti transpiles + runs the factory); `-p "hi"` runs one model turn
# and exits. A clean model response + exit 0 = the stub LOADED and the turn COMPLETED.
timeout 120 pi -e ./src/index.ts -p "hi" ; echo "EXIT=$?"

# Expected: a short model reply is printed (e.g. a greeting / readiness message) and EXIT=0.
# If EXIT=0 → SUCCESS. The extension loaded with no error and completed a turn.

# ── Distinguishing a LOAD error from an environmental MODEL error (GOTCHA #5) ──
# If the command fails, inspect WHERE it failed:
#   1. Capture output to a log and scan for load-time signatures:
timeout 120 pi -e ./src/index.ts -p "hi" > /tmp/s2_load.log 2>&1; echo "EXIT=$?"
grep -iE "failed to load|extension|jiti|cannot (find|resolve)|syntax error|is not (a )?function|TypeError" /tmp/s2_load.log
#      → any hit here = a REAL load defect: the stub is wrong (recheck Task 1 content).
#
#   2. Cross-check the environment with NO extension:
timeout 120 pi -p "hi" > /tmp/s2_bare.log 2>&1; echo "BARE EXIT=$?"
#      If the BARE run ALSO fails (e.g. 401/403/429/"Invalid API key"/network), the failure is
#      environmental (no/invalid provider), NOT an extension defect. Fix the provider, re-run.
#      If BARE succeeds but the `-e` run fails at startup → the extension is the cause.

# ── Optional: confirm project-local discovery path also loads (only if Task 2 was done) ──
test -L .pi/extensions/index.ts && timeout 120 pi -p "hi" > /tmp/s2_disc.log 2>&1; echo "DISC EXIT=$?"
# (With the symlink in place and no -e flag, Pi auto-discovers .pi/extensions/index.ts.)
```

### Level 4: Creative & Domain-Specific Validation

> N/A for S2. No security scanning, performance, or domain logic applies to a no-op stub.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 passes: `test -f src/index.ts` (FILE OK); the three `grep -c` checks each print 1;
      `npx tsc --noEmit -p tsconfig.json` prints "TSC OK (exit 0)".
- [ ] Level 3 passes: `pi -e ./src/index.ts -p "hi"` exits 0 and prints a model response with no
      load error; OR, if it fails, the failure is proven environmental via the bare `pi -p "hi"`
      cross-check (Level 3 step 2).
- [ ] `tsc --noEmit` no longer reports TS18003 (the empty-`src/` state from S1 is resolved).

### Feature Validation (scope discipline)
- [ ] `src/index.ts` contains exactly: one `import type { ExtensionAPI }`, one default-export
      factory, one `pi.on("session_start", ...)` no-op — nothing more.
- [ ] No tools registered, no `context`/`tool_result`/`turn_end` handlers, no config/log/runtime
      imports, no tests, no README created (all out of scope — later subtasks).
- [ ] No files other than `src/index.ts` (and, optionally, the `.pi/extensions/index.ts` symlink)
      are created or modified.

### Code Quality / Convention Validation
- [ ] Uses `import type` (type-only, erased at transpile) — GOTCHA #2.
- [ ] Default export factory (not a named export) — GOTCHA #3.
- [ ] Sync factory returning `void` (no unnecessary `async`).
- [ ] Follows Pi's own example idiom (hello.ts / event-bus.ts).
- [ ] No build/emit step, no `dist/`, no tsconfig `outDir` — GOTCHA #6.

### Documentation & Deployment
- [ ] No new env vars introduced.
- [ ] No user-facing docs (contract: "internal stub, no user-facing surface").

---

## Anti-Patterns to Avoid

- ❌ Don't use a value import (`import { ExtensionAPI }`) — use `import type` (GOTCHA #2).
- ❌ Don't use a named export (`export function factory`) — Pi loads `module.default` only (GOTCHA #3).
- ❌ Don't make the factory `async` — a no-op has nothing to await; keep it sync `void`.
- ❌ Don't register `context`/`tool_result`/`turn_end` handlers or any `mulligan_*` tool — those are
  P1.M4/P1.M5/P1.M6. S2 is a no-op that proves the load path.
- ❌ Don't add a try/catch fail-open wrapper — a no-op cannot throw; wrappers arrive with the real
  handlers (design principle #4 applies to real logic, not to an empty stub).
- ❌ Don't import modules that don't exist yet (`config.ts`, `runtime.ts`, …) — that breaks the load.
- ❌ Don't create a second `.ts` file to "fix" anything — this subtask owns exactly `src/index.ts`.
- ❌ Don't add a build/emit/dist step — Pi transpiles via jiti at load (GOTCHA #6).
- ❌ Don't modify `package.json`, `tsconfig.json`, `.gitignore`, or anything in `plan/`/`spec/`
  (PRP rules; those are S1's / read-only).
- ❌ Don't treat a model/provider error from `pi -p "hi"` as an extension defect — cross-check with
  the bare run first (GOTCHA #5 / Level 3 step 2).

---

## Confidence Score: 10/10

This is a one-file, verbatim-content stub. Every unknown has been resolved empirically:
- The `import type { ExtensionAPI }` path is a verified top-level re-export of Pi 0.84.1.
- The `ExtensionFactory` signature is verified against the `.d.ts` (api_verification.md §1).
- The `session_start` event and zero-arg-handler assignability are verified (§7.5 + examples).
- **The exact contract stub was run through the exact contract validation command
  (`pi -e ./index.ts -p "hi"`) in this environment and returned exit 0 with a clean model turn.**
There is no remaining variable. The only way this fails at implementation is a transcription error
(wrong import form, named export, extra code) — all of which the Level 1 `grep`/`tsc` gates and the
Task 1 content checklist catch deterministically.