# PRP — P1.M2.T1.S2: Add `typecheck` script to package.json (BUG-002 enabler)

## Goal

**Feature Goal**: Add a self-documenting `typecheck` npm script (`"typecheck": "tsc --noEmit"`) to
`package.json` so that `npm run typecheck` type-checks the entire project (both `src` and `test`,
per `tsconfig.json`). This is the CI-gate **script enabler** called for in PRD §2.5
("add a CI `tsc --noEmit` gate so the project type-checks cleanly").

**Deliverable**: A single key/value insertion into the `scripts` object of **exactly one file** —
`package.json`. No other file is touched. No CI workflow is wired (that is explicitly out of scope;
the contract OUTPUT says "CI *can* add this as a gate" — the script is the deliverable).

**Success Definition**: After the edit, (a) `package.json` is valid JSON (parses), (b) `npm run typecheck`
resolves to `tsc --noEmit` and — **once sibling S1's fixture fix is applied** — exits 0 with no errors,
and (c) the existing `test` and `smoke` scripts are unchanged and still work.

> ⚠️ **Cross-item dependency (important)**: `npm run typecheck` will exit **non-zero** (TS2352 at
> `test/drift_nudge.test.ts:239`) **until sibling task P1.M2.T1.S1 is applied**. S1 fixes that fixture
> in a *different file* (`test/drift_nudge.test.ts`), so there is **zero file conflict** between S1 and
> S2. But the validation gate "`npm run typecheck` exits 0" is only satisfiable after S1 lands. This
> matches the item contract: *"Verify: `npm run typecheck` exits 0 after S1 is applied."* The **script
> addition itself is independently correct and committable regardless of S1** — it just won't *pass*
> until S1's fix is present.

## User Persona (if applicable)

**Target User**: Developers / CI wanting a uniform, discoverable way to run the strict type-check.

**Use Case**: A contributor runs `npm run typecheck` (or CI calls it) before merge; it must pass
cleanly (given S1 is applied). `npm run` is the universal entry point — contributors don't need to
remember `npx tsc --noEmit` or the exact flags.

**Pain Points Addressed**: Today there is **no** `typecheck` script (only `test` = vitest and
`smoke` = integration). Vitest transpiles **without** type-checking, which is exactly why BUG-002
(the stale fixture) went unnoticed. Adding the script makes the type-check gate one-command and
CI-usable.

## Why

- **Shift-left / CI readiness (PRD §2.5)**: the PRD's explicit recommendation is to "add a CI
  `tsc --noEmit` gate so the project type-checks cleanly." The *script* is the prerequisite for that
  gate (CI calls `npm run typecheck`); the *fixture fix* (S1) is what makes it *pass*. S2 provides
  the gate; S1 provides the green.
- **Discoverability**: `npm run typecheck` shows up in `npm run` output (the script index), making
  the project's type-checking expectation self-documenting for new contributors.
- **Consistency**: standard projects expose `typecheck` / `type-check` alongside `test`. This follows
  that convention at zero runtime cost (no dependency change — `typescript ^5` is already a
  devDependency, installed).

## What

One new line in the `scripts` object of `package.json`. The `scripts` object goes from:

```json
"scripts": {
  "test": "vitest run",
  "smoke": "node test/integration/run-smoke.mjs"
}
```

to:

```json
"scripts": {
  "test": "vitest run",
  "smoke": "node test/integration/run-smoke.mjs",
  "typecheck": "tsc --noEmit"
}
```

No new dependency, no config change, no test change, no CI workflow file.

### Success Criteria

- [ ] `package.json` `scripts` contains an entry `"typecheck": "tsc --noEmit"`.
- [ ] The value is exactly `tsc --noEmit` (bare `tsc` — **not** `npx tsc` / `./node_modules/.bin/tsc`;
      npm auto-adds `node_modules/.bin` to `PATH` for script commands; **not** `tsc -p tsconfig.json`
      — redundant, since tsc reads `tsconfig.json` from cwd by default).
