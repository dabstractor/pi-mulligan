# PRP — P4.M1.T3.S1: Retry-cap + context-fraction + config-knob unit tests

**Parent**: P4.M1.T3 (Tests). This is the **TEST-ONLY** item that locks in the two E22 hard backstops
implemented in P4.M1.T2.S1 (per-prompt retry budget) + P4.M1.T2.S2 (context-fraction stop) and the two
config knobs from P4.M1.T1.S1. It adds **zero source code** — only tests + one integration-scenarios note.
It assumes S1+S2+S3 all land as specified.

**Spec refs**: `spec/08-edge-cases.md` E22 acceptance (a)–(g); `spec/10-test-strategy.md` §1.10; `spec/09-configuration.md` §4.

---

## Goal

**Feature Goal**: Deterministically cover the spec/08 E22 acceptance criteria (a)–(g) and the spec/10 §1.10
retry-cap / context-fraction guard behavior with unit tests that drive the REAL `makeRewindTool` against the
existing `makePi`/`makeCtx` fakes — and cover the two config knobs' validation rules in `test/config.test.ts`.
Every refusal text, every budget boundary, the new-prompt reset, the context-fraction stop, and the
"shrink/audit/checkpoint/cancel remain callable" invariant must be asserted. All refusals must be shown to
return a text block and never throw.

**Deliverable**:
1. `test/tools/rewind.test.ts` — (i) EXTEND `makeCtx` with an optional `contextUsage:{contextWindow:number}`
   opt (additive — scripts `ctx.getContextUsage` so the context-fraction guard can read `.contextWindow`);
   (ii) add `getRuntime` to the existing `../../src/runtime.js` import; (iii) ADD new `describe` blocks
   (a)–(f) covering the retry budget, zero-hide counting, new-prompt reset, non-rewind tools unaffected,
   context-fraction stop, and never-throw/never-block-text. **No existing `describe`/`it` is touched.**
2. `test/config.test.ts` — ADD one new `describe` block (g) asserting `validateConfig` coercion for
   `rewind.maxRetriesPerPrompt` + `rewind.abortContextFraction`.
3. `test/integration/scenarios.md` — ADD two short sections (`F-retrycap`, `F-abortfraction`) mirroring the
   existing `F-maxdepth` format, marked "deterministic path documented, not auto-run".

**Success Definition**: `npx vitest run` is fully green (all currently-passing tests — 866 at HEAD — stay green,
plus the new tests pass). The §1.10 / E22 acceptance (a)–(g) is covered by named, passing tests. The `makeCtx`
extension introduces **no regression** (the `contextUsage` opt defaults to absent → `computeFilteredTotal`
returns `windowTokens:0` → the (4c) guard is skipped exactly as today).

## User Persona

**Target User**: Maintainer / future implementer of the Mulligan runaway-loop backstops. (Tests are not
user-facing — Mode A docs.)

**Use Case**: Regression protection — guarantees the E22 hard backstops behave as specified across refactors,
and documents (via the integration-scenarios note) how to reproduce them live.

---

## Why

- E22 is the **most severe** Mulligan failure mode (resource runaway → "Prompt too long" hard stop). Its two
  hard backstops (retry budget + context-fraction stop) MUST be guarded by deterministic tests so a future
  change cannot silently weaken them. The guards landed in P4.M1.T2.S1/S2; this item proves them.
- The spec (§1.10 / E22 (g)) explicitly requires: "unit test: drive a loop that rewinds `last_turn` at the same
  prompt repeatedly and assert the call refuses exactly at the budget with the named text, and that a subsequent
  new user prompt restores the budget." That is the contract these tests fulfill.
- The two config knobs have non-trivial coercion (Math.floor on retries; open-closed range on the fraction);
  pinning the exact coercion outcomes prevents a silent default change.

## What

- **User-visible behavior**: none (tests + an internal note). [Mode A] no README / config-table change.
- **Technical requirement**: new Vitest `describe`/`it` blocks that (a) refuse at the retry budget with the
  exact text and persist nothing; (b) prove a zero-hide rewind still counts; (c) prove a new user prompt resets
  the budget; (d) prove `mulligan_shrink` (and by extension audit/checkpoint/cancel) remain callable after the
  budget is hit; (e) prove the context-fraction stop refuses even when the budget remains, while shrink stays
  callable; (f) prove the new helpers are defensive (throwing getEntries / throwing getContextUsage → no crash,
  guard skipped) and every refusal returns a `text` content block; (g) prove the config-knob coercion.

### Success Criteria

- [ ] (a) With `maxRetriesPerPrompt:3` and entries `[user, rewind×3]`, a `last_turn` rewind is refused with text
      containing `"per-prompt retry budget"` and `"3/3"`, and `appended.length === 0`.
