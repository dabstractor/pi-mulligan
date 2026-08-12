name: "P2.M3.T1.S3 — Hook reconcileBanner into the refresh points (commands + session_start + contextHandler tail)"
description: |
  Wire the now-real `reconcileBanner(ctx)` (exported from `src/banner.ts` by P2.M3.T1.S2) into its THREE refresh-
  point families (spec/13 §5 "Refresh points"): (a) the two command handlers in `src/commands.ts`, (b) the
  `session_start` handler in `src/index.ts`, and (c) the tail of the `contextHandler` in `src/filter.ts`.
  **(a) is ALREADY DONE** — `commands.ts` already imports `reconcileBanner` from `./banner.js` (L35) and calls it
  after a successful checkpoint SET (L187, the `"entryId" in res` branch) and after a successful REVOKE (L228, the
  `cleared` branch). This item VERIFIES (a) and EDITS (b) and (c). For (b): add `import { reconcileBanner } from
  "./banner.js";` to `index.ts` and add a BARE `reconcileBanner(ctx);` as the LAST statement of the `session_start`
  handler, AFTER `resetRuntime(ctx.sessionManager.getSessionId())` — this restores the banner on `/resume`. For (c):
  add `import { reconcileBanner } from "./banner.js";` to `filter.ts` and add
  `try { reconcileBanner(ctx); } catch { /* E13 — banner failure must never break a context fire */ }` at the TAIL
  of `contextHandler`, AFTER the stale-retirement `try/catch` block and BEFORE `return { messages }`. This is
  defense-in-depth: the filter already scans entries every fire; the tail call catches checkpoint CONSUMPTION (a
  rewind retires the label) and any state change the command/session_start hooks missed. Mode A documentation:
  JSDoc/comments only — internal wiring, no user-facing surface change beyond the banner itself (already documented
  in S2). The committed banner + filter-regression test suite is owned by P2.M3.T1.S4; S3 self-validates with
  `npm run typecheck` + `npm test` only (the existing fake-ctxs all omit `hasUI`, so the new calls are provably
  no-ops in the test suite — no test can break).

---

## Goal

**Feature Goal**: Connect the `reconcileBanner` mechanism (S2) to its full set of refresh points so the
above-editor active-checkpoint banner is ALWAYS in sync with active-checkpoint state: refreshed on every
checkpoint SET/REVOKE (command hooks), restored on every session start/resume (`session_start`), and reconciled
on every context fire (contextHandler tail — defense-in-depth). After S3, `reconcileBanner` is invoked at all
the refresh points enumerated by spec/13 §5.

**Deliverable**: Two edited production files — `src/index.ts` (one import + one statement in the
`session_start` handler) and `src/filter.ts` (one import + one statement at the `contextHandler` tail) — plus a
read-only VERIFICATION that `src/commands.ts` already calls `reconcileBanner(ctx)` at its two mutation sites.
No new files, no other production-code edits.

**Success Definition**: `npm run typecheck` clean; `npm test` green (the existing suite is unaffected — every
fake-ctx omits `hasUI`, so the new calls no-op; see Validation). The banner is reconciled on checkpoint
SET, checkpoint REVOKE, `session_start` (every reason: startup|reload|new|resume|fork), and the tail of every
context fire.

## User Persona (if applicable)

**Target User**: the operator who has armed a `/mulligan_checkpoint` (destructive cross-prompt rewind power).

**Use Case**: After `/resume` of a session that has an active checkpoint, the banner reappears (restored by the
`session_start` hook) — so resuming a session never silently drops the destructive-power reminder. On every turn
the contextHandler-tail hook keeps it fresh (e.g. if a checkpoint is CONSUMED by a rewind that retires the label,
the banner clears within one fire).

**Pain Points Addressed**: spec/08 E26 — a checkpoint grants destructive power for its whole lifetime; the user
forgets it is armed. The persistent banner is the antidote; S3 ensures it is refreshed at every state-change
boundary so it can never go stale.

## Why

- **Spec compliance (spec/13 §5 "Refresh points (reconcile banner ⇄ active-checkpoint state)")**: the merged
  PRD mandates FOUR refresh-point families: (1) checkpoint SET + REVOKE command handlers, (2) `session_start`,
  (3) every `context` fire (defense-in-depth). S3 completes the wiring so all families invoke `reconcileBanner`.
