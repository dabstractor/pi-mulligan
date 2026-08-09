# BUG-002 Research: TypeScript Compilation Error (stale SessionRuntime fixture)

> Status: **Researched (not yet implemented)**. This document is the upstream research for BUG-002.
> The code fix is delegated to a downstream PRP/implementation agent.

## 1. Root cause summary

`npx tsc --noEmit` exits non-zero with exactly **one** error. A hand-built `SessionRuntime`
fixture in `test/drift_nudge.test.ts` omits the `rewindRefusedTurnIndex` field that was added
to the `SessionRuntime` type by the later P4 drift-nudge-mute work (`src/runtime.ts`, consumed
by `src/filter.ts` and `src/tools/rewind.ts`). The fixture is a near-complete object literal, so
TypeScript's assertion-overlap check flags the missing required property as a likely mistake
(TS2352) rather than allowing the cast.

Runtime behavior is unaffected: the missing field reads as `undefined` at runtime, and vitest
transpiles without type-checking, so all 882 tests pass. The defect is purely a clean
type-check gate failure.

## 2. Exact compiler output

Command: `npx tsc --noEmit` (run from repo root; exit code 2)

```
test/drift_nudge.test.ts(239,10): error TS2352: Conversion of type '{ sessionId: string; seq: number; tokenBaseline: null; lastTurnIndex: null; lastFiltered: null; lastFilterTs: null; pendingBloatHits: never[]; shrinkMissCounts: Map<any, any>; aboveHighWater: boolean; }' to type 'SessionRuntime' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Property 'rewindRefusedTurnIndex' is missing in type '{ sessionId: string; seq: number; tokenBaseline: null; lastTurnIndex: null; lastFiltered: null; lastFilterTs: null; pendingBloatHits: never[]; shrinkMissCounts: Map<any, any>; aboveHighWater: boolean; }' but required in type 'SessionRuntime'.
```

This is the **only** error — there is exactly one offending site.

## 3. The stale fixture (test/drift_nudge.test.ts:238-250)

The offending fixture is the `rt()` helper inside the high-water edge-trigger lifecycle test
suite. Line 239 is the `return { ... } as SessionRuntime;` expression.

```ts
// test/drift_nudge.test.ts:238-250  (CURRENT — STALE)
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
    // <-- MISSING: rewindRefusedTurnIndex: null
  } as SessionRuntime;
}
```

### Fields the fixture is missing

Exactly **one** field is missing:

| Field | Type (per SessionRuntime) | Default at runtime | Fix value |
|---|---|---|---|
| `rewindRefusedTurnIndex` | `number \| null` | `null` (per `freshRuntime`) | `null` |

All other 9 `SessionRuntime` fields are present and correctly typed. The fixture is used by
the `shouldHighWater` tests, which only read/mutate `aboveHighWater` and `sessionId`, so the
runtime impact of the missing field is nil — but the type-check fails.

### Why TS2352 fires here but not on the empty-object cast in runtime.test.ts

- `runtime.test.ts:263` uses `{} as SessionRuntime` (an **empty** object). TypeScript allows an
  assertion from `{}` (a broad supertype) to `SessionRuntime` because `SessionRuntime` is
  assignable *to* `{}` in one direction — so the overlap check passes and no TS2352 is raised.
  That fixture is **not** stale/compiling-fine, though it does not assert the
  `rewindRefusedTurnIndex` field type (a minor coverage gap, out of scope for BUG-002).
- `drift_nudge.test.ts:249` uses a **near-complete** object literal. Because it is structurally
  close to `SessionRuntime` but differs by one required property, the "sufficient overlap" check
  fails and TS2352 is raised. TS itself suggests "convert the expression to 'unknown' first" as
  the escape hatch.

## 4. SessionRuntime type definition (src/runtime.ts) — full field inventory

The authoritative type is `SessionRuntime` in `src/runtime.ts`. The corresponding
`freshRuntime(sessionId)` factory builds the canonical default object. Every field below is
**required** (none optional), which is why a near-complete fixture trips TS2352.

| # | Field | Type | Default (`freshRuntime`) | Notes |
|---|---|---|---|---|
| 1 | `sessionId` | `string` | (arg) | Per-session key |
| 2 | `seq` | `number` | `0` | Monotonic marker counter; first marker gets 1 (pre-increment via `nextSeq`) |
| 3 | `tokenBaseline` | `number \| null` | `null` | null until first estimate |
| 4 | `lastTurnIndex` | `number \| null` | `null` | null until first turn_end |
| 5 | `lastFiltered` | `AgentMessage[] \| null` | `null` | cached filtered view for audit |
| 6 | `lastFilterTs` | `number \| null` | `null` | Date.now() of last context.fire |
| 7 | `pendingBloatHits` | `BloatHit[]` | `[]` | new empty array per runtime |
| 8 | `shrinkMissCounts` | `Map<string, number>` | `new Map()` | new Map per runtime |
| 9 | `aboveHighWater` | `boolean` | `false` | §5.2 edge-triggered latch |
| 10 | `rewindRefusedTurnIndex` | `number \| null` | `null` | **The field missing from the fixture.** P4.M1.T2.S3 / spec/08 E23. Latched on rewind refusal; read by filter.ts to mute the drift nudge for the remainder of that turn; cleared to `null` once `markers.metric.turnIndex` advances. |