- [ ] (b) A zero-hide rewind marker (one that hid nothing) still counts toward the budget.
- [ ] (c) A LATER user message after the rewind markers resets the budget → the next rewind succeeds
      (`appended.length > 0`).
- [ ] (d) After the budget is hit (rewind refused), `mulligan_shrink` returns a non-refusal result.
- [ ] (e) With filtered context ≥ `abortContextFraction` of the window, a rewind is refused with text containing
      `"context is at"` and `"% of the window"` even though the budget remains; `mulligan_shrink` still callable.
- [ ] (f) `throwOnGetEntries` / a throwing `getContextUsage` → the guards are skipped (no crash) and every
      refusal result is `content:[{type:"text",...}]`.
- [ ] (g) `validateConfig` coercion for both knobs matches the table in the Blueprint exactly.
- [ ] All previously-passing tests stay green; the `makeCtx` extension causes no regression.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_
**Yes** — the exact guard logic, refusal strings, `makePi`/`makeCtx` shapes, helper functions, test idioms, and
config-coercion outcomes are all pinned below with verified line anchors and the exact assertion values.

### Documentation & References

```yaml
# MUST READ — the spec acceptance these tests must cover
- url: spec/08-edge-cases.md §E22 (Acceptance bullets a–g)
  why: Defines the EXACT behaviors (a)–(g) each test block maps to. The refusal text templates live here too.
  critical: (a) Nth (== budget) rewind refuses with the named text; (b) advancing to a new prompt restores the
        budget; (c) a ZERO-HIDE rewind still consumes budget; (d) shrink/audit/checkpoint/cancel remain callable;
        (e) context-fraction refuses even when budget remains; (f) reaching the budget never throws (E13) and
        never prevents a normal text reply; (g) the named unit test driving the loop.
- url: spec/10-test-strategy.md §1.10 "Retry-cap & context-fraction guards (E22)"
  why: The Tier-1 unit-test contract for these guards (mirror of E22 acceptance, framed as test cases).
- url: spec/09-configuration.md §4 (validation rules for the two knobs)
  why: "rewind.maxRetriesPerPrompt: integer ≥ 1; non-integer or <1 → default." "rewind.abortContextFraction:
        number in (0,1]; out of range or non-number → default." These are the rules test (g) asserts.

# Architecture research (verified against HEAD) — THE blueprint for this task
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md
  section: "§7 Test patterns (grounded)" (lines 217–249) + "§2 countRetriesAtLatestPrompt" (lines 60–90)
  why: §7 explicitly says makeCtx does NOT script getContextUsage and that T3.S1 test (e) MUST add the opt;
        gives the exact test idiom (`makePi`/`makeCtx`/`run`/`firstText`). §2 pins the helper's defensive shape.

# The source under test (READ-ONLY — do not modify; only drive via the tool)
- file: src/tools/rewind.ts
  why: The (4b) retry-budget + (4c) context-fraction guards live here. You assert their behavior, not edit them.
  pattern: guard order = E14 → rewind.enabled → E9 note → checkpoint/E10 → E4 maxDepth → (4b) retry budget →
        (4c) context-fraction → preview → success. FIRST refusal wins.
  gotcha: countRetriesAtLatestPrompt finds the LAST `type:"message" && message.role==="user"` entry, then counts
        `type:"custom" && customType==="mulligan:rewind"` entries AFTER it. It does NOT inspect hideEntryIds →
        a zero-hide marker counts the same as any other (basis for test b). It is defensive: throwing getEntries → 0.
- file: src/tools/audit.ts
  why: Exports `computeFilteredTotal(ctx)` which the (4c) guard calls. windowTokens = ctx.getContextUsage()?.contextWindow ?? 0;
        totalTokens = estimateTokens(rt.lastFiltered ?? entriesToMessages(buildContextEntries())).tokens. Wrapped in
        try/catch → {0,0} sentinel → guard SKIPS when windowTokens===0. (basis for test e and test f)
- file: src/config.ts
  why: `validateConfig` (pure) + `setConfig` (cache reset used in beforeEach). The two knobs' coercion lives here.

# The test files to edit (READ FULLY before editing)
- file: test/tools/rewind.test.ts
  why: The fakes + helpers to reuse + the describe blocks NOT to duplicate. EXTEND makeCtx (add contextUsage opt)
        and add getRuntime to the runtime import; ADD new describe blocks (a)–(f).
  pattern: `const {appended,pi}=makePi(); const {ctx}=makeCtx({entries:[...]}); const res=await run(pi,ctx,{note:VALID_NOTE,granularity:"last_turn"});`
        then assert `firstText(res)` + `appended.length`. Refusals → `appended.length===0`. Reset config with
        `setConfig({rewind:{...}})` at the start of each `it` (beforeEach already does `setConfig(undefined)`).
  gotcha: `makeCtx` returns `{ctx:{sessionManager} as unknown as ExtensionContext}`. To script getContextUsage,
        attach `getContextUsage:()=>contextUsage` to the **ctx** object (alongside sessionManager), NOT to
        sessionManager — computeFilteredTotal reads `ctx.getContextUsage?.()`.
- file: test/config.test.ts
  why: Mirror the dedicated-describe style (see the `shrink.maxActive ...` block at line 233): a describe titled
        with the work-item tag + `(a)/(b)/(c)` `it` labels, using `vi.spyOn(console,"warn")` for warn assertions.
  pattern: `validateConfig({rewind:{...}}).rewind.maxRetriesPerPrompt` etc. DEFAULTS (5/0.9) are already asserted
        at lines 20–21 and 78 — DO NOT duplicate; (g) asserts the COERCION LOGIC.
- file: test/tools/shrink.test.ts
  why: Reference for the valid `mulligan_shrink` call used in test (d). Import `makeShrinkTool` from
        `../../src/tools/shrink.js`; mirror that file's valid-call shape. Shrink never consults the retry budget.

# Sibling PRPs (assume landed as specified) — define the guard surfaces under test
- file: plan/004_d3d84055c5b2/P4M1T2S1/PRP.md   # the retry-budget guard (countRetriesAtLatestPrompt) under test (a)/(b)/(c)
- file: plan/004_d3d84055c5b2/P4M1T2S2/PRP.md   # the context-fraction guard (computeFilteredTotal) under test (e)
- file: plan/004_d3d84055c5b2/P4M1T1S1/PRP.md   # the two config knobs under test (g)
- file: plan/004_d3d84055c5b2/P4M1T2S3/PRP.md   # (parallel) adds rewindRefusedTurnIndex flag; its rewind.test.ts
        # additions are SEPARATE new describe blocks — do NOT collide with this item's (a)–(f) blocks.
```

