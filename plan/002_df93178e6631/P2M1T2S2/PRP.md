---
name: "P2.M1.T2.S2 — Update nudges tests: resize fixtures, per-tool scenarios, bloatThresholdFor unit test"
---

## Goal

**Feature Goal**: Bring `test/nudges.test.ts` to **green** after P2.M1.T2.S1 lands per-tool threshold
resolution in `bloatReminderHandler`. This means: (1) resize the threshold-dependent fixtures (which are now
under the raised per-tool thresholds), (2) fix every existing test that relied on the old single global
threshold, (3) add a standalone **unit test** for the newly-exported `bloatThresholdFor` helper, and
(4) add **per-tool handler scenario tests** that prove the handler resolves the threshold per toolName.

**Deliverable**: A modified `test/nudges.test.ts` — **ONE file**, no source changes, no new files. Adds:
updated constants, a new import (`bloatThresholdFor`), one new `describe` block (helper unit test), one new
`describe` block (per-tool handler scenarios), and surgical fixes to the broken existing tests.

**Success Definition**:
- `npx vitest run test/nudges.test.ts` → **all green** (0 failed). Previously 10 tests were RED after S1
  raised thresholds; after S2 they are GREEN plus new coverage is added.
- `npx tsc --noEmit` passes (new import resolves; new tests type-check).
- `bloatThresholdFor` has explicit unit coverage (bash/read/unknown/undefined/empty-map).
- The handler is proven to resolve per-tool: a `read` result at 18000 bytes is pass-through (under 20480)
  while a `grep` result at the same 18000 bytes fires (over global 16384).
- `npm test` passes overall (no other test file regressed — S2 touches ONLY test/nudges.test.ts).

## User Persona (if applicable)

**Target User**: The coding agent / maintainer. This is a **test-only** subtask with no user-facing surface.
The downstream consumer is the milestone's green test suite (gate for P2.M1.T2.S3 smoke refs and S4 README).

**Use Case**: A future contributor changes per-tool thresholds in `DEFAULT_CONFIG`; the unit + scenario tests
here pin the resolution contract so a regression is caught immediately.

**Pain Points Addressed**: After S1, 10 nudges tests are RED because their 9000-byte `OVER_TEXT` fixture is
now under the per-tool `read` threshold (20480). Without S2, the suite is broken and CI is unusable.

## Why

- **Business value**: This is the **verification half** of milestone P2.M1.T2. S1 made per-tool resolution
  behave; S2 proves it behaves and unbreaks the suite. Without it, the milestone's definition-of-done
  (`npm test` green) is impossible.
- **Position in plan**: Second subtask of P2.M1.T2. **Upstream (DONE/landing in parallel):**
  P2.M1.T1.S1 (config field + `DEFAULT_CONFIG` defaults: `bloatThresholdBytes:16384`,
  `bloatThresholdBytesByTool:{ bash:32768, read:20480 }`) and P2.M1.T1.S2 (validateConfig coercion).
  P2.M1.T2.S1 (landed in parallel) **exports** `bloatThresholdFor` and wires it into `bloatReminderHandler`.
  **Downstream:** P2.M1.T2.S3 (smoke.ts threshold refs), P2.M1.T2.S4 (README Mode B).
- **Scope discipline**: S2 touches ONLY `test/nudges.test.ts`. It does NOT touch `src/nudges.ts` (S1),
  `src/config.ts` (S1/S2), `test/config.test.ts`, `test/integration/smoke.ts` (S3), or `README.md` (S4).

## What

No user-visible behavior changes — test-only. The file's existing threshold-fixture tests are resized and
made per-tool-aware; new coverage asserts the resolution contract.

### Success Criteria

- [ ] `test/nudges.test.ts` imports `bloatThresholdFor` from `../src/nudges.js` (added to the existing import).
- [ ] Fixture constants reflect per-tool resolution: an `OVER_TEXT` whose byte size exceeds the **resolved**
      threshold for the toolName the read-tests use (read → 20480), e.g. 21000 bytes.
- [ ] All 10 previously-failing threshold tests are GREEN (boundary, justUnder, renderBloatReminder reuse,
      approxTokens pin, multi-result grep/bash fixtures, and the comments).
