# Research Notes — P1.M2.T1.S1: Config knob `shrink.notifyMaxChars`

> Config-only change to `src/config.ts` (interface + DEFAULT_CONFIG + validateConfig). Plus a MECHANICAL,
> required corollary: 6 existing snapshot assertions in `test/config.test.ts` break when `notifyMaxChars: 2048`
> joins `DEFAULT_CONFIG.shrink`, and MUST be updated to keep the suite green. NO new tests (S3 owns those).

## 1. The three config.ts insertion points (verified verbatim)

### (A) Interface — `MulliganConfig.shrink` (src/config.ts:57–70)
```ts
  /** Shrink operation (`mulligan_shrink`) settings. */
  shrink: {
    /** Enable the shrink tool/feature. Default: true. */
    enabled: boolean;
    /** Cap on simultaneous active shrink markers; ... Default: 32. ... */
    maxActive: number;
    /** Auto-retire a pinned shrink whose target is absent for this many consecutive
     *  fires. Must be > 0. Default: 3. Source: spec/09-configuration.md §2/§3.
     *  Consumed by P3.M2.T3. */
    staleAfterFires: number;
    // NOTE: "autoOnBloat" is reserved for a FUTURE opt-in mode and is NOT in v1 ...  ← insert BEFORE this
  };
```
INSERT after `staleAfterFires: number;` and BEFORE the `// NOTE: "autoOnBloat"...` comment:
```ts
    /** Caps the replacement text shown to the operator via ctx.ui.notify when a shrink is recorded —
     *  a pure UI side-channel with ZERO context cost (the tool result itself stays terse). Must be > 0.
     *  Default: 2048. Source: spec/09-configuration.md §3; spec/05-tools.md §2.
     *  Consumed by P1.M2.T1.S2 (the shrink operator echo). */
    notifyMaxChars: number;
```

### (B) DEFAULT_CONFIG.shrink (src/config.ts:137–141)
```ts
  shrink: {
    enabled: true,
    maxActive: 32,
    staleAfterFires: 3,
  },                         ← insert notifyMaxChars: 2048, BEFORE this closing brace
```
INSERT after `staleAfterFires: 3,`:
```ts
    notifyMaxChars: 2048,
```

### (C) validateConfig shrink block (src/config.ts:255–264)
```ts
    // shrink.*  (autoOnBloat intentionally NOT honored — reserved, not v1; S1 GOTCHA #1)
    const shrinkRaw = safeGet(raw, "shrink");
    if (isRecord(shrinkRaw)) {
      v = safeGet(shrinkRaw, "enabled");
      if (v !== undefined) cfg.shrink.enabled = coerceBoolean(v, cfg.shrink.enabled);
      v = safeGet(shrinkRaw, "maxActive");
      if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
      v = safeGet(shrinkRaw, "staleAfterFires");
      if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
    }                            ← insert the notifyMaxChars lines BEFORE this closing brace
```
INSERT after the `staleAfterFires` coerceNumber line (mirrors maxActive/staleAfterFires exactly):
```ts
      v = safeGet(shrinkRaw, "notifyMaxChars");
      if (v !== undefined) cfg.shrink.notifyMaxChars = coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true);
```

## 2. Validation semantics (verified — src/config.ts:334–339)
```ts
/** Number: must be a finite number; `mustBePositive` enforces `> 0` (else `>= 0`). Invalid-present → fallback + warn. */
function coerceNumber(field, value, fallback, mustBePositive): number {
  if (typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0)) return value;
  warnConfig(field, value);   // logs a warn naming the field + value
  return fallback;
}
```
→ `coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true)` with `true` (mustBePositive):
- valid finite `>0` → passes through.
- `≤0` / non-number / non-finite / missing-key-not-set → falls back to default `2048` + `warnConfig`.
This EXACTLY matches the contract OUTPUT ("invalid values ≤0/non-number → 2048 + warn") and mirrors
`maxActive`/`staleAfterFires` (same block, same `true` 4th arg, same "Must be > 0" doc).

## 3. ⚠️ CRITICAL GOTCHA — 6 existing snapshot assertions BREAK (required corollary)

