---
name: "P2.M1.T1.S1 — Add bloatThresholdBytesByTool to config interface + DEFAULT_CONFIG + JSDoc + raise global default"
---

## Goal

**Feature Goal**: Add an optional `bloatThresholdBytesByTool?: Record<string, number>` field to
the `MulliganConfig.nudges` interface, raise the global `bloatThresholdBytes` default from `8192`
to `16384`, add a default per-tool map `{ bash: 32768, read: 20480 }`, update the JSDoc, and
update every affected literal in `test/config.test.ts`. This is the **foundation subtask** of
P2.M1 (per-tool bloat threshold): it defines the typed config surface that S2 (validation
coercion) and T2.S1 (`bloatThresholdFor` helper) build upon.

**Deliverable**: A modified `src/config.ts` (interface field + `DEFAULT_CONFIG` default +
JSDoc) and a modified `test/config.test.ts` (all `8192`→`16384` literals + the new field added
to the two `toEqual` expected objects). No new files.

**Success Definition**:
- `npx vitest run test/config.test.ts` passes (zero failures).
- `npx tsc --noEmit` passes (the new optional field type-checks).
- `DEFAULT_CONFIG.nudges.bloatThresholdBytes === 16384`.
- `DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool` deep-equals `{ bash: 32768, read: 20480 }`.
- `MulliganConfig.nudges.bloatThresholdBytesByTool` is typed `Record<string, number> | undefined`.

## Why

- **Business value**: Legitimate tool-result size differs sharply by tool (a `bash` build log vs.
  an `lsp_hover` payload). A single global threshold either under-fires for `bash` or over-fires
  for everything else. Per-tool resolution (spec §6, "Bloated-result reminder") fixes this.
- **Position in plan**: This is the **first** subtask of milestone P2.M1 — it has **no upstream
  dependency**. It is consumed by P2.M1.T1.S2 (validation reads the new field) and
  P2.M1.T2.S1 (`bloatThresholdFor` reads `config.nudges.bloatThresholdBytesByTool`).
- **Scope discipline**: This subtask deliberately does **NOT** implement the `validateConfig`
  coercion for the new field (that is S2), and does **NOT** resize the nudges/audit/smoke
  fixtures (those are T2.S2/T2.S3). See "Scope Boundaries" below — breaking those is expected.

## What

User-visible behavior is unchanged by S1 alone (the per-tool *resolution* that uses the new field
is T2.S1). S1 only extends the **config contract and defaults**:

### Success Criteria

- [ ] `MulliganConfig.nudges` has `bloatThresholdBytesByTool?: Record<string, number>` declared
      immediately after `bloatThresholdBytes`.
- [ ] `DEFAULT_CONFIG.nudges.bloatThresholdBytes` is `16384`.
- [ ] `DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool` is `{ bash: 32768, read: 20480 }`.
- [ ] JSDoc on `bloatThresholdBytes` states default `16384 (16 KB)` and that per-tool overrides
      in `bloatThresholdBytesByTool` take precedence.
- [ ] JSDoc on the new field documents keys=Pi tool names, values=byte thresholds, fallback to
      `bloatThresholdBytes`, default `{ bash: 32768, read: 20480 }`.
- [ ] Every `8192` literal in `test/config.test.ts` that denotes the **default fallback** is
      changed to `16384` (there are **7**, not 2 — see CRITICAL GOTCHA).
- [ ] `test/config.test.ts` `DEFAULT_CONFIG` and "applies a full valid override" `toEqual`
      expected objects include `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }`.
- [ ] `npx vitest run test/config.test.ts` passes.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement this from: the exact
before/after blocks in "Implementation Tasks" (verified by direct file read), the CRITICAL
GOTCHA about the 7 (not 2) `8192` literals, and the explicit scope boundary that the full suite
is *expected* to break in downstream-scoped files until T2.S2/T2.S3 land.

### Documentation & References