- [ ] A new `describe` block unit-tests `bloatThresholdFor`: bash→32768, read→20480, unknown→16384,
      undefined→16384, and empty-override-map→16384 (hand-built config literal — see CRITICAL GOTCHA #1).
- [ ] A new `describe` block adds 4 per-tool handler scenarios (bash under/over, grep over-global, read
      over-global-but-under-read) — the last two are the discriminating pair proving per-tool resolution.
- [ ] `npx vitest run test/nudges.test.ts` → 0 failed. `npx tsc --noEmit` → 0 errors. `npm test` → green.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement S2 from: the exact list of which existing
tests break and why (full enumeration below), the resolved-threshold constants to introduce, the exact
fixture byte sizes to use (with the math for `approxTokens` pins), the **hand-built config literal** for the
empty-map case (the one non-obvious trap — `setConfig` cannot produce an empty map), the four per-tool
scenario designs, and the project's test patterns (vitest, hand-rolled fakes, `setConfig`/`getRuntime`).

### Documentation & References

```yaml
- docfile: plan/002_df93178e6631/P2M1T2S1/PRP.md
  why: THE CONTRACT for what S1 lands. bloatThresholdFor signature + verbatim body + the one-line handler
       change. S2 unit-tests the export and resizes fixtures to match the new resolution.
  section: "Implementation Tasks (Task 1 — bloatThresholdFor body)" + "RESOLUTION TABLE"

- docfile: plan/002_df93178e6631/architecture/test_impact_analysis.md
  why: The breakage analysis this PRP operationalizes. Confirms the 9000-byte fixture breaks and lists the
       required updates. S2 implements them.
  section: "Critical Breakage: test/nudges.test.ts"

- docfile: plan/002_df93178e6631/P2M1T2S2/research/critical-findings.md
  why: Authoritative research notes — esp. CRITICAL FINDING #1 (setConfig cannot build an empty map because
       coerceBloatThresholdByTool MERGES over the fallback) and the full break/keep-green enumeration.
  section: "Finding 1" (empty-map) + "Finding 5" (break vs green) + "Finding 6" (scenario table)

- file: src/nudges.ts
  why: After S1, contains the exported bloatThresholdFor and the wired bloatReminderHandler. S2 imports
       bloatThresholdFor from here. (Do NOT modify this file in S2.)
  pattern: "export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number"

- file: src/config.ts
  why: DEFAULT_CONFIG (16384 / { bash:32768, read:20480 }) + the empty-map coercion behavior that drives
       CRITICAL GOTCHA #1. READ-ONLY in S2.
  pattern: "coerceBloatThresholdByTool MERGES over fallback (line 311) → setConfig({bloatThresholdBytesByTool:{}}) keeps defaults"

- file: test/nudges.test.ts
  why: THE ONLY file S2 modifies. Contains the constants, fakes, and test blocks enumerated below.
  pattern: "hand-rolled fakes (makePi/makeCtx/makeEvent), setConfig({}) reset in beforeEach, getRuntime(sid).pendingBloatHits"
```

### Current Codebase tree (relevant slice)

```bash
src/nudges.ts            # S1 DONE: + export bloatThresholdFor; handler line wired (S2 does NOT touch)
src/config.ts            # S1/S2 DONE: DEFAULT_CONFIG 16384 / { bash:32768, read:20480 } (S2 READ-ONLY)
test/nudges.test.ts      # S2 MODIFIES THIS FILE ONLY (fixtures + new describe blocks)
test/config.test.ts      # UNTOUCHED (S1/S2 own; 29 passing — S2 must not regress)
test/integration/smoke.ts# UNTOUCHED (P2.M1.T2.S3 owns the >8KB canary refs)
README.md                # UNTOUCHED (P2.M1.T2.S4 owns Mode B docs)
```

### Desired Codebase tree

No files added or removed — S2 is a pure edit of `test/nudges.test.ts`.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 (EMPTY-MAP CONFIG — the #1 one-pass killer): The item says "Construct configWithEmptyMap by
//   setting nudges.bloatThresholdBytesByTool = {}". DO NOT use setConfig for this. src/config.ts's
//   coerceBloatThresholdByTool (line 311) does `result = { ...(fallback ?? {}) }` where fallback is the
//   DEFAULT_CONFIG clone { bash:32768, read:20480 }. So setConfig({nudges:{bloatThresholdBytesByTool:{}}})
//   yields { bash:32768, read:20480 } (defaults PRESERVED), NOT {} → bloatThresholdFor("bash", cfg) returns
//   32768, NOT the expected 16384 → unit test FAILS. FIX: hand-build a MulliganConfig literal that BYPASSES
//   validateConfig:
//     const emptyMapConfig: MulliganConfig = { ...DEFAULT_CONFIG, nudges: { ...DEFAULT_CONFIG.nudges, bloatThresholdBytesByTool: {} } };
//   bloatThresholdFor is PURE (takes config as a param, never calls validateConfig), so the literal works.
//   Import DEFAULT_CONFIG + type MulliganConfig from "../src/config.js".

// CRITICAL #2 (THRESHOLD constant is READ-resolved, NOT global): The item says "Update THRESHOLD constant to
//   16384". That is INCORRECT for the existing tests — every `makeEvent("read", ...)` test resolves the
//   threshold via bloatThresholdFor("read", cfg) = 20480, NOT 16384. The boundary test (`y".repeat(THRESHOLD)`),
//   justUnder (`z".repeat(THRESHOLD-1)`), and renderBloatReminder-reuse (`renderBloatReminder("read", OVER_BYTES, THRESHOLD)`)
//   ALL need the READ-resolved value 20480. Introducing THRESHOLD=16384 would break all three. FIX: introduce
//   named resolved-threshold constants — READ_THRESHOLD=20480, BASH_THRESHOLD=32768, GLOBAL_THRESHOLD=16384 —
//   and use READ_THRESHOLD where the existing code used THRESHOLD (all are read-tool tests). This is both
//   correct AND more self-documenting than a single ambiguous THRESHOLD.

// CRITICAL #3 (multi-result fixtures ALSO break — not just the headline fixtures): The two multi-result tests
//   use non-read toolNames whose fixtures (10000-byte grep, 20000-byte bash) are now UNDER their resolved
//   thresholds (grep→global 16384; bash→32768). They silently record 0 hits instead of the expected hits →
//   FAIL. The item's (a)-(d) list does not call these out explicitly, but "Update nudges tests" + "npm test
//   passes" makes them IN SCOPE. Resize: grep 10000→20000 (>16384), bash 20000→40000 (>32768). See Task 3.

// CRITICAL #4 (boundary is strict `<`, not `<=`): bloatReminderHandler does `if (bytes < threshold) return;`.
//   So bytes == threshold FIRES (annotated), bytes == threshold-1 is pass-through. The boundary test asserts
//   exactly-at-threshold → res defined. Keep this invariant when resizing: `y".repeat(READ_THRESHOLD)` (20480)
//   with read threshold 20480 → 20480 < 20480 false → fires ✓. justUnder `z".repeat(READ_THRESHOLD-1)` (20479)
//   → 20479 < 20480 true → pass-through ✓.

// GOTCHA #5 (approxTokens = ceil(bytes/4) — recompute pins): Existing test pins approxTokens(9000)===2250
//   (= ceil(9000/4)). After resize, OVER_BYTES=21000 → approxTokens=ceil(21000/4)=5250. The multi-result grep
//   fixture 20000 → ceil(20000/4)=5000. Update BOTH the `.toBe(<pin>)` assertions AND inline comments.

// GOTCHA #6 (the bloat-hit-record test uses "grep", not "read"): That test does makeEvent("grep", OVER_TEXT),
//   so its resolved threshold is GLOBAL 16384. OVER_TEXT=21000 > 16384 → fires ✓ (no change to the toolName).
//   Only the OVER_BYTES pin (2250→5250) changes. Do NOT "fix" the toolName to read.

// GOTCHA #7 (config gates + mulligan_* skip tests STAY GREEN — do not over-edit): They short-circuit BEFORE
//   the threshold line (`if (!config.enabled || !config.nudges.bloatReminder) return;` and
//   `if (event.toolName.startsWith("mulligan_")) return;`). The OVER_TEXT resize alone keeps them green.
//   The mulligan_* "still fires for a normal toolName" sanity test uses makeEvent("read", OVER_TEXT) —
//   21000 > 20480 → fires ✓ (green after resize, no edit beyond the constant).

// GOTCHA #8 (fail-open healthy-cfg test STAYS GREEN after resize): It uses makeEvent("read", OVER_TEXT) and
//   asserts res defined + 1 hit + 0 log lines. 21000 > 20480 → fires ✓. The Proxy-throw tests throw before
//   the threshold line — unaffected by resize.

// GOTCHA #9 (per-tool scenario discriminating pair): The grep-over-global (18000 > 16384 → fires) and
//   read-over-global-but-under-read (18000 < 20480 → pass-through) cases use the SAME 18000 bytes with
//   DIFFERENT toolNames. This is the single strongest proof of per-tool resolution. Keep 18000 in BOTH
//   (it sits in (16384, 20480) — over global, under read) — do NOT make them the same size as each other's
//   discriminator, and do NOT change one toolName to match the other.
```

## Implementation Blueprint

### Data models and structure

No data models. S2 introduces three named test constants (resolved-threshold values) and reuses the file's
existing fakes (`makeEvent`, `makeCtx`) and helpers (`getRuntime`, `approxTokens`, `renderBloatReminder`).
The only new import is `bloatThresholdFor` (+ `getConfig`, `DEFAULT_CONFIG`, type `MulliganConfig`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/nudges.test.ts — UPDATE IMPORTS
  - EDIT line 7 (the existing nudges import) to ADD bloatThresholdFor:
      // BEFORE
      import { bloatReminderHandler, registerBloatReminder } from "../src/nudges.js";
      // AFTER
      import { bloatReminderHandler, registerBloatReminder, bloatThresholdFor } from "../src/nudges.js";
  - EDIT the config import (currently `import { setConfig } from "../src/config.js";`) to ALSO import
    getConfig, DEFAULT_CONFIG, and the MulliganConfig TYPE:
      // AFTER
      import { setConfig, getConfig, DEFAULT_CONFIG } from "../src/config.js";
      import type { MulliganConfig } from "../src/config.js";
  - WHY: bloatThresholdFor is unit-tested directly (pure fn, takes config as a param). getConfig supplies the
    validated DEFAULT_CONFIG for the default-config cases; DEFAULT_CONFIG + MulliganConfig type build the
    hand-literal empty-map config (CRITICAL GOTCHA #1).
  - DO NOT import from any other module. approxTokens and renderBloatReminder are already imported.

Task 2: MODIFY test/nudges.test.ts — RESIZE CONSTANTS + INTRODUCE RESOLVED-THRESHOLD NAMES
  - FIND the constant block (currently):
      const OVER_TEXT = "x".repeat(9000);
      const OVER_BYTES = 9000;
      const THRESHOLD = 8192;
      const UNDER_TEXT = "small";
  - REPLACE WITH (introduce named resolved-threshold constants — CRITICAL GOTCHA #2; resize OVER_TEXT — CRITICAL #3):
      // Resolved per-tool thresholds (DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool + global 16384).
      // These are the values bloatThresholdFor(toolName, getConfig()) returns for DEFAULT_CONFIG.
      const READ_THRESHOLD = 20480;   // makeEvent("read", ...) resolves here
      const BASH_THRESHOLD = 32768;   // makeEvent("bash", ...) resolves here
      const GLOBAL_THRESHOLD = 16384; // makeEvent("grep"/"unknown", ...) and undefined/"" resolve here
      /** OVER-THRESHOLD fixture for read-tool tests: 21000 > READ_THRESHOLD (20480) → over.
       *  approxTokens = ceil(21000/4) = 5250. (For the grep bloat-hit test, 21000 > GLOBAL 16384 → over too.) */
      const OVER_TEXT = "x".repeat(21000);
      const OVER_BYTES = 21000;
      /** UNDER-THRESHOLD fixture: 5 bytes < any threshold → pass-through. */
      const UNDER_TEXT = "small";
  - UPDATE the comment block ABOVE the constants (currently references "8192", "8KB", ">=8193 bytes",
    "9000-byte", "2250"): reword to "DEFAULT_CONFIG: enabled:true, nudges.bloatReminder:true,
    bloatThresholdBytes:16384, bloatThresholdBytesByTool:{ bash:32768, read:20480 }. OVER-THRESHOLD fixture
    is 21000 bytes > read's resolved 20480."
  - UPDATE the beforeEach comment (references "threshold 8192"): → "threshold 16384 global / read 20480
    / bash 32768 (per-tool resolution)".

Task 3: MODIFY test/nudges.test.ts — FIX THE BROKEN EXISTING TESTS (5 edits)
  - 3a) boundary test ("exactly at the boundary"): change THRESHOLD → READ_THRESHOLD in TWO spots:
      // BEFORE
      const atText = "y".repeat(THRESHOLD); // exactly 8192 bytes
      // AFTER
      const atText = "y".repeat(READ_THRESHOLD); // exactly 20480 bytes (read's resolved threshold)
      // (update the inline comment: 8192→20480; the "8192 is NOT < 8192" note → "20480 is NOT < 20480")
  - 3b) justUnder test ("one byte under the boundary"):
      // BEFORE
      const justUnder = "z".repeat(THRESHOLD - 1); // 8191 bytes
      // AFTER
      const justUnder = "z".repeat(READ_THRESHOLD - 1); // 20479 bytes (< read's 20480 → pass-through)
  - 3c) renderBloatReminder-reuse test: change THRESHOLD → READ_THRESHOLD:
      // BEFORE
      expect(appended.text).toBe(renderBloatReminder("read", OVER_BYTES, THRESHOLD));
      // AFTER
      expect(appended.text).toBe(renderBloatReminder("read", OVER_BYTES, READ_THRESHOLD));
      // (the handler now uses bloatThresholdFor("read",cfg)=20480, so the reuse must pass READ_THRESHOLD)
  - 3d) bloat-hit-record test: update the approxTokens PIN (GOTCHA #5/#6 — keep toolName "grep"):
      // BEFORE
      expect(hits[0]).toEqual({ toolName: "grep", approxTokens: approxTokens(OVER_BYTES) });
      // explicit pinned value: ceil(9000/4) = 2250
      expect(hits[0].approxTokens).toBe(2250);
      // AFTER
      expect(hits[0]).toEqual({ toolName: "grep", approxTokens: approxTokens(OVER_BYTES) });
      // explicit pinned value: ceil(21000/4) = 5250
      expect(hits[0].approxTokens).toBe(5250);
  - 3e) multi-result "a second over-threshold result" test — RESIZE the grep fixture (CRITICAL GOTCHA #3):
      // BEFORE
      bloatReminderHandler(makeEvent("read", OVER_TEXT), ctx);
      bloatReminderHandler(makeEvent("grep", "y".repeat(10000)), ctx); // different toolName + size
      const hits = getRuntime("multi").pendingBloatHits;
      expect(hits).toHaveLength(2);
      expect(hits[0]).toEqual({ toolName: "read", approxTokens: approxTokens(OVER_BYTES) });
      expect(hits[1]).toEqual({ toolName: "grep", approxTokens: approxTokens(10000) });
      // AFTER  (grep 10000 → 20000 so 20000 > GLOBAL 16384 → fires; approxTokens(20000)=5000)
      bloatReminderHandler(makeEvent("read", OVER_TEXT), ctx);
      bloatReminderHandler(makeEvent("grep", "y".repeat(20000)), ctx); // 20000 > global 16384 → fires
      const hits = getRuntime("multi").pendingBloatHits;
      expect(hits).toHaveLength(2);
      expect(hits[0]).toEqual({ toolName: "read", approxTokens: approxTokens(OVER_BYTES) });
      expect(hits[1]).toEqual({ toolName: "grep", approxTokens: approxTokens(20000) });
  - 3f) multi-result "an under-threshold result interleaved" (mixed) test — RESIZE the bash fixture:
      // BEFORE  (bash 20000 < 32768 → would NOT fire → only 1 hit, breaks the [read,bash] expectation)
      bloatReminderHandler(makeEvent("read", OVER_TEXT), ctx); // over → 1 hit
      bloatReminderHandler(makeEvent("read", UNDER_TEXT), ctx); // under → no hit
      bloatReminderHandler(makeEvent("bash", "q".repeat(20000)), ctx); // over → 1 hit
      // AFTER  (bash 20000 → 40000 so 40000 > BASH 32768 → fires)
      bloatReminderHandler(makeEvent("read", OVER_TEXT), ctx); // over (read) → 1 hit
      bloatReminderHandler(makeEvent("read", UNDER_TEXT), ctx); // under → no hit
      bloatReminderHandler(makeEvent("bash", "q".repeat(40000)), ctx); // 40000 > bash 32768 → 1 hit
      // (the trailing `expect(hits).toHaveLength(2)` + `expect(hits.map(h => h.toolName)).toEqual(["read","bash"])`
      //  are UNCHANGED — they now hold because the resized bash fixture fires.)
  - After Task 3, all 10 previously-RED threshold tests + the multi-result tests are GREEN. (Verify via Level 2.)

Task 4: ADD the bloatThresholdFor unit-test describe block (PURE function — no Pi runtime)
  - PLACE: a new top-level `describe(...)` block anywhere among the other describe blocks (recommended: right
    after the existing "registerBloatReminder" block, before "config gates", since it tests the lowest-level
    helper the handler depends on).
  - NAMING: describe("bloatThresholdFor — per-tool resolution (spec/07 §1; DEFAULT_CONFIG)", () => { ... })
  - EXACT code (CRITICAL GOTCHA #1 — empty-map uses a HAND-BUILT literal, NOT setConfig):
      describe("bloatThresholdFor — per-tool resolution (spec/07 §1; DEFAULT_CONFIG)", () => {
        it("resolves known tools to their per-tool override", () => {
          const config = getConfig(); // DEFAULT_CONFIG after setConfig({}) in beforeEach
          expect(bloatThresholdFor("bash", config)).toBe(32768);
          expect(bloatThresholdFor("read", config)).toBe(20480);
        });

        it("resolves an unknown toolName to the GLOBAL default (16384)", () => {
          const config = getConfig();
          expect(bloatThresholdFor("unknown_tool", config)).toBe(16384);
          expect(bloatThresholdFor("grep", config)).toBe(16384);
        });

        it("resolves a falsy/missing toolName to the GLOBAL default (16384)", () => {
          const config = getConfig();
          expect(bloatThresholdFor(undefined, config)).toBe(16384);
          expect(bloatThresholdFor("", config)).toBe(16384); // empty string is falsy → global
        });

        it("falls back to the global when the override map is EMPTY (hand-built config, bypasses validateConfig)", () => {
          // CRITICAL: setConfig({nudges:{bloatThresholdBytesByTool:{}}}) does NOT produce an empty map —
          // coerceBloatThresholdByTool MERGES over the DEFAULT_CONFIG fallback ({bash:32768,read:20480}).
          // So hand-build a literal that bypasses validateConfig entirely (bloatThresholdFor is pure).
          const emptyMapConfig: MulliganConfig = {
            ...DEFAULT_CONFIG,
            nudges: { ...DEFAULT_CONFIG.nudges, bloatThresholdBytesByTool: {} },
          };
          expect(bloatThresholdFor("bash", emptyMapConfig)).toBe(16384); // bash not in {} → global
          expect(bloatThresholdFor("read", emptyMapConfig)).toBe(16384);
          expect(bloatThresholdFor("unknown_tool", emptyMapConfig)).toBe(16384);
        });

        it("respects an explicit custom override for a tool", () => {
          // Same hand-built-literal technique to override a single tool without the merge filling in defaults.
          const customConfig: MulliganConfig = {
            ...DEFAULT_CONFIG,
            nudges: { ...DEFAULT_CONFIG.nudges, bloatThresholdBytesByTool: { bash: 99999 } },
          };
          expect(bloatThresholdFor("bash", customConfig)).toBe(99999);
          expect(bloatThresholdFor("read", customConfig)).toBe(16384); // read not in map → global (NOT 20480)
        });
      });
  - DO NOT: build the empty-map or custom config via setConfig (CRITICAL GOTCHA #1). DO NOT: remove the
    `bloatThresholdFor("grep", config)` line (it documents that a real tool name not in the map → global).

Task 5: ADD the per-tool handler-scenario describe block (behavioral proof at the handler level)
  - PLACE: a new top-level `describe(...)` block (recommended: immediately after the over-threshold block,
    before the multi-result block, since it extends the "fires vs not" theme).
  - NAMING: describe("per-tool threshold resolution in bloatReminderHandler (DEFAULT_CONFIG)", () => { ... })
  - EXACT code (GOTCHA #9 — grep vs read use the SAME 18000 bytes with different toolNames):
      describe("per-tool threshold resolution in bloatReminderHandler (DEFAULT_CONFIG)", () => {
        it("a 'bash' result just under 32768 → pass-through (no reminder, no hit)", () => {
          const ctx = makeCtx({ sessionId: "bash-under" });
          const res = bloatReminderHandler(makeEvent("bash", "y".repeat(BASH_THRESHOLD - 1)), ctx);
          expect(res).toBeUndefined();
          expect(getRuntime("bash-under").pendingBloatHits).toHaveLength(0);
        });

        it("a 'bash' result over 32768 → reminder fires + 1 hit", () => {
          const ctx = makeCtx({ sessionId: "bash-over" });
          const res = bloatReminderHandler(makeEvent("bash", "y".repeat(40000)), ctx); // 40000 > 32768
          expect(res).toBeDefined();
          expect(getRuntime("bash-over").pendingBloatHits).toHaveLength(1);
        });

        it("an UNKNOWN tool result over 16384 but under 20480 → reminder fires (uses global 16384)", () => {
          const ctx = makeCtx({ sessionId: "grep-over-global" });
          const res = bloatReminderHandler(makeEvent("grep", "z".repeat(18000)), ctx); // 18000 > 16384
          expect(res).toBeDefined();
          expect(getRuntime("grep-over-global").pendingBloatHits).toHaveLength(1);
        });

        it("a 'read' result over 16384 but under 20480 → pass-through (read threshold is 20480, NOT 16384)", () => {
          // DISCRIMINATING PAIR with the grep case above: SAME 18000 bytes, DIFFERENT toolName → different outcome.
          // This is the strongest proof the handler resolves per-tool, not via a single global threshold.
          const ctx = makeCtx({ sessionId: "read-under-own" });
          const res = bloatReminderHandler(makeEvent("read", "z".repeat(18000)), ctx); // 18000 < 20480
          expect(res).toBeUndefined();
          expect(getRuntime("read-under-own").pendingBloatHits).toHaveLength(0);
        });
      });
  - DO NOT: change the grep/read pair to different byte sizes (18000 sits in (16384, 20480) — the band that
    distinguishes global from read). DO NOT: reuse OVER_TEXT here (it is 21000, which is over BOTH read and
    global — it would not discriminate).

Task 6: RUN VALIDATION (see Validation Loop)
  - npx tsc --noEmit  (after Tasks 1-5)
  - npx vitest run test/nudges.test.ts
  - npx vitest run test/config.test.ts  (regression guard — S2 must not touch config)
  - npm test  (whole suite)
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the file uses HAND-ROLLED fakes (no vi.fn for Pi objects). The per-tool scenario tests reuse
//   makeCtx({sessionId}) + makeEvent(toolName, text) + getRuntime(sessionId).pendingBloatHits — exactly the
//   existing over/under-threshold test pattern. Follow it; do NOT introduce vi.fn or a new fake.

// PATTERN: setConfig({}) in beforeEach re-validates from DEFAULT_CONFIG (fail-open). So getConfig() inside any
//   test returns a config with bloatThresholdBytes:16384 + bloatThresholdBytesByTool:{ bash:32768, read:20480 }.
//   The bloatThresholdFor unit test's default-config cases rely on this; the empty-map case does NOT (it
//   hand-builds a literal — CRITICAL GOTCHA #1).

// PATTERN (the discriminating pair): the grep/read 18000-byte cases are the keystone of the per-tool proof.
//   grep (unknown → global 16384): 18000 > 16384 → fires.
//   read (override 20480):         18000 < 20480 → pass-through.
//   Identical bytes, opposite outcomes → resolution is per-tool. Keep 18000 in both (the (16384,20480) band).

// MATH (recompute pinned values after resize — GOTCHA #5):
//   OVER_BYTES = 21000 → approxTokens = Math.ceil(21000/4) = 5250   (was 2250)
//   grep multi-result fixture = 20000 → approxTokens = Math.ceil(20000/4) = 5000
```

### Integration Points

```yaml
NO INTEGRATION SURFACE in S2 — test-only.
  - DATABASE: none
  - CONFIG: none (S2 only READS DEFAULT_CONFIG/getConfig for assertions; does NOT change config)
  - ROUTES/TOOLS: none
  - REGISTRATION: none
CONSUMES (the export that makes S2 possible — landed by S1 in parallel):
  - `export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number` in src/nudges.ts.
```

## Scope Boundaries (read before expanding scope)

**STRICTLY IN SCOPE (S2):** `test/nudges.test.ts` — update imports, resize constants, fix broken existing
tests, add the `bloatThresholdFor` unit-test describe block, add the per-tool handler-scenario describe block.

**ALREADY DONE / LANDING IN PARALLEL (do NOT redo):**
- `src/nudges.ts` — `bloatThresholdFor` exported + handler wired (P2.M1.T2.S1).
- `src/config.ts` — interface field + DEFAULT_CONFIG (16384 / { bash:32768, read:20480 }) + coercion (S1/S2).

**DO NOT IMPLEMENT in S2 (owned by other subtasks):**
- `test/integration/smoke.ts` >8KB canary refs → **P2.M1.T2.S3**.
- `README.md` config table / examples → **P2.M1.T2.S4** (Mode B).
- `test/config.test.ts` (S1/S2 own; S2 must NOT touch — regression guard only).
- Any source file change (`src/*`).

## Validation Loop

### Level 1: Type Check (after Tasks 1-5)

```bash
# From project root. Baseline is GREEN (S1 lands the export; S2 only consumes it).
npx tsc --noEmit
# Expected: zero errors.
# IF you see "Property 'bloatThresholdFor' does not exist on module" → S1 has not landed its export yet;
#   re-read P2M1T2S1/PRP.md Task 1 (it MUST be `export function bloatThresholdFor`). Confirm the import path
#   is "../src/nudges.js" (with .js — ESM, per the existing imports in this file).
# IF you see a type error on the hand-built `emptyMapConfig: MulliganConfig` → confirm DEFAULT_CONFIG is
#   imported and the spread `{ ...DEFAULT_CONFIG, nudges: {...DEFAULT_CONFIG.nudges, bloatThresholdBytesByTool: {}} }`
#   produces a structurally-complete MulliganConfig (it does — spreading DEFAULT_CONFIG fills all required fields).
```

### Level 2: Nudges test file (THE make-or-break gate)

```bash
# Before S2 (baseline after S1 lands): 10 RED | 10 GREEN (the threshold-fixture tests fail).
npx vitest run test/nudges.test.ts 2>&1 | grep -E "Test Files|Tests "
# After S2 (Tasks 1-5): ALL GREEN.
npx vitest run test/nudges.test.ts 2>&1 | grep -E "Test Files|Tests "
# Expected: Test Files 1 passed; Tests N passed (N >= previous-passing + 10-resized + new-unit + new-scenarios),
#           0 failed.
# IF a test fails:
#   - boundary/justUnder/renderBloat-reuse failing → you left a stale `THRESHOLD` (8192) reference; recheck Task 3a-3c.
#   - bloat-hit approxTokens pin failing → recompute ceil(OVER_BYTES/4); 21000→5250 (GOTCHA #5).
#   - multi-result test failing (only 1 hit instead of 2) → grep/bash fixture not resized; recheck Task 3e/3f.
#   - empty-map unit test failing (got 32768, expected 16384) → you built the config via setConfig instead of a
#     hand-built literal (CRITICAL GOTCHA #1). Switch to the spread-DEFAULT_CONFIG literal.
#   - per-tool grep/read discriminating pair BOTH fire or BOTH pass-through → you changed 18000 or reused OVER_TEXT;
#     restore 18000 in both (GOTCHA #9).
```

### Level 3: Regression guards (S2 must NOT break siblings)

```bash
# config.test.ts — S2 must not touch config; must stay at 29 passed.
npx vitest run test/config.test.ts 2>&1 | grep -E "Tests "
# Expected: 29 passed (0 failed). If ANY fails, S2 accidentally touched config — revert.

# Whole suite — smoke.ts refs (S3) may STILL be RED (owned by S3, not S2). nudges + config MUST be green.
npm test 2>&1 | grep -E "Test Files|Tests |FAIL"
# Expected: nudges.test.ts + config.test.ts GREEN. smoke.ts may still show threshold-comment drift — that is
#           P2.M1.T2.S3's scope, NOT a failure of S2. (If smoke.ts is the only non-green file, S2 is complete.)
```

### Level 4: Runtime spot-check (confirm bloatThresholdFor resolves as the tests assert)

```bash
# Optional confidence check — verify the live helper matches the unit-test expectations.
node --input-type=module -e "
import('./src/config.js').then(async ({ getConfig, setConfig }) => {
  const { bloatThresholdFor } = await import('./src/nudges.js');
  setConfig({});
  const c = getConfig();
  console.log('bash      :', bloatThresholdFor('bash', c));      // expect 32768
  console.log('read      :', bloatThresholdFor('read', c));      // expect 20480
  console.log('unknown   :', bloatThresholdFor('unknown_tool', c)); // expect 16384
  console.log('undefined :', bloatThresholdFor(undefined, c));   // expect 16384
});
"
# Expected: 32768 / 20480 / 16384 / 16384. (Requires S1 to have landed its export.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes (new import + new tests type-check; hand-built `MulliganConfig` literal OK).
- [ ] `npx vitest run test/nudges.test.ts` → **0 failed** (all previously-RED + new tests green).
- [ ] `npx vitest run test/config.test.ts` → 29 passed (regression guard; S2 did not touch config).

### Feature Validation

- [ ] `bloatThresholdFor` imported and unit-tested (bash/read/unknown/undefined/empty-map/custom).
- [ ] Empty-map unit case uses a HAND-BUILT config literal (NOT setConfig) — CRITICAL GOTCHA #1.
- [ ] Per-tool handler scenarios present (bash under/over + grep-vs-read discriminating pair at 18000 bytes).
- [ ] All 10 previously-failing threshold tests are GREEN (boundary, justUnder, renderBloat-reuse, approxTokens,
      multi-result grep, multi-result bash).
- [ ] No stale "8192"/"8KB"/"2k tokens"/"2250"/"9000" references remain in the file's comments/assertions.

### Code Quality

- [ ] Named resolved-threshold constants (READ_THRESHOLD/BASH_THRESHOLD/GLOBAL_THRESHOLD) used — no ambiguous
      single `THRESHOLD` that conflates global vs read.
- [ ] New test blocks follow the file's existing pattern (hand-rolled fakes, describe/it, getRuntime assertions).
- [ ] No source files modified (`src/*` untouched); no other test files touched; README untouched.

### Documentation & Deployment

- [ ] State: **"none — Mode A"**. Test-only; no user-facing/config/API surface. (README sync is Mode B in S4.)

## Anti-Patterns to Avoid

- ❌ Don't build the empty-map (or custom-override) config via `setConfig({nudges:{bloatThresholdBytesByTool:{}}})` —
  coerceBloatThresholdByTool MERGES over the DEFAULT_CONFIG fallback, so the map stays `{bash:32768,read:20480}`
  and the test wrongly gets 32768 instead of 16384. Hand-build a `{ ...DEFAULT_CONFIG, nudges:{...} }` literal.
- ❌ Don't set `THRESHOLD = 16384` (the item's literal suggestion) — every `makeEvent("read", ...)` test resolves
  to 20480, so boundary/justUnder/renderBloat-reuse would all break on the stale 16384. Use READ_THRESHOLD=20480.
- ❌ Don't forget the multi-result grep (10000) and bash (20000) fixtures — they are now under their per-tool
  thresholds and silently record 0 hits. Resize grep→20000, bash→40000.
- ❌ Don't make the grep/read discriminating pair use different byte sizes or reuse OVER_TEXT (21000 is over both,
  so it does not discriminate). Keep BOTH at 18000 (the (16384, 20480) band).
- ❌ Don't touch `src/nudges.ts`, `src/config.ts`, `test/config.test.ts`, `test/integration/smoke.ts`, or
  `README.md` — those belong to S1/S1-S2/S1-S2/S3/S4 respectively.
- ❌ Don't change the bloat-hit-record test's toolName from "grep" to "read" — it deliberately uses grep (global
  threshold) and only the OVER_BYTES pin (2250→5250) needs updating.
- ❌ Don't add `vi.fn`/`jest.fn` or new fakes — reuse `makeEvent`/`makeCtx`/`getRuntime` exactly as the existing
  over/under-threshold tests do.

## Confidence Score

**9/10** for one-pass implementation success. The change is confined to one test file; the exact break/keep
enumeration, exact byte sizes, and recomputed `approxTokens` pins are given verbatim; the one non-obvious trap
(empty-map config cannot come from `setConfig`) is called out as CRITICAL GOTCHA #1 with the exact hand-built
literal to use; and the discriminating-pair design (grep vs read at identical 18000 bytes) is pinned. The
1-point reserve covers the implementer (a) second-guessing the resolved-`THRESHOLD` naming and (b) trying
`setConfig` for the empty-map before reading the gotcha — both are pre-empted by CRITICAL #1/#2 + the exact
before/after in Task 3, so recovery is one re-read.

---