- **`session_start` restores on `/resume` (spec/13 §5 point 2)**: a `/resume` re-binds to an existing session
  tree with persisted checkpoint labels; without the `session_start` hook the banner would stay cleared (a prior
  process's in-memory UI is gone), silently dropping the reminder. The hook re-derives the active set from disk.
- **contextHandler-tail defense-in-depth (spec/13 §5 point 3)**: the filter already scans entries every fire
  (readMarkers + the pipeline). The tail call is CHEAP (reconcileBanner re-reads entries via listCheckpoints, but
  that scan is already happening for other reasons) and catches CONSUMPTION (a `mulligan_rewind(granularity:"checkpoint")`
  retires the label → `listCheckpoints` no longer reports it → banner clears) and any state change the command/
  session_start hooks missed. It is the safety net that makes the banner robustly correct.
- **Why NOT more hooks**: the command handlers mutate state (immediate refresh), session_start restores across
  process boundaries, and the context tail catches everything else. These four families are the complete set — no
  additional hooks are needed or wanted (over-hooking would add redundant fires with no correctness gain).

## What

User-visible behavior (TUI/RPC): the active-checkpoint banner is correct at every moment — refreshed on
SET/REVOKE, restored on `/resume`/`/reload`, and reconciled within one inference of any state change. In
print/JSON/rpc-without-ui: no-op (`reconcileBanner` guards on `ctx.hasUI`). Technical: two single-statement
additions + two imports + one verification. No new data, no config change, no new files.

### Success Criteria

- [ ] `src/commands.ts` already calls `reconcileBanner(ctx)` after a successful checkpoint SET and after a
      successful REVOKE (VERIFIED — import at L35, calls at L187/L228).
- [ ] `src/index.ts` imports `reconcileBanner` from `./banner.js` and calls `reconcileBanner(ctx)` as the LAST
      statement of the `session_start` handler (after `resetRuntime(...)`).
- [ ] `src/filter.ts` imports `reconcileBanner` from `./banner.js` and calls
      `reconcileBanner(ctx)` inside a `try { … } catch { /* E13 */ }` at the TAIL of `contextHandler`, AFTER the
      stale-retirement block and BEFORE `return { messages }`.
- [ ] `npm run typecheck` clean; `npm test` green (no existing test broken).
- [ ] No committed test file added (test/banner.test.ts + filter-regression are P2.M3.T1.S4).

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, they would need: the exact insertion points in `index.ts` and
`filter.ts` (verbatim surrounding lines, provided below), the import statement form (ESM `.js` extension — repo
convention), WHY the filter-tail call needs its own try/catch wrapper (load-bearing — preserves the transform)
while the session_start call does not (reconcileBanner never throws), confirmation that `commands.ts` is already
wired (no edit), and confirmation that the existing test suite cannot break (every fake-ctx omits `hasUI`).
All inline. No external library docs beyond the Pi types (already vendored).

### Documentation & References

```yaml
# MUST READ — the spec anchor + the S2 contract (the function being wired).
- url: plan/007_67d7d8c6e4c5/P2M3T1S2/PRP.md  (the whole file)
  why: "S2 is the CONTRACT for reconcileBanner: signature (ctx: ExtensionContext) => void, whole-body try/catch
        (NEVER throws), !ctx.hasUI → no-op, !config.ui.activeCheckpointBanner → clear, 0 active → clear,
        ≥1 active → setWidget(key, lines, {placement:'aboveEditor'}). S3 consumes this function; do NOT
        re-implement it."
  critical: "reconcileBanner NEVER throws — this is the S2 guarantee S3 relies on for the bare session_start
             call (no wrapper needed there). It is also why the filter-tail wrapper is belt-and-suspenders, but
             still load-bearing for a DIFFERENT reason (see filter.ts gotcha below)."

- url: plan/007_67d7d8c6e4c5/architecture/change_surface.md  (heading "### Change 6: Active-checkpoint banner" → "Hook points")
  why: "Documents the three hook sites: commands.ts checkpoint set/revoke; index.ts session_start after
        resetRuntime; filter.ts contextHandler tail before return { messages }. The authoritative change-surface
        list this item implements."
  critical: "Line numbers in change_surface.md may be slightly stale (it was written during research, before
             parallel items landed). USE THE VERBATIM SURROUNDING CODE in this PRP's Implementation Tasks to locate
             the exact insertion points, not the line numbers."

# PRODUCTION CODE TO EDIT.
- file: src/index.ts
  why: "EDIT — add the import + the session_start tail call. The session_start handler is a pi.on('session_start',
        (_event, ctx) => { setConfig(...); setLogFile(...); resetRuntime(...); }) block near the bottom of the
        default export. reconcileBanner(ctx) goes AFTER resetRuntime as the LAST statement."
  pattern: "The session_start handler has NO try/catch around its body (it relies on loadMulliganConfig/setConfig/
            resetRuntime being fail-open). Adding a bare reconcileBanner(ctx) is safe because reconcileBanner NEVER
            throws (S2 guarantee) — it cannot perturb the handler even with a minimal ctx."
  gotcha: "The handler's existing tail is resetRuntime(ctx.sessionManager.getSessionId()). The new call is the
           LAST statement — add it AFTER resetRuntime, not before. ctx here is ExtensionContext (has ui.setWidget +
           hasUI + sessionManager.getEntries — all on the base ctx, which is what reconcileBanner needs)."

- file: src/filter.ts
  why: "EDIT — add the import + the contextHandler tail call. contextHandler's body is ONE outer try/catch. The
        stale-retirement block is an INNER try/catch near the end of the outer try. The reconcileBanner call goes
        AFTER that inner try/catch closes and BEFORE the final `return { messages }`."
  pattern: "Mirror the stale-retirement block's own defensive try/catch (it is there for the SAME E13 reason — a
            retirement failure must not break the turn). The reconcileBanner call gets the SAME treatment."
  gotcha: "LOAD-BEARING: the explicit try { reconcileBanner(ctx); } catch {} is NOT just defensive — it preserves
           the already-computed filter transform. WITHOUT it, a throw from reconcileBanner would fall into the
           OUTER catch (which returns void = pass-through, C4), LOSING the transform. WITH it, the throw is
           swallowed locally and execution continues to `return { messages }`. (reconcileBanner itself never throws
           per S2, so in practice the wrapper is a no-op — but it is the contract-mandated correctness guarantee.)"

# PRODUCTION CODE TO VERIFY (NO EDIT).
- file: src/commands.ts
  why: "VERIFY ONLY — already calls reconcileBanner. L35: import { reconcileBanner } from './banner.js';.
        L187 (inside makeCheckpointCommand's success branch, after the notify): reconcileBanner(ctx);.
        L228 (inside makeCheckpointRevokeCommand's cleared branch, before the notify): reconcileBanner(ctx);.
        If these are present and the import path is correct, hook (a) is DONE — no edit."
  pattern: "The call sites are gated to SUCCESSFUL mutations only (entryId-in-res / cleared), never on the
            error/not-found branches — correct (no state change → no refresh needed)."
  gotcha: "If a future refactor moves these, the import path MUST stay './banner.js' (ESM .js extension). S3 does
           NOT move them."

# THE FUNCTION BEING WIRED (S2's output — read-only dependency).
- file: src/banner.ts
  why: "reconcileBanner(ctx: ExtensionContext): void — the real implementation shipped by S2. S3 imports it; it is
        NOT re-implemented here. It is whole-body try/catch (never throws), checks !ctx.hasUI first (no-op in
        print/JSON/rpc-without-ui), then the config knob, then scans entries via listCheckpoints (reused from
        src/tools/audit.ts), then setWidget(key, lines|undefined, {placement:'aboveEditor'})."
  pattern: "Import it: import { reconcileBanner } from './banner.js'; (extension-less for the type, .js for the
            value binding — repo ESM convention)."

# TEST SAFETY PROOF.
- file: test/index.test.ts  (makeCtx ~L64-75)
  why: "The session_start fake ctx has NO hasUI, NO ui, NO getEntries — only sessionManager.getSessionId + cwd.
        So reconcileBanner(ctx) hits !ctx.hasUI (undefined → falsy) → no-op. The test cannot break."
- file: test/filter.test.ts  (makeCtx ~L104-132)
  why: "The contextHandler fake ctx has NO hasUI, NO ui — only sessionManager.{getSessionId,getEntries,getBranch}
        + optional getContextUsage. So reconcileBanner(ctx) no-ops at !ctx.hasUI. The test cannot break."
  pattern: "Same makeCtx shape is shared (mutatis mutandis) by test/edge-cases.test.ts and test/tools/audit.test.ts
            — none has hasUI. EVERY contextHandler call in the suite is therefore safe."
```

### Current Codebase tree (the files this item touches)

```bash
src/commands.ts    # VERIFY ONLY — already imports + calls reconcileBanner on SET (L187) + REVOKE (L228)
src/banner.ts      # NO CHANGE — reconcileBanner is S2's output (consumed via import)
src/index.ts       # EDIT — add import + reconcileBanner(ctx) at session_start tail
src/filter.ts      # EDIT — add import + try{ reconcileBanner(ctx) }catch{} at contextHandler tail
# Out of scope:
test/banner.test.ts          # DO NOT CREATE — S4 owns the committed banner test suite
test/filter.test.ts          # NO CHANGE — existing suite is provably unaffected (no fake-ctx has hasUI)
src/config.ts                # NO CHANGE — ui.activeCheckpointBanner already shipped (S1)
src/tools/audit.ts           # NO CHANGE — listCheckpoints already exists (reused by reconcileBanner internally)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/index.ts   # MODIFIED — +1 import, +1 statement in session_start handler (banner restore on start/resume)
src/filter.ts  # MODIFIED — +1 import, +1 try/catch statement at contextHandler tail (defense-in-depth reconcile)
# (NO new files. Mode A: inline comments/JSDoc are the only doc artifacts.)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — the filter-tail try/catch wrapper is LOAD-BEARING, not merely defensive. contextHandler is ONE outer
// try/catch whose catch returns VOID (pass-through, C4). If reconcileBanner threw WITHOUT a local wrapper, the
// throw would bubble to the OUTER catch → void return → the already-computed filter transform { messages } is
// LOST (the model sees the un-filtered original). The local try { reconcileBanner(ctx); } catch { } swallows the
// throw so execution continues to `return { messages }`. (reconcileBanner never throws per S2, so in production
// this is a no-op wrapper — but it is the contract-mandated guarantee that the transform always survives.)
// Compare the sibling stale-retirement block, which uses the SAME pattern for the SAME reason.

// CRITICAL — the session_start call is BARE (no wrapper). The session_start handler has no surrounding try/catch;
// it relies on its callees being fail-open (loadMulliganConfig/setConfig/resetRuntime). reconcileBanner NEVER
// throws (S2's whole-body try/catch + safe-log), so a bare call is safe and matches the handler's fail-open
// convention. Do NOT add a wrapper there — it would be inconsistent with the handler's style and is unnecessary.

// GOTCHA — ESM/Bundler resolution: cross-module imports MUST use the `.js` extension even for `.ts` source
// (repo-wide convention; audit.ts GOTCHA #3 applies). So `import { reconcileBanner } from "./banner.js";` in BOTH
// index.ts and filter.ts. (commands.ts already does this correctly at L35.)

// GOTCHA — index.ts is touched by MULTIPLE parallel items (change_surface.md "index.ts Multi-Touch Coordination"):
// P1.M3.T1.S1, P2.M1.T1.S2, P2.M2.T1.S2, and THIS item (P2.M3.T1.S3). The import you add must not duplicate an
// existing one and must follow the import-grouping convention already in the file (the commands.js import is the
// last value import; add banner.js near it). The session_start handler is a single pi.on block — locate it by its
// verbatim contents, NOT by a line number.

// GOTCHA — filter.ts contextHandler's tail is the LAST statement in the outer try BEFORE the outer catch. The
// stale-retirement INNER try/catch (the one with `catch (retireErr)`) closes with a `}`. The reconcileBanner call
// goes AFTER that `}` and BEFORE the `// ONE cast at the return boundary` comment + `return { messages }`. If you
// accidentally place it INSIDE the stale-retirement try, a banner failure would be caught by the WRONG handler
// (retireErr) — still harmless (swallowed), but the comment would be misleading. Place it BETWEEN the two.

