# Research Notes — P1.M1.T2.S1 (BUG-003: floor >= 1 guard on shrink.maxActive + shrink.staleAfterFires)

## Target & the bug
`src/config.ts` `validateConfig`, shrink branch lines **266–269**. Both knobs pass through `coerceNumber(..., true)`
(require `> 0`) but have **NO Math.floor and NO `>= 1` guard** — so a fractional value in `(0,1)` (e.g. `0.5`)
is accepted VERBATIM. Confirmed by `architecture/bug_verification.md §BUG-003` (Status: CONFIRMED).

## Confirmed exact current code (verbatim, src/config.ts lines 266–269)
```typescript
      v = safeGet(shrinkRaw, "maxActive");
      if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
      v = safeGet(shrinkRaw, "staleAfterFires");
      if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
```
NOTE: single-line assignments — NO `const n`, NO Math.floor. (Contrast: driftWindowTurns at ~line 288 ALREADY
has `const n` + `Math.floor(n)`, only missing `>= 1` — that's the sibling BUG-002 fix.)

## The PRECEDENT to mirror EXACTLY — rewind.maxRetriesPerPrompt (src/config.ts lines 247–250)
```typescript
      v = safeGet(rewindRaw, "maxRetriesPerPrompt");
      if (v !== undefined) {
        const n = coerceNumber("rewind.maxRetriesPerPrompt", v, cfg.rewind.maxRetriesPerPrompt, true);
        cfg.rewind.maxRetriesPerPrompt = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt;
      }
```

## The fix (expand each to the multi-line block form — NOT just a token insertion)
maxActive:
```typescript
      v = safeGet(shrinkRaw, "maxActive");
      if (v !== undefined) {
        const n = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
        cfg.shrink.maxActive = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.maxActive;
      }
```
staleAfterFires: identical shape (substitute field name + label + default ref).
KEY DIFFERENCE from BUG-002 (T1.S1): T1.S1 inserts a token into an EXISTING 2-line form; I EXPAND a 1-line
assignment into the 3-line block. Both end up mirroring maxRetriesPerPrompt.

## coerceNumber semantics (why 0.5 reaches the guard, and why the fallback is SILENT)
- `coerceNumber(name, v, default, true)`: returns `v` unchanged if `v` is a finite number `> 0` (NO warn);
  else returns `default` WITH a `warnConfig(name, v)` call.
- So `0.5` → passes (`> 0`, no warn) → `n = 0.5` → `Math.floor(0.5) === 0` → `0 >= 1` FALSE → fall back to
  default **SILENTLY** (no warn). Integers `0/-1` and `NaN/non-numbers/'abc'/Infinity` are rejected EARLIER
  by coerceNumber (not `> 0`) → warn + default; the floor guard never sees them.
- => The guard ONLY newly affects values in `(0,1)` that are finite & `> 0`. The fallback is SILENT — do NOT
  add a `warnConfig` call (mirror maxRetriesPerPrompt exactly; consistency wins over diagnostics).

## Downstream impact (filter.ts contextHandler — WHY a fractional value is degenerate)
- maxActive: `markers.shrinks.length > config.shrink.maxActive` (line 411) → `1 > 0.5` → true with just ONE
  active shrink → oldest shrink auto-retired IMMEDIATELY (soft cap collapses).
- staleAfterFires: `misses >= config.shrink.staleAfterFires` (line 401) → `1 >= 0.5` → pinned shrink retired
  after a SINGLE miss instead of the default 3 (E15 auto-retire threshold semantics break).
- DO NOT modify filter.ts — it already treats both as positive integers once config is correct.

## Existing tests (test/config.test.ts, describe at line 234)
Title: `"shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)"`. Existing cases:
- (a) maxActive:10, staleAfterFires:5 → 10/5 (integers ≥1, unaffected).
- (b) round-trip defaults → toEqual({…,maxActive:32,staleAfterFires:3,…}).
- (c) maxActive:1, staleAfterFires:1 → 1/1 (edge integer, unaffected — 1≥1 kept).
- (d) enabled:false round-trip → defaults.
- (e) invalid maxActive {0,-1,NaN,'abc',Infinity} → 32 + exactly 1 warn (rejected by coerceNumber >0; unaffected).
- (f) invalid staleAfterFires {0,-1,NaN,'abc',Infinity} → 3 + exactly 1 warn (unaffected).
- (g) maxActive:0, staleAfterFires:-1 → 32/3 (unaffected).
- (h) + autoOnBloat:true dropped → 10/5 (unaffected).
- (type) type-level number.
NEW gap (UNTESTED today): fractional `(0,1)`. Add:
- maxActive:0.5 → 32 (silent; assert `expect(warn).not.toHaveBeenCalled()`).
- staleAfterFires:0.5 → 3 (silent; assert `expect(warn).not.toHaveBeenCalled()`).
vi.mock for warnConfig already set up in this file (`warn` spy — see line 270 `warn.mock.calls[0][0]`).

## JSDoc (Mode A docs) — MulliganConfig.shrink fields (lines ~59–66)
- maxActive: `… Must be > 0. Default: 32. …` → `… Positive integer (>= 1; fractional values that floor below 1 fall back to the default). Default: 32. …`
- staleAfterFires: `… Must be > 0. Default: 3. …` → same integer clarification.
(Field type stays `number`; default unchanged.)

## Scope discipline (do NOT touch)
- driftWindowTurns (~line 288) — sibling BUG-002 (P1.M1.T1.S1, parallel). Different branch (nudges), no textual overlap; T1.S1 adds no lines so my line numbers stay valid.
- maxRetriesPerPrompt (lines 247–250) — already correct (the precedent I mirror).
- notifyMaxChars (line ~270) — legitimately a char-size cap (any positive number; NOT an integer-count knob); leave at coerceNumber `>0` only. Bug doc lists ONLY maxActive + staleAfterFires.
- filter.ts (downstream consumer), nudges.ts, tools — READ-ONLY.
- README/spec doc sync — separate changeset task.