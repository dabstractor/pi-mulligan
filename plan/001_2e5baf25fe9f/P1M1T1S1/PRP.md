# PRP — P1.M1.T1.S1: Project Scaffold (package.json, tsconfig.json, directory structure)

**Work item:** P1.M1.T1.S1 · **Points:** 0.5 · **Stage:** Foundation & Infrastructure
**Scope:** Create the build scaffold for the pi-mulligan Pi extension. **No source code, no exports.**

---

## Goal

**Feature Goal**: Establish a valid, installable, type-check-capable project scaffold for the
`pi-mulligan` Pi extension — a `package.json`, a `tsconfig.json`, and the canonical directory
skeleton (`src/`, `src/tools/`, `test/`, `test/integration/`, `.pi/extensions/`) — such that
`npm install` succeeds and the TypeScript configuration is correct and ready for the `index.ts`
stub that arrives in the next subtask (S2).

**Deliverable**: Four artifacts at the repo root / known paths:
1. `package.json` — ESM project manifest with Pi extension entry-point declaration and deps.
2. `tsconfig.json` — strict TypeScript config (ES2022 / ESNext / Bundler).
3. The directory tree `src/`, `src/tools/`, `test/`, `test/integration/`, `.pi/extensions/`.
4. (Build readiness) `node_modules/` resolvable via `npm install` with **zero unmet top-level
   type dependencies** so that `tsc --noEmit` will pass the moment the first `.ts` file exists.

**Success Definition**: `npm install` completes cleanly; both `package.json` and `tsconfig.json`
parse as valid JSON; the directory tree matches `spec/11-build-order.md` §1 exactly; and a
synthetic `tsc --noEmit` check (using a throwaway `src/index.ts` stub that is then removed, since
the real stub is S2) exits 0. See the **Validation Loop** for the staged gates — at strict S1
(with no `.ts` files) `tsc --noEmit` legitimately reports TS18003, which is expected, not a bug.

---

## User Persona

**Target User**: The implementing AI agent (next subtask S2 onward) and the human developer.

**Use Case**: Every subsequent subtask compiles and runs against this scaffold. A clean scaffold
means later PRPs can assume `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`
resolves and `npx tsc --noEmit` is a meaningful gate.

**Pain Points Addressed**: Greenfield repo currently has no `package.json`/`tsconfig.json`; without
them, editor IntelliSense, type-checking, and `vitest` are unavailable. The spec's devDependencies
list (typescript + vitest only) is **under-specified for `tsconfig`'s `"types": ["node"]`** — this
PRP corrects that gap so the project's own stated validation gate can pass.

---

## Why

- **Unblocks the entire build order.** This is Step 0 of `spec/11-build-order.md` §2 ("Scaffold &
  types"). Every later module (`config.ts`, `transforms.ts`, the four tools, the integration
  harness) is compiled and type-checked against the `tsconfig.json` produced here.
- **Declares the Pi extension surface.** The `pi.extensions` field and the `.pi/extensions/` dir
  are how Pi discovers and loads the extension during development. They must exist before S2's
  `index.ts` can be loaded via `pi -e ./src/index.ts` or project-local auto-discovery.
- **Fixes a latent spec inconsistency.** `spec/11-build-order.md` §1.1 lists devDeps as only
  `typescript` and `vitest`, but §1.2 sets `tsconfig` `"types": ["node"]`, which **requires**
  `@types/node`. Verified (see Gotchas): without it, `tsc --noEmit` fails TS2688. Adding
  `@types/node` is a justified minimal deviation required to honor the contract's own validation
  intent ("`npm install && npx tsc --noEmit` can validate").

---

## What

Create exactly the repository layout from `spec/11-build-order.md` §1 (root level + the module
skeleton is created fully here so S2+ never have to `mkdir`). The two config files use the
contents specified in `architecture/external_deps.md` §3 and `spec/11-build-order.md` §1.1–1.2,
with the single documented deviation (`@types/node` added to devDependencies).