- [ ] The existing `test` and `smoke` scripts are unchanged (same keys, same values).
- [ ] `package.json` is valid JSON (parses — no trailing comma errors, no single quotes).
- [ ] `npm run typecheck` prints the resolved command and runs `tsc --noEmit` (exit 0 **given S1 is
      applied**; if S1 is not yet applied, it is expected to exit non-zero with the known TS2352 —
      that is NOT a defect of S2, see Cross-item dependency above).
- [ ] No file other than `package.json` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current `scripts` object, the exact JSON to produce, the exact
find/replace, the verified npm/`tsc` behavior (why bare `tsc` works, why no `-p` is needed), the single
real failure mode (JSON syntax), the cross-item dependency on S1 (so the implementer doesn't misread a
non-zero exit as a bug), and the deterministic validation commands. The implementer needs no exploration
beyond opening `package.json`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: package.json
  why: The scripts object (the only place to add the typecheck entry). Current scripts: test, smoke.
  pattern: "flat object of \"name\": \"command\" pairs under the top-level \"scripts\" key."
  gotcha: "Strict JSON only — double quotes, NO trailing commas, NO comments. The new entry is appended
           last, so the PRECEDING entry (smoke) must gain a trailing comma and the NEW entry has none."

# MUST READ — the type-check command target (what the script invokes)
- file: tsconfig.json
  why: tsc --noEmit (no -p) reads THIS file from cwd. \"include\":[\"src\",\"test\"] + \"strict\":true
        means a single `tsc --noEmit` type-checks the ENTIRE project — which is exactly the gate.
  pattern: "compilerOptions.strict=true; include=[src,test]; noEmit is passed on the CLI (not in tsconfig)."
  gotcha: "READ-ONLY — do NOT add \"noEmit\":true to tsconfig.json (out of scope; the script passes --noEmit
           on the command line, which is the conventional, less-surprising approach). Do NOT edit tsconfig."

# MUST READ — the bug-hunt research (why this script is needed + validation commands)
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/tsc_fixture_research.md
  why: §5 explicitly notes \"There is no `tsc --noEmit` script in package.json (only vitest), so CI would
        need to add an explicit gate. This is why the error went unnoticed.\" §11 gives the validation
        commands (tsc --noEmit must exit 0; vitest must stay 882/882). Confirms this script is the gap.
  critical: "§5 says the script is the missing CI-gate enabler. §11 confirms `npx tsc --noEmit` is the
             canonical check; `npm run typecheck` must be equivalent to it."

# CONTEXT — the type the script will (after S1) validate cleanly
- file: src/runtime.ts
  why: READ-ONLY. The `rewindRefusedTurnIndex: number | null` field (line ~101) is what the stale fixture
        omits. Referenced only to explain WHY `npm run typecheck` exits non-zero pre-S1. Do NOT edit it.
  gotcha: "Pre-S1, `npm run typecheck` exits non-zero with TS2352 on test/drift_nudge.test.ts:239. That is
           expected and is S1's job to fix, NOT S2's. S2 only adds the script."

# CONTEXT — the sibling contract (what makes the gate go GREEN)
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/P1M2T1S1/PRP.md
  why: CONTRACT. S1 edits test/drift_nudge.test.ts ONLY (adds rewindRefusedTurnIndex:null to the rt() fixture).
        After S1, `tsc --noEmit` exits 0. S2's \"npm run typecheck exits 0\" gate is satisfiable only post-S1.
        S1 and S2 touch DIFFERENT files → no conflict, any order OK; but S2's pass-gate requires S1 present.
  gotcha: "Do NOT duplicate S1's fixture edit here. S2's deliverable is the package.json script only."

