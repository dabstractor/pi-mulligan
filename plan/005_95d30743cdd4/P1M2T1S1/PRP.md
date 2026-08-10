# PRP — P1.M2.T1.S1: Config knob `shrink.notifyMaxChars`

## Goal

**Feature Goal**: Add a validated configuration knob `shrink.notifyMaxChars` (default **2048**) to `MulliganConfig`
so the upcoming shrink operator-echo (P1.M2.T1.S2) can cap the replacement text shown to the human via
`ctx.ui.notify` — a pure UI side-channel with zero context cost. The knob must be a validated number (`> 0`,
invalid → 2048 + warn), accessible via `getConfig().shrink.notifyMaxChars`, and consistent with the sibling
`shrink.maxActive` / `shrink.staleAfterFires` knobs (same block, same `coerceNumber(..., true)` pattern).

**Deliverable**: Edits to **two files**:
1. `src/config.ts` — 3 insertions: (a) `notifyMaxChars: number` field + JSDoc in the `MulliganConfig.shrink`
   interface; (b) `notifyMaxChars: 2048` in `DEFAULT_CONFIG.shrink`; (c) the `coerceNumber` validation line in
   `validateConfig`'s shrink block.
2. `test/config.ts` — 6 snapshot-assertion updates (a **required mechanical corollary**: these existing
   `toEqual` assertions break when `notifyMaxChars: 2048` joins `DEFAULT_CONFIG.shrink`, so they must be
   updated to keep `npx vitest run` green). **NO new tests** — new `notifyMaxChars`-specific validation tests
   are sibling P1.M2.T1.S3's job.

**Success Definition**: After the edit, (a) `getConfig().shrink.notifyMaxChars === 2048` by default;
(b) `validateConfig({ shrink: { notifyMaxChars: 5000 } }).shrink.notifyMaxChars === 5000` (valid passes
through); (c) `validateConfig({ shrink: { notifyMaxChars: 0 } })` → `2048` + a `warnConfig` log naming the
field; (d) `npx tsc --noEmit` exits 0; (e) `npx vitest run` passes all **912** tests unchanged (the 6 updated
snapshots stay green; no count change).

## User Persona (if applicable)

**Target User**: pi-mulligan operators (humans watching the TUI) — via the upcoming `ctx.ui.notify` echo (S2);
also developers/extenders configuring the extension via `settings.json`.

**Use Case**: When the model records a `mulligan_shrink`, the human is shown the replacement text (capped) via
a toast — `notifyMaxChars` bounds that toast for UI ergonomics without adding a single token to the model's
context.

**Pain Points Addressed**: Today there is no operator surface for shrink (the replacement is invisible to the
human) and no cap knob. S2 adds the echo; this task adds the cap knob it consumes.

## Why

- **Unblocks the operator-echo feature (P1.M2.T1.S2)**: S2's `ctx.ui.notify(... cap(replacement, config.shrink.notifyMaxChars) ...)`
  reads this knob; it must exist (and be validated) before S2 lands. PRD spec/05 §2 behavior step 5 and
  spec/09 §3 both specify `notifyMaxChars` (default 2048).
- **Config-surface completeness / consistency**: every other `shrink.*` knob (`maxActive`, `staleAfterFires`)
  is a validated number with a `coerceNumber(..., true)` line, a DEFAULT_CONFIG entry, and an interface field
  + JSDoc. `notifyMaxChars` must follow the identical pattern so the config surface is uniform and a future
  build agent reading spec/09 reconstructs the shipped shape.
- **Spec/code alignment**: spec/09 §2 (schema) + §3 (rationale) + §4 (validation) already specify this knob;
  the code currently lacks it. This closes the gap.

## What