This subtask writes **no source code and no tests** — `src/index.ts`, the `test/*.test.ts` files,
and `test/integration/{smoke.ts,scenarios.md}` are all created by later subtasks (S2, P1.M2–M7).
Empty directories are kept empty (use `.gitkeep` only if your VCS needs it; it is optional and does
NOT affect tsc).

### Success Criteria

- [ ] `package.json` exists at repo root and is valid JSON with the exact fields specified in
      Task 1.
- [ ] `tsconfig.json` exists at repo root and is valid JSON with the exact compilerOptions from
      Task 2.
- [ ] `@types/node` is present in `devDependencies` (deviation, justified in Gotchas).
- [ ] Directories `src/`, `src/tools/`, `test/`, `test/integration/`, `.pi/extensions/` all exist.
- [ ] `npm install` exits 0.
- [ ] Both files pass `node -e "JSON.parse(...)"` parse checks.
- [ ] Synthetic type-check gate (throwaway stub) exits 0 — see Validation Loop Level 1.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement
> this successfully?"_ — **Yes.** This is greenfield. The exact file contents are given verbatim
> below, the gotchas are verified, and the validation commands are proven to work in this
> environment. No prior codebase knowledge is required.

### Documentation & References

```yaml
# MUST READ — the authoritative sources for this scaffold
- file: spec/11-build-order.md
  why: "§1 repository layout (exact tree to create), §1.1 package.json, §1.2 tsconfig.json,
        §2 Step 0 (this subtask), §3 definition-of-done (downstream gates this scaffold enables)."
  pattern: "Copy the JSON blocks verbatim, then apply the one @types/node deviation in Task 1."
  gotcha: "§1.1 devDeps list (typescript, vitest) is under-specified for §1.2 'types:['node']'.
           Add @types/node — see Known Gotchas."

- file: plan/001_2e5baf25fe9f/architecture/external_deps.md
  why: "§3 package.json (authoritative, matches spec §1.1), §4 extension discovery/loading
        (justifies the .pi/extensions/ dir + the '*' version spec), §5 no-other-deps constraint."
  critical: "§4 confirms '*' version spec works because Pi resolves the module at load time via
             jiti; the package is ALSO on the npm registry (verified: 0.84.1), so 'npm install'
             resolves it for editor IntelliSense too."

- file: plan/001_2e5baf25fe9f/architecture/system_context.md
  why: "§4 module layout shows the full intended src/ tree (so the dir skeleton is forward-
        compatible); §8 dependency list; §9 version target (Pi 0.84.x — installed is 0.84.1)."

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  why: "'Extension Locations' table + 'Package with dependencies' subsection — confirms
        pi.extensions field shape and .pi/extensions/ auto-discovery semantics."
  pattern: 'package.json { "pi": { "extensions": ["./src/index.ts"] } } and .pi/extensions/ dir.'

- file: .gitignore
  why: "Confirms node_modules/, dist/, build/ already ignored. DO NOT MODIFY (PRP rule)."
```

### Current Codebase tree

```bash
pi-mulligan/
├── .git/
├── .gitignore              # already ignores node_modules/, dist/, build/
├── plan/                   # orchestration output (tasks.json, PRDs, architecture/)
└── spec/                   # 12-doc spec + reference/ (read-only for implementer)
```
(No `package.json`, `tsconfig.json`, `src/`, `test/`, or `.pi/` yet — confirmed greenfield.)

### Desired Codebase tree with files to be added (THIS subtask)

```bash
pi-mulligan/
├── package.json            # NEW (Task 1) — ESM manifest, pi.extensions, deps+devDeps
├── tsconfig.json           # NEW (Task 2) — strict TS config
├── .pi/
│   └── extensions/         # NEW (Task 4) — project-local auto-discovery dir (empty for now)
├── src/                    # NEW (Task 3) — empty; index.ts arrives in S2
│   └── tools/              # NEW (Task 3) — empty; tools/* arrive in P1.M5
├── test/                   # NEW (Task 3) — empty; *.test.ts arrive in P1.M2–M3
│   └── integration/        # NEW (Task 3) — empty; smoke.ts+scenarios.md arrive in P1.M7
└── … (existing .gitignore, plan/, spec/ unchanged)
```
> NOTE: `node_modules/`, `package-lock.json` will appear after `npm install` (gitignored).