Adding `notifyMaxChars: 2048` to `DEFAULT_CONFIG.shrink` means every validated `cfg.shrink` now has **4 keys**,
not 3. Six OUTPUT-side `toEqual`/snapshot assertions in `test/config.test.ts` assert the full shrink object
with only 3 keys → they FAIL with "expected ... to deep-equal ... (missing notifyMaxChars)". These MUST be
updated in THIS task to keep `npx vitest run` green (912/912). (INPUT literals are partial overrides and do
NOT need changing; NEW notifyMaxChars-specific validation tests are S3's job.)

| # | Line | Test | Current expected shrink object | Add |
|---|------|------|--------------------------------|-----|
| 1 | 24 | DEFAULT_CONFIG full snapshot | `{ enabled: true, maxActive: 32, staleAfterFires: 3 }` (trailing `// no autoOnBloat (not v1)`) | `, notifyMaxChars: 2048` |
| 2 | 79 | "applies a full valid override" OUTPUT | `{ enabled: false, maxActive: 8, staleAfterFires: 2 }` (inside `expect(cfg).toEqual({`) | `, notifyMaxChars: 2048` |
| 3 | 193 | "ignores unknown keys … autoOnBloat" | `{ enabled: true, maxActive: 32, staleAfterFires: 3 }` (trailing `// autoOnBloat dropped; defaults retained`) | `, notifyMaxChars: 2048` |
| 4 | 245 | "(b) defaults to 32 / 3" | `{ enabled: true, maxActive: 32, staleAfterFires: 3 }` (followed by `expect(warn).not.toHaveBeenCalled()`) | `, notifyMaxChars: 2048` |
| 5 | 260 | "(d) leaves shrink.enabled unchanged" | `{ enabled: false, maxActive: 32, staleAfterFires: 3 }` | `, notifyMaxChars: 2048` |
| 6 | 307 | "(h) forward-compat … autoOnBloat dropped" | `{ enabled: true, maxActive: 10, staleAfterFires: 5 }` (trailing `// autoOnBloat dropped`) | `, notifyMaxChars: 2048` |

**Disambiguation notes for the duplicates:**
- `{ enabled: true, maxActive: 32, staleAfterFires: 3 }` appears at lines **24** (nested in full-config snapshot,
  trailing `// no autoOnBloat (not v1)`), **193** (trailing `// autoOnBloat dropped; defaults retained`), and
  **245** (bare; inside `try {` of test "(b)", followed by `expect(warn).not.toHaveBeenCalled()`). Each is
  uniquely identifiable by its trailing comment / following line — include that context in the find string.
- `{ enabled: false, maxActive: 8, staleAfterFires: 2 }` appears at **line 71 (INPUT — do NOT touch)** and
  **line 79 (OUTPUT — update)**. Disambiguate line 79 by including the preceding `expect(cfg).toEqual({` line.

**Lines that are INPUT literals (do NOT change):** 71, 191, 236, 253, 259, 267, 281, 294, 304 — these are
arguments passed to `validateConfig({...})`; a partial input is valid and must stay partial.

**Type-level test (lines 311–312):** `toHaveProperty("maxActive")` / `toHaveProperty("staleAfterFires")` — does
NOT break (only checks those two exist). S3 may add `toHaveProperty("notifyMaxChars").toEqualTypeOf<number>()`
here; NOT required for S1 (it doesn't break).

## 4. Baseline (verified)
- `npx tsc --noEmit` → exit 0 (clean pre-change).
- `npx vitest run` → **912 passed (912)** across 21 files.
- After the change + 6 snapshot fixes: tsc still 0; vitest still 912/912 (no net count change — snapshots
  updated, no tests added/removed).

## 5. Conflict / scope check
- Parallel item P1.M1.T1.S3 writes TESTS ONLY for `mulligan_cancel` (cancel.test.ts / cancel_target.test.ts);
  it does NOT touch `src/config.ts` or `test/config.test.ts`. Zero overlap.
- Sibling P1.M2.T1.S2 implements the shrink operator echo in `src/tools/shrink.ts` (CONSUMES
  `config.shrink.notifyMaxChars`) — a separate file; depends on this knob existing but no file conflict.
- Sibling P1.M2.T1.S3 adds NEW notifyMaxChars validation tests + shrink echo tests — separate; this PRP only
  updates the 6 broken EXISTING snapshots, not new coverage.
- This PRP edits `src/config.ts` (3 insertions) + `test/config.ts` (6 snapshot updates). Nothing else.

## 6. Spec cross-references (the JSDoc cites these)
- spec/09-configuration.md §2 (schema: `"notifyMaxChars": 2048` in the shrink block) + §3 (rationale row:
  "Pure UI side-channel — zero context cost … @05-tools.md §2") + §4 (validation: Numbers must be finite `>0`).
- spec/05-tools.md §2 behavior step 5 (the `ctx.ui.notify` echo that consumes `config.shrink.notifyMaxChars`).
- spec/04-data-model.md §7 config schema summary (the omnibus shape — would also gain the field; that doc-sync
  is owned by the changeset-level M5 sweep, NOT this subtask).