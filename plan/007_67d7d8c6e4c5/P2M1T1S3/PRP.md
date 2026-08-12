---
name: "P2.M1.T1.S3 — test/commands.test.ts: comprehensive tests for the checkpoint command factories + clearCheckpointByName"
---

## Goal

**Feature Goal**: Create `test/commands.test.ts` — a NEW, self-contained vitest suite that exercises every
behavioral path of the two v1.1 human-facing checkpoint slash-command factories (`makeCheckpointCommand`,
`makeCheckpointRevokeCommand`) and the exported `clearCheckpointByName` helper from `src/commands.ts` (S1,
landed), using hand-rolled fake `pi` + fake `ExtensionCommandContext` objects (no real Pi). The suite proves
the commands: gate on `getConfig().enabled`, validate the name via the shared `/^[a-z0-9_-]{1,40}$/` regex,
delegate to `setCheckpoint` / `clearCheckpointByName`, fire the **verbatim** spec/13 §2/§3 user-facing
notifies, guard every `ctx.ui.notify` behind `ctx.hasUI`, never throw (try/catch), and refresh the
active-checkpoint banner (`reconcileBanner`) exactly on a successful mutation.

**Deliverable**: A single new file `test/commands.test.ts` (no source changes — test-only, Mode A). It
mirrors the house test idiom from `test/tools/checkpoint.test.ts` (vitest, hand-rolled fakes, no `vi.fn()`
for Pi objects, `.js` import paths, `clearAll()` + `setConfig(undefined)` reset) and asserts the verbatim
notify strings + setLabel calls for the item's 6 required cases plus a small set of high-value bonus cases.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`, strict, includes `test/`) exits 0.
- `npm test` (full `vitest run`) is GREEN — the new file passes and nothing else regresses.
- `npx vitest run test/commands.test.ts` passes in isolation (the file is self-contained).
- All 6 contract cases from the item description are covered: (a) set valid, (b) set invalid name,
  (c) set disabled, (d) revoke existing, (e) revoke missing, (f) `clearCheckpointByName` non-existent vs
  existing — plus the bonus cases (hasUI=false guard, disabled-before-validation, no-stable-entry,
  stale-label two-phase confirm).
- `git status --short` shows only `?? test/commands.test.ts` (untracked new file). No source files modified.

## User Persona (if applicable)

**Target User**: The Mulligan maintainer / future implementing agent who needs a regression net proving the
v1.1 human checkpoint commands behave per spec/13 §2–§3 before P2.M3 wires the live banner behind them.

**Use Case**: Run `npx vitest run test/commands.test.ts` after touching `src/commands.ts` to confirm no
behavioral regression in the command handlers.

**User Journey**: (invisible — this is a test file) The maintainer edits `commands.ts` → runs the suite →
green means the command contract (notifies, gates, setLabel delegation, banner refresh) still holds.

**Pain Points Addressed**: `commands.ts` currently has ZERO direct unit tests (only `test/index.test.ts`
asserts the two commands are *registered*, via S2). Without this file, a regression in notify wording, the
disabled gate, or `clearCheckpointByName`'s two-phase confirm would ship silently.

## Why

- **Business value**: This is the **verification half** of the v1.1 human checkpoint surface (P2.M1). S1 built
  the handlers; S2 registered them; S3 locks the contract with a regression suite. It also validates the
  two-phase `clearCheckpointByName` (the APPEND-ONLY-label stale-detection design) which has no test today.