`BloatHit` shape: `{ toolName: string; approxTokens: number }`.
`AgentMessage` = local opaque alias `Record<string, unknown>` (runtime.ts is Pi-free).

The `rewindRefusedTurnIndex` field was added by the later **P4 drift-nudge-mute** work
(`src/runtime.ts`, consumed by `src/filter.ts` and `src/tools/rewind.ts`). The stale
fixture predates it and was never updated.

## 5. tsconfig.json (project TypeScript configuration)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

Key points relevant to BUG-002:
- **`"include": ["src", "test"]`** — test files ARE type-checked by `tsc`. A stale fixture in a
  test file therefore breaks a clean type-check gate.
- **`"strict": true`** — enables strict assertion checking (TS2352 for the near-complete cast).
- **`"skipLibCheck": true`** — skips `.d.ts` checking; does not affect test-file type errors.
- There is **no `tsc --noEmit` script** in `package.json` (only vitest), so CI would need to add
  an explicit gate. This is why the error went unnoticed (vitest transpiles without type-checking).

## 6. test/index.test.ts — how the extension factory is tested

`test/index.test.ts` tests the **extension factory** (`src/index.ts`), NOT `SessionRuntime`
fixtures directly. It uses hand-rolled fakes:
- `makePi()` — fake `ExtensionAPI` capturing both `.on` registrations and `.registerTool` calls
  (cast via `as unknown as ExtensionAPI`).
- `makeCtx()` — fake `ExtensionContext` exposing only `sessionManager.getSessionId()`.
- It imports `getRuntime, clearAll` from `src/runtime.js` and uses `getRuntime(sid)` to obtain
  **real** SessionRuntime objects (which are always correctly built by `freshRuntime`), so there
  is **no stale fixture** in this file.

Relevant to BUG-001 (not BUG-002): `index.test.ts` asserts the factory registers exactly 5
tools, arms exactly 5 handlers (`context`, `tool_result`, `turn_end`, `session_start`,
`session_shutdown`), is sync (returns void), and that `session_start` resets the runtime while
`session_shutdown` clears all. It does NOT currently test config loading from Pi settings — that
is the BUG-001 gap.

## 7. Test suite status (vitest)

Command: `npx vitest run --reporter=verbose 2>&1 | tail -30`

```
 Test Files  20 passed (20)
      Tests  882 passed (882)
   Start at  08:37:04
   Duration  1.73s (transform 2.58s, setup 0ms, collect 10.31s, tests 478ms, environment 3ms, prepare 3.14s)
```

All **20** test files and **882** tests pass. This confirms BUG-002 is a type-check-only defect
with no runtime/test impact.

## 8. Other test files creating SessionRuntime fixtures

`grep -n "SessionRuntime" test/` results:

| File:Line | Pattern | Stale? |
|---|---|---|
| `drift_nudge.test.ts:13` | `import type { SessionRuntime }` | (import) |
| `drift_nudge.test.ts:238` | `function rt(above = false): SessionRuntime` | **YES — the stale fixture** |
| `drift_nudge.test.ts:249` | `} as SessionRuntime;` (near-complete object cast) | **YES — TS2352 site (line 239)** |
| `runtime.test.ts:7` | `import { ... type SessionRuntime }` | (import) |
| `runtime.test.ts:262` | `describe("types", ...)` | (describe) |
| `runtime.test.ts:263` | `const rt: SessionRuntime = {} as SessionRuntime;` | **NO** — empty-object cast allowed by TS; compiles fine. Does not assert `rewindRefusedTurnIndex` type (minor coverage gap, out of scope). |

**Conclusion: there is exactly ONE stale fixture** — `drift_nudge.test.ts:249`. No other test
file needs updating for BUG-002.

## 9. Recommended fix (for the downstream implementation agent)

Minimal, correct fix — add the missing field with its `freshRuntime` default:

```diff
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
+    rewindRefusedTurnIndex: null,
   } as SessionRuntime;
 }
```

Rationale:
- `null` matches the `freshRuntime()` default and the field's type (`number | null`). The
  `shouldHighWater` tests never read `rewindRefusedTurnIndex`, so `null` is the safe,
  spec-faithful value.
- Adding the field (rather than `as unknown as SessionRuntime`) keeps the fixture structurally
  honest and consistent with the canonical runtime shape — preferred per the codebase's
  "factories capture freshRuntime" pattern.

Alternative (acceptable but less honest): cast through `unknown`:
`} as unknown as SessionRuntime;` — TS's suggested escape hatch. Discouraged here because it
hides a structurally-relevant field from the test fixture.

## 10. Follow-up (out of scope for BUG-002, noted for the plan)

- **Add a CI `tsc --noEmit` gate** (no such script exists in `package.json` today). This is the
  reason the stale fixture went unnoticed (vitest transpiles without type-checking). The PRD
  Recommendations section calls this out.
- **Optional coverage gap**: `runtime.test.ts:263` does not assert `rewindRefusedTurnIndex`'s
  type (`toEqualTypeOf<number | null>()`). Adding it would harden the type-export test, but is
  not required to resolve the compile error.

## 11. Validation commands (for the implementation agent to re-run after the fix)

```
npx tsc --noEmit                                          # MUST exit 0
npx vitest run --reporter=verbose 2>&1 | tail -30         # MUST stay 882/882
```