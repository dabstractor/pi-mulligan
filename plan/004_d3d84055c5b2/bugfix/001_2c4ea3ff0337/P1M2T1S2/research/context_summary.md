# P1.M2.T1.S2 Research — Add `typecheck` script to package.json

## Scope (single sentence)
Add one entry to the `scripts` object in `package.json`:
`"typecheck": "tsc --noEmit"` so that `npm run typecheck` type-checks the whole project.

This is the **CI-gate enabler** recommended in PRD §2.5 ("add a CI `tsc --noEmit` gate").
NOTE: this item only adds the **script**; wiring an actual CI workflow is explicitly **out of scope**
(the contract OUTPUT §4 says "CI *can* add this as a gate" — i.e. the script is the deliverable,
not CI YAML).

## Verified facts from the live repo (2025-08-08)

| Fact | Value | Source |
|------|-------|--------|
| Current `scripts` | `{ "test": "vitest run", "smoke": "node test/integration/run-smoke.mjs" }` | `package.json` |
| `tsc` version installed | 5.9.3 (`^5` devDependency) | `npx tsc --version` |
| Package manager | **npm** (`package-lock.json` present; no yarn/pnpm/bun lockfile) | repo root |
| tsconfig | `strict:true`, `include:["src","test"]`, `skipLibCheck:true` | `tsconfig.json` |
| Existing CI config | **none** (no `.github/workflows`, no `.gitlab-ci.yml`, no `.circleci`) | repo root |
| Does `tsc --noEmit` pass TODAY? | **No** — 1 TS2352 error (BUG-002 fixture). It passes only AFTER sibling S1 is applied. | architecture/tsc_fixture_research.md §2 |

## Dependency on sibling S1 (CRITICAL)
`npm run typecheck` will exit **non-zero** until S1 fixes the stale `SessionRuntime` fixture
in `test/drift_nudge.test.ts:239`. This PRP's success gate ("`npm run typecheck` exits 0") is
therefore conditional on S1 being applied first. The two tasks touch **different files**
(S1 → `test/drift_nudge.test.ts`; S2 → `package.json`) → no file conflict, but validation
of S2 must run after S1. This matches the item contract: *"Verify: `npm run typecheck` exits 0
after S1 is applied."*

## How `npm run <name>` works (so the script "just works")
- `npm run typecheck` looks up `scripts.typecheck` and executes the value in a shell with
  `./node_modules/.bin` prepended to `PATH`. So bare `tsc` resolves to the installed
  `typescript` binary — **no need to write `npx tsc` or `./node_modules/.bin/tsc`**.
  Source: npm docs "scripts" — `node_modules/.bin` is auto-added to PATH for script commands.
- `tsc --noEmit` (no `-p`) reads `tsconfig.json` from the **current working directory**
  automatically — so `npm run typecheck` run from repo root type-checks everything in
  `tsconfig.include` (`src` + `test`). Source: TS handbook `tsc` CLI: with no input
  files/`-p`, tsc compiles the project based on `tsconfig.json` in cwd.

## JSON syntax gotchas (the only real failure mode)
- `package.json` is strict JSON: **double quotes required**, **no trailing commas**,
  **no comments**, **no unescaped newlines in strings**.
- The edit is an insertion of one key/value pair into an object with ≥1 existing sibling
  (`test`, `smoke`), so the NEW entry needs a leading comma but the preceding entry keeps
  its existing trailing comma only if it isn't last. Safest mechanical rule: add
  `"typecheck": "tsc --noEmit"` as the **last** key → just append `,` to the `smoke` value's
  closing quote then add the new line (see PRP Implementation Tasks for the exact find/replace).

## Script ordering (contract says "alphabetically or logically alongside test/smoke")
- Current order is `test`, `smoke` (NOT alphabetical). To minimize the diff and keep a logical
  grouping, place `typecheck` **after `smoke`** → `test`, `smoke`, `typecheck`.
  This also happens to be alphabetical among {smoke, test, typecheck} relative to insertion point.
- Either ordering is contract-compliant; appending-last is recommended because it is a 1-line
  append with a single comma delta.

## Validation commands (re-verified against research §11)
- `npm run typecheck`  — MUST exit 0 (after S1 applied). Equivalent to `npx tsc --noEmit`.
- `npx vitest run`     — regression guard, MUST stay 882/882 (S2 changes no test/runtime code).
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` — JSON validity check.