Three insertions in `src/config.ts` (interface + DEFAULT_CONFIG + validateConfig), each mirroring the existing
`staleAfterFires` knob one-for-one. Plus 6 snapshot-assertion updates in `test/config.ts` to keep the existing
suite green. No new behavior beyond the knob's existence/validation; no tool/echo code (that's S2); no new
tests (that's S3).

### Success Criteria

- [ ] `MulliganConfig.shrink` interface has `notifyMaxChars: number;` (REQUIRED, not optional — no `?`),
      placed AFTER `staleAfterFires: number;` and BEFORE the `// NOTE: "autoOnBloat"...` reservation comment,
      with JSDoc citing spec/09 §3 (pure UI side-channel, zero context cost).
- [ ] `DEFAULT_CONFIG.shrink` has `notifyMaxChars: 2048,` after `staleAfterFires: 3,`.
- [ ] `validateConfig`'s shrink block has the `coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true)`
      line (4th arg `true` = mustBePositive `>0`) after the `staleAfterFires` line, before the block's closing `}`.
- [ ] All 6 broken `toEqual` snapshot assertions in `test/config.ts` updated to include `notifyMaxChars: 2048`
      (lines 24, 79, 193, 245, 260, 307). INPUT literals (lines 71, 191, 236, 253, 259, 267, 281, 294, 304)
      are left unchanged.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npx vitest run` passes all 912 tests (no count change).
- [ ] No file other than `src/config.ts` and `test/config.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text of all three config.ts insertion points, the verbatim
desired insertions, the exact `coerceNumber` semantics (with file/line citation), and — critically — a table of
all 6 test snapshots that break as a direct consequence, with per-site before→after and disambiguation notes.
The implementer needs no exploration beyond opening `src/config.ts` and `test/config.ts`.

### Documentation & References

```yaml
# MUST READ — primary edit target (config.ts, 3 insertions)
- file: src/config.ts
  why: (1) MulliganConfig.shrink interface lines 57–70 — add the field after staleAfterFires.
        (2) DEFAULT_CONFIG.shrink lines 137–141 — add notifyMaxChars: 2048 after staleAfterFires: 3.
        (3) validateConfig shrink block lines 255–264 — add the coerceNumber line after staleAfterFires.
  pattern: "mirror staleAfterFires / maxActive exactly: interface field + JSDoc citing spec/09 §3; DEFAULT_CONFIG
            entry; coerceNumber(\"shrink.<field>\", v, cfg.shrink.<field>, true) (true = mustBePositive >0)."
  gotcha: "The interface block ends with a '// NOTE: autoOnBloat is reserved… Do not add it.' comment. Insert
           notifyMaxChars BEFORE that comment (keep the reservation note as the last thing before `};`). Do NOT
           remove or move the autoOnBloat note."

# MUST READ — the validation primitive (proves the >0 / fallback+warn contract)
- file: src/config.ts
  why: coerceNumber (lines 334–339) — `coerceNumber(field, value, fallback, mustBePositive)`. mustBePositive=true
        enforces value > 0 (else >= 0); invalid-present → return fallback + warnConfig(field, value). This is
        EXACTLY the contract: invalid ≤0/non-number → 2048 + warn.
  pattern: "the 4th arg is the mustBePositive flag. maxActive and staleAfterFires both pass `true` and are
            documented 'Must be > 0'. notifyMaxChars must pass `true` too (per contract OUTPUT)."
  gotcha: "do NOT pass false (>=0) — the contract requires >0 (a 0 cap is meaningless and must fall back)."

# MUST READ — secondary edit target (test/config.ts, 6 snapshot updates — REQUIRED corollary)
- file: test/config.ts
  why: Adding notifyMaxChars to DEFAULT_CONFIG makes every validated cfg.shrink have 4 keys. Six OUTPUT-side
        toEqual snapshots assert only 3 keys → they FAIL. They MUST be updated in THIS task (keep suite green).
  section: "6 sites — lines 24 (DEFAULT_CONFIG snapshot), 79 (full-override output), 193 (ignores-unknown-keys),
            245 ((b) defaults), 260 ((d) leaves enabled unchanged), 307 ((h) forward-compat)."
  gotcha: "INPUT literals (lines 71, 191, 236, 253, 259, 267, 281, 294, 304) are partial overrides passed INTO
           validateConfig — do NOT change them. Only the OUTPUT toEqual snapshots change. See the per-site
           table in the Implementation Tasks."

# SHOULD READ — the spec this knob must match (schema + rationale + validation)
- file: spec/09-configuration.md
  why: §2 schema (shrink block: `\"notifyMaxChars\": 2048`); §3 rationale row ('Pure UI side-channel — zero
        context cost … @05-tools.md §2'); §4 validation ('Numbers: must be finite, >= 0 (thresholds > 0)').
  section: "§2 (Schema & defaults, shrink block), §3 (Rationale per knob — shrink.notifyMaxChars row), §4
            (Validation rules)."
  gotcha: "READ-ONLY — do NOT edit spec/09 (it already specifies the knob correctly). This PRP makes the CODE
           match the spec."

