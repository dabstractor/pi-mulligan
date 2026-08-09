# PRP — P1.M1.T1.S1: Regression test + `hasOwnProperty` guard for `bloatThresholdFor` proto-key leak (BUG-001 fix)

---

## Goal

**Feature Goal**: Close a latent prototype-key lookup bug in the pure helper `bloatThresholdFor(toolName, config)` (src/nudges.ts:86-91). For a tool whose name collides with an inherited `Object.prototype` member (`"constructor"`, `"toString"`, `"valueOf"`, `"hasOwnProperty"`, `"isPrototypeOf"`, `"toLocaleString"`), the lookup `byTool[toolName] ?? global` returns the inherited *function* (not `undefined`), so `?? global` does NOT fall back to the global number. This makes the bloat reminder fire on EVERY result from such a tool (`number < function` is always `false`) and renders `(threshold NaN KB)`. The fix adds an `Object.prototype.hasOwnProperty.call(...)` own-property guard. Write the **failing regression test FIRST**, then apply the one-line fix.

**Deliverable**:
1. A new failing `it(...)` test in `test/nudges.test.ts` (inside the existing `bloatThresholdFor — per-tool resolution` describe block) asserting `bloatThresholdFor('constructor'|'toString'|'valueOf'|'hasOwnProperty', config)` returns the global `16384`.
2. A one-line behavior fix + JSDoc update in `src/nudges.ts` replacing `return byTool[toolName] ?? global;` with the `hasOwnProperty`-guarded ternary.
3. The transitive fix in `src/tools/audit.ts` is FREE (it calls `bloatThresholdFor` at line 528) — NO code change there.

**Success Definition**:
- The new regression test FAILS before the fix (returns a `function`, not `16384`) and PASSES after.
- `npx vitest run test/nudges.test.ts` — all pass.
- `npx vitest run test/tools/audit.test.ts` — all pass (no transitive regression).
- `npx vitest run` — full suite passes (742-test baseline).
- `npx tsc --noEmit` — zero type errors.

## User Persona (if applicable)

**Target User**: Developers of pi-mulligan and anyone who registers a custom Pi tool via `registerTool` with an unusual name; indirectly the coding agent that consumes bloat reminders / audit output.

**Use Case**: A user registers a custom tool named `constructor` (or any `Object.prototype` key). The bloat reminder and audit must treat it like any other unknown tool — fall back to the global 16384-byte threshold — not silently fire on every result and render `NaN`.

**User Journey**: User registers custom tool → tool returns a result → `bloatReminderHandler` resolves threshold via `bloatThresholdFor` → with the fix, returns the global number → the reminder fires only when bytes actually exceed 16384, and renders `(16 KB)` (not `NaN`).

**Pain Points Addressed**: Eliminates the malformed `(threshold NaN KB)` reminder text and the always-fires reminder behavior for prototype-colliding tool names. Restores PRD §3 design principle #6 ("Honest bookkeeping") and the spirit of #4 ("Fail open" — fall back to the global rather than emit garbage).

## Why

- **Business value / user impact**: Low real-world frequency (no built-in Pi tool — read/bash/grep/lsp_* — collides with `Object.prototype`), but a user-registered custom tool CAN be named `constructor`, and the defect is a genuine latent lookup bug producing garbage output (`NaN`) and defeating the advisory-nudge intent. Fixing it makes the helper robust by construction.
- **Integration with existing features**: `bloatThresholdFor` is the SHARED pure helper consumed by both `bloatReminderHandler` (src/nudges.ts:124) and `mulligan_audit` (src/tools/audit.ts:528). Fixing it once fixes both consumers transitively — no per-consumer change needed.
- **Problems this solves and for whom**: BUG-001 (Minor). For the developer/extender: predictable own-property map semantics. For the agent: no malformed `(threshold NaN KB)` in audit/reminder output.

## What

User-visible behavior: none for built-in tools. For a tool whose name is an `Object.prototype` member, the bloat reminder now correctly gates on the global 16384-byte threshold (instead of firing every time) and renders `(16 KB)` (instead of `(threshold NaN KB)`). The audit's per-row bloat flag for such a tool behaves identically.