### Known Gotchas of our codebase & Library Quirks

```bash
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL, VERIFIED) — tsconfig "types":["node"] needs @types/node
# tsconfig.json sets "types": ["node"]. tsc resolves that from node_modules/@types/node.
# The spec's devDependencies (typescript, vitest ONLY) do NOT provide it:
#   - vitest@^1 has NO dependency on @types/node (verified).
#   - the only @types/node in the tree is nested 5 levels deep under
#     @earendil-works/pi-coding-agent → @google/genai → protobufjs → @types/node@22.19.19,
#     which tsc does NOT pick up for a top-level "types":["node"].
# Symptom:  error TS2688: Cannot find type definition file for 'node'.  (exit 2)
# FIX:      add "@types/node": "^22" to devDependencies. Verified: with it + a stub,
#           `npx tsc --noEmit` exits 0.  (^22 matches the nested transitive version.)
# This is the ONLY intentional deviation from spec §1.1's literal devDeps list. It is
# REQUIRED so the contract's own gate ("npm install && npx tsc --noEmit can validate") passes.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (VERIFIED) — tsc TS18003 "No inputs were found" at strict S1
# This subtask creates NO .ts files (src/index.ts is S2). With include:["src","test"]
# and zero .ts files, `tsc --noEmit` exits 2 with error TS18003.
#   - .gitkeep placeholders do NOT help (tsc ignores them — still TS18003).
#   - `tsc --showConfig` also exits non-zero on empty input — NOT a usable gate.
# Implication: the S1 gate CANNOT be a full `tsc --noEmit`. Use the STAGED gates in the
# Validation Loop. The full tsc gate is satisfied cumulatively at end of M1.T1 (after S2).
# Do NOT "fix" TS18003 by creating a stray index.ts — that is S2's deliverable.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — '*' version spec is intentional, leave it as-is
# dependencies "@earendil-works/pi-coding-agent":"*" and "typebox":"*" use '*' deliberately.
# Verified: both packages ARE on the npm registry (0.84.1 / 1.3.7), so `npm install` resolves
# '*' to a concrete version for local IntelliSense; at Pi load time Pi resolves them from its
# OWN global install regardless. Do NOT pin to fixed versions — the spec wants Pi's installed
# version to win at runtime.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — the `smoke` script is defined-but-not-runnable at S1
# scripts.smoke = 'pi -e ./src/index.ts -p "$(cat test/integration/scenarios.md)"' references
# files that don't exist yet (index.ts=S2, scenarios.md=P1.M7). That is FINE: npm never runs
# scripts during `install`. Just define it verbatim; it activates later.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — do not touch .gitignore
# It already ignores node_modules/, dist/, build/. PRP rules forbid modifying it. Nothing needed.
# ────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

> N/A — this is a scaffold subtask. No runtime data models, no ORM, no Pydantic equivalents.
> The only "structures" are the two JSON config files, given verbatim below.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE package.json  (repo root)
  - WRITE the exact JSON below (only deviation vs spec §1.1: added "@types/node":"^22" to
    devDependencies — see GOTCHA #1).
  - FIELD CHECKLIST after writing:
      name            = "pi-mulligan"
      version         = "0.1.0"
      type            = "module"
      main            = "src/index.ts"
      pi.extensions   = ["./src/index.ts"]
      dependencies    = { "@earendil-works/pi-coding-agent": "*", "typebox": "*" }
      devDependencies = { "typescript": "^5", "vitest": "^1", "@types/node": "^22" }
      scripts.test    = "vitest run"
      scripts.smoke   = "pi -e ./src/index.ts -p \"$(cat test/integration/scenarios.md)\""
  - DO NOT add a "private" or "bin" field; spec defines none.
  - DO NOT pin the two runtime deps to concrete versions (see GOTCHA #3).

  EXACT CONTENT:
  {
    "name": "pi-mulligan",
    "version": "0.1.0",
    "type": "module",
    "main": "src/index.ts",
    "pi": { "extensions": ["./src/index.ts"] },
    "dependencies": {
      "@earendil-works/pi-coding-agent": "*",
      "typebox": "*"
    },
    "devDependencies": {
      "typescript": "^5",
      "vitest": "^1",
      "@types/node": "^22"
    },
    "scripts": {
      "test": "vitest run",
      "smoke": "pi -e ./src/index.ts -p \"$(cat test/integration/scenarios.md)\""
    }
  }

Task 2: CREATE tsconfig.json  (repo root)
  - WRITE the exact JSON below (verbatim from spec §11 §1.2 / external_deps.md §2.1 — NO changes).
  - FIELD CHECKLIST: target=ES2022, module=ESNext, moduleResolution=Bundler, strict=true,
    noImplicitAny=true, types=["node"], skipLibCheck=true, include=["src","test"].
  - EXACT CONTENT:
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "strict": true,
      "noImplicitAny": true,
      "types": ["node"],
      "skipLibCheck": true
    },
    "include": ["src", "test"]
  }

Task 3: CREATE directory skeleton
  - mkdir -p src/tools test/integration
  - These four dirs end up created: src/, src/tools/, test/, test/integration/ (test/ is an
    ancestor of test/integration/).
  - LEAVE THEM EMPTY. Do not create index.ts or any *.test.ts (later subtasks).
  - OPTIONAL: add an empty .gitkeep in each only if your git workflow rejects empty dirs;
    it has zero effect on tsc and is not required by the spec.

Task 4: CREATE .pi/extensions/  (project-local auto-discovery dir)
  - mkdir -p .pi/extensions
  - LEAVE EMPTY. The symlink/copy of ./src/index.ts into here is finalized in S2 once index.ts
    exists (a symlink to a not-yet-created file would be dangling now). Creating the dir now
    means S2 only needs to add the entry file.
  - RATIONALE: per pi docs/extensions.md "Extension Locations", `.pi/extensions/*.ts` and
    `.pi/extensions/*/index.ts` are the project-local auto-discovery paths that support /reload.

Task 5: RUN npm install  (populates node_modules + package-lock.json)
  - Run `npm install` at repo root.
  - EXPECT: exits 0; creates node_modules/ and package-lock.json.
  - VERIFY (post-install) the two runtime deps and @types/node resolve at top level:
        test -d node_modules/@earendil-works/pi-coding-agent && echo OK_AGENT
        test -d node_modules/typebox && echo OK_TYPEBOX
        test -f node_modules/@types/node/package.json && echo OK_TYPES_NODE
    All three must print. (If OK_TYPES_NODE is missing, GOTCHA #1 fix did not take — re-check
    package.json devDependencies.)
  - NOTE: package-lock.json is a generated artifact (gitignore already covers node_modules/;
    leave package-lock.json tracked — do NOT add it to .gitignore).

Task 6: VALIDATE  (no file changes — run the gates in the Validation Loop below)
  - Level 1 gates only. Record that TS18003 at this stage is EXPECTED (GOTCHA #2).
```