### Current Codebase tree (the relevant slice)

```bash
src/
  tools/
    rewind.ts            # (4b)+(4c) guards — UNDER TEST (read-only)
    audit.ts             # computeFilteredTotal(ctx) EXPORTED — called by (4c) — UNDER TEST (read-only)
    shrink.ts            # makeShrinkTool — imported by test (d)
  config.ts              # validateConfig + setConfig + the two knobs' coercion — UNDER TEST (read-only)
test/
  tools/
    rewind.test.ts       # makePi/makeCtx/run/firstText + entry helpers + VALID_NOTE  ← EDIT (extend makeCtx; add (a)–(f))
    shrink.test.ts       # reference for the valid shrink call (test d)
  config.test.ts         # validateConfig tests + dedicated-describe style                ← EDIT (add (g))
  integration/
    scenarios.md         # F-maxdepth exists (line 229); F-retrycap/F-abortfraction absent ← EDIT (add 2 sections)
```

### Desired Codebase tree with files to be added/edited

```bash
test/tools/rewind.test.ts     # + contextUsage opt on makeCtx; + getRuntime import; + describe blocks (a)–(f)
test/config.test.ts           # + describe block (g) for the two knobs' validation
test/integration/scenarios.md # + F-retrycap section; + F-abortfraction section (documented, not auto-run)
# NO new files. NO source changes. NO README change (Mode A).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL (test e): computeFilteredTotal reads ctx.getContextUsage()?.contextWindow (NOT sessionManager's).
//   makeCtx currently builds ONLY {sessionManager}. The new contextUsage opt must attach getContextUsage to the
//   ctx object. When the opt is ABSENT, do NOT attach it → ctx.getContextUsage is undefined → computeFilteredTotal
//   returns windowTokens:0 → (4c) SKIPPED → identical to today (NO regression to the 866 existing tests).

// CRITICAL (guard ordering, test e): to make the CONTEXT-FRACTION guard fire INSTEAD of the retry budget, set
//   maxRetriesPerPrompt HIGH (e.g. 100) so countRetries (≥0) never hits the budget, AND abortContextFraction
//   such that totalTokens/windowTokens ≥ it, AND ensure windowTokens>0 (contextUsage.contextWindow set).

// GOTCHA (token sizing, test e): estimateTokens ≈ chars/4. With contextWindow:10000 the threshold at 0.9 is 9000
//   tokens ≈ 36000 chars. Seed rt.lastFiltered with a message whose text is generously oversized (e.g. "x".repeat(50000))
//   so the ratio is safely ≥ 0.9 regardless of the exact tokenizer ratio.

// GOTCHA (test a/c entries): countRetriesAtLatestPrompt matches type:"message" && message.role==="user".
//   The user() helper returns {role:"user", content:text} (content is a STRING). Wrap as msgEntry(user("..."))
//   to get {type:"message", id, message}. rewindEntry(n) gives {type:"custom", customType:"mulligan:rewind"}.

// GOTCHA (test f): throwOnGetEntries makes BOTH countRewindMarkers AND countRetriesAtLatestPrompt return 0
//   (both defensive) → rewind passes (4b). A throwing getContextUsage / throwing buildContextEntries (with no
//   rt.lastFiltered) makes computeFilteredTotal return {0,0} → (4c) skipped. Either way: NO throw (E13).

// GOTCHA (S3 overlap): P4.M1.T2.S3 adds its OWN new describe blocks to rewind.test.ts (refusal sets the
//   rewindRefusedTurnIndex flag). Those are DIFFERENT blocks from this item's (a)–(f). Keep them disjoint;
//   do not assert on rewindRefusedTurnIndex here (that is S3's concern).
```

