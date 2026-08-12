# PRP — P2.M3.T1.S4: Tests for the banner + filter regression

> **Mode A — test-only.** No source changes, no docs. Two deliverables: a NEW `test/banner.test.ts`
> and a regression `it` appended to `test/filter.test.ts`.

---

## Goal

**Feature Goal**: Lock in the v1.1 active-checkpoint banner (`reconcileBanner`, spec/13 §5 / spec/08 E26)
with a deterministic, fast (no real Pi) Vitest suite that proves every `reconcileBanner` branch behaves
per spec AND that the banner's defense-in-depth hook in `filter.ts`'s `contextHandler` tail is a pure
UI-only side effect — the filtered message list is byte-identical with or without the hook.

**Deliverable**:
1. `test/banner.test.ts` (NEW) — hand-rolled fake `ctx`, calls the REAL `reconcileBanner`, asserts on the
   `setWidget` call capture. Covers all banner paths.
2. `test/filter.test.ts` (MODIFY, additive) — one new `it` in the `contextHandler` describe proving the
   messages array is unchanged by the tail `reconcileBanner(ctx)` call and contains zero banner bytes.

**Success Definition**: `npx vitest run test/banner.test.ts test/filter.test.ts` is green, the full
suite (`npm test`) stays green (no regressions from the filter.test.ts edit), and `npm run typecheck`
passes.

## Why

- The banner grants the user a persistent reminder of an armed destructive power (cross-prompt rewind).
  A silent regression that dropped the banner — or worse, leaked it into `event.messages` — would defeat
  the feature or silently cost model-context tokens. These tests are the guardrail.
- `reconcileBanner` is invoked on **every** `context` fire (spec/13 §5 refresh point 3, defense-in-depth),
  so it is on the hottest path. A throw or message-leak there breaks every turn. The tests pin
  fail-open + zero-context-cost behavior.
- The filter-regression test closes the gap opened by P2.M3.T1.S3 wiring `reconcileBanner` into the
  `contextHandler` tail: it asserts the new call cannot mutate the filter's primary output.

## What

### Visible behavior (test scope)
- `reconcileBanner(ctx)` owns the `"mulligan:active-checkpoint"` above-editor widget as its SINGLE writer.
- It is the only function that may call `ctx.ui.setWidget("mulligan:active-checkpoint", …)`.
- It never throws; never injects into `event.messages`.

### Success Criteria
- [ ] `test/banner.test.ts` covers branches (a) SET, (b) revoke/consume→clear, (c) knob-off→clear, (d)
      hasUI=false→no-op, (f) multiple-active→multiple lines, plus a never-throws guard.
- [ ] `test/banner.test.ts` asserts the EXACT verbatim banner line + `{ placement: "aboveEditor" }` option.
- [ ] `test/filter.test.ts` proves `contextHandler`'s returned `messages` is deep-equal whether the banner
      fires (hasUI:true) or no-ops (no hasUI), AND that `JSON.stringify(messages)` contains 0 occurrences
      of `"mulligan:active-checkpoint"` and the banner warning text.
- [ ] Full suite green; typecheck clean.

---

## All Needed Context

### Context Completeness Check
_Pass:_ an agent with zero prior knowledge of this repo can implement both files from this PRP alone —
the exact `reconcileBanner` source, the `listCheckpoints` entry format, the makeCtx idioms, the verbatim
banner string, and the precise regression-test design are all inlined below.

### Documentation & References

