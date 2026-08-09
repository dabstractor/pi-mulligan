---
name: "P2.M1.T1.S2 — Add bloatThresholdBytesByTool coercion to validateConfig + validation test coverage"
---

## Goal

**Feature Goal**: Add a `coerceBloatThresholdByTool` module-local helper to `src/config.ts` (modeled on
the existing `coerceProtectedRoles` collection-coercer), wire it into `validateConfig` inside the
`if (isRecord(nudgesRaw))` block, and add focused validation tests in `test/config.test.ts` covering
the **merge** semantics, per-entry **drop-with-warn** semantics, and whole-map **discard** semantics for
the `nudges.bloatThresholdBytesByTool` field introduced by S1. After this subtask, any malformed
user-supplied per-tool map degrades safely (warned, never throws) and the validated config's
`nudges.bloatThresholdBytesByTool` is **always** a valid `Record<string, number>` preserving all default
entries for unmentioned tools.

**Deliverable**: A modified `src/config.ts` (one new helper function + ~2 wiring lines in `validateConfig`)
and a modified `test/config.test.ts` (4–6 new `it(...)` cases inside the existing `describe("validateConfig")`
block). No new files. No interface/`DEFAULT_CONFIG`/JSDoc changes (those landed in S1).

**Success Definition**:
- `npx tsc --noEmit` passes (this is the make-or-break gate — see CRITICAL GOTCHA #1).
- `npx vitest run test/config.test.ts` passes with zero failures.
- `validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: 99999 } } }).nudges.bloatThresholdBytesByTool`
  deep-equals `{ bash: 99999, read: 20480 }` (**merge**: `read` preserved from default).
- `validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: -1, read: 20480 } } })` →
  `{ bash: 32768, read: 20480 }` with exactly **one** warn naming `bloatThresholdBytesByTool entry`.
- `validateConfig({ nudges: { bloatThresholdBytesByTool: "oops" } })` → `{ bash: 32768, read: 20480 }`
  with exactly **one** warn naming `nudges.bloatThresholdBytesByTool`.
- A partial valid override that **omits** the field never warns (absent ≠ invalid).

## User Persona (if applicable)

**Target User**: The coding agent itself (S2 is internal config-validation plumbing; there is no human or
end-user surface change in this subtask). The downstream consumer is P2.M1.T2.S1's `bloatThresholdFor`
helper, which reads `config.nudges.bloatThresholdBytesByTool`.

**Use Case**: A user (or project-local `settings.json`) supplies `"mulligan": { "nudges": {
"bloatThresholdBytesByTool": { "bash": 99999 } } }`. `validateConfig` must coerce it safely — keeping the
`read` default, accepting `bash: 99999`, and never throwing on garbage like a string or `null`.

**Pain Points Addressed**: Today (after S1) a user-supplied map is silently ignored (unknown key, no
coercion yet). S2 makes user overrides actually take effect, with graceful degradation on malformed input.

## Why

- **Business value**: This is the **validation half** of the per-tool bloat-threshold feature (spec §6,
  "Bloated-result reminder"). It makes the per-tool map that S1 declared **actually configurable** by
  users, with the same fail-safe, warn-on-invalid, never-throw discipline as every other config field
  (spec/09 §4; design principle "Fail open").
- **Position in plan**: Second subtask of milestone P2.M1. **Upstream dependency: P2.M1.T1.S1** (which
  added the `?:` interface field + `DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool = { bash: 32768,
  read: 20480 }` + the JSDoc + raised the global default to `16384`). S2 **consumes** S1's output and
  must not duplicate it (see Scope Boundaries). **Downstream consumer: P2.M1.T2.S1** — `bloatThresholdFor`
  reads `config.nudges.bloatThresholdBytesByTool`; it relies on S2's guarantee that the field is always a
  valid `Record<string, number>` after validation.
- **Scope discipline**: S2 does **NOT** implement `bloatThresholdFor` or touch `src/nudges.ts` (T2.S1),
  does **NOT** resize nudges/audit/smoke fixtures (T2.S2/T2.S3), and does **NOT** change the interface,
  `DEFAULT_CONFIG`, JSDoc, or the existing `8192`→`16384` test literals (all owned by S1).

## What

User-visible behavior is still unchanged by S2 alone (the per-tool *resolution* that consumes the validated
map is T2.S1). S2 only makes `validateConfig` **honor and sanitize** a user-supplied per-tool map. All
degradation is warned and logged via the existing `warnConfig`; `validateConfig` continues to **never
throw** (the existing outer `try/catch → structuredClone(DEFAULT_CONFIG)` already covers it).

### Success Criteria

- [ ] `src/config.ts` has a new module-local `coerceBloatThresholdByTool(value, fallback?)` helper placed
      immediately after `coerceProtectedRoles`, following its collection-coercer pattern but over an object
      map with **merge** semantics (`{ ...fallback }` start base).
- [ ] `validateConfig` reads `bloatThresholdBytesByTool` via `safeGet(nudgesRaw, ...)` inside the existing
      `if (isRecord(nudgesRaw))` block, **after** `driftThresholdTokens`, guarded by `if (v !== undefined)`.
- [ ] Non-record value (null / primitive / array) → `warnConfig("nudges.bloatThresholdBytesByTool", value)`
      once, return `fallback` (the cloned default map).
- [ ] Record with a non-finite / non-number / `<= 0` entry → that entry dropped with a per-entry
      `warnConfig("nudges.bloatThresholdBytesByTool entry", { [toolName]: threshold })`; valid entries kept;
      default entries for unmentioned tools preserved.
- [ ] Unknown tool names are **kept** (forward-compat per spec/09 §4).
- [ ] Absent field → no warn, default map retained (handled by the `if (v !== undefined)` guard).
- [ ] `test/config.test.ts` gains explicit test cases for: default map; partial-override merge;
      invalid-entry drop + warn; non-record discard + warn; (recommended) array-as-value discard; unknown
      tool kept; full valid override.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npx vitest run test/config.test.ts` passes.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement S2 from: the verbatim before/after blocks
in "Implementation Tasks" (verified by direct file read of `src/config.ts` and `test/config.test.ts`), the
S1 contract (the field already exists with the stated defaults), CRITICAL GOTCHA #1 (the optional field
breaks a literal required-`fallback` signature under `tsc`), and the explicit scope boundary that S1
already owns the literal test edits and the interface/default/JSDoc.

### Documentation & References

```yaml
- docfile: plan/002_df93178e6631/architecture/config_validation_design.md
  why: Authoritative coercion pattern + merge semantics. Gives the helper body and the exact wiring lines.
       ITS SIGNATURE SKETCH (required fallback) WILL NOT TYPE-CHECK — see CRITICAL GOTCHA #1 for the fix.
  section: "New coerce function" + "Merge Semantics Note" + "Field placement in validateConfig"

- file: plan/002_df93178e6631/P2M1T1S1/PRP.md
  why: The CONTRACT for what already exists when S2 begins. S1 added the `?:` interface field,
       DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool = { bash: 32768, read: 20480 }, raised the global
       default to 16384, updated JSDoc, and changed the 7 `8192`→`16384` test literals. S2 consumes all of it.
  pattern: "S1 does NOT add validateConfig coercion — that is S2."  ← this IS S2.

- file: src/config.ts
  why: The ONLY source file S2 modifies. Contains validateConfig (read it before editing) and every helper
       S2 reuses: isRecord, safeGet, warnConfig, plus the coerceProtectedRoles pattern to mirror.
  pattern: "validateConfig deep-clones DEFAULT_CONFIG → each known field read via safeGet → if (v !== undefined)
            run a coercer that warns-on-invalid and falls back." Collection coercer = coerceProtectedRoles.
  gotcha: The nudges field is OPTIONAL (`?:`) on the interface, so cfg.nudges.bloatThresholdBytesByTool is
          typed `Record<string,number> | undefined`. A required `fallback` param fails tsc (GOTCHA #1).

- file: test/config.test.ts
  why: The ONLY test file S2 modifies. The "does NOT warn for ABSENT fields" test is the exact template for
       warn-verification (vi.spyOn(console,"warn") + toHaveBeenCalledTimes + mockRestore in try/finally).
  pattern: "describe('validateConfig') block holds all coercion tests; one it() per behavior; warn checks
            wrap the call and restore in finally."
  gotcha: S1 already changed the 8192→16384 literals here (Tasks 4 & 6 of S1). Do NOT re-edit them.

- docfile: spec/09-configuration.md
  why: §4 is the validation-rules authority. Confirms: non-object → discard; per-entry drop with warn;
        unknown tool names permitted; never throw.
  section: "§4 Validation rules" (the bloatThresholdBytesByTool bullet, line ~77)
```

### Current Codebase tree (relevant slice, after S1 is merged)

```bash
src/config.ts            # S2 MODIFIES: + coerceBloatThresholdByTool helper, +2 wiring lines in validateConfig
test/config.test.ts      # S2 MODIFIES: +4..6 it() cases in describe("validateConfig")
src/nudges.ts            # NOT touched (bloatThresholdFor is T2.S1)
test/nudges.test.ts      # NOT touched in S2 (T2.S2 — EXPECTED RED until then)
test/tools/audit.test.ts # NOT touched in S2 (T2.S2 — EXPECTED RED until then)
test/integration/smoke.ts# NOT touched in S2 (T2.S3 — EXPECTED RED until then)
```

### Desired Codebase tree

No files added or removed — S2 is a pure edit of `src/config.ts` and `test/config.test.ts`.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 (tsc): The nudges field is OPTIONAL on the interface (S1: `bloatThresholdBytesByTool?: ...`).
//   So at the wiring site `cfg.nudges.bloatThresholdBytesByTool` is typed `Record<string, number> | undefined`.
//   The item-description/architecture sketch uses a REQUIRED `fallback: Record<string, number>` param —
//   calling it as `coerceBloatThresholdByTool(v, cfg.nudges.bloatThresholdBytesByTool)` FAILS `tsc --noEmit`:
//     "Argument of type 'Record<string,number> | undefined' is not assignable to 'Record<string, number>'."
//   FIX: make `fallback` OPTIONAL with default `{}` and use `fallback ?? {}` at both return sites inside
//   the function. At runtime fallback is ALWAYS the cloned default map, so merge semantics are preserved.
//   This is the single most important detail to get right — a literal copy of the sketch red-flags tsc.

// CRITICAL #2 (merge, not replace): The helper MUST start from `{ ...fallback }` (NOT `{}`). Because
//   validateConfig clones DEFAULT_CONFIG first, fallback IS the default map { bash: 32768, read: 20480 },
//   so spreading it preserves `read` when the user only overrides `bash`. Starting from `{}` would drop
//   defaults — the "partial override merges" test would fail.

// CRITICAL #3 (scope — do NOT duplicate S1): S1 already changed the 7 `8192`→`16384` literals in
//   test/config.test.ts and added bloatThresholdBytesByTool to the two `toEqual` expected objects. S2 must
//   NOT re-edit those. A `grep -n "8192" test/config.test.ts` after S1 should show ONLY the `"8192"` string-
//   input line (the no-string-coercion test). Leave it.

// GOTCHA #4 (spec §4 wording vs item description): spec/09 §4 says "Non-object → discard entirely (use
//   global only)." The item description is more specific: on non-record, return the DEFAULT MAP (fallback),
//   one warn. Follow the item description + architecture design doc — return fallback (the cloned default
//   map). Downstream bloatThresholdFor (T2.S1) resolves per-tool→global, so carrying the default map is
//   exactly correct.

// GOTCHA #5 (never throws): Do NOT add a try/catch inside the helper. validateConfig's outer try/catch
//   already swallows any throw into `structuredClone(DEFAULT_CONFIG)`. Mirroring coerceProtectedRoles (no
//   internal try/catch) is correct.

// GOTCHA #6 (Object.entries is safe here): Object.entries on a non-record is never reached (isRecord guard
//   precedes it). On a throwing-Proxy record the outer try/catch covers it. No extra defensiveness needed.
```

## Implementation Blueprint

### Data models and structure

No new data models. The helper operates on the existing `Record<string, number>` map shape. The interface
and `DEFAULT_CONFIG` are untouched (S1 owns them).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config.ts — ADD the coerceBloatThresholdByTool helper
  - PLACE: immediately AFTER coerceProtectedRoles (the collection-coercer sibling), in the
    "private helpers (module-local)" section. NOT exported.
  - SIGNATURE: use an OPTIONAL fallback (default {}) — see CRITICAL GOTCHA #1. A required param fails tsc.
  - LOGIC: mirror coerceProtectedRoles' shape: type-guard → fallback+warn OR iterate-entries → per-entry
    keep-or-drop-with-warn. Difference: start the result from `{ ...fallback }` (MERGE), and the per-entry
    predicate is `typeof === "number" && Number.isFinite && > 0`.
  - EXACT new code to insert:

      /** bloatThresholdBytesByTool: per-tool override map (spec/09 §4). Non-record → fallback + warn.
       *  Record entries: keep finite numbers > 0, drop invalid (per-entry warn). MERGES over fallback so
       *  default entries are preserved for tools the user did not mention. Unknown tool names are kept
       *  (forward-compat). `fallback` is optional only to satisfy the optional interface field's
       *  `| undefined` type at the call site — at runtime it is always the cloned default map. */
      function coerceBloatThresholdByTool(
        value: unknown,
        fallback?: Record<string, number>,
      ): Record<string, number> {
        if (!isRecord(value)) {
          warnConfig("nudges.bloatThresholdBytesByTool", value);
          return fallback ?? {};
        }
        const result: Record<string, number> = { ...(fallback ?? {}) };
        for (const [toolName, threshold] of Object.entries(value)) {
          if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0) {
            result[toolName] = threshold;
          } else {
            warnConfig("nudges.bloatThresholdBytesByTool entry", { [toolName]: threshold });
          }
        }
        return result;
      }

  - DO NOT: add a try/catch inside (validateConfig's outer wrapper covers it — GOTCHA #5).
  - DO NOT: start `result` from `{}` — MUST be `{ ...fallback }` (GOTCHA #2).

Task 2: MODIFY src/config.ts — WIRE the helper into validateConfig
  - PLACE: inside the existing `if (isRecord(nudgesRaw)) { ... }` block, AFTER the `driftThresholdTokens`
    handling and BEFORE the block's closing brace.
  - PATTERN: identical to the sibling fields — `v = safeGet(nudgesRaw, "<field>"); if (v !== undefined)
    cfg.nudges.<field> = <coercer>(v, cfg.nudges.<field>);`.
  - EXACT before/after (the current block ends with the driftThresholdTokens lines):

      // BEFORE (current end of the nudges block)
        v = safeGet(nudgesRaw, "driftThresholdTokens");
        if (v !== undefined) cfg.nudges.driftThresholdTokens = coerceNumber("nudges.driftThresholdTokens", v, cfg.nudges.driftThresholdTokens, true);
      }

      // AFTER (add two lines, keep the closing brace)
        v = safeGet(nudgesRaw, "driftThresholdTokens");
        if (v !== undefined) cfg.nudges.driftThresholdTokens = coerceNumber("nudges.driftThresholdTokens", v, cfg.nudges.driftThresholdTokens, true);
        v = safeGet(nudgesRaw, "bloatThresholdBytesByTool");
        if (v !== undefined) cfg.nudges.bloatThresholdBytesByTool = coerceBloatThresholdByTool(v, cfg.nudges.bloatThresholdBytesByTool);
      }

  - WHY this call type-checks: fallback is optional (Task 1), so passing the `| undefined`-typed
    cfg.nudges.bloatThresholdBytesByTool is legal.
  - DO NOT: touch any other nudges line, the interface, DEFAULT_CONFIG, or JSDoc.

Task 3: MODIFY test/config.test.ts — ADD validation test cases
  - PLACE: inside the existing `describe("validateConfig", () => { ... })` block. Add as new `it(...)`
    cases near the other nudges assertions (e.g. after the "validates numbers" test). DO NOT modify S1's
    existing literal edits.
  - PATTERN for warn checks: copy the try/finally + vi.spyOn(console, "warn") + mockRestore shape from the
    "does NOT warn for ABSENT fields" test.
  - ADD these cases (verbatim-ready):

      it("default bloatThresholdBytesByTool is the per-tool map { bash: 32768, read: 20480 }", () => {
        expect(validateConfig({}).nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
      });

      it("bloatThresholdBytesByTool: partial override MERGES over defaults (unmentioned tools preserved)", () => {
        const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: 99999 } } });
        expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 99999, read: 20480 }); // read preserved
      });

      it("bloatThresholdBytesByTool: invalid entries dropped with per-entry warn; defaults preserved", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: -1, read: 20480 } } });
          // bash(-1) dropped+warned → default 32768 preserved by merge; read(20480) valid → kept
          expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0][0]).toContain("nudges.bloatThresholdBytesByTool entry");
        } finally {
          warn.mockRestore();
        }
      });

      it("bloatThresholdBytesByTool: non-record value discarded → default map, one warn", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: "oops" } });
          expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0][0]).toContain("nudges.bloatThresholdBytesByTool");
        } finally {
          warn.mockRestore();
        }
      });

      it("bloatThresholdBytesByTool: array is not a record → discarded, one warn", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: [["bash", 5]] } });
          expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
          expect(warn).toHaveBeenCalledTimes(1);
        } finally {
          warn.mockRestore();
        }
      });

      it("bloatThresholdBytesByTool: unknown tool names are kept (forward-compat, spec/09 §4)", () => {
        const cfg = validateConfig({ nudges: { bloatThresholdBytesByTool: { bash: 99999, custom_tool: 5000 } } });
        expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 99999, read: 20480, custom_tool: 5000 });
      });

      it("bloatThresholdBytesByTool: absent field is NOT warned (absent ≠ invalid)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const cfg = validateConfig({ nudges: { bloatThresholdBytes: 100 } }); // byTool absent
          expect(cfg.nudges.bloatThresholdBytesByTool).toEqual({ bash: 32768, read: 20480 });
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

  - NOTE: the existing "validates numbers" and setConfig-cache tests already use 16384 (S1). Do NOT edit
    them. If a grep shows them still at 8192, S1 did not land — STOP and flag it (see Scope Boundaries).

Task 4: VERIFY (no edit) — S1's literal changes are present
  - RUN: `grep -n "8192" test/config.test.ts`
  - EXPECT: exactly ONE match — the `bloatThresholdBytes: "8192"` string-input line in "validates numbers".
    Every other 8192 must already be 16384 (S1 Tasks 4 & 6). If 8192 appears elsewhere, S1 is not merged —
    halt and surface it; do NOT silently fix it in S2.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: collection coercer (mirror coerceProtectedRoles). Type-guard first → wrong type: warn+fallback.
//   Right type: iterate, keep-or-drop-with-warn, return assembled result.
function coerceBloatThresholdByTool(value: unknown, fallback?: Record<string, number>): Record<string, number> {
  if (!isRecord(value)) {                              // isRecord = typeof==="object" && !null && !Array.isArray
    warnConfig("nudges.bloatThresholdBytesByTool", value);
    return fallback ?? {};                             // GOTCHA #1: optional param; runtime = default map
  }
  const result: Record<string, number> = { ...(fallback ?? {}) }; // GOTCHA #2: MERGE base, not {}
  for (const [toolName, threshold] of Object.entries(value)) {
    if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0) {
      result[toolName] = threshold;                    // valid → override (or add unknown tool)
    } else {
      warnConfig("nudges.bloatThresholdBytesByTool entry", { [toolName]: threshold }); // dropped, default kept
    }
  }
  return result;
}