---

## Implementation Blueprint

### Data models / structure

None. This item adds no types, no models, no source. The only structural change is one OPTIONAL field on the
`makeCtx` opts type (`contextUsage?: { contextWindow: number }`) and one attached method on the constructed ctx.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT test/tools/rewind.test.ts — EXTEND makeCtx with the contextUsage opt (enables test e)
  - IN the makeCtx opts type, ADD:   contextUsage?: { contextWindow: number };
  - IN makeCtx body, build the ctx object so getContextUsage is attached ONLY when the opt is present:
        const ctx: { sessionManager: typeof sessionManager; getContextUsage?: () => unknown } = { sessionManager };
        if (opts.contextUsage !== undefined) ctx.getContextUsage = () => opts.contextUsage!;
        return { ctx: ctx as unknown as ExtensionContext };
    (replace the current `return { ctx: { sessionManager } as unknown as ExtensionContext };`.)
  - VERIFY no regression: when contextUsage is absent, ctx has NO getContextUsage → computeFilteredTotal returns
        windowTokens:0 → (4c) skipped, exactly as before.
  - ALSO: extend the existing runtime import to bring in getRuntime:
        import { clearAll, getRuntime } from "../../src/runtime.js";
    (getRuntime is needed by test e to set rt.lastFiltered; makeCtx scripts getSessionId→"s1".)

Task 2: EDIT test/tools/rewind.test.ts — ADD describe block (a) RETRY BUDGET (E22 a)
  - ADD a describe "mulligan_rewind — retry budget: per-prompt cap (P4.M1.T3.S1 / spec/08 E22 a, spec/10 §1.10)":
    it("refuses at exactly the budget (maxRetriesPerPrompt:3) with the named text and persists nothing", async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ entries: [
        msgEntry(user("update the spec")),
        rewindEntry(1), rewindEntry(2), rewindEntry(3),   // 3 existing rewind markers AFTER the latest user
      ]});
      const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      expect(firstText(res)).toContain("per-prompt retry budget");
      expect(firstText(res)).toContain("3/3");            // ${retries}/${maxRetriesPerPrompt}
      expect(appended.length).toBe(0);                    // refused BEFORE persisting
    });
  - NAMING: "P4.M1.T3.S1 / spec/08 E22 a, spec/10 §1.10" tag so the spec traceability is grep-able.
  - DEPENDENCIES: Task 1 (getRuntime import not strictly needed here; makeCtx unaffected). ASSUMES S1 landed.

Task 3: ADD describe block (b) ZERO-HIDE STILL COUNTS (E22 c)
  - it("a rewind marker that hid nothing still counts toward the budget", async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
      const { appended, pi } = makePi();
      // The 3 pre-existing markers represent zero-hide rewinds (countRetriesAtLatestPrompt does NOT inspect
      // hideEntryIds — it counts customType:"mulligan:rewind" unconditionally). If they did NOT count, the
      // next rewind would succeed; assert it is refused, proving zero-hide markers count.
      const { ctx } = makeCtx({ entries: [
        msgEntry(user("loop again")),
        rewindEntry(1), rewindEntry(2), rewindEntry(3),
      ]});
      const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      expect(firstText(res)).toContain("per-prompt retry budget");
      expect(appended.length).toBe(0);
    });
  - REASONING note in a comment: countRetriesAtLatestPrompt counts markers, not what they hid.