# EXTERNAL — npm scripts + tsc CLI behavior (why bare `tsc` with no `-p` is correct)
- url: https://docs.npmjs.com/cli/v10/using-npm/scripts
  why: Confirms \"node_modules/.bin\" is added to PATH for script commands → bare `tsc` resolves to the
        installed typescript binary. No need for npx/relative path.
  critical: "npm scripts run with ./node_modules/.bin on PATH. So `tsc` === the installed tsc. Writing
             `npx tsc` is redundant; writing `./node_modules/.bin/tsc` is brittle. Use bare `tsc`."
- url: https://www.typescriptlang.org/docs/handbook/compiler-options.html#compiler-options
  why: Confirms that invoking `tsc` with no input files and no `-p` compiles the project based on
        tsconfig.json in the current directory. So `tsc --noEmit` is complete and correct for this repo.
  critical: "No need for `-p tsconfig.json` — tsc auto-discovers tsconfig.json in cwd. `--noEmit` is the
             only flag needed (the script is a check, not a build)."
```

### Current Codebase tree (the relevant slice)

```bash
package.json              # ← THIS PRP edits the `scripts` object (add one key)
tsconfig.json             # READ-ONLY — strict:true, include:[src,test]; tsc --noEmit reads it
src/                      # type-checked by the script (via tsconfig.include)
test/                     # type-checked by the script (via tsconfig.include)
  └── drift_nudge.test.ts # edited by SIBLING S1 (NOT this PRP) — the stale fixture BUG-002
package-lock.json         # npm is the package manager (present; no yarn/pnpm/bun lockfile)
( .github/workflows/ )    # ABSENT — no CI config exists; wiring CI is OUT OF SCOPE for this item
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
package.json   # +1 key ("typecheck": "tsc --noEmit") inside the existing `scripts` object
```

### Known Gotchas of our codebase & Library Quirks

```jsonc
// CRITICAL GOTCHA #1 (JSON validity — the ONLY real failure mode): package.json is strict JSON.
//   The new entry is appended LAST in `scripts`, so you must:
//     - add a trailing comma after the `smoke` value's closing quote, AND
//     - give the NEW `typecheck` entry NO trailing comma (it is the last key).
//   The exact find/replace in "Implementation Tasks" handles both atomically — use it verbatim.

// CRITICAL GOTCHA #2 (bare `tsc`, not `npx tsc` / not a path): npm auto-adds node_modules/.bin to PATH
//   for script commands, so `tsc` resolves to the installed typescript (^5, currently 5.9.3). Writing
//   `npx tsc --noEmit` works but is redundant and spawns an extra process; `./node_modules/.bin/tsc` is
//   brittle. The contract specifies exactly `tsc --noEmit` — use that verbatim.

// CRITICAL GOTCHA #3 (no `-p tsconfig.json`): tsc with no inputs/`-p` compiles based on tsconfig.json in
//   the cwd automatically. `tsc --noEmit` is complete and correct. Adding `-p tsconfig.json` is harmless
//   but redundant and not what the contract specifies — omit it.

// CRITICAL GOTCHA #4 (the exit-0 gate DEPENDS ON S1): `npm run typecheck` exits NON-ZERO with TS2352 at
//   test/drift_nudge.test.ts:239 UNTIL sibling S1 lands its fixture fix. That non-zero exit pre-S1 is
//   EXPECTED and is NOT a defect of S2. S2's deliverable (the script) is correct independently. The
//   validation gate "exits 0" is only checkable in an environment where S1 is also applied.

// CRITICAL GOTCHA #5 (script value has NO spaces to over-quote): the command `tsc --noEmit` is a plain
//   string with one internal space — it needs no extra quoting inside the JSON string. Just
//   `"typecheck": "tsc --noEmit"`.

// OUT OF SCOPE (do NOT touch in this subtask):
//   - test/drift_nudge.test.ts → that is SIBLING S1's job (the stale fixture fix).
//   - tsconfig.json → READ-ONLY (do NOT add "noEmit":true; the script passes --noEmit on the CLI).
//   - src/runtime.ts (or any src/*) → production code; out of scope.
//   - .github/workflows/* or any CI YAML → wiring CI is explicitly OUT OF SCOPE (contract OUTPUT §4:
//     "CI *can* add this as a gate" — i.e. the script enables it; CI wiring is a separate concern).
//   - README / spec docs → contract DOCS [Mode A]: the script name `typecheck` is self-documenting; no
//     doc change needed.
// This PRP edits ONLY package.json (the `scripts` object).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. `package.json` is a static JSON manifest; the change is one key/value in the
existing `scripts` object. The value is the literal string `tsc --noEmit`._