### Success Criteria

- [ ] A new `it(...)` regression test exists in `test/nudges.test.ts`'s `bloatThresholdFor — per-tool resolution` describe block, asserting `'constructor'`, `'toString'`, `'valueOf'`, and `'hasOwnProperty'` each resolve to the global `config.nudges.bloatThresholdBytes` (16384).
- [ ] `src/nudges.ts` line 90 uses `Object.prototype.hasOwnProperty.call(byTool, toolName) ? byTool[toolName] : global;` (the bare `?? global` is gone).
- [ ] The `bloatThresholdFor` JSDoc documents the `hasOwnProperty` guard and WHY (prototype-key collision protection).
- [ ] The function signature, the `if (!toolName) return global;` early return, and the `?? {}` fallback are UNCHANGED.
- [ ] NO code change in `src/tools/audit.ts` (it is fixed transitively).
- [ ] `npx vitest run test/nudges.test.ts`, `npx vitest run test/tools/audit.test.ts`, `npx vitest run`, and `npx tsc --noEmit` all pass.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact current code, the exact buggy line number, the exact target line, the exact test insertion point, the existing test idiom to copy, and the precise JSDoc paragraph to rewrite. No external documentation is required.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/nudges.ts
  why: THE file being modified. bloatThresholdFor is at lines 86-91; the buggy return is line 90.
  pattern: "export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number — PURE, two reads + fallback, no I/O. The JSDoc at lines 76-84 already explains the `?? {}` defensive fallback and (incorrectly, pre-fix) claims `byTool[toolName] ?? global` is 'correct at runtime' — that claim must be revised."
  gotcha: "The function is consumed by bloatReminderHandler at line 124 (`const threshold = bloatThresholdFor(event.toolName, config);` then `if (bytes < threshold) return;`). With the bug, `number < function` is always false → reminder fires every time. The fix makes it return the global number. Do NOT touch the handler — fixing the helper fixes it transitively."

- file: test/nudges.test.ts
  why: THE test file to extend. The describe block 'bloatThresholdFor — per-tool resolution (spec/07 §1; DEFAULT_CONFIG)' starts ~line 133 and closes ~line 171. The new test goes AFTER the last existing test ('respects an explicit custom override for a tool') and BEFORE the describe block's closing `});`."
  pattern: "Existing tests do `const config = getConfig();` (returns DEFAULT_CONFIG after setConfig({}) in beforeEach) then `expect(bloatThresholdFor('bash', config)).toBe(32768);`. The imports already include `bloatThresholdFor` from '../src/nudges.js' and `getConfig` from '../src/config.js' (lines 8-10) — NO new imports needed."
  gotcha: "The file's beforeEach does `setConfig({})` which re-validates from DEFAULT_CONFIG, so getConfig() yields bloatThresholdBytes=16384 and bloatThresholdBytesByTool={bash:32768, read:20480}. 'constructor' is NOT an own key of that map, but IS inherited from Object.prototype → the bug reproduces with getConfig() directly. Comments in existing tests explain WHY (mirror that explanatory style)."

- file: src/tools/audit.ts
  why: "TRANSITIVE consumer — line 52 imports bloatThresholdFor, line 528 calls it per-row. NO code change needed here. Listed only so the implementer understands the blast radius and why test/tools/audit.test.ts is a validation gate."
  pattern: "audit.ts already correctly delegates threshold resolution to bloatThresholdFor (the P1.M1.T1 per-tool wiring). The proto-key leak is the helper's defect, not the consumer's."
  gotcha: "Do NOT modify audit.ts. Running test/tools/audit.test.ts is the regression guard proving the transitive fix is clean."

- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/architecture/system_context.md
  why: "Confirms the root cause, the exact fix line, the downstream impact chain, and that config.ts's coerceBloatThresholdByTool is NOT affected (it uses safe spread + Object.entries — the bug is isolated to the lookup function)."
  critical: "The fix is ONE line + ONE JSDoc paragraph + ONE test. Resist scope creep. Spec-doc fixes (BUG-002/BUG-003) are P1.M2 — NOT this subtask."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  nudges.ts        # ← MAIN FIX TARGET (bloatThresholdFor line 86-91, return at line 90; JSDoc lines 76-84)
  config.ts        # ← DEFAULT_CONFIG (16384 global, {bash:32768, read:20480}); read-only reference
  notes.ts         # ← renderBloatReminder (consumes threshold → Math.round); read-only, NOT modified
  tools/
    audit.ts       # ← transitive consumer (line 528); NOT modified
test/
  nudges.test.ts   # ← ADD the regression test (describe block ~lines 133-171)
  tools/
    audit.test.ts  # ← regression guard only; NOT modified
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/nudges.ts        # 1 line (return) + JSDoc paragraph rewrite
test/nudges.test.ts  # 1 new it(...) test inside the existing bloatThresholdFor describe block
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1: `??` only catches null/undefined, NOT inherited functions.
//   byTool['constructor'] on a plain Record<string, number> returns Object (a function).
//   Object ?? global → Object (the function is non-null). So the fallback never triggers.
//   The FIX uses Object.prototype.hasOwnProperty.call(byTool, toolName) to distinguish OWN keys
//   from inherited prototype members.

// CRITICAL GOTCHA #2: why Object.prototype.hasOwnProperty.call and not byTool.hasOwnProperty(...).
//   A hand-built MulliganConfig's byTool map could (in adversarial theory) have its own 'hasOwnProperty'
//   key shadowing the method. Using Object.prototype.hasOwnProperty.call(byTool, ...) is the canonical
//   safe form — it calls the method directly from the prototype, immune to per-instance shadowing.
//   This matches the project's existing defensive style (readOwn/readStr in audit.ts use try/catch).

// CRITICAL GOTCHA #3: the bug reproduces with getConfig() (DEFAULT_CONFIG), NOT just empty maps.
//   DEFAULT_CONFIG.bloatThresholdBytesByTool = {bash:32768, read:20480}. 'constructor' is NOT an own
//   key, but Object.prototype.constructor IS inherited → byTool['constructor'] returns Object.
//   So the regression test uses getConfig() directly (no hand-built literal needed).

// CRITICAL GOTCHA #4: this is a TEST-FIRST task (TDD). Write the failing test FIRST, run it, CONFIRM
//   it fails (returns a function, so .toBe(16384) fails), THEN apply the one-line fix and confirm it
//   passes. Do not write the fix before seeing the test fail — that defeats the regression lock-in.

// CRITICAL GOTCHA #5: config.ts's coerceBloatThresholdByTool is NOT affected — it already uses safe
//   spread ({...(fallback ?? {})}) and Object.entries() iteration. The bug is ISOLATED to the lookup
//   function. Do not touch config.ts.

