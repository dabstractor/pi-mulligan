---
name: "P2.M1.T2.S1 — Add + export bloatThresholdFor helper and wire into bloatReminderHandler"
---

## Goal

**Feature Goal**: Add a pure, **exported** helper `bloatThresholdFor(toolName, config)` to `src/nudges.ts`
that resolves Nudge A's bloat threshold **per tool** (per-tool override map → global fallback), and replace
the single `const threshold = config.nudges.bloatThresholdBytes;` line in `bloatReminderHandler` with a
call to that helper. This makes the per-tool resolution that P2.M1.T1.S1 (config field + defaults) and
P2.M1.T1.S2 (validateConfig coercion) set up **actually take effect** at the nudge's decision point.

**Deliverable**: A modified `src/nudges.ts` — ONE new exported function added, ONE existing line in
`bloatReminderHandler` changed to call it. No new files. No tests. No docs (Mode A none).

**Success Definition**:
- `npx tsc --noEmit` passes (baseline is green; the verbatim helper compiles — verified).
- `test/config.test.ts` stays green (29 passed) — T2.S1 does not touch config.
- `bloatThresholdFor` is **exported** and is a pure function (no Pi runtime / no I/O) so it is unit-testable
  directly by P2.M1.T2.S2.
- After the wiring, `bloatReminderHandler` resolves the threshold per tool: a `read` result fires only above
  20480 bytes, `bash` above 32768, every other tool above the global 16384, and a missing/`undefined` toolName
  falls back to the global 16384.
- The 10 currently-**failing** `test/nudges.test.ts` threshold-fixture tests remain failing for the SAME root
  cause (fixtures under threshold — owned by T2.S2) and **no previously-passing** nudges test newly fails.

## User Persona (if applicable)

**Target User**: The coding agent itself. T2.S1 is internal resolution plumbing with no user-facing surface.
The downstream consumers are P2.M1.T2.S2 (unit test of the exported helper), P2.M1.T2.S3 (smoke test), and
P2.M1.T2.S4 (README docs).

**Use Case**: A `read` result of 24 KB and a `bash` build log of 30 KB should both be evaluated against
their own (higher) thresholds instead of the global default — `read` at 24 KB is over 20480 (fires), `bash`
at 30 KB is under 32768 (does not fire). A `grep` result at 18 KB is over the global 16384 (fires).

**Pain Points Addressed**: A single global threshold either under-fires for `bash` (legitimately large logs)
or over-fires for everything else. Per-tool resolution (spec §6, "Bloated-result reminder") fixes this. T2.S1
is the **resolution** half; the config field/defaults (S1) and its validation/coercion (S2) are already done.

## Why

- **Business value**: This is the **behavioral payoff** of the entire P2.M1 milestone — it is the single edit
  that makes per-tool thresholds actually steer Nudge A. Without it, S1's defaults and S2's validation are
  inert (the handler still reads the global).
- **Position in plan**: Third subtask of milestone P2.M1. **Upstream dependencies (DONE, landed in working
  tree):** P2.M1.T1.S1 added `bloatThresholdBytesByTool?: Record<string, number>` to the interface +
  `DEFAULT_CONFIG.nudges.bloatThresholdBytes = 16384` + `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }`
  + JSDoc; P2.M1.T1.S2 added the `coerceBloatThresholdByTool` helper + its validateConfig wiring, guaranteeing
  `config.nudges.bloatThresholdBytesByTool` is **always** a valid `Record<string, number>` after validation.
  **Downstream consumers:** T2.S2 (unit-tests the export + resizes fixtures + per-tool scenarios),
  T2.S3 (smoke.ts threshold refs), T2.S4 (README Mode B).
- **Scope discipline**: T2.S1 does **NOT** add/modify any test (T2.S2), does **NOT** touch `src/config.ts`
  (S1/S2 done) or any other source file, does **NOT** update README (T2.S4), and does **NOT** change anything
  in `bloatReminderHandler` beyond the single threshold line.