### Implementation Tasks (ordered by dependencies)

Exactly one task — a single find/replace on the `scripts` object. Apply it as one exact edit.

```yaml
Task 1: EDIT package.json — append `"typecheck": "tsc --noEmit"` to the `scripts` object
  - LOCATE the top-level "scripts" object. It currently has exactly two keys: "test" and "smoke".
  - FIND (verbatim current — the whole scripts object):
      "scripts": {\n    "test": "vitest run",\n    "smoke": "node test/integration/run-smoke.mjs"\n  }
  - REPLACE WITH:
      "scripts": {\n    "test": "vitest run",\n    "smoke": "node test/integration/run-smoke.mjs",\n    "typecheck": "tsc --noEmit"\n  }
  - RATIONALE: Appends `typecheck` as the LAST script key. The `smoke` entry gains a trailing comma
    (it is no longer last); the new `typecheck` entry has no trailing comma (it is last). This keeps
    valid JSON and a minimal, logical diff (test → smoke → typecheck grouping).
  - FORM: 2-space indentation for the scripts keys (matches the existing `test`/`smoke` lines, which
    are 2-space indented under "scripts"). Double quotes everywhere. No trailing comma on the new key.
  - VALUE: exactly `tsc --noEmit` — bare `tsc` (npm puts node_modules/.bin on PATH), `--noEmit` flag.
    Do NOT use `npx tsc`, `./node_modules/.bin/tsc`, or `tsc -p tsconfig.json`.
  - DO NOT:
      * reorder or edit the existing "test" or "smoke" entries;
      * add a dependency (typescript ^5 is already a devDependency);
      * add "noEmit": true to tsconfig.json (the flag belongs on the CLI, not in tsconfig);
      * create any CI workflow file (out of scope);
      * touch test/drift_nudge.test.ts (sibling S1's job);
      * edit the README or any spec doc (Mode A — self-documenting script name).
```

#### Resulting `scripts` object (post-edit)

```json
"scripts": {
  "test": "vitest run",
  "smoke": "node test/integration/run-smoke.mjs",
  "typecheck": "tsc --noEmit"
}
```

#### Full resulting `package.json` (post-edit, for reference)

```json
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
    "smoke": "node test/integration/run-smoke.mjs",
    "typecheck": "tsc --noEmit"
  }
}
```

### Implementation Patterns & Key Details

```jsonc
// The single change: one new script key appended to the `scripts` object.
// BEFORE (scripts object):
//   "scripts": {
//     "test": "vitest run",
//     "smoke": "node test/integration/run-smoke.mjs"
//   }
// AFTER (scripts object):
//   "scripts": {
//     "test": "vitest run",
//     "smoke": "node test/integration/run-smoke.mjs",
//     "typecheck": "tsc --noEmit"
//   }
//
// WHY bare `tsc` (not `npx tsc`): npm scripts run with ./node_modules/.bin prepended to PATH, so `tsc`
// resolves to the installed typescript binary. `npx tsc` would spawn an extra npx process needlessly.
//
// WHY no `-p tsconfig.json`: when tsc is invoked with no input files and no `-p`, it compiles the
// project based on tsconfig.json in the current working directory. So `tsc --noEmit` already covers
// the full project (src + test, per tsconfig.include). `-p tsconfig.json` would be redundant.
//
// WHY append-last (vs alphabetical re-sort): the existing order (test, smoke) is not alphabetical, so
// "logical grouping" + minimal diff wins. test → smoke → typecheck is a sensible read order and the
// contract accepts either "alphabetically or logically" placement.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — manifest-only edit (Mode A).
  - DATABASE: none
  - CONFIG: none (tsconfig.json is READ-ONLY; do NOT add noEmit:true there)
  - ROUTES: none
  - DEPENDENCIES: none (typescript ^5 is already a devDependency; no install/lockfile change needed)
  - CI: none in THIS item (wiring a GitHub Actions / other CI step to call `npm run typecheck` is a
        separate, explicitly-out-of-scope concern per the contract. The script is the gate ENABLER.)
  - CODE: none (src/* and test/* are READ-ONLY references; sibling S1 edits test/drift_nudge.test.ts —
          separate file, no conflict)
  - The only "integration" is TYPE-CHECK GATE READINESS: this script is what CI (future) and devs
    (now) call. Combined with S1's fixture fix, `npm run typecheck` becomes a passing gate.
```