// GOTCHA — do NOT add reconcileBanner to the `!config.enabled` early-return path. contextHandler has
// `if (!config.enabled) return;` early in its body; the tail call is naturally AFTER that guard, so it only fires
// when enabled. This is correct: when the extension is disabled, the context handler is pass-through and should do
// NO work (including no banner reconciliation on every fire). The banner's enable/disable is governed by the
// separate config.ui.activeCheckpointBanner knob, which reconcileBanner reads internally.

// GOTCHA — do NOT commit test/banner.test.ts or any new filter test. P2.M3.T1.S4 owns the committed banner +
// filter-regression test suite. S3 self-validates with npm run typecheck + npm test only (the existing suite is
// provably unaffected — no fake-ctx has hasUI).
```

## Implementation Blueprint

### Data models and structure

No new data models. This item is pure wiring: two `import` statements and two function-call insertions. It
consumes `reconcileBanner(ctx: ExtensionContext): void` from `src/banner.ts` (S2's output) without change.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY src/commands.ts — hook (a) is already wired (NO EDIT)
  - FILE: src/commands.ts (read-only)
  - CONFIRM: `import { reconcileBanner } from "./banner.js";` is present (currently L35).
  - CONFIRM: `reconcileBanner(ctx);` is called inside makeCheckpointCommand's success branch (the
        `"entryId" in res` block, AFTER the fair-warning notify — currently L187).
  - CONFIRM: `reconcileBanner(ctx);` is called inside makeCheckpointRevokeCommand's `cleared` branch
        (currently L228, BEFORE the revoked notify).
  - IF ALL THREE PRESENT: hook (a) is DONE. Make NO edit. (If any is missing — unlikely given P2.M1.T1.S1 is
        marked Complete — add it following the import/call pattern; the import path MUST be "./banner.js".)
  - GOTCHA: the SET call must be in the SUCCESS branch only (not the `{error}` branch); the REVOKE call must be
        in the `cleared` branch only (not the not-found branch). Verify the branch placement.

Task 2: EDIT src/index.ts — add the import + the session_start tail call (hook b)
  - FILE: src/index.ts
  - ADD import: `import { reconcileBanner } from "./banner.js";`
        PLACE: among the value imports, near the commands.js import (the last value-import group). Do NOT
        duplicate; do NOT add it to the type-only `import type` line.
  - ADD statement: in the `session_start` handler, add `reconcileBanner(ctx);` as the LAST statement, AFTER
        `resetRuntime(ctx.sessionManager.getSessionId());` and BEFORE the handler's closing `});`.
  - FOLLOW pattern: the handler is a bare `pi.on("session_start", (_event, ctx) => { … });` with NO try/catch
        (its callees are fail-open). A bare `reconcileBanner(ctx);` (no wrapper) matches — reconcileBanner NEVER
        throws (S2).
  - NAMING: none (it is a function call, not a declaration).
  - GOTCHA: ctx here is the ExtensionContext passed to the session_start callback — it has hasUI + ui.setWidget +
        sessionManager.getEntries (all on the base ctx that reconcileBanner reads). Do NOT read ctx fields yourself
        — just pass ctx to reconcileBanner.

Task 3: EDIT src/filter.ts — add the import + the contextHandler tail call (hook c)
  - FILE: src/filter.ts
  - ADD import: `import { reconcileBanner } from "./banner.js";`
        PLACE: among the value imports, in alphabetical-ish order with the other "./…js" imports (the file already
        imports from "./transforms.js", "./runtime.js", "./config.js", "./log.js", "./tokens.js", "./markers.js",
        "./nudges.js"). Add "./banner.js" in the appropriate slot.
  - ADD statement: at the TAIL of contextHandler, AFTER the stale-retirement INNER try/catch block closes (the
        `} catch (retireErr) { … }` block) and BEFORE the `// ONE cast at the return boundary` comment +
        `return { messages: … };`:
            // [P2.M3.T1.S3 / spec/13 §5] Defense-in-depth: reconcile the banner on every context fire.
            try { reconcileBanner(ctx); } catch { /* E13 — banner failure must never break a context fire */ }
  - FOLLOW pattern: the stale-retirement block's own inner try/catch (the `try { … } catch (retireErr) { … }`
        immediately above). The reconcileBanner wrapper mirrors it: an isolated try/catch so a failure does NOT
        fall through to the outer catch (which would void-return and lose the transform).
  - NAMING: none (function call).
  - GOTCHA (LOAD-BEARING): the local try/catch preserves the already-computed filter transform — see the Known
        Gotchas. Do NOT omit it. Do NOT move the call INSIDE the stale-retirement try (wrong catch handler + wrong
        comment). Do NOT move it AFTER the `return` (unreachable).