// CRITICAL GOTCHA #6 (test isolation): test/nudges.test.ts beforeEach does setConfig({}) + clearAll().
//   Do NOT add per-test config setup that contradicts this. The new test relies on getConfig() returning
//   DEFAULT_CONFIG, which the existing beforeEach guarantees.
```

## Implementation Blueprint

### Data models and structure

**No data-model changes.** The function signature is unchanged:

```typescript
export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number;
```

The return type is already `number`; after the fix the runtime value is always a `number` (it currently leaks `Function` for prototype keys, which is an uncaught runtime defect — TypeScript's `noUncheckedIndexedAccess` is OFF so `byTool[toolName]` is statically typed `number` even though the runtime value can be a function).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the failing regression test to test/nudges.test.ts (TEST FIRST — do this before the fix)
  - LOCATE the describe block: describe("bloatThresholdFor — per-tool resolution (spec/07 §1; DEFAULT_CONFIG)", () => { ... })
    (~line 133). Its LAST existing test is "respects an explicit custom override for a tool"; the block closes
    with `});` ~line 171.
  - INSERT a new it(...) test AFTER the last existing test's closing `});` and BEFORE the describe block's closing `});`:
      it("does not leak inherited Object.prototype members for tools named 'constructor'/'toString'/etc. (BUG-001)", () => {
        // A tool whose name collides with an inherited Object.prototype member (constructor/toString/...)
        // must fall back to the global — NOT return the inherited function. Pre-fix, byTool[toolName]
        // returns the inherited function and `?? global` does not trigger, so the helper leaks a non-number.
        const config = getConfig(); // DEFAULT_CONFIG: global 16384, byTool {bash:32768, read:20480}
        const global = config.nudges.bloatThresholdBytes; // 16384
        for (const protoKey of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "toLocaleString"]) {
          const t = bloatThresholdFor(protoKey, config);
          expect(t).toBe(global); // returns the global number, NOT the inherited Object.prototype function
          expect(typeof t).toBe("number"); // belt-and-suspenders: never a function
          expect(Number.isFinite(t)).toBe(true); // never NaN downstream
        }
      });
  - NAMING: the test title names BUG-001 + the prototype-member class (mirrors existing explanatory titles).
  - NO new imports — bloatThresholdFor (line 8) and getConfig (line 9) are already imported.
  - VERIFY IT FAILS: `npx vitest run test/nudges.test.ts` → the new test FAILS (received a function, expected 16384).
    This is the TDD red step; CONFIRM the failure before proceeding to Task 2.
  - DEPENDENCIES: none (test is self-contained against the existing beforeEach setConfig({})/getConfig()).

Task 2: APPLY the one-line fix in src/nudges.ts (line 90)
  - EDIT line 90. CURRENT:
      return byTool[toolName] ?? global;
    TARGET:
      return Object.prototype.hasOwnProperty.call(byTool, toolName) ? byTool[toolName] : global;
  - PRESERVE unchanged: the function signature, `const global = config.nudges.bloatThresholdBytes;`,
    `if (!toolName) return global;`, and `const byTool = config.nudges.bloatThresholdBytesByTool ?? {};`.
  - NAMING/FORM: use `Object.prototype.hasOwnProperty.call(byTool, toolName)` (the canonical safe form —
    see GOTCHA #2). Do NOT use `byTool.hasOwnProperty(toolName)` (vulnerable to per-instance shadowing).
  - VERIFY: `npx vitest run test/nudges.test.ts` → the new test now PASSES (green step).
  - DEPENDENCIES: Task 1 (the failing test must exist to prove the fix).

Task 3: UPDATE the bloatThresholdFor JSDoc in src/nudges.ts (the paragraph at lines ~81-84)
  - LOCATE the JSDoc paragraph that currently reads:
        * `?? {}` is a defensive fallback for a hand-built MulliganConfig: the interface field is optional
        * (`?:`), but validateConfig guarantees it is always a valid Record<string, number> after validation
        * (S2). `byTool[toolName] ?? global` is correct at runtime (a missing key yields undefined → global)
        * even though noUncheckedIndexedAccess is off and byTool[toolName] is statically typed `number`.
  - REPLACE the last two lines' claim about `?? global` with an explanation of the hasOwnProperty guard:
        * `?? {}` is a defensive fallback for a hand-built MulliganConfig: the interface field is optional
        * (`?:`), but validateConfig guarantees it is always a valid Record<string, number> after validation
        * (S2). The lookup is OWN-PROPERTY-guarded: `Object.prototype.hasOwnProperty.call(byTool, toolName)`
        * is used (NOT bare `byTool[toolName] ?? global`), because a bare index read returns INHERITED
        * Object.prototype members (constructor/toString/valueOf/...) as non-null values that `??` would
        * pass through instead of falling back to the global. The own-property guard means a tool whose
        * name collides with a prototype member correctly resolves to the global threshold (BUG-001 fix).
        * `Object.prototype.hasOwnProperty.call` is used rather than `byTool.hasOwnProperty(...)` so an
        * adversarial own key named "hasOwnProperty" cannot shadow the method.
  - NAMING: keep the JSDoc paragraph in the same block-comment location (do not move it).
  - DEPENDENCIES: Task 2 (the doc must describe the actual shipped behavior).

Task 4: VERIFY no transitive regression in the audit (no code change — validation only)
  - RUN `npx vitest run test/tools/audit.test.ts` → all pass. The audit calls bloatThresholdFor at
    src/tools/audit.ts:528; the helper fix propagates automatically. If any audit test fails, the cause
    is OUTSIDE this subtask's scope — STOP and report (do not modify audit.ts or audit.test.ts).
  - DEPENDENCIES: Task 2.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): regression test mirrors the existing getConfig()-based idiom in the same describe block.
const config = getConfig();              // DEFAULT_CONFIG via beforeEach's setConfig({})
const global = config.nudges.bloatThresholdBytes; // 16384
for (const protoKey of ["constructor", "toString", "valueOf", "hasOwnProperty", ...]) {
  const t = bloatThresholdFor(protoKey, config);
  expect(t).toBe(global);     // PRE-FIX: fails — t is the inherited Object constructor function
  expect(typeof t).toBe("number");
}

// PATTERN (Task 2): own-property-guarded lookup — the canonical safe form.
// BEFORE (bug, line 90):  return byTool[toolName] ?? global;
// AFTER  (fix, line 90):  return Object.prototype.hasOwnProperty.call(byTool, toolName) ? byTool[toolName] : global;
//
// GOTCHA: `??` cannot see this. Run it in your head:
//   const byTool = { bash: 32768, read: 20480 };
//   byTool["constructor"]      // → Object (function) — INHERITED, not undefined
//   byTool["constructor"] ?? 0 // → Object (function is non-null) — fallback SKIPPED  ← the bug
//   Object.prototype.hasOwnProperty.call(byTool, "constructor") // → false → use global ← the fix

// CRITICAL: do NOT 'simplify' to `byTool[toolName]` after the guard — that's the whole point.
// The ternary reads byTool[toolName] ONLY when hasOwnProperty is true (a genuine own key), at which
// point the value is a real number from validateConfig/coerceBloatThresholdByTool.
```

