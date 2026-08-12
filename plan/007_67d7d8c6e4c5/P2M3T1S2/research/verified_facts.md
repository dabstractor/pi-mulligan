# P2.M3.T1.S2 — Research Notes (verified facts)

Source-of-truth surfaces, verified by direct read against the installed package + repo.

## 1. Pi `setWidget` surface (the core API for this item)

`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`:

```ts
// L43
export type WidgetPlacement = "aboveEditor" | "belowEditor";

// L45-47 (ExtensionWidgetOptions)
export interface ExtensionWidgetOptions {
  placement?: WidgetPlacement; // defaults to "aboveEditor"
}

// L68 — ExtensionUIContext
export interface ExtensionUIContext {
  // ...
  notify(message: string, type?: "info" | "warning" | "error"): void;   // L76
  // ...
  setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;  // L97
  // ...
}

// L215 — on ExtensionContext (base context, shared by handlers + tools)
hasUI: boolean;
// L398 — on ExtensionCommandContext (extends ExtensionContext; command handlers)
hasUI: boolean;
```

**Confirmed call shape for reconcileBanner:**
- SET: `ctx.ui.setWidget("mulligan:active-checkpoint", lines, { placement: "aboveEditor" })`
- CLEAR: `ctx.ui.setWidget("mulligan:active-checkpoint", undefined)`
- `content` is `string[] | undefined` (NOT `string`). `lines` MUST be a `string[]`.

## 2. external_deps.md §2 — setWidget (plan/007.../architecture/external_deps.md)

- L35: `## 2. ctx.ui.setWidget (NEW — v1.1 banner)`
- L39: `setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;` (types.d.ts:97-98)
- L52-53: usage example + clear example (matches spec/13 §5 verbatim).
- **L95 (CRITICAL):** "reconcileBanner(ctx) must accept `ExtensionContext` (not just `ExtensionCommandContext`) because it is called from `contextHandler` (ExtensionContext) and `session_start` handler (same). Since setWidget is on ExtensionUIContext and hasUI is on ExtensionContext, both are available on the base context."
  → The existing stub already types the param `ExtensionContext`. KEEP it (do NOT narrow to `ExtensionCommandContext`).

## 3. `listCheckpoints` — the function to REUSE (src/tools/audit.ts)

```ts
export function listCheckpoints(entries: unknown[]): string[] { ... }
```
- PURE (takes raw `unknown[]`, NOT ctx). Defensive — never throws.
- Scans `type === "label"` entries for the `mulligan:checkpoint:` prefix; TWO-PHASE latest-wins so
  a CLEARED/consumed checkpoint is NOT reported active (mirrors `checkpointExists` in rewind.ts).
- Returns the checkpoint NAMES (prefix stripped), in first-occurrence order (deterministic).
- Call site idiom (audit.ts + commands.ts): `listCheckpoints(ctx.sessionManager.getEntries() as unknown as unknown[])`.
- **This is the spec/13 §5 "active-checkpoint discovery" — do NOT re-scan; REUSE this.**

## 4. `getConfig().ui.activeCheckpointBanner` (src/config.ts — S1, ALREADY APPLIED)

- `MulliganConfig.ui.activeCheckpointBanner: boolean` — required, default `true` (between `audit` and `log`).
- `validateConfig` coerces with `!!` (never warns). Absent → `true`. `null → false`.
- Confirmed present in the current `src/config.ts` (interface + DEFAULT_CONFIG + validateConfig block).

## 5. The verbatim warning line (spec/13 §5; item contract)

```
⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>
```
- One line per active checkpoint. `<name>` substituted (no quotes around the name in the Revoke path).
- The leading `⚠` is the literal U+26A0 character (matches spec + commands.ts fair-warning notify).

## 6. Current consumer + test seam (src/commands.ts, test/commands.test.ts)

- `commands.ts` imports `{ reconcileBanner } from "./banner.js"` and calls it ONLY after a successful
  checkpoint SET (makeCheckpointCommand) or REVOKE (makeCheckpointRevokeCommand).
- `test/commands.test.ts` does `vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() }))` and
  asserts the SPY `vi.mocked(reconcileBanner)` — it NEVER asserts on `setWidget`/widgets
  (GOTCHA #1 in that file). → **Implementing the real reconcileBanner in banner.ts does NOT change
  commands.test.ts behavior** (the mock replaces the export). The existing suite stays green.
- fakeCtx builder pattern (test/commands.test.ts ~L108-140): `makeFakeCtx({ hasUI, entries })` with
  `ui.setWidget(key, content, options)` capturing into a `widgets` map, `hasUI` opt, `sessionManager.getEntries()`.
  → Reuse this EXACT shape for the S2 scratch verification.

## 7. Logging convention on failure

- `config.ts warnConfig` (current) uses `console.warn(\`[mulligan] config: ...\`)` wrapped so it never throws.
- Comment notes the structured JSONL logger (log.ts) is a future re-point; for now console.warn is the norm.
- → reconcileBanner's "logged + swallowed" requirement = `console.warn("[mulligan] banner: ...")` inside
  its own try/catch (logging itself must not crash). Matches warnConfig idiom.

## 8. ESM import convention

- All cross-module imports use the `.js` extension (ESM/Bundler resolution; audit.ts GOTCHA #3).
  → `import { getConfig } from "./config.js"`; `import { listCheckpoints } from "./tools/audit.js"`.

## 9. Scope boundary with sibling items

- S1 (config knob) — DONE (ui block present in config.ts).
- **S2 (this item)** — implements `reconcileBanner` in `src/banner.ts`. Production code only.
- S3 (hooks) — wires reconcileBanner into contextHandler tail + session_start. OUT OF SCOPE here.
- S4 (tests) — "Tests for the banner + filter regression". OWNS the committed test file(s).
  → S2 must NOT commit `test/banner.test.ts` (conflicts with S4). Use a THROWAWAY scratch verification.