Task 4: VERIFY — typecheck + full test suite
  - RUN: npm run typecheck   # tsc --noEmit — expect clean. A type error in index.ts or filter.ts almost certainly
         means the import path is wrong (must be "./banner.js", not "./banner") OR a duplicate import.
  - RUN: npm test            # vitest run — expect green. The new calls are no-ops in every test (no fake-ctx has
         hasUI → reconcileBanner returns at !ctx.hasUI). If a test fails, it is NOT caused by S3's calls — re-check
         whether a parallel item (S2) landed an incompatible banner.ts.
```

### Implementation Patterns & Key Details

```typescript
// ── index.ts — the session_start handler BEFORE (verbatim, current) ──────────────────────────
//   pi.on("session_start", (_event, ctx) => {
//     setConfig(loadMulliganConfig(ctx.cwd));
//     setLogFile(getConfig().log.file);
//     resetRuntime(ctx.sessionManager.getSessionId());
//   });

// ── index.ts — the session_start handler AFTER (the ONLY body change) ────────────────────────
//   pi.on("session_start", (_event, ctx) => {
//     setConfig(loadMulliganConfig(ctx.cwd));
//     setLogFile(getConfig().log.file);
//     resetRuntime(ctx.sessionManager.getSessionId());
//     reconcileBanner(ctx); // [P2.M3.T1.S3 / spec/13 §5] restore the banner on every session start
//                            // (startup|reload|new|resume|fork) — so /resume never silently drops the reminder.
//                            // Bare call (no wrapper): reconcileBanner NEVER throws (S2), matching the handler's
//                            // fail-open convention (its other callees are also fail-open).
//   });
//
// Plus the import. index.ts is a MULTI-TOUCH file (4 parallel items), so place by ANCHOR not line number.
// The LAST current value import is the commands.js line — add banner.js immediately AFTER it:
//   import { makeCheckpointCommand, makeCheckpointRevokeCommand, makeAuditCommand } from "./commands.js";  // (existing, anchor)
//   import { reconcileBanner } from "./banner.js";                                                              // (NEW — P2.M3.T1.S3)
// (Placement anywhere in the value-import group typechecks fine; the anchor just avoids collisions.)