### Integration Points

```yaml
CODE:
  - modify: src/nudges.ts line 90 (the return) + JSDoc paragraph lines ~81-84
  - transitive (no change): src/tools/audit.ts:528 calls bloatThresholdFor; src/nudges.ts:124 bloatReminderHandler calls it

TESTS:
  - add: test/nudges.test.ts — one it(...) in the existing 'bloatThresholdFor — per-tool resolution' describe block
  - guard (no change): test/tools/audit.test.ts — run to confirm no transitive regression

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. config.ts is READ-ONLY (coerceBloatThresholdByTool is already safe). No registration changes.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After the fix in src/nudges.ts:
npx tsc --noEmit
# Expected: ZERO errors. The ternary's types are unchanged (byTool[toolName] is still statically `number`
# because noUncheckedIndexedAccess is off); Object.prototype.hasOwnProperty.call is a built-in typed signature.
# If you see a type error, you likely altered the function signature or an import — revert and re-apply only line 90.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The nudges test file — FAST feedback on the helper fix.
npx vitest run test/nudges.test.ts
# Expected: ALL pass, including the new prototype-key regression test.
# TDD NOTE: run this BEFORE the fix too — the new test MUST fail (received function, expected 16384).
# That red→green transition is the proof the test actually guards the behavior.

# The audit test file — transitive regression guard.
npx vitest run test/tools/audit.test.ts
# Expected: ALL pass (unchanged — audit.test.ts is not modified; it just exercises the now-fixed helper).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full suite — confirm nothing else regressed.
npx vitest run
# Expected: all pass (742-test baseline + the 1 new test → 743).
# Note: BUG-002/BUG-003 spec-doc fixes are P1.M2 — they are NOT touched here and remain as-is.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual reproduction of the bug scenario (optional — proves the before/after at the REPL):
#   BEFORE the fix: npx tsx -e "import {getConfig} from './src/config.js'; import {bloatThresholdFor} from './src/nudges.js'; console.log(typeof bloatThresholdFor('constructor',getConfig()));"
#     → prints 'function' (the bug)
#   AFTER the fix: same command → prints 'number', and bloatThresholdFor('constructor',getConfig()) === 16384.
# This is exactly what the new regression test asserts programmatically, so Level 2 covers it.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` — zero type errors.
- [ ] `npx vitest run test/nudges.test.ts` — all pass (new test green after fix; was red before fix).
- [ ] `npx vitest run test/tools/audit.test.ts` — all pass (no transitive regression).
- [ ] `npx vitest run` — full suite passes (~743 tests).