### Implementation Patterns & Key Details

```jsonc
// package.json — note JSON does not support comments; the blocks above are pure JSON.
// If you want inline rationale, put it in a separate file, NOT inside package.json
// (npm/tsc parse strict JSON; a trailing comment will break `npm install`).

// tsconfig.json likewise must be strict JSON (tsc accepts JSONC only when explicitly enabled;
// the spec uses plain JSON, so keep it comment-free).
```
- **JSON strictness**: `package.json` and `tsconfig.json` must be valid JSON (no `//` comments,
  no trailing commas). `npm install` will fail on malformed `package.json`. The spec shows
  `jsonc` blocks with comments for human readability — **strip the comments** when writing the
  actual files.
- **Key ordering**: JSON key order is semantically irrelevant, but keep the spec's order for
  reviewer diff-friendliness (name, version, type, main, pi, dependencies, devDependencies, scripts).
- **No build step**: Pi loads the extension via jiti (on-the-fly TS transpile). `tsc --noEmit` is a
  *type-check* gate only — there is no emit/dist directory and none should be created.

### Integration Points

```yaml
Pi EXTENSION DISCOVERY:
  - package.json field: "pi": { "extensions": ["./src/index.ts"] }   # package-style entry point
  - project-local dir:  .pi/extensions/                               # auto-discovery (created here, empty)
  - Both coexist; both are populated progressively by later subtasks.

DOWNSTREAM CONSUMERS (created by later subtasks — do NOT create here):
  - src/index.ts           -> S2 (minimal stub), finalized in P1.M7.T1
  - src/{config,log,runtime,markers,filter,transforms,ledger,tokens,notes,nudges}.ts -> P1.M1–M4
  - src/tools/{rewind,shrink,checkpoint,audit}.ts                   -> P1.M5
  - test/*.test.ts                                                  -> P1.M2–M3 (Tier-1 unit tests)
  - test/integration/{smoke.ts,scenarios.md}                        -> P1.M7.T2

CONFIG:
  - none at runtime yet. Mulligan's own settings live in Pi settings.json ("mulligan" key),
    read by config.ts in P1.M1.T2 — not this subtask.
```