```yaml
- file: src/banner.ts
  why: THE SUT for banner.test.ts. Read it fully — it is short and self-documenting.
  pattern: 4-branch reconcileBanner(ctx): !hasUI→noop; !knob→clear; 0 active→clear; ≥1 active→set lines.
  critical: |
    BANNER_WIDGET_KEY = "mulligan:active-checkpoint" is a module-PRIVATE const (NOT exported) — tests
    MUST use the string literal. The banner line contains the U+26A0 emoji '⚠' — copy it byte-for-byte
    from banner.ts L63 (do NOT retype from memory). reconcileBanner reads ONLY ctx.hasUI,
    ctx.ui.setWidget, ctx.sessionManager.getEntries — that is the full surface the fake ctx must provide.

- file: src/tools/audit.ts   (function listCheckpoints, L356)
  why: reconcileBanner reuses listCheckpoints to discover active checkpoints. Tests must hand-roll
        label entries in exactly the shape listCheckpoints consumes, else a "set" will read as inactive.
  pattern: |
    It scans entries for { type:"label", targetId:<non-empty string>, label:<string starting with
    "mulligan:checkpoint:"> }. Two-phase latest-wins: a LATER entry with the SAME targetId but a
    different/undefined label CLEARS the checkpoint. Returns names (prefix stripped), first-occurrence
    order, deduped.
  gotcha: |
    To simulate a CONSUMED/REVOKED checkpoint, append a second entry with the same targetId and a
    different label (or label:undefined). An empty entries array also yields 0 active.

- file: src/filter.ts   (contextHandler tail, L42 import + L434-446 hook)
  why: Confirms WHERE reconcileBanner is hooked and that `messages` is computed BEFORE it runs.
  pattern: |
    ... filterPipeline builds `messages` ... then:
      try { reconcileBanner(ctx); } catch { /* E13 */ }
      return { messages: messages as ... };
    messages is returned UNCHANGED by the banner call.
  critical: The regression test hinges on this: reconcileBanner's ONLY effect is a ctx.ui.setWidget
            side effect; the `messages` variable is untouched.

- file: src/config.ts   (getConfig L206, setConfig L221; default ui.activeCheckpointBanner:true L176)
  why: banner branch (c) needs the knob OFF. Reset idiom is setConfig(undefined) → defaults.
  gotcha: |
    Verify whether setConfig deep-merges a partial onto DEFAULT_CONFIG or replaces wholesale. If it
    merges, setConfig({ ui:{ activeCheckpointBanner:false } }) is enough. If it replaces, pass the full
    config object with enabled:true. READ setConfig (L221-236) before writing branch (c).

- file: test/commands.test.ts   (makeCtx L104-168; header L1-94 for the mock/reset idiom)
  why: The closest sibling. Its makeCtx returns { notifies, widgets, ctx } with hasUI + ui.setWidget
        spy + sessionManager.{getBranch,getEntries,getLabel,getLeafId,getSessionId,buildContextEntries}.
        MODEL banner.test.ts's makeCtx on this (drop the keys reconcileBanner never reads if you like,
        but hasUI + ui.setWidget + sessionManager.getEntries are mandatory).
  critical: |
    commands.test.ts vi.mocks("../src/banner.js") and asserts the vi.mocked(reconcileBanner) SPY — it
    does NOT assert widgets. banner.test.ts MUST DO THE OPPOSITE: do NOT mock banner.js; import the REAL
    reconcileBanner and assert on widgets[]. Getting this backwards is the #1 trap.

- file: test/filter.test.ts   (header L1-44 mocks transforms.js; makeCtx L104-135 returns BARE ctx;
        contextHandler describe L387-532)
  why: The regression test appends an `it` here. The existing makeCtx has NO hasUI/ui (so reconcileBanner
        no-ops in every current test). The mocked filterPipeline returns the module-level `pipelineReturn`.
  gotcha: |
    Do NOT change makeCtx's return shape (bare ctx) — ~40 call sites depend on it. Build the hasUI:true
    ctx LOCALLY inside the new test (copy the shape from commands.test.ts makeCtx).

- file: src/runtime.ts   (clearAll export)
  why: Module-scoped runtime reset in beforeEach/afterEach (idiom from commands.test.ts).
```

### Current Codebase tree (relevant slice)

```
src/
  banner.ts          # SUT — reconcileBanner(ctx): void  [implemented by P2.M3.T1.S2]
  config.ts          # getConfig/setConfig; ui.activeCheckpointBanner default true
  filter.ts          # contextHandler; tail hook try{reconcileBanner(ctx)}catch{}; return {messages}
  runtime.ts         # clearAll()
  tools/audit.ts     # listCheckpoints(entries): string[]  (reused by reconcileBanner)
test/
  banner.test.ts     # NEW — this item
  filter.test.ts     # MODIFY (append one regression it) — this item
  commands.test.ts   # REFERENCE — makeCtx idiom (hasUI/ui.setWidget) + reset idiom
```

### Desired Codebase tree (delta)

