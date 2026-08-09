# Research findings — P4.M2.T1.S1 (Remove the `|| bloatHit` arm from shouldNudge)

All line references verified against the working tree at research time.

## The single source change

`src/nudges.ts`, function `shouldNudge` (exported, pure boolean):

- **Line 321** — the NO-DELTA FALLBACK — stays UNCHANGED:
  ```ts
  if (deltas.length === 0) return window.some((m) => m.bloatHit === true);
  ```
- **Line 323** — the DELTA-AVAILABLE return — REMOVE the `||` arm:
  ```ts
  // FROM:
  return avg > config.nudges.driftThresholdTokens || window.some((m) => m.bloatHit === true);
  // TO:
  return avg > config.nudges.driftThresholdTokens;
  ```

## JSDoc to rewrite (lines 271–315)

The function JSDoc currently asserts bloat is INDEPENDENT and fires regardless — now FALSE for the
delta-available path. Sentences to rewrite (full verbatim replacement text is in the PRP):

1. **First-paragraph tail** (line 273): "...exceeds `driftThresholdTokens`, OR any metric in that window recorded a
   bloated result." → delta-only-when-delta-exists; bloat is a no-delta fallback.
2. **Algorithm block** (lines 282–285): "Bloat is INDEPENDENT of the windowed delta: if ANY window metric has
   `bloatHit === true`, the nudge fires regardless..." → bloat is NOT OR'd in; demoted to no-delta fallback.
3. **Spec-ambiguity resolution** (line 294): "with bloat OR'd in." → "DELTA-ONLY (bloat demoted ...)".
4. **@returns** (lines 313–314): "OR any window metric has bloatHit === true." → delta-only + fallback note.

## Caller — unchanged (filter.ts)

The sole caller is `filter.ts` contextHandler (the drift-nudge block ~lines 290–305):
```ts
if (config.nudges.perTurnDrift && markers.recentMetrics && markers.recentMetrics.length > 0 &&
    shouldNudge(markers.recentMetrics, config) && markers.metric && !suppressCheck(markers.metric, markers)) {
  messages = injectNudge(messages, markers.metric);
}
```
This is UNCHANGED — it already passes `markers.recentMetrics` and consumes a plain boolean. No caller edit.

## Test impact (NOT this item's scope — owned by P4.M2.T1.S2)

After the line-323 change, exactly **one** `shouldNudge` assertion flips from `true` → `false`:

- `test/drift_nudge.test.ts` (the `shouldNudge — windowed drift gate` describe, ~lines 84–86):
  ```ts
  it("fires on bloatHit even when the windowed average is below threshold", () => {
    expect(shouldNudge([m(500, true, 1)], cfg())).toBe(true);   // ⟵ flips to .toBe(false) under S2
  });
  ```
  Why it flips: `m(500, true, 1)` → deltas=`[500]` (len 1, not 0) → avg 500 < threshold 6000 → old `||bloatHit`
  made it true; new delta-only return makes it false.

These stay GREEN (unchanged by this item):
- `[m(null,true,1)]` → deltas=`[]` → **no-delta fallback** → bloatHit true → `true` (fallback path untouched).
- `[8k,0.5k,0.5k]` → avg 3000 < 6000, no bloat → `false`.
- `[7k,7k,7k]` → avg 7000 > 6000 → `true`.
- empty window / all-null-no-bloat / window-slicing / malformed-delta → `false`.

There is also a descriptive **comment** at `test/filter.test.ts:943` ("moving average > threshold, or any window
bloatHit") that S2 may tidy — not an assertion; not this item's concern.

## Build / test commands (verified against package.json)

- **No `npm run build` script exists.** Type-check = `npx tsc --noEmit` (typescript ^5 devDep; `tsconfig.json`
  present). Removing a `||` arm is type-neutral — tsc stays green.
- Tests = `npm test` (`vitest run`) or `npx vitest run <file>`.
- Removing the `||` arm does NOT change any exported type/shape → no downstream tsc breakage.

## Spec authority

- `spec/07-preventive-and-nudges.md` §2 ("Edge cases") + §5.1 ("Windowed drift signaling", REQUIRED), committed
  `0bcaa814`: "The firing condition is delta-only when delta data is available... The earlier `|| bloatHit` arm is
  dropped... bloatHit remains a firing condition only in the no-delta fallback."
- `plan/004_d3d84055c5b2/architecture/codebase_patterns.md` §4 — pins the exact change + JSDoc rewrite.