```yaml
- docfile: plan/002_df93178e6631/architecture/system_context.md
  why: Authoritative current-code-state snapshot + target design for the whole P2.M1 milestone.
       Confirms exact field name (bloatThresholdBytesByTool), defaults (16384 / {bash:32768,read:20480}),
       and the bloatThresholdFor resolution priority that consumes this field.
  section: "Current Code State (verified by direct read)" + "Target Design"

- docfile: plan/002_df93178e6631/architecture/test_impact_analysis.md
  why: Lists EVERY 8192 literal that must change and confirms which downstream test files
       (nudges.test.ts, audit.test.ts, smoke.ts) WILL break — and are owned by T2.S2/T2.S3, not S1.
  section: "Test Updates: test/config.test.ts" + "Critical Breakage: test/nudges.test.ts"

- file: src/config.ts
  why: The ONLY source file modified in S1. Contains the interface (lines 55-66),
       DEFAULT_CONFIG (lines ~102-105), and validateConfig (lines ~209-218 — UNCHANGED in S1).
  pattern: Fields are documented with JSDoc immediately above each declaration; DEFAULT_CONFIG
           is a const object literal that validateConfig deep-clones (never mutates).
  gotcha: DEFAULT_CONFIG is a shared singleton "frozen-by-convention". Do NOT mutate it; the
          new default is set once in the literal. validateConfig deep-clones it, so the new
          default map flows through to every getConfig()/validateConfig() result automatically.

- file: test/config.test.ts
  why: The ONLY test file modified in S1. Contains the DEFAULT_CONFIG toEqual, the "validates
       numbers" fallback assertions, the "applies a full valid override" toEqual, and the
       setConfig cache test — all of which reference the 8192 default literal.
  pattern: Assertions use vitest `expect(...).toBe(N)` and `expect(obj).toEqual({...})`.
  gotcha: 8192 appears 7 times; the item description names only 2. ALL 7 must change or tests fail.
```

### Current Codebase tree (relevant slice)

```bash
src/config.ts                 # MODIFIED in S1 (interface + DEFAULT_CONFIG + JSDoc)
test/config.test.ts           # MODIFIED in S1 (8192->16384 literals + new field in 2 toEqual)
src/nudges.ts                 # NOT touched (bloatThresholdFor is T2.S1)
src/tools/audit.ts            # NOT touched (reads bloatThresholdBytes; unchanged contract)
test/nudges.test.ts           # NOT touched in S1 (T2.S2 — EXPECTED to break until then)
test/tools/audit.test.ts      # NOT touched in S1 (T2.S2 — EXPECTED to break until then)
test/integration/smoke.ts     # NOT touched in S1 (T2.S3 — EXPECTED to break until then)
```

### Desired Codebase tree

No files added or removed — S1 is a pure edit of `src/config.ts` and `test/config.test.ts`.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (test completeness): The item description names only TWO places to change 8192->16384
// (the DEFAULT_CONFIG toEqual + the "full valid override" nudges block). But 8192 appears SEVEN
// times in test/config.test.ts. Five more are FALLBACK assertions in the "validates numbers" and
// setConfig-cache tests: they assert that an INVALID value falls back to the default. Because the
// default is now 16384, those assertions MUST read .toBe(16384) or they fail. Do all 7.

// CRITICAL (scope): After S1 raises the default, the FULL vitest suite WILL fail in
// test/nudges.test.ts, test/tools/audit.test.ts, and test/integration/smoke.ts — they call
// setConfig({}) (re-validate from DEFAULT_CONFIG) and hardcode fixtures around 8192/9000 bytes.
// This is EXPECTED and owned by T2.S2 / T2.S3. S1's gate is the SCOPED run, not the full suite.

// GOTCHA (S1 vs S2): S1 does NOT add validateConfig coercion for bloatThresholdBytesByTool.
// In S1, a user-provided map is silently ignored (unknown key). The DEFAULT_CONFIG map flows
// through via deep-clone, so DEFAULT_CONFIG + "full override" expected outputs carry it. ✓
// Do NOT add coercion logic — that is S2.