```
test/banner.test.ts   # NEW — ~6-8 it() covering reconcileBanner branches (a)-(f) + never-throws
test/filter.test.ts   # +1 it() in contextHandler describe — messages unchanged + 0 banner bytes
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL #1 — banner.test.ts must NOT vi.mock("../src/banner.js"). Import the REAL function and
// assert on the widgets[] capture. (commands.test.ts does the opposite because it tests command
// handlers, not reconcileBanner itself. Mirror it for makeCtx shape + reset idiom ONLY.)

// CRITICAL #2 — BANNER_WIDGET_KEY is module-private in banner.ts (not exported). Use the literal
// "mulligan:active-checkpoint" in every assertion. Do not import a key that does not exist.

// CRITICAL #3 — the banner line uses the emoji '⚠' (U+26A0) and is byte-exact. COPY it from
// src/banner.ts L63. An assertion typed with a different dash/quote/emoji will fail.

// CRITICAL #4 — setWidget CLEAR calls pass content:undefined with NO options arg:
//   ctx.ui.setWidget("mulligan:active-checkpoint", undefined)
// → widgets[0] = { key:"mulligan:active-checkpoint", content:undefined, options:undefined }.
//   SET calls pass THREE args: ctx.ui.setWidget(key, lines[], { placement:"aboveEditor" }).

// CRITICAL #5 — listCheckpoints latest-wins: a consumed checkpoint is NOT active. To test branch (b)
// "after revoke/consumption (no active)", either use an empty entries array OR append a same-targetId
// clear entry. The item's "(b) after revoke/consumption (no active checkpoints)" is satisfied by 0
// active names — assert setWidget(KEY, undefined).

// CRITICAL #6 — reconcileBanner NEVER throws (whole-body try/catch). The never-throws test must FORCE
// a throw inside ctx (e.g. getEntries throws, or ui.setWidget throws) and assert reconcileBanner
// returns void with no exception propagated. Use expect(() => reconcileBanner(ctx)).not.toThrow().

// CRITICAL #7 — filter.test.ts makeCtx returns BARE ctx (no hasUI/ui). The regression test must NOT
// edit makeCtx; build the hasUI:true ctx locally (mirror commands.test.ts makeCtx shape).
```

---

## Implementation Blueprint

### Data models and structure

No data models. The only "models" are the hand-rolled fake `ctx` objects. Two shapes:

```ts
// banner.test.ts — fake ctx (modeled on commands.test.ts makeCtx). reconcileBanner reads ONLY:
//   ctx.hasUI, ctx.ui.setWidget, ctx.sessionManager.getEntries
type FakeCtx = {
  hasUI: boolean;
  ui: { setWidget(key: string, content: unknown, options?: unknown): void };
  sessionManager: { getEntries(): unknown[]; getLabel?(id: string): string | undefined };
};
// Returned helper: { widgets, ctx } where widgets captures every setWidget call as {key,content,options}.

// filter.test.ts — local hasUI:true ctx for the ONE regression test (do NOT touch makeCtx):
const widgets: { key: string; content: unknown; options?: unknown }[] = [];
const ctxWithBanner = {
  hasUI: true,
  ui: { setWidget: (k: string, c: unknown, o?: unknown) => widgets.push({ key: k, content: c, options: o }) },
  sessionManager: {
    getSessionId: () => "reg",
    getEntries: () => [checkpointLabelEntry],   // active checkpoint → banner fires
    getBranch: () => [],
  },
};
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the three source files you depend on (banner.ts, tools/audit.ts listCheckpoints, filter.ts tail)
  - READ src/banner.ts fully (the SUT — short, self-documenting).
  - READ src/tools/audit.ts listCheckpoints (L356-409) for the exact label-entry shape.
  - READ src/filter.ts L434-446 to confirm messages is computed before reconcileBanner.
  - READ src/config.ts setConfig (L221-236) to learn whether setConfig MERGES or REPLACES (decides branch-c shape).
  - DO NOT proceed to Task 2 until you can recite the verbatim banner line + the 4-branch order.

Task 2: CREATE test/banner.test.ts
  - IMPORT (ESM .js): { describe, it, expect, beforeEach, afterEach } from "vitest";
                      { reconcileBanner } from "../src/banner.js";
                      { setConfig } from "../src/config.js";
                      { clearAll } from "../src/runtime.js";
    DO NOT vi.mock banner.js. DO NOT import contextHandler or filter.
  - RESET (mirror commands.test.ts): beforeEach/afterEach → clearAll(); setConfig(undefined);
    (setConfig(undefined) → DEFAULT_CONFIG: enabled:true, ui.activeCheckpointBanner:true.)
  - FAKE CTX helper (model on commands.test.ts makeCtx; only the fields reconcileBanner reads):
      function makeBannerCtx(opts:{ hasUI?:boolean; entries?:unknown[] } = {}) {
        const widgets:{key,content,options?}[] = [];
        const ctx = {
          hasUI: opts.hasUI ?? true,
          ui: { setWidget(k,c,o?){ widgets.push({key:k,content:c,options:o}); } },
          sessionManager: { getEntries: () => opts.entries ?? [] },
        };
        return { widgets, ctx: ctx as unknown as ExtensionContext };
      }
  - SHARED literal (avoid drift): copy the verbatim line from banner.ts:
      const BANNER_KEY = "mulligan:active-checkpoint";
      const line = (name:string) =>
        `⚠ Mulligan checkpoint active: "${name}" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke ${name}`;
    (Define `const SET_ENTRY = (id,name) => ({ type:"label", targetId:id, label:"mulligan:checkpoint:"+name });`
     and `const CLEAR_ENTRY = (id) => ({ type:"label", targetId:id, label:undefined });`.)
  - TESTS (one it per branch, verbatim-string assertions):
    (a) "SET (≥1 active) → setWidget(key, [line(name)], {placement:'aboveEditor'})":
        entries:[SET_ENTRY("leaf-1","before-refactor")];
        reconcileBanner(ctx); expect(widgets).toHaveLength(1);
        expect(widgets[0]).toEqual({ key:BANNER_KEY, content:[line("before-refactor")], options:{placement:"aboveEditor"} });
    (b) "revoke/consumption (0 active) → setWidget(key, undefined)":
        entries:[];   // (or [SET_ENTRY("l","x"), CLEAR_ENTRY("l")] for the consume case)
        reconcileBanner(ctx); expect(widgets).toEqual([{ key:BANNER_KEY, content:undefined, options:undefined }]);
    (c) "knob ui.activeCheckpointBanner=false → setWidget(key,undefined) EVEN with an active checkpoint":
        setConfig({ ui:{ activeCheckpointBanner:false } });   // IF setConfig merges; else pass full config
        entries:[SET_ENTRY("leaf-1","x")];
        reconcileBanner(ctx); expect(widgets).toEqual([{ key:BANNER_KEY, content:undefined, options:undefined }]);
        (afterEach resets to defaults, so no leak.)
    (d) "hasUI=false → NO setWidget call (no-op)":
        makeBannerCtx({ hasUI:false, entries:[SET_ENTRY("leaf-1","x")] });
        reconcileBanner(ctx); expect(widgets).toHaveLength(0);
    (f) "multiple active → multiple lines, one per checkpoint, in listCheckpoints order":
        entries:[SET_ENTRY("leaf-1","alpha"), SET_ENTRY("leaf-2","beta")];
        reconcileBanner(ctx); expect(widgets[0].content).toEqual([line("alpha"), line("beta")]);
        expect(widgets[0].options).toEqual({placement:"aboveEditor"});
    (never-throws guard): "reconcileBanner NEVER throws — a throwing getEntries is swallowed":
        ctx where ui.setWidget throws OR sessionManager.getEntries throws;
        expect(() => reconcileBanner(ctx)).not.toThrow();
        (setWidget-throw variant: makeWidgetThrow → assert no throw + (banner logged).)
  - NAMING: snake/camel consistent with siblings; describe "reconcileBanner — spec/13 §5 / spec/08 E26".
  - PLACEMENT: test/banner.test.ts (top level).

Task 3: MODIFY test/filter.test.ts — append ONE regression `it` to the contextHandler describe (ends L532)
  - LOCATE: the `describe("contextHandler — disabled pass-through, transform+cache, fail-open …")` block
    (L387) — its last `it` ends ~L530, block closes L532 `});`. Insert the new `it` BEFORE that closing.
  - DO NOT edit makeCtx (bare-ctx return is load-bearing for ~40 sites).
  - NEW `it` design — "reconcileBanner at the contextHandler tail is UI-only: messages array is unchanged
        AND contains zero banner bytes (P2.M3.T1.S4 / spec/13 §5, E26 acceptance (d))":
      1. checkpointEntry = { type:"label", targetId:"leaf-1", label:"mulligan:checkpoint:x" };
      2. pipelineReturn = [{ role:"assistant", content:[{type:"text",text:"hello"}] }];  // known filtered view
      3. CONTROL (no hasUI → reconcileBanner no-ops): use the existing makeCtx({ entries:[checkpointEntry] }).
         const resultControl = contextHandler(pi, {type:"context",messages:[]}, controlCtx) as {messages:unknown[]};
      4. TREATMENT (hasUI:true → banner fires): build a LOCAL ctx (see Data models above) with
         hasUI:true + ui.setWidget spy + sessionManager.getEntries→[checkpointEntry].
         const resultWith = contextHandler(pi, {type:"context",messages:[]}, treatmentCtx) as {messages:unknown[]};
      5. ASSERT (a) the hook fired: expect(widgets).toHaveLength(1);
              expect(widgets[0].key).toBe("mulligan:active-checkpoint");
              expect(widgets[0].options).toEqual({placement:"aboveEditor"});   // banner DID render
         (b) THE REGRESSION: expect(resultWith.messages).toEqual(resultControl.messages);
              (messages identical whether or not the banner hook ran)
         (c) ZERO banner bytes (E26 acceptance d): const j = JSON.stringify(resultWith.messages);
              expect(j).not.toContain("mulligan:active-checkpoint");
              expect(j).not.toContain("Mulligan checkpoint active");
  - GOTCHA: reset module state between the control and treatment calls if needed (the existing tests
    already manage pipelineCalls/pipelineReturn; set pipelineReturn before EACH contextHandler call).
  - RESET: rely on the file's existing beforeEach/afterEach (clearAll + setConfig(undefined)).
  - NAMING: prefix the `it` title with "(P2.M3.T1.S4)" so it is attributable.

Task 4: VALIDATE
  - npx vitest run test/banner.test.ts -v
  - npx vitest run test/filter.test.ts -v
  - npm test            (full suite green — the filter.test.ts edit must not regress anything)
  - npm run typecheck   (tsc --noEmit clean)
```