---

## Validation Loop

### Level 1: Syntax & Style (the ONLY level applicable to strict S1)

```bash
# (a) Both files are valid JSON (strict — npm/tsc reject comments & trailing commas).
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
node -e "JSON.parse(require('fs').readFileSync('tsconfig.json','utf8')); console.log('tsconfig.json OK')"

# (b) Directory skeleton exists exactly as specified.
test -d src && test -d src/tools && test -d test && test -d test/integration && test -d .pi/extensions \
  && echo "DIRS OK" || echo "DIRS MISSING"

# (c) package.json field values are exactly right (catch typos / version drift).
node -e "
const p=require('./package.json');
const ok = p.name==='pi-mulligan' && p.version==='0.1.0' && p.type==='module'
  && p.main==='src/index.ts'
  && JSON.stringify(p.pi)===JSON.stringify({extensions:['./src/index.ts']})
  && p.dependencies['@earendil-works/pi-coding-agent']==='*'
  && p.dependencies.typebox==='*'
  && p.devDependencies.typescript==='^5'
  && p.devDependencies.vitest==='^1'
  && p.devDependencies['@types/node']==='^22'         # GOTCHA #1 deviation
  && p.scripts.test==='vitest run';
console.log(ok ? 'package.json FIELDS OK' : 'package.json FIELDS WRONG: '+JSON.stringify(p,null,2));
"

# (d) npm install succeeds and the three needed top-level packages resolve.
npm install
test -d node_modules/@earendil-works/pi-coding-agent && echo "OK_AGENT"
test -d node_modules/typebox && echo "OK_TYPEBOX"
test -f node_modules/@types/node/package.json && echo "OK_TYPES_NODE"   # required for tsconfig types:['node']

# Expected: all echoes print; npm install exits 0.
```

```bash
# (e) TYPE-CHECK READINESS — synthetic gate (proves the tsconfig is valid & resolvable).
#     Create a throwaway stub, type-check, then REMOVE it (the real stub belongs to S2).
printf 'export default function () {}\n' > src/index.ts
npx tsc --noEmit -p tsconfig.json && echo "TSC READY (exit 0) — scaffold type-check-capable"
rm -f src/index.ts   # leave src/ empty again; S2 owns the real stub

# Expected: "TSC READY (exit 0)". This confirms GOTCHA #1 fix works and tsconfig is correct.
# If you instead run `npx tsc --noEmit` WITHOUT the stub, you will (correctly) see:
#   error TS18003: No inputs were found ...  (exit 2)  ← expected at strict S1, see GOTCHA #2.
```