# SHOULD READ — the spec behavior that consumes the knob (S2 implements it)
- file: spec/05-tools.md
  why: §2 behavior step 5 — the ctx.ui.notify echo uses cap(replacement, config.shrink.notifyMaxChars). Confirms
        the knob is a pure UI side-channel (zero context cost) and default 2048.
  section: "§2 mulligan_shrink, Behavior step 5 (Notify the operator at zero context cost)."
  gotcha: "S2 owns that code; this PRP only adds the knob S2 will read."

# CONTEXT — the architecture research (exact insertion points + the notify-echo design)
- file: plan/005_95d30743cdd4/architecture/m2_shrink_operator_echo.md
  why: 'Target design → "Config knob shrink.notifyMaxChars"' prescribes the interface field, the 2048 default,
        and the exact coerceNumber line. Confirms mustBePositive=true mirrors maxActive/staleAfterFires.
  critical: "The research lists config.ts insertions only — it does NOT flag the 6 broken test snapshots. THIS
             PRP adds that required corollary (the research predates noticing the snapshot breakage)."

# CONTEXT — the sibling that consumes this knob (confirms no file conflict)
- file: plan/005_95d30743cdd4/P1M1T1S3/PRP.md
  why: CONTRACT for the parallel item. It writes TESTS ONLY for mulligan_cancel (test/tools/cancel*.test.ts) —
        does NOT touch src/config.ts or test/config.ts. Zero overlap; either order OK.
```

### Current Codebase tree (the only relevant slice)

```bash
src/
└── config.ts            # ← EDIT: interface (57–70) + DEFAULT_CONFIG (137–141) + validateConfig (255–264)
test/
└── config.ts            # ← EDIT: 6 snapshot assertions (lines 24, 79, 193, 245, 260, 307)
spec/
├── 09-configuration.md  # READ-ONLY reference — §2/§3/§4 already specify the knob
└── 05-tools.md          # READ-ONLY reference — §2 step 5 consumes the knob (S2 implements)
plan/005_95d30743cdd4/architecture/m2_shrink_operator_echo.md  # READ-ONLY reference — insertion design
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/config.ts   # +1 interface field (+JSDoc) +1 DEFAULT_CONFIG entry +1 validateConfig line
test/config.ts  # 6 snapshot assertions gain ', notifyMaxChars: 2048'
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (the snapshot breakage): adding notifyMaxChars to DEFAULT_CONFIG.shrink makes every
//   validated cfg.shrink carry 4 keys. Six existing OUTPUT toEqual snapshots in test/config.ts assert 3 keys
//   and WILL FAIL ("expected ... to deep equal ... (missing notifyMaxChars)"). You MUST update all 6 (see the
//   table in Implementation Tasks) — otherwise `npx vitest run` is red and the task is incomplete. This is a
//   mechanical corollary of the config change, NOT new test coverage (S3 owns new tests).

// CRITICAL GOTCHA #2 (INPUT vs OUTPUT in test/config.ts): the string 'shrink: { enabled: false, maxActive: 8,
//   staleAfterFires: 2 }' appears TWICE — line 71 (INPUT to validateConfig, do NOT touch) and line 79 (OUTPUT
//   toEqual, DO update). Disambiguate by the preceding line: line 79 is preceded by 'expect(cfg).toEqual({'.
//   Similarly '{ enabled: true, maxActive: 32, staleAfterFires: 3 }' appears at 24 (full-config snapshot, has
//   '// no autoOnBloat (not v1)'), 193 ('// autoOnBloat dropped; defaults retained'), and 245 (bare, inside
//   test "(b)", followed by 'expect(warn).not.toHaveBeenCalled()'). Include the disambiguating comment/line
//   in each find string so edits target exactly one site.

// CRITICAL GOTCHA #3 (mustBePositive = true): the 4th arg to coerceNumber MUST be `true` (enforces value > 0).
//   Passing false would allow 0 (a meaningless 'show nothing' cap). The contract requires >0; ≤0 → 2048 + warn.
//   This mirrors maxActive/staleAfterFires exactly.

// CRITICAL GOTCHA #4 (placement in the interface): insert notifyMaxChars AFTER 'staleAfterFires: number;' and
//   BEFORE the '// NOTE: "autoOnBloat" is reserved…' comment. Keep the autoOnBloat reservation note as the
//   last thing before the closing '};' (it's a deliberate "do not add this field" marker). Do NOT move/delete it.