### Implementation Patterns & Key Details

```ts
// banner.test.ts — the never-throws guard (reconcileBanner swallows everything; banner.ts L67-72 logs)
it("never throws — a throwing ui.setWidget is swallowed (spec/13 §5)", () => {
  const boomCtx = {
    hasUI: true,
    ui: { setWidget() { throw new Error("setWidget boom"); } },
    sessionManager: { getEntries: () => [SET_ENTRY("l", "x")] },
  } as unknown as ExtensionContext;
  expect(() => reconcileBanner(boomCtx)).not.toThrow();
});

// filter.test.ts — the regression control vs treatment. The KEY insight: filter.test.ts MOCKS transforms.js
// so filterPipeline returns `pipelineReturn`. contextHandler returns exactly that array. reconcileBanner
// runs AFTER and never touches it. Deep-equality proves the hook is side-effect-only on messages.
const checkpointEntry = { type: "label", targetId: "leaf-1", label: "mulligan:checkpoint:x" };
pipelineReturn = [{ role: "assistant", content: [{ type: "text", text: "filtered" }] }];
const controlCtx = makeCtx({ entries: [checkpointEntry] });            // no hasUI → banner no-ops
const resultControl = contextHandler(pi, { type: "context", messages: [] }, controlCtx);
const widgets: { key: string; content: unknown; options?: unknown }[] = [];
const treatmentCtx = {
  hasUI: true,
  ui: { setWidget: (k: string, c: unknown, o?: unknown) => widgets.push({ key: k, content: c, options: o }) },
  sessionManager: { getSessionId: () => "reg", getEntries: () => [checkpointEntry], getBranch: () => [] },
} as unknown as ExtensionContext;
pipelineReturn = [{ role: "assistant", content: [{ type: "text", text: "filtered" }] }]; // SAME view
const resultWith = contextHandler(pi, { type: "context", messages: [] }, treatmentCtx);
expect(widgets).toHaveLength(1);                              // banner fired
expect(resultWith).toEqual(resultControl);                    // ← THE REGRESSION: messages identical
expect(JSON.stringify(resultWith)).not.toContain("mulligan:active-checkpoint"); // 0 banner bytes
expect(JSON.stringify(resultWith)).not.toContain("Mulligan checkpoint active");
```

### Integration Points

```yaml
TEST REGISTRATION:
  - none — vitest auto-discovers test/*.test.ts (default glob). No config edit.
MODULE STATE:
  - clearAll() (runtime.js) + setConfig(undefined) in beforeEach/afterEach — mirror commands.test.ts.
NO SOURCE CHANGES:
  - This item writes ONLY test files. banner.ts / filter.ts / config.ts are READ-ONLY here.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After writing banner.test.ts
npm run typecheck          # tsc --noEmit — catch .js import / type-cast errors
npx vitest run test/banner.test.ts -v

# After editing filter.test.ts
npm run typecheck
npx vitest run test/filter.test.ts -v
# Expected: zero TS errors; banner.test.ts green; filter.test.ts green (existing + new it).
```