// ── filter.ts — the contextHandler tail BEFORE (verbatim, current) ───────────────────────────
//     } catch (retireErr) {
//       // Retirement failure must not break the turn (E13). Log + fall through to the normal return.
//       try {
//         log("warn", "filter.retire", sessionId, {
//           error: retireErr instanceof Error ? retireErr.message : String(retireErr),
//         });
//       } catch {
//         /* log() never throws, but be safe */
//       }
//     }
//
//     // ONE cast at the return boundary: MessageLike[] -> Pi's AgentMessage[] (ContextEventResult.messages).
//     return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };

// ── filter.ts — the contextHandler tail AFTER (insert ONE block between the two) ─────────────
//     } catch (retireErr) {
//       // … (unchanged) …
//     }
//
//     // [P2.M3.T1.S3 / spec/13 §5] Defense-in-depth: reconcile the active-checkpoint banner on EVERY context
//     // fire. The filter already scans entries; this catches checkpoint CONSUMPTION (a rewind retires the
//     // label) and any state change the command/session_start hooks missed. NEVER throws — the explicit
//     // try/catch preserves the already-computed filter transform (without it, a throw would reach the OUTER
//     // catch → void pass-through, losing the transform — E13). reconcileBanner itself never throws (S2).
//     try { reconcileBanner(ctx); } catch { /* E13 — banner failure must never break a context fire */ }
//
//     // ONE cast at the return boundary: MessageLike[] -> Pi's AgentMessage[] (ContextEventResult.messages).
//     return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };
//
// Plus the import. filter.ts's value imports are NOT strictly alphabetical (transforms.js leads as the core,
// then runtime/config/log/tokens/markers/nudges). Add banner.js anywhere in the value-import group — e.g. after
// the last value import (nudges.js), which is the safest no-collision slot:
//   import { shouldHighWater, injectHighWaterNudge, injectNudge, shouldNudge, suppressCheck } from "./nudges.js";  // (existing, anchor)
//   import { reconcileBanner } from "./banner.js";                                                               // (NEW — P2.M3.T1.S3)
```

### Integration Points

```yaml
IMPORTS (ESM .js convention):
  - src/index.ts:  ADD  import { reconcileBanner } from "./banner.js";   (value-import group)
  - src/filter.ts: ADD  import { reconcileBanner } from "./banner.js";   (value-import group)