### Feature Validation

- [ ] New regression test asserts `bloatThresholdFor('constructor'|'toString'|'valueOf'|'hasOwnProperty'|'isPrototypeOf'|'toLocaleString', getConfig())` === 16384 (the global).
- [ ] The test FAILED before the fix and PASSES after (TDD red→green confirmed).
- [ ] `src/nudges.ts` line 90 uses `Object.prototype.hasOwnProperty.call(byTool, toolName) ? byTool[toolName] : global;`.
- [ ] Function signature, `if (!toolName) return global;`, and `?? {}` fallback are UNCHANGED.
- [ ] The JSDoc explains the own-property guard and why `Object.prototype.hasOwnProperty.call` is used over `byTool.hasOwnProperty(...)`.
- [ ] NO code change in `src/tools/audit.ts` (transitive fix only).
- [ ] `bloatReminderHandler` downstream behavior for a 'constructor'-named tool: reminder fires only when bytes > 16384 (not every time); renders `(16 KB)` (not `NaN`).

### Code Quality Validation

- [ ] Follows existing test idiom (`getConfig()` + `expect(...).toBe(...)` + explanatory comments) — see the sibling tests in the same describe block.
- [ ] Follows the project's defensive-map style (mirrors `readOwn`/`readStr` caution in audit.ts).
- [ ] Only `src/nudges.ts` (1 line + JSDoc) and `test/nudges.test.ts` (1 test) modified — NO changes to config.ts, notes.ts, audit.ts, audit.test.ts, or any spec/README files (those are P1.M2 / sibling subtasks).

### Documentation & Deployment

- [ ] `bloatThresholdFor` JSDoc documents the hasOwnProperty guard and prototype-key collision protection (Mode A — rides with the code change).
- [ ] No spec docs or README changes in this subtask — spec/04, spec/10, spec/01 are P1.M2 (BUG-002/BUG-003).

---

## Anti-Patterns to Avoid

- ❌ Don't write the fix before seeing the test fail — this is a TEST-FIRST (TDD) task. The red step is what locks in the regression; skipping it means the test might pass for the wrong reason (e.g. a coincidental config value).
- ❌ Don't use `byTool.hasOwnProperty(toolName)` instead of `Object.prototype.hasOwnProperty.call(byTool, toolName)` — the bare form is shadowable by an own key named `"hasOwnProperty"` (the project's existing defensive helpers avoid this trap; match that style).
- ❌ Don't replace `?? global` with `|| global` to "fix" it — `||` is semantically wrong here too (a legitimate threshold of `0` would trigger the fallback), AND inherited functions are truthy so `||` would ALSO pass them through. The own-property guard is the only correct fix.
- ❌ Don't touch `config.ts`, `notes.ts`, `audit.ts`, `audit.test.ts`, or any spec/README file — `coerceBloatThresholdByTool` is already safe (spread + Object.entries), and the audit/reminder are transitively fixed by the helper. Spec-doc staleness is P1.M2.
- ❌ Don't "simplify" by removing the `?? {}` fallback or the `if (!toolName) return global;` early return — both are correct and in scope-preserve. Only the return on line 90 changes.
- ❌ Don't broaden the test to hand-built empty maps — the bug reproduces with `getConfig()` (DEFAULT_CONFIG), and the contract specifies `getConfig()`. Keep it crisp and aligned with the sibling tests' idiom.