Task 4: ADD describe block (c) NEW PROMPT RESETS BUDGET (E22 b / g)
  - it("a LATER user message resets the budget → the next rewind succeeds", async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ entries: [
        msgEntry(user("old prompt")),
        rewindEntry(1), rewindEntry(2), rewindEntry(3),
        msgEntry(user("NEW prompt")),        // <-- latest user is now AFTER the rewind markers
      ]});
      const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      // countRetriesAtLatestPrompt finds the NEW user; rewinds after it = 0 → succeeds.
      expect(appended.length).toBeGreaterThan(0);   // marker persisted = success
      expect(firstText(res)).not.toContain("per-prompt retry budget");
    });
  - GOTCHA: last_turn with nothing after the new user may yield K=0 (still a SUCCESS that persists a marker —
        mirror the existing "K=0 → 0 messages ... (nothing matched to hide)" success test). appended.length>0 is
        the success signal regardless of K.

Task 5: ADD describe block (d) NON-REWIND TOOLS UNAFFECTED (E22 d)
  - it("after the retry budget is hit, mulligan_shrink still returns a non-refusal", async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ entries: [
        msgEntry(user("budget hit")),
        rewindEntry(1), rewindEntry(2), rewindEntry(3),
      ]});
      // 1) rewind IS refused (budget exhausted)
      const rew = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      expect(firstText(rew)).toContain("per-prompt retry budget");
      // 2) mulligan_shrink is NOT gated by the retry budget → returns a non-refusal
      const shrinkTool = makeShrinkTool(pi);
      const shrinkRes = await shrinkTool.execute("call-shrink", <valid shrink params per shrink.test.ts>,
                                                 undefined, undefined, ctx);
      expect((shrinkRes.content[0] as {type?:string})?.type).toBe("text");
      expect((shrinkRes.content[0] as {text?:string}).text).not.toContain("Mulligan: refused");
    });
  - IMPORT: add `import { makeShrinkTool } from "../../src/tools/shrink.js";` (mirror shrink.test.ts for the
        valid shrink args — shrink.test.ts has the exact params; the budget guard is rewind-only by design).
  - SCOPE: the spec wants audit/checkpoint/cancel also callable; minimal coverage = shrink (the tool named in the
        refusal text "use mulligan_shrink instead"). One non-refusal assertion is sufficient per the contract.

Task 6: ADD describe block (e) CONTEXT-FRACTION STOP (E22 e)
  - it("refuses when filtered context ≥ abortContextFraction of the window even though budget remains; shrink still callable",
     async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 100, abortContextFraction: 0.9 } }); // high budget → (4b) won't fire first
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ contextUsage: { contextWindow: 10000 }, entries: [ msgEntry(user("bloated loop")) ] });
      // Drive totalTokens: set the cached filtered view on the session runtime (PRIMARY path computeFilteredTotal reads).
      // estimateTokens ≈ chars/4 → 50000 chars ≈ 12500 tokens ≥ 0.9*10000 = 9000. Oversize to be ratio-safe.
      getRuntime("s1").lastFiltered = [{ role: "user", content: [{ type: "text", text: "x".repeat(50000) }] }] as any;
      const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      expect(firstText(res)).toContain("context is at");
      expect(firstText(res)).toContain("% of the window");
      expect(appended.length).toBe(0);
      // shrink still callable (budget was NOT the reason; only prompt-re-landing rewinds are gated):
      const shrinkTool = makeShrinkTool(pi);
      const shrinkRes = await shrinkTool.execute("call-shrink", <valid shrink params>, undefined, undefined, ctx);
      expect((shrinkRes.content[0] as {text?:string}).text).not.toContain("Mulligan: refused");
    });
  - DEPENDENCIES: Task 1 (contextUsage opt + getRuntime import). The `as any` on lastFiltered mirrors how
        drift_nudge/filter tests seed runtime state.
  - ALTERNATIVE: if setting rt.lastFiltered is awkward, instead seed makeCtx({contextEntries:[<big entries>]}) so
        buildContextEntries() yields ≥9000 tokens. The rt.lastFiltered path is preferred (it is the PRIMARY branch).