SESSION (read-only): NO CHANGE
  - reconcileBanner reads ctx.sessionManager.getEntries() internally (via listCheckpoints). The hooks just pass
    ctx; they write nothing to the session tree.

UI (ctx.ui.setWidget): NO DIRECT CHANGE in S3
  - The setWidget calls live INSIDE reconcileBanner (S2). S3 only invokes reconcileBanner; it does not call
    setWidget itself. (Single-writer invariant preserved — only reconcileBanner writes the key.)

CONFIG (src/config.ts): NO CHANGE
  - config.ui.activeCheckpointBanner (S1) is read by reconcileBanner internally. The hooks do not read config.

EVENT HANDLERS: NO new registrations
  - S3 does NOT register new pi.on handlers. It edits the BODIES of the existing session_start handler (index.ts)
    and the existing contextHandler (filter.ts). registerFilterHandler and the session_start pi.on are unchanged.

DOWNSTREAM CONSUMERS (out of scope — DO NOT create in S3):
  - Committed banner + filter-regression tests: P2.M3.T1.S4.
  - README v1.1 sweep: P3 (Mode B).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (both edited files flow through tsc against the real Pi types).
npm run typecheck          # tsc --noEmit — expect: zero errors.
# If a type error appears in src/index.ts or src/filter.ts, the likely causes:
#   1. Import path is "./banner" (missing .js) → fix to "./banner.js" (ESM convention).
#   2. Duplicate import (banner.js imported twice) → remove the duplicate.
#   3. The reconcileBanner call was placed somewhere ctx is out of scope → it must be inside the handler/callback
#      that receives ctx (session_start callback / contextHandler body).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Full vitest suite — confirm the new calls do NOT perturb any existing test.
npm test                   # = vitest run — expect: green (all suites pass).
# Rationale: EVERY fake ctx in the suite omits hasUI (undefined → falsy), so reconcileBanner(ctx) returns at the
# !ctx.hasUI guard before touching ctx.ui — it is a complete no-op in every test:
#   - test/index.test.ts makeCtx: { sessionManager:{getSessionId}, cwd } — no hasUI.
#   - test/filter.test.ts makeCtx: { sessionManager:{getSessionId,getEntries,getBranch}, getContextUsage? } — no hasUI.
#   - test/edge-cases.test.ts makeCtx, test/tools/audit.test.ts makeCtx — same (no hasUI).
# So neither the session_start hook nor the contextHandler-tail hook can change any test's behavior. If a test
# fails, it is NOT caused by S3 — re-run after any in-flight parallel item (S2) lands.
```

### Level 3: Integration Testing (System Validation)

```bash
# No integration harness is owned by S3 (the committed integration scenarios F-banner / F-ckptcmd are S4's).
# S3's integration proof is: the banner is reconciled at all refresh points, exercised end-to-end by S4.
# Manual smoke (optional, if a real Pi TUI is available): /mulligan_checkpoint foo → banner appears; /resume →
# banner restored; /mulligan_checkpoint_revoke foo → banner clears. This requires a real Pi install (out of scope
# for the automated gate).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# None beyond Levels 1–2 for S3. The function being called (reconcileBanner) is S2's responsibility; S3 is the
# wiring. The E26 acceptance criteria (banner persists across turns; restores on /resume; clears on
# revoke/consume within one fire; never enters event.messages) are EXERCISED end-to-end by S4's test suite, not
# by S3's typecheck+test gate. S3's gate proves only that the wiring compiles and does not break the suite.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (the two new imports + two new statements compile).
- [ ] `npm test` green (no existing test broken — the new calls are no-ops in every fake-ctx).

