# Research Findings — P2.M3.T1.S1 (config.ts + settings.ts: add ui.activeCheckpointBanner)

Scope: add a top-level `ui: { activeCheckpointBanner: boolean }` block (default `true`,
`!!`-coerced) to the MulliganConfig surface. Consumed downstream by `reconcileBanner`
(P2.M3.T1.S2). This note captures the load-bearing findings from reading `src/config.ts`,
`src/settings.ts`, `test/config.test.ts`, `test/settings.test.ts`, `src/banner.ts`, and the
P2.M2.T1.S3 PRP (the parallel-running sibling item).

## 1. config.ts shape (the only file that changes)

- `MulliganConfig` interface: blocks in order `enabled | rewind | shrink | nudges | audit | log`.
  **No `ui` field exists.** Spec §2 (h2.110) order is `... audit | ui | log`, so `ui` slots in
  BETWEEN `audit` and `log` in the interface, DEFAULT_CONFIG, and validateConfig.
- `DEFAULT_CONFIG`: ends `... audit:{estimateConfidence:"medium"} | log:{file:null}`.
- `validateConfig`: validates each block via `const xRaw = safeGet(raw, "x"); if (isRecord(xRaw)) {...}`.
  The `audit.*` block is immediately followed by the `log.*` block — `ui.*` slots between them.
- Boolean coercion helper: `coerceBoolean(value, fallback)` → `value === undefined ? fallback : !!value`.
  Call sites ALSO guard with `if (v !== undefined)` first (uniform across all booleans).
  **Booleans NEVER warn** (unlike numbers/enums). `null` → `!!null` → `false`.

## 2. The exact pattern to mirror (audit block — closest sibling, a single coerced field)

```ts
// audit.*
const auditRaw = safeGet(raw, "audit");
if (isRecord(auditRaw)) {
  v = safeGet(auditRaw, "estimateConfidence");
  if (v !== undefined) cfg.audit.estimateConfidence = coerceEstimateConfidence(v, cfg.audit.estimateConfidence);
}
```
`ui.*` mirrors this exactly, but uses `coerceBoolean` (no enum helper needed):
```ts
// ui.* (v1.1: active-checkpoint banner; spec/09 §2/§4, spec/13 §5)
const uiRaw = safeGet(raw, "ui");
if (isRecord(uiRaw)) {
  v = safeGet(uiRaw, "activeCheckpointBanner");
  if (v !== undefined) cfg.ui.activeCheckpointBanner = coerceBoolean(v, cfg.ui.activeCheckpointBanner);
}
```

## 3. CRITICAL GOTCHA — two existing tests BREAK (exact-equality literals)

`test/config.test.ts` has TWO `toEqual({...})` literals that enumerate EVERY field. Adding a new
top-level block makes them fail (extra `ui` key on the actual). BOTH must add
`ui: { activeCheckpointBanner: true }` (default value):

1. `describe("DEFAULT_CONFIG") > it("matches the spec/09 §2 defaults exactly")` — the
   `expect(DEFAULT_CONFIG).toEqual({...})` literal. Add `ui: { activeCheckpointBanner: true },`
   BEFORE the `log: { file: null },` line (to match spec order; toEqual is order-independent so
   position is cosmetic, but keep it tidy).
2. `describe("validateConfig") > it("applies a full valid override")` — the `expect(cfg).toEqual({...})`
   literal. The input does NOT set `ui`, so output gets the DEFAULT `true`. RECOMMENDED: also add
   `ui: { activeCheckpointBanner: false }` to the INPUT so this "full override" test actually
   exercises the new knob with a non-default value (otherwise it only tests the default path).

No other test in config.test.ts uses a whole-object literal — the rest assert on individual fields.

## 4. settings.ts needs NO change (confirmed)

`deepMergeSettings` recurses when BOTH sides are `isRecord`:
`out[key] = isRecord(g) && isRecord(p) ? deepMergeSettings(g, p) : p`.
So a project-local `mulligan.ui` deep-merges into a global `mulligan.ui` correctly
(global `ui.activeCheckpointBanner` preserved, project override wins). `loadMulliganConfig` only
extracts the top-level `.mulligan` key and hands raw `unknown` to `validateConfig`. Zero touch.
(test/settings.test.ts already proves 3-level recursion → `mulligan.ui.activeCheckpointBanner`
merge is covered by existing semantics; no new settings test required.)

## 5. Non-record `ui` value is silently ignored (matches established convention)

`validateConfig({ ui: "oops" })` / `{ ui: [1] }` / `{ ui: null }` → `safeGet(raw,"ui")` returns
the value, `isRecord(...)` is false → the `if` block is skipped → `cfg.ui` keeps its cloned
DEFAULT. **No warn** — identical to how `rewind`/`shrink`/`nudges`/`audit`/`log` handle a
non-record sub-object. (Only per-FIELD invalid values warn; a structurally-wrong sub-object is
just ignored, consistent with the whole file.)

## 6. No conflict with the parallel sibling P2.M2.T1.S3

That item edits `test/commands.test.ts` only (the `/mulligan_audit` command tests). It does NOT
touch `src/config.ts`, `src/settings.ts`, or `test/config.test.ts`. The two items are disjoint.
The only shared surface is the test suite as a whole — both must keep `npm test` green.

## 7. banner.ts is already wired (out of scope for S1)

`src/banner.ts` exports a STUB `reconcileBanner(_ctx)` (no-op). `src/commands.ts` already imports
and calls it after checkpoint SET/REVOKE (lines 187, 228). S2 will implement the real
`reconcileBanner`, which will read `getConfig().ui.activeCheckpointBanner` as its gate. **S1 only
adds the knob; it does not touch banner.ts or commands.ts.** This keeps S1 a pure config change.