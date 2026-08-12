name: "P2.M3.T1.S2 — src/banner.ts: reconcileBanner(ctx) helper"
description: |
  Implement the real `reconcileBanner(ctx: ExtensionContext): void` in `src/banner.ts` (replacing the current
  STUB no-op). It is the SINGLE writer of the `mulligan:active-checkpoint` above-editor widget key: it SETS the
  widget (one warning line per active checkpoint) when ≥1 checkpoint is active AND `config.ui.activeCheckpointBanner`
  is true, and CLEARS it (`setWidget(key, undefined)`) otherwise — including the disabled-knob case (clear even if
  checkpoints are active) and the no-active-checkpoints case. Discovery REUSES the existing pure `listCheckpoints`
  export from `src/tools/audit.ts`; the config knob REUSES `getConfig()` from `src/config.ts` (the `ui` block is
  already shipped by P2.M3.T1.S1). The WHOLE body is wrapped in one try/catch — it NEVER throws (a `setWidget`
  failure is logged via `console.warn("[mulligan] banner: …")` and swallowed). Every `ctx.ui.*` call is guarded
  by `ctx.hasUI` (no-op in print/JSON/rpc-without-ui). The param stays typed `ExtensionContext` (the minimal
  interface) so it is callable from BOTH command handlers and event handlers (S3 hooks). Mode A documentation:
  JSDoc cites spec/13 §5 + spec/08 E26 and rides with the code. Production code ONLY — the committed test file
  is owned by P2.M3.T1.S4; S2 self-validates with a throwaway scratch verification.

---

## Goal

**Feature Goal**: Replace the `reconcileBanner` STUB in `src/banner.ts` with the real implementation that keeps
the above-prompt-box banner in sync with active-checkpoint state: visible while ≥1 user-set checkpoint is active
(and the knob is on), cleared otherwise. This is the mechanism half of spec/13 §5 / E26; the *refresh-point*
wiring (command handlers already call it; contextHandler tail + session_start come in S3) is separate.

**Deliverable**: One edited file — `src/banner.ts` — exporting the real `reconcileBanner(ctx: ExtensionContext): void`.
No new files, no other production-code edits. The function is the SINGLE writer of the
`"mulligan:active-checkpoint"` widget key.

**Success Definition**: `npm run typecheck` clean; the function compiles against the real Pi `setWidget`
signature (`content: string[] | undefined`); the 4 branches behave exactly as specified (no-UI no-op,
knob-off→clear, no-active→clear, ≥1-active→set-with-aboveEditor); `npm test` stays green (the existing
`commands.test.ts` mocks `../src/banner.js`, so it is unaffected). The committed unit-test file is deferred to
S4 — S2 self-validates with a throwaway scratch script (provided below) that is run and discarded.

## User Persona (if applicable)

**Target User**: the operator who has armed a `/mulligan_checkpoint` (destructive cross-prompt rewind power) and,
turns later, is at risk of forgetting it is armed.

**Use Case**: After `/mulligan_checkpoint refactor-x`, a persistent banner renders above the prompt box on every
turn reminding them the agent may rewind across their subsequent prompts, with the revoke command inline. When
they `/mulligan_checkpoint_revoke refactor-x` (or the checkpoint is consumed by a rewind), the banner clears.