// GOTCHA (DEFAULT_CONFIG immutability): DEFAULT_CONFIG is a shared singleton. validateConfig does
// structuredClone(DEFAULT_CONFIG) first, then applies overrides. So the new default map appears in
// every validated result with zero extra code — just add it to the literal.
```

## Implementation Blueprint

### Data models and structure

No new data models. One interface field is added (optional, so existing callers stay valid):

```typescript
// In MulliganConfig.nudges, immediately AFTER bloatThresholdBytes:
bloatThresholdBytesByTool?: Record<string, number>;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config.ts — JSDoc + interface field
  - EDIT the JSDoc above `bloatThresholdBytes` (currently "Default: 8192 (8 KB).") to state the
    new default and precedence. Then ADD the new optional field declaration right after it.
  - EXACT before/after (the block currently around lines 60-63):

      // BEFORE
      /** In-context byte size of a single tool result above which the bloat reminder fires.
       *  Below Pi's ~50 KB built-in cap to catch meaningful-but-not-catastrophic results.
       *  Must be > 0. Default: 8192 (8 KB). */
      bloatThresholdBytes: number;

      // AFTER
      /** In-context byte size of a single tool result above which the bloat reminder fires.
       *  Below Pi's ~50 KB built-in cap to catch meaningful-but-not-catastrophic results.
       *  Must be > 0. Default: 16384 (16 KB). Per-tool overrides in bloatThresholdBytesByTool
       *  take precedence over this global value for the listed tools. */
      bloatThresholdBytes: number;
      /** Optional per-tool override map. Keys are Pi tool names (e.g. "bash", "read"); values
       *  are byte thresholds. A tool not listed falls back to bloatThresholdBytes. Default:
       *  { bash: 32768, read: 20480 }. */
      bloatThresholdBytesByTool?: Record<string, number>;

  - NAMING: field is camelCase `bloatThresholdBytesByTool` (matches downstream S2/T2.S1 reads).
  - PLACEMENT: directly after `bloatThresholdBytes`, before `driftThresholdTokens`.
  - DO NOT: add any coercion in validateConfig (that is S2).

Task 2: MODIFY src/config.ts — DEFAULT_CONFIG.nudges
  - RAISE bloatThresholdBytes 8192->16384 and ADD the default map on the next line.
  - EXACT before/after (currently around lines 103-104):

      // BEFORE
        bloatThresholdBytes: 8192,
        driftThresholdTokens: 3000,

      // AFTER
        bloatThresholdBytes: 16384,
        bloatThresholdBytesByTool: { bash: 32768, read: 20480 },
        driftThresholdTokens: 3000,

  - PRESERVE: bloatReminder:true, perTurnDrift:true, driftThresholdTokens:3000, and all other
    non-nudges blocks unchanged.
  - DO NOT: touch validateConfig() — the new default map reaches validated results via the
    structuredClone(DEFAULT_CONFIG) at the top of validateConfig.

Task 3: MODIFY test/config.test.ts — DEFAULT_CONFIG toEqual (the FIRST of 7 changes)
  - EXACT before/after (around line 26, inside the "matches the spec/09 §2 defaults exactly" toEqual):

      // BEFORE
          bloatThresholdBytes: 8192,
          driftThresholdTokens: 3000,

      // AFTER
          bloatThresholdBytes: 16384,
          bloatThresholdBytesByTool: { bash: 32768, read: 20480 },
          driftThresholdTokens: 3000,

Task 4: MODIFY test/config.test.ts — "validates numbers" fallback assertions (FIVE of the 7)
  - CHANGE each `.toBe(8192)` to `.toBe(16384)`. The INPUT on the "8192"-string line stays a string.
  - EXACT (lines ~92-96):

      // BEFORE
      expect(validateConfig({ nudges: { bloatThresholdBytes: -1 } }).nudges.bloatThresholdBytes).toBe(8192);
      expect(validateConfig({ nudges: { bloatThresholdBytes: 0 } }).nudges.bloatThresholdBytes).toBe(8192); // threshold must be >0
      expect(validateConfig({ nudges: { bloatThresholdBytes: NaN } }).nudges.bloatThresholdBytes).toBe(8192);
      expect(validateConfig({ nudges: { bloatThresholdBytes: Infinity } }).nudges.bloatThresholdBytes).toBe(8192);
      expect(validateConfig({ nudges: { bloatThresholdBytes: "8192" } }).nudges.bloatThresholdBytes).toBe(8192); // no string coercion

      // AFTER  (note: input "8192" STRING is unchanged; only the expected .toBe(...) changes)
      expect(validateConfig({ nudges: { bloatThresholdBytes: -1 } }).nudges.bloatThresholdBytes).toBe(16384);
      expect(validateConfig({ nudges: { bloatThresholdBytes: 0 } }).nudges.bloatThresholdBytes).toBe(16384); // threshold must be >0
      expect(validateConfig({ nudges: { bloatThresholdBytes: NaN } }).nudges.bloatThresholdBytes).toBe(16384);
      expect(validateConfig({ nudges: { bloatThresholdBytes: Infinity } }).nudges.bloatThresholdBytes).toBe(16384);
      expect(validateConfig({ nudges: { bloatThresholdBytes: "8192" } }).nudges.bloatThresholdBytes).toBe(16384); // no string coercion