### Feature Validation (the spec/13 §5 refresh-point contract)

- [ ] Hook (a): `commands.ts` calls `reconcileBanner(ctx)` after successful SET (L187) and successful REVOKE
      (L228) — VERIFIED, no edit.
- [ ] Hook (b): `index.ts` session_start handler calls `reconcileBanner(ctx)` as its LAST statement (restores on
      /resume — the primary user-facing win of S3).
- [ ] Hook (c): `filter.ts` contextHandler calls `reconcileBanner(ctx)` inside a local try/catch at its tail
      (defense-in-depth — catches consumption + missed state changes within one inference).
- [ ] The filter-tail call is placed BETWEEN the stale-retirement block and `return { messages }` (not inside
      either), so the transform is preserved on any failure.

### Code Quality Validation

- [ ] Both imports use the `.js` ESM extension (`./banner.js`), matching repo convention.
- [ ] The session_start call is bare (no wrapper) — consistent with the handler's fail-open convention and safe
      because reconcileBanner never throws (S2).
- [ ] The contextHandler-tail call is wrapped in its own try/catch — consistent with the sibling stale-retirement
      block and load-bearing for transform preservation.
- [ ] No new files, no config change, no new event-handler registration (S3 edits handler BODIES only).
- [ ] The inline comments cite spec/13 §5 + E13 (Mode A — rides with the code).