---

## Validation Loop

This is a one-line manifest edit. Validation = JSON validity + script resolution + (conditional) the
strict type-check + the full vitest suite (regression guard). Run all four.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) JSON validity — the ONLY thing this edit can break. MUST parse with no error.
node -e "const p=require('./package.json'); console.log('scripts:', Object.keys(p.scripts).join(', '))"
# Expected: prints "scripts: test, smoke, typecheck" and exits 0. If it throws, the JSON is malformed
#           (likely a trailing-comma or missing-comma error) — fix the edit before proceeding.

# (b) Confirm the new key + value are exactly right.
node -e "console.log(require('./package.json').scripts.typecheck)"
# Expected: prints exactly `tsc --noEmit` (no npx, no path, no -p).

# (c) Confirm the existing scripts survived unchanged.
node -e "const s=require('./package.json').scripts; console.log(s.test, '|', s.smoke)"
# Expected: prints `vitest run | node test/integration/run-smoke.mjs`
```
Expected: all three node one-liners print the expected strings and exit 0.

### Level 2: Unit Tests (Component Validation)

```bash
# There is no "unit" for a manifest edit, but verify the script RESOLVES and runs tsc:
npm run typecheck
echo "typecheck exit: $?"
# Expected (PRE-S1): exits NON-ZERO with one TS2352 at test/drift_nudge.test.ts:239. This is EXPECTED
#   and NOT a defect of S2 — it is the very bug S1 fixes.
# Expected (POST-S1): exits 0 with NO output. This is the gate passing.
# Either way, confirm the command that ran was `tsc --noEmit` (npm prints it as the first line, e.g.
#   "> pi-mulligan@0.1.0 typecheck\n> tsc --noEmit").

# Full test suite — regression guard (S2 changes NO runtime/test code, so this MUST stay 882/882).
npx vitest run
# Expected: 882 tests pass, 0 failures. (If this changes, S2 accidentally edited something beyond
#   package.json — re-check scope.)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for a manifest-only edit. There is no service to start, no endpoint, no DB.
# The "system" validation IS Level 1 (JSON parses) + Level 2 (npm run typecheck resolves to tsc --noEmit).
# Optional sanity: confirm npm lists the new script in its index.
npm run
# Expected: the printed list of scripts includes `typecheck` alongside `test` and `smoke`.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Equivalence proof (optional): confirm `npm run typecheck` is equivalent to `npx tsc --noEmit`.
# Run both and compare exit codes (do this POST-S1 so both pass):
npm run typecheck; echo "npm run typecheck -> $?"
npx tsc --noEmit  ; echo "npx tsc --noEmit   -> $?"
# Expected: identical exit codes (both 0 post-S1). This proves the script is a faithful alias for the
# canonical command cited in research §11.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `package.json` parses as valid JSON (`node -e "require('./package.json')"` exits 0).
- [ ] `npm run typecheck` resolves to and runs `tsc --noEmit` (npm prints the resolved command).
- [ ] `npm run typecheck` exits **0** in an environment where **sibling S1 is applied** (the TS2352
      at test/drift_nudge.test.ts:239 is gone). (Pre-S1 it is expected to exit non-zero — not an S2 bug.)