### Level 2: Unit Tests

> N/A at S1 — no source code exists to test. The `test` script (`vitest run`) is defined but will
> report "no test files" until P1.M2. Do not run it as an S1 gate.

### Level 3: Integration Testing

> N/A at S1 — no extension to load. The `pi -e ./src/index.ts` load test belongs to S2
> (P1.M1.T1.S2 "Create minimal index.ts stub that loads without error"). The `smoke` script is
> defined here but only becomes runnable in P1.M7.T2.

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the toolchain versions this scaffold was verified against (informational, not a gate):
node --version           # any Node 18+ (ES2022 target); 20+ recommended
pi --version             # expect 0.84.x (verified env has 0.84.1)
node -e "console.log('typebox global:', require('$(npm root -g)/@earendil-works/pi-coding-agent/node_modules/typebox/package.json').version)" 2>/dev/null || true  # expect 1.3.7
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 (a)–(e) all pass: both files valid JSON; dir skeleton present; package.json fields
      exact; `npm install` exits 0 with OK_AGENT + OK_TYPEBOX + OK_TYPES_NODE; synthetic tsc gate
      prints "TSC READY (exit 0)" and the throwaway stub is removed.
- [ ] `src/`, `src/tools/`, `test/`, `test/integration/`, `.pi/extensions/` all exist and are EMPTY
      (no stray index.ts / *.test.ts / scenarios.md created prematurely).
- [ ] `package-lock.json` generated and left tracked (not gitignored).

### Feature Validation (scope discipline)
- [ ] `package.json` and `tsconfig.json` match the spec verbatim EXCEPT the documented
      `@types/node` addition (GOTCHA #1).
- [ ] No source code, no tests, no README written (those are S2+ / P1.M7.T4).
- [ ] TS18003 on a no-stub `tsc --noEmit` is understood as expected, not treated as a defect.

### Code Quality / Convention Validation
- [ ] Both JSON files are strict JSON (no `//` comments, no trailing commas).
- [ ] `*` version specs on the two runtime deps are preserved (not pinned) — GOTCHA #3.
- [ ] `.gitignore` is untouched (PRP rule); existing ignores already cover node_modules/dist/build.

### Documentation & Deployment
- [ ] No env vars introduced.
- [ ] `scripts.smoke` defined verbatim even though not yet runnable (GOTCHA #4).

---

## Anti-Patterns to Avoid

- ❌ Don't pin `@earendil-works/pi-coding-agent` or `typebox` to a fixed version — the `*` spec is
  deliberate (Pi resolves at load; spec §1.1 note + external_deps.md §4).
- ❌ Don't omit `@types/node` — `tsconfig` `"types": ["node"]` makes `tsc --noEmit` fail TS2688
  without it (verified).
- ❌ Don't "fix" TS18003 by creating a permanent `src/index.ts` — that is S2's deliverable; use the
  throwaway-stub synthetic gate in Level 1 (e) and remove it.
- ❌ Don't add `//` comments or trailing commas inside `package.json`/`tsconfig.json` — they must be
  strict JSON.
- ❌ Don't create a `dist/`/`build/` step or `.npmignore` — Pi transpiles via jiti at load; no emit.
- ❌ Don't modify `.gitignore`, `PRD.md`, `tasks.json`, or `prd_snapshot.md` (PRP rules — read-only).
- ❌ Don't create any module files (`config.ts`, `transforms.ts`, tools, tests) — out of scope for S1.

---

## Confidence Score: 9/10

One-pass success is very high: the deliverables are two small verbatim JSON files plus `mkdir`,
every gate is proven executable in this exact environment, and the single deviation (`@types/node`)
is verified necessary and sufficient. The −1 reserves for the (rare) possibility that a fresh
`npm install` hits a transient registry hiccup on the `*` specs — re-running resolves it.