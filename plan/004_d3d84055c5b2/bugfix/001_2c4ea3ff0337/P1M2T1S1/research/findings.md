# Research Notes — P1.M2.T1.S1: Fix stale SessionRuntime fixture in drift_nudge.test.ts (BUG-002)

> Test-internal fix (Mode A). Add ONE missing field (`rewindRefusedTurnIndex: null`) to the `rt()` helper's
> object literal in `test/drift_nudge.test.ts` so `npx tsc --noEmit` passes. No production code, no new tests.

## 1. The defect (verified — the error reproduces live)

`npx tsc --noEmit` exits non-zero with EXACTLY ONE error:
```
test/drift_nudge.test.ts(239,10): error TS2352: Conversion of type '{ sessionId: string; seq: number;
tokenBaseline: null; lastTurnIndex: null; lastFiltered: null; lastFilterTs: null; pendingBloatHits: never[];
shrinkMissCounts: Map<any,any>; aboveHighWater: boolean; }' to type 'SessionRuntime' may be a mistake ...
Property 'rewindRefusedTurnIndex' is missing in type '...' but required in type 'SessionRuntime'.
```

Root cause: the `rt()` fixture (lines 238–250) is a near-complete `SessionRuntime` literal that omits the
`rewindRefusedTurnIndex` field added to the type by the later P4 drift-nudge-mute work. Because the literal is
structurally CLOSE to `SessionRuntime` but differs by one required property, TS's "sufficient overlap" check
FAILS and raises TS2352. (Contrast: `runtime.test.ts:263` uses an empty `{} as SessionRuntime` cast which TS
allows because `SessionRuntime` is assignable to `{}` — not stale, just not asserting the field. Don't touch
that one.)

## 2. The fixture, verbatim (test/drift_nudge.test.ts:238–250, 4-space field indent)

```ts
function rt(above = false): SessionRuntime {
  return {
    sessionId: "s1",
    seq: 0,
    tokenBaseline: null,
    lastTurnIndex: null,
    lastFiltered: null,
    lastFilterTs: null,
    pendingBloatHits: [],
    shrinkMissCounts: new Map(),
    aboveHighWater: above,
  } as SessionRuntime;
}
```
Has 9 fields. Missing exactly ONE: `rewindRefusedTurnIndex`.

## 3. The type (src/runtime.ts:59–101 — `export interface SessionRuntime`)

10 required fields: `sessionId`, `seq`, `tokenBaseline`, `lastTurnIndex`, `lastFiltered`, `lastFilterTs`,
`pendingBloatHits`, `shrinkMissCounts`, `aboveHighWater`, **`rewindRefusedTurnIndex`**.
- Line 101: `rewindRefusedTurnIndex: number | null;` (the type — `number | null`, REQUIRED, no `?`).
- Line 127 (`freshRuntime` default): `rewindRefusedTurnIndex: null,` → the runtime default is `null`.
- The field's JSDoc: "The turnIndex of a turn in which a `mulligan_rewind` was just REFUSED (P4.M1.T2.S3 /
  spec/08 E23)… filter.ts's drift-nudge block reads it to MUTE Nudge B (the drift nudge)."

## 4. The fix (one line, value = null)

Insert after `aboveHighWater: above,` and before the closing `} as SessionRuntime;`:
```ts
    rewindRefusedTurnIndex: null,
```
- Value `null` matches (a) the field type `number | null`, (b) the `freshRuntime()` default (line 127).
- The `shouldHighWater` tests that use this fixture only read/mutate `aboveHighWater` + `sessionId` — they
  never read `rewindRefusedTurnIndex`, so `null` is behaviorally inert for them (runtime impact = nil).
- KEEP the cast as `as SessionRuntime` (do NOT switch to `as unknown as SessionRuntime`). Adding the missing
  field makes the literal structurally complete → the `as SessionRuntime` cast is now legitimate (TS2352 goes
  away) → the more honest fix. (Casting through `unknown` would silence the error but hide staleness.)

## 5. Toolchain / validation facts (verified)
- `tsconfig.json`: `"strict": true`, `"include": ["src", "test"]` → `tsc --noEmit` checks test files too.
- `package.json`: `"test": "vitest run"`. No `typecheck`/`build` script yet (P1.M2.T1.S2 adds it — separate
  sibling, edits `package.json`, no file conflict with this task).
- vitest transpiles WITHOUT type-checking → all 882 tests pass today despite the missing field. After the fix
  they stay 882/882 (no behavior change — the added field is unread by the high-water tests).

## 6. Conflict / scope check
- Parallel item P1.M1.T2.S2 wires settings loading into `src/index.ts` → different file, zero overlap.
- Sibling P1.M2.T1.S2 adds a `typecheck` script to `package.json` → different file, complementary (S1 makes
  `tsc` pass; S2 adds the script that runs it). Either order is fine; this PRP makes no `package.json` change.
- This PRP edits ONLY `test/drift_nudge.test.ts`, the `rt()` helper (line ~248 insertion).

## 7. Other SessionRuntime fixtures (DO NOT TOUCH — out of scope)
- `runtime.test.ts:263` uses `{} as SessionRuntime` (empty cast — TS allows it, not stale, compiles fine).
  Do NOT change it. (Minor coverage gap, explicitly out of scope per research §3 / §10.)
- Any other test files building `SessionRuntime` literals are out of scope — BUG-002 is the single TS2352.