// CRITICAL GOTCHA #5 (REQUIRED, not optional): the interface field is `notifyMaxChars: number;` — NO `?`.
//   DEFAULT_CONFIG always supplies it (2048), and validateConfig always guarantees a valid number after
//   validation, so runtime never sees undefined. (Contrast bloatThresholdBytesByTool which IS optional `?` —
//   that's a different knob; do not copy its optionality here.)

// OUT OF SCOPE (do NOT touch in this subtask):
#   - src/tools/shrink.ts → the operator echo (ctx.ui.notify + cap helper) is P1.M2.T1.S2.
#   - NEW notifyMaxChars validation tests (e.g. "0 → 2048 + warn", "5000 passes through",
#     toHaveProperty("notifyMaxChars")) → P1.M2.T1.S3.
#   - spec/04-data-model.md §7 config schema, README config table, spec/05/spec/09 prose → changeset-level
#     doc sync (M5); spec/09 already specifies the knob so it needs no change.
#   - tsconfig.json, package.json → READ-ONLY.
# This PRP edits ONLY src/config.ts (3 insertions) + test/config.ts (6 snapshot updates).
```

---

## Implementation Blueprint

### Data models and structure

The `MulliganConfig.shrink` interface gains one REQUIRED `number` field. No other type changes. The field is
always populated by `DEFAULT_CONFIG` (2048) and guaranteed valid by `validateConfig`, so consumers read a real
number at runtime.

```typescript
// src/config.ts — MulliganConfig.shrink (after staleAfterFires, before the autoOnBloat NOTE):
/** Caps the replacement text shown to the operator via ctx.ui.notify when a shrink is recorded —
 *  a pure UI side-channel with ZERO context cost (the tool result itself stays terse). Must be > 0.
 *  Default: 2048. Source: spec/09-configuration.md §3; spec/05-tools.md §2.
 *  Consumed by P1.M2.T1.S2 (the shrink operator echo). */
notifyMaxChars: number;

