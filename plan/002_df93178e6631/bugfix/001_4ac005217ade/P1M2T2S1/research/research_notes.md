# Research Notes — P1.M2.T2.S1: Update stale '8 KB default' test comments (BUG-004)

## Scope
Mode A (documentation/comment-only). Three surgical edits across two test files. **No logic change.**
Only comments and test `it(...)` titles are wrong; the assertions are correct (8192 passed as explicit arg
to pure helpers — valid).

## The three sites (verbatim, confirmed via grep 2025)

### 1. test/tokens.test.ts:334
```
    expect(approxTokens(8192)).toBe(2048); // the default bloatThresholdBytes → ~2k tokens
```
- `approxTokens` is a PURE byte→token helper. `8192` is just an explicit input arg. The comment falsely
  labels it "the default bloatThresholdBytes". 8192 was the OLD default; the current default is 16384.
- Fix: drop the "default" claim (e.g. `// explicit 8 KB → ~2k tokens`).

### 2. test/notes.test.ts:411
```
  it("8 KB result at the 8 KB default threshold → '~8 KB … (threshold 8 KB)'; leading \\n---\\n; no trailing newline", () => {
```
- `renderBloatReminder("read", 8192, 8192)` — both args explicit. Title falsely calls 8 KB "the default".
- Fix: `8 KB result at the 8 KB default threshold` → `8 KB result at an 8 KB threshold` (drop "default").

### 3. test/notes.test.ts:474
```
  it("representative 30 KB read at the 8 KB default threshold", () => {
```
- `renderBloatReminder("read", 30720, 8192)` — both args explicit. Title falsely calls 8 KB "the default".
- Fix: `representative 30 KB read at the 8 KB default threshold` → `representative 30 KB read at an 8 KB threshold`.

## Confirmed facts
- **No `test/notes.ts` exists** (`ls test/notes.ts` → No such file). PRD/bug_analysis references to
  "test/notes.ts:474" are a typo; the real file is `test/notes.test.ts:474`. (Source file is `src/notes.ts`.)
- **Current global default = 16384 (16 KB).** Confirmed in `src/config.ts:62`
  (`* Must be > 0. Default: 16384 (16 KB). Per-tool overrides in bloatThresholdBytesByTool`)
  and `spec/09-configuration.md:35` (`"bloatThresholdBytes": 16384`) + `:66` (defaults table).
- **Per-tool:** bash 32768 (32 KB), read 20480 (20 KB). (`spec/09-configuration.md:67`, `:36`.)
- **Exhaustive grep** for `default bloatThresholdBytes|8 KB default threshold` across the two files returns
  EXACTLY these 3 sites — no other stale "default" comments/titles in these files.

## Test runner
- `package.json`: `"test": "vitest run"`, `"vitest": "^1"` (vitest v1).
- Validation command for this change (no behavioral change expected — green stays green):
  `npx vitest run test/tokens.test.ts test/notes.test.ts`
  (equivalent: `npm run test -- test/tokens.test.ts test/notes.test.ts`).

## Why the tests stay green
- `approxTokens(8192)` and `renderBloatReminder("read", 8192, 8192)` / `renderBloatReminder("read", 30720, 8192)`
  pass 8192 EXPLICITLY. The number 8192 is a perfectly valid input to the pure helper regardless of config
  defaults. We are only editing a `// comment` and two `it("...")` string titles — vitest does not assert on
  test titles or comments, so the suite is unaffected.

## Parallel-sibling coordination (P1.M2.T1.S1)
- P1.M2.T1.S1 edits ONLY `test/integration/scenarios.md` (F-shrink-preventive section). **No file overlap.**
- It cites the same source-of-truth thresholds (16384 / 32768 / 20480). This PRP must cite identical numbers
  for cross-doc consistency.
- Neither sibling touches `test/tokens.test.ts` or `test/notes.test.ts`.

## Out of scope (do NOT touch)
- `spec/*` (spec/05 owned by P1.M1.T2.S1 [complete]; spec/07, spec/09 read-only).
- `src/*` (code, owned elsewhere / out of scope).
- `test/integration/scenarios.md` (owned by P1.M2.T1.S1).
- Any other `test/*.test.ts` file.
- **Test assertions, expect() calls, and helper args** — comments/titles ONLY.