- [ ] `npx vitest run` — full suite passes (882 tests, 0 failures; S2 changes no runtime code).

### Feature Validation
- [ ] `scripts.typecheck === "tsc --noEmit"` (exactly — bare `tsc`, `--noEmit`, no `npx`, no `-p`).
- [ ] The existing `test` (`vitest run`) and `smoke` (`node test/integration/run-smoke.mjs`) scripts are
      unchanged.
- [ ] `typecheck` is placed as the last key in the `scripts` object (after `smoke`); `smoke` has a
      trailing comma; `typecheck` does not.
- [ ] No edits to any file other than `package.json`.

### Code Quality / Scope Discipline
- [ ] Did NOT add a dependency (typescript ^5 already present — no install/lockfile change).
- [ ] Did NOT edit `tsconfig.json` (READ-ONLY; `--noEmit` is passed on the CLI, not added to tsconfig).
- [ ] Did NOT touch `test/drift_nudge.test.ts` (sibling S1's job — the stale fixture fix).
- [ ] Did NOT create any CI workflow file (`.github/workflows/*` etc.) — CI wiring is out of scope.
- [ ] Did NOT edit the README or any spec doc (Mode A — `typecheck` is self-documenting).

### Documentation
- [ ] No user-facing/config/API/spec surface change (Mode A — manifest-only, self-documenting script).
- [ ] The script name `typecheck` is discoverable via `npm run` (npm's script index) — no extra docs needed.

---

## Anti-Patterns to Avoid

- ❌ Don't write `npx tsc --noEmit` — redundant; npm already puts `node_modules/.bin` on PATH for scripts,
  so bare `tsc` resolves to the installed binary. The contract specifies exactly `tsc --noEmit`.
- ❌ Don't write `tsc -p tsconfig.json --noEmit` — redundant; tsc auto-discovers `tsconfig.json` in cwd.
  (It works, but it's not what the contract specifies and adds noise.)
- ❌ Don't add `"noEmit": true` to `tsconfig.json` — out of scope; the flag belongs on the CLI so the
  tsconfig stays a build config and the script is an explicit check.
- ❌ Don't reorder the existing `test`/`smoke` scripts or "fix" their values — the contract only ADDS a
  script; keep the diff to the single new key (+ the one comma delta on `smoke`).
- ❌ Don't misread a **pre-S1** non-zero exit from `npm run typecheck` as an S2 bug. S2 adds the script
  correctly; the TS2352 is BUG-002, which sibling S1 fixes in a different file. The script is correct
  independently of whether S1 has landed.
- ❌ Don't wire a CI workflow in this item — the contract OUTPUT says "CI *can* add this as a gate,"
  meaning the script is the deliverable/enabler; CI YAML is a separate concern.
- ❌ Don't add a `typescript` dependency — it's already a devDependency (`^5`, currently 5.9.3). Adding
  it again would corrupt the manifest / be a no-op error.
- ❌ Don't introduce a JSON syntax error (trailing comma after `typecheck`, or a missing comma after
  `smoke`). The verbatim find/replace in "Implementation Tasks" handles the comma correctly — use it.

---

## Confidence Score

**10/10** for one-pass implementation success. This is a single key/value insertion in one JSON manifest,
with the verbatim current `scripts` object, the exact target JSON, the verified npm/`tsc` behavior (why
bare `tsc` with no `-p` is correct), the single real failure mode (JSON syntax) covered by an exact
find/replace, and deterministic validation gates (JSON parse; `npm run typecheck` resolves to
`tsc --noEmit`; vitest 882/882 regression). The only nuance — the exit-0 gate depends on sibling S1
landing the fixture fix in a *different* file — is explicitly called out so the implementer doesn't
misread a pre-S1 non-zero exit as an S2 defect. No file conflict with S1 or any other sibling; the
script is correct and committable independently.