- **Position in plan**: Third/final subtask of P2.M1.T1. **Upstream (Complete)**: P2.M1.T1.S1
  (`src/commands.ts` + `src/banner.ts` — verified landed; see "Verified S1 Output"). **Parallel**:
  P2.M1.T1.S2 (index.ts registration) — S3 is **independent** of S2: it calls the factory's `.handler(...)`
  directly with fakes and never touches `src/index.ts` or `test/index.test.ts`. **Downstream**: P2.M3.T1.S4
  will add banner-behavior tests (separate concern — S3 mocks the banner; see GOTCHA #1).
- **Scope discipline**: S3 writes `test/commands.test.ts` ONLY. It does **NOT** modify any `src/` file, does
  **NOT** modify `test/index.test.ts` (S2's), does **NOT** test the banner's *behavior* (P2.M3.T1.S4 — S3
  only asserts the command *calls* `reconcileBanner`), and does **NOT** add an integration smoke harness
  (Tier 2, spec/14 §2.1 F-ckptcmd — separate).

## What

One new test file. No user-visible *model* behavior change (commands are write-only w\.r.t. the model's
context — they never inject into `event.messages`; spec/13 §0). The file exercises the command **handlers**
directly via the factory seam, asserting on captured `setLabel` calls, captured `ctx.ui.notify` calls, the
`reconcileBanner` spy, and `clearCheckpointByName`'s return value.

### Success Criteria

- [ ] `test/commands.test.ts` exists and imports from `"../src/commands.js"` + `"../src/config.js"` +
      `"../src/runtime.js"`, and mocks `"../src/banner.js"` (GOTCHA #1).
- [ ] A hand-rolled `makePi()` captures `setLabel` calls (`labels: { entryId, label }[]`, label is
      `string | undefined`). A hand-rolled `makeCtx()` provides `hasUI`, `ui.{notify,setWidget}`, and
      `sessionManager.{getBranch,getEntries,getLabel,getLeafId}` (GOTCHA #2).
- [ ] Case (a) set valid: `setLabel` called once with `{entryId:"<leaf>", label:"mulligan:checkpoint:<name>"}`;
      warning notify VERBATIM (spec/13 §2 step 5); `reconcileBanner` called with ctx (GOTCHA #1 — via spy,
      NOT via setWidget).
- [ ] Case (b) set invalid name: notify "invalid" (spec/13 §2 step 1, "warning"); `setLabel` NOT called;
      `reconcileBanner` NOT called.
- [ ] Case (c) set disabled (`setConfig({enabled:false})`): notify "Mulligan is disabled" ("warning", no
      prefix); `setLabel` NOT called; `reconcileBanner` NOT called.
- [ ] Case (d) revoke existing: `pi.setLabel(id, undefined)` called; info notify (spec/13 §3 step 5);
      `reconcileBanner` called with ctx.
- [ ] Case (e) revoke missing: info notify "no active checkpoint named '<name>'." (spec/13 §3 step 2);
      `setLabel` NOT called with `undefined`; `reconcileBanner` NOT called.
- [ ] Case (f) `clearCheckpointByName`: returns `false` + no `setLabel` for non-existent; returns `true` +
      `setLabel(id, undefined)` for existing/active.
- [ ] Bonus: hasUI=false → no notify fired but `setLabel` STILL called (label mutation runs regardless of
      hasUI; only the notify is guarded).
- [ ] Bonus: disabled fires BEFORE name validation (disabled + invalid name → still "Mulligan is disabled").
- [ ] Bonus: stale-label two-phase confirm — entries contain the historical SET but `getLabel` returns
      `undefined` → `clearCheckpointByName` returns `false`, no `setLabel` (validates the confirm phase).
- [ ] `npm run typecheck` exit 0; `npm test` GREEN; `git status --short` shows only `?? test/commands.test.ts`.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement S3 from: (1) the exact fake shapes in
"Implementation Patterns" (copy verbatim), (2) the verbatim notify strings in "Documentation & References",
(3) the 3 CRITICAL GOTCHAs (banner stub ≠ setWidget; fake-ctx surface; house idiom), (4) the ordered task
list mapping each of the 6 required cases to a test, and (5) the verified S1 output (the functions under
test). Every assertion string is given literally.

### Documentation & References

```yaml
# MUST READ — the house test idiom to mirror EXACTLY (vitest, hand-rolled fakes, no vi.fn for Pi objects,
# .js imports, clearAll()+setConfig(undefined) reset, it.each tables, expectTypeOf)
- file: test/tools/checkpoint.test.ts
  why: "The canonical sibling test. Copy the makePi() shape (captures setLabel), the beforeEach/afterEach
        reset (clearAll + setConfig(undefined)), the it.each regex accept/reject tables, and the verbatim-
        text-assertion style. S3's makeCtx is RICHER (adds getEntries/getLabel/getLeafId + ui.notify/setWidget
        + hasUI) because command handlers touch ctx.ui + clearCheckpointByName scans getEntries."
  pattern: "labels: {entryId, label}[] captured in a literal setLabel method; hasUI-defaults-true ctx;
            run() helper that calls tool.execute(...); firstText() extractor. S3's run helpers call
            makeCheckpointCommand(pi).handler(args, ctx) / makeCheckpointRevokeCommand(pi).handler(args, ctx)."
  gotcha: "checkpoint.test.ts tests the removed AGENT tool's execute() — DO NOT copy its tool-specific
           assertions. Copy only the IDIOM (fakes, reset, describe/it structure, verbatim-text asserts)."

# MUST READ — the module under test (S1, landed). Read to copy the VERBATIM notify strings + the exact
# handler control flow (gate order, hasUI guard, try/catch, reconcileBanner call points).
- file: src/commands.ts
  why: "Exports makeCheckpointCommand, makeCheckpointRevokeCommand, clearCheckpointByName. The handler
        bodies are the behavior under test. Every notify string + the disabled message + the gate order
        (parse → getConfig().enabled → validCheckpointName → setCheckpoint / clearCheckpointByName) is here."
  pattern: "Factory closure: pi captured at factory-call time; handler(args, ctx) called at test time.
            notify() helper is hasUI-guarded. reconcileBanner(ctx) called ONLY on a successful mutation."
  critical: "The disabled notify is 'Mulligan is disabled' (NO 'Mulligan: ' prefix). The success/invalid/
             revoked/not-found notifies are 'Mulligan: '-prefixed. Assert each byte-for-byte."

# MUST READ — reconcileBanner is a STUB; this drives GOTCHA #1 (assert the spy, NOT setWidget)
- file: src/banner.ts
  why: "reconcileBanner(_ctx) is a typed NO-OP stub (real impl = P2.M3.T1.S2, Planned). The command handler
        CALLS reconcileBanner(ctx) after a successful mutation — but the stub does nothing, so setWidget is
        NEVER invoked. Asserting setWidget would fail. Assert the reconcileBanner spy instead."
  critical: "Do NOT write expect(widgets).toHaveLength(1). Write
             expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx). This is THE #1 trap in this PRP."

# MUST READ — the ExtensionCommandContext surface (the fake ctx shape)
- docfile: plan/007_67d7d8c6e4c5/architecture/external_deps.md
  why: "§3: ExtensionCommandContext extends ExtensionContext → has hasUI, ui (notify + setWidget), mode, cwd,
        sessionManager, model, getContextUsage(). §4: ui.notify(msg, type?). §6: ReadonlySessionManager has
        getEntries(), getLabel(id), getBranch(), getLeafId(), getSessionId(). §1: registerCommand signature
        (NOT needed for handler tests — only index.test.ts needs it)."
  section: "§3 (ExtensionCommandContext), §4 (ui.notify), §6 (ReadonlySessionManager)"
  critical: "The fake ctx need only provide hasUI + ui.{notify,setWidget} + sessionManager.{getBranch,
             getEntries, getLabel, getLeafId}. getLeafId is defensive (setCheckpoint uses getBranch only;
             clearCheckpointByName uses getEntries + getLabel) — provide it so the fake is forward-compatible."

# MUST READ — the verbatim spec text for the notify strings (also in commands.ts; this is the authority)
- docfile: spec/13-human-facing-surface.md
  why: "§2 = /mulligan_checkpoint set (steps 1 invalid-name notify, 5 success fair-warning notify);
        §3 = /mulligan_checkpoint_revoke (step 2 not-found notify, step 5 revoked notify). Assert these
        VERBATIM. The success notify's '(your prompts after here can be hidden)' parenthetical + the
        'Revoke with /mulligan_checkpoint_revoke <name>.' suffix are load-bearing — copy the whole string."
  section: "§2 steps 1+5, §3 steps 2+5"

# MUST READ — setCheckpoint's anchor logic (the SET handler delegates here; controls the fake getBranch)
- file: src/markers.ts
  why: "setCheckpoint (line ~455) walks getBranch() ROOT→LEAF BACKWARDS to the last 'message' entry with a
        non-empty message.role → stableId; calls pi.setLabel(stableId, 'mulligan:checkpoint:'+name). Empty
        branch / no message → {error:'no conversation message to checkpoint (...)'}. Never throws."
  pattern: "For the valid-SET test, script getBranch() to end in a {type:'message', id, message:{role:'assistant'}}
            entry. For the no-stable-entry bonus, getBranch() returns []."
  gotcha: "setCheckpoint does NOT read getLeafId — do not rely on it for anchoring."

# REFERENCE — the module-mock idiom for banner.js (mirror test/index.test.ts's settings.js/log.js mocks)
- file: test/index.test.ts
  why: "Shows the vi.mock('../src/X.js', () => ({ f: vi.fn() })) + import + vi.mocked(f).toHaveBeenCalledWith()
        pattern S3 reuses to spy on reconcileBanner. vi.mock is HOISTED (module-level) and file-scoped."
  pattern: "vi.mock('../src/banner.js', () => ({ reconcileBanner: vi.fn() }));  // top of file, hoisted
            import { reconcileBanner } from '../src/banner.js';                  // after the mock
            // in a test: vi.mocked(reconcileBanner).toHaveBeenCalledWith(ctx);"
  gotcha: "vi.mock replaces the module for the WHOLE file — every test tolerates the banner being a no-op
           spy (true for all commands.test.ts tests). Do NOT mix real-banner + mocked-banner in one file."

# REFERENCE — config reset idiom (setConfig(undefined) → DEFAULT_CONFIG: enabled:true)
- file: src/config.ts
  why: "getConfig() reads a cached config; setConfig(raw) sets it (setConfig(undefined) → DEFAULT_CONFIG with
        enabled:true). The disabled test does setConfig({enabled:false}); beforeEach/afterEach reset to
        undefined so a prior disabled test never bleeds into the next."
```

### Verified S1 Output (the contract S3 tests — confirmed landed by direct grep)

```bash
$ grep -nE '^export function' src/commands.ts
55:export function clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean {
108:export function makeCheckpointCommand(pi: ExtensionAPI): {
160:export function makeCheckpointRevokeCommand(pi: ExtensionAPI): {
$ grep -nE '^export function' src/banner.ts
22:export function reconcileBanner(_ctx: ExtensionContext): void {  /* STUB no-op */
$ npm test -- --run 2>&1 | tail -1   # current suite is GREEN (S1+S2 landed)
```

### Current Codebase tree (relevant slice)

```bash
src/commands.ts          # S1 (landed) — makeCheckpointCommand, makeCheckpointRevokeCommand, clearCheckpointByName
src/banner.ts            # S1 (landed) — reconcileBanner STUB (P2.M3.T1.S2 fills it)
src/markers.ts           # setCheckpoint (line ~455) — the SET handler's delegate
src/tools/checkpoint.ts  # validCheckpointName (the regex owner) — imported by commands.ts
src/config.ts            # getConfig()/setConfig() — the disabled gate
test/tools/checkpoint.test.ts  # THE idiom to mirror (hand-rolled fakes, verbatim asserts)
test/index.test.ts       # S2's territory — DO NOT TOUCH; reference for vi.mock idiom only
test/commands.test.ts    # S3 CREATES THIS (NEW file)
```

### Desired Codebase tree with file responsibility

```bash
test/commands.test.ts    # NEW — vitest suite: 2 command-handler factories + clearCheckpointByName.
                         #   Hand-rolled makePi (setLabel capture) + makeCtx (hasUI/ui/sessionManager).
                         #   vi.mock banner.js → reconcileBanner spy. 6 contract cases + bonuses.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (reconcileBanner is a STUB; assert the SPY, NOT setWidget):
//   src/banner.ts reconcileBanner(_ctx) is a typed NO-OP (P2.M3.T1.S2 implements it). The command handlers
//   CALL reconcileBanner(ctx) after a successful mutation — that is the CONTRACT S3 verifies. But the stub
//   never calls setWidget, so `expect(widgets).toHaveLength(1)` FAILS. The item description's "(verify
//   setWidget called)" assumes a real banner. ADAPT: vi.mock("../src/banner.js", () => ({
//   reconcileBanner: vi.fn() })) and assert vi.mocked(reconcileBanner).toHaveBeenCalledWith(ctx). Provide
//   setWidget on the fake ctx anyway (defensive) but never assert on it. This is robust to P2.M3.T1.S2.

// CRITICAL GOTCHA #2 (fake ctx surface is RICHER than checkpoint.test.ts's):
//   checkpoint.test.ts's makeCtx only scripts getBranch (the tool path). Command handlers ALSO touch
//   ctx.hasUI + ctx.ui.notify + ctx.ui.setWidget, and clearCheckpointByName scans getEntries + getLabel.
//   S3's makeCtx MUST provide: hasUI (default true), ui.{notify(msg,type), setWidget(key,content,opts)},
//   sessionManager.{getBranch(), getEntries(), getLabel(id), getLeafId()}. getLeafId is defensive (unused
//   by the paths under test today) — include it so the fake is forward-compatible.

// GOTCHA #3 (house idiom — hand-rolled fakes, NO vi.fn for Pi objects): mirror test/tools/checkpoint.test.ts.
//   Arrays captured + pushed in literal methods; return `{ labels, pi: pi as unknown as ExtensionAPI }`.
//   vi.fn IS used for MODULE mocks (banner.js) — that matches test/index.test.ts's settings.js/log.js mocks.
//   The distinction: Pi objects (pi, ctx) = hand-rolled; sibling SOURCE modules (banner) = vi.mock is fine.

// GOTCHA #4 (disabled gate fires BEFORE name validation): makeCheckpointCommand order is
//   parse name → getConfig().enabled → validCheckpointName. So disabled + invalid-name → "Mulligan is
//   disabled" (NOT "invalid checkpoint name"). Test both: a disabled+valid case (core) + a disabled+invalid
//   case (bonus, mirrors checkpoint.test.ts:326 + shrink.test.ts:213).

// GOTCHA #5 (the disabled notify has NO "Mulligan: " prefix): it is the contract-literal "Mulligan is
//   disabled" (warning). Every OTHER command notify is "Mulligan: "-prefixed. Assert each verbatim — do not
//   write a generic toContain("Mulligan") that would pass for both.

// GOTCHA #6 (hasUI guards the notify, NOT the label mutation): when hasUI=false, notify() is a no-op, but
//   setCheckpoint → pi.setLabel STILL runs (the label mutation is hasUI-independent). Bonus test: hasUI=false
//   + valid set → labels captured, notifies EMPTY. (spec/13 §2 step 5: "Guarded by ctx.hasUI" — the GUARD,
//   not the mutation.)

// GOTCHA #7 (clearCheckpointByName two-phase confirm — the APPEND-ONLY-label design): Pi's label map is
//   append-only; a revoke appends a CLEAR entry, so the raw historical SET stays in getEntries(). The helper
//   DISCOVERS candidates from raw label entries, then CONFIRMS via getLabel(id)===needle (latest-wins).
//   HIGH-VALUE bonus: script entries=[{type:'label',label:needle,targetId:'leaf-1'}] but
//   labelMap={'leaf-1':undefined} (already cleared) → clearCheckpointByName returns FALSE, no setLabel.
//   This validates the confirm phase — the whole point of the two-phase design.

// GOTCHA #8 (.js import paths — ESM/Bundler resolution): import from "../src/commands.js" (NOT .ts). Same
//   for config.js, runtime.js, banner.js. The @earendil-works/pi-coding-agent types import without extension.

// GOTCHA #9 (clearAll() + setConfig(undefined) reset): the runtime map + config cache are module-scoped.
//   beforeEach/afterEach: clearAll() + setConfig(undefined) → DEFAULT_CONFIG (enabled:true) so a prior
//   disabled test never bleeds. (checkpoint.test.ts does exactly this; copy it.)
```

## Implementation Blueprint

### Data models and structure

No new data models. S3 imports the S1 contract:
- `makeCheckpointCommand(pi): { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }`
- `makeCheckpointRevokeCommand(pi): { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }`
- `clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean`

The fakes are local to the test file (no exports). The handler returns `Promise<void>` — assert via the
captured arrays + the reconcileBanner spy AFTER awaiting the handler.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/commands.test.ts — file header, imports, vi.mock, reset, fakes
  - IMPORTS:
      import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from "vitest";
      import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
      // vi.mock banner.js BEFORE the import (hoisted) — GOTCHA #1
      vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() }));
      import { makeCheckpointCommand, makeCheckpointRevokeCommand, clearCheckpointByName } from "../src/commands.js";
      import { reconcileBanner } from "../src/banner.js";          // the mocked binding (spy target)
      import { setConfig } from "../src/config.js";                 // disabled-gate control
      import { clearAll } from "../src/runtime.js";                 // module-scoped reset (GOTCHA #9)
  - RESET (mirror checkpoint.test.ts):
      beforeEach(() => { clearAll(); setConfig(undefined); vi.mocked(reconcileBanner).mockClear(); });
      afterEach(()  => { clearAll(); setConfig(undefined); });
      // mockClear on the spy so call counts don't leak across tests (vi.mock is file-scoped → persists).
  - FAKES (copy from "Implementation Patterns" verbatim): makePi() + makeCtx().
  - HELPERS:
      async function runSet(pi, ctx, name)    { await makeCheckpointCommand(pi).handler(name, ctx); }
      async function runRevoke(pi, ctx, name) { await makeCheckpointRevokeCommand(pi).handler(name, ctx); }
  - NAMING/PLACEMENT: test/commands.test.ts (NOT test/tools/ — these are commands, not tools).

Task 2: Case (a) — set VALID → setLabel + warning notify + reconcileBanner (spec/13 §2 step 5)
  - SCRIPT: makeCtx({ branch: branchEndingInMsg("leaf-9") }) (a message entry leaf; see markers.ts walk).
  - CALL: await runSet(pi, ctx, "before-refactor").
  - ASSERT:
      expect(labels).toEqual([{ entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" }]);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toBe(
        "Mulligan: checkpoint 'before-refactor' set. Until you revoke it, the agent may rewind across " +
        "your subsequent prompts back to this point (your prompts after here can be hidden). " +
        "Revoke with /mulligan_checkpoint_revoke before-refactor.");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);  // GOTCHA #1 — spy, NOT setWidget
  - ALSO: a second it() with a different leaf id ("leaf-42") + name ("pre-experiment") to echo the id.

Task 3: Case (b) — set INVALID name → "invalid" notify, NO setLabel, NO reconcileBanner (spec/13 §2 step 1)
  - it.each over the reject set (mirror checkpoint.test.ts): ["", "With Space", "UPPER", "dot.dot", "name!",
    "a".repeat(41)].
  - CALL: await runSet(pi, ctx, name).
  - ASSERT:
      expect(labels).toHaveLength(0);
      expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toBe(
        `Mulligan: invalid checkpoint name '${name}' (lowercase, digits, hyphen, underscore; max 40)`);
  - ALSO: an it.each ACCEPT table (["a","a-b_c1","a".repeat(40),"---","123"]) → labels.length===1 + the
    warning success notify + reconcileBanner called (proves validCheckpointName parity with the tool).

Task 4: Case (c) — set DISABLED → "Mulligan is disabled", NO setLabel (spec/08 E14)
  - SCRIPT: in this describe block, beforeEach(() => setConfig({ enabled: false })); afterEach reset.
  - CALL: await runSet(pi, ctx, "valid-name").
  - ASSERT:
      expect(labels).toHaveLength(0);
      expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toBe("Mulligan is disabled");   // GOTCHA #5 — NO "Mulligan: " prefix
  - BONUS (GOTCHA #4 — disabled BEFORE name validation): runSet(pi, ctx, "BAD NAME!") → STILL
      "Mulligan is disabled", labels.length===0 (NOT the invalid-name notify).

Task 5: Case (d) — revoke EXISTING → setLabel(id, undefined) + info notify + reconcileBanner (spec/13 §3 step 5)
  - SCRIPT: makeCtx({ entries: [{ type:"label", label:"mulligan:checkpoint:before-refactor", targetId:"leaf-9" }],
      labelMap: { "leaf-9": "mulligan:checkpoint:before-refactor" } })  // active (getLabel returns the needle)
  - CALL: await runRevoke(pi, ctx, "before-refactor").
  - ASSERT:
      expect(labels).toEqual([{ entryId: "leaf-9", label: undefined }]);   // CLEAR
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("info");
      expect(notifies[0].msg).toBe(
        "Mulligan: checkpoint 'before-refactor' revoked. The agent can no longer rewind across your prompts to it.");
      expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);

Task 6: Case (e) — revoke MISSING → "no active checkpoint", NO setLabel(undefined), NO reconcileBanner (spec/13 §3 step 2)
  - SCRIPT: makeCtx({ entries: [] })  (or entries without the needle label)
  - CALL: await runRevoke(pi, ctx, "nope").
  - ASSERT:
      expect(labels).toHaveLength(0);                                       // no setLabel(undefined)
      expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();
      expect(notifies).toHaveLength(1);
      expect(notifies[0].type).toBe("info");
      expect(notifies[0].msg).toBe("Mulligan: no active checkpoint named 'nope'.");
  - ALSO: revoke disabled (setConfig({enabled:false})) → "Mulligan is disabled", labels.length===0,
      clearCheckpointByName NOT reached (the gate returns before it). Mirror the set disabled block.

Task 7: Case (f) — clearCheckpointByName UNIT (non-existent vs existing vs stale)
  - NON-EXISTENT: makeCtx({ entries: [] }); clearCheckpointByName(pi, ctx, "x") → false; labels.length===0.
  - EXISTING/ACTIVE: makeCtx({ entries:[{type:"label",label:"mulligan:checkpoint:x",targetId:"leaf-1"}],
      labelMap:{"leaf-1":"mulligan:checkpoint:x"} }); → true; labels==[{entryId:"leaf-1",label:undefined}].
  - STALE (GOTCHA #7 — two-phase confirm): same entries BUT labelMap:{"leaf-1":undefined} (already cleared)
      → false; labels.length===0. (This is the high-value case — proves the confirm phase catches stale.)
  - NEVER THROWS: makeCtx with a throwing getEntries (opts.throwOnGetEntries) → returns false, no throw.
      (clearCheckpointByName wraps getEntries in try/catch → returns false.) Add opts to makeCtx.

Task 8: BONUS — hasUI=false guard (GOTCHA #6)
  - SCRIPT: makeCtx({ hasUI: false, branch: branchEndingInMsg("leaf-9") }).
  - CALL: await runSet(pi, ctx, "before-refactor").
  - ASSERT: expect(notifies).toHaveLength(0);   // notify is hasUI-guarded
           expect(labels).toEqual([{entryId:"leaf-9",label:"mulligan:checkpoint:before-refactor"}]); // label STILL set
           expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);  // banner refresh is hasUI-independent

Task 9: BONUS — never-throws (shared command convention; mirror GOTCHA #5 in checkpoint.test.ts)
  - A throwing setLabel (makePi({throwOnSetLabel:true})) + valid set → setCheckpoint swallows → handler
      notifies "could not set checkpoint: ..." (warning); no throw. await runSet(...) resolves.
  - A throwing getBranch (makeCtx({throwOnGetBranch:true})) + valid set → same "could not set checkpoint".
  - A throwing getEntries + revoke → clearCheckpointByName returns false → "no active checkpoint" info; no throw.

Task 10: TYPES (expectTypeOf — mirror checkpoint.test.ts)
  - makeCheckpointCommand(fakePi) return: { description: string; handler: (args:string, ctx:ExtensionCommandContext)=>Promise<void> }.
  - clearCheckpointByName(pi, ctx, "x") returns boolean.
  - The handler is async → returns Promise<void>.

Task 11: VALIDATE
  - RUN: npx vitest run test/commands.test.ts   → all green (isolation).
  - RUN: npm run typecheck                       → exit 0.
  - RUN: npm test                                → full suite GREEN (no regression).
  - RUN: git status --short                      → only `?? test/commands.test.ts`.
```

### Implementation Patterns & Key Details

```typescript
// ── makePi: captures setLabel (label is string | undefined — revoke passes undefined) ───────────────
function makePi(opts: { throwOnSetLabel?: boolean } = {}) {
  const labels: { entryId: string; label: string | undefined }[] = [];
  const pi = {
    setLabel(entryId: string, label: string | undefined) {
      if (opts.throwOnSetLabel) throw new Error("setLabel boom");
      labels.push({ entryId, label });
    },
  };
  return { labels, pi: pi as unknown as ExtensionAPI };
}
// NOTE: NO registerCommand here — the factory captures pi; tests call .handler(args, ctx) directly.
// (Only test/index.test.ts's makePi needs registerCommand — S2's concern, not S3's.)

// ── makeCtx: ExtensionCommandContext minimal surface (GOTCHA #2 — RICHER than checkpoint.test.ts) ──
function makeCtx(opts: {
  hasUI?: boolean;
  branch?: unknown[];
  entries?: unknown[];
  labelMap?: Record<string, string | undefined>;
  throwOnGetBranch?: boolean;
  throwOnGetEntries?: boolean;
} = {}) {
  const notifies: { msg: string; type: string }[] = [];
  const widgets: { key: string; content: unknown; options?: unknown }[] = [];  // captured but NOT asserted (GOTCHA #1)
  const branch = opts.branch ?? [
    { type: "message", id: "u1", parentId: null, message: { role: "user", content: [] } },
    { type: "message", id: "leaf-1", parentId: "u1", message: { role: "assistant", content: [] } },
  ];
  const entries = opts.entries ?? [];
  const labelMap = opts.labelMap ?? {};
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: {
      notify(msg: string, type: string) { notifies.push({ msg, type }); },
      setWidget(key: string, content: unknown, options?: unknown) { widgets.push({ key, content, options }); },
    },
    sessionManager: {
      getBranch() { if (opts.throwOnGetBranch) throw new Error("getBranch boom"); return branch; },
      getEntries() { if (opts.throwOnGetEntries) throw new Error("getEntries boom"); return entries; },
      getLabel(id: string) { return labelMap[id]; },
      getLeafId() { return "leaf-1"; },
    },
  };
  return { notifies, widgets, ctx: ctx as unknown as ExtensionCommandContext };
}

// ── branchEndingInMsg: a branch ending in a message entry (so setCheckpoint anchors on leafMsgId) ───
function branchEndingInMsg(leafMsgId: string): unknown[] {
  return [
    { type: "message", id: "u1", parentId: null, message: { role: "user", content: [] } },
    { type: "message", id: leafMsgId, parentId: "u1", message: { role: "assistant", content: [] } },
  ];
}

// ── run helpers (the testable seam — call the handler directly) ────────────────────────────────────
async function runSet(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string) {
  await makeCheckpointCommand(pi).handler(name, ctx);
}
async function runRevoke(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string) {
  await makeCheckpointRevokeCommand(pi).handler(name, ctx);
}

// ── the banner spy assertion (GOTCHA #1 — the SINGLE most important pattern) ──────────────────────
//   vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() }));   // top of file, hoisted
//   import { reconcileBanner } from "../src/banner.js";                   // after the mock
//   ...in a test, AFTER awaiting the handler:
//   expect(vi.mocked(reconcileBanner)).toHaveBeenCalledWith(ctx);         // NOT widgets.length === 1
//   ...on a refusal/no-op path:
//   expect(vi.mocked(reconcileBanner)).not.toHaveBeenCalled();

// ── the disabled-gate describe block (GOTCHA #4 + #9) ─────────────────────────────────────────────
describe("... disabled ...", () => {
  beforeEach(() => setConfig({ enabled: false }));
  afterEach(() => setConfig(undefined));     // → DEFAULT_CONFIG: enabled:true (don't bleed)
  it("...", async () => { /* ... */ });
});
```

### Integration Points

```yaml
TEST (test/commands.test.ts — NEW):
  - vi.mock("../src/banner.js") → reconcileBanner spy (GOTCHA #1)
  - makePi() captures setLabel; makeCtx() provides hasUI/ui/sessionManager (GOTCHA #2)
  - 6 contract cases + 4 bonuses (hasUI=false, disabled-before-validation, stale two-phase, never-throws)

SOURCE: NONE modified. S3 is test-only. src/commands.ts + src/banner.ts + src/markers.ts are READ-ONLY
        (S1's landed contract; P2.M3.T1.S2 owns banner.ts's real impl).

DATABASE: none
CONFIG: setConfig({enabled:false}) / setConfig(undefined) for the disabled-gate cases (no real config file).
ROUTES: the two command NAMES (/mulligan_checkpoint, /mulligan_checkpoint_revoke) are S2's registration
        concern; S3 tests the HANDLERS, not the registration.

DOCS: [Mode A] none — test-only. The file's header comment cites spec/13 §2/§3 + the 6 case list (rides
      with the code, no separate doc file).

COORDINATION:
  - P2.M1.T1.S1 (Complete) — created src/commands.ts + src/banner.ts. S3 consumes them read-only. ✅
  - P2.M1.T1.S2 (parallel) — registers the commands in index.ts + patches test/index.test.ts makePi().
    S3 is INDEPENDENT: it calls the factory handlers directly and never touches index.ts/index.test.ts.
    No merge conflict (different files entirely).
  - P2.M3.T1.S2 (later) — implements the real reconcileBanner. S3's banner mock stays valid (it asserts
    the COMMAND calls reconcileBanner, not the banner's behavior). P2.M3.T1.S4 adds banner-behavior tests.
  - P2.M3.T1.S4 (later) — banner-behavior tests (setWidget content/placement). DISTINCT from S3 (S3 mocks
    the banner; S4 tests it). No overlap.
```

## Validation Loop

### Level 1: Type Check (after Task 1 — the make-or-break gate)

```bash
npm run typecheck    # = tsc --noEmit (strict + noImplicitAny; include: src+test)
echo "typecheck exit: $?"
# EXPECT: exit 0, no output. Proves: the ../src/commands.js import resolves with the 3 named exports;
#   makeCheckpointCommand(pi).handler is callable as (args:string, ctx:ExtensionCommandContext)=>Promise<void>;
#   the makeCtx fake is assignable to ExtensionCommandContext (the `as unknown as` cast is type-safe at the
#   call boundary); the vi.mock + vi.mocked(reconcileBanner) wiring typechecks.
# If it fails: "Property 'handler' does not exist" → wrong import / not calling the factory. "Property
#   'setLabel'/'notify' does not exist" → the fake is missing a method the handler calls. "has no exported
#   member 'X'" → typo in a named import from commands.js.
```

### Level 2: The New File in Isolation (after Tasks 2–10)

```bash
npx vitest run test/commands.test.ts
echo "exit: $?"
# EXPECT: all tests green. If a notify assertion fails with a string mismatch → re-read src/commands.ts for
#   the VERBATIM string (copy byte-for-byte; mind the '(your prompts after here can be hidden)' parenthetical
#   + the 'Revoke with /mulligan_checkpoint_revoke <name>.' suffix + the disabled message's lack of prefix).
# If reconcileBanner.toHaveBeenCalledWith fails → you forgot to await the handler, OR the mutation path
#   didn't reach reconcileBanner (re-check the gate order: disabled/invalid return BEFORE the mutation).
# If `vi.mocked(reconcileBanner).mockClear()` is missing from beforeEach → call-count leak across tests
#   (the spy is module-level; clear it per test — GOTCHA via the reset block in Task 1).
```

### Level 3: Full Suite (no regression)

```bash
npm test            # = vitest run (full suite)
echo "exit: $?"
# EXPECT: full suite GREEN. The new file adds tests; it modifies NO source, so no existing test can regress
#   from S3's diff. If an EXISTING test regresses → S3 accidentally modified a src/ file (check
#   git status --short; revert it — S3 is test-only).
```

### Level 4: Scope & Traceability Gates

```bash
# (a) Scope — exactly ONE new untracked file, ZERO modified source:
git status --short
# EXPECT: only `?? test/commands.test.ts`. If any ` M src/...` or ` M test/...other` appears, S3 went out
#   of scope — revert it.

# (b) The 6 contract cases are all present (count the describe/it blocks):
grep -cE "before-refactor|no active checkpoint|Mulligan is disabled|clearCheckpointByName" test/commands.test.ts
# EXPECT: many hits (each case references its key string/function). Spot-check the 6 cases exist:
#   (a) set valid, (b) set invalid, (c) set disabled, (d) revoke existing, (e) revoke missing, (f) clearCheckpointByName.

# (c) The banner SPY is used (GOTCHA #1 — NOT a setWidget assertion):
grep -c "vi.mocked(reconcileBanner)" test/commands.test.ts   # EXPECT: ≥3 (the spy is asserted in set/revoke + reset).
grep -cE "widgets\).*(toHaveLength|toEqual)" test/commands.test.ts   # EXPECT: 0 (NEVER assert on widgets — GOTCHA #1).

# (d) The house idiom (hand-rolled fakes, no vi.fn for Pi objects):
grep -cE "function makePi|function makeCtx" test/commands.test.ts   # EXPECT: 2 (both fakes present).
grep -cE "vi\.fn\(\)" test/commands.test.ts   # EXPECT: 1 (ONLY the banner mock — NOT for pi/ctx). If >1, you
#   used vi.fn for a Pi object (wrong — hand-roll it; GOTCHA #3).

# (e) Reset hygiene (GOTCHA #9):
grep -c "setConfig(undefined)" test/commands.test.ts   # EXPECT: ≥2 (beforeEach + afterEach).
grep -c "clearAll()" test/commands.test.ts             # EXPECT: ≥2.

# (f) The verbatim disabled message has NO prefix (GOTCHA #5):
grep -c '"Mulligan is disabled"' test/commands.test.ts   # EXPECT: ≥1 (the exact contract-literal string).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck` → exit 0.
- [ ] Level 2: `npx vitest run test/commands.test.ts` → all green.
- [ ] Level 3: `npm test` → full suite GREEN (no regression — S3 modifies no source).
- [ ] Level 4a: `git status --short` → only `?? test/commands.test.ts`.
- [ ] Level 4c: ≥3 `vi.mocked(reconcileBanner)` assertions; ZERO `widgets)` length/equal assertions (GOTCHA #1).
- [ ] Level 4d: 2 hand-rolled fakes (makePi/makeCtx); exactly 1 `vi.fn()` (the banner mock only).

### Feature Validation
- [ ] Case (a) set valid: setLabel + verbatim warning notify (spec/13 §2 step 5) + reconcileBanner spy called.
- [ ] Case (b) set invalid: verbatim "invalid" warning notify (spec/13 §2 step 1); no setLabel; no reconcileBanner.
- [ ] Case (c) set disabled: "Mulligan is disabled" (no prefix); no setLabel; no reconcileBanner.
- [ ] Case (d) revoke existing: setLabel(id, undefined) + verbatim info notify (spec/13 §3 step 5) + spy called.
- [ ] Case (e) revoke missing: verbatim "no active checkpoint" info notify (spec/13 §3 step 2); no setLabel.
- [ ] Case (f) clearCheckpointByName: false+no-setLabel (non-existent); true+setLabel(id,undefined) (existing).
- [ ] Bonus: hasUI=false → no notify but setLabel still runs (GOTCHA #6).
- [ ] Bonus: disabled-before-validation (disabled + invalid name → still disabled notify).
- [ ] Bonus: stale two-phase confirm (entries has the label but getLabel→undefined → false, no setLabel).

### Code Quality / Scope Discipline
- [ ] Created ONLY `test/commands.test.ts` (new file). Modified ZERO source files.
- [ ] Did NOT touch `test/index.test.ts` (S2's territory — S3 is independent).
- [ ] Did NOT test the banner's BEHAVIOR (setWidget content/placement) — that is P2.M3.T1.S4. S3 only asserts
      the command CALLS reconcileBanner (via spy).
- [ ] Did NOT add an integration smoke harness (Tier 2, spec/14 §2.1 F-ckptcmd — separate concern).
- [ ] Followed conventions: `.js` imports; hand-rolled Pi/ctx fakes (no vi.fn for them); vi.mock only for the
      banner module; `clearAll()` + `setConfig(undefined)` reset; verbatim string assertions; 2-space indent.

### Documentation
- [ ] File header comment cites spec/13 §2/§3 + lists the 6 contract cases + the GOTCHA #1 banner-stub note.
- [ ] No separate doc file (Mode A — test-only; docs ride with the code as comments).

## Anti-Patterns to Avoid

- ❌ Don't assert `expect(widgets).toHaveLength(1)` or any setWidget content — `reconcileBanner` is a STUB
  (P2.M3.T1.S2) and never calls setWidget. Assert the `reconcileBanner` SPY via `vi.mock("../src/banner.js")`.
  This is THE #1 trap — the item description's "(verify setWidget called)" assumes a real banner. (GOTCHA #1.)
- ❌ Don't use `vi.fn()` for the `pi` or `ctx` fakes — hand-roll them (arrays captured in literal methods),
  mirroring `test/tools/checkpoint.test.ts`. `vi.fn` is ONLY for the banner MODULE mock (matching
  `test/index.test.ts`'s settings.js/log.js). (GOTCHA #3.)
- ❌ Don't copy `test/tools/checkpoint.test.ts`'s tool-specific assertions (it tests the removed AGENT tool's
  `execute()` + `details` field). Copy ONLY the IDIOM (fakes, reset, describe/it structure, verbatim asserts).
  Command handlers return `Promise<void>` and notify via `ctx.ui` — there is no `result.content`/`details`.
- ❌ Don't forget `vi.mocked(reconcileBanner).mockClear()` in `beforeEach` — the spy is module-level and
  persists across tests; without clearing, call counts leak and `not.toHaveBeenCalled` assertions flake.
- ❌ Don't use a generic `expect(msg).toContain("Mulligan")` — the disabled message ("Mulligan is disabled")
  lacks the "Mulligan: " prefix every other notify has. Assert each string VERBATIM. (GOTCHA #5.)
- ❌ Don't assert that `setCheckpoint` is NOT called on disabled/invalid by checking a `setCheckpoint` spy —
  commands.ts calls `pi.setLabel` (via `setCheckpoint`), so assert on the captured `labels` array instead
  (`expect(labels).toHaveLength(0)`). The fake `pi` is the observation point, not `setCheckpoint`.
- ❌ Don't touch `src/` or `test/index.test.ts` — S3 is test-only and independent of S2. If you find yourself
  editing a source file, stop and revert (you've gone out of scope).
- ❌ Don't add the integration smoke harness (F-ckptcmd) here — that is Tier 2 (spec/14 §2.1), a separate item.

## Confidence Score

**9/10** for one-pass implementation success. The file is purely additive (no source risk), every fake shape
and verbatim notify string is given literally in "Implementation Patterns" + "Documentation & References", and
the three traps that would otherwise bite an implementer are called out with the exact failure symptom and
fix: (1) the banner STUB vs setWidget trap (assert the spy — GOTCHA #1, the single most important one), (2)
the richer fake-ctx surface vs the tool-test sibling (GOTCHA #2), and (3) the disabled-before-validation gate
order + the no-prefix disabled message (GOTCHAs #4/#5). The 1-point reserve covers the small chance the
implementer literal-copies the item description's "(verify setWidget called)" before reading GOTCHA #1 — but
the correction is stated in-place in 4 places, so recovery is one assertion edit. The two-phase `clearCheckpointByName`
stale-label bonus (GOTCHA #7) is the highest-value case and is fully specified.