# External / language best practices — P1.M1T4.S1 (runtime.ts)

Verified TS/Node/vitest facts the implementation relies on. No web research needed for a pure in-memory
module, but each fact below was checked against the live toolchain (Node 26, tsc 5.9.3, vitest 1.6.1) and/or
authoritative docs.

---

## 1. Module-scoped `Map` as a singleton store — the standard pattern

A module-level `const runtimes = new Map<string, SessionRuntime>()` is a process-wide singleton: every
`import { getRuntime } from "../src/runtime.js"` in the same process sees the SAME map (ES modules are cached
per-URL). This is exactly what Pi extensions need — `index.ts`, `filter.ts`, `tools/*` all share one runtime
per session without passing it around.

- ✅ ES module singleton guarantee: a module is evaluated once per unique specifier; the `Map` literal runs once.
  (MDN: "A module is only evaluated the first time it is imported"; nodejs.org/api/esm.html#resolver-algorithm.)
- ✅ `Map` key equality uses SameValueZero — distinct strings are distinct keys; no accidental collisions.
  This is why session isolation is automatic: `"s-A"` and `"s-B"` are independent entries.
- ⚠️ **Test hazard:** vitest does NOT reset module state between `it` blocks. A Map mutated by one test leaks
  into the next. Mitigation: `clearAll()` in `beforeEach`/`afterEach` (same as config.ts GOTCHA #9,
  log.ts GOTCHA #6). Verified: without the reset, a `nextSeq` from test N inflates the value seen in test N+1.

## 2. `getRuntime` returns a LIVE mutable reference (intentional)

The consumers mutate fields in place (`rt.tokenBaseline = n`; `rt.lastFiltered = msgs`;
`rt.pendingBloatHits.push(...)`). So `getRuntime` must NOT return a defensive copy — it returns the actual
stored object. `Map.get` returns the stored reference; `Map.set` stores the reference; both are O(1). This is
the intended shared-mutable-state design (spec/06 §7: "written by the filter each fire").

- ✅ Verified: `const a = getRuntime(id); a.x = 1; expect(getRuntime(id).x).toBe(1)` — same object.
- ✅ Verified: `expect(getRuntime(id)).toBe(getRuntime(id))` — reference equality holds until reset.

## 3. `nextSeq` uses PRE-increment → 1-based marker ids

`return ++rt.seq;` evaluates to the post-increment value. Fresh `seq = 0` → first `nextSeq` returns **1**.
This matches spec/04 §3 ("seq: monotonic per-session counter") where `seq` is persisted INTO each marker:
marker #1 carries `seq:1`. A `0` baseline doubles as "no markers yet". (Post-increment `rt.seq++` would return
0 for the first marker and is the classic off-by-one; pre-increment is correct here.)

- ✅ Verified by reasoning + unit test: `nextSeq` sequence is 1,2,3,… and `getRuntime(id).seq` reads back the
  latest.
- ✅ Per-session isolation is free: each `SessionRuntime` has its own `seq` field; A's increments never touch B.

## 4. `resetRuntime` deletes (not reset-in-place) — aligns with C12

`runtimes.delete(sessionId)` removes the entry; the next `getRuntime` lazily builds a fresh one via the
`freshRuntime` factory. This is preferable to mutating the existing object in place because:

- C12 (spec/02): after session replacement, stale references must not keep mutating live state. Deleting means
  any reference a caller still holds is "abandoned" (points at a detached object) — the canonical safe pattern.
- The factory always allocates a **new** `pendingBloatHits: []` (GOTCHA: never share one module-level empty
  array across runtimes — a shared array would let session B see session A's bloat hits). Verified pattern:
  `freshRuntime` returns a fresh object literal each call.
- `Map.delete` on an absent key is a no-op (returns false); never throws. ✅ (MDN Map.prototype.delete.)

## 5. `clearAll` = `Map.clear()` for full teardown

`Map.prototype.clear()` removes all entries in O(n) (n = number of sessions; tiny). Provided for
`session_shutdown` / process-exit / `/reload` cleanup so no session leaks across a teardown. Wiring it to a
handler is **P1.M7.T1**; runtime.ts only exposes the function. `clear()` on an empty map is a no-op. ✅

## 6. The local `AgentMessage` alias — why `Record<string, unknown>`

The real Pi `AgentMessage` union is NOT importable here (see codebase_recon.md §3). runtime.ts treats messages
as opaque data it stores and returns. `Record<string, unknown>` is:

- **Honest:** every Pi message variant is a plain object with a `role` string + content fields → a record.
- **Permissive on write:** a real `PiAgentMessage[]` is assignable INTO `lastFiltered: Record<string,unknown>[]`
  (object types are assignable to index signatures; array covariance). filter.ts needs no cast. ✅
- **Loose on read:** audit.ts, reading back, narrows to the real Pi type (it gets the real type from the
  `context` event) via an explicit cast — acceptable and safe (the objects ARE real messages).
- **Foundation-tier-clean:** keeps runtime.ts Pi-free (matches config.ts / log.ts).

Alternative considered: `unknown[]` (even more opaque) — rejected because `Record<string, unknown>` at least
lets a curious reader see "these are message objects", and is assignable from real messages without contortions.
`any` rejected (forbidden under `strict`/`noImplicitAny`).

## 7. vitest `expectTypeOf` for type-level assertions

`expectTypeOf<SessionRuntime>()` / `expectTypeOf(rt.seq).toEqualTypeOf<number>()` compile-check the exported
types at test time (vitest.dev/api/#expecttypeof). Used in the suite to lock the interface shape and the
`BloatHit`/`AgentMessage` exports. Verified: vitest 1.6.1 ships `expectTypeOf` (already used in
`test/config.test.ts`).

## 8. ESM + Bundler resolution ⇒ `../src/runtime.js` import in tests

Under `moduleResolution: "Bundler"` + `"type": "module"`, the test imports the TS source as `"../src/runtime.js"`
(the `.js` is required even though the file is `.ts`). Verified live — this is the exact convention
`test/config.test.ts` uses. runtime.ts itself has **no imports** (pure TS), so there is no `node:` or relative
import to get wrong here.

---

## References (verified, not just cited)

- ES module evaluation-once / single-instance: https://nodejs.org/api/esm.html#modules-ecmascript-modules
- `Map` SameValueZero key equality, `delete`/`clear` no-op-on-absent semantics:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
- TypeScript index-signature assignability (object type → `Record<string, unknown>`):
  https://www.typescriptlang.org/docs/handbook/2/objects.html#index-signatures
- vitest `expectTypeOf`: https://vitest.dev/api/#expecttypeof
- vitest does not reset module state between tests (use beforeEach): https://vitest.dev/guide/test-context.html