### Documentation & Deployment

- [ ] Inline comments on both new call sites cite spec/13 §5 + the refresh-point rationale (Mode A).
- [ ] No new environment variables, no config additions (S1 owns the knob; S2 owns the function).
- [ ] NO committed test file (test/banner.test.ts + filter-regression are S4).

---

## Anti-Patterns to Avoid

- ❌ Don't omit the filter-tail try/catch wrapper — it is LOAD-BEARING. Without it, a (hypothetical) reconcileBanner
  throw would reach the OUTER catch → void pass-through → the computed filter transform is LOST. The wrapper keeps
  execution flowing to `return { messages }`.
- ❌ Don't wrap the session_start call in a try/catch — it is unnecessary (reconcileBanner never throws, S2) and
  inconsistent with the handler's bare fail-open style. A bare call is the correct, idiomatic form there.
- ❌ Don't add reconcileBanner to the `!config.enabled` early-return path in contextHandler — the tail call is
  naturally after that guard (only fires when enabled), which is correct. When disabled, the handler is pass-through
  and should do no work.
- ❌ Don't move the filter-tail call INSIDE the stale-retirement try block — it belongs BETWEEN that block's closing
  `}` and the `return`. Inside the wrong try, a failure is caught by `retireErr` (harmless but misleading comment).
- ❌ Don't re-implement reconcileBanner or call `ctx.ui.setWidget` directly from the hooks — funnel through
  reconcileBanner (S2) to preserve the single-writer invariant for the `mulligan:active-checkpoint` widget key.
- ❌ Don't commit test/banner.test.ts or a new filter test — S4 owns the committed banner + filter-regression suite.
  S3's gate is `npm run typecheck` + `npm test` only.
- ❌ Don't trust the line numbers in change_surface.md — they are research-era and may be stale. Locate insertion
  points by the VERBATIM surrounding code in this PRP's Implementation Patterns.
- ❌ Don't edit src/commands.ts, src/banner.ts, src/config.ts, or src/tools/audit.ts — commands.ts is already wired
  (verify only), banner.ts is S2's output, the config knob is S1's, and listCheckpoints already exists.

---

## Confidence Score

**9 / 10** — one-pass success likelihood.

Rationale: this is two single-statement insertions + two imports + one verification, with every dependency already
shipped (S2's reconcileBanner is real; commands.ts hook (a) is already wired; the config knob is S1's). The change
is provably test-safe: every fake-ctx in the suite omits `hasUI`, so the new calls are complete no-ops in every
test — `npm test` cannot regress. The only reason for not scoring 10: index.ts is a multi-touch file (4 parallel
items touch it), so the implementer must locate the session_start handler by its verbatim contents rather than a
line number, and place the import without colliding with the existing import groups — both are spelled out exactly
in the Implementation Patterns, but multi-touch files carry a small merge-attention risk. The filter-tail placement
also requires reading the surrounding code to find the exact seam between the stale-retirement block and the return
— again spelled out verbatim, but it is the one spot where a careless insert could land in the wrong try block.

---