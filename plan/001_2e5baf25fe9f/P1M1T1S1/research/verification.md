# P1.M1.T1.S1 — Scaffold Verification Notes

All findings below were **empirically verified** in an isolated `/tmp/prp-verify`
sandbox using the exact package.json / tsconfig.json from
`plan/001_2e5baf25fe9f/architecture/external_deps.md` §3 and `spec/11-build-order.md` §1.1–1.2.

## Environment confirmed
- `pi` CLI present: `/home/dustin/.local/bin/pi`, version **0.84.1** (spec targets 0.84.x ✓)
- Global typebox at `…/pi-coding-agent/node_modules/typebox/package.json` → version **1.3.7** ✓
- `@earendil-works/pi-coding-agent` IS published to npm registry → `npm view … version` = `0.84.1`
  → so `"*"` version spec in dependencies DOES resolve under a plain `npm install` in this dir
  (it is not purely a load-time magic resolution; the package exists on the registry too).

## GOTCHA #1 — TS2688: `"types": ["node"]` requires @types/node at top level
- tsconfig uses `"types": ["node"]`. `tsc` needs `@types/node` resolvable at
  `node_modules/@types/node`.
- The spec's devDependencies list ONLY `typescript ^5` and `vitest ^1`.
- `vitest@^1` does NOT depend on `@types/node` (verified: its `dependencies` have none named
  `@types/node`). The only `@types/node` in the install tree is **nested 5 levels deep**
  under `@earendil-works/pi-coding-agent → @earendil-works/pi-ai → @google/genai → protobufjs → @types/node@22.19.19`.
  tsc does NOT resolve that for a top-level `"types": ["node"]` declaration.
- **Result:** `npx tsc --noEmit` exits **2** with `error TS2688: Cannot find type definition file for 'node'`.
- **Verified FIX:** add `"@types/node": "^22"` to `devDependencies`. With that + a single
  `src/index.ts` stub, `tsc --noEmit` exits **0**. ✅
- This is a justified, minimal deviation from the literal "Dev deps: typescript ^5, vitest ^1"
  contract sentence — required so the contract's OWN validation gate
  ("`npm install && npx tsc --noEmit` can validate") can actually pass. Pick `^22` to match
  the nested transitive version and the Node baseline (Node 18+/20+ era).

## GOTCHA #2 — TS18003: empty `include` dirs at strict S1 stage
- S1 creates NO `.ts` files (`src/index.ts` is S2's deliverable).
- With `include: ["src","test"]` and zero `.ts` files, `tsc --noEmit` exits **2**:
  `error TS18003: No inputs were found in config file '…/tsconfig.json'. Specified 'include'
  paths were '["src","test"]' and 'exclude' paths were '[]'.`
- `.gitkeep` placeholder files do NOT help (tsc ignores them — still TS18003).
- `tsc --showConfig` also exits non-zero on empty input (exit 1 observed) — NOT a usable gate.
- **Implication:** the S1 validation gate CANNOT be a full `tsc --noEmit`.
  S1 gate = (a) both JSON files parse, (b) `npm install` succeeds, (c) directory tree exists,
  (d) tsconfig is internally valid per `tsc -p tsconfig.json --noEmit` ONLY after ≥1 `.ts` file
  exists. The full `tsc --noEmit == 0` gate is satisfied **cumulatively at end of M1.T1**
  (after S2 adds `src/index.ts`), provided GOTCHA #1 fix (@types/node) is in place.
- The PRP states this staging explicitly so the implementer does not mistake TS18003 for a failure.

## .pi/extensions discovery (from pi docs/extensions.md)
- Project-local auto-discovery dir: `.pi/extensions/*.ts` or `.pi/extensions/*/index.ts`
  (loads only after project is trusted; supports `/reload`).
- For S1 (no index.ts yet) the right action is to CREATE the `.pi/extensions/` directory so it
  exists; the symlink/copy of `./src/index.ts` into it is finalized in S2 once index.ts exists.
- `pi.extensions` field in package.json (`["./src/index.ts"]`) is the package-style entry-point
  declaration — separate from the auto-discovery dir. Both can coexist.

## .gitignore status (DO NOT MODIFY per PRP rules)
- Existing `.gitignore` already ignores `node_modules/`, `dist/`, `build/`. Sufficient for S1.
- No `.gitignore` changes are permitted or needed.

## scripts.smoke feasibility
- `"smoke": "pi -e ./src/index.ts -p \"$(cat test/integration/scenarios.md)\""` is well-formed
  and `pi -e … -p …` is a real invocation (pi CLI confirmed present). It is NOT runnable at S1
  (no index.ts, no scenarios.md) — it activates later (S7 harness / T7). Defining it now is fine;
  npm never runs scripts during `install`.