**User Journey**: set checkpoint → banner appears (S3 refreshes it; the command handler already calls
reconcileBanner) → banner persists across turns (S3's context-fire defense-in-depth keeps it fresh) →
revoke/consume → banner clears.

**Pain Points Addressed**: a checkpoint grants destructive power for its whole lifetime; a one-time set-time
warning is insufficient. The persistent banner (E26) is the antidote — it stays visible until cleared.

## Why

- **Spec compliance (spec/13 §5 mechanism; spec/08 E26; the item contract §3)**: the merged PRD mandates a
  persistent `placement:"aboveEditor"` widget via `ctx.ui.setWidget`, cleared when no checkpoint is active.
  This item ships the `reconcileBanner` function that performs exactly that set/clear.
- **Disablable without disabling checkpoints (spec/09 §3 rationale)**: the function reads `config.ui.activeCheckpointBanner`
  and CLEARs the widget when it is false (even if checkpoints are active) — so an operator can silence the banner
  on a small terminal without losing the safety net.
- **Single writer invariant**: only `reconcileBanner` writes the `mulligan:active-checkpoint` key. Command
  handlers (already wired) and S3's hooks all funnel through it, so there is one place to reason about widget state.
- **Why a widget and not `ctx.ui.notify` (spec/13 §5)**: `notify` is a transient toast; a widget with
  `placement:"aboveEditor"` persists until explicitly cleared — which is the requirement.

## What

User-visible behavior (in TUI/RPC): while ≥1 active checkpoint exists and the knob is on, a banner renders above
the prompt box with one line per active checkpoint (the verbatim spec/13 §5 warning); otherwise no banner.
In print/JSON/rpc-without-ui modes: no-op (`ctx.hasUI` is false). Technical: a synchronous, never-throwing
function that takes `ExtensionContext`, reads config + scans entries, and calls `ctx.ui.setWidget`.

### Success Criteria

- [ ] `reconcileBanner(ctx)` is exported from `src/banner.ts` with signature `(ctx: ExtensionContext): void`.
- [ ] `ctx.hasUI === false` → returns immediately, NEVER calls `ctx.ui.*` (no-op in print/JSON/rpc-without-ui).
- [ ] `config.ui.activeCheckpointBanner === false` → `ctx.ui.setWidget("mulligan:active-checkpoint", undefined)` then
      return — CLEARS even if checkpoints are active (so disabling the knob removes a previously-shown banner).
- [ ] 0 active checkpoints → `ctx.ui.setWidget("mulligan:active-checkpoint", undefined)` then return.
- [ ] ≥1 active checkpoint (knob on) → `ctx.ui.setWidget("mulligan:active-checkpoint", lines, { placement: "aboveEditor" })`
      where `lines` has ONE entry per active checkpoint, each the VERBATIM spec/13 §5 line with `<name>` substituted.
- [ ] The body is wrapped in ONE try/catch; it NEVER throws; a `setWidget`/`getEntries`/config failure is
      `console.warn("[mulligan] banner: …")`-logged and swallowed.
- [ ] `reconcileBanner` is the ONLY writer of the `"mulligan:active-checkpoint"` widget key.
- [ ] `src/banner.ts` uses ESM `.js` imports for `./config.js` and `./tools/audit.js`; `listCheckpoints` is REUSED
      from `src/tools/audit.ts` (no re-scan of entries).
- [ ] JSDoc cites spec/13 §5 + spec/08 E26 (Mode A — rides with the code).
- [ ] `npm run typecheck` clean; `npm test` green (existing suite unaffected — `commands.test.ts` mocks banner).
- [ ] NO committed test file added (test/banner.test.ts is owned by S4). S2 self-validates with the throwaway scratch script below.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, they would need: the exact `setWidget` signature (provided verbatim
below from types.d.ts:97-98), the `listCheckpoints` reuse contract (pure, takes `unknown[]`, returns active
names), the confirmation that the `ui.activeCheckpointBanner` knob already exists in config.ts (S1 shipped), the
verbatim warning line, the existing consumer (commands.ts) + its test mock (so they know the suite won't break),
and the throwaway-validation approach (since S4 owns the committed tests). All inline. No external library docs
beyond the Pi types (already vendored) are required — this is ~25 lines of defensive glue.

### Documentation & References

```yaml
# MUST READ — the spec anchors + the Pi surface this item builds on.
- url: plan/007_67d7d8c6e4c5/architecture/external_deps.md  (heading "## 2. ctx.ui.setWidget (NEW — v1.1 banner)")
  why: "Documents setWidget + the CRITICAL note (L95) that reconcileBanner MUST accept ExtensionContext
        (not ExtensionCommandContext) because S3 calls it from contextHandler/session_start (ExtensionContext).
        The existing stub already uses ExtensionContext — KEEP it."
  critical: "content is string[] | undefined (NOT string). placement defaults to 'aboveEditor' but pass it
             explicitly per spec/13 §5. setWidget + hasUI are both on the base ExtensionContext."

- url: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts  (lines 43, 68-97, 215)
  why: "The authoritative surface. WidgetPlacement (L43), ExtensionWidgetOptions.placement (L45-47),
        ExtensionUIContext.setWidget (L97) + notify (L76), ExtensionContext.hasUI (L215)."
  critical: "setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void.
             Passing a string instead of string[] is a type error under tsc. undefined clears the widget."

# PRODUCTION CODE TO EDIT — the stub to replace.
- file: src/banner.ts
  why: "THE file. Replace the STUB `reconcileBanner(_ctx)` with the real implementation. Keep the
        `import type { ExtensionContext }`. Add `import { getConfig } from './config.js'` and
        `import { listCheckpoints } from './tools/audit.js'`. Rewrite the JSDoc to cite spec/13 §5 + E26."
  pattern: "Match the codebase's defensive convention: whole-body try/catch, never throws, console.warn('[mulligan] …')
            on failure (mirror config.ts warnConfig), ESM .js imports. See 'Implementation Patterns' for the verbatim body."
  gotcha: "The existing stub's JSDoc says 'implemented in P2.M3.T1.S2' — that is THIS task. Rewrite it as a real
           contract JSDoc (do not leave the STUB note). Remove the `_` prefix from `_ctx` (the param is now used)."

# REUSED EXPORT — do NOT re-scan entries; call this.
- file: src/tools/audit.ts  (export function listCheckpoints)
  why: "listCheckpoints(entries: unknown[]): string[] — PURE, defensive (never throws), two-phase latest-wins so
        a CLEARED/CONSUMED checkpoint is NOT reported active (mirrors checkpointExists in rewind.ts). Returns the
        checkpoint NAMES (the 'mulligan:checkpoint:' prefix stripped) in first-occurrence order (deterministic).
        This IS the spec/13 §5 'active-checkpoint discovery'."
  pattern: "Call site idiom (used identically by audit.ts auditExecute + commands.ts makeAuditCommand):
        listCheckpoints(ctx.sessionManager.getEntries() as unknown as unknown[]). Copy that cast verbatim."
  gotcha: "readMarkers (filter.ts) does NOT return checkpoints — it scans type==='custom'; checkpoints are
           type==='label'. listCheckpoints is the correct, already-built scanner. Reusing it is REQUIRED by the
           contract (REUSE IT) and avoids a divergent second scanner."

# THE CONFIG KNOB — already shipped by S1 (present in current config.ts).
- file: src/config.ts  (MulliganConfig.ui.activeCheckpointBanner)
  why: "getConfig() returns MulliganConfig; .ui.activeCheckpointBanner is a required boolean, default true,
        coerced with !! (never warns; absent→true; null→false). S1 already added the interface field,
        DEFAULT_CONFIG entry, and validateConfig block. CONFIRM present (it is) — do NOT re-add it."
  pattern: "const config = getConfig(); if (!config.ui.activeCheckpointBanner) { … clear … return; }"
  gotcha: "getConfig() returns a fresh structuredClone each call (cheap; ~10 fields). Treat as read-only."

# THE EXISTING CONSUMER + its test mock (so you know the suite stays green).
- file: src/commands.ts
  why: "makeCheckpointCommand + makeCheckpointRevokeCommand already import { reconcileBanner } from './banner.js'
        and call reconcileBanner(ctx) ONLY after a successful checkpoint SET / REVOKE. This item just makes that
        call DO something real. commands.ts is UNCHANGED by S2."
  pattern: "No change. (The consumer wiring is already correct; S2 only fills in the callee body.)"
- file: test/commands.test.ts
  why: "Does vi.mock('../src/banner.js', () => ({ reconcileBanner: vi.fn() })) and asserts the SPY
        vi.mocked(reconcileBanner) — it NEVER asserts on setWidget/widgets (GOTCHA #1 in that file)."
  pattern: "No change. CRITICAL: because the mock REPLACES the export, implementing the real reconcileBanner does
        NOT change commands.test.ts behavior. The existing suite stays green — do not 'fix' anything there."
  gotcha: "The fakeCtx builder in test/commands.test.ts (~L108-140) is the template for the throwaway scratch
           verification: it has hasUI, ui.setWidget(key,content,options) capturing into a widgets map, and
           sessionManager.getEntries(). Mirror it for the S2 scratch script (below)."
```

### Current Codebase tree (the files this item touches)

```bash
src/banner.ts          # EDIT — replace STUB reconcileBanner with the real implementation (+ real imports + JSDoc)
src/tools/audit.ts     # NO CHANGE — REUSE its listCheckpoints export
src/config.ts          # NO CHANGE — S1 already shipped ui.activeCheckpointBanner (read via getConfig)
src/commands.ts        # NO CHANGE — already imports + calls reconcileBanner(ctx) on SET/REVOKE
src/index.ts           # NO CHANGE — S3 wires the contextHandler/session_start hooks
# Out of scope (S3 owns hooks; S4 owns the committed test file):
src/filter.ts          # NO CHANGE — S3 adds the contextHandler-tail reconcileBanner call
test/banner.test.ts    # DO NOT CREATE — S4 owns the committed banner test suite
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/banner.ts          # MODIFIED — real reconcileBanner(ctx: ExtensionContext): void (the widget reconciler)
# (NO new files. Mode A: JSDoc is the only doc artifact. Throwaway scratch verification is NOT committed.)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — setWidget's `content` param is `string[] | undefined`, NOT `string`. Under this repo's strict
// tsc (tsconfig has strict + the Pi types are real), passing a single string is a COMPILE ERROR. Build `lines`
// as a string[] (names.map(name => theLine)). To CLEAR, pass `undefined` (a bare `setWidget(key)` with no 2nd
// arg is also typed-OK because the param is optional-ish via `| undefined`, but be EXPLICIT: setWidget(KEY, undefined)).

// CRITICAL — the WHOLE body is wrapped in ONE try/catch and NEVER throws (the item contract §3 + the codebase's
// shared "never throw on the hot path" convention; reconcileBanner is called from command handlers AND, after S3,
// every context fire). A throwing ctx.hasUI (Proxy trap), getEntries(), getConfig(), or setWidget() is caught,
// logged via console.warn("[mulligan] banner: …"), and swallowed. Logging is ITSELF wrapped so a throwing
// console never re-throws (mirror config.ts warnConfig's safeStringify + bare-catch).

// CRITICAL — reconcileBanner is the SINGLE writer of the "mulligan:active-checkpoint" widget key. No other code
// may setWidget that key. (commands.ts/S3-hooks all CALL reconcileBanner; none call setWidget directly.) Do not
// introduce a second writer.

// GOTCHA — keep the param typed `ExtensionContext` (the BASE interface), NOT ExtensionCommandContext. external_deps.md
// §2 L95: S3 calls reconcileBanner from contextHandler + session_start, which receive ExtensionContext. The existing
// stub already uses ExtensionContext — KEEP it. setWidget (ExtensionUIContext) and hasUI are both on the base context.

// GOTCHA — when the knob is OFF, you must STILL call setWidget(KEY, undefined) (clear), because a banner shown on a
// PREVIOUS turn (knob was on) must disappear the moment the user disables it. "clear even if checkpoints active"
// (item contract §3 step b). Same for the 0-active-checkpoints branch (a previously-active checkpoint was just
// revoked/consumed → clear).

// GOTCHA — listCheckpoints is PURE and takes the raw entries array, NOT ctx. The established call-site cast is
// `ctx.sessionManager.getEntries() as unknown as unknown[]` (SessionEntry[] is not directly assignable to unknown[]
// under tsc without the cast — used verbatim by audit.ts + commands.ts). Copy it exactly.

// GOTCHA — ESM/Bundler resolution: cross-module imports MUST use the `.js` extension even for `.ts` source
// (audit.ts GOTCHA #3 applies repo-wide). So `import { getConfig } from "./config.js"` and
// `import { listCheckpoints } from "./tools/audit.js"`. The `import type { ExtensionContext }` stays extension-less
// (it is a type-only import from the @earendil-works package).

// GOTCHA — getConfig() returns a fresh structuredClone every call (cheap; ~10 fields). It is fine to call it once
// per reconcileBanner invocation. Treat the result as read-only.

// GOTCHA — the verbatim warning line uses the literal U+26A0 (⚠) warning character (matches spec/13 §5 + the
// commands.ts fair-warning notify). Copy it byte-for-byte; the only substitution is <name> → the checkpoint name
// (twice: once in the quoted header, once in the Revoke path). Do NOT add quotes around the name in the Revoke path.

// GOTCHA — do NOT commit test/banner.test.ts. P2.M3.T1.S4 ("Tests for the banner + filter regression") owns the
// committed banner test suite. S2 self-validates with the throwaway scratch script in the Validation Loop (run,
// confirm, delete). Committing a test file here would conflict with S4.
```

## Implementation Blueprint

### Data models and structure

No new data models. The only constant introduced is the widget key (module-local):

```typescript
/** The stable widget key reconcileBanner owns (the SINGLE writer). spec/13 §5. */
const BANNER_WIDGET_KEY = "mulligan:active-checkpoint";
```

`reconcileBanner` is a leaf function: it reads config (`getConfig`), reads session entries
(`ctx.sessionManager.getEntries()` → `listCheckpoints`), and writes UI (`ctx.ui.setWidget`). It persists
nothing and injects nothing into `event.messages` (zero model-context cost — UI-only, E26 acceptance (d)).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/banner.ts — replace the STUB imports + body with the real implementation
  - FILE: src/banner.ts
  - REMOVE: the STUB body `export function reconcileBanner(_ctx: ExtensionContext): void { /* STUB … */ }`
            and the STUB JSDoc block above it (the one that says "implemented in P2.M3.T1.S2").
  - KEEP: `import type { ExtensionContext } from "@earendil-works/pi-coding-agent";` (the type-only import; the
          function param stays ExtensionContext — the MINIMAL interface, per external_deps.md §2 L95).
  - ADD: `import { getConfig } from "./config.js";`
  - ADD: `import { listCheckpoints } from "./tools/audit.js";`   # REUSE — do NOT re-scan entries
  - ADD: `const BANNER_WIDGET_KEY = "mulligan:active-checkpoint";`  # module-local; single-writer invariant
  - IMPLEMENT: the real `reconcileBanner(ctx: ExtensionContext): void` — whole body in ONE try/catch, branches
        (a) !ctx.hasUI → return; (b) knob off → setWidget(KEY, undefined) + return;
        (c) names = listCheckpoints(getEntries cast); (d) names.length===0 → setWidget(KEY, undefined) + return;
        (e) lines = names.map(verbatimLine); (f) setWidget(KEY, lines, { placement: "aboveEditor" }).
        catch → console.warn("[mulligan] banner: …") wrapped so logging never re-throws.
  - FOLLOW pattern: the verbatim body in "Implementation Patterns" below (it is complete + copy-pasteable).
  - NAMING: function `reconcileBanner`; constant `BANNER_WIDGET_KEY` (module-local, NOT exported). Param `ctx`
        (drop the STUB's `_` underscore — it is now used).
  - GOTCHA: the disabled-knob branch (b) MUST clear (setWidget(KEY, undefined)) before returning — do NOT just
        `return` with the widget possibly still shown from a prior turn.

Task 2: EDIT src/banner.ts — write the real contract JSDoc (Mode A — rides with the code)
  - FILE: src/banner.ts (immediately above `export function reconcileBanner`)
  - IMPLEMENT: a /** */ block that (i) states the purpose in one line; (ii) describes the 4 branches; (iii) cites
        spec/13 §5 + spec/08 E26; (iv) notes it is the SINGLE writer of the key and is guarded by ctx.hasUI and
        config.ui.activeCheckpointBanner; (v) notes the whole-body try/catch (never throws); (vi) @param ctx.
  - FOLLOW pattern: the JSDoc style of src/tools/audit.ts / src/commands.ts (dense, spec-citing, gotcha-flagging).
  - See "Implementation Patterns" for the verbatim JSDoc.
  - GOTCHA: this is the ONLY doc artifact for S2 (Mode A). README sweep is P3 (Mode B, out of scope here).

Task 3: VERIFY — typecheck + existing suite + throwaway scratch validation
  - RUN: npm run typecheck   # tsc --noEmit — expect clean. A type error almost always means `content` was passed
         as a string instead of string[], OR the getEntries() cast was omitted, OR the param was narrowed to
         ExtensionCommandContext. Fix the code, not the types.
  - RUN: npm test            # full vitest suite — expect green. commands.test.ts mocks ../src/banner.js, so the
         real implementation is NOT exercised there; nothing should change. (If a test fails, it is almost
         certainly unrelated churn from the parallel S1/S3 items — re-run after they land.)
  - RUN: the throwaway scratch verification script (Validation Loop Level 2) — exercise all 4 branches + the
         never-throws property, confirm output, then DELETE it (S4 owns the committed test file).
```

### Implementation Patterns & Key Details

```typescript
// ── src/banner.ts — the COMPLETE real file (copy-pasteable; replaces the STUB wholesale) ──────────
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { listCheckpoints } from "./tools/audit.js";

/** The stable widget key `reconcileBanner` owns. It is the SINGLE writer of this key (spec/13 §5):
 *  no other code may `ctx.ui.setWidget` this key. */
const BANNER_WIDGET_KEY = "mulligan:active-checkpoint";

/**
 * reconcileBanner — refresh the active-checkpoint banner so it reflects the CURRENT active-checkpoint state
 * (spec/13 §5; spec/08 E26). It is the SINGLE writer of the `mulligan:active-checkpoint` above-editor widget.
 *
 * Behavior (4 branches):
 *   (a) `!ctx.hasUI` → no-op (return). The banner is a TUI/RPC surface; in print/JSON/rpc-without-ui there is
 *       no UI to render it. (Guarded like every `ctx.ui.*` call in the codebase.)
 *   (b) `!config.ui.activeCheckpointBanner` → CLEAR (`setWidget(KEY, undefined)`) then return. Disabling the
 *       knob removes a banner shown on a PRIOR turn even if checkpoints are still active (spec/09 §3:
 *       "Disablable without disabling checkpoints"). Must clear (not just skip) so a prior banner disappears.
 *   (c) 0 active checkpoints → CLEAR then return (a checkpoint was just revoked or consumed by a rewind).
 *   (d) ≥1 active checkpoint → SET: one spec/13 §5 warning line per active checkpoint, `placement:"aboveEditor"`.
 *
 * Active-checkpoint discovery REUSES `listCheckpoints` (src/tools/audit.ts) — the same pure, two-phase
 * latest-wins scanner the audit + human /mulligan_audit command use (mirrors `checkpointExists` in rewind.ts),
 * so a CLEARED/CONSUMED checkpoint is never reported active. Never re-scan entries here.
 *
 * The WHOLE body is wrapped in ONE try/catch: this function NEVER throws. It is called from command handlers
 * (commands.ts: after checkpoint SET/REVOKE) and, after S3, from the contextHandler tail + session_start —
 * i.e. potentially every inference. A throwing `ctx.hasUI`/`getEntries`/`getConfig`/`setWidget` (e.g. a Proxy
 * trap) is logged via `console.warn("[mulligan] banner: …")` and swallowed. The log itself is wrapped so a
 * throwing `console` cannot re-throw (mirrors config.ts `warnConfig`).
 *
 * The banner is UI-ONLY: it is NEVER injected into `event.messages` (zero model-context cost — E26 acceptance (d)).
 * The param is typed `ExtensionContext` (the minimal interface) so this one function is callable from BOTH
 * command handlers (ExtensionCommandContext) and event handlers (ExtensionContext) — external_deps.md §2.
 *
 * @param ctx the Pi ExtensionContext (hasUI + ui.setWidget + sessionManager.getEntries are all on the base ctx)
 */
export function reconcileBanner(ctx: ExtensionContext): void {
  try {
    // (a) No UI surface → nothing to render (no-op in print/JSON/rpc-without-ui).
    if (!ctx.hasUI) return;

    // (b) Knob off → CLEAR even if checkpoints are active (a prior-turn banner must disappear).
    const config = getConfig();
    if (!config.ui.activeCheckpointBanner) {
      ctx.ui.setWidget(BANNER_WIDGET_KEY, undefined);
      return;
    }

    // Active-checkpoint discovery: REUSE listCheckpoints (pure, two-phase latest-wins — never reports a
    // cleared/consumed checkpoint as active). The cast is the established call-site idiom (audit.ts/commands.ts).
    const names = listCheckpoints(ctx.sessionManager.getEntries() as unknown as unknown[]);

    // (c) No active checkpoints → CLEAR.
    if (names.length === 0) {
      ctx.ui.setWidget(BANNER_WIDGET_KEY, undefined);
      return;
    }

    // (d) ≥1 active → SET one spec/13 §5 line per checkpoint (verbatim; <name> substituted, no Revoke-path quotes).
    const lines = names.map(
      (name) =>
        `⚠ Mulligan checkpoint active: "${name}" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke ${name}`,
    );
    ctx.ui.setWidget(BANNER_WIDGET_KEY, lines, { placement: "aboveEditor" });
  } catch (e) {
    // Never throw on the hot path. Log + swallow (mirror config.ts warnConfig; logging itself must not crash).
    try {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(`[mulligan] banner: failed to reconcile: ${reason}`);
    } catch {
      /* a throwing console must not re-throw */
    }
  }
}
```

### Integration Points

```yaml
CONFIG (src/config.ts): NO CHANGE
  - config.ui.activeCheckpointBanner (boolean, default true) is ALREADY shipped by P2.M3.T1.S1.
    reconcileBanner reads it via getConfig(). Do NOT touch config.ts.

SESSION (read-only via ctx.sessionManager): NO CHANGE
  - reconcileBanner reads ctx.sessionManager.getEntries() (read-only) and hands the array to listCheckpoints.
    It writes NOTHING to the session tree (no setLabel/appendEntry/navigateTree). C1/C3 respected.

UI (ctx.ui.setWidget): NEW writes — the only setWidget calls for this key in the whole codebase
  - SET:   ctx.ui.setWidget("mulligan:active-checkpoint", string[], { placement: "aboveEditor" })
  - CLEAR: ctx.ui.setWidget("mulligan:active-checkpoint", undefined)
  - reconcileBanner is the SINGLE writer of this key.

DOWNSTREAM CONSUMERS (out of scope — DO NOT wire in S2):
  - src/commands.ts: ALREADY calls reconcileBanner(ctx) after a successful checkpoint SET/REVOKE (P2.M1.T1.S1).
    S2 only makes that call do real work — commands.ts is UNCHANGED.
  - src/filter.ts contextHandler tail + session_start handler: P2.M3.T1.S3 adds those reconcileBanner calls.
  - Committed banner tests: P2.M3.T1.S4. S2 must NOT create test/banner.test.ts.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (banner.ts flows through tsc against the real Pi types).
npm run typecheck          # tsc --noEmit — expect: zero errors.
# If a type error appears in src/banner.ts, the two most likely causes:
#   1. `content` passed as a string instead of string[] (setWidget wants string[] | undefined) → build lines via names.map.
#   2. ctx.sessionManager.getEntries() not cast to unknown[] → listCheckpoints wants unknown[]; add the verbatim cast.
#   3. param narrowed to ExtensionCommandContext → keep it ExtensionContext (external_deps.md §2 L95).
```

### Level 2: Unit / Scratch Validation (Component Validation)

The committed banner test suite is owned by P2.M3.T1.S4 — DO NOT create `test/banner.test.ts`. Instead,
self-validate with a THROWAWAY script: create `/tmp/banner-scratch.mts`, run it with vitest's node loader
(or `npx tsx`), confirm the output matches the expectations below, then DELETE it.

```typescript
// /tmp/banner-scratch.mts  — THROWAWAY. Run: npx tsx /tmp/banner-scratch.mts  (then delete; S4 owns the committed test)
import { setConfig } from "/home/dustin/projects/pi-mulligan/src/config.ts";
import { reconcileBanner } from "/home/dustin/projects/pi-mulligan/src/banner.ts";

setConfig(undefined); // reset to defaults (knob ON)

// Minimal fakeCtx mirroring test/commands.test.ts makeFakeCtx (~L108-140).
function makeCtx({ hasUI, entries }: { hasUI: boolean; entries: unknown[] }) {
  const widgets = new Map<string, unknown>();
  return {
    hasUI,
    ui: { setWidget: (key: string, content: unknown, opts?: unknown) => widgets.set(key, { content, opts }) },
    sessionManager: { getEntries: () => entries },
    widgets, // for assertions
  } as any;
}
const labelEntry = (targetId: string, label: unknown) => ({ type: "label", targetId, label });
const LINE = (n: string) =>
  `⚠ Mulligan checkpoint active: "${n}" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke ${n}`;

// (a) !hasUI → no-op, setWidget NEVER called.
{ const c = makeCtx({ hasUI: false, entries: [] }); reconcileBanner(c); console.log("a", c.widgets.size === 0 ? "PASS" : "FAIL"); }

// (b) knob OFF → clears even with an active checkpoint.
{ setConfig({ ui: { activeCheckpointBanner: false } }); const c = makeCtx({ hasUI: true, entries: [labelEntry("e1", "mulligan:checkpoint:x")] }); reconcileBanner(c);
  console.log("b", c.widgets.get("mulligan:active-checkpoint")?.content === undefined ? "PASS" : "FAIL"); setConfig(undefined); }

// (c) 0 active → clears.
{ const c = makeCtx({ hasUI: true, entries: [] }); reconcileBanner(c);
  console.log("c", c.widgets.get("mulligan:active-checkpoint")?.content === undefined ? "PASS" : "FAIL"); }

// (d) ≥1 active → SET with verbatim lines + aboveEditor.
{ const c = makeCtx({ hasUI: true, entries: [labelEntry("e1", "mulligan:checkpoint:refactor-x"), labelEntry("e2", "mulligan:checkpoint:pre-demo")] });
  reconcileBanner(c); const w = c.widgets.get("mulligan:active-checkpoint");
  console.log("d", Array.isArray(w?.content) && (w.content as string[]).join("|") === [LINE("refactor-x"), LINE("pre-demo")].join("|") && w?.opts?.placement === "aboveEditor" ? "PASS" : "FAIL", JSON.stringify(w?.content)); }

// (d') consumed/cleared checkpoint NOT reported active (listCheckpoints two-phase): SET then CLEAR same targetId.
{ const c = makeCtx({ hasUI: true, entries: [labelEntry("e1", "mulligan:checkpoint:gone"), labelEntry("e1", undefined)] });
  reconcileBanner(c); const w = c.widgets.get("mulligan:active-checkpoint");
  console.log("d'", w?.content === undefined ? "PASS" : "FAIL"); }

// never-throws: a throwing setWidget is swallowed (no exception escapes).
{ const c = { hasUI: true, ui: { setWidget: () => { throw new Error("boom"); } }, sessionManager: { getEntries: () => [] } } as any;
  let threw = false; try { reconcileBanner(c); } catch { threw = true; } console.log("never-throws", threw ? "FAIL" : "PASS"); }
```

```bash
# Run the throwaway, confirm all branches print PASS, then delete it.
npx tsx /tmp/banner-scratch.mts        # expect: a PASS / b PASS / c PASS / d PASS … / d' PASS / never-throws PASS
rm /tmp/banner-scratch.mts             # DO NOT commit — S4 owns test/banner.test.ts
```

### Level 3: Integration Testing (System Validation)

```bash
# Full vitest suite — confirm the real implementation does NOT perturb any existing test.
npm test                # = vitest run — expect green.
# Rationale: test/commands.test.ts does vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() })), so the
# real body is NEVER executed by that file — its assertions target the SPY, not setWidget. The real reconcileBanner
# therefore cannot break commands.test.ts. (If a failure appears, it is almost certainly parallel-item churn from
# S1/S3 — re-run once those land; it is not caused by banner.ts.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# None beyond Level 2's branch matrix. The function is pure glue: config read + entries scan + setWidget.
# The E26 acceptance criteria (banner persists across turns; clears on revoke/consume within one fire; restored
# on /resume; never enters event.messages) are EXERCISED by S3 (the refresh-point wiring) + S4 (the test suite),
# not by S2 in isolation. S2's job is to make reconcileBanner correct in isolation (Level 2 covers it).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (no `any` needed; `content` is `string[]`, param is `ExtensionContext`).
- [ ] `npm test` green (existing suite unaffected — commands.test.ts mocks banner).
- [ ] Level 2 scratch script: all 6 checks (a, b, c, d, d', never-throws) print PASS, then the script is deleted.

### Feature Validation (the spec/13 §5 / E26 mechanism contract)

- [ ] `!ctx.hasUI` → returns without calling any `ctx.ui.*`.
- [ ] knob OFF → `setWidget("mulligan:active-checkpoint", undefined)` (clears even with active checkpoints).
- [ ] 0 active checkpoints → `setWidget("mulligan:active-checkpoint", undefined)`.
- [ ] ≥1 active checkpoint → `setWidget(key, lines, { placement: "aboveEditor" })` with one VERBATIM spec/13 §5
      line per checkpoint, `<name>` substituted (quoted in the header, unquoted in the Revoke path).
- [ ] A CLEARED/CONSUMED checkpoint (set-then-cleared on the same targetId) is NOT reported active
      (listCheckpoints two-phase latest-wins).
- [ ] A throwing `setWidget`/`getEntries`/`hasUI` is caught + logged + swallowed (never throws).
- [ ] reconcileBanner is the ONLY writer of the `mulligan:active-checkpoint` key.

### Code Quality Validation

- [ ] `listCheckpoints` is REUSED from `src/tools/audit.ts` (no divergent second scanner).
- [ ] `getConfig` is REUSED from `src/config.ts` (no config re-read logic).
- [ ] ESM `.js` imports for `./config.js` and `./tools/audit.js`; type-only `ExtensionContext` import stays extension-less.
- [ ] Whole body in ONE try/catch; logging itself wrapped (never re-throws). Matches config.ts `warnConfig` idiom.
- [ ] Param typed `ExtensionContext` (NOT narrowed) — callable from command handlers AND S3's event-handler hooks.
- [ ] The STUB's `_ctx` underscore is dropped (param is now used); the STUB JSDoc is replaced with the real contract JSDoc.

### Documentation & Deployment

- [ ] JSDoc on `reconcileBanner` cites spec/13 §5 + spec/08 E26, lists the 4 branches, notes the single-writer
      invariant, the hasUI guard, and the whole-body try/catch (Mode A — rides with the code).
- [ ] No new environment variables (the knob is a settings.json field, owned by S1).
- [ ] NO committed test file (test/banner.test.ts is S4); the scratch script was deleted.

---

## Anti-Patterns to Avoid

- ❌ Don't re-scan `getEntries()` for `mulligan:checkpoint:` labels yourself — REUSE `listCheckpoints`. A hand-rolled
  scan would miss the two-phase latest-wins logic and report CLEARED/CONSUMED checkpoints as active (validation bug).
- ❌ Don't pass a `string` to `setWidget` — `content` is `string[] | undefined`. Build `lines` via `names.map(...)`.
- ❌ Don't `return` early on the knob-off / zero-checkpoint branches WITHOUT calling `setWidget(KEY, undefined)` —
  a banner shown on a prior turn would persist. Always CLEAR before returning in those branches.
- ❌ Don't wrap only the `setWidget` call in try/catch — wrap the WHOLE body. `ctx.hasUI`, `getConfig()`, and
  `getEntries()` can also throw (Proxy traps); all must be swallowed (the function is called on the hot path).
- ❌ Don't narrow the param to `ExtensionCommandContext` — S3 calls this from contextHandler/session_start
  (ExtensionContext). Keep `ExtensionContext`.
- ❌ Don't inject the banner into `event.messages` or call `pi.sendMessage`/`pi.appendEntry` — the banner is
  UI-ONLY (E26 acceptance (d): zero model-context cost). reconcileBanner takes `ctx`, not `pi`.
- ❌ Don't commit `test/banner.test.ts` — S4 owns the committed banner test suite. Use the throwaway scratch script.
- ❌ Don't edit `src/config.ts`, `src/tools/audit.ts`, `src/commands.ts`, or `src/index.ts` — S1 shipped the knob,
  listCheckpoints already exists, commands.ts already calls reconcileBanner, and S3 owns the hook wiring.

---

## Confidence Score

**9 / 10** — one-pass success likelihood.

Rationale: this is ~25 lines of defensive glue with every dependency already shipped and verified — the `setWidget`
signature is confirmed verbatim (types.d.ts:97-98), `listCheckpoints` is a pure reused export (no re-scan), the
`ui.activeCheckpointBanner` knob is already in config.ts (S1), and the existing consumer (commands.ts) + its test
mock mean the real body cannot break the suite. The function is fully specified by the item contract (4 branches +
whole-body try/catch). The only reason for not scoring 10: the scope boundary with S4 (committed tests) requires
the implementer to use a throwaway scratch script rather than a committed test, which is a slightly less automated
gate — so the PRP spells out the exact scratch script and the "delete it" instruction to remove ambiguity.