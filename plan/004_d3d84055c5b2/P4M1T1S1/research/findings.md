# P4.M1.T1.S1 Research Findings (verified against working tree)

## File: src/config.ts — verified line numbers (current tree, not the 0bcaa814 snapshot)

- `MulliganConfig.rewind` interface block: fields at **lines 40-43**:
  - `maxDepth: number;` → line 41
  - `requireMutationWarning: boolean;` → line 42
  - The interface `rewind: {` opens ~line 38; closes line 43.
- `DEFAULT_CONFIG.rewind` object literal: **lines 117-120**:
  - `maxDepth: 5,` → line 118
  - `requireMutationWarning: true,` → line 119
- `validateConfig` rewind block: lines 217-226. Key lines:
  - line 223: `v = safeGet(rewindRaw, "maxDepth");`
  - line 224: `if (v !== undefined) cfg.rewind.maxDepth = coerceNumber("rewind.maxDepth", v, cfg.rewind.maxDepth, false);`
  - line 225: `v = safeGet(rewindRaw, "requireMutationWarning");`
  - line 226: `if (v !== undefined) cfg.rewind.requireMutationWarning = coerceBoolean(...);`
- Sibling inline-fraction pattern `highWaterFraction` (nudges block): **lines 256-259**:
  - `if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1) cfg.nudges.highWaterFraction = v;`  ← uses `v < 1` (OPEN interval (0,1))
  - `else warnConfig("nudges.highWaterFraction", v);`
- Sibling integer pattern `driftWindowTurns` (nudges block): **lines 251-254**:
  - `const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);`
  - `cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;`
  - NOTE: driftWindowTurns does NOT guard `Math.floor(n) >= 1` — but the item contract REQUIRES that guard for maxRetriesPerPrompt.
- `coerceNumber` helper: **line 309**:
  - `function coerceNumber(field, value, fallback, mustBePositive): number` — finite + (>0 or >=0), NO upper bound.

## CRITICAL: abortContextFraction vs highWaterFraction
- abortContextFraction spec = `(0,1]` → use `v <= 1` (INCLUSIVE upper). ← THE critical difference.
- highWaterFraction = `(0,1)` → uses `v < 1` (EXCLUSIVE). Do NOT copy highWaterFraction verbatim.

## maxRetriesPerPrompt validation behavior (per item contract, coerceNumber + Math.floor + >=1 guard)
- 5 / 5.7 / 1 → integer>=1, KEPT (5, 5, 1). No warn.
- 0 / -1 / NaN / "abc" / Infinity → coerceNumber returns default 5 AND warns → Math.floor(5)=5≥1 → 5. Warn happened. ✓
- **EDGE CASE (documented, not a bug):** values in (0,1) e.g. 0.5/0.9 → coerceNumber(0.5,true) returns 0.5 (valid >0, NO warn) → Math.floor(0.5)=0 < 1 → keep default 5 with NO warn. The item's logic silently falls back here. T3.S1 tests must NOT assert a warn for fractional (0,1) values; use 0/-1/NaN/"abc"/Infinity to exercise the warn path.

## CRITICAL: existing tests that BREAK when DEFAULT_CONFIG.rewind grows (must fix in THIS task to keep `npm test` green)
Detailed validation tests are P4.M1.T3.S1's job, but THIS task MUST update the 2 snapshot-style `toEqual` assertions that encode the full rewind shape, or the suite goes red:

1. **config.test.ts lines 9-31** — `it("matches the spec/09 §2 defaults exactly")`:
   `expect(DEFAULT_CONFIG).toEqual({ ... rewind: { enabled, protectedRoles, maxDepth: 5, requireMutationWarning: true } ...})`
   → ADD `maxRetriesPerPrompt: 5,` and `abortContextFraction: 0.9,` to the rewind block of the EXPECTED literal (after maxDepth, before requireMutationWarning, matching spec/09 JSON order).
2. **config.test.ts lines 62-82** — `it("applies a full valid override")`:
   the override sets `rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false }`, and the assertion's expected object's rewind block is the SAME partial. Deep-merge fills the two new fields with DEFAULTS (5, 0.9).
   → ADD `maxRetriesPerPrompt: 5,` and `abortContextFraction: 0.9,` to the rewind block of the EXPECTED literal (the assertion side), so toEqual passes. (Do NOT add them to the INPUT override unless you also assert them — simplest: add to expected only, since defaults fill them.)

## Tests that do NOT break (confirmed)
- All `ProtectedConfig` partials in edge-cases.test.ts, transforms.test.ts, bug-replay-repro.test.ts (type-asserted partials; interface additions are additive).
- config.test.ts single-field `.toBe(...)` checks on rewind.maxDepth/protectedRoles (lines 100-101, 166-170).
- config.test.ts "ignores unknown keys" (lines 188-191) compares two `validateConfig` outputs to each other — both gain the fields symmetrically, still equal.
- `expectTypeOf(DEFAULT_CONFIG).toMatchTypeOf<MulliganConfig>()` — still true.

## Build/test commands (verified)
- `npm test` → `vitest run` (vitest 1.6.1, node 26). This is the primary gate.
- TypeScript: `npx tsc --noEmit` (strict mode, tsconfig.json includes ["src","test"]). NOTE: package.json has NO `tsc` script — run `npx tsc --noEmit` directly, or rely on vitest's esbuild (vitest does NOT type-check by default). To truly gate types, run `npx tsc --noEmit`.
- No separate linter/formatter configured (no eslint/prettier in package.json).

## DOCS boundary
- Mode A: spec/09-configuration.md is ALREADY at target state (committed 3ff35059) — source of truth, do NOT edit.
- No user-facing doc surface changes in this subtask (README is P4.M3).
- The interface JSDoc update IS this subtask's inline documentation deliverable.

## Scope boundary (what NOT to do here)
- Do NOT implement the guards in tools/rewind.ts (P4.M1.T2.S1/S2).
- Do NOT add the detailed validation test cases (P4.M1.T3.S1) — only fix the 2 broken snapshots.
- Do NOT add runtime.ts fields (that's P4.M1.T2.S3).
- Do NOT touch README (P4.M3.T1).