## What

User-visible behavior changes only in *which tool results trip the reminder*: the threshold is now resolved
per tool via `bloatThresholdFor`. Everything else about Nudge A — the append (never replace) of the reminder,
the `bytes < threshold` comparison, the `pendingBloatHits` recording, the `mulligan_*` skip, the fail-open
try/catch — is **unchanged** because it is already parameterized on the local `threshold` variable.

### Success Criteria

- [ ] `src/nudges.ts` has a new `export function bloatThresholdFor(toolName: string | undefined, config:
      MulliganConfig): number` placed after the imports and before `bloatReminderHandler` (recommended:
      immediately above the handler's JSDoc).
- [ ] The helper body is **exactly** the spec/07 §1 code (see Implementation Tasks) — copied verbatim.
- [ ] In `bloatReminderHandler`, the line `const threshold = config.nudges.bloatThresholdBytes;` is replaced
      with `const threshold = bloatThresholdFor(event.toolName, config);`. This is the **only** change to the
      handler.
- [ ] `renderBloatReminder`, the `if (bytes < threshold) return;` comparison, and the `pendingBloatHits.push`
      are **untouched** (they are already parameterized on `threshold`).
- [ ] `npx tsc --noEmit` passes.
- [ ] `test/config.test.ts` passes (29 tests — unchanged).
- [ ] No previously-passing `test/nudges.test.ts` test newly fails (see Validation Loop Level 3).

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement T2.S1 from: the verbatim helper (verified to
compile against the project's tsconfig), the exact before/after for the one-line change, the placement anchor
(line numbers below), the knowledge that S1+S2 already landed the config surface (so `config.nudges.
bloatThresholdBytesByTool` is always a valid map after validation), and the type-safety note that the
verbatim `byTool[toolName] ?? global` is correct as written (do not "improve" it). No other file is read or
modified.

### Documentation & References

```yaml
- docfile: plan/002_df93178e6631/architecture/system_context.md
  why: Authoritative current-code-state snapshot + target design. Gives the verbatim bloatThresholdFor body,
       confirms the exact line to replace, and confirms everything downstream is already parameterized on
       `threshold` (so only the one line changes).
  section: "Current Code State (src/nudges.ts — bloatReminderHandler)" + "Target Design (bloatThresholdFor)"

- file: plan/002_df93178e6631/P2M1T1S1/PRP.md
  why: The CONTRACT for the config surface S1 added. S1 is COMPLETE: interface field + DEFAULT_CONFIG
       (16384 / { bash: 32768, read: 20480 }) + JSDoc. T2.S1 READS these; must match the field name exactly.
  pattern: "bloatThresholdBytesByTool?: Record<string, number>" (optional on interface; always present after validation).

- file: plan/002_df93178e6631/P2M1T1S2/PRP.md
  why: The CONTRACT for the validation half (S2, in progress in parallel — treat as landed). Guarantees
       config.nudges.bloatThresholdBytesByTool is ALWAYS a valid Record<string,number> (merge preserves
       read:20480 when user overrides bash; never undefined after validation). This is why the helper's
       `?? {}` is a defensive belt-and-suspenders rather than a load-bearing branch.
  pattern: "validateConfig guarantees the field is a valid map; downstream bloatThresholdFor resolves per-tool→global."

- file: src/nudges.ts
  why: The ONLY source file T2.S1 modifies. Contains bloatReminderHandler (the line to change) and the
       import of MulliganConfig (already present — no new import needed).
  pattern: "Each handler is one try/catch → fail-open; reads getConfig() for a validated config. The
           threshold is resolved into a local `threshold` var that everything downstream reuses."
  gotcha: The file's module-level + handler JSDoc still say "default 8192" (stale drift from S1 raising the
          global to 16384). DO NOT edit these comments in T2.S1 (item = Mode A none; "ONLY this change to
          the handler"). They are out of scope.

- docfile: spec/07-preventive-and-nudges.md
  why: §1 is the authority for Nudge A and the bloatThresholdFor resolution priority (per-tool override →
       global fallback). The helper body in this PRP is copied verbatim from spec/07 §1.
  section: "§1 (Nudge A — bloated-result reminder)" — the threshold resolution + the exact helper code.

- docfile: spec/09-configuration.md
  why: §2 gives the defaults (bloatThresholdBytes 16384; bloatThresholdBytesByTool { bash: 32768, read: 20480 }).
  section: "§2 Defaults"
```

### Current Codebase tree (relevant slice — S1+S2 already landed)

```bash
src/config.ts            # UNTOUCHED by T2.S1 (S1 interface+defaults+JSDoc done; S2 coercion done)
src/nudges.ts            # T2.S1 MODIFIES: + bloatThresholdFor (exported), 1-line change in bloatReminderHandler
test/nudges.test.ts      # NOT touched in T2.S1 (T2.S2 — EXPECTED RED: 10 failing threshold-fixture tests)
test/config.test.ts      # NOT touched in T2.S1 (GREEN: 29 passed; must stay green)
test/integration/smoke.ts# NOT touched in T2.S1 (T2.S3 — EXPECTED RED threshold refs)
README.md                # NOT touched in T2.S1 (T2.S4 — Mode B docs)
```

### Desired Codebase tree

No files added or removed — T2.S1 is a pure edit of `src/nudges.ts` (one new exported function + one changed line).

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 (type-safety — VERIFIED NON-ISSUE, do not "fix"): tsconfig.json has "strict": true +
//   "noImplicitAny": true but NOT "noUncheckedIndexedAccess". So `byTool[toolName]` (byTool: Record<string,
//   number>) is statically typed `number` — key absence is invisible to the type system. The helper's
//   `byTool[toolName] ?? global` STILL WORKS because `??` is a RUNTIME operator: a missing key yields
//   `undefined` at runtime → `?? global` falls back. `??` on a statically-`number` left operand is NOT a
//   tsc error. VERIFIED: `npx tsc --noEmit` on the exact verbatim helper body → exit 0.
//   ACTION: Copy the helper VERBATIM. Do NOT add an `if (toolName in byTool)` guard, do NOT cast, do NOT
//   change `??` to `||`, do NOT "improve" it. The verbatim code is correct and compiles.

// CRITICAL #2 (the ONLY change to the handler): Replace exactly `const threshold = config.nudges.bloatThresholdBytes;`
//   with `const threshold = bloatThresholdFor(event.toolName, config);`. Do NOT touch renderBloatReminder,
//   the `if (bytes < threshold) return;` line, or the pendingBloatHits push — they are already parameterized
//   on the local `threshold` and need no change. The item description is explicit: "This is the ONLY change
//   to the handler."

// CRITICAL #3 (scope — no tests, no config, no docs): T2.S1 adds ZERO tests (T2.S2 owns the bloatThresholdFor
//   unit test + fixture resizes), does NOT touch src/config.ts (S1+S2 done), and does NOT update README
//   (T2.S4). DOCS = Mode A none.

// GOTCHA #4 (no new import): `import type { MulliganConfig } from "./config.js";` is ALREADY present in
//   src/nudges.ts (line 26). The helper's `config: MulliganConfig` param resolves with no import change.

// GOTCHA #5 (keep the `?? {}` fallback): The helper's `config.nudges.bloatThresholdBytesByTool ?? {}` is a
//   legitimate nullable fallback — the interface field is optional (`?:`), so its type is
//   `Record<string, number> | undefined`. (After S2 validation it is always present; the `?? {}` is defensive
//   belt-and-suspenders and keeps the function safe on any MulliganConfig, e.g. a hand-built test object.)
//   Do NOT remove it.

// GOTCHA #6 (pure function, no try/catch): bloatThresholdFor is PURE (two reads, no I/O, no Pi runtime).
//   Do NOT wrap it in try/catch — it cannot throw on valid inputs (string lookups + numeric reads). It sits
//   INSIDE bloatReminderHandler's existing outer try/catch, which already covers any unexpected throw. The
//   whole point of exporting it is that T2.S2 can unit-test it with zero Pi runtime / fakes.

// GOTCHA #7 (stale "8192" comments — leave them): src/nudges.ts module JSDoc (line 16) and the
//   bloatReminderHandler JSDoc (line 77) still say "default 8192" — pre-existing doc drift from S1 raising
//   the global to 16384. T2.S1 does NOT edit these (Mode A none; "ONLY this change to the handler"). The
//   handler JSDoc's "exceeds config.nudges.bloatThresholdBytes" is still directionally accurate (the global
//   is the per-tool fallback). Leave for a future doc-cleanup pass.
```

## Implementation Blueprint

### Data models and structure

No new data models. The helper operates on the existing `MulliganConfig` (already imported) and returns a
`number`. It is a pure resolution function:

```
priority:
  1. toolName falsy (undefined / "")              → config.nudges.bloatThresholdBytes  (global)
  2. toolName in bloatThresholdBytesByTool        → that entry's value
  3. otherwise (tool not in map)                  → config.nudges.bloatThresholdBytes  (global)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/nudges.ts — ADD + EXPORT the bloatThresholdFor helper
  - PLACE: after the imports and before bloatReminderHandler. RECOMMENDED: immediately above the
    bloatReminderHandler JSDoc (i.e. after the `interface BloatReminderResult { ... }` closing brace at
    line ~73, before the `/**` that opens the handler's JSDoc at line ~75). The item also permits
    "after the imports" (after line 51) — both compile; pick one, prefer the handler-adjacent spot so the
    helper sits next to its sole consumer.
  - NAMING: `bloatThresholdFor` (matches spec/07 §1 + the item description + the downstream T2.S2/T2.S3/T2.S4
    references). MUST be `export`ed (T2.S2 unit-tests it directly).
  - SIGNATURE: `(toolName: string | undefined, config: MulliganConfig): number`. MulliganConfig is already
    imported (line 26) — no new import.
  - EXACT new code to insert (copy VERBATIM — verified to compile; see CRITICAL GOTCHA #1):

      /**
       * bloatThresholdFor — resolve Nudge A's bloat threshold per tool (spec/07 §1). PURE: two reads, no I/O,
       * no Pi runtime (so it is unit-testable directly). Priority: if toolName is in
       * config.nudges.bloatThresholdBytesByTool, use that entry; otherwise fall back to the global
       * config.nudges.bloatThresholdBytes. A falsy toolName (undefined / "") also returns the global.
       *
       * `?? {}` is a defensive fallback for a hand-built MulliganConfig: the interface field is optional
       * (`?:`), but validateConfig guarantees it is always a valid Record<string, number> after validation
       * (S2). `byTool[toolName] ?? global` is correct at runtime (a missing key yields undefined → global)
       * even though noUncheckedIndexedAccess is off and byTool[toolName] is statically typed `number`.
       */
      export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
        const global = config.nudges.bloatThresholdBytes;
        if (!toolName) return global;
        const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
        return byTool[toolName] ?? global;
      }

  - DO NOT: add try/catch (GOTCHA #6), add an `in` check, cast anything, or change `??` (GOTCHA #1).
  - DO NOT: remove the `?? {}` fallback (GOTCHA #5).

Task 2: MODIFY src/nudges.ts — WIRE the helper into bloatReminderHandler (the ONLY handler change)
  - FIND: inside `bloatReminderHandler`, the line `const threshold = config.nudges.bloatThresholdBytes;`
    (currently line 106, immediately after `const bytes = resultBytes(...)`).
  - EXACT before/after:

      // BEFORE (current — line 106)
      const threshold = config.nudges.bloatThresholdBytes;

      // AFTER
      const threshold = bloatThresholdFor(event.toolName, config);

  - WHY this type-checks: event.toolName is a string (the handler already calls event.toolName.startsWith(...)
    without a guard), assignable to the helper's `string | undefined` first param. config is the local
    `MulliganConfig` from getConfig(), assignable to the helper's second param.
  - DO NOT: touch renderBloatReminder(event.toolName, bytes, threshold), the `if (bytes < threshold) return;`
    line, or the rt.pendingBloatHits.push(...) — all already parameterized on `threshold` (CRITICAL GOTCHA #2).
  - DO NOT: edit the stale "8192" JSDoc/comments in this file (GOTCHA #7).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: bloatReminderHandler reads getConfig() for a VALIDATED config (validateConfig deep-clones
//   DEFAULT_CONFIG then applies coerced overrides — fail-open, never throws). After S2, that validated
//   config ALWAYS carries nudges.bloatThresholdBytesByTool as a valid Record<string, number>. So the helper
//   is called with a fully-populated config; its `?? {}` is purely defensive.

// PATTERN: the handler resolves `threshold` into a LOCAL once, then every downstream branch reuses it:
//     const threshold = bloatThresholdFor(event.toolName, config);   // ← the one new line
//     if (bytes < threshold) return;                                 // unchanged
//     const reminder = renderBloatReminder(event.toolName, bytes, threshold);  // unchanged
// This is exactly why only the assignment line changes — the per-tool value propagates everywhere for free.

// PATTERN (fail-open unchanged): bloatReminderHandler is one try/catch → log + return undefined. The new
//   bloatThresholdFor call is INSIDE that try. bloatThresholdFor itself is pure and never throws on valid
//   inputs, so it adds no new throw path; the existing catch still covers any unexpected throw.

// RESOLUTION TABLE (after T2.S1, with S1/S2 defaults — the behavior T2.S2/T2.S3 will assert):
//   toolName      bloatThresholdBytesByTool   resolved threshold
//   ----------    -------------------------   ------------------
//   "bash"        32768                        32768
//   "read"        20480                        20480
//   "grep"        (absent)                     16384 (global)
//   "mcp_x_y"     (absent)                     16384 (global)
//   undefined     n/a                          16384 (global)
//   ""            n/a                          16384 (global — falsy toolName)
```

### Integration Points

```yaml
NO NEW INTEGRATION SURFACE in T2.S1. One source file gains one exported pure helper and one call site flips.
  - DATABASE: none
  - CONFIG: none (S1 added the field + defaults; S2 added coercion — both landed; T2.S1 only READS them)
  - ROUTES/TOOLS: none (the mulligan_* tools, filter, audit, etc. are untouched)
  - REGISTRATION: none (registerBloatReminder still wires the same bloatReminderHandler; its behavior shifts
    only in threshold resolution)
EXPORT SURFACE (the deliverable's reason to exist — downstream consumers):
  - P2.M1.T2.S2: `import { bloatThresholdFor } from "../src/nudges.js"` → unit-test directly (pure fn, no
    Pi runtime / fakes needed); also resizes the nudges fixtures + adds per-tool scenarios.
  - P2.M1.T2.S3: smoke.ts threshold references move to the per-tool values.
  - P2.M1.T2.S4: README Mode B documents the per-tool resolution.
```

## Scope Boundaries (read before expanding scope)

**STRICTLY IN SCOPE (T2.S1):** `src/nudges.ts` — add + export `bloatThresholdFor`; change the single
`const threshold = ...` line in `bloatReminderHandler`. Nothing else.

**ALREADY DONE (upstream — do NOT redo):**
- `MulliganConfig.nudges.bloatThresholdBytesByTool?: Record<string, number>` interface field + JSDoc (S1).
- `DEFAULT_CONFIG.nudges.bloatThresholdBytes = 16384` + `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }` (S1).
- `coerceBloatThresholdByTool` helper + validateConfig wiring guaranteeing the field is always a valid map (S2).

**EXPECT TO BREAK (owned by later subtasks — do NOT fix in T2.S1):**
- `test/nudges.test.ts` — already 10 failing (threshold-fixture tests; all fixtures under the raised
  thresholds). → **P2.M1.T2.S2** resizes fixtures + adds per-tool scenarios + adds the bloatThresholdFor unit test.
- `test/tools/audit.test.ts` — comments/asserts around the old 8192 default. → **P2.M1.T2.S2**.
- `test/integration/smoke.ts` — ">8KB canary" / "default 8192" references. → **P2.M1.T2.S3**.

**DO NOT IMPLEMENT in T2.S1 (owned by others):** any test change (T2.S2); smoke.ts refs (T2.S3);
README.md docs (T2.S4); any config.ts change (S1/S2); stale "8192" JSDoc/comment cleanup in nudges.ts
(no owner — leave for a future doc pass).

## Validation Loop

### Level 1: Type Check (THE make-or-break gate — after Tasks 1–2)

```bash
# From project root. Baseline is GREEN (verified: S1+S2 landed, T2.S1 not yet applied).
npx tsc --noEmit
# Expected: zero errors.
# If you see an error on the new bloatThresholdFor, you DID NOT copy it verbatim (CRITICAL GOTCHA #1) —
# re-copy the exact body from "Implementation Tasks". Do NOT add guards/casts/`in` checks to "fix" it.
# If you see "'MulliganConfig' is not defined" — impossible (it is imported at line 26); you likely
# mis-pasted. If you see an error at the call site, confirm event.toolName is unchanged upstream.
```

### Level 2: Config regression guard (T2.S1 must NOT break config)

```bash
# T2.S1 does not touch config.ts/config.test.ts, so this MUST stay green.
npx vitest run test/config.test.ts
# Expected: 29 passed (0 failed). If ANY config test fails, T2.S1 accidentally touched config.ts — revert
# and re-scope to src/nudges.ts ONLY.
```

### Level 3: Nudges test delta (INFORMATIONAL — confirm T2.S1 introduces NO new failure)

```bash
# BEFORE implementing: capture the baseline (expected: 10 failed | 10 passed).
npx vitest run test/nudges.test.ts 2>&1 | grep -E "Test Files|Tests "
# (record the passing count — should be 10)

# AFTER implementing: re-run. The 10 failing threshold-fixture tests stay failing (owned by T2.S2) because
# their fixtures (9000/8192/8191/10000/20000 bytes) remain under the per-tool thresholds. The 10 PASSING
# tests (registration, config gates, mulligan_* skip, fail-open throwing tests) MUST stay passing.
npx vitest run test/nudges.test.ts 2>&1 | grep -E "Test Files|Tests "
# Expected: STILL 10 failed | 10 passed. The PASSING count must NOT drop.
# WHY no pass→fail transition is possible: every bash/read fixture is already < 16384 (the old global), so
# every over-threshold test that expects firing is ALREADY failing before T2.S1. T2.S1 raises bash/read
# thresholds further (20480/32768) but cannot newly break a test that was passing — no passing test depends
# on a bash/read result in the [16384, 32768) band firing.
# IF the passing count drops (a previously-passing test newly fails): that IS a T2.S1 regression —
# investigate (you likely changed more than the one threshold line; revert to the single-line change).
```

### Level 4: Runtime spot-check (confirm the per-tool resolution actually fires)

```bash
# After Task 1, the exported helper is importable. Confirm the resolution table against the live config.
node --input-type=module -e "
import('./src/config.js').then(async ({ getConfig, setConfig }) => {
  const { bloatThresholdFor } = await import('./src/nudges.js');
  setConfig({}); // reset to DEFAULT_CONFIG (bash:32768, read:20480, global:16384)
  const c = getConfig();
  console.log('bash      :', bloatThresholdFor('bash', c));      // 32768
  console.log('read      :', bloatThresholdFor('read', c));      // 20480
  console.log('grep      :', bloatThresholdFor('grep', c));      // 16384 (global)
  console.log('undefined :', bloatThresholdFor(undefined, c));   // 16384 (global)
  console.log('empty str :', bloatThresholdFor('', c));          // 16384 (falsy → global)
});
"
# Expected:
#   bash      : 32768
#   read      : 20480
#   grep      : 16384
#   undefined : 16384
#   empty str : 16384
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes (helper copied verbatim — CRITICAL GOTCHA #1).
- [ ] `npx vitest run test/config.test.ts` passes (29 — unchanged).
- [ ] `npx vitest run test/nudges.test.ts` passing count did NOT drop (still 10 passing; the 10 failing are
      the expected T2.S2 threshold-fixture tests).

### Feature Validation

- [ ] `bloatThresholdFor` is **exported** (grep: `grep -n "export function bloatThresholdFor" src/nudges.ts`).
- [ ] `bloatThresholdFor` is pure (no `getConfig`/`getRuntime`/`log`/I/O inside — only two reads).
- [ ] Level 4 spot-check prints 32768 / 20480 / 16384 / 16384 / 16384.
- [ ] In `bloatReminderHandler`, `const threshold = bloatThresholdFor(event.toolName, config);` is the ONLY
      changed line; `renderBloatReminder`, `if (bytes < threshold) return;`, and `pendingBloatHits.push` are
      byte-identical to before.

### Code Quality

- [ ] Helper placed after imports and before `bloatReminderHandler` (handler-adjacent recommended).
- [ ] No new import added (`MulliganConfig` already imported at line 26).
- [ ] No try/catch added around the pure helper.
- [ ] No edits to `src/config.ts`, any `test/*`, `README.md`, or any other file.
- [ ] Stale "8192" comments in nudges.ts left untouched (out of scope).

### Documentation & Deployment

- [ ] State: **"none — Mode A"**. No user-facing/config/API surface change beyond the exported internal
      helper. (README sync is Mode B in P2.M1.T2.S4.)

## Anti-Patterns to Avoid

- ❌ Don't "improve" the verbatim helper — no `if (toolName in byTool)`, no cast, no `||` instead of `??`, no
  explicit `undefined` check. The body is spec/07 §1 verbatim and compiles; `?? global` is correct at runtime
  even though `byTool[toolName]` is statically `number` (no `noUncheckedIndexedAccess`).
- ❌ Don't change anything in `bloatReminderHandler` except the one `const threshold = ...` line. The
  `renderBloatReminder` call, the `bytes < threshold` comparison, and the `pendingBloatHits` push are already
  parameterized — leave them.
- ❌ Don't add tests in T2.S1 — the bloatThresholdFor unit test, fixture resizes, and per-tool scenarios are
  T2.S2. Adding them here blurs the subtask boundary and risks merge conflicts.
- ❌ Don't "fix" the stale "8192" JSDoc/comments in nudges.ts — they are pre-existing drift (S1 was scoped to
  config.ts), Mode A none applies, and the item says "ONLY this change to the handler."
- ❌ Don't add a try/catch around the pure helper — it cannot throw on valid inputs and already sits inside
  the handler's outer try/catch.
- ❌ Don't remove the `?? {}` defensive fallback — the interface field is optional (`?:`), so the helper must
  tolerate a hand-built `MulliganConfig` without it (e.g. a future test object), even though validateConfig
  always supplies it.
- ❌ Don't touch `src/config.ts` (S1/S2 landed) or resize any test fixture (T2.S2/T2.S3).

## Confidence Score

**9/10** for one-pass implementation success. The change is tiny (one exported pure function + one changed
line), the helper body is given verbatim and **verified to compile** against the project's tsconfig (the one
plausible trap — `?? global` on a statically-`number` indexed access — was tested and confirmed clean), the
single call site is pinned to an exact line number with an exact before/after, and no new import is needed.
The 1-point reserve covers the implementer second-guessing the `?? global` and "fixing" it into a non-
compiling or behaviorally-wrong form before reading CRITICAL GOTCHA #1 — but the gotcha states the exact
symptom (none — it compiles) and the exact instruction (copy verbatim), so recovery is one paste.