### Level 2: Component Validation (the new tests)

```bash
# Banner — every branch
npx vitest run test/banner.test.ts -v
# Expect: (a),(b),(c),(d),(f) + never-throws all PASS.

# Filter regression — messages unchanged + 0 banner bytes
npx vitest run test/filter.test.ts -v
# Expect: the new "(P2.M3.T1.S4)" it PASSES alongside all existing contextHandler tests.
```

### Level 3: System Validation (full suite — guard against collateral damage)

```bash
# The filter.test.ts edit is the only mutation to an existing file — run EVERYTHING to be sure.
npm test
# Expected: all test files green (banner, filter, commands, config, edge-cases, transforms, …).
npm run typecheck
# Expected: clean.
```

### Level 4: Domain-Specific Validation (contract acceptance)

```bash
# Re-run only the two deliverables together for a clean contract proof:
npx vitest run test/banner.test.ts test/filter.test.ts -v
# Expected: all green. This single command IS the E26/F-banner acceptance proof.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean (tsc --noEmit)
- [ ] `npx vitest run test/banner.test.ts` green
- [ ] `npx vitest run test/filter.test.ts` green (incl. new regression it)
- [ ] `npm test` full suite green

### Feature Validation (contract (a)-(f) + regression)
- [ ] (a) SET → setWidget(key, [line(name)], {placement:"aboveEditor"})
- [ ] (b) 0 active → setWidget(key, undefined)
- [ ] (c) knob=false → setWidget(key, undefined) even when active
- [ ] (d) hasUI=false → NO setWidget
- [ ] (e) 0 banner bytes in contextHandler return (filter.test.ts)
- [ ] (f) multiple active → multiple lines
- [ ] never-throws guard
- [ ] regression: `resultWith.messages` deep-equal `resultControl.messages`

### Code Quality Validation
- [ ] banner.test.ts does NOT vi.mock banner.js (uses REAL reconcileBanner)
- [ ] filter.test.ts makeCtx return shape UNCHANGED (regression test builds local ctx)
- [ ] banner line copied verbatim from banner.ts (emoji ⚠ intact)
- [ ] widget key uses literal `"mulligan:active-checkpoint"` (const is private)
- [ ] reset idiom (clearAll + setConfig(undefined)) present in banner.test.ts
- [ ] new filter `it` titled with `(P2.M3.T1.S4)` for traceability

---

## Anti-Patterns to Avoid

- ❌ Do NOT `vi.mock("../src/banner.js")` in banner.test.ts — you must test the REAL function, asserting on
  the `widgets[]` capture. (commands.test.ts mocks it; that is correct for ITS scope, wrong for yours.)
- ❌ Do NOT import a `BANNER_WIDGET_KEY` symbol — it is module-private. Use the string literal.
- ❌ Do NOT retype the banner line from memory — the `⚠`/quotes/`/mulligan_checkpoint_revoke` must be
  byte-exact. Copy from src/banner.ts.
- ❌ Do NOT change `filter.test.ts`'s `makeCtx` return shape to expose `widgets` — it is load-bearing for
  ~40 call sites. Build the hasUI ctx locally in the one new test.
- ❌ Do NOT assert `setWidget` CLEAR calls carry `{placement:"aboveEditor"}` — CLEAR passes only
  `(key, undefined)` (2 args, options undefined). Only SET carries the options object.
- ❌ Do NOT simulate "active checkpoint" with a bare string in entries — listCheckpoints needs
  `{type:"label", targetId, label:"mulligan:checkpoint:<name>"}`. A wrong shape silently yields 0 active.
- ❌ Do NOT skip the never-throws guard — reconcileBanner is on the every-context-fire hot path; a throw
  there would break every turn. Force a throw and assert it is swallowed.

---

## Confidence Score: 9/10

The SUT (`banner.ts`) and the hook site (`filter.ts` tail) are already implemented and read in full;
the test idioms (commands.test.ts makeCtx, filter.test.ts mocked pipeline) are established; and the
regression invariant (messages computed before reconcileBanner) is verified by reading the tail. The
only residual uncertainty is whether `setConfig` merges vs replaces (flagged in Task 1 + config.ts
gotcha) — a 30-second read resolves it. One-pass success is highly likely.