// DEFAULT_CONFIG.shrink: notifyMaxChars: 2048,
// validateConfig: coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config.ts — add notifyMaxChars to the MulliganConfig.shrink INTERFACE
  - LOCATE the shrink interface (lines 57–70). Find the staleAfterFires field block:
      "    staleAfterFires: number;\n    // NOTE: \"autoOnBloat\" is reserved for a FUTURE opt-in mode and is NOT in v1"
  - INSERT between 'staleAfterFires: number;' and the '// NOTE: "autoOnBloat"...' line:
      "    /** Caps the replacement text shown to the operator via ctx.ui.notify when a shrink is recorded —\n     *  a pure UI side-channel with ZERO context cost (the tool result itself stays terse). Must be > 0.\n     *  Default: 2048. Source: spec/09-configuration.md §3; spec/05-tools.md §2.\n     *  Consumed by P1.M2.T1.S2 (the shrink operator echo). */\n    notifyMaxChars: number;\n"
  - RATIONALE: mirrors maxActive/staleAfterFires (field + multi-line JSDoc citing spec/09 §3). Placed before
    the autoOnBloat reservation NOTE so that NOTE stays last (it's a "do not add" marker). Field is REQUIRED
    (no `?`) — see GOTCHA #5.
  - DO NOT: remove/move the autoOnBloat NOTE; add `?`; change other fields.

Task 2: EDIT src/config.ts — add notifyMaxChars: 2048 to DEFAULT_CONFIG.shrink
  - LOCATE DEFAULT_CONFIG.shrink (lines 137–141). FIND:
      "  shrink: {\n    enabled: true,\n    maxActive: 32,\n    staleAfterFires: 3,\n  },"
  - REPLACE WITH:
      "  shrink: {\n    enabled: true,\n    maxActive: 32,\n    staleAfterFires: 3,\n    notifyMaxChars: 2048,\n  },"
  - RATIONALE: the default cap is 2048 (spec/09 §2/§3). Placed after staleAfterFires to mirror field order.
  - DO NOT: change other defaults; this 4-line block must remain the ONLY change here.

Task 3: EDIT src/config.ts — add the coerceNumber validation line in validateConfig's shrink block
  - LOCATE the shrink validation block (lines 255–264). FIND the staleAfterFires line + the block's closing brace:
      "      v = safeGet(shrinkRaw, \"staleAfterFires\");\n      if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber(\"shrink.staleAfterFires\", v, cfg.shrink.staleAfterFires, true);\n    }"
  - REPLACE WITH:
      "      v = safeGet(shrinkRaw, \"staleAfterFires\");\n      if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber(\"shrink.staleAfterFires\", v, cfg.shrink.staleAfterFires, true);\n      v = safeGet(shrinkRaw, \"notifyMaxChars\");\n      if (v !== undefined) cfg.shrink.notifyMaxChars = coerceNumber(\"shrink.notifyMaxChars\", v, cfg.shrink.notifyMaxChars, true);\n    }"
  - RATIONALE: mustBePositive=true (4th arg) → finite >0 passes through; ≤0/non-number/non-finite → fallback
    2048 + warnConfig (coerceNumber lines 334–339). Mirrors maxActive/staleAfterFires exactly.
  - DO NOT: pass false as the 4th arg; change the autoOnBloat comment on the line above the block.

Task 4: EDIT test/config.ts — update the 6 OUTPUT snapshot assertions (REQUIRED corollary; keep suite green)
  For each site, append ', notifyMaxChars: 2048' to the expected shrink object. Apply per-site (use the
  disambiguating comment/context noted — several expected objects are not unique strings on their own):

    Site 1 (line 24, DEFAULT_CONFIG full snapshot):
      FIND:  "shrink: { enabled: true, maxActive: 32, staleAfterFires: 3 },           // no autoOnBloat (not v1)"
      REPLACE: "shrink: { enabled: true, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 },           // no autoOnBloat (not v1)"

    Site 2 (line 79, "applies a full valid override" OUTPUT — disambiguate from the identical INPUT at line 71):
      FIND (2-line block, includes the preceding 'expect(cfg).toEqual({' so it matches only the OUTPUT):
        "    expect(cfg).toEqual({\n      shrink: { enabled: false, maxActive: 8, staleAfterFires: 2 },"
      REPLACE:
        "    expect(cfg).toEqual({\n      shrink: { enabled: false, maxActive: 8, staleAfterFires: 2, notifyMaxChars: 2048 },"

    Site 3 (line 193, "ignores unknown keys … autoOnBloat"):
      FIND:  "expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3 }); // autoOnBloat dropped; defaults retained"
      REPLACE: "expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 }); // autoOnBloat dropped; defaults retained"

    Site 4 (line 245, "(b) defaults to 32 / 3" — bare, no comment; disambiguate via the following line):
      FIND (2-line block):
        "      expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3 });\n      expect(warn).not.toHaveBeenCalled();"
      REPLACE:
        "      expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 });\n      expect(warn).not.toHaveBeenCalled();"

    Site 5 (line 260, "(d) leaves shrink.enabled unchanged"):
      FIND:  "expect(cfg.shrink).toEqual({ enabled: false, maxActive: 32, staleAfterFires: 3 });"
      REPLACE: "expect(cfg.shrink).toEqual({ enabled: false, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 2048 });"

    Site 6 (line 307, "(h) forward-compat … autoOnBloat dropped"):
      FIND:  "expect(cfg.shrink).toEqual({ enabled: true, maxActive: 10, staleAfterFires: 5 }); // autoOnBloat dropped"
      REPLACE: "expect(cfg.shrink).toEqual({ enabled: true, maxActive: 10, staleAfterFires: 5, notifyMaxChars: 2048 }); // autoOnBloat dropped"

  - RATIONALE: each asserts the full validated cfg.shrink, which now always includes notifyMaxChars (default
    2048, even when the input omitted it). Adding it keeps the deep-equal correct.
  - DO NOT:
      * touch INPUT literals (lines 71, 191, 236, 253, 259, 267, 281, 294, 304) — partial inputs are valid;
      * add NEW tests (notifyMaxChars-specific pass-through / ≤0-fallback / type-level toHaveProperty) — S3;
      * change the '//' trailing comments (e.g. '// no autoOnBloat (not v1)', '// autoOnBloat dropped').
  - VERIFY uniqueness before applying each edit: Sites 1, 3, 5, 6 are unique by their object text + comment;
    Sites 2 and 4 use a 2-line context block to disambiguate (per the FIND strings above).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: every shrink.* number knob follows the SAME three-site pattern. notifyMaxChars is identical to
// staleAfterFires except its name/default. Compare side by side:
//   interface:    staleAfterFires: number;        →   notifyMaxChars: number;
//   DEFAULT:      staleAfterFires: 3,             →   notifyMaxChars: 2048,
//   validate:     coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true)
//              →  coerceNumber("shrink.notifyMaxChars",  v, cfg.shrink.notifyMaxChars,  true)

// coerceNumber (src/config.ts:335–339) — the 4th arg is the mustBePositive flag:
//   typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0)
//   → true:  return value          (valid finite >0 passes through)
//   → false: warnConfig(field, value); return fallback;   (≤0 / NaN / non-number → 2048 + warn)
// So notifyMaxChars with `true`: 5000 → 5000; 1 → 1; 0 → 2048+warn; -5 → 2048+warn; "32" → 2048+warn.

// WHY the test snapshots break (the gotcha): DEFAULT_CONFIG.shrink is the merge base for validateConfig.
// After this change it is { enabled:true, maxActive:32, staleAfterFires:3, notifyMaxChars:2048 }. Any
// validateConfig({...}) result therefore has notifyMaxChars:2048 (default) unless overridden. The 6 OUTPUT
// toEqual snapshots hard-code the old 3-key object → deep-equal fails on the extra key. Updating them to
// include notifyMaxChars:2048 restores exact equality. (INPUT literals are not assertions — leave them.)
```

### Integration Points

```yaml
CODE:
  - modify: src/config.ts — interface field + DEFAULT_CONFIG entry + validateConfig line (3 insertions)
  - consumed-by (NO change here): src/tools/shrink.ts will read config.shrink.notifyMaxChars in P1.M2.T1.S2
TESTS:
  - modify: test/config.ts — 6 OUTPUT snapshot assertions gain ', notifyMaxChars: 2048' (keep suite green)
  - deferred (S3, NOT this PRP): NEW notifyMaxChars validation tests + type-level toHaveProperty

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No settings.json change required (the knob has a DEFAULT); no DB; no routes; no tool registration.
  - The only "integration" is SPEC CONSISTENCY: the knob matches spec/09 §2/§3/§4 (already correct) and is
    consumed by spec/05 §2 step 5 (implemented in S2). Validation gates below enforce the code<->spec match.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Strict type-check — the new field is typed `number`; DEFAULT_CONFIG has 2048; coerceNumber args match.
npx tsc --noEmit
echo "tsc exit: $?"   # expect 0 (baseline was 0; the change is type-clean)

# Confirm the three config.ts insertions landed:
grep -n 'notifyMaxChars' src/config.ts   # expect 3 hits: interface, DEFAULT_CONFIG, validateConfig
```
Expected: `tsc` exits 0; grep prints exactly 3 lines (the interface field, the default `2048`, the coerceNumber line).

### Level 2: Unit Tests (Component Validation)

```bash
# The config suite — the 6 updated snapshots live here; this is the gate that proves they're green.
npx vitest run test/config.ts
# Expected: all pass. If a snapshot fails with 'expected … to deep equal … (missing notifyMaxChars)' you
# MISSED one of the 6 sites (re-check the per-site table). If it fails with an EXTRA notifyMaxChars key on an
# INPUT literal, you accidentally edited an input (lines 71/191/236/…) — revert that.

# Full suite — regression guard (must stay at 912).
npx vitest run
# Expected: 912 passed (912). No count change (snapshots updated, no tests added/removed). No other file broke.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. The "system" validation for a config knob is a direct getConfig() check:
npx tsx -e "import {getConfig} from './src/config.js'; console.log(getConfig().shrink.notifyMaxChars);"
# Expected: prints 2048 (the default), proving the knob is wired + defaulted + accessible.

# Optional — prove the validation contract (pass-through + fallback+warn), mirroring how S3 will test it:
npx tsx -e "
import {validateConfig} from './src/config.js';
console.log('5000 ->', validateConfig({ shrink: { notifyMaxChars: 5000 } }).shrink.notifyMaxChars);  // 5000
console.log('0    ->', validateConfig({ shrink: { notifyMaxChars: 0 } }).shrink.notifyMaxChars);     // 2048 (+warn to stderr)
console.log('-1   ->', validateConfig({ shrink: { notifyMaxChars: -1 } }).shrink.notifyMaxChars);    // 2048 (+warn)
"
# Expected: 5000 -> 5000 ; 0 -> 2048 (with a warnConfig line on stderr) ; -1 -> 2048 (with a warn).
# (These exact assertions become S3's unit tests; running them here is a one-pass confidence check.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for a config knob. No UI to drive (the echo is S2), no perf, no security surface.
# The Levels 1–3 gates fully cover correctness for this subtask.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` exits 0 (baseline 0; change is type-clean).
- [ ] `npx vitest run test/config.ts` — all pass (the 6 updated snapshots are green).
- [ ] `npx vitest run` — full suite passes (912, no count change).
- [ ] `grep -n 'notifyMaxChars' src/config.ts` prints exactly 3 lines.

### Feature Validation
- [ ] `MulliganConfig.shrink` has `notifyMaxChars: number;` (REQUIRED, no `?`), after `staleAfterFires`, before
      the autoOnBloat NOTE, with JSDoc citing spec/09 §3 (pure UI side-channel, zero context cost).
- [ ] `DEFAULT_CONFIG.shrink.notifyMaxChars === 2048`.
- [ ] `validateConfig` shrink block has `coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true)`.
- [ ] Contract holds: valid `>0` passes through; `≤0`/non-number → 2048 + warn (Level 3 spot-check).
- [ ] All 6 OUTPUT snapshots in `test/config.ts` include `notifyMaxChars: 2048`; INPUT literals unchanged.
- [ ] No edits to any file other than `src/config.ts` and `test/config.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT implement the `ctx.ui.notify` echo / `cap` helper (that is P1.M2.T1.S2 in `src/tools/shrink.ts`).
- [ ] Did NOT add NEW notifyMaxChars validation tests or the type-level `toHaveProperty("notifyMaxChars")`
      (that is P1.M2.T1.S3).
- [ ] Did NOT touch `spec/04`, `spec/05`, `spec/09`, `README.md` (changeset-level doc sync is M5; spec/09
      already specifies the knob correctly).
- [ ] Did NOT pass `false` as coerceNumber's 4th arg (mustBePositive must be `true`).
- [ ] Did NOT remove/move the `// NOTE: "autoOnBloat" …` reservation comment in the interface.
- [ ] Did NOT add `?` to the interface field (it is REQUIRED).

### Documentation
- [ ] Interface JSDoc cites spec/09 §3 + spec/05 §2 (pure UI side-channel, zero context cost) — this IS the
      Mode A inline doc for this subtask. No separate doc file needed.

---

## Anti-Patterns to Avoid

- ❌ Don't ship the config.ts change without updating the 6 test snapshots — `npx vitest run` will be RED and
  the task is incomplete. The snapshot updates are a REQUIRED corollary, not optional polish.
- ❌ Don't edit INPUT literals (lines 71/191/236/253/259/267/281/294/304) — they're partial overrides passed
  into `validateConfig`; a partial input is valid. Only OUTPUT `toEqual` snapshots change.
- ❌ Don't pass `false` (>=0) as coerceNumber's 4th arg — the contract requires `>0` (`true`). A 0 cap is
  meaningless and must fall back to 2048.
- ❌ Don't add `?` to the interface field, and don't invent a default other than 2048 (spec/09 §2/§3 fix 2048).
- ❌ Don't implement the operator echo, the `cap` helper, or `describeTarget` in this task — that's S2
  (`src/tools/shrink.ts`). This PRP only adds the knob S2 will read.
- ❌ Don't add new tests (notifyMaxChars pass-through / ≤0-fallback / type-level) — that's S3. This PRP only
  keeps the EXISTING 6 snapshots green.
- ❌ Don't touch `spec/04`/`spec/05`/`spec/09`/`README` — spec/09 already specifies the knob correctly; the
  omnibus doc sync is M5.

---

## Confidence Score

**9/10** for one-pass implementation success. The config.ts change is a textbook 3-site insertion mirroring an
existing sibling knob (`staleAfterFires`) one-for-one, with verbatim find/replace for each site and the exact
`coerceNumber` semantics cited. The one non-obvious risk — the 6 broken test snapshots — is surfaced
prominently with a per-site table, disambiguation notes for the duplicate object literals, and verbatim
before→after for every site. Residual risks: (1) a snapshot site is missed (mitigated by the Level-2 gate's
explicit "missing notifyMaxChars" failure signature + the per-site line numbers); (2) an INPUT literal is
accidentally edited (mitigated by the Level-2 gate's "extra notifyMaxChars key on an input" note + the
explicit do-not-touch line list). Both are caught immediately by `npx vitest run test/config.ts`. No dependency
on the parallel item (separate files) or the consuming sibling S2 (it reads the knob later).