Task 7: ADD describe block (f) NEVER THROW / NEVER BLOCK TEXT (E13; E22 f)
  - it("a throwing getEntries → countRetriesAtLatestPrompt returns 0 (no crash); execute resolves to a text result",
     async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
      const { pi } = makePi();
      const { ctx } = makeCtx({ entries: [ msgEntry(user("x")) ], throwOnGetEntries: true });
      const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      expect((res.content[0] as {type?:string}).type).toBe("text");   // never throws; always a text block (E13)
    });
  - it("a throwing getContextUsage → context-fraction guard skipped (no crash)", async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 100, abortContextFraction: 0.9 } });
      const { pi } = makePi();
      // Make getContextUsage throw: build a ctx whose getContextUsage throws (extend makeCtx OR a one-off inline
      // ctx). Simplest: extend the makeCtx contextUsage handling to accept a throw flag, OR construct a minimal
      // ctx inline here. computeFilteredTotal's try/catch → {0,0} → windowTokens:0 → (4c) skipped.
      const { ctx } = makeCtx({ entries: [ msgEntry(user("x")) ] });
      (ctx as any).getContextUsage = () => { throw new Error("getContextUsage boom"); };
      const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      expect((res.content[0] as {type?:string}).type).toBe("text");   // no throw
    });
  - it("every refusal result is content:[{type:'text'}] (E13 — never blocks a normal text reply)", async () => {
      setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
      const { pi } = makePi();
      const { ctx } = makeCtx({ entries: [ msgEntry(user("x")), rewindEntry(1), rewindEntry(2), rewindEntry(3) ] });
      const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
      expect(Array.isArray(res.content)).toBe(true);
      expect(res.content.length).toBeGreaterThan(0);
      expect((res.content[0] as {type?:string}).type).toBe("text");
      expect(typeof (res.content[0] as {text?:string}).text).toBe("string");
    });
  - NOTE: throwing getEntries also makes countRewindMarkers return 0 → the rewind may PROCEED to success (or hit a
        later guard). The assertion is ONLY "no throw + text block", matching E13/E22-f. Do not over-constrain.

Task 8: EDIT test/config.test.ts — ADD describe block (g) CONFIG-KNOB VALIDATION
  - ADD describe "rewind.maxRetriesPerPrompt & rewind.abortContextFraction (P4.M1.T3.S1 / spec/09 §4, spec/08 E22)":
    (a) it("sets both valid overrides", () => {
          const cfg = validateConfig({ rewind: { maxRetriesPerPrompt: 3, abortContextFraction: 0.8 } });
          expect(cfg.rewind.maxRetriesPerPrompt).toBe(3);
          expect(cfg.rewind.abortContextFraction).toBe(0.8);
        });
    (b) it("defaults to 5 / 0.9 when absent (no warn)", () => {  // use vi.spyOn(console,"warn") per shrink block
          const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
          try { const cfg = validateConfig({});
            expect(cfg.rewind.maxRetriesPerPrompt).toBe(5); expect(cfg.rewind.abortContextFraction).toBe(0.9);
            expect(warn).not.toHaveBeenCalled();
          } finally { warn.mockRestore(); }
        });
    (c) it("abortContextFraction ∈ {0, 1.5, -0.5, NaN} → 0.9 (+warn)", () => {
          for (const bad of [0, 1.5, -0.5, NaN]) {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            try { expect(validateConfig({ rewind: { abortContextFraction: bad } }).rewind.abortContextFraction).toBe(0.9);
                  expect(warn).toHaveBeenCalledTimes(1);
                  expect(String(warn.mock.calls[0][0])).toContain("abortContextFraction");
            } finally { warn.mockRestore(); }
          }
        });
    (d) it("maxRetriesPerPrompt: 0 → 5; 2.7 → 2 (Math.floor); 'x' → 5", () => {
          expect(validateConfig({ rewind: { maxRetriesPerPrompt: 0 } }).rewind.maxRetriesPerPrompt).toBe(5);
          expect(validateConfig({ rewind: { maxRetriesPerPrompt: 2.7 } }).rewind.maxRetriesPerPrompt).toBe(2);
          expect(validateConfig({ rewind: { maxRetriesPerPrompt: "x" } }).rewind.maxRetriesPerPrompt).toBe(5);
        });
    (e) it("existing rewind knobs unchanged when the new knobs are set", () => {
          const cfg = validateConfig({ rewind: { maxRetriesPerPrompt: 3, abortContextFraction: 0.8 } });
          expect(cfg.rewind.enabled).toBe(true);
          expect(cfg.rewind.protectedRoles).toEqual(["first:user", "latest:user"]);
          expect(cfg.rewind.maxDepth).toBe(5);
          expect(cfg.rewind.requireMutationWarning).toBe(true);
        });
  - MIRROR the existing shrink.maxActive describe block's structure (line 233) exactly: the work-item tag in the
        title, `(a)/(b)/…` labels, the try/finally warn-restore idiom.
  - DEPENDENCY: none (validateConfig is pure; the knobs + their coercion already exist from P4.M1.T1.S1).

Task 9: EDIT test/integration/scenarios.md — ADD F-retrycap + F-abortfraction sections
  - ADD two sections mirroring the existing F-maxdepth section (line 229): a short "How to drive" + "Pass criteria"
        block each, drawn directly from spec/10 §2.1 (F-retrycap: maxRetriesPerPrompt:2, repeated last_turn
        rewinds → 3rd refused with budget text, persists nothing, fresh prompt restores; F-abortfraction: force
        filtered ≥ abortContextFraction → rewind refused with context-fraction text, shrink/audit still callable).
  - MARK both: "Deterministic unit coverage lives in test/tools/rewind.test.ts (P4.M1.T3.S1); this is the
        Tier-2 live-reproduction path, documented, not auto-run." (internal-only note per Mode A.)