// PATTERN: wiring is one safeGet + one guarded coercer call, identical in shape to every sibling nudges field:
//   v = safeGet(nudgesRaw, "bloatThresholdBytesByTool");
//   if (v !== undefined) cfg.nudges.bloatThresholdBytesByTool = coerceBloatThresholdByTool(v, cfg.nudges.bloatThresholdBytesByTool);
// The `if (v !== undefined)` guard is what makes "absent → no warn" work: absent safeGet returns undefined
// → guard skips the coercer entirely → the cloned default map is retained untouched.
```

### Integration Points

```yaml
NO NEW INTEGRATION SURFACE in S2. This subtask only completes the validation of a field S1 declared.
  - DATABASE: none
  - CONFIG: validateConfig now honors settings.json `mulligan.nudges.bloatThresholdBytesByTool`.
  - ROUTES/TOOLS: none (bloatThresholdFor wiring is T2.S1; src/nudges.ts untouched).
CONSUMERS (downstream — verify field name + "always-valid after validation" guarantee):
  - P2.M1.T2.S1: bloatThresholdFor reads config.nudges.bloatThresholdBytesByTool (guaranteed a valid map).
```

## Scope Boundaries (read before expanding scope)

**STRICTLY IN SCOPE (S2):** the `coerceBloatThresholdByTool` helper + its 2-line wiring in
`validateConfig` (`src/config.ts`); 4–7 new `it(...)` cases in `describe("validateConfig")`
(`test/config.test.ts`). Nothing else.

**ALREADY DONE by S1 — do NOT redo:**
- Interface field `bloatThresholdBytesByTool?: Record<string, number>` (S1 Task 1).
- `DEFAULT_CONFIG.nudges.bloatThresholdBytes = 16384` + `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }` (S1 Task 2).
- JSDoc on both fields (S1 Task 1).
- The 7 `8192`→`16384` literals in `test/config.test.ts` (S1 Tasks 4 & 6).
- `bloatThresholdBytesByTool` added to the two `toEqual` expected objects (S1 Tasks 3 & 5).
- The explicit `DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool` assertion is partly covered by S1's
  `toEqual`; S2 adds a standalone `validateConfig({})` assertion for clarity — that is additive, not a redo.

**EXPECT TO BREAK (owned by later subtasks — do NOT fix in S2):**
- `test/nudges.test.ts` — fixtures around the old 8192/9000-byte thresholds. → **P2.M1.T2.S2**.
- `test/tools/audit.test.ts` — `setConfig({})` + "threshold 8192" comments. → **P2.M1.T2.S2**.
- `test/integration/smoke.ts` — ">8KB canary" / "default 8192" references. → **P2.M1.T2.S3**.

**DO NOT IMPLEMENT in S2 (owned by others):** `bloatThresholdFor` + nudges.ts wiring (T2.S1); the
nudges/audit/smoke fixture resizes (T2.S2/T2.S3); README docs (T2.S4).

## Validation Loop

### Level 1: Type Check (after Tasks 1–2 — THE make-or-break gate)

```bash
# From project root. This is the gate that catches CRITICAL GOTCHA #1.
npx tsc --noEmit
# Expected: zero errors.
# If you see "Argument of type 'Record<string, number> | undefined' is not assignable to parameter of
# type 'Record<string, number>'" → your coerceBloatThresholdByTool `fallback` param is REQUIRED, not
# optional. Make it `fallback?: Record<string, number>` (default {}) and use `fallback ?? {}` inside.
```

### Level 2: Scoped Unit Tests (THE S2 gate — after Task 3)

```bash
# The authoritative S2 gate. Must pass with zero failures.
npx vitest run test/config.test.ts
# Expected: all tests pass, including the new bloatThresholdBytesByTool cases. If a new case fails:
#  - "partial override merges" fails (got { bash: 99999 }) → you started result from {} not {...fallback}.
#  - warn count is 0 where 1 expected → you skipped warnConfig on the non-record / invalid-entry branch.
#  - warn count is wrong → recheck the per-entry vs whole-map warn calls.
#  - an OLD test (e.g. "validates numbers") fails on a literal → S1 may not be merged; see Scope Boundaries.
```

### Level 3: Full Suite (INFORMATIONAL — expect known downstream failures)

```bash
# Runs the whole suite. EXPECT failures in nudges.test.ts / audit.test.ts (and possibly smoke) because
# they hardcode fixtures around the old 8192 default. These are T2.S2/T2.S3 scope, NOT S2 defects.
npm test   # = vitest run
# Expected for S2: config.test.ts block fully GREEN; nudges.test.ts / audit.test.ts RED only on
# threshold-fixture tests. If config.test.ts itself is RED, that is an S2 defect — fix before done.
```

### Level 4: Contract spot-check (runtime confirmation of the four behaviors)

```bash
# Quick programmatic confirmation of merge + drop + discard semantics.
node --input-type=module -e "
import('./src/config.js').then(({ validateConfig }) => {
  const m = (o) => validateConfig({ nudges: { bloatThresholdBytesByTool: o } }).nudges.bloatThresholdBytesByTool;
  console.log('default   :', JSON.stringify(validateConfig({}).nudges.bloatThresholdBytesByTool)); // {bash:32768,read:20480}
  console.log('merge     :', JSON.stringify(m({ bash: 99999 })));                                    // {bash:99999,read:20480}
  console.log('drop entry:', JSON.stringify(m({ bash: -1, read: 20480 })));                          // {bash:32768,read:20480}
  console.log('discard   :', JSON.stringify(m('oops')));                                             // {bash:32768,read:20480}
});
"
# Expected:
#   default   : {"bash":32768,"read":20480}
#   merge     : {"bash":99999,"read":20480}
#   drop entry: {"bash":32768,"read":20480}
#   discard   : {"bash":32768,"read":20480}
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes (GOTCHA #1 satisfied).
- [ ] `npx vitest run test/config.test.ts` passes (zero failures) — **the S2 gate**.
- [ ] Full-suite RED tests are ONLY the expected downstream threshold-fixture failures
      (nudges.test.ts / audit.test.ts / smoke.ts), all per the test-impact analysis.

### Feature Validation

- [ ] Partial override `{ bash: 99999 }` → `{ bash: 99999, read: 20480 }` (Level 4 spot-check).
- [ ] Invalid entry `{ bash: -1, read: 20480 }` → `{ bash: 32768, read: 20480 }` + exactly one warn.
- [ ] Non-record `"oops"` → default map + exactly one warn.
- [ ] Absent field → no warn, default map retained.
- [ ] Unknown tool name kept (forward-compat).
- [ ] `validateConfig` never throws on the new field (covered by existing adversarial-input tests + the
      outer try/catch; no new throw path introduced).

### Code Quality

- [ ] Helper placed immediately after `coerceProtectedRoles`; module-local (not exported).
- [ ] Helper mirrors `coerceProtectedRoles` shape (type-guard → fallback+warn OR iterate keep/drop-with-warn).
- [ ] `fallback` is optional (type-safe against the optional interface field); merge base is `{ ...fallback }`.
- [ ] No `try/catch` added inside the helper (outer wrapper suffices).
- [ ] No interface / `DEFAULT_CONFIG` / JSDoc / S1-owned literal changes.
- [ ] Field name `bloatThresholdBytesByTool` matches what T2.S1's `bloatThresholdFor` will read.

### Documentation & Deployment

- [ ] State: **"none — no additional user-facing/config/API surface change beyond S1 JSDoc."** The coerce
      function has no exported API surface. (Mode A per the item description.)

## Anti-Patterns to Avoid

- ❌ Don't give `coerceBloatThresholdByTool` a **required** `fallback` param — the optional interface field
  makes `cfg.nudges.bloatThresholdBytesByTool` `| undefined`, so a required param fails `tsc --noEmit`.
  Make it optional (default `{}`) and `fallback ?? {}` internally.
- ❌ Don't start the result map from `{}` — you must merge over `{ ...fallback }` or partial overrides
  drop the default entries (the "partial override merges" test fails).
- ❌ Don't re-edit the `8192`→`16384` literals or the two `toEqual` expected objects — S1 owns them; redoing
  them is a no-op at best and a merge conflict at worst.
- ❌ Don't add a `try/catch` inside the helper — `validateConfig`'s outer wrapper already guarantees
  "never throws"; mirroring `coerceProtectedRoles` (no inner try/catch) is correct.
- ❌ Don't warn on an **absent** field — the `if (v !== undefined)` guard must stay so absent ≠ invalid.
- ❌ Don't "fix" the downstream nudges/audit/smoke failures — they are deferred to T2.S2/T2.S3.
- ❌ Don't implement `bloatThresholdFor` or touch `src/nudges.ts` — that is T2.S1.

## Confidence Score

**9/10** for one-pass implementation success. The change is small (~25 helper lines + 2 wiring lines + ~6
test cases), the helper body and wiring are given verbatim, the warn-verification test shape is copied
from an existing passing test, and the single highest-risk detail (the optional-`fallback` tsc gotcha,
CRITICAL #1) is called out with the exact symptom message and fix. The 1-point reserve covers the
possibility that the implementer copies the architecture-doc sketch's required-`fallback` signature
verbatim and hits the tsc error before reading GOTCHA #1 — but the error message + fix are stated, so
recovery is one edit.