# P2.M3.T1.S4 Research Notes — Banner + filter-regression tests

## Item
Create `test/banner.test.ts` (NEW) covering all `reconcileBanner` paths, and add a regression
assertion to `test/filter.test.ts` proving the `reconcileBanner(ctx)` tail-hook is UI-only and does
NOT change the filtered message list. Mode A (test-only).

## Verified facts (read from actual source)

### src/banner.ts (the SUT — already implemented by P2.M3.T1.S2)
- Exported: `export function reconcileBanner(ctx: ExtensionContext): void`
- Module-PRIVATE const (NOT exported): `const BANNER_WIDGET_KEY = "mulligan:active-checkpoint";`
  → tests MUST use the string literal `"mulligan:active-checkpoint"` (gotcha).
- 4 branches:
  - (a) `if (!ctx.hasUI) return;` — no-op, NO setWidget call.
  - (b) `if (!config.ui.activeCheckpointBanner) { ctx.ui.setWidget(KEY, undefined); return; }`
        → CLEAR even when checkpoints active (a prior banner must disappear).
  - (c) `names.length === 0` → `ctx.ui.setWidget(KEY, undefined); return;` (CLEAR).
  - (d) ≥1 active → SET `lines` (one per checkpoint) + `{ placement: "aboveEditor" }`.
- Reads config via `getConfig()` from `./config.js`.
- Discovers active checkpoints via `listCheckpoints(ctx.sessionManager.getEntries() as ... as unknown[])`
  — REUSES src/tools/audit.ts (the same pure latest-wins scanner the audit + human command use).
- WHOLE body wrapped in ONE try/catch → NEVER throws (logs `console.warn("[mulligan] banner: …")`).
- Banner line (verbatim — emoji U+26A0 `⚠`, copy byte-for-byte):
  `⚠ Mulligan checkpoint active: "${name}" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke ${name}`

### src/tools/audit.ts — `listCheckpoints(entries: unknown[]): string[]` (L356)
- Scans `type === "label"` entries with a string `label` starting with `"mulligan:checkpoint:"` AND a
  non-empty string `targetId`.
- Two-phase latest-wins: a LATER entry with the SAME `targetId` but a DIFFERENT/undefined `label`
  CLEARs the checkpoint (so a consumed/revoked checkpoint is NOT reported active).
- Returns names (prefix stripped) in FIRST-occurrence order, deduped.
- Hand-roll entry shapes for tests:
  - SET:    `{ type: "label", targetId: "leaf-1", label: "mulligan:checkpoint:before-refactor" }`
  - CLEAR:  a later `{ type: "label", targetId: "leaf-1", label: undefined }`
            (or same targetId re-pointed to a non-checkpoint label)
  - MULTIPLE: two SET entries with DIFFERENT targetIds + different names.

### src/filter.ts — contextHandler tail (S3 wired it; L42 import, L434-446 hook)
- L42: `import { reconcileBanner } from "./banner.js";`
- Tail (right before the return):
  ```ts
  try { reconcileBanner(ctx); } catch { /* E13 — banner failure never breaks a context fire */ }
  return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };
  ```
- CRITICAL for the regression test: `messages` is computed by filterPipeline BEFORE reconcileBanner runs.
  reconcileBanner ONLY calls `ctx.ui.setWidget` — it never touches the `messages` variable. So the
  returned messages array is byte-identical whether or not the banner fires. That is the invariant the
  regression test proves.

### src/config.ts
- `interface MulliganConfig { ... ui: { ... activeCheckpointBanner: boolean; } }` (L129)
- DEFAULT (L176): `ui.activeCheckpointBanner: true`
- `getConfig(): MulliganConfig` (L206), `setConfig(raw): void` (L221), `validateConfig(raw)` (L237).
- `setConfig(undefined)` → resets to DEFAULT_CONFIG (enabled:true; banner:true). This is the reset idiom.
- To disable the banner in a test: `setConfig({ ui: { activeCheckpointBanner: false } })`.
  NOTE: setConfig MERGES onto defaults (Partial deep-merge) — passing only the banner knob leaves
  enabled:true. Verify merge behavior; if setConfig replaces wholesale, pass the full config.

### Test runner / idiom
- Vitest (`npm test` = `vitest run`). No vitest.config (defaults). ESM; `.js` import paths.
- Reset idiom (commands.test.ts): `beforeEach`/`afterEach` → `clearAll()` (runtime.js) + `setConfig(undefined)`.
- hand-rolled fakes; NO `vi.fn` for Pi objects (GOTCHA). `vi.mock` IS idiomatic for internal modules.
- commands.test.ts makeCtx (closest sibling) returns `{ notifies, widgets, ctx }` where:
  - `hasUI: opts.hasUI ?? true`
  - `ui.setWidget(key, content, options?)` pushes `{ key, content, options }` into `widgets[]`
  - `sessionManager`: `getBranch()`, `getEntries()`, `getLabel(id)`, `getLeafId()`, `getSessionId()`,
    `buildContextEntries()`.
- filter.test.ts makeCtx returns ONLY `ctx` (bare — NO hasUI, NO ui by default → reconcileBanner no-ops
  in every existing test, which is why the S3 hook didn't break the suite). It ALSO mocks transforms.js
  (`filterPipeline` returns the module-level `pipelineReturn`), so contextHandler's returned `messages`
  is exactly whatever `pipelineReturn` is set to.

### banner.test.ts design decisions
- Does NOT `vi.mock("../src/banner.js")` — it imports the REAL `reconcileBanner` and asserts on the
  `widgets[]` capture. (Contrast commands.test.ts, which mocks banner + asserts the spy.)
- Uses a makeCtx modeled on commands.test.ts (hasUI + ui.setWidget + sessionManager.getEntries/getLabel
  are the only fields reconcileBanner actually reads; getLeafId is forward-compat/unused).
- No transforms mock needed (never calls contextHandler).

### filter.test.ts regression design
- Non-invasive: the existing makeCtx returns bare ctx (no hasUI/ui). Do NOT change its return shape
  (would touch ~40 call sites). Instead, the NEW regression test builds a LOCAL hand-rolled ctx for the
  hasUI path (mirroring commands.test.ts shape) and uses the existing makeCtx for the control (no-hasUI).
- "identical with or without banner hook" proof: call contextHandler twice with the SAME entries +
  SAME `pipelineReturn` — once hasUI:true (banner fires) and once no-hasUI (banner no-ops) — assert
  `result.messages` deep-equal. Plus assert setWidget DID fire on the hasUI ctx (proving the hook is
  wired) AND JSON.stringify(messages) contains 0 banner bytes (E26 acceptance d).

## Contract test mapping (item's (a)-(f))
- banner.test.ts: (a) SET→setWidget warning+aboveEditor; (b) revoke/consume→setWidget(key,undefined);
  (c) knob=false→setWidget(key,undefined) even when active; (d) hasUI=false→NO setWidget;
  (f) multiple active→multiple lines in content.
- (e) "0 banner bytes in contextHandler return" lives in filter.test.ts (it's about contextHandler's
  message output, not reconcileBanner in isolation). banner.test.ts adds a light (e): reconcileBanner's
  ONLY ctx.ui interaction is setWidget (it never injects messages) + returns void.