```

### Implementation Patterns & Key Details

```ts
// ── makeCtx extension (Task 1): attach getContextUsage ONLY when opted in (no regression) ──────────
function makeCtx(opts: { /* …existing… */ contextUsage?: { contextWindow: number } } = {}) {
  // …existing sessionManager build…
  const ctx: { sessionManager: typeof sessionManager; getContextUsage?: () => unknown } = { sessionManager };
  if (opts.contextUsage !== undefined) ctx.getContextUsage = () => opts.contextUsage!;
  return { ctx: ctx as unknown as ExtensionContext };
}
// computeFilteredTotal reads ctx.getContextUsage?.() — undefined when absent → windowTokens:0 → guard skipped.

// ── Test (a) idiom (Tasks 2–4): pre-seed the entries the guard scans ───────────────────────────────
// countRetriesAtLatestPrompt scans getEntries() — which returns the FIXED `entries` array. We do NOT simulate
// the loop by calling rewind 4× (appendEntry is captured into `appended`, not re-read). Instead pre-seed the
// markers that represent the prior rewinds, then call rewind ONCE and assert it sees the budget as exhausted.
setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
const { ctx } = makeCtx({ entries: [ msgEntry(user("…")), rewindEntry(1), rewindEntry(2), rewindEntry(3) ] });
// countRetriesAtLatestPrompt: latest user at idx 0 → 3 rewinds after it → 3 >= 3 → refuse "…(3/3 rewinds…)".

// ── Test (e) idiom (Task 6): drive totalTokens via the cached filtered view ─────────────────────────
getRuntime("s1").lastFiltered = [{ role:"user", content:[{type:"text", text:"x".repeat(50000)}] }] as any;
// estimateTokens(filtered).tokens ≈ 12500 ≥ 0.9*10000=9000 → windowTokens=10000 → ratio 1.25 ≥ 0.9 → refuse.
// HIGH maxRetriesPerPrompt (100) ensures (4b) does not fire first; only (4c) refuses here.

// ── Test (d)/(e) shrink call (Tasks 5/6): shrink is never retry-budget-gated ───────────────────────
const shrinkTool = makeShrinkTool(pi);
const shrinkRes = await shrinkTool.execute("call-shrink", <valid shrink args>, undefined, undefined, ctx);
expect((shrinkRes.content[0] as {text?:string}).text).not.toContain("Mulligan: refused");
```

### Integration Points

```yaml
DATABASE: none.
CONFIG: none new — the tests SET config via setConfig({...}) per-case (the knobs already exist from P4.M1.T1.S1).
ROUTES/EVENTS: none — these are pure unit tests driving the tool's execute against fakes.
PERSISTENCE: none — appended markers are captured in-memory by makePi; nothing is written to disk.
DOCUMENTATION: [Mode A] none user-facing. The test/integration/scenarios.md additions are internal-only.
```

---

## Validation Loop

### Level 1: Syntax & Style (after each file)

```bash
npm run build                  # tsc --noEmit — the makeCtx type change + new imports must typecheck (zero errors)
npx vitest typecheck 2>/dev/null || true   # if configured
# Expected: zero errors. Watch the makeCtx opts-type extension (contextUsage?: {contextWindow:number}) and the
# new imports (getRuntime, makeShrinkTool).
```

### Level 2: Unit Tests (component validation)

```bash
# The two files under edit (run after each task lands)
npx vitest run test/tools/rewind.test.ts -t "retry budget"      # Tasks 2–4 (a/b/c)
npx vitest run test/tools/rewind.test.ts -t "shrink still"      # Task 5 (d) + Task 6 (e) shrink arm
npx vitest run test/tools/rewind.test.ts -t "context"           # Task 6 (e)
npx vitest run test/tools/rewind.test.ts -t "throw"             # Task 7 (f) — match your it() titles
npx vitest run test/config.test.ts -t "maxRetriesPerPrompt"     # Task 8 (g)

