The brief is persisted. Here is the complete research deliverable:

---

# Research: Fail-Safe (Never-Throw) Runtime Config Validation + Coercion in TypeScript/Node ESM

## Summary

A fail-safe `validateConfig(raw: unknown)` should wrap every operation in a top-level `try/catch` that returns a **deep-cloned** default, coerce booleans with `!!` (where `'false'` → `true` because it's a non-empty truthy string — intentional per spec), validate numbers with `Number.isFinite()` (never the global `isFinite()` or `Number()`), validate enums/arrays against known sets, and guard all property reads against `null`, primitives, arrays, and throwing Proxies. Use `structuredClone()` (Node 17+ global) for deep-cloning plain-JSON config shapes to protect the shared `DEFAULT_CONFIG` singleton. Test with Vitest's `expect(fn).not.toThrow()`, deep-equal before/after snapshots, and `vi.resetModules()` for cache isolation.

## Key Findings (condensed — full detail with code in the written artifact)

1. **Boolean coercion**: `!!value` treats all non-empty strings as truthy, so `!!'false'` → `true`. Only 8 JS values are falsy (`false`, `0`, `-0`, `0n`, `''`, `null`, `undefined`, `NaN`). [MDN — Falsy](https://developer.mozilla.org/en-US/docs/Glossary/Falsy)

2. **Number validation**: `Number.isFinite()` does NOT coerce (unlike global `isFinite()`), rejecting strings/NaN/Infinity/null. Validate with `typeof v === 'number' && Number.isFinite(v) && v >= 0`. Never use `Number()` — `Number('') === 0` and `Number(null) === 0`. [MDN — Number.isFinite()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isFinite)

3. **Safe property reads**: A Proxy's `get`, `has`, and `ownKeys` traps can all throw, making `in`, destructuring, `Object.keys()`, and spread (`{...raw}`) unsafe. Only `try/catch`-wrapped `obj[key]` access is safe against adversarial Proxies. [MDN — Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)

4. **structuredClone**: Node 17+ global; deep-clones plain JSON shapes safely. Throws on functions/symbols. Fallback to `JSON.parse(JSON.stringify())` for those edge cases. [MDN — structuredClone()](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone)

5. **Singleton protection**: Never return the DEFAULT_CONFIG reference — always return `structuredClone(result)`. Use `Object.freeze` (shallow) or `deepFreeze` for dev-time mutation detection (throws in ESM strict mode). [MDN — Object.freeze()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze)

6. **Vitest**: `expect(() => fn(input)).not.toThrow()` for fail-safe assertions; `toEqual` for deep-equality snapshot comparisons; `vi.resetModules()` for module cache reset, or prefer explicit setter functions. [Vitest API](https://vitest.dev/api/)

7. **Pitfalls**: `as` casts bypass validation; `JSON.parse` throws on malformed input; `Number()` accepts `''`→0, `null`→0; `forEach`/spread on non-arrays throws; global `isFinite()` coerces strings.

The full brief with all code examples, comparison tables, and 20+ cited sources is written to the output path.

## Gaps
- Exact `structuredClone` fidelity for `Error.cause` and custom subclass properties (not critical for plain-JSON config shapes)
- `Object.hasOwn()` (Node 16.9+) vs `Object.prototype.hasOwnProperty.call()` choice depends on target Node version
- Empirical perf benchmarks of structuredClone vs JSON round-trip (not sourced with data)