Task 5: MODIFY test/config.test.ts — "applies a full valid override" EXPECTED output (the SECOND toEqual)
  - ADD the new field to the EXPECTED nudges block (the result object). The INPUT nudges block
    (the validateConfig argument) is LEFT AS-IS — the field is absent there, so validateConfig
    keeps the DEFAULT_CONFIG map via deep-clone. Only the expected `toEqual({...})` changes.
  - EXACT before/after (the expected-output line ~75; the input line ~67 is unchanged):

      // BEFORE (expected output)
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1 },

      // AFTER (expected output)
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1, bloatThresholdBytesByTool: { bash: 32768, read: 20480 } },

Task 6: MODIFY test/config.test.ts — setConfig cache fallback (the SEVENTH change)
  - EXACT (line ~183):

      // BEFORE
      expect(getConfig().nudges.bloatThresholdBytes).toBe(8192);

      // AFTER
      expect(getConfig().nudges.bloatThresholdBytes).toBe(16384);
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: validateConfig deep-clones DEFAULT_CONFIG before applying overrides (config.ts line ~170).
//   Because of this, adding bloatThresholdBytesByTool to the DEFAULT_CONFIG literal is SUFFICIENT —
//   it appears in every getConfig()/validateConfig() result with no further code. This is why the
//   "full valid override" test (which omits the field in its INPUT) still expects the DEFAULT map
//   in its OUTPUT: the clone carries it, and the 4-field override doesn't touch it.

// PATTERN: Optional interface field + present default value is intentional. The field is OPTIONAL
//   on the interface (user configs may omit it) but ALWAYS PRESENT in DEFAULT_CONFIG/validated
//   output. Callers can therefore read config.nudges.bloatThresholdBytesByTool without a guard.

// PATTERN (S2 preview, NOT to implement here): S2 will add, inside the `if (isRecord(nudgesRaw))`
//   block, a safeGet for bloatThresholdBytesByTool + a new coerceRecord-of-positive-numbers helper.
//   Do not pre-implement it — keep S1 to interface + default + JSDoc + test literals.
```

### Integration Points

```yaml
NO INTEGRATION CODE in S1. This subtask only widens the config contract and defaults.
  - DATABASE: none
  - CONFIG: the new field is read from settings.json by S2's coercion (not yet present)
  - ROUTES/TOOLS: none (bloatThresholdFor wiring is T2.S1; nudges.ts is untouched in S1)
CONSUMERS (downstream, verify field name matches):
  - P2.M1.T1.S2: validateConfig will read nudges.bloatThresholdBytesByTool
  - P2.M1.T2.S1: bloatThresholdFor reads config.nudges.bloatThresholdBytesByTool ?? {}