# Full file runs (catch regressions in the existing blocks — especially the makeCtx change)
npx vitest run test/tools/rewind.test.ts
npx vitest run test/config.test.ts
npx vitest run test/tools/shrink.test.ts     # ensure the imported makeShrinkTool usage is consistent
# Expected: ALL green. The makeCtx extension is additive/optional → existing rewind/audit/shrink tests unaffected.
```

### Level 3: Full-suite regression

```bash
npx vitest run
# Expected: ALL green. Pre-edit baseline = 866 passing. After this item: 866 + (new tests) passing, ZERO failures.
# CRITICAL: no existing test changes color. (The only intentional flips elsewhere are P4.M2.T1.S2's two bloat-armed
# assertions — NOT in this item's scope.)
```

### Level 4: Spec-traceability grep (deterministic, non-flaky)

```bash
# Every E22 acceptance letter is covered by a named test (grep the work-item tag):
grep -nE "P4\.M1\.T3\.S1|spec/08 E22|spec/10 §1\.10|per-prompt retry budget|context is at" test/tools/rewind.test.ts
grep -nE "P4\.M1\.T3\.S1|maxRetriesPerPrompt|abortContextFraction" test/config.test.ts
# Both new integration sections present:
grep -nE "F-retrycap|F-abortfraction" test/integration/scenarios.md
# Expected: (a)–(g) each map to at least one named test; both F-sections present.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run build` passes (zero tsc errors; the makeCtx opts-type + new imports typecheck).
- [ ] `npx vitest run` — ALL green; baseline 866 + new tests, zero failures.
- [ ] `npx vitest run test/tools/rewind.test.ts` and `test/config.test.ts` individually green.

### Feature Validation (E22 a–g coverage)
- [ ] (a) refuses at the budget with `"per-prompt retry budget"` + `"3/3"`, `appended.length===0`.
- [ ] (b) a zero-hide rewind marker still counts toward the budget.
- [ ] (c) a later user message resets the budget → next rewind succeeds (`appended.length>0`).
- [ ] (d) after the budget is hit, `mulligan_shrink` returns a non-refusal.
- [ ] (e) context ≥ `abortContextFraction` → refused with `"context is at"` + `"% of the window"`; shrink callable.
- [ ] (f) throwing getEntries / throwing getContextUsage → no crash; every refusal is `content:[{type:"text"}]`.
- [ ] (g) config coercion matches the Blueprint table exactly (incl. `2.7→2`, `0→5`, `'x'→5`, fraction range).

### Code Quality Validation
- [ ] makeCtx extension is ADDITIVE + OPTIONAL (absent contextUsage → no getContextUsage → no regression).
- [ ] New describe blocks do NOT duplicate or alter any existing block.
- [ ] Each new `it` carries the `P4.M1.T3.S1 / spec/...` traceability tag in its describe title.
- [ ] shrink calls (Tasks 5/6) mirror `test/tools/shrink.test.ts` for the valid args.
- [ ] No source files modified; no README/config-table change (Mode A).

### Documentation
- [ ] `test/integration/scenarios.md` has F-retrycap + F-abortfraction sections (internal-only, marked not auto-run).
- [ ] No user-facing docs changed (tests are not user-facing).

---

## Anti-Patterns to Avoid

- ❌ Don't simulate the retry loop by calling rewind 4× and relying on `appended` being re-read — makeCtx's
  `entries` is static; PRE-SEED the markers that represent the prior rewinds and call rewind ONCE. (countRetriesAtLatestPrompt
  scans getEntries(), which returns the fixed array.)
- ❌ Don't attach `getContextUsage` to `sessionManager` — `computeFilteredTotal` reads `ctx.getContextUsage?.()`.
  Attach it to the **ctx** object. And only when the opt is present (absent = no regression).
- ❌ Don't let the makeCtx change attach `getContextUsage` unconditionally — that would give every existing test a
  non-zero window and could flip (4c) behavior. Make it strictly opt-in.
- ❌ Don't set `abortContextFraction` low AND `maxRetriesPerPrompt` low in test (e) — both (4b) and (4c) could fire;
  set `maxRetriesPerPrompt` HIGH so ONLY (4c) refuses (isolating the context-fraction path).
- ❌ Don't under-size the test (e) token payload — use a generously oversized string (≥40000 chars) so the ratio is
  safely ≥ 0.9 regardless of estimateTokens' exact chars-per-token ratio.
- ❌ Don't over-constrain test (f) success-path assertions — a throwing getEntries makes the rewind PROCEED (counts
  are 0); assert ONLY "no throw + text block". Don't assert success-vs-refusal there.
- ❌ Don't modify any source file (rewind.ts/audit.ts/config.ts) — this item is TEST-ONLY. If a guard is missing or
  buggy, that is P4.M1.T2.S1/S2's scope, not this item's.
- ❌ Don't add README/config rows — Mode A (tests are not user-facing).

---

**Confidence Score: 9/10** for one-pass success. The guards under test are already implemented (S1/S2) and their
exact logic + refusal strings + the makePi/makeCtx/run/firstText idioms are all pinned to verified line anchors.
The single residual risk is the exact valid-shrink call shape in Tasks 5/6 — mitigated by pointing at
`test/tools/shrink.test.ts` as the reference and keeping the assertion to "non-refusal" (robust to shrink's own
minor variations). The makeCtx change is additive and verified non-regressive against the 866-test baseline.