```

## Scope Boundaries (read before expanding scope)

**STRICTLY IN SCOPE (S1):** `src/config.ts` interface + DEFAULT_CONFIG + JSDoc; `test/config.test.ts`
literal updates + 2 expected-object additions. Nothing else.

**EXPECT TO BREAK (owned by later subtasks — do NOT fix in S1):**
- `test/nudges.test.ts` — `THRESHOLD=8192`, `OVER_TEXT="x".repeat(9000)`, boundary `"y".repeat(8192)`.
  After the default rises to 16384 (and per-tool `read`=20480), these fixtures are under-threshold.
  → fixed by **P2.M1.T2.S2**.
- `test/tools/audit.test.ts` — `beforeEach(() => setConfig({}))` + comments "threshold 8192".
  → fixed by **P2.M1.T2.S2**.
- `test/integration/smoke.ts` — comments "default 8192", >8KB canary.
  → fixed by **P2.M1.T2.S3**.

**DO NOT IMPLEMENT in S1 (owned by S2):** the `validateConfig` coercion that reads
`bloatThresholdBytesByTool` from raw input, and the new validation tests (partial-merge,
invalid-value-drop, non-object-discard). In S1, a user-supplied map is silently ignored; only the
DEFAULT_CONFIG map is active.

## Validation Loop

### Level 1: Type Check (after Tasks 1-2)

```bash
# From project root. The optional field must type-check against the present default.
npx tsc --noEmit
# Expected: zero errors. If "Property 'bloatThresholdBytesByTool' does not exist on type...",
# you forgot Task 1 (the interface declaration).
```

### Level 2: Scoped Unit Tests (THE S1 gate — after Tasks 3-6)

```bash
# This is the authoritative gate for S1. It must pass with zero failures.
npx vitest run test/config.test.ts
# Expected: all tests pass. If any ".toBe(8192)" test fails, you missed one of the 7 literals
# (Tasks 3-6). If the DEFAULT_CONFIG or "full override" toEqual fails on the nudges block, you
# forgot to add bloatThresholdBytesByTool to that expected object (Tasks 3 and 5).
```

### Level 3: Full Suite (INFORMATIONAL — expect known downstream failures)

```bash
# Runs the whole suite. EXPECT failures in nudges.test.ts / audit.test.ts (and possibly smoke)
# because they hardcode fixtures around the old 8192 default. These are T2.S2/T2.S3 scope.
npx vitest run
# Expected for S1: config.test.ts block fully GREEN; nudges.test.ts / audit.test.ts RED on
# threshold-dependent tests. Confirm the RED tests are ONLY the threshold-fixture ones described
# in plan/002_df93178e6631/architecture/test_impact_analysis.md — if config.test.ts itself is RED,
# that is an S1 defect and must be fixed before declaring done.
```

### Level 4: Contract spot-check

```bash
# Quick programmatic confirmation of the three contract facts:
node --input-type=module -e "
import('./src/config.js').then(({ DEFAULT_CONFIG }) => {
  console.log('bloatThresholdBytes:', DEFAULT_CONFIG.nudges.bloatThresholdBytes);          // 16384
  console.log('byTool:', JSON.stringify(DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool)); // {\"bash\":32768,\"read\":20480}
});
"
# Expected:
#   bloatThresholdBytes: 16384
#   byTool: {"bash":32768,"read":20480}
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes.
- [ ] `npx vitest run test/config.test.ts` passes (zero failures) — **the S1 gate**.
- [ ] Full-suite RED tests are ONLY the expected downstream threshold-fixture failures
      (nudges.test.ts / audit.test.ts / smoke.ts), all per test_impact_analysis.md.

### Feature Validation

- [ ] `DEFAULT_CONFIG.nudges.bloatThresholdBytes === 16384` (Level 4 spot-check).
- [ ] `DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool` deep-equals `{ bash: 32768, read: 20480 }`.
- [ ] `MulliganConfig.nudges.bloatThresholdBytesByTool` is optional (`?:`) and typed
      `Record<string, number>`.
- [ ] JSDoc on both `bloatThresholdBytes` and the new field states the correct default + precedence.
- [ ] All 7 `8192`→`16384` literal changes applied (grep confirms none remain except the `"8192"`
      string INPUT on the no-coercion line).

### Code Quality

- [ ] No `validateConfig` coercion added (that is S2 — keep S1 minimal).
- [ ] No nudges.ts / audit.ts / smoke.ts / README.md changes (owned by T2.S1–S4).
- [ ] Field name `bloatThresholdBytesByTool` exactly matches what S2 and T2.S1 will read.
- [ ] DEFAULT_CONFIG literal not mutated at runtime (only the const declaration edited).

## Anti-Patterns to Avoid

- ❌ Don't implement the validateConfig coercion for the new field in S1 — that is S2's job;
  doing it here blurs the subtask boundary and risks duplicating S2's test coverage.
- ❌ Don't "fix" the downstream nudges/audit/smoke failures in S1 — they are intentionally
  deferred to T2.S2/T2.S3; touching them now causes merge conflicts and scope creep.
- ❌ Don't change only the 2 `8192` literals named in prose — there are 7; grep to be sure.
- ❌ Don't add the new field to the "full valid override" INPUT (line ~67); add it only to the
  EXPECTED output (line ~75). The input must omit it so the test exercises default retention.
- ❌ Don't make the field required (`:`) — it must be optional (`?:`) so user configs without it
  remain valid; the DEFAULT_CONFIG still supplies a concrete value.

## Confidence Score

**9/10** for one-pass implementation success. The change is small (~6 source lines + ~8 test
lines), all before/after blocks are given verbatim, the make-or-break gotcha (7 not 2 literals)
is called out explicitly, and the expected-but-out-of-scope downstream failures are documented so
the implementer does not chase them. The 1-point reserve is for the possibility that the
"full valid override" expected-object edit needs the field ordered consistently with the actual
runtime key order (vitest `toEqual` is order-insensitive, so this is low-risk).